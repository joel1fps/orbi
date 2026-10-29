import { animate, useMotionValue, useSpring, type MotionValue } from 'motion/react';
import { useEffect, type RefObject } from 'react';
import { cursor, onCursor } from '../store';

/**
 * Where Orbi is looking, as two springs in [-1, 1]. Follows the cursor
 * anywhere on screen (positions come from the main process), drifts back to
 * the centre when the cursor rests, and can be overridden for "look around".
 */
export function useLook(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): { x: MotionValue<number>; y: MotionValue<number>; lookAround: () => void } {
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const x = useSpring(tx, { stiffness: 140, damping: 18, mass: 0.6 });
  const y = useSpring(ty, { stiffness: 140, damping: 18, mass: 0.6 });

  useEffect(() => {
    if (!enabled) {
      tx.set(0);
      ty.set(0);
      return;
    }
    let restTimer: ReturnType<typeof setTimeout> | null = null;
    const aim = (cx: number, cy: number) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const dx = cx - (r.left + r.width / 2);
      const dy = cy - (r.top + r.height * 0.45);
      // Soft falloff: full deflection ~400 px away, gentle near the face.
      const reach = 420;
      tx.set(Math.max(-1, Math.min(1, dx / reach)));
      ty.set(Math.max(-1, Math.min(1, dy / reach)));
    };
    if (cursor.at > 0) aim(cursor.x, cursor.y);
    const off = onCursor((c) => {
      aim(c.x, c.y);
      if (restTimer) clearTimeout(restTimer);
      restTimer = setTimeout(() => {
        tx.set(0);
        ty.set(0.15);
      }, 6000);
    });
    return () => {
      off();
      if (restTimer) clearTimeout(restTimer);
    };
  }, [enabled, ref, tx, ty]);

  const lookAround = () => {
    void animate(tx, [tx.get(), -0.9, -0.9, 0.85, 0.85, 0], { duration: 2.4, times: [0, 0.18, 0.4, 0.55, 0.8, 1] });
    void animate(ty, [ty.get(), -0.2, -0.2, 0.1, 0.1, 0], { duration: 2.4, times: [0, 0.18, 0.4, 0.55, 0.8, 1] });
  };

  return { x, y, lookAround };
}
