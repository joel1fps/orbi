/**
 * Pure editing of Claude Code's settings.json for Orbi's hooks (no I/O, so it
 * can be unit-tested). Orbi's hooks use the exec form (`command` + `args`, no
 * shell): it works the same under Git Bash, PowerShell, sh and zsh, and paths
 * with spaces need no quoting. Exec form needs Claude Code 2.1.139+.
 */
export const HOOK_FLAG = '--orbi-hook';
/** Run by the uninstaller: remove Orbi's hooks so Claude Code isn't left calling a deleted app. */
export const DISCONNECT_FLAG = '--orbi-disconnect';
/** Script names used by Orbi 0.1, recognised so they can be cleaned up. */
const LEGACY_HOOK_SCRIPT = 'orbi-hook.cjs';
const LEGACY_STATUS_SCRIPT = 'orbi-statusline.cjs';
export const MIN_CLAUDE_VERSION = [2, 1, 139] as const;

export const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const;

export type HookHandler = { type?: string; command?: string; args?: unknown; [k: string]: unknown };
export type HookGroup = { matcher?: string; hooks?: HookHandler[] };
export type ClaudeSettings = {
  hooks?: Record<string, HookGroup[]>;
  statusLine?: { type?: string; command?: string };
  [k: string]: unknown;
};

export interface HookTarget {
  /** Executable to run (Orbi itself). */
  command: string;
  /** Arguments, ending with HOOK_FLAG. */
  args: string[];
}

export function isOrbiHandler(h: HookHandler): boolean {
  if (typeof h.command === 'string' && h.command.includes(LEGACY_HOOK_SCRIPT)) return true;
  return Array.isArray(h.args) && h.args.includes(HOOK_FLAG);
}

export function isLegacyHandler(h: HookHandler): boolean {
  return typeof h.command === 'string' && h.command.includes(LEGACY_HOOK_SCRIPT);
}

export const isOrbiStatusLine = (s: ClaudeSettings['statusLine']) => Boolean(s?.command?.includes(LEGACY_STATUS_SCRIPT));

function orbiHandlers(s: ClaudeSettings): HookHandler[] {
  return Object.values(s.hooks ?? {}).flatMap((groups) => groups.flatMap((g) => (g.hooks ?? []).filter(isOrbiHandler)));
}

/** Every event has an Orbi hook. */
export function hooksInstalled(s: ClaudeSettings): boolean {
  return EVENTS.every((e) => s.hooks?.[e]?.some((g) => g.hooks?.some(isOrbiHandler)));
}

/**
 * Orbi entries that must be rewritten: the 0.1 Node-script format, or a
 * target executable that no longer exists (app moved or reinstalled).
 */
export function needsUpgrade(s: ClaudeSettings, exists: (path: string) => boolean): boolean {
  const mine = orbiHandlers(s);
  if (mine.length === 0) return isOrbiStatusLine(s.statusLine);
  return mine.some((h) => isLegacyHandler(h) || (typeof h.command === 'string' && !exists(h.command))) || isOrbiStatusLine(s.statusLine);
}

/** Remove exactly what Orbi added; everything else is left as it was. */
export function stripOrbi(input: ClaudeSettings): ClaudeSettings {
  const s: ClaudeSettings = JSON.parse(JSON.stringify(input));
  if (s.hooks) {
    for (const [event, groups] of Object.entries(s.hooks)) {
      const kept = groups
        .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOrbiHandler(h)) }))
        .filter((g) => g.hooks.length > 0);
      if (kept.length) s.hooks[event] = kept;
      else delete s.hooks[event];
    }
    if (Object.keys(s.hooks).length === 0) delete s.hooks;
  }
  if (isOrbiStatusLine(s.statusLine)) delete s.statusLine;
  return s;
}

/** Add (or replace) Orbi's hooks. Idempotent. */
export function withOrbiHooks(input: ClaudeSettings, target: HookTarget, permissionTimeoutSec: number): ClaudeSettings {
  const s = stripOrbi(input);
  s.hooks ??= {};
  for (const event of EVENTS) {
    const blocking = event === 'PermissionRequest';
    const handler: HookHandler = {
      type: 'command',
      command: target.command,
      args: target.args,
      // Only the permission hook waits for an answer; every other event is fire-and-forget.
      ...(blocking ? { timeout: permissionTimeoutSec + 30 } : { async: true, timeout: 10 }),
    };
    (s.hooks[event] ??= []).push({ hooks: [handler] });
  }
  return s;
}

/** "2.1.295 (Claude Code)" → [2, 1, 295]. */
export function parseVersion(text: string): number[] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function versionAtLeast(v: number[], min: readonly number[]): boolean {
  for (let i = 0; i < min.length; i++) {
    if ((v[i] ?? 0) > min[i]) return true;
    if ((v[i] ?? 0) < min[i]) return false;
  }
  return true;
}
