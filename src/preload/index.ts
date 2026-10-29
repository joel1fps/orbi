import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  CursorInfo,
  HubState,
  InitialState,
  MainCommand,
  OrbiEvent,
  PermissionDecision,
  PetState,
  Settings,
  SimulationKind,
  ViewMode,
} from '@shared/types';

function on<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  initial: (): Promise<InitialState> => ipcRenderer.invoke('orbi:initial'),
  onHub: (cb: (s: HubState) => void) => on('hub:state', cb),
  onEvent: (cb: (e: OrbiEvent) => void) => on('hub:event', cb),
  onCursor: (cb: (c: CursorInfo) => void) => on('orbi:cursor', cb),
  onCommand: (cb: (c: MainCommand) => void) => on('orbi:command', cb),
  onSettings: (cb: (s: Settings) => void) => on('orbi:settings', cb),
  onDocked: (cb: (d: boolean) => void) => on('orbi:docked', cb),

  setInteractive: (on: boolean) => ipcRenderer.send('widget:interactive', on),
  dragStart: () => ipcRenderer.send('widget:drag-start'),
  dragEnd: (): Promise<boolean> => ipcRenderer.invoke('widget:drag-end'),
  setView: (v: ViewMode) => ipcRenderer.send('widget:view', v),
  fitWindow: (w: number, h: number) => ipcRenderer.send('widget:fit', w, h),
  hide: () => ipcRenderer.send('widget:hide'),
  dock: () => ipcRenderer.send('widget:dock'),

  updateSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),
  savePet: (pet: PetState) => ipcRenderer.send('pet:save', pet),
  respondPermission: (id: string, d: PermissionDecision) => ipcRenderer.send('permission:respond', id, d),
  simulate: (k: SimulationKind) => ipcRenderer.send('sim:run', k),
  claudeConnect: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('claude:connect'),
  claudeLogin: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('claude:login'),
  codexConnect: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('codex:connect'),
  antigravityOpen: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('antigravity:open'),
  claudeDisconnect: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('claude:disconnect'),
  setGithubToken: (t: string | null): Promise<boolean> => ipcRenderer.invoke('github:token', t),
  refreshGithub: (): Promise<void> => ipcRenderer.invoke('github:refresh'),
  openExternal: (url: string) => ipcRenderer.send('open:external', url),
  openPath: (p: string) => ipcRenderer.send('open:path', p),
  launchTool: (id: string) => ipcRenderer.send('tool:launch', id),
  quit: () => ipcRenderer.send('app:quit'),
};

export type OrbiApi = typeof api;

contextBridge.exposeInMainWorld('orbi', api);
