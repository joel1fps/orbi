import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hub } from '../hub';
import { antigravityQuotas, busiest, type AntigravityStatus } from './limits';

/**
 * Antigravity quota from the IDE's own language server — the local API the
 * Antigravity window uses to show "remaining quota" per model. Works while
 * Antigravity is open (the last reading stays on screen, with its age, when
 * it closes). Nothing leaves 127.0.0.1. Windows, macOS and Linux.
 */
const POLL_MS = 60_000;
const REDISCOVER_MS = 10 * 60_000;

interface Endpoint {
  port: number;
  csrf: string;
  secure: boolean;
}

let endpoint: Endpoint | null = null;
let discoveredAt = 0;
let lastEmptyDiscovery = 0;
let timer: NodeJS.Timeout | null = null;

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

/** macOS and Linux: `ps` for the process, `lsof` (or `ss` on Linux) for its listening ports. */
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

/** Cheap check before the PowerShell discovery: is any language server running at all? */
async function maybeRunning(): Promise<boolean> {
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
        // The language server's certificate is self-signed and only ever reached on 127.0.0.1.
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

export async function refreshAntigravity(): Promise<void> {
  let status: AntigravityStatus | null = null;
  if (endpoint && Date.now() - discoveredAt < REDISCOVER_MS) status = await getUserStatus(endpoint);
  if (!status) {
    endpoint = null;
    // Not installed for this user: nothing to look for.
    if (!existsSync(join(homedir(), '.gemini', 'antigravity-ide'))) return;
    // The full lookup spawns ps/PowerShell: on Windows a quick tasklist decides whether it's worth it,
    // elsewhere it runs at most every 3 minutes while Antigravity is closed.
    const running = await maybeRunning();
    if (process.platform !== 'win32' && Date.now() - lastEmptyDiscovery < 3 * 60_000) return;
    const servers = running ? await discover() : [];
    if (servers.length === 0) {
      lastEmptyDiscovery = Date.now();
      hub.setLimitNote('antigravity', 'O Antigravity está fechado. Clique em Abrir Antigravity: o Orbi lê a cota de cada modelo pela API local dele.');
      return;
    }
    outer: for (const server of servers) {
      for (const port of server.ports) {
        // Current builds speak plain HTTP on 127.0.0.1; some serve HTTPS with a local certificate.
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
    hub.setLimitNote('antigravity', 'O Antigravity está aberto, mas não respondeu. Atualize-o ou reabra-o.');
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

/** "Abrir Antigravity" from Orbi; its quota shows up as soon as the language server answers. */
export function openAntigravity(): { ok: boolean; message: string } {
  const exe = process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe') : '';
  try {
    const child =
      process.platform === 'win32'
        ? existsSync(exe)
          ? spawn(exe, [], { detached: true, stdio: 'ignore' })
          : spawn('explorer.exe', ['shell:AppsFolder\\Google.AntigravityIDE'], { detached: true, stdio: 'ignore' })
        : spawn(process.platform === 'darwin' ? 'open' : 'antigravity', process.platform === 'darwin' ? ['-a', 'Antigravity'] : [], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    return { ok: false, message: 'Não consegui abrir o Antigravity.' };
  }
  hub.setLimitNote('antigravity', 'Abrindo o Antigravity… a cota aparece assim que ele terminar de carregar.');
  lastEmptyDiscovery = 0;
  for (const ms of [10_000, 20_000, 40_000]) setTimeout(() => void refreshAntigravity(), ms).unref();
  return { ok: true, message: 'Antigravity aberto.' };
}

export function startAntigravity(): void {
  void refreshAntigravity();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void refreshAntigravity(), POLL_MS);
  timer.unref();
}
