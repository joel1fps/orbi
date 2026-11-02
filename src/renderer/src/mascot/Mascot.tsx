import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '../store';
import { useMascotMood, type Badge, type Glow, type Particles } from './brain';
import { Orbi2D } from './Orbi2D';
import { useLook } from './useLook';

// three.js only loads when someone switches Orbi to 3D.
const Orbi3D = lazy(() => import('./Orbi3D'));

const GLOW: Record<NonNullable<Glow>, string> = {
  amber: 'rgba(242, 184, 75, 0.42)',
  green: 'rgba(87, 201, 147, 0.40)',
  red: 'rgba(242, 116, 121, 0.40)',
  teal: 'rgba(79, 183, 162, 0.30)',
  violet: 'rgba(196, 160, 255, 0.32)',
};

interface Props {
  size: number;
  /** Petting, boops, hover reactions and the 3D option. */
  interactive?: boolean;
  /** Force 2D (tiny sizes). */
  flat?: boolean;
  className?: string;
}

export function Mascot({ size, interactive = false, flat = false, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const mood = useMascotMood(hovered);
  const reduceMotion = useApp((s) => s.settings.reduceMotion);
  const followCursor = useApp((s) => s.settings.followCursor);
  const style = useApp((s) => s.settings.mascotStyle);
  const reaction = useApp((s) => s.reaction);
  const look = useLook(ref, followCursor && !mood.sleeping && !reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;
    if (mood.action?.name === 'look-around') look.lookAround();
    // After the entrance, a look around before settling in.
    if (mood.action?.name === 'enter') {
      const t = setTimeout(look.lookAround, 1900);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood.action]);

  const interactions = usePetting(interactive);
  const use3d = interactive && !flat && style === '3d';

  const common = {
    size,
    ambient: size < 70 ? ('minimal' as const) : ('calm' as const),
    expression: mood.expression,
    action: mood.action,
    working: mood.working,
    sleeping: mood.sleeping,
    still: reduceMotion,
    lookX: look.x,
    lookY: look.y,
  };

  return (
    <div
      ref={ref}
      className={`mascot ${interactive ? 'mascot--interactive' : ''} ${className}`}
      style={{ width: size, height: size }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      {...(interactive ? interactions : {})}
    >
      <div className="mascot__glow" style={{ ['--glow' as string]: mood.glow ? GLOW[mood.glow] : 'rgba(0,0,0,0)' }} />
      {use3d ? (
        <Suspense fallback={<Orbi2D {...common} />}>
          <Orbi3D {...common} />
        </Suspense>
      ) : (
        <Orbi2D {...common} />
      )}
      <BadgeDot kind={mood.badge} size={size} />
      {!reduceMotion ? <ParticleLayer kind={mood.particles} burstKey={reaction?.key ?? 0} size={size} /> : null}
    </div>
  );
}

// ---------- petting & boops ----------

function usePetting(enabled: boolean) {
  const react = useApp((s) => s.react);
  const st = useRef({ down: false, travel: 0, total: 0, t0: 0, boops: [] as number[] });

  return useMemo(
    () => ({
      onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
        if (!enabled) return;
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        st.current.down = true;
        st.current.travel = 0;
        st.current.total = 0;
        st.current.t0 = performance.now();
      },
      onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
        const s = st.current;
        if (!s.down) return;
        const d = Math.abs(e.movementX) + Math.abs(e.movementY);
        s.travel += d;
        s.total += d;
        // Rubbing back and forth over Orbi = carinho.
        if (s.travel > 120) {
          s.travel = 0;
          react('pet');
        }
      },
      onPointerUp: () => {
        const s = st.current;
        if (!s.down) return;
        s.down = false;
        if (s.total < 8 && performance.now() - s.t0 < 450) {
          const now = performance.now();
          s.boops = [...s.boops.filter((t) => now - t < 2500), now];
          if (s.boops.length >= 5) {
            s.boops = [];
            react('tickle');
          } else react('boop');
        }
      },
    }),
    [enabled, react],
  );
}

// ---------- badge ----------

function BadgeDot({ kind, size }: { kind: Badge; size: number }) {
  const d = Math.max(14, Math.round(size * 0.16));
  return (
    <AnimatePresence>
      {kind ? (
        <motion.div
          key={kind}
          className={`mascot__badge mascot__badge--${kind}`}
          style={{ width: d, height: d, left: size * 0.12, top: size * 0.16 }}
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
        >
          {kind === 'done' ? (
            <svg viewBox="0 0 16 16" width={d * 0.62} height={d * 0.62}>
              <path d="M3.5 8.4 6.6 11.3 12.6 4.9" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span style={{ fontSize: d * 0.7 }}>!</span>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------- particles ----------

function Heart({ color = '#f472b6', s = 12 }: { color?: string; s?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={s} height={s}>
      <path d="M8 14s-5.5-3.4-5.5-7.3A3 3 0 0 1 8 4.6a3 3 0 0 1 5.5 2.1C13.5 10.6 8 14 8 14Z" fill={color} />
    </svg>
  );
}

function Sparkle({ color, s = 10 }: { color: string; s?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={s} height={s}>
      <path d="M8 0 9.6 6.4 16 8 9.6 9.6 8 16 6.4 9.6 0 8 6.4 6.4Z" fill={color} />
    </svg>
  );
}

const SPARKLE_COLORS = ['#a3e635', '#5eead4', '#facc15', '#ffffff', '#7ed5c3', '#facc15'];

function ParticleLayer({ kind, burstKey, size }: { kind: Particles; burstKey: number; size: number }) {
  if (kind === 'zzz') {
    return (
      <div className="particles" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="zzz" style={{ left: size * 0.8, top: size * 0.24, fontSize: Math.max(9, size * 0.09) + i * 2, animationDelay: `${i * 0.9}s` }}>
            z
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="particles" aria-hidden="true">
      <AnimatePresence>{kind ? <Burst key={burstKey + kind} kind={kind} size={size} /> : null}</AnimatePresence>
    </div>
  );
}

function Burst({ kind, size }: { kind: Exclude<Particles, 'zzz' | null>; size: number }) {
  const items = useMemo(() => Array.from({ length: kind === 'sparkles' ? 7 : kind === 'question' ? 1 : 5 }, (_, i) => ({ i, r: Math.random() })), [kind]);
  const cx = size / 2;
  const top = size * 0.22;
  const scale = Math.max(0.7, size / 160);

  if (kind === 'question') {
    return (
      <motion.span
        className="particle-q"
        style={{ left: size * 0.68, top: size * 0.04, fontSize: 16 * scale }}
        initial={{ opacity: 0, y: 6, scale: 0.6 }}
        animate={{ opacity: [0, 1, 1, 0], y: [6, -4, -6, -10], scale: 1 }}
        transition={{ duration: 2.2 }}
      >
        ?
      </motion.span>
    );
  }

  if (kind === 'crumbs') {
    return (
      <>
        <motion.span
          className="particle"
          style={{ left: size * 0.9, top: size * 0.35 }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
          animate={{ x: [-0, -size * 0.32, -size * 0.4], y: [0, -size * 0.06, size * 0.15], opacity: [0, 1, 0], scale: [1, 1, 0.3] }}
          transition={{ duration: 0.9, ease: 'easeIn' }}
        >
          <Sparkle color="#facc15" s={14 * scale} />
        </motion.span>
        {items.map(({ i, r }) => (
          <motion.span
            key={i}
            className="particle"
            style={{ left: cx + (r - 0.5) * size * 0.2, top: size * 0.58 }}
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: [0, 1, 0], y: [0, size * (0.12 + r * 0.1)], x: (r - 0.5) * 24 }}
            transition={{ duration: 0.9, delay: 0.8 + i * 0.12 }}
          >
            <span className="crumb" style={{ width: 3 * scale, height: 3 * scale }} />
          </motion.span>
        ))}
      </>
    );
  }

  return (
    <>
      {items.map(({ i, r }) => {
        if (kind === 'hearts') {
          const x = (r - 0.5) * size * 0.5;
          return (
            <motion.span
              key={i}
              className="particle"
              style={{ left: cx + x * 0.4, top }}
              initial={{ opacity: 0, y: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 0], y: -size * (0.22 + r * 0.18), x, scale: [0.4, 1, 0.8] }}
              transition={{ duration: 1.3 + r * 0.4, delay: i * 0.12, ease: 'easeOut' }}
            >
              <Heart s={(10 + r * 6) * scale} />
            </motion.span>
          );
        }
        const angle = (i / items.length) * Math.PI * 2 + r;
        const dist = size * (0.42 + r * 0.12);
        return (
          <motion.span
            key={i}
            className="particle"
            style={{ left: cx, top: size * 0.45 }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.2, rotate: 0 }}
            animate={{ opacity: [0, 1, 0], x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.8, scale: [0.2, 1, 0.5], rotate: 90 }}
            transition={{ duration: 0.95 + r * 0.3, ease: 'easeOut' }}
          >
            <Sparkle color={SPARKLE_COLORS[i % SPARKLE_COLORS.length]} s={(8 + r * 6) * scale} />
          </motion.span>
        );
      })}
    </>
  );
}
