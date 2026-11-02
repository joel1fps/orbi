import { BrowserWindow, screen, shell, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { CursorInfo, ViewMode } from '@shared/types';
import { resource } from './resources';
import { store } from './store';

/**
 * The widget is one transparent, frameless window that hugs the island
 * (pill → panel). On Windows every frame of a transparent window
 * is copied whole, so the window always matches the content: it grows before
 * a morph and shrinks once the morph has finished. The island's top centre is
 * the anchor, so resizing never moves it on screen. Empty areas let clicks
 * through to the desktop.
 */
const MAX_W = 700;
const MAX_H = 660;
const SNAP_DISTANCE = 56;
const SHRINK_DELAY = 520;

let win: BrowserWindow | null = null;
let view: ViewMode = 'compact';
/** Island anchor: horizontal centre and top edge of the window, in DIP. */
let anchor = { cx: 0, y: 0 };
let size = { w: 440, h: 140 };
let restoreAfterExpand: { cx: number; y: number } | null = null;
let dragTimer: NodeJS.Timeout | null = null;
let cursorTimer: NodeJS.Timeout | null = null;
let shrinkTimer: NodeJS.Timeout | null = null;
let lastCursor: CursorInfo = { x: -1, y: -1 };
let moveAnim: NodeJS.Timeout | null = null;
/** Off when nobody needs the cursor: follow disabled, reduced motion, or Orbi asleep. */
let cursorEnabled = true;

export const getWidget = () => win;
export const getView = () => view;

function workAreaAt(cx: number, y: number): Rectangle {
  return screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(y) + 10 }).workArea;
}

function dockedAnchor(display = screen.getPrimaryDisplay()) {
  const wa = display.workArea;
  return { cx: wa.x + wa.width / 2, y: wa.y };
}

function apply() {
  if (!win) return;
  // setBounds (not setPosition) keeps transparent windows from drifting in size on scaled displays.
  win.setBounds({ x: Math.round(anchor.cx - size.w / 2), y: Math.round(anchor.y), width: size.w, height: size.h });
}

function animateAnchor(cx: number, y: number, ms = 180) {
  if (moveAnim) clearInterval(moveAnim);
  const from = { ...anchor };
  const start = Date.now();
  moveAnim = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    anchor = { cx: from.cx + (cx - from.cx) * e, y: from.y + (y - from.y) * e };
    apply();
    if (t >= 1 && moveAnim) {
      clearInterval(moveAnim);
      moveAnim = null;
    }
  }, 8);
}

export function createWidget(): BrowserWindow {
  const saved = store.window;
  anchor = saved.docked || saved.cx === undefined || saved.y === undefined ? dockedAnchor() : keepPillVisible(saved.cx, saved.y);

  win = new BrowserWindow({
    x: Math.round(anchor.cx - size.w / 2),
    y: Math.round(anchor.y),
    width: size.w,
    height: size.h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'Orbi',
    icon: resource('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(store.settings.alwaysOnTop, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setVisibleOnAllWorkspaces(true);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.once('ready-to-show', () => {
    win?.showInactive();
    startCursor();
  });
  win.on('show', startCursor);
  win.on('hide', stopCursor);
  win.on('closed', () => {
    stopCursor();
    win = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

/** While compact, only the pill needs to stay on screen. */
function keepPillVisible(cx: number, y: number) {
  const wa = workAreaAt(cx, y);
  const half = 120;
  return {
    cx: Math.min(Math.max(cx, wa.x + half), wa.x + wa.width - half),
    y: Math.min(Math.max(y, wa.y), wa.y + wa.height - 60),
  };
}

/** Expanded views must fit entirely. */
function keepWindowVisible(cx: number, y: number, w: number, h: number) {
  const wa = workAreaAt(cx, y);
  return {
    cx: Math.min(Math.max(cx, wa.x + w / 2), wa.x + wa.width - w / 2),
    y: Math.min(Math.max(y, wa.y), wa.y + wa.height - h),
  };
}

/**
 * The renderer reports the size its content needs. Growth applies at once
 * (before the morph is visible); shrinking waits until the morph is done.
 */
export function fitTo(w: number, h: number) {
  if (!win) return;
  const target = { w: Math.min(MAX_W, Math.ceil(w / 2) * 2), h: Math.min(MAX_H, Math.ceil(h)) };
  if (shrinkTimer) {
    clearTimeout(shrinkTimer);
    shrinkTimer = null;
  }
  const grow = { w: Math.max(size.w, target.w), h: Math.max(size.h, target.h) };
  if (grow.w !== size.w || grow.h !== size.h) {
    size = grow;
    if (view !== 'compact') {
      const fit = keepWindowVisible(anchor.cx, anchor.y, size.w, size.h);
      if (fit.cx !== anchor.cx || fit.y !== anchor.y) {
        restoreAfterExpand ??= { ...anchor };
        anchor = fit;
      }
    }
    apply();
  }
  if (target.w !== size.w || target.h !== size.h) {
    shrinkTimer = setTimeout(() => {
      shrinkTimer = null;
      size = target;
      apply();
    }, SHRINK_DELAY);
  }
}

export function setInteractive(on: boolean) {
  win?.setIgnoreMouseEvents(!on, { forward: true });
}

export function setView(next: ViewMode) {
  view = next;
  if (next === 'compact' && restoreAfterExpand) {
    const back = restoreAfterExpand;
    restoreAfterExpand = null;
    setTimeout(() => animateAnchor(back.cx, back.y), SHRINK_DELAY);
  }
}

export function dragStart() {
  if (!win) return;
  if (moveAnim) clearInterval(moveAnim);
  restoreAfterExpand = null;
  const c = screen.getCursorScreenPoint();
  const dx = c.x - anchor.cx;
  const dy = c.y - anchor.y;
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    anchor = { cx: p.x - dx, y: p.y - dy };
    apply();
  }, 8);
}

/** Returns whether the island snapped back into its dock at the top. */
export function dragEnd(): boolean {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  if (!win) return false;
  const dock = dockedAnchor(screen.getDisplayNearestPoint({ x: Math.round(anchor.cx), y: Math.round(anchor.y) }));
  const nearDock = Math.abs(anchor.cx - dock.cx) < SNAP_DISTANCE * 2.5 && anchor.y - dock.y < SNAP_DISTANCE;
  if (nearDock) {
    animateAnchor(dock.cx, dock.y);
    store.setWindow({ docked: true });
    return true;
  }
  const fit = view === 'compact' ? keepPillVisible(anchor.cx, anchor.y) : keepWindowVisible(anchor.cx, anchor.y, size.w, size.h);
  if (fit.cx !== anchor.cx || fit.y !== anchor.y) animateAnchor(fit.cx, fit.y);
  store.setWindow({ docked: false, cx: fit.cx, y: fit.y });
  return false;
}

export function dock() {
  if (!win) return;
  const d = dockedAnchor(screen.getDisplayNearestPoint({ x: Math.round(anchor.cx), y: Math.round(anchor.y) }));
  restoreAfterExpand = null;
  animateAnchor(d.cx, d.y, 240);
  store.setWindow({ docked: true });
}

export function setAlwaysOnTop(on: boolean) {
  win?.setAlwaysOnTop(on, 'floating');
}

export function showWidget() {
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
}

export function hideWidget() {
  win?.hide();
}

/**
 * Orbi looks at the cursor anywhere on screen, so we sample it here (the
 * renderer only sees the mouse while it is over the window). ~30 Hz, and
 * only sends when it actually moved.
 */
function startCursor() {
  if (cursorTimer || !win || !cursorEnabled) return;
  cursorTimer = setInterval(() => {
    if (!win || !win.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const rel = { x: c.x - b.x, y: c.y - b.y };
    if (rel.x === lastCursor.x && rel.y === lastCursor.y) return;
    lastCursor = rel;
    win.webContents.send('orbi:cursor', rel);
  }, 33);
}

function stopCursor() {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = null;
}

export function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

export function setCursorTracking(on: boolean) {
  cursorEnabled = on;
  if (on && win?.isVisible()) startCursor();
  else if (!on) stopCursor();
}
