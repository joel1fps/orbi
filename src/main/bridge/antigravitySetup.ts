import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { hub } from '../hub';
import {
  antigravityHooksInstalled,
  needsAntigravityUpgrade,
  stripAntigravityOrbi,
  withAntigravityHooks,
  type AgyHookTarget,
  type AntigravityHooksDoc,
} from './antigravityHookSettings';

/**
 * Global Antigravity 2.0 hook installer (`~/.gemini/config/hooks.json`).
 * Applies across all workspaces on the machine (Antigravity IDE, App 2.0 and
 * `agy` CLI). Merges only the `"orbi"` key with a backup before writing, and
 * removes only `"orbi"` on disconnect or uninstall.
 */
const hooksPath = () => hub.antigravity.hooksPath;

export function agyHookTarget(): AgyHookTarget {
  return app.isPackaged ? { command: process.execPath, args: [] } : { command: process.execPath, args: [app.getAppPath()] };
}

function readHooks(): AntigravityHooksDoc {
  if (!existsSync(hooksPath())) return {};
  const raw = readFileSync(hooksPath(), 'utf8');
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('hooks.json root is not an object');
  }
  return parsed as AntigravityHooksDoc;
}

function backup() {
  if (!existsSync(hooksPath())) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(hooksPath(), `${hooksPath()}.orbi-backup-${stamp}`);
}

function writeHooks(doc: AntigravityHooksDoc) {
  mkdirSync(dirname(hooksPath()), { recursive: true });
  const tmp = `${hooksPath()}.orbi-tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  renameSync(tmp, hooksPath());
}

export function refreshAntigravityHookStatus() {
  try {
    const doc = readHooks();
    hub.setAntigravity({ hooksInstalled: antigravityHooksInstalled(doc) });
  } catch {
    hub.setAntigravity({ hooksInstalled: false });
  }
}

/**
 * Auto-heals Orbi's entry in `~/.gemini/config/hooks.json` when Orbi moves
 * (e.g. dev mode → installed `.exe` or app update), without touching user hooks.
 */
export function upgradeAntigravityConnection(): boolean {
  try {
    const doc = readHooks();
    const target = agyHookTarget();
    if (!needsAntigravityUpgrade(doc, target)) return false;
    backup();
    writeHooks(withAntigravityHooks(doc, target));
    refreshAntigravityHookStatus();
    return true;
  } catch {
    return false;
  }
}

export function connectAntigravity(): { ok: boolean; message: string } {
  let current: AntigravityHooksDoc;
  try {
    current = readHooks();
  } catch {
    return { ok: false, message: 'O hooks.json do Antigravity não é um JSON válido. Corrija o arquivo e tente de novo.' };
  }
  try {
    backup();
    writeHooks(withAntigravityHooks(current, agyHookTarget()));
    refreshAntigravityHookStatus();
    return { ok: true, message: 'Antigravity conectado globalmente para todos os projetos.' };
  } catch {
    return { ok: false, message: 'Não consegui gravar ~/.gemini/config/hooks.json.' };
  }
}

export function disconnectAntigravity(): { ok: boolean; message: string } {
  try {
    const doc = readHooks();
    backup();
    writeHooks(stripAntigravityOrbi(doc));
    refreshAntigravityHookStatus();
    return { ok: true, message: 'Antigravity desconectado. Os outros hooks foram mantidos.' };
  } catch {
    return { ok: false, message: 'Não consegui ler ~/.gemini/config/hooks.json.' };
  }
}

