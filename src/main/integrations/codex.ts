import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { basename, truncate } from '@shared/tools';
import { hub } from '../hub';
import { refreshCodexUsageSoon } from './codexUsage';
import { describeCodexCall } from './describe';
import { parseLines, readBytes, readRange } from './files';
import { codexWindows, isPlanLimit, type CodexRateLimits } from './limits';

/**
 * Codex writes every session as JSONL under ~/.codex/sessions/YYYY/MM/DD.
 * We tail those files: task start/finish, commands and their exit codes,
 * and the plan's rate limits (5-hour and weekly windows).
 */
const root = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');

interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown> & { type?: string };
}

interface FileState {
  offset: number;
  mtime: number;
  sessionId?: string;
  project?: string;
  cwd?: string;
  sub?: boolean;
}

const HOT_WINDOW_MS = 24 * 60 * 60_000;
const files = new Map<string, FileState>();
let started = false;

function parseRolloutDate(filename: string): number {
  const m = filename.match(/rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export function startCodexWatcher(): void {
  if (started) return;
  started = true;
  void discover(true);
  setInterval(() => void discover(false), 15_000).unref();
  setInterval(() => void poll(), 2_500).unref();
  setInterval(() => void loadLatestUsage(), 60_000).unref();
}

function dayDirs(): string[] {
  const out: string[] = [];
  // A resumed session keeps writing to the file of the day it started, so look back a week.
  for (let offset = 0; offset > -7; offset--) {
    const d = new Date(Date.now() + offset * 86_400_000);
    out.push(join(root(), String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')));
  }
  return out;
}

async function listRollouts(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl')).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

async function discover(initial: boolean) {
  const now = Date.now();
  const candidates = (await Promise.all(dayDirs().map(listRollouts))).flat();
  for (const path of candidates) {
    if (files.has(path)) continue;
    try {
      const st = await fs.stat(path);
      const fileTime = Math.max(st.mtimeMs, parseRolloutDate(basename(path)));
      if (now - fileTime > HOT_WINDOW_MS) continue;
      const fsx: FileState = { offset: 0, mtime: st.mtimeMs };
      files.set(path, fsx);
      await readHeader(path, fsx);
      // Existing content on discovery: read recent tail silently to avoid replaying past notifications
      const start = Math.max(0, st.size - 512 * 1024);
      await consume(path, fsx, start, st.size, true);
    } catch {
      /* vanished */
    }
  }
  if (initial) await loadLatestUsage();
}

async function poll() {
  const now = Date.now();
  for (const [path, f] of files) {
    try {
      const st = await fs.stat(path);
      if (st.size > f.offset) await consume(path, f, f.offset, st.size, false);
      f.mtime = st.mtimeMs;
      const fileTime = Math.max(st.mtimeMs, parseRolloutDate(basename(path)));
      if (now - fileTime > HOT_WINDOW_MS) files.delete(path);
    } catch {
      files.delete(path);
    }
  }
}

async function readHeader(path: string, f: FileState) {
  const head = await readRange(path, 0, 64 * 1024);
  const meta = parseLines<RolloutLine>(head).find((l) => l.type === 'session_meta');
  const p = meta?.payload ?? {};
  f.sessionId = String(p.id ?? basename(path));
  f.cwd = typeof p.cwd === 'string' ? p.cwd : undefined;
  f.project = basename(f.cwd) || 'sessão';
  // Sub-agents get their own rollout files; fold them into the parent's activity.
  f.sub = Boolean(p.parent_thread_id);
}

async function consume(path: string, f: FileState, start: number, end: number, silent: boolean) {
  // A tail read that starts mid-file begins with a partial line.
  const aligned = start === 0 || start === f.offset;
  const buf = await readBytes(path, start, end);
  // Only advance past complete lines; a half-written line is picked up next time.
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < 0) return;
  f.offset = start + lastNl + 1;
  let text = buf.subarray(0, lastNl + 1).toString('utf8');
  if (!aligned) text = text.slice(text.indexOf('\n') + 1);
  for (const line of parseLines<RolloutLine>(text)) handleLine(f, line, silent);
}

function handleLine(f: FileState, l: RolloutLine, silent: boolean) {
  const p = l.payload;
  if (!p) return;
  const at = l.timestamp ? Date.parse(l.timestamp) : Date.now();

  if (p.type === 'token_count') {
    const rl = (p.rate_limits ?? (p.info as Record<string, unknown> | undefined)?.rate_limits) as CodexRateLimits | undefined;
    if (rl) applyRateLimits(rl, at);
    return;
  }
  if (f.sub || !f.sessionId) return;
  const id = f.sessionId;
  const base = { tool: 'codex' as const, source: 'rollout' as const, project: f.project ?? 'sessão', cwd: f.cwd, updatedAt: at };
  const prev = hub.getSession(id);

  switch (p.type) {
    case 'task_started':
      hub.upsertSession(id, { ...base, state: 'working', steps: 0, startedAt: at, current: 'Pensando…', currentCode: undefined, lastStep: undefined, summary: undefined });
      if (!silent) hub.event({ kind: 'start', tool: 'codex', title: `Nova tarefa em ${base.project}`, project: base.project, sessionId: id });
      break;
    case 'custom_tool_call':
    case 'function_call': {
      const d = describeCodexCall(String(p.name ?? ''), typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : undefined);
      const waiting = p.name === 'request_user_input_async';
      hub.upsertSession(id, { ...base, state: waiting ? 'waiting' : 'working', current: d.label, currentCode: d.code });
      break;
    }
    case 'item_completed': {
      const item = (p.item ?? {}) as Record<string, unknown>;
      if (typeof item.command !== 'string' && !Array.isArray(item.command)) break;
      const cmd = Array.isArray(item.command) ? item.command.join(' ') : (item.command as string);
      hub.upsertSession(id, {
        ...base,
        state: prev?.state === 'done' ? 'done' : 'working',
        steps: (prev?.steps ?? 0) + 1,
        lastStep: { label: truncate(cmd.split(/\r?\n/)[0], 60), ok: item.exit_code === 0 || item.exit_code === undefined },
      });
      break;
    }
    case 'task_complete': {
      const msg = typeof p.last_agent_message === 'string' ? p.last_agent_message : '';
      const summary = msg ? truncate(msg.replace(/[#*_`>]/g, '').split(/\n/).find((x) => x.trim()) ?? msg, 140) : undefined;
      hub.upsertSession(id, { ...base, state: 'done', current: 'Concluído', currentCode: undefined, summary });
      if (!silent) refreshCodexUsageSoon();
      if (!silent) hub.event({ kind: 'done', tool: 'codex', title: `Codex terminou em ${base.project}`, detail: summary, project: base.project, sessionId: id });
      break;
    }
    case 'turn_aborted':
      hub.upsertSession(id, { ...base, state: 'idle', current: 'Interrompido', currentCode: undefined });
      break;
    case 'error': {
      const message = typeof p.message === 'string' ? p.message : 'Erro';
      hub.upsertSession(id, { ...base, state: 'error', current: 'Parou com erro', summary: truncate(message, 120) });
      if (!silent) hub.event({ kind: 'error', tool: 'codex', title: 'Codex parou com erro', detail: truncate(message, 100), project: base.project, sessionId: id });
      break;
    }
  }
}

let lastPlan: string | undefined;

/** Returns false when the record carries no plan windows (Codex also logs other, empty limit ids). */
function applyRateLimits(rl: CodexRateLimits, at: number): boolean {
  if (!isPlanLimit(rl)) return false;
  const w = codexWindows(rl);
  if (!w) return false;
  // Older Codex builds write plan_type: null; keep the last plan name we saw.
  if (w.plan) lastPlan = w.plan;
  hub.setUsage({
    tool: 'codex',
    plan: w.plan ?? lastPlan,
    fiveHour: w.fiveHour,
    week: w.week,
    observedAt: at,
    source: 'Sessões do Codex (~/.codex/sessions)',
  });
  return true;
}

/** On startup and periodically, find the most recent rate-limit record across recent sessions. */
async function loadLatestUsage() {
  let years: string[];
  try {
    years = (await fs.readdir(root())).sort().reverse();
  } catch {
    return;
  }
  const recent: { path: string; effectiveTime: number }[] = [];
  for (const y of years.slice(0, 2)) {
    const months = (await fs.readdir(join(root(), y)).catch(() => [] as string[])).sort().reverse().slice(0, 2);
    for (const m of months) {
      const days = (await fs.readdir(join(root(), y, m)).catch(() => [] as string[])).sort().reverse().slice(0, 4);
      for (const d of days) {
        for (const p of await listRollouts(join(root(), y, m, d))) {
          const st = await fs.stat(p).catch(() => null);
          if (st) {
            const effectiveTime = Math.max(st.mtimeMs, parseRolloutDate(basename(p)));
            recent.push({ path: p, effectiveTime });
          }
        }
      }
    }
  }
  recent.sort((a, b) => b.effectiveTime - a.effectiveTime);
  if (recent.length === 0) {
    hub.setLimitNote('codex', 'Use o Codex uma vez: os limites chegam junto com a primeira resposta.');
    return;
  }

  // Scan recent session files and find the newest valid rate_limits record by event timestamp
  let latestRl: CodexRateLimits | undefined;
  let latestTimestamp = 0;

  for (const { path } of recent.slice(0, 25)) {
    try {
      const st = await fs.stat(path);
      const text = await readRange(path, Math.max(0, st.size - 512 * 1024), st.size);
      const lines = parseLines<RolloutLine>(text).filter((l) => l.payload?.type === 'token_count');
      for (const l of lines.reverse()) {
        const rl = l.payload?.rate_limits as CodexRateLimits | undefined;
        if (rl && isPlanLimit(rl) && codexWindows(rl)) {
          const at = l.timestamp ? Date.parse(l.timestamp) : st.mtimeMs;
          if (at > latestTimestamp) {
            latestTimestamp = at;
            latestRl = rl;
          }
          break;
        }
      }
    } catch {
      /* ignore read failure */
    }
  }

  if (latestRl && latestTimestamp > 0) {
    applyRateLimits(latestRl, latestTimestamp);
  }
}

