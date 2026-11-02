import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { REACTIONS, resolveCondition, resolveLook, type Condition } from './state';

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
  | 'enter'
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

/** Spontaneous little things, only when nothing else is going on. */
const IDLE_POOL: Partial<Record<Condition, ActionName[]>> = {
  idle: ['look-around', 'look-around', 'wiggle', 'wave', 'hop', 'stretch'],
  drowsy: ['yawn', 'yawn', 'look-around'],
  ratelimit: ['yawn', 'look-around'],
};

let actionKey = 0;

/** The condition (state.ts) from the hub and the user's inactivity; re-evaluated every 15 s for time-based edges. */
export function useCondition(): Condition {
  const permissions = useApp((s) => s.hub.permissions.length);
  const sessions = useApp((s) => s.hub.sessions);
  const usage = useApp((s) => s.hub.usage);
  const idle = useApp((s) => s.idle);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return resolveCondition({ now, permissions, sessions, usage, idle });
}

/**
 * Turns what Orbi knows into one look plus one-shot actions. Shared by 2D
 * and 3D; the rules live in state.ts.
 */
export function useMascotMood(hovered: boolean): MascotMood {
  const reaction = useApp((s) => s.reaction);
  const reduceMotion = useApp((s) => s.settings.reduceMotion);
  const condition = useCondition();

  const [action, setAction] = useState<MascotAction | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Reaction → one-shot action, and re-render when the reaction expires.
  useEffect(() => {
    if (!reaction) return;
    const a = REACTIONS[reaction.kind].action;
    if (a) setAction({ name: a, key: ++actionKey });
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, reaction.until - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [reaction]);

  const conditionRef = useRef(condition);
  conditionRef.current = condition;
  useEffect(() => {
    if (reduceMotion) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(
        () => {
          const pool = IDLE_POOL[conditionRef.current];
          const r = useApp.getState().reaction;
          if (pool && (!r || r.until < Date.now())) setAction({ name: pool[Math.floor(Math.random() * pool.length)], key: ++actionKey });
          schedule();
        },
        7000 + Math.random() * 9000,
      );
    };
    schedule();
    return () => clearTimeout(t);
  }, [reduceMotion]);

  const active = reaction && reaction.until > now ? reaction.kind : null;
  return { ...resolveLook(condition, active, hovered), action };
}
