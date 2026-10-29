import { promises as fs, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { hub } from '../hub';
import { whichCommand } from './detect';
import { busiest, geminiQuotas, type GeminiQuotaResponse } from './limits';

/**
 * Gemini CLI quota per model, from the same Code Assist service the CLI
 * uses, with the Google login the CLI saved in ~/.gemini/oauth_creds.json.
 * If that access token expired, it is renewed in memory only (Google refresh
 * tokens are not rotated, so the CLI's own login keeps working) using the
 * OAuth client that ships inside the installed Gemini CLI.
 */
const POLL_MS = 5 * 60_000;
const CODE_ASSIST = 'https://cloudcode-pa.googleapis.com/v1internal';
const geminiDir = () => join(homedir(), '.gemini');

let timer: NodeJS.Timeout | null = null;
let memToken: { token: string; expiresAt: number } | null = null;
let project: string | undefined;
let tier: string | undefined;

const note = (text: string | undefined) => hub.setLimitNote('gemini', text);

interface Creds {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Find OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET inside the installed Gemini CLI. */
async function cliOAuthClient(): Promise<{ id: string; secret: string } | null> {
  const bin = await whichCommand('gemini');
  if (!bin) return null;
  let dir: string;
  try {
    dir = dirname(realpathSync(bin));
  } catch {
    dir = dirname(bin);
  }
  // npm (Windows shim next to node_modules), Homebrew / Unix symlink into the package, or Bun.
  const roots = [
    join(dir, 'node_modules', '@google', 'gemini-cli'),
    join(dir, '..', 'lib', 'node_modules', '@google', 'gemini-cli'),
    join(dir, '..'),
    join(dir, '..', '..'),
  ];
  const files: string[] = [];
  for (const r of roots) {
    files.push(
      join(r, 'bundle', 'gemini.js'),
      join(r, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'code_assist', 'oauth2.js'),
      join(r, '..', 'gemini-cli-core', 'dist', 'src', 'code_assist', 'oauth2.js'),
    );
  }
  for (const f of files) {
    try {
      const text = await fs.readFile(f, 'utf8');
      const id = /OAUTH_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1];
      const secret = /OAUTH_CLIENT_SECRET\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1];
      if (id && secret) return { id, secret };
    } catch {
      /* try the next layout */
    }
  }
  return null;
}

async function accessToken(creds: Creds): Promise<string | null> {
  const soon = Date.now() + 60_000;
  if (creds.access_token && (creds.expiry_date ?? 0) > soon) return creds.access_token;
  if (memToken && memToken.expiresAt > soon) return memToken.token;
  if (!creds.refresh_token) return null;
  const client = await cliOAuthClient();
  if (!client) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: creds.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  memToken = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3000) * 1000 };
  return memToken.token;
}

async function codeAssist<T>(method: string, token: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${CODE_ASSIST}:${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'orbi-desktop' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

const TIER_NAME: Record<string, string> = { 'free-tier': 'Gratuito', 'standard-tier': 'Pago', 'legacy-tier': 'Legado' };

export async function refreshGeminiQuota(): Promise<void> {
  const creds = await readJson<Creds>(join(geminiDir(), 'oauth_creds.json'));
  if (!creds) {
    // Only speak up for people who actually use the Gemini CLI.
    if (await whichCommand('gemini')) note('Entre no Gemini CLI com sua conta Google para ver a cota.');
    return;
  }
  const settings = await readJson<{ security?: { auth?: { selectedType?: string } }; selectedAuthType?: string }>(join(geminiDir(), 'settings.json'));
  const auth = settings?.security?.auth?.selectedType ?? settings?.selectedAuthType;
  if (auth && auth !== 'oauth-personal') {
    note('O Gemini CLI está usando chave de API ou Vertex AI; a cota fica no console do Google.');
    return;
  }
  const token = await accessToken(creds);
  if (!token) {
    note('O login do Gemini CLI expirou. Abra o Gemini CLI uma vez para renová-lo.');
    return;
  }
  if (!project) {
    const load = await codeAssist<{ cloudaicompanionProject?: string | { id?: string }; currentTier?: { id?: string } }>('loadCodeAssist', token, {
      cloudaicompanionProject: process.env.GOOGLE_CLOUD_PROJECT,
      metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI', duetProject: process.env.GOOGLE_CLOUD_PROJECT },
    });
    const p = load?.cloudaicompanionProject;
    project = typeof p === 'string' ? p : p?.id;
    tier = load?.currentTier?.id;
  }
  const quota = await codeAssist<GeminiQuotaResponse>('retrieveUserQuota', token, project ? { project } : {});
  if (!quota) {
    note('O Google não respondeu à consulta de cota agora. O Orbi tenta de novo em alguns minutos.');
    return;
  }
  const models = geminiQuotas(quota);
  const top = busiest(models);
  if (!top) {
    note('Sua conta do Gemini CLI não informou cotas por modelo.');
    return;
  }
  hub.setUsage({
    tool: 'gemini',
    plan: tier ? (TIER_NAME[tier] ?? tier) : undefined,
    models,
    fiveHour: { usedPercent: top.usedPercent, resetsAt: top.resetsAt },
    observedAt: Date.now(),
    source: 'Sua conta Google no Gemini CLI',
  });
}

export function startGeminiQuota(): void {
  void refreshGeminiQuota().catch(() => undefined);
  if (timer) clearInterval(timer);
  timer = setInterval(() => void refreshGeminiQuota().catch(() => undefined), POLL_MS);
  timer.unref();
}
