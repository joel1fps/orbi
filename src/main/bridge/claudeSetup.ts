import { app } from 'electron';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hub } from '../hub';
import { whichCommand } from '../integrations/detect';
import { dataDir, store } from '../store';
import {
  HOOK_FLAG,
  hooksInstalled,
  MIN_CLAUDE_VERSION,
  needsUpgrade,
  parseVersion,
  stripOrbi,
  versionAtLeast,
  withOrbiHooks,
  type ClaudeSettings,
  type HookTarget,
} from './hookSettings';

/**
 * Connecting Claude Code = adding Orbi's hooks to ~/.claude/settings.json.
 * Each hook runs Orbi's own executable in bridge mode (`--orbi-hook`), so it
 * needs neither Node.js nor a particular shell. Only runs when the user
 * clicks "Conectar"; existing settings are merged (never replaced) and backed
 * up first. Disconnecting removes exactly Orbi's entries.
 */
export const bridgeDir = () => join(dataDir(), 'bridge');
const settingsPath = () => hub.claude.settingsPath;

/** The executable Claude Code should run: the installed Orbi, or Electron + this app in development. */
export function hookTarget(): HookTarget {
  return app.isPackaged
    ? { command: process.execPath, args: [HOOK_FLAG] }
    : { command: process.execPath, args: [app.getAppPath(), HOOK_FLAG] };
}

/** Write the port and token the bridge mode uses to reach this Orbi. */
export function prepareBridge(port: number) {
  const dir = bridgeDir();
  mkdirSync(dir, { recursive: true });
  // Orbi 0.1 copied Node scripts here; hooks now run Orbi itself.
  for (const legacy of ['orbi-hook.cjs', 'orbi-statusline.cjs', 'claude-statusline.json']) rmSync(join(dir, legacy), { force: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ port, token: store.bridgeToken, permissionTimeoutSec: store.settings.permissionTimeoutSec }));
}

function readSettings(): ClaudeSettings {
  if (!existsSync(settingsPath())) return {};
  const raw = readFileSync(settingsPath(), 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as ClaudeSettings; // throws on invalid JSON: never overwrite a file we can't parse
}

function backup() {
  if (!existsSync(settingsPath())) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(settingsPath(), `${settingsPath()}.orbi-backup-${stamp}`);
}

function writeSettings(s: ClaudeSettings) {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  const tmp = settingsPath() + '.orbi-tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
  renameSync(tmp, settingsPath());
}

export function refreshClaudeStatus() {
  try {
    const s = readSettings();
    hub.setClaude({
      hooksInstalled: hooksInstalled(s),
      statuslineInstalled: false,
      statuslineForeign: false,
    });
  } catch {
    hub.setClaude({ hooksInstalled: false, statuslineInstalled: false });
  }
}

/**
 * Keeps an existing connection working across Orbi versions and installs:
 * rewrites only Orbi's own entries when they use the old Node-script format
 * or point to an executable that is gone.
 */
export function upgradeClaudeConnection(): boolean {
  try {
    const s = readSettings();
    if (!needsUpgrade(s, existsSync)) return false;
    backup();
    const wasConnected = hooksInstalled(s);
    writeSettings(wasConnected ? withOrbiHooks(s, hookTarget(), store.settings.permissionTimeoutSec) : stripOrbi(s));
    refreshClaudeStatus();
    return true;
  } catch {
    return false;
  }
}

function claudeVersion(): Promise<number[] | null> {
  return whichCommand('claude').then(
    (bin) =>
      new Promise((resolve) => {
        if (!bin) return resolve(null);
        // npm installs a .cmd shim on Windows, which needs a shell (and quoting for paths with spaces).
        const shim = /\.(cmd|bat)$/i.test(bin);
        execFile(shim ? `"${bin}"` : bin, ['--version'], { timeout: 8000, windowsHide: true, shell: shim }, (err, out) =>
          resolve(err ? null : parseVersion(out)),
        );
      }),
  );
}

export async function connectClaude(): Promise<{ ok: boolean; message: string }> {
  // The terminal CLI is optional (the desktop app bundles its own Claude Code); check it when present.
  const v = await claudeVersion();
  if (v && !versionAtLeast(v, MIN_CLAUDE_VERSION)) {
    return {
      ok: false,
      message: `Seu Claude Code é ${v.join('.')}. O Orbi precisa do ${MIN_CLAUDE_VERSION.join('.')} ou mais novo: rode "claude update" e conecte de novo.`,
    };
  }
  let current: ClaudeSettings;
  try {
    current = readSettings();
  } catch {
    return { ok: false, message: 'O settings.json do Claude Code não é um JSON válido. Corrija o arquivo e tente de novo.' };
  }
  backup();
  writeSettings(withOrbiHooks(current, hookTarget(), store.settings.permissionTimeoutSec));
  refreshClaudeStatus();
  return { ok: true, message: 'Claude Code conectado. Vale para sessões novas ou reiniciadas.' };
}

export function disconnectClaude(): { ok: boolean; message: string } {
  try {
    const s = readSettings();
    backup();
    writeSettings(stripOrbi(s));
    refreshClaudeStatus();
    return { ok: true, message: 'Claude Code desconectado. Suas outras configurações foram mantidas.' };
  } catch {
    return { ok: false, message: 'Não consegui ler o settings.json do Claude Code.' };
  }
}
