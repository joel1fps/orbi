export type ViewMode = 'compact' | 'panel';
export type PanelTab = 'home' | 'live' | 'arsenal' | 'github' | 'tools' | 'settings';
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
  /** Recent steps, newest last (live session window). */
  trail?: SessionStep[];
  /** Last file the agent read or edited (absolute), and the text it wrote there. */
  file?: string;
  fileHint?: string;
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

/** One repository in the GitHub tab. */
export interface GithubRepo {
  fullName: string;
  owner: string;
  name: string;
  description?: string;
  language?: string;
  stars: number;
  forks: number;
  private: boolean;
  fork: boolean;
  archived: boolean;
  updatedAt: string;
  url: string;
  avatar?: string;
}

/** mine: your repositories; starred: the ones you starred; user: someone's public ones; search: all of GitHub. */
export type RepoListKind = 'mine' | 'starred' | 'user' | 'search';

export interface RepoList {
  repos: GithubRepo[];
  error?: string;
}

export interface CloneProgress {
  fullName: string;
  /** 0–100 while running. */
  percent: number;
  phase: string;
}

/**
 * A project folder on this computer ("Locais"): not-git = never versioned,
 * no-remote = git but not on GitHub, then changes to send, commits to push,
 * news on GitHub to bring, or in sync.
 */
export type LocalState = 'not-git' | 'no-remote' | 'changes' | 'ahead' | 'behind' | 'clean';

export interface LocalProject {
  path: string;
  name: string;
  git: boolean;
  branch?: string;
  /** "owner/name" when origin is on GitHub. */
  repo?: string;
  /** origin is set but not on GitHub. */
  otherRemote?: boolean;
  changes: number;
  ahead: number;
  behind: number;
  state: LocalState;
  /** Last change to the folder (ms). */
  updatedAt: number;
  /** Added by hand in "Adicionar pasta…". */
  added?: boolean;
}

export interface LocalFile {
  path: string;
  /** Git's two-letter status ("??" new, " M" changed, " D" deleted…); "A" when the folder is not a repository yet. */
  status: string;
  size: number;
  /** Why it must not be sent (a key, an .env, a token inside it). */
  secret?: string;
  /** A secret by its name (.env, a key): it can stay on this PC through .gitignore. */
  ignorable?: boolean;
  big?: boolean;
}

/** What publishing or sending would put on GitHub, checked before anything is written. */
export interface LocalReview {
  path: string;
  files: LocalFile[];
  total: number;
  truncated: boolean;
  /** Anything here stops the send. */
  blockers: string[];
  warnings: string[];
  /** The .gitignore Orbi will create (a folder published without one). */
  gitignore?: string;
}

export interface LocalActionResult {
  ok: boolean;
  message: string;
  url?: string;
}

export interface CloneResult {
  ok: boolean;
  message: string;
  /** The folder of the clone, also when it already existed. */
  path?: string;
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

/** Orbi's PermissionRequest hook in ~/.codex/hooks.json. */
export interface CodexBridgeState {
  hooksInstalled: boolean;
  lastHookAt?: number;
  hooksPath: string;
}

export interface AntigravityBridgeState {
  /** The Antigravity app is running (its agent service may still be off). */
  appOpen?: boolean;
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
  codex: CodexBridgeState;
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
  /** Folders added by hand to the "Locais" tab (besides Desktop and Documents). */
  localFolders: string[];
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
  idle: IdleLevel;
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
/** 'modified': Orbi installed it and the user edited the folder since. */
export type SkillInstallState = 'installed' | 'update' | 'modified' | 'external';

export interface SkillFileInfo {
  path: string;
  size: number;
  script: boolean;
}

/**
 * One card in the Arsenal: a package of SKILL.md folders Orbi can install
 * (one for a single skill, several for a pack like Superpowers), or a manual
 * reference (MCP, CLI, guide…) with the install command from the references site.
 */
export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Skill, Plugin, MCP, CLI, Guia… */
  kind: string;
  /** Hand-picked by Orbi, or from the user's references site. */
  origin: 'curated' | 'refs';
  /** Marked as part of the user's own stack on the references site. */
  mine: boolean;
  /** Agents that can use it. */
  support: SkillTargetId[];
  license: string;
  version?: string;
  source?: { label: string; repo: string; commit: string; url: string; private?: boolean };
  /** The SKILL.md folders it installs; empty for a manual reference. */
  skills: { name: string; files: SkillFileInfo[] }[];
  hasScripts: boolean;
  manual?: { install?: string; url: string; docs?: string; note?: string };
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
  /** When the catalog in use was generated (ISO date). */
  updatedAt?: string;
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
  /** Each folder of the package and what installing does to it. */
  folders: { name: string; status: SkillPlanTarget['status'] }[];
}

export interface SkillPlan {
  id: string;
  skillId: string;
  name: string;
  source: NonNullable<SkillCatalogEntry['source']>;
  license: string;
  /** Every file, as "<folder>/<path>". */
  files: SkillFileInfo[];
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

// ---------- live session window ----------

export type StepKind = 'think' | 'read' | 'edit' | 'bash' | 'search' | 'web' | 'done' | 'error' | 'other';

/** One thing the agent did, for the live session window. */
export interface SessionStep {
  kind: StepKind;
  label: string;
  code?: string;
  /** File the step touched, if any (absolute). */
  file?: string;
  at: number;
}

/** What the live session window shows of the file the agent touched last. */
export interface SessionFileView {
  path: string;
  name: string;
  /** 1-based line number of lines[0]. */
  start: number;
  lines: string[];
  highlight: number[];
  totalLines: number;
}
