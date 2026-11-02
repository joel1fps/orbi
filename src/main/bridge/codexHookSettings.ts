/**
 * Pure editing of Codex's ~/.codex/hooks.json (no I/O, unit-tested). Orbi adds
 * a single PermissionRequest hook so Codex permission prompts can be answered
 * from the island; Codex activity itself already comes from its session files.
 *
 * Format (Codex hook schema): Claude-style groups, timeouts in seconds, and
 * the answer is Claude Code's `hookSpecificOutput.decision.behavior`
 * (allow | deny). No output means Codex asks in the terminal as usual.
 * Codex runs the command through `cmd /C` on Windows, which keeps the quotes
 * of a lone quoted program but mangles several quoted words, so the command
 * line is either plain words or one quoted path.
 */
export const CODEX_HOOK_FLAG = '--orbi-codex-hook';
export const CODEX_WAITING = 'Aguardando sua resposta no Orbi';

export type CodexHandler = { type?: string; command?: string; timeout?: number; statusMessage?: string; [k: string]: unknown };
export type CodexGroup = { matcher?: string; hooks?: CodexHandler[]; [k: string]: unknown };
export type CodexHooksDoc = { hooks?: Record<string, CodexGroup[]>; [k: string]: unknown };

const plain = (s: string) => /^[A-Za-z0-9\\/:._-]+$/.test(s);

export function codexCommand(target: { command: string; args: string[] }): string | null {
  const words = [target.command, ...target.args];
  if (words.every(plain)) return [...words, CODEX_HOOK_FLAG].join(' ');
  if (words.length === 1 && !words[0].includes('"')) return `"${words[0]}" ${CODEX_HOOK_FLAG}`;
  return null;
}

export const isOrbiCodexHandler = (h: CodexHandler) => typeof h.command === 'string' && h.command.includes(CODEX_HOOK_FLAG);

function checked(doc: CodexHooksDoc): CodexHooksDoc {
  if (doc.hooks === undefined) return doc;
  if (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks)) throw new Error('"hooks" não é um objeto');
  for (const [event, groups] of Object.entries(doc.hooks)) {
    if (!Array.isArray(groups)) throw new Error(`"hooks.${event}" não é uma lista`);
  }
  return doc;
}

export function codexHooksInstalled(doc: CodexHooksDoc): boolean {
  return Boolean(doc.hooks?.PermissionRequest?.some((g) => g.hooks?.some(isOrbiCodexHandler)));
}

/** Remove exactly what Orbi added. */
export function stripCodexOrbi(input: CodexHooksDoc): CodexHooksDoc {
  const doc: CodexHooksDoc = JSON.parse(JSON.stringify(checked(input)));
  if (!doc.hooks) return doc;
  for (const [event, groups] of Object.entries(doc.hooks)) {
    const kept = groups.map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOrbiCodexHandler(h)) })).filter((g) => g.hooks.length > 0);
    if (kept.length) doc.hooks[event] = kept;
    else delete doc.hooks[event];
  }
  if (Object.keys(doc.hooks).length === 0) delete doc.hooks;
  return doc;
}

/** Add (or replace) Orbi's PermissionRequest hook. Idempotent. */
export function withCodexHooks(input: CodexHooksDoc, command: string, timeoutSec: number): CodexHooksDoc {
  const doc = stripCodexOrbi(input);
  doc.hooks ??= {};
  (doc.hooks.PermissionRequest ??= []).push({ hooks: [{ type: 'command', command, timeout: timeoutSec, statusMessage: CODEX_WAITING }] });
  return doc;
}

const SHELLS = /^(bash|sh|zsh|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe)$/i;

/** One line for the island's permission card: the real command, not just "running a command". */
export function codexPermissionSummary(tool: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const cmd = i.command ?? i.cmd;
  if (Array.isArray(cmd) && cmd.every((c) => typeof c === 'string')) {
    const words = cmd as string[];
    // ["bash", "-lc", "<script>"] and friends: the script is what matters.
    if (words.length >= 3 && SHELLS.test(words[0].split(/[\\/]/).pop() ?? '') && /^(-l?c|\/c|-command)$/i.test(words[1])) return words.slice(2).join(' ');
    return words.join(' ');
  }
  if (typeof cmd === 'string') return cmd;
  const patch = typeof i.input === 'string' ? i.input : typeof i.patch === 'string' ? i.patch : '';
  const files = [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
  if (files.length) return `Editar ${files.join(', ')}`;
  return input === undefined ? tool : `${tool} ${JSON.stringify(input)}`;
}
