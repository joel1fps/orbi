import { animate, useMotionValue, type MotionValue } from 'motion/react';
import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import type { Expression, MascotAction } from './brain';

/**
 * Orbi, rebuilt part by part from the original orbi.svg of the Orbit project
 * (same 120×120 geometry and palette), so every part can move on its own.
 */
const C = {
  outline: '#3d564e',
  body: '#4fb7a2',
  belly: '#7ed5c3',
  ink: '#171d1b',
  foot: '#31423c',
  footTop: '#445c54',
  armR: '#445c54',
  lime: '#a3e635',
  aqua: '#5eead4',
  sun: '#facc15',
  blush: '#f472b6',
  ringBack: '#3ea591',
  ringHi: '#7ed5c3',
  shadow: '#101513',
};

type EyeShape = 'open' | 'wide' | 'happy' | 'closed';
type MouthShape = 'smile' | 'grin' | 'cat' | 'o' | 'o-small' | 'wavy' | 'flat' | 'sad' | 'snore' | 'chomp';

interface Face {
  eyes: EyeShape;
  /** 0 = lids up, 1 = closed. */
  lid: number;
  /** Degrees the inner corner of each lid is raised (worried > 0, focused < 0). */
  tilt: number;
  mouth: MouthShape;
  blush: number;
}

const FACES: Record<Expression, Face> = {
  neutral: { eyes: 'open', lid: 0, tilt: 0, mouth: 'smile', blush: 0.6 },
  happy: { eyes: 'open', lid: 0, tilt: 0, mouth: 'grin', blush: 0.72 },
  joy: { eyes: 'happy', lid: 0, tilt: 0, mouth: 'grin', blush: 0.85 },
  love: { eyes: 'happy', lid: 0, tilt: 0, mouth: 'cat', blush: 1 },
  curious: { eyes: 'wide', lid: 0, tilt: 0, mouth: 'o-small', blush: 0.6 },
  surprised: { eyes: 'wide', lid: 0, tilt: 0, mouth: 'o', blush: 0.45 },
  worried: { eyes: 'open', lid: 0.2, tilt: 15, mouth: 'wavy', blush: 0.45 },
  focused: { eyes: 'open', lid: 0.2, tilt: 4, mouth: 'smile', blush: 0.55 },
  sad: { eyes: 'open', lid: 0.3, tilt: 17, mouth: 'sad', blush: 0.35 },
  sleepy: { eyes: 'open', lid: 0.56, tilt: 0, mouth: 'flat', blush: 0.5 },
  asleep: { eyes: 'closed', lid: 0, tilt: 0, mouth: 'snore', blush: 0.55 },
  eating: { eyes: 'happy', lid: 0, tilt: 0, mouth: 'chomp', blush: 0.8 },
  refuse: { eyes: 'closed', lid: 0, tilt: 0, mouth: 'flat', blush: 0.4 },
};

// ---------- orbit path (front arc, then back arc), sampled once ----------

type P = [number, number];
function cubic(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function sampleArc(p0: P, p1: P, p2: P, p3: P, n: number): P[] {
  const raw: P[] = [];
  for (let i = 0; i <= 200; i++) raw.push(cubic(p0, p1, p2, p3, i / 200));
  const len = [0];
  for (let i = 1; i < raw.length; i++) len.push(len[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = len[len.length - 1];
  const out: P[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (j < len.length - 2 && len[j + 1] < target) j++;
    const f = (target - len[j]) / (len[j + 1] - len[j] || 1);
    out.push([raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f, raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f]);
  }
  return out;
}

const FRONT = sampleArc([16, 66], [20, 82], [100, 76], [104, 58], 120);
const BACK = sampleArc([104, 58], [106, 46], [14, 54], [16, 66], 120);
const ORBIT = [...FRONT, ...BACK]; // first half in front of Orbi, second half behind

// ---------- tiny helper: drive an SVG transform attribute from motion values ----------

function useTransformAttr(ref: RefObject<SVGGElement | null>, values: MotionValue<number>[], build: () => string, minMs = 0) {
  const buildRef = useRef(build);
  buildRef.current = build;
  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const apply = (now = performance.now()) => {
      raf = 0;
      // Frame budget: writes that come faster than minMs wait for the next slot on a timer, not frame by frame.
      if (minMs && now - last < minMs) {
        timer = setTimeout(() => {
          timer = undefined;
          raf = requestAnimationFrame(apply);
        }, minMs - (now - last));
        return;
      }
      last = now;
      ref.current?.setAttribute('transform', buildRef.current());
    };
    const schedule = () => {
      if (!raf && !timer) raf = requestAnimationFrame(apply);
    };
    apply(0);
    const offs = values.map((v) => v.on('change', schedule));
    return () => {
      offs.forEach((o) => o());
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, values);
}

// ---------- parts ----------

function Eye({ cx, shape, lid, tilt, side, blink }: { cx: number; shape: EyeShape; lid: number; tilt: number; side: 1 | -1; blink: MotionValue<number> }) {
  const lidRef = useRef<SVGGElement>(null);
  const openRef = useRef<SVGGElement>(null);
  useTransformAttr(openRef, [blink], () => `scale(1 ${blink.get()})`);
  // Lids: a body-coloured shape sliding down over the eye, rotated by the expression.
  const lidBottom = -8.6 + lid * 17;
  return (
    <g transform={`translate(${cx} 58)`}>
      {shape === 'happy' ? (
        <path d="M-6 2.6 Q0 -5.6 6 2.6" stroke={C.ink} strokeWidth={2.7} strokeLinecap="round" fill="none" />
      ) : shape === 'closed' ? (
        <path d="M-6 -0.5 Q0 4.6 6 -0.5" stroke={C.ink} strokeWidth={2.5} strokeLinecap="round" fill="none" />
      ) : (
        <g ref={openRef}>
          {shape === 'wide' ? (
            <>
              <ellipse rx={7.3} ry={8.8} fill={C.ink} />
              <circle cx={-1.8} cy={-2.9} r={3.2} fill="#fff" />
              <circle cx={2.3} cy={3.3} r={1.5} fill="#fff" opacity={0.85} />
            </>
          ) : (
            <>
              <ellipse rx={6.5} ry={8} fill={C.ink} />
              <circle cx={-1.5} cy={-2.5} r={2.8} fill="#fff" />
              <circle cx={2} cy={3} r={1.3} fill="#fff" opacity={0.8} />
            </>
          )}
        </g>
      )}
      {lid > 0 && shape !== 'happy' && shape !== 'closed' ? (
        <g ref={lidRef} transform={`rotate(${-side * tilt})`}>
          <rect x={-10} y={-22} width={20} height={22 + lidBottom} fill={C.body} />
          <line x1={-7.2} x2={7.2} y1={lidBottom} y2={lidBottom} stroke={C.outline} strokeWidth={1.1} strokeLinecap="round" opacity={0.55} />
        </g>
      ) : null}
    </g>
  );
}

function Mouth({ shape }: { shape: MouthShape }) {
  switch (shape) {
    case 'grin':
      return (
        <g>
          <path d="M55 64.4 Q60 72.6 65 64.4 Q60 66.2 55 64.4 Z" fill={C.ink} />
          <ellipse cx={60} cy={69.1} rx={2.2} ry={1.2} fill="#f08aa8" />
        </g>
      );
    case 'cat':
      return <path d="M55.4 65 Q57.7 68.4 60 65.6 Q62.3 68.4 64.6 65" stroke={C.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    case 'o':
      return <ellipse cx={60} cy={67.2} rx={2.6} ry={3.2} fill={C.ink} />;
    case 'o-small':
      return <ellipse cx={60} cy={66.6} rx={1.7} ry={2} fill={C.ink} />;
    case 'wavy':
      return <path d="M55.6 67 Q57.8 65 60 67 Q62.2 69 64.4 67" stroke={C.ink} strokeWidth={2.2} strokeLinecap="round" fill="none" />;
    case 'flat':
      return <path d="M57 66.4 L63 66.4" stroke={C.ink} strokeWidth={2.3} strokeLinecap="round" />;
    case 'sad':
      return <path d="M56.4 68 Q60 64.6 63.6 68" stroke={C.ink} strokeWidth={2.3} strokeLinecap="round" fill="none" />;
    case 'snore':
      return <ellipse className="o2d-snore" cx={60} cy={67} rx={1.6} ry={1.9} fill={C.ink} />;
    case 'chomp':
      return (
        <g className="o2d-chomp">
          <ellipse cx={60} cy={67} rx={3.4} ry={3.6} fill={C.ink} />
          <ellipse cx={60} cy={69} rx={2} ry={1.1} fill="#f08aa8" />
        </g>
      );
    default:
      return <path d="M56 65 Q60 69 64 65" stroke={C.ink} strokeWidth={2.5} strokeLinecap="round" fill="none" />;
  }
}

// ---------- the creature ----------

export type Ambient = 'minimal' | 'calm' | 'full';

export interface Orbi2DProps {
  size: number;
  /**
   * How much idle motion to run. Every frame of the transparent window costs
   * a full copy, so: minimal (pill) = no idle loop, calm (panel) = 20 fps,
   * full = 30 fps. Actions and cursor follow are capped at 60.
   */
  ambient: Ambient;
  expression: Expression;
  action: MascotAction | null;
  working: boolean;
  sleeping: boolean;
  still: boolean;
  lookX: MotionValue<number>;
  lookY: MotionValue<number>;
}

export const Orbi2D = memo(function Orbi2D({ size, ambient, expression, action, working, sleeping, still, lookX, lookY }: Orbi2DProps) {
  // The face on screen trails the requested one by a blink, so it never jumps.
  const [shown, setShown] = useState(expression);
  const face = FACES[shown];

  const hop = useMotionValue(0);
  const sx = useMotionValue(1);
  const sy = useMotionValue(1);
  const shake = useMotionValue(0);
  const armR = useMotionValue(0);
  const armL = useMotionValue(0);
  const antL = useMotionValue(0);
  const antR = useMotionValue(0);
  const blink = useMotionValue(1);

  useEffect(() => {
    if (expression === shown) {
      if (blink.get() < 1) void animate(blink, 1, { duration: 0.1 });
      return;
    }
    if (still) {
      setShown(expression);
      return;
    }
    const closing = animate(blink, 0.08, { duration: 0.07 });
    const t = setTimeout(() => {
      setShown(expression);
      void animate(blink, 1, { duration: 0.12 });
    }, 75);
    return () => {
      clearTimeout(t);
      closing.stop();
    };
  }, [expression, shown, still, blink]);
  // Displays can run at 144 Hz; Orbi never needs more than 60 writes per second.
  const budget = ambient === 'full' ? 1000 / 60 : 1000 / 30;

  const bodyRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const armRRef = useRef<SVGGElement>(null);
  const armLRef = useRef<SVGGElement>(null);
  const antLRef = useRef<SVGGElement>(null);
  const antRRef = useRef<SVGGElement>(null);
  const satFront = useRef<SVGGElement>(null);
  const satBack = useRef<SVGGElement>(null);
  const breatheRef = useRef<SVGGElement>(null);
  const antLInner = useRef<SVGGElement>(null);
  const antRInner = useRef<SVGGElement>(null);
  const armSway = useRef<SVGGElement>(null);
  const tipL = useRef<SVGCircleElement>(null);
  const tipR = useRef<SVGCircleElement>(null);
  const twinkle = useRef<SVGPathElement>(null);
  const boostUntil = useRef(0);
  const live = useRef({ working, sleeping });
  live.current = { working, sleeping };

  useTransformAttr(bodyRef, [hop, sx, sy, shake, lookX], () => {
    const tilt = lookX.get() * 3.2 + shake.get();
    return `translate(0 ${hop.get()}) rotate(${tilt} 60 100) translate(60 104) scale(${sx.get()} ${sy.get()}) translate(-60 -104)`;
  }, budget);
  useTransformAttr(shadowRef, [hop], () => {
    const k = 1 + hop.get() / 40; // hop is negative in the air
    return `translate(60 110) scale(${k} ${k}) translate(-60 -110)`;
  });
  useTransformAttr(faceRef, [lookX, lookY], () => `translate(${lookX.get() * 2.4} ${lookY.get() * 1.8})`, budget);
  useTransformAttr(eyesRef, [lookX, lookY], () => `translate(${lookX.get() * 1.5} ${lookY.get() * 1.3})`, budget);
  useTransformAttr(armRRef, [armR], () => `rotate(${armR.get()} 89 63)`);
  useTransformAttr(armLRef, [armL], () => `rotate(${armL.get()} 33 70)`);
  useTransformAttr(antLRef, [antL, lookX], () => `rotate(${antL.get() - lookX.get() * 4} 42 33)`, budget);
  useTransformAttr(antRRef, [antR, lookX], () => `rotate(${antR.get() - lookX.get() * 4} 78 33)`, budget);
  // Ambient life: one capped-FPS clock drives breathing, antennae, arm, tip
  // glow and the satellite. Skipped entirely in the pill.
  useEffect(() => {
    const placeSat = (phase: number) => {
      const i = Math.floor((((phase % 1) + 1) % 1) * ORBIT.length) % ORBIT.length;
      const [x, y] = ORBIT[i];
      const front = i < FRONT.length; // first half of the loop is the arc in front of Orbi
      satFront.current?.setAttribute('transform', `translate(${x} ${y})`);
      satBack.current?.setAttribute('transform', `translate(${x} ${y}) scale(0.8)`);
      satFront.current?.setAttribute('opacity', front ? '1' : '0');
      satBack.current?.setAttribute('opacity', front ? '0' : '0.9');
    };
    let phase = 0.18;
    placeSat(phase);
    if (ambient === 'minimal' || still) return;
    const frameMs = 1000 / (ambient === 'full' ? 30 : 20);
    const TAU = Math.PI * 2;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let prev = performance.now();
    // Sleep between frames instead of waking on every display refresh (144 Hz
    // would be 144 wake-ups a second for 20 drawn frames). Asleep, a slow
    // breath needs fewer frames; hidden, just check once a second.
    const next = () => {
      const ms = document.hidden ? 1000 : live.current.sleeping ? 125 : frameMs;
      timer = setTimeout(() => (raf = requestAnimationFrame(loop)), ms);
    };
    const loop = (now: number) => {
      next();
      if (document.hidden) return;
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const t = now / 1000;
      const { working: w, sleeping: z } = live.current;
      const speed = now < boostUntil.current ? 6 : z ? 0.35 : w ? 3.2 : 1;
      phase += (dt / 9) * speed;
      placeSat(phase);
      const b = ((1 - Math.cos((TAU * t) / (z ? 5.4 : 3.6))) / 2) * (z ? 1.3 : 1);
      breatheRef.current?.setAttribute('transform', `translate(60 100) scale(${1 + 0.014 * b} ${1 + 0.032 * b}) translate(-60 -100)`);
      antLInner.current?.setAttribute('transform', `rotate(${0.25 + 3.25 * Math.sin((TAU * t) / 4.4)} 42 33)`);
      antRInner.current?.setAttribute('transform', `rotate(${0.25 - 3.25 * Math.sin((TAU * t) / 4.8)} 78 33)`);
      armSway.current?.setAttribute('transform', `rotate(${(-5 * (1 - Math.cos((TAU * t) / 3.9))) / 2} 89 63)`);
      const gp = w ? 1.1 : 2.8;
      tipL.current?.setAttribute('opacity', (0.25 + (0.65 * (1 - Math.cos((TAU * t) / gp))) / 2).toFixed(3));
      tipR.current?.setAttribute('opacity', (0.25 + (0.65 * (1 + Math.cos((TAU * t) / gp))) / 2).toFixed(3));
      if (ambient === 'full') twinkle.current?.setAttribute('opacity', (0.2 + (0.7 * (1 - Math.cos((TAU * t) / 3.2))) / 2).toFixed(3));
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [ambient, still]);

  // Blinking: irregular, sometimes double.
  useEffect(() => {
    if (still || face.eyes === 'happy' || face.eyes === 'closed') return;
    let t: ReturnType<typeof setTimeout>;
    const once = () => animate(blink, [1, 0.08, 1], { duration: 0.16, times: [0, 0.45, 1] });
    const loop = () => {
      t = setTimeout(
        () => {
          void once().then(() => {
            if (Math.random() < 0.22) setTimeout(() => void once(), 90);
          });
          loop();
        },
        2200 + Math.random() * 4200,
      );
    };
    loop();
    return () => clearTimeout(t);
  }, [still, face.eyes, blink]);

  // One-shot actions.
  useEffect(() => {
    if (!action || still) return;
    switch (action.name) {
      case 'enter': {
        // Drops in, lands with a squash, shakes the antennae out, waves and blinks twice.
        const land = { duration: 1, times: [0, 0.3, 0.5, 0.6, 0.8, 1] };
        void animate(hop, [-46, -46, 0, -7, 0], { duration: 0.9, times: [0, 0.05, 0.55, 0.78, 1], ease: 'easeIn' });
        void animate(sy, [1, 1.08, 1.08, 0.82, 1.06, 1], land);
        void animate(sx, [1, 0.94, 0.94, 1.16, 0.97, 1], land);
        void animate(antL, [0, 18, 18, -14, 8, 0], { duration: 1.1 });
        void animate(antR, [0, -18, -18, 14, -8, 0], { duration: 1.1 });
        void animate(armR, [0, 0, -18, 14, -18, 14, 0], { duration: 2.2, times: [0, 0.45, 0.58, 0.7, 0.8, 0.9, 1] });
        void animate(blink, [1, 0.08, 1], { duration: 0.16, delay: 1.5 });
        void animate(blink, [1, 0.08, 1], { duration: 0.16, delay: 1.78 });
        boostUntil.current = performance.now() + 1400;
        break;
      }
      case 'hop':
        void animate(sy, [1, 0.9, 1.06, 0.94, 1], { duration: 0.6, times: [0, 0.18, 0.45, 0.8, 1] });
        void animate(sx, [1, 1.08, 0.96, 1.05, 1], { duration: 0.6, times: [0, 0.18, 0.45, 0.8, 1] });
        void animate(hop, [0, 0, -9, 0, 0], { duration: 0.6, times: [0, 0.18, 0.5, 0.82, 1], ease: 'easeOut' });
        break;
      case 'bounce':
      case 'celebrate':
        void animate(hop, [0, -11, 0, -7, 0], { duration: 0.9, times: [0, 0.25, 0.5, 0.72, 1], ease: 'easeInOut' });
        void animate(sy, [1, 1.06, 0.92, 1.04, 0.96, 1], { duration: 0.9 });
        void animate(armR, [0, -22, 14, -22, 10, 0], { duration: 0.9 });
        void animate(armL, [0, 30, 10, 30, 0], { duration: 0.9 });
        void animate(antL, [0, -14, 10, -6, 0], { duration: 0.9 });
        void animate(antR, [0, 14, -10, 6, 0], { duration: 0.9 });
        boostUntil.current = performance.now() + 1100;
        break;
      case 'wave':
        void animate(armR, [0, -18, 14, -18, 14, -10, 0], { duration: 1.3, ease: 'easeInOut' });
        break;
      case 'shake':
        void animate(shake, [0, -7, 6, -5, 4, -2, 0], { duration: 0.55 });
        break;
      case 'wiggle':
        void animate(antL, [0, -12, 9, -6, 3, 0], { duration: 0.8 });
        void animate(antR, [0, 12, -9, 6, -3, 0], { duration: 0.8 });
        break;
      case 'squash':
        void animate(sx, [1, 1.12, 0.96, 1], { duration: 0.42 });
        void animate(sy, [1, 0.86, 1.05, 1], { duration: 0.42 });
        void animate(antL, [0, 10, -6, 0], { duration: 0.5 });
        void animate(antR, [0, -10, 6, 0], { duration: 0.5 });
        break;
      case 'chomp':
        void animate(sy, [1, 0.96, 1.02, 0.96, 1.02, 0.97, 1], { duration: 1.2 });
        break;
      case 'yawn':
        void animate(sy, [1, 1.05, 1.05, 1], { duration: 1.4, times: [0, 0.3, 0.75, 1] });
        void animate(armL, [0, 22, 22, 0], { duration: 1.4, times: [0, 0.3, 0.75, 1] });
        break;
      case 'stretch':
        void animate(sy, [1, 1.07, 0.97, 1], { duration: 1.1 });
        void animate(sx, [1, 0.95, 1.02, 1], { duration: 1.1 });
        void animate(armR, [0, -16, 0], { duration: 1.1 });
        void animate(armL, [0, 26, 0], { duration: 1.1 });
        break;
    }
  }, [action, still, sx, sy, hop, shake, armR, armL, antL, antR]);

  const cls = `o2d${sleeping ? ' sleeping' : ''}${working ? ' working' : ''}${still ? ' still' : ''}`;

  return (
    <svg className={cls} viewBox="0 0 120 120" width={size} height={size} overflow="visible" aria-hidden="true">
      <defs>
        <radialGradient id="o2d-tip-lime">
          <stop offset="0" stopColor={C.lime} stopOpacity="0.85" />
          <stop offset="1" stopColor={C.lime} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="o2d-tip-aqua">
          <stop offset="0" stopColor={C.aqua} stopOpacity="0.85" />
          <stop offset="1" stopColor={C.aqua} stopOpacity="0" />
        </radialGradient>
      </defs>

      <g ref={shadowRef}>
        <ellipse cx={60} cy={110} rx={34} ry={6} fill={C.shadow} opacity={0.4} />
      </g>

      <g ref={bodyRef}>
        {/* Back of the orbital ring and the satellite while it passes behind */}
        <path d="M16 66 C 14 54, 106 46, 104 58" stroke={C.ringBack} strokeWidth={5} strokeLinecap="round" opacity={0.75} fill="none" />
        <g ref={satBack} opacity={0}>
          <circle r={4.5} fill="#c9a514" />
          <circle r={2.2} fill="#f5f0d0" />
        </g>
        <circle cx={20} cy={63} r={3} fill={C.lime} />
        <circle cx={98} cy={51} r={2.5} fill={C.aqua} />

        {/* Feet stay planted while the body breathes */}
        <ellipse cx={44} cy={98} rx={10} ry={7} fill={C.foot} />
        <ellipse cx={76} cy={98} rx={10} ry={7} fill={C.foot} />
        <ellipse cx={44} cy={97} rx={8} ry={5} fill={C.footTop} />
        <ellipse cx={76} cy={97} rx={8} ry={5} fill={C.footTop} />

        <g ref={breatheRef}>
          <path d="M 60 28 C 34 28, 26 48, 26 74 C 26 94, 38 102, 60 102 C 82 102, 94 94, 94 74 C 94 48, 86 28, 60 28 Z" fill={C.outline} />
          <path d="M 60 30 C 37 30, 29 49, 29 73 C 29 92, 40 100, 60 100 C 80 100, 91 92, 91 73 C 91 49, 83 30, 60 30 Z" fill={C.body} />
          <ellipse cx={60} cy={78} rx={20} ry={16} fill={C.belly} />

          {/* Antennae with cosmic tips */}
          <g ref={antLRef}>
            <g ref={antLInner}>
              <path d="M42 32 C 38 20, 32 15, 27 16" stroke={C.outline} strokeWidth={4} strokeLinecap="round" fill="none" />
              <circle ref={tipL} cx={26} cy={16} r={12} fill="url(#o2d-tip-lime)" opacity={0.55} />
              <circle cx={26} cy={16} r={6} fill={C.lime} />
              <circle cx={26} cy={16} r={3} fill="#fff" opacity={0.8} />
            </g>
          </g>
          <g ref={antRRef}>
            <g ref={antRInner}>
              <path d="M78 32 C 82 20, 88 15, 93 16" stroke={C.outline} strokeWidth={4} strokeLinecap="round" fill="none" />
              <circle ref={tipR} cx={94} cy={16} r={12} fill="url(#o2d-tip-aqua)" opacity={0.55} />
              <circle cx={94} cy={16} r={6} fill={C.aqua} />
              <circle cx={94} cy={16} r={3} fill="#fff" opacity={0.8} />
            </g>
          </g>

          {/* Left paw resting */}
          <g ref={armLRef}>
            <path d="M 28 68 C 22 72, 20 80, 26 84 C 30 87, 35 84, 34 76 Z" fill={C.outline} />
          </g>

          {/* Face */}
          <g ref={faceRef}>
            <ellipse cx={41} cy={67} rx={5} ry={3.5} fill={C.blush} opacity={face.blush} className="o2d-cheek" />
            <ellipse cx={79} cy={67} rx={5} ry={3.5} fill={C.blush} opacity={face.blush} className="o2d-cheek" />
            <g ref={eyesRef}>
              <Eye cx={47} side={1} shape={face.eyes} lid={face.lid} tilt={face.tilt} blink={blink} />
              <Eye cx={73} side={-1} shape={face.eyes} lid={face.lid} tilt={face.tilt} blink={blink} />
            </g>
            <Mouth shape={face.mouth} />
          </g>

          {/* Right paw, raised in Orbi's signature wave */}
          <g ref={armRRef}>
            <g ref={armSway}>
              <path d="M 90 64 C 98 58, 106 52, 107 45 C 108 40, 100 38, 93 46 C 89 51, 88 58, 88 64 Z" fill={C.armR} />
              <circle cx={104} cy={44} r={5} fill={C.body} />
            </g>
          </g>
        </g>

        {/* Front of the ring, in front of the belly */}
        <path d="M 16 66 C 20 82, 100 76, 104 58" stroke={C.body} strokeWidth={5} strokeLinecap="round" fill="none" />
        <path d="M 26 71 C 36 80, 84 78, 94 65" stroke={C.ringHi} strokeWidth={2} strokeLinecap="round" opacity={0.9} fill="none" />
        <g ref={satFront}>
          <circle r={4.5} fill={C.sun} />
          <circle r={2.2} fill="#fff" />
        </g>
        <path ref={twinkle} d="M 33 46 Q 35 48 37 46 Q 35 44 33 46 Z" fill="#fff" opacity={0.7} />
      </g>
    </svg>
  );
});
