import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '../store';
import { Compact } from './Compact';
import { Panel } from './Panel';
import { PermissionCard } from './PermissionCard';

const RADIUS = { compact: 22, toast: 26, permission: 26, panel: 26 } as const;
// Room around the island for its shadow (matches .island box-shadow and .stage padding).
const MARGIN = { side: 34, top: 6, bottom: 56 };

/** Keep the (transparent, costly-to-composite) window exactly as big as the island needs. */
function useFitWindow(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0];
      const w = box ? box.inlineSize : entry.contentRect.width;
      const h = box ? box.blockSize : entry.contentRect.height;
      window.orbi.fitWindow(w + MARGIN.side * 2, h + MARGIN.top + MARGIN.bottom);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

/** Drag the island anywhere; dropping it near the top centre docks it again. */
function useIslandDrag() {
  const st = useRef({ down: false, dragging: false, x: 0, y: 0, moved: false });
  const setView = useApp((s) => s.setView);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('button, input, select, textarea, a, .no-drag, .mascot--interactive')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    st.current = { down: true, dragging: false, x: e.screenX, y: e.screenY, moved: false };
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.down || s.dragging) return;
    if (Math.hypot(e.screenX - s.x, e.screenY - s.y) > 4) {
      s.dragging = true;
      s.moved = true;
      window.orbi.dragStart();
    }
  };
  const onPointerUp = async (e: RPointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.down) return;
    s.down = false;
    if (s.dragging) {
      s.dragging = false;
      const docked = await window.orbi.dragEnd();
      useApp.setState({ docked });
      return;
    }
    // A plain click on the pill opens the panel.
    const v = useApp.getState().view;
    if (v === 'compact' && !(e.target as Element).closest('button')) setView('panel');
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

export function Island() {
  const view = useApp((s) => s.view);
  const tab = useApp((s) => s.tab);
  const toast = useApp((s) => s.toast);
  const permission = useApp((s) => s.hub.permissions[0]);
  const drag = useIslandDrag();
  const islandRef = useRef<HTMLDivElement>(null);
  useFitWindow(islandRef);

  // A pending permission always surfaces (the panel's home shows it inline);
  // once answered, the island goes back to whatever it was showing.
  const inlinePermission = view === 'panel' && tab === 'home';
  const mode = permission && !inlinePermission ? 'permission' : view === 'compact' ? (toast ? 'toast' : 'compact') : view;
  const contentKey = mode === 'panel' ? 'panel' : mode === 'permission' ? 'permission' : 'compact';

  return (
    <motion.div
      ref={islandRef}
      data-hit
      layout
      className="island"
      style={{ borderRadius: RADIUS[mode] }}
      transition={{ layout: { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } }}
      {...drag}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={contentKey}
          layout="position"
          className="island__content"
          initial={{ opacity: 0, filter: 'blur(4px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)', transition: { duration: 0.22, delay: 0.06 } }}
          exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: 0.1 } }}
        >
          {contentKey === 'panel' ? (
            <Panel />
          ) : contentKey === 'permission' && permission ? (
            <div style={{ width: 460, padding: 10 }}>
              <PermissionCard request={permission} compact />
            </div>
          ) : (
            <Compact />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
