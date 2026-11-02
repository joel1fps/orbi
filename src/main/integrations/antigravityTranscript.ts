import type { SessionState } from '../../shared/types';

/**
 * Pure parser for Antigravity 2.0 `transcript.jsonl` lines and tool descriptions
 * (no I/O, unit-tested directly under `node --test`).
 */

function basenameOf(p: string | undefined): string {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function truncateText(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

function firstLine(s: string): string | undefined {
  if (!s) return undefined;
  return truncateText(s.split(/\r?\n/)[0], 120);
}

function countLines(s: string): number {
  return s ? s.split(/\r?\n/).length : 0;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'página';
  }
}

/**
 * Antigravity's `transcript.jsonl` stores each tool argument value as a JSON-encoded
 * string (e.g. `"\"npm test\""`), whereas hooks pass plain strings. Unwrap cleanly.
 */
export function cleanAntigravityArg(v: unknown): string {
  if (typeof v !== 'string') return '';
  let cur = v;
  for (let depth = 0; depth < 2; depth++) {
    const t = cur.trim();
    if (t.length < 2 || !t.startsWith('"') || !t.endsWith('"')) break;
    try {
      const parsed: unknown = JSON.parse(t);
      if (typeof parsed !== 'string') break;
      cur = parsed;
    } catch {
      break;
    }
  }
  return cur;
}

/** Human label + optional monospace payload + touched file path for an Antigravity tool call. */
export function describeAntigravityTool(name: string, input: unknown): { label: string; code?: string; filePath?: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (k: string) => cleanAntigravityArg(i[k]);
  const path = s('Path') || s('TargetFile') || s('AbsolutePath') || s('File') || s('DirectoryPath') || undefined;

  switch (name) {
    case 'run_command':
      return {
        label: s('toolSummary') ? truncateText(s('toolSummary'), 60) : 'Executando comando',
        code: firstLine(s('CommandLine')),
        filePath: s('Cwd') || undefined,
      };
    case 'read_file':
    case 'view_file':
    case 'view_file_outline':
    case 'view_code_item':
      return { label: path ? `Lendo ${basenameOf(path)}` : 'Lendo arquivo', filePath: path };
    case 'edit_file':
    case 'replace_file_content':
    case 'multi_replace_file_content': {
      const added = countLines(s('Replacement') || s('ReplacementContent'));
      const removed = countLines(s('Target') || s('TargetContent'));
      return {
        label: path ? `Editando ${basenameOf(path)}` : 'Editando arquivo',
        code: added || removed ? `+${added} −${removed}` : undefined,
        filePath: path,
      };
    }
    case 'write_file':
    case 'write_to_file': {
      const content = s('Content') || s('CodeContent');
      return {
        label: path ? `Escrevendo ${basenameOf(path)}` : 'Escrevendo arquivo',
        code: content ? `+${countLines(content)}` : undefined,
        filePath: path,
      };
    }
    case 'grep_search':
      return { label: 'Buscando no código', code: truncateText(s('Query'), 60), filePath: s('SearchPath') || undefined };
    case 'find_by_name':
      return { label: 'Procurando arquivos', code: truncateText(s('Pattern'), 60), filePath: s('SearchDirectory') || undefined };
    case 'list_dir':
      return { label: path ? `Listando ${basenameOf(path)}` : 'Listando pasta', filePath: path };
    case 'search_web':
      return { label: 'Pesquisando na web', code: truncateText(s('query'), 60) };
    case 'read_url_content':
      return { label: `Lendo ${hostOf(s('Url'))}` };
    case 'ask_question':
      return { label: 'Pergunta para você' };
    case 'invoke_subagent':
      return { label: s('Role') ? `Subagente: ${truncateText(s('Role'), 48)}` : 'Subagente trabalhando' };
    case 'define_subagent':
    case 'manage_subagents':
      return { label: 'Gerenciando subagentes' };
    case 'send_message':
      return { label: 'Conversando com subagente' };
    case 'manage_task':
      return { label: 'Verificando tarefa em 2º plano' };
    case 'schedule':
      return { label: 'Agendando tarefa' };
    case 'search_marketplace':
    case 'list_plugin_accounts':
      return { label: 'Consultando plugins' };
    case 'call_mcp_tool':
      return {
        label: s('ToolName') ? `${s('ToolName').replace(/_/g, ' ')} (${s('ServerName') || 'MCP'})` : 'Usando ferramenta MCP',
      };
    case 'list_resources':
    case 'read_resource':
      return { label: s('ServerName') ? `Lendo recurso (${s('ServerName')})` : 'Lendo recurso MCP' };
    default: {
      if (name.startsWith('browser_')) return { label: 'Usando o navegador' };
      const mcp = /^mcp_([^_]+)_(.+)$/.exec(name);
      if (mcp) return { label: `${mcp[2].replace(/_/g, ' ')} (${mcp[1]})` };
      return { label: name.replace(/_/g, ' '), filePath: path };
    }
  }
}

export interface AgyTranscriptToolCall {
  name?: string;
  args?: Record<string, unknown>;
}

export interface AgyTranscriptLine {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  error?: string;
  created_at?: string;
  content?: string;
  tool_calls?: AgyTranscriptToolCall[];
}

export interface PendingTool {
  name: string;
  label: string;
  code?: string;
}

export interface AgySessionTracker {
  sessionId: string;
  project?: string;
  cwd?: string;
  state: SessionState;
  current?: string;
  currentCode?: string;
  steps: number;
  lastStep?: { label: string; ok: boolean };
  summary?: string;
  startedAt: number;
  updatedAt: number;
  pendingTools: PendingTool[];
  subagentIds: string[];
}

export interface TranscriptStepEffect {
  changed: boolean;
  event?: 'start' | 'done' | 'error' | 'waiting';
  detail?: string;
  touchedPaths: string[];
}

export function createAgyTracker(sessionId: string, now = Date.now()): AgySessionTracker {
  return {
    sessionId,
    state: 'idle',
    steps: 0,
    startedAt: now,
    updatedAt: now,
    pendingTools: [],
    subagentIds: [],
  };
}

/** Extract the user's actual message from Antigravity's `<USER_REQUEST>` wrapper when present. */
export function cleanUserPrompt(raw: string | undefined): string {
  if (!raw) return '';
  const tag = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i.exec(raw);
  if (tag) return tag[1].trim();
  return raw
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
    .trim();
}

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/[#*_`>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  const m = /^(.{12,140}?[.!?])(\s|$)/.exec(clean);
  return truncateText(m ? m[1] : clean, 140);
}

const SUBAGENT_ID_RE = /conversation[_\s-]*id["':=\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function applyAntigravityTranscriptLine(t: AgySessionTracker, l: AgyTranscriptLine, fallbackNow = Date.now()): TranscriptStepEffect {
  const at = (l.created_at ? Date.parse(l.created_at) : 0) || fallbackNow;
  const touchedPaths: string[] = [];

  if (l.type === 'USER_INPUT' && (!l.source || l.source === 'USER_EXPLICIT')) {
    const prompt = cleanUserPrompt(l.content);
    t.state = 'working';
    t.startedAt = at;
    t.updatedAt = at;
    t.steps = 0;
    t.lastStep = undefined;
    t.summary = undefined;
    t.pendingTools = [];
    t.current = 'Pensando…';
    t.currentCode = undefined;
    return { changed: true, event: 'start', detail: prompt ? truncateText(prompt, 80) : undefined, touchedPaths };
  }

  if (l.type === 'PLANNER_RESPONSE') {
    t.updatedAt = at;
    const calls = Array.isArray(l.tool_calls) ? l.tool_calls : [];
    if (calls.length > 0) {
      let asking = false;
      for (const tc of calls) {
        const name = String(tc.name ?? 'ferramenta');
        if (name === 'ask_question') asking = true;
        const d = describeAntigravityTool(name, tc.args);
        if (d.filePath) touchedPaths.push(d.filePath);
        t.pendingTools.push({ name, label: d.label, code: d.code });
      }
      if (asking) {
        t.state = 'waiting';
        t.current = 'Pergunta para você';
        t.currentCode = undefined;
        return { changed: true, event: 'waiting', touchedPaths };
      }
      const headline =
        [...t.pendingTools].reverse().find((p) => p.name === 'run_command' || p.name === 'edit_file' || p.name === 'write_file') ??
        t.pendingTools[t.pendingTools.length - 1];
      t.state = 'working';
      t.current = headline?.label ?? 'Trabalhando…';
      t.currentCode = headline?.code;
      return { changed: true, touchedPaths };
    }

    t.pendingTools = [];
    if (l.status === 'ERROR') {
      const msg = truncateText(l.error || firstSentence(l.content) || 'Erro na execução', 120);
      t.state = 'error';
      t.current = 'Parou com erro';
      t.currentCode = undefined;
      t.summary = msg;
      return { changed: true, event: 'error', detail: msg, touchedPaths };
    }
    if (typeof l.content === 'string' && l.content.trim()) {
      const wasDone = t.state === 'done';
      const summary = firstSentence(l.content);
      t.state = 'done';
      t.current = 'Concluído';
      t.currentCode = undefined;
      t.summary = summary;
      return { changed: true, event: wasDone ? undefined : 'done', detail: summary, touchedPaths };
    }
    return { changed: false, touchedPaths };
  }

  if (l.type === 'GENERIC') {
    if (l.status === 'RUNNING') {
      t.updatedAt = at;
      return { changed: false, touchedPaths };
    }
    if (l.status === 'DONE' || l.status === 'ERROR') {
      t.updatedAt = at;
      const finished = t.pendingTools.shift();
      if (finished?.name === 'invoke_subagent' && typeof l.content === 'string') {
        const sub = SUBAGENT_ID_RE.exec(l.content)?.[1];
        if (sub && !t.subagentIds.includes(sub)) t.subagentIds.push(sub);
      }
      t.steps++;
      const ok = l.status !== 'ERROR';
      const label = finished?.label ?? 'Passo';
      t.lastStep = { label: ok ? label : `${label} falhou`, ok };
      if (t.pendingTools.length > 0) {
        const next = t.pendingTools[0];
        t.current = next.label;
        t.currentCode = next.code;
      } else if (t.state === 'working') {
        t.current = 'Analisando resultado';
        t.currentCode = undefined;
      }
      return { changed: true, touchedPaths };
    }
  }

  return { changed: false, touchedPaths };
}

/**
 * Antigravity 2.0 runs a hub daemon (`agy --hub`) that writes
 * ~/.gemini/antigravity/daemon/hub_<port>.json with its local ports and CSRF
 * token; its language server answers GetUserStatus like 1.x did.
 */
export function parseHubFile(text: string): { pid: number; httpPort: number; httpsPort?: number; csrf: string } | null {
  try {
    const h = JSON.parse(text) as Record<string, unknown>;
    const port = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 65536 ? v : undefined);
    const pid = typeof h.pid === 'number' ? h.pid : NaN;
    const httpPort = port(h.httpPort);
    const csrf = typeof h.csrfToken === 'string' ? h.csrfToken : '';
    if (!Number.isInteger(pid) || !httpPort || !csrf) return null;
    return { pid, httpPort, httpsPort: port(h.httpsPort), csrf };
  } catch {
    return null;
  }
}
