import { useEffect, useRef, useState } from 'react';
import { useApp, type ReactionKind } from '../store';

export type Expression =
  | 'neutral'
  | 'happy'
  | 'joy'
  | 'love'
  | 'curious'
  | 'surprised'
  | 'worried'
  | 'focused'
  | 'sad'
  | 'sleepy'
  | 'asleep'
  | 'eating'
  | 'refuse';

export type ActionName =
  | 'wave'
  | 'hop'
  | 'bounce'
  | 'chomp'
  | 'shake'
  | 'yawn'
  | 'wiggle'
  | 'squash'
  | 'stretch'
  | 'look-around'
  | 'celebrate';

export interface MascotAction {
  name: ActionName;
  key: number;
}

export type Badge = 'alert' | 'done' | 'error' | null;
export type Glow = 'amber' | 'green' | 'red' | 'teal' | 'violet' | null;
export type Particles = 'hearts' | 'sparkles' | 'zzz' | 'crumbs' | 'question' | null;

export interface MascotMood {
  expression: Expression;
  badge: Badge;
  glow: Glow;
  particles: Particles;
  working: boolean;
  sleeping: boolean;
  action: MascotAction | null;
}

const REACTION_EXPRESSION: Record<ReactionKind, Expression> = {
  start: 'curious',
  done: 'joy',
  error: 'surprised',
  waiting: 'curious',
  boop: 'happy',
  pet: 'love',
  hello: 'happy',
  tickle: 'joy',
};

const REACTION_ACTION: Partial<Record<ReactionKind, ActionName>> = {
  start: 'wiggle',
  done: 'celebrate',
  error: 'shake',
  waiting: 'wave',
  boop: 'squash',
  pet: 'wiggle',
  hello: 'wave',
  tickle: 'bounce',
};

const REACTION_PARTICLES: Partial<Record<ReactionKind, Particles>> = {
  done: 'sparkles',
  pet: 'hearts',
  hello: 'sparkles',
  waiting: 'question',
  tickle: 'sparkles',
};

/** Spontaneous little things when nothing is going on. */
const IDLE_POOL: ActionName[] = ['look-around', 'look-around', 'wiggle', 'wave', 'hop', 'stretch'];

let actionKey = 0;

/**
 * Turns what Orbi knows (agent activity, what just happened, the pointer)
 * into one expression plus one-shot actions. Shared by 2D and 3D.
 */
export function useMascotMood(hovered: boolean): MascotMood {
  const reaction = useApp((s) => s.reaction);
  const permissions = useApp((s) => s.hub.permissions.length);
  const working = useApp((s) => s.hub.sessions.some((x) => x.state === 'working' && Date.now() - x.updatedAt < 120_000));
  const lastError = useApp((s) => s.hub.sessions.some((x) => x.state === 'error' && Date.now() - x.updatedAt < 60_000));
  const reduceMotion = useApp((s) => s.settings.reduceMotion);

  const [action, setAction] = useState<MascotAction | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Reaction → one-shot action, and re-render when the reaction expires.
  useEffect(() => {
    if (!reaction) return;
    const a = REACTION_ACTION[reaction.kind];
    if (a) setAction({ name: a, key: ++actionKey });
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, reaction.until - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [reaction]);

  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  useEffect(() => {
    if (reduceMotion) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(
        () => {
          const r = useApp.getState().reaction;
          if (permissionsRef.current === 0 && (!r || r.until < Date.now())) {
            setAction({ name: IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)], key: ++actionKey });
          }
          schedule();
        },
        7000 + Math.random() * 9000,
      );
    };
    schedule();
    return () => clearTimeout(t);
  }, [reduceMotion]);

  const active = reaction && reaction.until > now ? reaction : null;

  let expression: Expression;
  let particles: Particles = null;
  if (active) {
    expression = REACTION_EXPRESSION[active.kind];
    particles = REACTION_PARTICLES[active.kind] ?? null;
  } else if (permissions > 0) expression = 'worried';
  else if (lastError) expression = 'sad';
  else if (working) expression = hovered ? 'curious' : 'focused';
  else if (hovered) expression = 'curious';
  else expression = 'neutral';

  const badge: Badge =
    permissions > 0 ? 'alert' : active?.kind === 'done' ? 'done' : active?.kind === 'error' || (lastError && !active) ? 'error' : null;

  const glow: Glow =
    permissions > 0
      ? 'amber'
      : active?.kind === 'done'
        ? 'green'
        : active?.kind === 'error'
          ? 'red'
          : active?.kind === 'pet'
            ? 'violet'
            : working
              ? 'teal'
              : null;

  // Sleep comes back with the inactivity-driven state machine (phase 1).
  return { expression, badge, glow, particles, working, sleeping: false, action };
}
