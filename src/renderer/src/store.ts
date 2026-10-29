import { create } from 'zustand';
import { act, tick, type PetAction, type PetOutcome } from '@shared/pet';
import type {
  CursorInfo,
  HubState,
  MainCommand,
  OrbiEvent,
  PanelTab,
  PetState,
  PlanTool,
  Settings,
  ViewMode,
} from '@shared/types';

/** Short-lived moods triggered by something that just happened. */
export type ReactionKind =
  | 'start'
  | 'done'
  | 'error'
  | 'waiting'
  | 'boop'
  | 'pet'
  | 'feed'
  | 'play'
  | 'refuse'
  | 'tired'
  | 'sleep'
  | 'wake'
  | 'hello'
  | 'tickle'
  | 'startle';

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
  pet: PetState;
  docked: boolean;
  reaction: Reaction | null;
  toast: OrbiEvent | null;
  petNote: { text: string; key: number } | null;

  setView: (v: ViewMode) => void;
  setTab: (t: PanelTab) => void;
  setDetail: (d: DetailSlot) => void;
  setSessionIndex: (i: number) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  react: (kind: ReactionKind, ms?: number) => void;
  petAct: (a: PetAction) => PetOutcome;
  refreshPet: () => void;
}

const REACTION_MS: Record<ReactionKind, number> = {
  start: 2200,
  done: 3400,
  error: 3600,
  waiting: 2400,
  boop: 900,
  pet: 1600,
  feed: 2600,
  play: 2400,
  refuse: 1500,
  tired: 2000,
  sleep: 1500,
  wake: 1800,
  hello: 2000,
  tickle: 1800,
  startle: 1100,
};

let reactionKey = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useApp = create<AppState>()((set, get) => ({
  view: 'compact',
  tab: 'home',
  detail: { type: 'session' },
  sessionIndex: 0,
  settings: null as unknown as Settings,
  hub: null as unknown as HubState,
  pet: null as unknown as PetState,
  docked: true,
  reaction: null,
  toast: null,
  petNote: null,

  setView: (view) => {
    if (get().view === view) return;
    set({ view });
    window.orbi.setView(view);
  },
  setTab: (tab) => set({ tab, view: 'panel' }),
  setDetail: (detail) => set({ detail }),
  setSessionIndex: (sessionIndex) => set({ sessionIndex }),
  updateSettings: async (patch) => {
    set({ settings: { ...get().settings, ...patch } });
    const next = await window.orbi.updateSettings(patch);
    set({ settings: next });
  },
  react: (kind, ms) => {
    set({ reaction: { kind, key: ++reactionKey, until: Date.now() + (ms ?? REACTION_MS[kind]) } });
  },
  petAct: (a) => {
    const { pet, outcome } = act(get().pet, a, Date.now());
    set({ pet });
    savePet(pet);
    const r = get().react;
    const note = (text: string) => {
      const key = ++reactionKey;
      set({ petNote: { text, key } });
      setTimeout(() => {
        if (get().petNote?.key === key) set({ petNote: null });
      }, 3600);
    };
    switch (a) {
      case 'feed':
        if (outcome === 'ok') r('feed');
        else if (outcome === 'full') (r('refuse'), note('Orbi está satisfeito agora.'));
        else note('Orbi está dormindo. Acorde-o primeiro.');
        break;
      case 'play':
        if (outcome === 'ok') r('play');
        else if (outcome === 'tired') (r('tired'), note('Cansado demais para brincar. Que tal descansar?'));
        else if (outcome === 'hungry') (r('refuse'), note('Com fome demais para brincar.'));
        else note('Orbi está dormindo. Acorde-o primeiro.');
        break;
      case 'rest':
        r(outcome === 'slept' ? 'sleep' : 'wake');
        break;
      case 'pet':
        r('pet');
        break;
    }
    return outcome;
  },
  refreshPet: () => {
    const pet = tick(get().pet, Date.now());
    set({ pet });
    savePet(pet);
  },
}));

function savePet(pet: PetState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.orbi.savePet(pet), 500);
}

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
  useApp.setState({ settings: init.settings, pet: init.pet, hub: init.hub, view: init.view, docked: init.docked });

  window.orbi.onHub((hub) => useApp.setState({ hub }));
  window.orbi.onSettings((settings) => useApp.setState({ settings }));
  window.orbi.onDocked((docked) => useApp.setState({ docked }));
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

  // Needs drift in real time; refresh the numbers every 30 s.
  setInterval(() => useApp.getState().refreshPet(), 30_000);
  useApp.getState().react('hello');
}

export const dismissToast = () => {
  if (toastTimer) clearTimeout(toastTimer);
  useApp.setState({ toast: null });
};
