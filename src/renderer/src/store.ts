import { create } from 'zustand';
import type { CursorInfo, HubState, IdleLevel, MainCommand, OrbiEvent, PanelTab, PlanTool, Settings, ViewMode } from '@shared/types';
import { canReplace, REACTIONS, type ReactionKind } from './mascot/state';

export type { ReactionKind } from './mascot/state';

export interface Reaction {
  kind: ReactionKind;
  key: number;
  until: number;
}

/** What the left card of the panel shows. */
export type DetailSlot = { type: 'session' } | { type: 'usage'; tool: PlanTool } | { type: 'github' };

interface AppState {
  view: ViewMode;
  tab: PanelTab;
  detail: DetailSlot;
  sessionIndex: number;
  settings: Settings;
  hub: HubState;
  docked: boolean;
  /** Play the entrance (first window of this run). */
  intro: boolean;
  idle: IdleLevel;
  reaction: Reaction | null;
  toast: OrbiEvent | null;

  setView: (v: ViewMode) => void;
  setTab: (t: PanelTab) => void;
  setDetail: (d: DetailSlot) => void;
  setSessionIndex: (i: number) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Plays a reaction unless a more important one is still on; events wait their turn. */
  react: (kind: ReactionKind) => void;
}

/** Reactions at or above this priority are events: when blocked they wait instead of being dropped. */
const EVENT_PRIORITY = 50;

let reactionKey = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let queued: { kind: ReactionKind; timer: ReturnType<typeof setTimeout> } | null = null;

export const useApp = create<AppState>()((set, get) => ({
  view: 'compact',
  tab: 'home',
  detail: { type: 'session' },
  sessionIndex: 0,
  settings: null as unknown as Settings,
  hub: null as unknown as HubState,
  docked: true,
  intro: false,
  idle: 'active',
  reaction: null,
  toast: null,

  setView: (view) => {
    const prev = get().view;
    if (prev === view) return;
    set({ view });
    window.orbi.setView(view);
    if (prev === 'compact' && view === 'panel') get().react('peek');
  },
  setTab: (tab) => set({ tab, view: 'panel' }),
  setDetail: (detail) => set({ detail }),
  setSessionIndex: (sessionIndex) => set({ sessionIndex }),
  updateSettings: async (patch) => {
    set({ settings: { ...get().settings, ...patch } });
    const next = await window.orbi.updateSettings(patch);
    set({ settings: next });
  },
  react: (kind) => {
    const now = Date.now();
    const current = get().reaction;
    if (!canReplace(current, kind, now)) {
      const spec = REACTIONS[kind];
      if (spec.priority < EVENT_PRIORITY || !current) return;
      // One slot: the first of two equally important events keeps it.
      if (queued && REACTIONS[queued.kind].priority >= spec.priority) return;
      if (queued) clearTimeout(queued.timer);
      queued = { kind, timer: setTimeout(() => ((queued = null), get().react(kind)), current.until - now + 30) };
      return;
    }
    set({ reaction: { kind, key: ++reactionKey, until: now + REACTIONS[kind].ms } });
  },
}));

// ---------- cursor (transient, kept out of React state) ----------

type CursorListener = (c: CursorInfo, at: number) => void;
const cursorListeners = new Set<CursorListener>();
export const cursor = { x: -1, y: -1, at: 0 };

export function onCursor(fn: CursorListener) {
  cursorListeners.add(fn);
  return () => cursorListeners.delete(fn);
}

// ---------- boot ----------

const EVENT_REACTION: Partial<Record<OrbiEvent['kind'], ReactionKind>> = {
  start: 'start',
  done: 'done',
  error: 'error',
  waiting: 'waiting',
};

export async function boot() {
  const init = await window.orbi.initial();
  const intro = init.intro && !init.settings.reduceMotion;
  useApp.setState({ settings: init.settings, hub: init.hub, view: init.view, docked: init.docked, intro, idle: init.idle });

  window.orbi.onHub((hub) => useApp.setState({ hub }));
  window.orbi.onSettings((settings) => useApp.setState({ settings }));
  window.orbi.onDocked((docked) => useApp.setState({ docked }));
  window.orbi.onIdle((idle) => {
    const s = useApp.getState();
    if (idle === s.idle) return;
    useApp.setState({ idle });
    if (idle === 'active') s.react('wake');
  });
  window.orbi.onCursor((c) => {
    cursor.x = c.x;
    cursor.y = c.y;
    cursor.at = performance.now();
    for (const fn of cursorListeners) fn(c, cursor.at);
  });
  window.orbi.onEvent((e) => {
    const s = useApp.getState();
    const r = EVENT_REACTION[e.kind];
    if (r) s.react(r);
    if (e.kind === 'permission') return; // the permission card is its own surface
    if (e.kind === 'start' && s.toast && s.toast.kind !== 'start') return; // don't hide a result with a start
    useApp.setState({ toast: e });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => useApp.setState({ toast: null }), e.kind === 'start' ? 3500 : 6500);
  });
  window.orbi.onCommand((c: MainCommand) => {
    const s = useApp.getState();
    if (c.type === 'set-view') s.setView(c.view);
    else if (c.type === 'toggle-panel') s.setView(s.view === 'compact' ? 'panel' : 'compact');
    else if (c.type === 'open-tab') s.setTab(c.tab);
  });

  // Once per run: a renderer reload (or a hot update) does not greet again.
  if (intro) useApp.getState().react('intro');
}

export const dismissToast = () => {
  if (toastTimer) clearTimeout(toastTimer);
  useApp.setState({ toast: null });
};
