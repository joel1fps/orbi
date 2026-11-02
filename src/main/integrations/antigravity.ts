import { execFile, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basename, truncate } from '@shared/tools';
import type { AgyHookEvent } from '../bridge/antigravityHookSettings';
import { hub } from '../hub';
import { commandPaths } from './detect';
import {
  applyAntigravityTranscriptLine,
  cleanUserPrompt,
  createAgyTracker,
  type AgySessionTracker,
  type AgyTranscriptLine,
} from './antigravityTranscript';
import { parseLines, readBytes } from './files';
import { antigravityQuotas, busiest, type AntigravityStatus } from './limits';

/**
 * Antigravity 2.0 (IDE, Desktop App and `agy` CLI) + legacy 1.x quota fallback:
 *
 * 1. Global hooks (`~/.gemini/config/hooks.json`, opt-in via "Conectar") push
 *    instant `SessionStart`, `PreInvocation` and `Stop` events with exact
 *    `workspacePaths` and `transcriptPath`.
 * 2. Passive transcript tailing (`~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl`
 *    and `antigravity-cli`) works out of the box with zero setup and streams
 *    every tool call, step count, completion summary and error as new bytes land.
 * 3. Legacy 1.x language-server `GetUserStatus` quota remains active whenever a
 *    1.x `language_server` process is present.
 */

const geminiRoot = () => join(homedir(), '.gemini');
const BRAIN_ROOTS = () => [
  join(geminiRoot(), 'antigravity', 'brain'),
  join(geminiRoot(), 'antigravity-cli', 'brain'),
  join(geminiRoot(), 'antigravity-ide', 'brain'),
];

const HOT_WINDOW_MS = 60 * 60_000;
const STALE_WORKING_MS = 3 * 60_000;
const INITIAL_TAIL_BYTES = 512 * 1024;
const DISCOVER_MS = 8_000;
const POLL_MS = 1_500;
const QUOTA_POLL_MS = 60_000;
const REDISCOVER_MS = 10 * 60_000;

// ===================================================================
// Known workspace resolution (~/.gemini/config/projects/*.json + repo walk)
// ===================================================================

interface KnownProject {
  name: string;
  path: string;
  normLower: string;
}

let cachedProjects: KnownProject[] = [];
let projectsLoadedAt = 0;
const repoRootCache = new Map<string, string | null>();

const normForMatch = (p: string) => {
  const n = normalize(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n.toLowerCase() : n;
};

async function loadKnownProjects(): Promise<KnownProject[]> {
  if (Date.now() - projectsLoadedAt < 30_000) return cachedProjects;
  projectsLoadedAt = Date.now();
  const dir = join(geminiRoot(), 'config', 'projects');
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return cachedProjects;
  }
  const next: KnownProject[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await fs.readFile(join(dir, f), 'utf8')) as {
        name?: string;
        projectResources?: { resources?: { folderUri?: string }[] };
      };
      for (const r of raw.projectResources?.resources ?? []) {
        if (!r.folderUri?.startsWith('file:')) continue;
        const folderPath = fileURLToPath(r.folderUri);
        next.push({
          name: raw.name || basename(folderPath) || 'projeto',
          path: folderPath,
          normLower: normForMatch(folderPath),
        });
      }
    } catch {
      /* ignore malformed entry */
    }
  }
  // Most specific (deepest) workspace path wins.
  next.sort((a, b) => b.normLower.length - a.normLower.length);
  cachedProjects = next;
  return cachedProjects;
}

function findRepoRoot(filePath: string): string | null {
  const startDir = dirname(normalize(filePath));
  if (repoRootCache.has(startDir)) return repoRootCache.get(startDir) ?? null;
  let cur = startDir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cur, '.git')) || existsSync(join(cur, 'package.json')) || existsSync(join(cur, 'pyproject.toml'))) {
      repoRootCache.set(startDir, cur);
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  repoRootCache.set(startDir, null);
  return null;
}

async function inferWorkspace(filePaths: string[]): Promise<{ cwd: string; project: string } | null> {
  if (filePaths.length === 0) return null;
  const gemNorm = normForMatch(geminiRoot());
  const tmpNorm = normForMatch(tmpdir());
  const projects = await loadKnownProjects();

  for (const raw of filePaths) {
    const n = normForMatch(raw);
    if (!n || n.startsWith(gemNorm + sep) || n === gemNorm || n.startsWith(tmpNorm + sep)) continue;
    for (const p of projects) {
      if (n === p.normLower || n.startsWith(p.normLower + sep)) {
        return { cwd: p.path, project: p.name };
      }
    }
    const root = findRepoRoot(raw);
    if (root) return { cwd: root, project: basename(root) || 'projeto' };
  }
  return null;
}

// ===================================================================
// Live Transcript Watcher & Global Hook Handler
// ===================================================================

interface WatchedTranscript {
  path: string;
  offset: number;
  mtime: number;
  tracker: AgySessionTracker;
  hookSource?: boolean;
  /** Last file (not folder) a tool call touched, for the live session window. */
  lastFile?: string;
}

const watched = new Map<string, WatchedTranscript>();
const knownSubagents = new Set<string>();
/** Turn-level toast deduplication so Hooks + Transcript never double-fire. */
const lastToast = new Map<string, { kind: 'start' | 'done' | 'error' | 'waiting'; at: number }>();

function emitDedupe(
  sessionId: string,
  kind: 'start' | 'done' | 'error' | 'waiting',
  payload: { title: string; detail?: string; project: string },
) {
  const now = Date.now();
  const prev = lastToast.get(sessionId);
  if (prev && prev.kind === kind && now - prev.at < 20_000) return;
  if (prev && (kind === 'done' || kind === 'error') && (prev.kind === 'done' || prev.kind === 'error') && now - prev.at < 60_000) return;
  lastToast.set(sessionId, { kind, at: now });
  hub.event({
    kind,
    tool: 'antigravity',
    title: payload.title,
    detail: payload.detail,
    project: payload.project,
    sessionId,
  });
}

function publishTracker(w: WatchedTranscript, silent: boolean, pendingEvent?: { kind: 'start' | 'done' | 'error' | 'waiting'; detail?: string }) {
  const t = w.tracker;
  if (knownSubagents.has(t.sessionId)) {
    hub.removeSession(t.sessionId);
    return;
  }
  const age = Date.now() - t.updatedAt;
  if (silent && t.state === 'working' && age > STALE_WORKING_MS) return;

  const project = t.project || 'Antigravity';
  hub.upsertSession(t.sessionId, {
    tool: 'antigravity',
    source: w.hookSource ? 'hooks' : 'transcript',
    project,
    cwd: t.cwd,
    state: t.state,
    current: t.current,
    currentCode: t.currentCode,
    ...(w.lastFile ? { file: w.lastFile } : {}),
    steps: t.steps,
    lastStep: t.lastStep,
    summary: t.summary,
    startedAt: t.startedAt,
    updatedAt: t.updatedAt,
  });

  if (silent || !pendingEvent) return;
  switch (pendingEvent.kind) {
    case 'start':
      emitDedupe(t.sessionId, 'start', { title: `Nova tarefa em ${project}`, detail: pendingEvent.detail, project });
      break;
    case 'waiting':
      emitDedupe(t.sessionId, 'waiting', { title: 'Antigravity aguarda você', detail: project, project });
      break;
    case 'done':
      emitDedupe(t.sessionId, 'done', { title: `Antigravity terminou em ${project}`, detail: pendingEvent.detail, project });
      break;
    case 'error':
      emitDedupe(t.sessionId, 'error', { title: 'Antigravity parou com erro', detail: pendingEvent.detail, project });
      break;
  }
}

async function consumeTranscript(w: WatchedTranscript, start: number, end: number, silent: boolean) {
  if (end <= start) return;
  const aligned = start === 0 || start === w.offset;
  const buf = await readBytes(w.path, start, end);
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < 0) return;
  w.offset = start + lastNl + 1;
  let text = buf.subarray(0, lastNl + 1).toString('utf8');
  if (!aligned) {
    const firstNl = text.indexOf('\n');
    if (firstNl < 0) return;
    text = text.slice(firstNl + 1);
  }

  let changed = false;
  let latestEvent: { kind: 'start' | 'done' | 'error' | 'waiting'; detail?: string } | undefined;
  const touched: string[] = [];

  for (const line of parseLines<AgyTranscriptLine>(text)) {
    const effect = applyAntigravityTranscriptLine(w.tracker, line, w.mtime || Date.now());
    if (effect.changed) changed = true;
    if (effect.event) latestEvent = { kind: effect.event, detail: effect.detail };
    for (const p of effect.touchedPaths) {
      touched.push(p);
      if (/\.[A-Za-z0-9]{1,8}$/.test(p)) w.lastFile = p;
    }
    for (const sub of w.tracker.subagentIds) {
      knownSubagents.add(sub);
      hub.removeSession(sub);
    }
  }

  if (!w.tracker.cwd && touched.length > 0) {
    const ws = await inferWorkspace(touched);
    if (ws) {
      w.tracker.cwd = ws.cwd;
      w.tracker.project = ws.project;
      changed = true;
    }
  }

  if (changed) publishTracker(w, silent, latestEvent);
}

async function ensureWatched(sessionId: string, transcriptPath: string, initial: boolean): Promise<WatchedTranscript | null> {
  let w = watched.get(sessionId);
  try {
    const st = await fs.stat(transcriptPath);
    if (!w) {
      w = {
        path: transcriptPath,
        offset: 0,
        mtime: st.mtimeMs,
        tracker: createAgyTracker(sessionId, st.mtimeMs),
      };
      watched.set(sessionId, w);
      const start = Math.max(0, st.size - INITIAL_TAIL_BYTES);
      await consumeTranscript(w, start, st.size, initial);
    } else {
      w.path = transcriptPath;
      if (st.size < w.offset) w.offset = 0; // truncated/rewritten
      if (st.size > w.offset) await consumeTranscript(w, w.offset, st.size, false);
      w.mtime = st.mtimeMs;
    }
    return w;
  } catch {
    return w ?? null;
  }
}

async function discoverTranscripts(initial: boolean) {
  const now = Date.now();
  for (const brainDir of BRAIN_ROOTS()) {
    let ids: string[];
    try {
      ids = await fs.readdir(brainDir);
    } catch {
      continue;
    }
    for (const id of ids) {
      if (knownSubagents.has(id) || watched.has(id)) continue;
      const tPath = join(brainDir, id, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const st = await fs.stat(tPath);
        if (now - st.mtimeMs > HOT_WINDOW_MS) continue;
        await ensureWatched(id, tPath, initial);
      } catch {
        /* conversation without transcript yet */
      }
    }
  }
}

async function pollTranscripts() {
  const now = Date.now();
  for (const [id, w] of watched) {
    if (knownSubagents.has(id)) {
      watched.delete(id);
      hub.removeSession(id);
      continue;
    }
    try {
      const st = await fs.stat(w.path);
      if (st.size < w.offset) w.offset = 0;
      if (st.size > w.offset) await consumeTranscript(w, w.offset, st.size, false);
      w.mtime = st.mtimeMs;
      if (now - st.mtimeMs > HOT_WINDOW_MS) watched.delete(id);
    } catch {
      if (now - w.mtime > HOT_WINDOW_MS) watched.delete(id);
    }
  }
}

export interface AntigravityHookPayload {
  conversationId?: string;
  workspacePaths?: string[];
  transcriptPath?: string;
  artifactDirectoryPath?: string;
  modelName?: string;
  lastUserInput?: string;
  invocationNum?: number;
  terminationReason?: string;
  error?: string;
  fullyIdle?: boolean;
}

export async function handleAntigravityHook(event: AgyHookEvent, p: AntigravityHookPayload): Promise<void> {
  const id = p.conversationId;
  if (!id || knownSubagents.has(id)) return;
  const now = Date.now();
  hub.setAntigravity({ lastHookAt: now });

  const cwd = Array.isArray(p.workspacePaths) && typeof p.workspacePaths[0] === 'string' ? p.workspacePaths[0] : undefined;
  const project = basename(cwd) || undefined;

  let w = watched.get(id);
  if (!w) {
    const tPath =
      p.transcriptPath ||
      join(geminiRoot(), 'antigravity', 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
    w = {
      path: tPath,
      offset: 0,
      mtime: now,
      tracker: createAgyTracker(id, now),
      hookSource: true,
    };
    watched.set(id, w);
  }
  w.hookSource = true;
  if (p.transcriptPath) w.path = p.transcriptPath;
  if (cwd) w.tracker.cwd = cwd;
  if (project) w.tracker.project = project;

  const resolvedProject = w.tracker.project || 'Antigravity';

  if (event === 'SessionStart') {
    w.tracker.state = 'idle';
    w.tracker.current = 'Sessão aberta';
    w.tracker.updatedAt = now;
    publishTracker(w, true);
    return;
  }

  if (event === 'PreInvocation') {
    const isTurnStart = (p.invocationNum ?? 1) <= 1 || (w.tracker.state !== 'working' && w.tracker.state !== 'waiting');
    w.tracker.updatedAt = now;
    w.tracker.state = 'working';
    if (isTurnStart) {
      w.tracker.startedAt = now;
      w.tracker.steps = 0;
      w.tracker.lastStep = undefined;
      w.tracker.summary = undefined;
      w.tracker.pendingTools = [];
      w.tracker.current = 'Pensando…';
      w.tracker.currentCode = undefined;
      const prompt = cleanUserPrompt(p.lastUserInput);
      publishTracker(w, false, { kind: 'start', detail: prompt ? truncate(prompt, 80) : undefined });
    } else {
      w.tracker.current = 'Pensando…';
      w.tracker.currentCode = undefined;
      publishTracker(w, true);
    }
    return;
  }

  if (event === 'Stop') {
    // Pull any newly written final response from transcript.jsonl first so we have the summary.
    await ensureWatched(id, w.path, true);
    w.tracker.updatedAt = now;
    w.tracker.pendingTools = [];
    w.tracker.currentCode = undefined;

    if (p.terminationReason === 'ERROR' || (p.error && p.error.trim())) {
      const detail = truncate(p.error || w.tracker.summary || 'Erro na execução', 120);
      w.tracker.state = 'error';
      w.tracker.current = 'Parou com erro';
      w.tracker.summary = detail;
      publishTracker(w, false, { kind: 'error', detail });
    } else if (p.terminationReason === 'USER_CANCELED') {
      w.tracker.state = 'idle';
      w.tracker.current = 'Interrompido';
      publishTracker(w, true);
    } else {
      w.tracker.state = 'done';
      w.tracker.current = 'Concluído';
      publishTracker(w, false, { kind: 'done', detail: w.tracker.summary });
      // Ensure the toast fires even if consumeTranscript above ran with silent=true:
      emitDedupe(id, 'done', { title: `Antigravity terminou em ${resolvedProject}`, detail: w.tracker.summary, project: resolvedProject });
    }
    void refreshAntigravity();
  }
}

// ===================================================================
// Legacy 1.x language-server quota fallback (only when language_server runs)
// ===================================================================

interface Endpoint {
  port: number;
  csrf: string;
  secure: boolean;
}

let endpoint: Endpoint | null = null;
let discoveredAt = 0;
let lastEmptyDiscovery = 0;
let quotaTimer: NodeJS.Timeout | null = null;
let watcherStarted = false;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out));
  });
}

interface Server {
  csrf: string;
  ports: number[];
}

const csrfOf = (cmd: string) => /--csrf_token[ =](\S+)/.exec(cmd)?.[1] ?? '';

async function discoverWindows(): Promise<Server[]> {
  const out = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name like 'language_server%'\" | Where-Object { $_.CommandLine -match 'antigravity' } | " +
      'ForEach-Object { [pscustomobject]@{ cmd = $_.CommandLine; ports = @((Get-NetTCPConnection -OwningProcess $_.ProcessId -State Listen -ErrorAction SilentlyContinue).LocalPort) } } | ConvertTo-Json -Compress -Depth 3',
  ]);
  if (!out.trim()) return [];
  try {
    const parsed = JSON.parse(out) as { cmd: string; ports: number[] | number } | { cmd: string; ports: number[] | number }[];
    return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ csrf: csrfOf(p.cmd), ports: ([] as number[]).concat(p.ports ?? []) }));
  } catch {
    return [];
  }
}

async function discoverUnix(): Promise<Server[]> {
  const ps = await run('ps', ['-axo', 'pid=,command=']);
  const servers: Server[] = [];
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m || !/language_server/.test(m[2]) || !/antigravity/i.test(m[2])) continue;
    const pid = m[1];
    let ports: number[] = [];
    const lsof = await run('lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', pid]);
    for (const l of lsof.split('\n')) {
      const pm = /:(\d+) \(LISTEN\)/.exec(l);
      if (pm) ports.push(Number(pm[1]));
    }
    if (ports.length === 0 && process.platform === 'linux') {
      const ss = await run('ss', ['-ltnpH']);
      ports = ss
        .split('\n')
        .filter((l) => l.includes(`pid=${pid},`))
        .map((l) => Number(/:(\d+)\s/.exec(l)?.[1]))
        .filter(Boolean);
    }
    servers.push({ csrf: csrfOf(m[2]), ports });
  }
  return servers;
}

async function maybeLegacyServerRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return true;
  const out = await run('tasklist.exe', ['/FI', 'IMAGENAME eq language_server*', '/NH', '/FO', 'CSV']);
  return /language_server/i.test(out);
}

async function discover(): Promise<Server[]> {
  const list = process.platform === 'win32' ? await discoverWindows() : await discoverUnix();
  return list.filter((s) => s.csrf && s.ports.length);
}

function getUserStatus(ep: Endpoint): Promise<AntigravityStatus | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'pt-BR' } });
    const req = (ep.secure ? httpsRequest : httpRequest)(
      {
        host: '127.0.0.1',
        port: ep.port,
        path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        method: 'POST',
        timeout: 4000,
        rejectUnauthorized: false,
        headers: { 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-codeium-csrf-token': ep.csrf },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(data) as AntigravityStatus);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end(body);
  });
}

const hasAntigravity2 = () =>
  existsSync(join(geminiRoot(), 'antigravity')) ||
  existsSync(join(geminiRoot(), 'antigravity-cli')) ||
  existsSync(join(geminiRoot(), 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy'));

export async function refreshAntigravity(): Promise<void> {
  const v2 = hasAntigravity2();
  const hasLegacyDir = existsSync(join(geminiRoot(), 'antigravity-ide', 'conversations'));

  let status: AntigravityStatus | null = null;
  if (endpoint && Date.now() - discoveredAt < REDISCOVER_MS) status = await getUserStatus(endpoint);
  if (!status) {
    endpoint = null;
    if (!v2 && !hasLegacyDir) return;
    const running = await maybeLegacyServerRunning();
    if (!running) {
      // Antigravity 2.0 no longer spawns `language_server`; avoid false "Antigravity is closed" notes.
      if (v2) hub.setLimitNote('antigravity', undefined);
      else hub.setLimitNote('antigravity', 'O Antigravity está fechado. Clique em Abrir Antigravity: o Orbi lê a cota de cada modelo pela API local dele.');
      return;
    }
    if (process.platform !== 'win32' && Date.now() - lastEmptyDiscovery < 3 * 60_000) return;
    const servers = await discover();
    if (servers.length === 0) {
      lastEmptyDiscovery = Date.now();
      if (v2) hub.setLimitNote('antigravity', undefined);
      else hub.setLimitNote('antigravity', 'O Antigravity está fechado. Clique em Abrir Antigravity: o Orbi lê a cota de cada modelo pela API local dele.');
      return;
    }
    outer: for (const server of servers) {
      for (const port of server.ports) {
        for (const secure of [false, true]) {
          const ep = { port, csrf: server.csrf, secure };
          status = await getUserStatus(ep);
          if (status) {
            endpoint = ep;
            discoveredAt = Date.now();
            break outer;
          }
        }
      }
    }
  }
  if (!status) {
    if (!v2) hub.setLimitNote('antigravity', 'O Antigravity está aberto, mas não respondeu. Atualize-o ou reabra-o.');
    return;
  }
  const models = antigravityQuotas(status);
  const top = busiest(models);
  if (!top) {
    hub.setLimitNote('antigravity', 'O Antigravity não informou cotas para os modelos desta conta.');
    return;
  }
  hub.setUsage({
    tool: 'antigravity',
    plan: status.userStatus?.planStatus?.planInfo?.planName,
    models,
    fiveHour: { usedPercent: top.usedPercent, resetsAt: top.resetsAt },
    observedAt: Date.now(),
    source: 'API local do Antigravity',
  });
}

/** Launch Antigravity IDE / App 2.0 (or `agy` CLI fallback). */
export function openAntigravity(): { ok: boolean; message: string } {
  const exe = process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe') : '';
  const agy = commandPaths.agy ?? join(geminiRoot(), 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy');
  try {
    const child =
      process.platform === 'win32'
        ? existsSync(exe)
          ? spawn(exe, [], { detached: true, stdio: 'ignore' })
          : existsSync(agy)
            ? spawn('cmd.exe', ['/d', '/c', 'start', 'Antigravity', agy], { detached: true, stdio: 'ignore', windowsHide: true })
            : spawn('explorer.exe', ['shell:AppsFolder\\Google.AntigravityIDE'], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', ['-a', 'Antigravity'], { detached: true, stdio: 'ignore' })
          : spawn(commandPaths.antigravity ?? (existsSync(agy) ? agy : 'antigravity'), [], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    return { ok: false, message: 'Não consegui abrir o Antigravity.' };
  }
  lastEmptyDiscovery = 0;
  for (const ms of [10_000, 20_000, 40_000]) setTimeout(() => void refreshAntigravity(), ms).unref();
  return { ok: true, message: 'Antigravity aberto.' };
}

export function startAntigravity(): void {
  if (!watcherStarted) {
    watcherStarted = true;
    void discoverTranscripts(true);
    setInterval(() => void discoverTranscripts(false), DISCOVER_MS).unref();
    setInterval(() => void pollTranscripts(), POLL_MS).unref();
  }
  void refreshAntigravity();
  if (quotaTimer) clearInterval(quotaTimer);
  quotaTimer = setInterval(() => void refreshAntigravity(), QUOTA_POLL_MS);
  quotaTimer.unref();
}
