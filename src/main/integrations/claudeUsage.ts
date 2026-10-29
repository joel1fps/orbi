import { execFile, spawn } from 'node:child_process';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageWindow } from '@shared/types';
import { hub } from '../hub';
import { store } from '../store';
import { whichCommand } from './detect';
import { parseClaudeUsage } from './limits';

/**
 * Claude plan limits straight from the account — the same request Claude
 * Code's /usage makes — using the login Claude Code keeps on this computer:
 * ~/.claude/.credentials.json on Windows and Linux, the Keychain item
 * "Claude Code-credentials" on macOS. The token is automatically refreshed
 * when needed so limits stay up-to-date even when Claude Code is not running.
 * Can be turned off in Ferramentas.
 */
export const CLAUDE_ACCOUNT_SOURCE = 'Sua conta Claude (login do Claude Code)';
const POLL_MS = 3 * 60_000;
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

let timer: NodeJS.Timeout | null = null;
let soonTimer: NodeJS.Timeout | null = null;
let fileWatcher: FSWatcher | null = null;
let desktopWatcher: FSWatcher | null = null;
let backoffUntil = 0;

interface Login {
  token: string;
  refreshToken?: string;
  scopes?: string[];
  plan?: string;
  expiresAt?: number;
  filePath?: string;
}

function fromJson(text: string, filePath?: string): Login | null {
  try {
    const o = (
      JSON.parse(text) as {
        claudeAiOauth?: {
          accessToken?: string;
          refreshToken?: string;
          scopes?: string[];
          expiresAt?: number;
          subscriptionType?: string;
        };
      }
    ).claudeAiOauth;
    return o?.accessToken
      ? {
          token: o.accessToken,
          refreshToken: o.refreshToken,
          scopes: o.scopes,
          plan: o.subscriptionType,
          expiresAt: o.expiresAt,
          filePath,
        }
      : null;
  } catch {
    return null;
  }
}

function keychain(): Promise<string | null> {
  return new Promise((resolve) => {
    // macOS asks the user once whether Orbi may read this item.
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 15_000 }, (err, out) =>
      resolve(err ? null : out.trim()),
    );
  });
}

export async function readLogin(): Promise<Login | null> {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const file = join(dir, '.credentials.json');
  try {
    const login = fromJson(await fs.readFile(file, 'utf8'), file);
    if (login) return login;
  } catch {
    /* not a file-based login */
  }
  if (process.platform === 'darwin') {
    const text = await keychain();
    return text ? fromJson(text) : null;
  }
  return null;
}

async function refreshClaudeOAuth(login: Login): Promise<boolean> {
  if (!login.refreshToken) return false;
  try {
    const res = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: login.refreshToken,
        client_id: CLAUDE_CLIENT_ID,
        scope: Array.isArray(login.scopes) ? login.scopes.join(' ') : (login.scopes ?? ''),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return false;

    login.token = data.access_token;
    if (data.refresh_token) login.refreshToken = data.refresh_token;
    login.expiresAt = Date.now() + (data.expires_in ?? 28800) * 1000;

    if (login.filePath) {
      try {
        let existing: Record<string, unknown> = {};
        try {
          existing = JSON.parse(await fs.readFile(login.filePath, 'utf8')) as Record<string, unknown>;
        } catch {}
        const oauth = (existing.claudeAiOauth ?? {}) as Record<string, unknown>;
        existing.claudeAiOauth = {
          ...oauth,
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? oauth.refreshToken,
          expiresAt: login.expiresAt,
        };
        const tmp = `${login.filePath}.tmp.${Date.now()}`;
        await fs.writeFile(tmp, JSON.stringify(existing, null, 2), 'utf8');
        await fs.rename(tmp, login.filePath);
      } catch (err) {
        console.error('[orbi] could not save refreshed credentials', err);
      }
    }
    return true;
  } catch (err) {
    console.error('[orbi] claude token refresh error', err);
    return false;
  }
}

interface ClaudeDesktopUsage {
  tool: 'claude';
  plan: string;
  fiveHour?: UsageWindow;
  week?: UsageWindow;
  observedAt: number;
  source: string;
}

export async function readClaudeDesktopUsage(): Promise<ClaudeDesktopUsage | null> {
  const localAppData = process.env.LOCALAPPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local') : '');
  const candidates: string[] = [];
  if (localAppData) {
    const claudeDataDir = join(localAppData, 'Claude-Data');
    try {
      const subdirs = await fs.readdir(claudeDataDir);
      for (const s of subdirs) {
        if (s.startsWith('claude_')) {
          candidates.push(join(claudeDataDir, s, 'plan-usage-history.json'));
        }
      }
    } catch {}
  }
  if (process.platform === 'darwin') {
    candidates.push(join(homedir(), 'Library', 'Application Support', 'Claude', 'plan-usage-history.json'));
  }

  for (const planPath of candidates) {
    try {
      const stat = await fs.stat(planPath);
      const raw = JSON.parse(await fs.readFile(planPath, 'utf8')) as {
        samples?: { t: number; u?: { fh?: number; sd?: number } }[];
      };
      if (raw.samples && raw.samples.length > 0) {
        const latest = raw.samples[raw.samples.length - 1];
        const fiveHour: UsageWindow | undefined =
          typeof latest.u?.fh === 'number'
            ? { usedPercent: Math.min(100, Math.max(0, latest.u.fh)), windowMinutes: 300 }
            : undefined;
        const week: UsageWindow | undefined =
          typeof latest.u?.sd === 'number'
            ? { usedPercent: Math.min(100, Math.max(0, latest.u.sd)), windowMinutes: 10080 }
            : undefined;
        return {
          tool: 'claude',
          plan: 'Pro',
          fiveHour,
          week,
          observedAt: Math.max(latest.t, stat.mtimeMs),
          source: 'App Claude Desktop',
        };
      }
    } catch {}
  }
  return null;
}

const note = (text: string | undefined) => hub.setLimitNote('claude', text);

export async function refreshClaudeUsage(): Promise<void> {
  if (!store.settings.claudeAccountUsage) {
    note('Leitura pela conta desligada em Ferramentas.');
    return;
  }
  if (Date.now() < backoffUntil) return;

  const desktopUsage = await readClaudeDesktopUsage();

  const login = await readLogin();
  if (!login) {
    if (desktopUsage) {
      hub.setUsage(desktopUsage);
      note(undefined);
      return;
    }
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const file = join(dir, '.credentials.json');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; refreshToken?: string } };
      if (parsed.claudeAiOauth && !parsed.claudeAiOauth.accessToken && !parsed.claudeAiOauth.refreshToken) {
        note('O login do Claude expirou. Clique em Conectar conta Claude.');
        return;
      }
    } catch {
      /* credentials file unreadable or not found */
    }

    note('Clique em Conectar conta Claude para ver seus limites ao vivo (Pro ou Max).');
    return;
  }

  // If token is expired or close to expiry (within 2 minutes), proactively refresh it
  if (login.expiresAt && login.expiresAt < Date.now() + 2 * 60_000) {
    const refreshed = await refreshClaudeOAuth(login);
    if (!refreshed) {
      if (desktopUsage) {
        hub.setUsage(desktopUsage);
        note(undefined);
        return;
      }
      note('O login do Claude expirou. Clique em Conectar conta Claude.');
      return;
    }
  }

  const queryUsage = (token: string) =>
    fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'orbi-desktop',
      },
      signal: AbortSignal.timeout(12_000),
    });

  try {
    let res = await queryUsage(login.token);
    if (res.status === 401 && login.refreshToken) {
      const refreshed = await refreshClaudeOAuth(login);
      if (refreshed) {
        res = await queryUsage(login.token);
      }
    }

    if (res.status === 429) {
      backoffUntil = Date.now() + 10 * 60_000;
      if (desktopUsage) hub.setUsage(desktopUsage);
      return;
    }
    if (res.status === 401 || res.status === 403) {
      if (desktopUsage) {
        hub.setUsage(desktopUsage);
        note(undefined);
        return;
      }
      note('A Anthropic recusou o login. Clique em Conectar conta Claude para entrar de novo.');
      return;
    }
    if (!res.ok) {
      if (desktopUsage) {
        hub.setUsage(desktopUsage);
        note(undefined);
        return;
      }
      note(`A Anthropic respondeu ${res.status}. O Orbi tenta de novo em alguns minutos.`);
      return;
    }
    const { fiveHour, week } = parseClaudeUsage(await res.json());
    if (!fiveHour && !week) {
      if (desktopUsage) {
        hub.setUsage(desktopUsage);
        note(undefined);
        return;
      }
      note('Sua conta não informou limites de plano (contas de equipe ou de API podem não ter).');
      return;
    }
    hub.setUsage({ tool: 'claude', plan: login.plan, fiveHour, week, observedAt: Date.now(), source: CLAUDE_ACCOUNT_SOURCE });
  } catch {
    if (desktopUsage) {
      hub.setUsage(desktopUsage);
      note(undefined);
      return;
    }
    note('Sem conexão com a Anthropic agora. O Orbi tenta de novo em alguns minutos.');
  }
}

/**
 * "Conectar conta Claude": opens Claude Code's own sign-in (`claude auth login`,
 * which continues in the browser) in a console window. Orbi never sees the
 * password; once the login lands in .credentials.json the watcher below picks it up.
 */
export async function loginClaudeAccount(): Promise<{ ok: boolean; message: string }> {
  const exe = await whichCommand('claude');
  if (!exe) return { ok: false, message: 'Claude Code não encontrado. Instale o Claude Code para conectar sua conta.' };
  try {
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/c', 'start', 'Orbi - Conectar conta Claude', exe, 'auth', 'login'], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(exe, ['auth', 'login'], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    return { ok: false, message: 'Não consegui abrir o login do Claude.' };
  }
  backoffUntil = 0;
  note('Termine o login na janela que abriu (ela continua no navegador). O Orbi atualiza sozinho.');
  return { ok: true, message: 'Login do Claude aberto.' };
}

/** Refresh shortly after Claude finishes something, so the counter follows real use. */
export function refreshClaudeUsageSoon() {
  if (soonTimer) return;
  soonTimer = setTimeout(() => {
    soonTimer = null;
    void refreshClaudeUsage();
  }, 15_000);
}

export function startClaudeUsage(): void {
  void refreshClaudeUsage();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void refreshClaudeUsage(), POLL_MS);
  timer.unref();

  // Watch the .claude directory for changes so login is picked up immediately
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    if (!fileWatcher) {
      fileWatcher = watch(dir, (_event, filename) => {
        if (!filename || filename.includes('.credentials.json')) {
          if (soonTimer) clearTimeout(soonTimer);
          soonTimer = setTimeout(() => void refreshClaudeUsage(), 1000);
        }
      });
      fileWatcher.unref();
    }
  } catch (err) {
    console.error('[orbi] could not watch claude directory', err);
  }

  // Watch Claude Desktop App data directory
  try {
    const localAppData = process.env.LOCALAPPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local') : '');
    if (localAppData) {
      const claudeDataDir = join(localAppData, 'Claude-Data');
      if (!desktopWatcher) {
        desktopWatcher = watch(claudeDataDir, { recursive: true }, (_event, filename) => {
          if (!filename || filename.includes('plan-usage-history') || filename.includes('buddy-tokens')) {
            if (soonTimer) clearTimeout(soonTimer);
            soonTimer = setTimeout(() => void refreshClaudeUsage(), 1000);
          }
        });
        desktopWatcher.unref();
      }
    }
  } catch (err) {
    console.error('[orbi] could not watch claude desktop directory', err);
  }
}
