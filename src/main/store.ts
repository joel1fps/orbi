import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanTool, PlanUsage, Settings, ViewMode } from '@shared/types';
import { migrateState } from './migrate';

type StoredSettings = Omit<Settings, 'githubTokenSet'>;

interface Persisted {
  version: 2;
  settings: StoredSettings;
  /** Island anchor (top centre of the widget) when it is not docked. */
  window: { cx?: number; y?: number; docked: boolean };
  view: ViewMode;
  githubTokenEnc?: string;
  bridgeToken: string;
  /** Last limits seen per tool, shown (with their age) right after launch. */
  usage?: Partial<Record<PlanTool, PlanUsage>>;
}

const DEFAULT_SETTINGS: StoredSettings = {
  alwaysOnTop: true,
  mascotStyle: '2d',
  reduceMotion: false,
  followCursor: true,
  permissionTimeoutSec: 60,
  customTools: [],
  githubRepo: '',
  claudeAccountUsage: true,
};

export const dataDir = () => app.getPath('userData');
const file = () => join(dataDir(), 'orbi-state.json');

let state: Persisted;
let timer: NodeJS.Timeout | null = null;

export function loadStore(): void {
  mkdirSync(dataDir(), { recursive: true });
  try {
    const migrated = migrateState(JSON.parse(readFileSync(file(), 'utf8')));
    if (!migrated) throw new Error('unreadable state');
    // Version 2 dropped the Tamagotchi: keep the original file once, by hand-restorable.
    const backup = join(dataDir(), 'orbi-state.v1-backup.json');
    if (migrated.hadPet && !existsSync(backup)) copyFileSync(file(), backup);
    const raw = migrated.state as Partial<Persisted>;
    state = {
      version: 2,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
      window: raw.window ?? { docked: true },
      // Always wake up as the small island; the user opens it when they want.
      view: 'compact',
      githubTokenEnc: raw.githubTokenEnc,
      bridgeToken: raw.bridgeToken ?? randomBytes(18).toString('base64url'),
      usage: raw.usage ?? {},
    };
  } catch {
    state = {
      version: 2,
      settings: { ...DEFAULT_SETTINGS },
      window: { docked: true },
      view: 'compact',
      bridgeToken: randomBytes(18).toString('base64url'),
    };
  }
  persistNow();
}

function persistNow(): void {
  const tmp = file() + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file());
}

export function persist(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      persistNow();
    } catch (err) {
      console.error('[orbi] could not save state', err);
    }
  }, 400);
}

export function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  persistNow();
}

export const store = {
  get settings(): Settings {
    return { ...state.settings, githubTokenSet: Boolean(state.githubTokenEnc) };
  },
  updateSettings(patch: Partial<StoredSettings>): Settings {
    state.settings = { ...state.settings, ...patch };
    persist();
    return store.settings;
  },
  get window() {
    return state.window;
  },
  setWindow(w: Persisted['window']) {
    state.window = w;
    persist();
  },
  get bridgeToken() {
    return state.bridgeToken;
  },
  get usage(): PlanUsage[] {
    return Object.values(state.usage ?? {}).filter((u): u is PlanUsage => Boolean(u));
  },
  saveUsage(u: PlanUsage) {
    state.usage = { ...(state.usage ?? {}), [u.tool]: u };
    persist();
  },
  forgetUsage(tool: PlanTool) {
    if (!state.usage?.[tool]) return;
    const next = { ...state.usage };
    delete next[tool];
    state.usage = next;
    persist();
  },
  getGithubToken(): string | null {
    if (!state.githubTokenEnc) return null;
    try {
      const buf = Buffer.from(state.githubTokenEnc, 'base64');
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
    } catch {
      return null;
    }
  },
  setGithubToken(token: string | null): boolean {
    if (!token) {
      delete state.githubTokenEnc;
      persist();
      return true;
    }
    // Never store the token in plain text; refuse if the OS keychain is unavailable.
    if (!safeStorage.isEncryptionAvailable()) return false;
    state.githubTokenEnc = safeStorage.encryptString(token).toString('base64');
    persist();
    return true;
  },
};
