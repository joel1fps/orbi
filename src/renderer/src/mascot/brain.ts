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

export interface MascotProps extends MascotMood {
  size: number;
  /** Interactive stage (Tamagotchi): bigger reactions, petting enabled. */
  stage?: boolean;
  reduceMotion: boolean;
  followCursor: boolean;
}

const REACTION_EXPRESSION: Record<ReactionKind, Expression> = {
  start: 'curious',
  done: 'joy',
  error: 'surprised',
  waiting: 'curious',
  boop: 'happy',
  pet: 'love',
  feed: 'eating',
  play: 'joy',
  refuse: 'refuse',
  tired: 'sleepy',
  sleep: 'sleepy',
  wake: 'happy',
  hello: 'happy',
  tickle: 'joy',
  startle: 'surprised',
};

const REACTION_ACTION: Partial<Record<ReactionKind, ActionName>> = {
  start: 'wiggle',
  done: 'celebrate',
  error: 'shake',
  waiting: 'wave',
  boop: 'squash',
  pet: 'wiggle',
  feed: 'chomp',
  play: 'bounce',
  refuse: 'shake',
  tired: 'yawn',
  sleep: 'yawn',
  wake: 'stretch',
  hello: 'wave',
  tickle: 'bounce',
  startle: 'squash',
};

const REACTION_PARTICLES: Partial<Record<ReactionKind, Particles>> = {
  done: 'sparkles',
  pet: 'hearts',
  feed: 'crumbs',
  play: 'sparkles',
  hello: 'sparkles',
  waiting: 'question',
  tickle: 'sparkles',
};

let actionKey = 0;

/**
 * Turns everything Orbi knows (care stats, agent activity, what just
 * happened) into one expression plus one-shot actions. Shared by 2D and 3D.
 */
export function useMascotMood(hovered: boolean, stage = false): MascotMood {
  const reaction = useApp((s) => s.reaction);
  const pet = useApp((s) => s.pet);
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

  // Spontaneous little things when nothing is going on.
  const idleRef = useRef({ pet, working, permissions });
  idleRef.current = { pet, working, permissions };
  useEffect(() => {
    if (reduceMotion) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(
        () => {
          const { pet: p, permissions: perms } = idleRef.current;
          const r = useApp.getState().reaction;
          if (!p.sleeping && perms === 0 && (!r || r.until < Date.now())) {
            const pool: ActionName[] = ['look-around', 'wiggle', 'look-around'];
            if (p.mood > 60) pool.push('wave', 'hop');
            if (p.mood > 80) pool.push('bounce');
            if (p.energy < 40) pool.push('yawn', 'yawn');
            pool.push('stretch');
            setAction({ name: pool[Math.floor(Math.random() * pool.length)], key: ++actionKey });
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
    // Asleep, a carinho only makes Orbi smile in its sleep.
    if (pet.sleeping && active.kind === 'pet') expression = 'asleep';
  } else if (permissions > 0) expression = 'worried';
  else if (pet.sleeping) expression = 'asleep';
  else if (lastError) expression = 'sad';
  // On the Tamagotchi stage Orbi's own needs speak louder than agent work.
  else if (working && !stage) expression = hovered ? 'curious' : 'focused';
  else if (pet.energy < 20) expression = 'sleepy';
  else if (pet.satiety < 20 || pet.mood < 25) expression = 'sad';
  else if (hovered) expression = 'curious';
  else if (pet.mood >= 80) expression = 'happy';
  else expression = 'neutral';

  if (pet.sleeping && !particles) particles = 'zzz';

  const badge: Badge =
    permissions > 0 ? 'alert' : active?.kind === 'done' ? 'done' : active?.kind === 'error' || (lastError && !active) ? 'error' : null;

  const glow: Glow =
    permissions > 0
      ? 'amber'
      : active?.kind === 'done'
        ? 'green'
        : active?.kind === 'error'
          ? 'red'
          : active?.kind === 'pet' || active?.kind === 'feed' || active?.kind === 'play'
            ? 'violet'
            : working
              ? 'teal'
              : null;

  return { expression, badge, glow, particles, working, sleeping: pet.sleeping, action };
}
