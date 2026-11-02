import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { hub } from '../hub';
import { codexCommand, codexHooksInstalled, stripCodexOrbi, withCodexHooks, type CodexHooksDoc } from './codexHookSettings';

/**
 * Connecting Codex permissions = one PermissionRequest hook in
 * ~/.codex/hooks.json (or $CODEX_HOME). Merged with a dated backup, removed
 * exactly on disconnect. Codex only runs a new hook after the user trusts it
 * once with /hooks, which the interface says.
 */
const hooksPath = () => hub.codex.hooksPath;
/** Longest answer time in Settings (2 min) plus margin; past it Orbi hands the decision back. */
const TIMEOUT_SEC = 150;

function readDoc(): CodexHooksDoc {
  if (!existsSync(hooksPath())) return {};
  const raw = readFileSync(hooksPath(), 'utf8');
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown; // throws on invalid JSON: never overwrite a file we can't parse
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('hooks.json não é um objeto');
  return parsed as CodexHooksDoc;
}

function write(doc: CodexHooksDoc) {
  mkdirSync(dirname(hooksPath()), { recursive: true });
  if (existsSync(hooksPath())) copyFileSync(hooksPath(), `${hooksPath()}.orbi-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const tmp = `${hooksPath()}.orbi-tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  renameSync(tmp, hooksPath());
}

function command(): string | null {
  return codexCommand(app.isPackaged ? { command: process.execPath, args: [] } : { command: process.execPath, args: [app.getAppPath()] });
}

export function refreshCodexStatus() {
  try {
    hub.setCodex({ hooksInstalled: codexHooksInstalled(readDoc()) });
  } catch {
    hub.setCodex({ hooksInstalled: false });
  }
}

export function connectCodexHooks(): { ok: boolean; message: string } {
  const cmd = command();
  if (!cmd) return { ok: false, message: 'O caminho do Orbi tem caracteres que o cmd do Windows não aceita num hook do Codex.' };
  try {
    write(withCodexHooks(readDoc(), cmd, TIMEOUT_SEC));
  } catch (err) {
    return { ok: false, message: `Não alterei o ${hooksPath()}: ${(err as Error).message}.` };
  }
  refreshCodexStatus();
  return {
    ok: true,
    message: 'Conectado. Abra o Codex e aprove o hook novo uma vez com /hooks: a partir daí os pedidos de permissão aparecem na ilha.',
  };
}

export function disconnectCodexHooks(): { ok: boolean; message: string } {
  try {
    const doc = readDoc();
    const clean = stripCodexOrbi(doc);
    if (JSON.stringify(clean) !== JSON.stringify(doc)) write(clean);
  } catch (err) {
    return { ok: false, message: `Não alterei o ${hooksPath()}: ${(err as Error).message}.` };
  }
  refreshCodexStatus();
  return { ok: true, message: 'Desconectado. O Codex volta a perguntar só no terminal.' };
}
