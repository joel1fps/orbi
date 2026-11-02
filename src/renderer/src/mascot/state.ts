import type { AgentSession, IdleLevel, PlanUsage } from '@shared/types';
import type { ActionName, Badge, Expression, Glow, Particles } from './brain';

/**
 * Orbi's state machine, pure so it is unit-tested. Two layers:
 *
 *  - the condition: what is true right now, derived from the hub and the
 *    user's inactivity (permission > error > rate limit > work > idle);
 *  - the reaction: a short-lived response to something that just happened,
 *    each with a priority, so a decorative boop never cuts a "done" short.
 *
 * Idle fidgets (look around, wave…) are a third, lowest layer that only runs
 * when both are at rest (brain.ts).
 */

export type Condition = 'permission' | 'error' | 'ratelimit' | 'thinking' | 'running' | 'idle' | 'drowsy' | 'asleep';

/** How long the user has been away, as measured by the main process. */
export type { IdleLevel } from '@shared/types';

export type ReactionKind =
  | 'intro'
  | 'start'
  | 'done'
  | 'error'
  | 'waiting'
  | 'boop'
  | 'pet'
  | 'tickle'
  | 'wake'
  | 'peek';

export interface ConditionInput {
  now: number;
  permissions: number;
  sessions: Pick<AgentSession, 'state' | 'updatedAt' | 'current'>[];
  usage: Pick<PlanUsage, 'tool' | 'fiveHour' | 'week'>[];
  idle: IdleLevel;
}

const ACTIVE_MS = 120_000;
const ERROR_MS = 60_000;
/** What agents report while they reason rather than run a tool. */
const THINKING = new Set(['Pensando…', 'Analisando resultado', 'Escrevendo resposta']);

export function resolveCondition(i: ConditionInput): Condition {
  if (i.permissions > 0) return 'permission';
  if (i.sessions.some((s) => s.state === 'error' && i.now - s.updatedAt < ERROR_MS)) return 'error';
  const live = i.sessions.filter((s) => s.state === 'working' && i.now - s.updatedAt < ACTIVE_MS);
  if (live.length > 0) return live.every((s) => s.current && THINKING.has(s.current)) ? 'thinking' : 'running';
  // Antigravity's headline is one model's quota; the others may still be free.
  const limited = i.usage.some((u) =>
    u.tool !== 'antigravity' &&
    [u.fiveHour, u.week].some((w) => w && w.usedPercent >= 100 && (w.resetsAt === undefined || w.resetsAt > i.now)),
  );
  if (limited) return 'ratelimit';
  if (i.idle === 'asleep') return 'asleep';
  if (i.idle === 'drowsy') return 'drowsy';
  return 'idle';
}

interface ReactionSpec {
  priority: number;
  ms: number;
  expression: Expression;
  action?: ActionName;
  particles?: Particles;
  glow?: Glow;
  badge?: Badge;
}

export const REACTIONS: Record<ReactionKind, ReactionSpec> = {
  done: { priority: 90, ms: 3400, expression: 'joy', action: 'celebrate', particles: 'sparkles', glow: 'green', badge: 'done' },
  error: { priority: 90, ms: 3600, expression: 'surprised', action: 'shake', glow: 'red', badge: 'error' },
  waiting: { priority: 90, ms: 2400, expression: 'curious', action: 'wave', particles: 'question' },
  intro: { priority: 85, ms: 2600, expression: 'joy', action: 'enter', particles: 'sparkles' },
  start: { priority: 50, ms: 2200, expression: 'curious', action: 'wiggle' },
  wake: { priority: 40, ms: 1800, expression: 'happy', action: 'stretch' },
  boop: { priority: 30, ms: 900, expression: 'happy', action: 'squash' },
  pet: { priority: 30, ms: 1600, expression: 'love', action: 'wiggle', particles: 'hearts', glow: 'violet' },
  tickle: { priority: 30, ms: 1800, expression: 'joy', action: 'bounce', particles: 'sparkles' },
  peek: { priority: 20, ms: 800, expression: 'happy', action: 'hop' },
};

/** Whether `next` may take over from the reaction still playing. */
export function canReplace(current: { kind: ReactionKind; until: number } | null, next: ReactionKind, now: number): boolean {
  if (!current || current.until <= now) return true;
  return REACTIONS[next].priority >= REACTIONS[current.kind].priority;
}

export interface Look {
  expression: Expression;
  badge: Badge;
  glow: Glow;
  particles: Particles;
  sleeping: boolean;
  working: boolean;
}

const CONDITIONS: Record<Condition, { expression: Expression; badge: Badge; glow: Glow; hoverable: boolean }> = {
  permission: { expression: 'worried', badge: 'alert', glow: 'amber', hoverable: false },
  error: { expression: 'sad', badge: 'error', glow: 'red', hoverable: false },
  ratelimit: { expression: 'sleepy', badge: null, glow: null, hoverable: true },
  thinking: { expression: 'curious', badge: null, glow: 'teal', hoverable: false },
  running: { expression: 'focused', badge: null, glow: 'teal', hoverable: true },
  idle: { expression: 'neutral', badge: null, glow: null, hoverable: true },
  drowsy: { expression: 'sleepy', badge: null, glow: null, hoverable: true },
  asleep: { expression: 'asleep', badge: null, glow: null, hoverable: false },
};

export function resolveLook(condition: Condition, reaction: ReactionKind | null, hovered: boolean): Look {
  const c = CONDITIONS[condition];
  const r = reaction ? REACTIONS[reaction] : null;
  // The amber "!" of a waiting permission stays up whatever Orbi is doing.
  const pinned = condition === 'permission';
  return {
    expression: r ? r.expression : hovered && c.hoverable ? 'curious' : c.expression,
    badge: pinned ? c.badge : (r?.badge ?? c.badge),
    glow: pinned ? c.glow : (r?.glow ?? c.glow),
    particles: r ? (r.particles ?? null) : condition === 'asleep' ? 'zzz' : null,
    sleeping: !r && condition === 'asleep',
    working: condition === 'thinking' || condition === 'running',
  };
}
