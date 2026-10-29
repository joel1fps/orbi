import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { useApp } from './store';
import { Island } from './views/Island';

/**
 * The window is a transparent sheet over the desktop. Only the island is
 * solid: we tell the main process to catch the mouse while the pointer is
 * over it and let clicks fall through everywhere else.
 */
function useClickThrough() {
  useEffect(() => {
    let interactive = false;
    const set = (on: boolean) => {
      if (on === interactive) return;
      interactive = on;
      window.orbi.setInteractive(on);
    };
    const onMove = (e: MouseEvent) => {
      const el = e.target as Element | null;
      set(Boolean(el?.closest?.('[data-hit]')));
    };
    const onLeave = () => set(false);
    window.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, []);
}

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const typing = (e.target as Element)?.closest?.('input, textarea, select');
      if (e.key === 'Escape') {
        if (s.view !== 'compact') s.setView('compact');
        return;
      }
      if (typing) return;
      const p = s.hub.permissions[0];
      if (p && (e.key === 'y' || e.key === 'Y')) window.orbi.respondPermission(p.id, 'allow');
      if (p && (e.key === 'n' || e.key === 'N')) window.orbi.respondPermission(p.id, 'deny');
    };
    // Clicking elsewhere on the desktop folds the panel back into the island.
    const onBlur = () => {
      const s = useApp.getState();
      if (s.view === 'panel' && s.hub.permissions.length === 0) s.setView('compact');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}

export function App() {
  const reduceMotion = useApp((s) => s.settings.reduceMotion);
  useClickThrough();
  useKeys();
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
      <div className="stage">
        <Island />
      </div>
    </MotionConfig>
  );
}
