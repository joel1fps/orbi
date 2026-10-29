import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { basename, truncate } from '@shared/tools';
import type { PermissionDecision } from '@shared/types';
import { hub } from '../hub';
import { refreshClaudeUsageSoon } from './claudeUsage';
import { describeClaudeTool, describePermission } from './describe';
import { parseLines, readRange } from './files';

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

// ===================================================================
// 1. Hooks (real-time, opt-in). Payloads arrive from the bridge server.
// ===================================================================

export interface HookPayload {
  hook_event_name: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: unknown;
  prompt?: string;
  message?: string;
  notification_type?: string;
  last_assistant_message?: string;
  error?: string;
  error_details?: string;
  is_interrupt?: boolean;
  source?: string;
}

const lastHookAt = new Map<string, number>();
/** Sessions Claude Code told us have ended; the transcript reader must not bring them back. */
const ended = new Set<string>();

export function handleHook(p: HookPayload): void {
  const id = p.session_id;
  if (!id) return;
  const now = Date.now();
  lastHookAt.set(id, now);
  hub.setClaude({ lastHookAt: now });
  const project = basename(p.cwd) || 'sessão';
  const base = { tool: 'claude' as const, source: 'hooks' as const, project, cwd: p.cwd };

  switch (p.hook_event_name) {
    case 'SessionStart':
      hub.upsertSession(id, { ...base, state: 'idle', current: 'Sessão aberta', steps: 0 });
      break;
    case 'UserPromptSubmit': {
      hub.upsertSession(id, {
        ...base,
        state: 'working',
        steps: 0,
        startedAt: now,
        current: 'Pensando…',
        currentCode: undefined,
        lastStep: undefined,
        summary: undefined,
      });
      hub.event({
        kind: 'start',
        tool: 'claude',
        title: `Nova tarefa em ${project}`,
        detail: p.prompt ? truncate(p.prompt, 80) : undefined,
        project,
        sessionId: id,
      });
      break;
    }
    case 'PreToolUse': {
      const d = describeClaudeTool(p.tool_name ?? '', p.tool_input);
      hub.upsertSession(id, { ...base, state: 'working', current: d.label, currentCode: d.code });
      break;
    }
    case 'PostToolUse': {
      const s = hub.getSession(id);
      const d = describeClaudeTool(p.tool_name ?? '', p.tool_input);
      hub.upsertSession(id, { ...base, state: 'working', steps: (s?.steps ?? 0) + 1, lastStep: { label: d.label, ok: true } });
      break;
    }
    case 'PostToolUseFailure': {
      const s = hub.getSession(id);
      const d = describeClaudeTool(p.tool_name ?? '', p.tool_input);
      hub.upsertSession(id, {
        ...base,
        steps: (s?.steps ?? 0) + 1,
        lastStep: { label: p.is_interrupt ? `${d.label} (interrompido)` : `${d.label} falhou`, ok: false },
      });
      break;
    }
    case 'Notification':
      if (p.notification_type === 'idle_prompt') {
        hub.upsertSession(id, { ...base, state: 'waiting', current: 'Aguardando você', currentCode: undefined });
        hub.event({ kind: 'waiting', tool: 'claude', title: 'Claude Code aguarda você', detail: project, project, sessionId: id });
      }
      break;
    case 'Stop': {
      const summary = firstSentence(p.last_assistant_message);
      hub.upsertSession(id, { ...base, state: 'done', current: 'Concluído', currentCode: undefined, summary });
      hub.event({ kind: 'done', tool: 'claude', title: `Claude Code terminou em ${project}`, detail: summary, project, sessionId: id });
      refreshClaudeUsageSoon();
      break;
    }
    case 'StopFailure': {
      const detail = p.error_details || p.last_assistant_message || p.error || 'Erro da API';
      hub.upsertSession(id, { ...base, state: 'error', current: 'Parou com erro', currentCode: undefined, summary: truncate(detail, 120) });
      hub.event({ kind: 'error', tool: 'claude', title: 'Claude Code parou com erro', detail: truncate(detail, 100), project, sessionId: id });
      break;
    }
    case 'SessionEnd':
      ended.add(id);
      hub.removeSession(id);
      lastHookAt.delete(id);
      break;
  }
}

export async function handlePermissionHook(p: HookPayload, signal?: AbortSignal): Promise<PermissionDecision> {
  const id = p.session_id;
  const project = basename(p.cwd) || undefined;
  const d = describeClaudeTool(p.tool_name ?? '', p.tool_input);
  if (id) {
    lastHookAt.set(id, Date.now());
    hub.upsertSession(id, {
      tool: 'claude',
      source: 'hooks',
      project: project ?? 'sessão',
      cwd: p.cwd,
      state: 'waiting',
      current: 'Precisa de permissão',
      currentCode: d.code,
    });
  }
  const what = describePermission(p.tool_name ?? '', p.tool_input);
  const decision = await hub.requestPermission(
    {
      tool: 'claude',
      sessionId: id,
      project,
      toolName: p.tool_name ?? 'Ferramenta',
      summary: what.summary,
      description: what.description,
    },
    signal,
  );
  if (id && hub.getSession(id)?.state === 'waiting') {
    hub.upsertSession(id, {
      tool: 'claude',
      source: 'hooks',
      state: 'working',
      current: decision === 'deny' ? 'Permissão negada' : d.label,
    });
  }
  return decision;
}

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.{12,140}?[.!?])(\s|$)/.exec(clean);
  return truncate(m ? m[1] : clean, 140);
}

// ===================================================================
// 2. Transcripts (passive, no setup). ~/.claude/projects/<proj>/<id>.jsonl
// ===================================================================

interface TranscriptEntry {
  type?: string;
  isSidechain?: boolean;
  cwd?: string;
  message?: { role?: string; stop_reason?: string | null; content?: unknown };
}

interface Watched {
  mtime: number;
  size: number;
  state?: string;
}

const HOT_WINDOW_MS = 30 * 60_000;
const TAIL_BYTES = 96 * 1024;
const watched = new Map<string, Watched>();
let started = false;

export function startClaudeWatchers(): void {
  if (started) return;
  started = true;
  void rescan(true);
  setInterval(() => void rescan(false), 20_000).unref();
  setInterval(() => void pollHot(), 2_500).unref();
}

async function rescan(initial: boolean) {
  const root = join(claudeDir(), 'projects');
  let dirs: string[];
  try {
    dirs = await fs.readdir(root);
  } catch {
    return;
  }
  const now = Date.now();
  for (const d of dirs) {
    let files: string[];
    try {
      files = await fs.readdir(join(root, d));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const path = join(root, d, f);
      if (watched.has(path)) continue;
      try {
        const st = await fs.stat(path);
        if (now - st.mtimeMs > HOT_WINDOW_MS) continue;
        watched.set(path, { mtime: 0, size: 0 });
        // On startup, read the current state silently instead of replaying it as events.
        await inspect(path, st.mtimeMs, st.size, initial);
      } catch {
        /* vanished */
      }
    }
  }
}

async function pollHot() {
  const now = Date.now();
  for (const [path, w] of watched) {
    try {
      const st = await fs.stat(path);
      if (now - st.mtimeMs > HOT_WINDOW_MS) {
        watched.delete(path);
        continue;
      }
      if (st.mtimeMs !== w.mtime || st.size !== w.size) await inspect(path, st.mtimeMs, st.size, false);
    } catch {
      watched.delete(path);
    }
  }
}

async function inspect(path: string, mtime: number, size: number, silent: boolean) {
  const w = watched.get(path);
  if (!w) return;
  w.mtime = mtime;
  w.size = size;
  const id = basename(path).replace(/\.jsonl$/, '');
  // Hooks are richer and authoritative while they are flowing for this session.
  if (ended.has(id) || Date.now() - (lastHookAt.get(id) ?? 0) < 90_000) return;

  const text = await readRange(path, Math.max(0, size - TAIL_BYTES), size);
  const entries = parseLines<TranscriptEntry>(text).filter((e) => !e.isSidechain && (e.type === 'user' || e.type === 'assistant'));
  if (entries.length === 0) return;
  const cwd = [...entries].reverse().find((e) => e.cwd)?.cwd;
  const project = basename(cwd) || 'sessão';

  // Steps since the last real prompt.
  let steps = 0;
  let lastStep: { label: string; ok: boolean } | undefined;
  const toolNames = new Map<string, { name: string; input: unknown }>();
  for (const e of entries) {
    const content = Array.isArray(e.message?.content) ? (e.message!.content as Record<string, unknown>[]) : [];
    if (e.type === 'user' && (typeof e.message?.content === 'string' || content.some((c) => c.type === 'text'))) {
      steps = 0;
      lastStep = undefined;
    }
    for (const c of content) {
      if (c.type === 'tool_use') toolNames.set(String(c.id), { name: String(c.name), input: c.input });
      if (c.type === 'tool_result') {
        steps++;
        const t = toolNames.get(String(c.tool_use_id));
        if (t) lastStep = { label: describeClaudeTool(t.name, t.input).label, ok: c.is_error !== true };
      }
    }
  }

  const last = entries[entries.length - 1];
  const lastContent = Array.isArray(last.message?.content) ? (last.message!.content as Record<string, unknown>[]) : [];
  let state: 'working' | 'done';
  let current: string;
  let code: string | undefined;
  let summary: string | undefined;
  if (last.type === 'assistant' && (last.message?.stop_reason === 'end_turn' || last.message?.stop_reason === 'stop_sequence')) {
    state = 'done';
    current = 'Concluído';
    const txt = lastContent.find((c) => c.type === 'text');
    summary = firstSentence(typeof txt?.text === 'string' ? txt.text : undefined);
  } else if (last.type === 'assistant') {
    const tu = [...lastContent].reverse().find((c) => c.type === 'tool_use');
    state = 'working';
    if (tu) {
      const d = describeClaudeTool(String(tu.name), tu.input);
      current = d.label;
      code = d.code;
    } else current = 'Escrevendo resposta';
  } else {
    state = 'working';
    current = lastContent.some((c) => c.type === 'tool_result') ? 'Analisando resultado' : 'Pensando…';
  }

  const prevState = w.state;
  w.state = state;
  const age = Date.now() - mtime;
  if (state === 'working' && age > 3 * 60_000) return; // stale: interrupted or waiting in a prompt we can't see

  hub.upsertSession(id, {
    tool: 'claude',
    source: 'transcript',
    project,
    cwd,
    state,
    current,
    currentCode: code,
    steps,
    lastStep,
    summary,
    updatedAt: mtime,
  });

  if (silent) return;
  if (state === 'working' && prevState !== 'working') {
    hub.event({ kind: 'start', tool: 'claude', title: `Claude Code trabalhando em ${project}`, project, sessionId: id });
  } else if (state === 'done' && prevState === 'working') {
    hub.event({ kind: 'done', tool: 'claude', title: `Claude Code terminou em ${project}`, detail: summary, project, sessionId: id });
    refreshClaudeUsageSoon();
  }
}
