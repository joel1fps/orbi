import { app, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import type { MainCommand, PermissionDecision, Settings, SimulationKind, ViewMode } from '@shared/types';
import { connectAntigravity, disconnectAntigravity, refreshAntigravityHookStatus, upgradeAntigravityConnection } from './bridge/antigravitySetup';
import { isBridgeCli, prepareBridgeCli, runBridgeCli } from './bridge/cli';
import { connectClaude, disconnectClaude, prepareBridge, refreshClaudeStatus, upgradeClaudeConnection } from './bridge/claudeSetup';
import { startBridgeServer, stopBridgeServer } from './bridge/server';
import { hub } from './hub';
import { startClaudeWatchers } from './integrations/claude';
import { openAntigravity, startAntigravity } from './integrations/antigravity';
import { CLAUDE_ACCOUNT_SOURCE, loginClaudeAccount, readLogin, refreshClaudeUsage, startClaudeUsage } from './integrations/claudeUsage';
import { startCodexWatcher } from './integrations/codex';
import { connectCodex, startCodexUsage } from './integrations/codexUsage';
import { startDetection } from './integrations/detect';
import { startGeminiQuota } from './integrations/geminiQuota';
import { refreshGithub, startGithub } from './integrations/github';
import { startDebugServer } from './debug';
import { resource } from './resources';
import { simulate } from './simulator';
import { flush, loadStore, store } from './store';
import {
  createWidget,
  dock,
  dragEnd,
  dragStart,
  fitTo,
  getView,
  getWidget,
  hideWidget,
  send,
  setAlwaysOnTop,
  setInteractive,
  setView,
  showWidget,
} from './widget';

// Claude Code / Antigravity run `Orbi --orbi-hook` / `--orbi-agy-hook=<Event>`: forward and exit, no UI.
const bridgeCli = isBridgeCli();
if (bridgeCli) {
  prepareBridgeCli();
  void runBridgeCli();
}
else if (!app.requestSingleInstanceLock()) app.quit();

app.setAppUserModelId('orbi.desktop');
// A transparent always-on-top widget: keep Chromium from pausing timers when it's not focused.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Test harness: render at a fixed scale so captures are crisp (ORBI_DSF=2).
if (process.env.ORBI_DSF) app.commandLine.appendSwitch('force-device-scale-factor', process.env.ORBI_DSF);

let tray: Tray | null = null;

/** Value name under HKCU\…\Run. The uninstaller removes it too (resources/installer.nsh). */
const LOGIN_ITEM_NAME = 'Orbi';

function command(cmd: MainCommand) {
  showWidget();
  send('orbi:command', cmd);
}

function buildTrayMenu() {
  const s = store.settings;
  return Menu.buildFromTemplate([
    { label: 'Abrir painel', click: () => command({ type: 'set-view', view: 'panel' }) },
    { label: 'Modo compacto', click: () => command({ type: 'set-view', view: 'compact' }) },
    { type: 'separator' },
    {
      label: 'Sempre visível',
      type: 'checkbox',
      checked: s.alwaysOnTop,
      click: (item) => applySettings({ alwaysOnTop: item.checked }),
    },
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      // In development this would register electron.exe itself, so it only exists once installed.
      visible: app.isPackaged,
      checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, name: LOGIN_ITEM_NAME }),
    },
    { label: 'Voltar para o topo da tela', click: () => (showWidget(), dock(), send('orbi:docked', true)) },
    {
      label: 'Simular evento',
      submenu: [
        { label: 'Início de tarefa', click: () => simulate('start') },
        { label: 'Progresso', click: () => simulate('progress') },
        { label: 'Conclusão', click: () => simulate('done') },
        { label: 'Erro', click: () => simulate('error') },
        { label: 'Pedido de permissão', click: () => (showWidget(), simulate('permission')) },
      ],
    },
    { type: 'separator' },
    { label: 'Mostrar Orbi', click: () => showWidget() },
    { label: 'Esconder na bandeja', click: () => hideWidget() },
    { label: 'Sair', click: () => app.quit() },
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(resource('tray.png'));
  tray = new Tray(img);
  tray.setToolTip('Orbi');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    const w = getWidget();
    if (!w) return;
    if (w.isVisible()) hideWidget();
    else showWidget();
  });
}

function applySettings(patch: Partial<Omit<Settings, 'githubTokenSet'>>): Settings {
  const next = store.updateSettings(patch);
  if ('alwaysOnTop' in patch) setAlwaysOnTop(next.alwaysOnTop);
  if ('permissionTimeoutSec' in patch && hub.claude.serverPort) prepareBridge(hub.claude.serverPort);
  if ('githubRepo' in patch) void refreshGithub();
  if ('claudeAccountUsage' in patch) {
    if (next.claudeAccountUsage) void refreshClaudeUsage();
    else {
      hub.removeUsage('claude', CLAUDE_ACCOUNT_SOURCE);
      void refreshClaudeUsage();
    }
  }
  if ('customTools' in patch) hub.changed();
  tray?.setContextMenu(buildTrayMenu());
  send('orbi:settings', next);
  return next;
}

/** Ctrl+Alt+Y / Ctrl+Alt+N answer the oldest permission card from anywhere, only while one is open. */
function syncPermissionShortcuts(count: number) {
  const keys: [string, PermissionDecision][] = [
    ['Control+Alt+Y', 'allow'],
    ['Control+Alt+N', 'deny'],
  ];
  for (const [accel, decision] of keys) {
    const has = globalShortcut.isRegistered(accel);
    if (count > 0 && !has) {
      globalShortcut.register(accel, () => {
        const p = hub.firstPermission();
        if (p) hub.resolvePermission(p.id, decision);
      });
    } else if (count === 0 && has) {
      globalShortcut.unregister(accel);
    }
  }
  if (count > 0) showWidget();
}

function launch(target: string) {
  if (/^https?:\/\//i.test(target)) return void shell.openExternal(target);
  // Executable path, app or a command typed by the user in Configurações.
  const child = spawn(target, { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => undefined);
  child.unref();
}

function registerIpc() {
  ipcMain.handle('orbi:initial', () => ({
    settings: store.settings,
    hub: hub.snapshot(),
    view: getView(),
    docked: store.window.docked,
  }));
  ipcMain.on('widget:interactive', (_e, on: boolean) => setInteractive(Boolean(on)));
  ipcMain.on('widget:drag-start', () => dragStart());
  ipcMain.handle('widget:drag-end', () => dragEnd());
  ipcMain.on('widget:view', (_e, v: ViewMode) => setView(v));
  ipcMain.on('widget:fit', (_e, w: number, h: number) => fitTo(Number(w), Number(h)));
  ipcMain.on('widget:hide', () => hideWidget());
  ipcMain.on('widget:dock', () => dock());
  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const { githubTokenSet: _ignored, ...rest } = patch;
    return applySettings(rest);
  });
  ipcMain.on('permission:respond', (_e, id: string, decision: PermissionDecision) => hub.resolvePermission(id, decision));
  ipcMain.on('sim:run', (_e, kind: SimulationKind) => simulate(kind));
  // One "Conectar": the hooks, plus the account sign-in when Claude Code has no login yet.
  ipcMain.handle('claude:connect', async () => {
    const r = await connectClaude();
    if (!r.ok || (await readLogin())) return r;
    const login = await loginClaudeAccount();
    return login.ok ? { ok: true, message: `${r.message} Termine o login da sua conta Claude na janela que abriu.` } : r;
  });
  ipcMain.handle('claude:login', () => loginClaudeAccount());
  ipcMain.handle('codex:connect', () => connectCodex());
  ipcMain.handle('antigravity:open', () => openAntigravity());
  ipcMain.handle('antigravity:connect', () => connectAntigravity());
  ipcMain.handle('antigravity:disconnect', () => disconnectAntigravity());
  ipcMain.handle('claude:disconnect', () => disconnectClaude());
  ipcMain.handle('github:token', async (_e, token: string | null) => {
    const ok = store.setGithubToken(token?.trim() || null);
    send('orbi:settings', store.settings);
    if (ok) await refreshGithub();
    return ok;
  });
  ipcMain.handle('github:refresh', () => refreshGithub());
  ipcMain.on('open:external', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  ipcMain.on('open:path', (_e, path: string) => void shell.openPath(path));
  ipcMain.on('tool:launch', (_e, id: string) => {
    const t = store.settings.customTools.find((c) => `custom:${c.id}` === id);
    if (t) launch(t.target);
  });
  ipcMain.on('app:quit', () => app.quit());
}

app.whenReady().then(async () => {
  if (bridgeCli) return;
  loadStore();
  hub.restoreUsage(store.usage);
  registerIpc();
  createWidget();
  createTray();

  const port = await startBridgeServer(store.bridgeToken);
  if (port) prepareBridge(port);
  // Keep existing Claude Code and Antigravity connections valid after updates (old format, moved executable).
  upgradeClaudeConnection();
  upgradeAntigravityConnection();
  refreshClaudeStatus();
  refreshAntigravityHookStatus();
  setInterval(() => {
    refreshClaudeStatus();
    refreshAntigravityHookStatus();
  }, 30_000).unref();

  startDetection();
  startClaudeWatchers();
  startCodexWatcher();
  startCodexUsage();
  startClaudeUsage();
  startAntigravity();
  startGeminiQuota();
  startGithub();

  hub.onPermissionsChanged(syncPermissionShortcuts);
  startDebugServer();
  globalShortcut.register('Control+Alt+O', () => command({ type: 'toggle-panel' }));
});

if (!bridgeCli) {
  app.on('second-instance', () => showWidget());
  app.on('window-all-closed', () => {
    /* lives in the tray */
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopBridgeServer();
    flush();
  });
}
