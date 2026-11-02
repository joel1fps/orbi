export type ViewMode = 'compact' | 'panel';
export type PanelTab = 'home' | 'arsenal' | 'tools' | 'settings';
export type MascotStyle = '2d' | '3d';

export type BuiltinToolId = 'claude' | 'codex' | 'antigravity' | 'gemini' | 'hermes' | 'github';
export type PlanTool = 'claude' | 'codex' | 'antigravity' | 'gemini';
export type ToolId = BuiltinToolId | `custom:${string}`;

/**
 * What Orbi actually knows about a tool. Every state maps to something we
 * observed on this machine — nothing here is estimated.
 */
export type ToolAvailability =
  | 'active' // activity observed in the last minutes
  | 'idle' // installed / has data, nothing happening now
  | 'not-installed'
  | 'not-connected' // installed but needs the user to connect it (GitHub token)
  | 'shortcut' // custom tool: a launcher, no telemetry
  | 'error';

export interface ToolStatus {
  id: ToolId;
  name: string;
  /** Fits a chip. */
  short?: string;
  color: string;
  availability: ToolAvailability;
  detail: string;
  /** Where the information comes from, shown on hover. */
  source: string;
  lastActivityAt?: number;
  attention?: boolean;
  installHint?: { label: string; url: string };
}

export type SessionState = 'working' | 'waiting' | 'done' | 'error' | 'idle';

export interface AgentSession {
  id: string;
  tool: ToolId;
  project: string;
  cwd?: string;
  state: SessionState;
  /** What the agent is doing right now, e.g. "Edit billing.ts". */
  current?: string;
  /** Monospace payload for `current`, e.g. a shell command. */
  currentCode?: string;
  lastStep?: { label: string; ok: boolean };
  steps: number;
  startedAt: number;
  updatedAt: number;
  summary?: string;
  simulated?: boolean;
  source: 'hooks' | 'transcript' | 'rollout' | 'simulator';
}

export interface UsageWindow {
  usedPercent: number;
  /** Unix ms. */
  resetsAt?: number;
  windowMinutes?: number;
}

export interface ModelQuota {
  label: string;
  usedPercent: number;
  resetsAt?: number;
}

export interface PlanUsage {
  tool: PlanTool;
  /** Per-model quotas (Antigravity), in addition to the headline window. */
  models?: ModelQuota[];
  plan?: string;
  fiveHour?: UsageWindow;
  week?: UsageWindow;
  /** When the source recorded these numbers (Unix ms). */
  observedAt: number;
  source: string;
  simulated?: boolean;
}

export interface PermissionRequest {
  id: string;
  tool: ToolId;
  sessionId?: string;
  project?: string;
  toolName: string;
  summary: string;
  description?: string;
  createdAt: number;
  expiresAt: number;
  simulated?: boolean;
}

export type PermissionDecision = 'allow' | 'deny' | 'pass';

export type OrbiEventKind = 'start' | 'progress' | 'done' | 'error' | 'permission' | 'waiting';

export interface OrbiEvent {
  id: string;
  kind: OrbiEventKind;
  tool: ToolId;
  title: string;
  detail?: string;
  project?: string;
  sessionId?: string;
  at: number;
  simulated?: boolean;
}

export type CiState = 'success' | 'failure' | 'pending' | 'none';

export interface GithubSnapshot {
  ok: true;
  login: string;
  myOpenPRs: { repo: string; number: number; title: string; url: string; ci: CiState }[];
  reviewRequests: number;
  defaultBranchCI?: { repo: string; branch: string; state: CiState };
  contributions?: { total: number; streak: number; days: { date: string; count: number }[] };
  fetchedAt: number;
  via: 'token' | 'gh';
}

export interface GithubError {
  ok: false;
  error: string;
  fetchedAt: number;
}

export interface ClaudeBridgeState {
  hooksInstalled: boolean;
  statuslineInstalled: boolean;
  /** Another statusLine was configured before; Orbi will not replace it. */
  statuslineForeign: boolean;
  serverPort: number;
  serverOk: boolean;
  lastHookAt?: number;
  settingsPath: string;
}

export interface AntigravityBridgeState {
  hooksInstalled: boolean;
  lastHookAt?: number;
  hooksPath: string;
}

export interface HubState {
  tools: ToolStatus[];
  sessions: AgentSession[];
  usage: PlanUsage[];
  /** Why a tool has no limits to show, and what to do about it. */
  limitNotes: Partial<Record<PlanTool, string>>;
  permissions: PermissionRequest[];
  github?: GithubSnapshot | GithubError;
  claude: ClaudeBridgeState;
  antigravity: AntigravityBridgeState;
}

export interface CustomTool {
  id: string;
  name: string;
  /** URL, executable path or shell command. */
  target: string;
  color: string;
}

export interface Settings {
  alwaysOnTop: boolean;
  mascotStyle: MascotStyle;
  reduceMotion: boolean;
  followCursor: boolean;
  permissionTimeoutSec: number;
  customTools: CustomTool[];
  githubRepo: string;
  githubTokenSet: boolean;
  /** Read Claude plan limits from the account via the local Claude Code login. */
  claudeAccountUsage: boolean;
}

export interface InitialState {
  settings: Settings;
  hub: HubState;
  view: ViewMode;
  docked: boolean;
  /** First window of this run: play the entrance once (not on a renderer reload). */
  intro: boolean;
}

export type MainCommand =
  | { type: 'set-view'; view: ViewMode }
  | { type: 'toggle-panel' }
  | { type: 'permission-key'; decision: PermissionDecision }
  | { type: 'open-tab'; tab: PanelTab };

export type SimulationKind = 'start' | 'progress' | 'done' | 'error' | 'permission';

export interface CursorInfo {
  /** Cursor position relative to the window content, in DIP. */
  x: number;
  y: number;
}

/** How long the user has been away from the computer (no keyboard or mouse). */
export type IdleLevel = 'active' | 'drowsy' | 'asleep';

// ---------- Skills Arsenal ----------

export type SkillTargetId = 'claude' | 'codex' | 'gemini' | 'antigravity' | 'cursor';

/** Per agent: installed by Orbi (current or outdated), or a folder with that name Orbi did not install. */
export type SkillInstallState = 'installed' | 'update' | 'external';

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  license: string;
  version?: string;
  source: { label: string; repo: string; commit: string; url: string };
  hasScripts: boolean;
  files: { path: string; size: number; script: boolean }[];
  installs: Partial<Record<SkillTargetId, SkillInstallState>>;
}

export interface SkillTargetInfo {
  id: SkillTargetId;
  name: string;
  /** Absolute folder Orbi installs into. */
  dir: string;
  detected: boolean;
  alsoVisibleTo: SkillTargetId[];
  docs: string;
}

/** A skill found in an agent's folder, installed by Orbi or not. */
export interface InstalledSkill {
  name: string;
  description?: string;
  targetId: SkillTargetId;
  managed: boolean;
  skillId?: string;
  commit?: string;
  installedAt?: number;
}

export interface SkillCatalog {
  skills: SkillCatalogEntry[];
  targets: SkillTargetInfo[];
  installed: InstalledSkill[];
  /** Why the catalog could not be read, if it could not. */
  error?: string;
}

export interface SkillPlanTarget {
  targetId: SkillTargetId;
  dir: string;
  status: 'new' | 'same' | 'update' | 'modified' | 'conflict';
  alsoVisibleTo: SkillTargetId[];
  /** Another pick already gives this agent the skill through a shared folder. */
  redundant: boolean;
}

export interface SkillPlan {
  id: string;
  skillId: string;
  name: string;
  source: SkillCatalogEntry['source'];
  license: string;
  files: SkillCatalogEntry['files'];
  totalBytes: number;
  hasScripts: boolean;
  targets: SkillPlanTarget[];
  errors: string[];
}

export interface SkillActionResult {
  ok: boolean;
  message: string;
  details: { targetId: SkillTargetId; ok: boolean; message: string }[];
}
