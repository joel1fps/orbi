import { spawn } from 'node:child_process';
import { existsSync, promises as fs, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hub } from '../hub';
import { whichCommand } from './detect';
import { parseCodexUsage, type CodexUsageResponse } from './limits';

/**
 * Codex plan limits straight from the ChatGPT account — the same request the
 * Codex app makes for its usage panel — with the login Codex keeps in
 * ~/.codex/auth.json. Orbi only reads that file (Codex itself renews the
 * token), so it never interferes with the Codex login. The session files
 * (codex.ts) stay as the fallback when this isn't available.
 */
export const CODEX_ACCOUNT_SOURCE = 'Sua conta ChatGPT (login do Codex)';
const POLL_MS = 3 * 60_000;
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
/** Microsoft Store package of the Codex app. */
const CODEX_APP = 'shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App';

const codexDir = () => process.env.CODEX_HOME || join(homedir(), '.codex');
let timer: NodeJS.Timeout | null = null;
let soonTimer: NodeJS.Timeout | null = null;
let watcher: FSWatcher | null = null;
let backoffUntil = 0;

const note = (text: string | undefined) => hub.setLimitNote('codex', text);

interface Auth {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: { access_token?: string; account_id?: string };
}

export async function refreshCodexUsage(): Promise<void> {
  if (Date.now() < backoffUntil) return;
  let auth: Auth;
  try {
    auth = JSON.parse(await fs.readFile(join(codexDir(), 'auth.json'), 'utf8')) as Auth;
  } catch {
    return; // never signed in: the session files (or nothing) speak for Codex
  }
  const token = auth.tokens?.access_token;
  if (!token) {
    if (auth.OPENAI_API_KEY) note('O Codex usa chave de API: os limites de plano só existem com login do ChatGPT.');
    return;
  }
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(auth.tokens?.account_id ? { 'ChatGPT-Account-Id': auth.tokens.account_id } : {}),
        'User-Agent': 'orbi-desktop',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 429) {
      backoffUntil = Date.now() + 10 * 60_000;
      return;
    }
    if (res.status === 401 || res.status === 403) {
      note('O login do Codex expirou. Clique em Conectar Codex para renovar.');
      return;
    }
    if (!res.ok) return;
    const { plan, fiveHour, week } = parseCodexUsage((await res.json()) as CodexUsageResponse);
    if (!fiveHour && !week) return;
    hub.setUsage({ tool: 'codex', plan, fiveHour, week, observedAt: Date.now(), source: CODEX_ACCOUNT_SOURCE });
  } catch {
    /* offline: try again on the next tick */
  }
}

/** Refresh shortly after a Codex turn ends, so the counter follows real use. */
export function refreshCodexUsageSoon() {
  if (soonTimer) return;
  soonTimer = setTimeout(() => {
    soonTimer = null;
    void refreshCodexUsage();
  }, 10_000);
}

/**
 * "Conectar Codex": opens the Codex app (it renews or asks for the ChatGPT
 * login itself), else the CLI's `codex login`. The new login lands in
 * auth.json and the watcher below picks it up.
 */
export async function connectCodex(): Promise<{ ok: boolean; message: string }> {
  backoffUntil = 0;
  const cli = await whichCommand('codex');
  try {
    const child =
      process.platform === 'win32' && !cli
        ? spawn('explorer.exe', [CODEX_APP], { detached: true, stdio: 'ignore' })
        : process.platform === 'win32'
          ? spawn('cmd.exe', ['/d', '/c', 'start', 'Orbi - Conectar Codex', cli!, 'login'], { detached: true, stdio: 'ignore', windowsHide: true })
          : spawn(cli ?? 'codex', ['login'], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    return { ok: false, message: 'Não consegui abrir o Codex.' };
  }
  note('Entre com sua conta ChatGPT no Codex que abriu. O Orbi atualiza sozinho.');
  return { ok: true, message: 'Codex aberto.' };
}

export function startCodexUsage(): void {
  void refreshCodexUsage();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void refreshCodexUsage(), POLL_MS);
  timer.unref();
  const dir = codexDir();
  if (!watcher && existsSync(dir)) {
    try {
      watcher = watch(dir, (_e, name) => {
        if (name && name !== 'auth.json') return;
        if (soonTimer) clearTimeout(soonTimer);
        soonTimer = setTimeout(() => {
          soonTimer = null;
          void refreshCodexUsage();
        }, 1000);
      });
      watcher.unref();
    } catch {
      /* polling still works */
    }
  }
}
