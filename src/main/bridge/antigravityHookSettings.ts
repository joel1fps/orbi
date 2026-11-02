/**
 * Pure editing of Antigravity 2.0's global ~/.gemini/config/hooks.json (no I/O,
 * unit-tested). Antigravity hooks are named top-level entries (`{ "orbi": ... }`)
 * and execute synchronously via `cmd /c` (Windows) or `sh -c` (Unix), so Orbi
 * hooks only lightweight lifecycle boundaries (`SessionStart`, `PreInvocation`,
 * `Stop`) while intermediate tool steps stream passively from `transcript.jsonl`.
 */
export const AGY_HOOK_KEY = 'orbi';
export const AGY_HOOK_PREFIX = '--orbi-agy-hook=';

export const AGY_EVENTS = ['SessionStart', 'PreInvocation', 'Stop'] as const;
export type AgyHookEvent = (typeof AGY_EVENTS)[number];

export interface AgyHookTarget {
  /** Executable to run (Orbi itself, or electron in dev). */
  command: string;
  /** Optional prefix arguments before the `--orbi-agy-hook=<Event>` flag (e.g. app path in dev). */
  args: string[];
}

export interface AgyHookHandler {
  type?: string;
  command: string;
  timeout?: number;
  [k: string]: unknown;
}

export interface AgyHookSpec {
  enabled?: boolean;
  SessionStart?: AgyHookHandler[];
  PreInvocation?: AgyHookHandler[];
  PostInvocation?: AgyHookHandler[];
  Stop?: AgyHookHandler[];
  [k: string]: unknown;
}

export type AntigravityHooksDoc = Record<string, AgyHookSpec | unknown>;

const quoteShellArg = (s: string) => (/\s/.test(s) ? `"${s}"` : s);

/**
 * Shell command string for `hooks.json`. Quotes arguments only when they contain
 * whitespace, and always ends with the unquoted `--orbi-agy-hook=<Event>` flag so
 * Windows `cmd.exe /c` never strips outer quotes when multiple paths have spaces.
 */
export function buildAgyHookCommand(target: AgyHookTarget, event: AgyHookEvent): string {
  const parts = [target.command, ...target.args].map(quoteShellArg);
  parts.push(`${AGY_HOOK_PREFIX}${event}`);
  return parts.join(' ');
}

function buildOrbiSpec(target: AgyHookTarget): AgyHookSpec {
  const spec: AgyHookSpec = {};
  for (const event of AGY_EVENTS) {
    spec[event] = [
      {
        type: 'command',
        command: buildAgyHookCommand(target, event),
        timeout: 10,
      },
    ];
  }
  return spec;
}

export function isAgyHookEvent(value: string | undefined): value is AgyHookEvent {
  return Boolean(value && (AGY_EVENTS as readonly string[]).includes(value));
}

export function antigravityHooksInstalled(doc: AntigravityHooksDoc): boolean {
  const entry = doc[AGY_HOOK_KEY];
  if (!entry || typeof entry !== 'object') return false;
  const spec = entry as AgyHookSpec;
  if (spec.enabled === false) return false;
  return AGY_EVENTS.every((event) => {
    const list = spec[event];
    return Array.isArray(list) && list.some((h) => typeof h?.command === 'string' && h.command.includes(`${AGY_HOOK_PREFIX}${event}`));
  });
}

/**
 * True when Orbi already has an entry in `hooks.json`, and its command paths or
 * event handlers no longer match the running Orbi executable (e.g. moved from
 * dev to installed `.exe` or updated).
 */
export function needsAntigravityUpgrade(doc: AntigravityHooksDoc, target: AgyHookTarget): boolean {
  if (!(AGY_HOOK_KEY in doc)) return false;
  const current = doc[AGY_HOOK_KEY];
  if (!current || typeof current !== 'object') return false;
  if ((current as AgyHookSpec).enabled === false) return false;
  const expected = buildOrbiSpec(target);
  return JSON.stringify(current) !== JSON.stringify(expected);
}

/** Add or replace Orbi's named entry in `hooks.json`, keeping every other hook untouched. */
export function withAntigravityHooks(input: AntigravityHooksDoc, target: AgyHookTarget): AntigravityHooksDoc {
  const next: AntigravityHooksDoc = JSON.parse(JSON.stringify(input));
  next[AGY_HOOK_KEY] = buildOrbiSpec(target);
  return next;
}

/** Remove only Orbi's named entry from `hooks.json`. */
export function stripAntigravityOrbi(input: AntigravityHooksDoc): AntigravityHooksDoc {
  const next: AntigravityHooksDoc = JSON.parse(JSON.stringify(input));
  delete next[AGY_HOOK_KEY];
  return next;
}

