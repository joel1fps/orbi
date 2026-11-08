import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  CloneProgress,
  CloneResult,
  CursorInfo,
  LocalActionResult,
  LocalProject,
  LocalReview,
  HubState,
  IdleLevel,
  InitialState,
  MainCommand,
  OrbiEvent,
  PermissionDecision,
  PeopleList,
  RepoList,
  RepoListKind,
  TopList,
  Settings,
  SessionFileView,
  SimulationKind,
  SkillActionResult,
  SkillCatalog,
  SkillPlan,
  SkillTargetId,
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
  onIdle: (cb: (l: IdleLevel) => void) => on('orbi:idle', cb),
  onClone: (cb: (p: CloneProgress) => void) => on('github:clone', cb),

  setInteractive: (on: boolean) => ipcRenderer.send('widget:interactive', on),
  dragStart: () => ipcRenderer.send('widget:drag-start'),
  dragEnd: (): Promise<boolean> => ipcRenderer.invoke('widget:drag-end'),
  setView: (v: ViewMode) => ipcRenderer.send('widget:view', v),
  fitWindow: (w: number, h: number) => ipcRenderer.send('widget:fit', w, h),
  hide: () => ipcRenderer.send('widget:hide'),
  dock: () => ipcRenderer.send('widget:dock'),

  updateSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),
  respondPermission: (id: string, d: PermissionDecision) => ipcRenderer.send('permission:respond', id, d),
  simulate: (k: SimulationKind) => ipcRenderer.send('sim:run', k),
  claudeConnect: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('claude:connect'),
  claudeLogin: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('claude:login'),
  codexConnect: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('codex:connect'),
  codexHooks: (on: boolean): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('codex:hooks', on),
  antigravityOpen: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('antigravity:open'),
  antigravityConnect: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('antigravity:connect'),
  antigravityDisconnect: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('antigravity:disconnect'),
  claudeDisconnect: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('claude:disconnect'),
  setGithubToken: (t: string | null): Promise<boolean> => ipcRenderer.invoke('github:token', t),
  refreshGithub: (): Promise<void> => ipcRenderer.invoke('github:refresh'),
  openExternal: (url: string) => ipcRenderer.send('open:external', url),
  openPath: (p: string) => ipcRenderer.send('open:path', p),
  launchTool: (id: string) => ipcRenderer.send('tool:launch', id),
  sessionFile: (sessionId: string): Promise<SessionFileView | null> => ipcRenderer.invoke('session:file', sessionId),
  skillsCatalog: (): Promise<SkillCatalog> => ipcRenderer.invoke('skills:catalog'),
  skillsPlan: (skillId: string, targets: SkillTargetId[]): Promise<SkillPlan | { error: string }> => ipcRenderer.invoke('skills:plan', skillId, targets),
  skillsApply: (planId: string, opts: { replace: boolean; allowScripts: boolean }): Promise<SkillActionResult> =>
    ipcRenderer.invoke('skills:apply', planId, opts),
  skillsUninstall: (skillId: string, targetId: SkillTargetId): Promise<SkillActionResult> => ipcRenderer.invoke('skills:uninstall', skillId, targetId),
  skillsOpen: (targetId: SkillTargetId, name?: string) => ipcRenderer.send('skills:open', targetId, name),
  githubFromGit: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('github:from-git'),
  localList: (fetch = false): Promise<{ projects: LocalProject[]; error?: string }> => ipcRenderer.invoke('local:list', fetch),
  localAdd: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('local:add'),
  localRemove: (path: string) => ipcRenderer.send('local:remove', path),
  localReview: (path: string): Promise<LocalReview | { error: string }> => ipcRenderer.invoke('local:review', path),
  localPublish: (path: string, opts: { name: string; description: string; private: boolean; message: string }): Promise<LocalActionResult> =>
    ipcRenderer.invoke('local:publish', path, opts),
  localSend: (path: string, message: string): Promise<LocalActionResult> => ipcRenderer.invoke('local:send', path, message),
  localIgnore: (path: string): Promise<LocalActionResult> => ipcRenderer.invoke('local:ignore', path),
  localPull: (path: string): Promise<LocalActionResult> => ipcRenderer.invoke('local:pull', path),
  githubRepos: (kind: RepoListKind, query?: string): Promise<RepoList> => ipcRenderer.invoke('github:repos', kind, query),
  githubClone: (fullName: string, pickFolder: boolean): Promise<CloneResult> => ipcRenderer.invoke('github:clone', fullName, pickFolder),
  githubTop: (lang: string, force = false): Promise<TopList> => ipcRenderer.invoke('github:top', lang, force),
  githubFollowing: (force = false): Promise<PeopleList> => ipcRenderer.invoke('github:following', force),
  skillsRefresh: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('skills:refresh'),
  quit: () => ipcRenderer.send('app:quit'),
};

export type OrbiApi = typeof api;

contextBridge.exposeInMainWorld('orbi', api);
