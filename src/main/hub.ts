import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_TOOLS, ago } from '@shared/tools';
import type {
  AgentSession,
  AntigravityBridgeState,
  ClaudeBridgeState,
  GithubError,
  GithubSnapshot,
  HubState,
  OrbiEvent,
  PermissionDecision,
  PermissionRequest,
  PlanUsage,
  ToolId,
  ToolStatus,
} from '@shared/types';
import { store } from './store';
import { send } from './widget';

const ACTIVE_MS = 2 * 60_000;
const STALE_WORKING_MS = 4 * 60_000;
const DROP_DONE_MS = 20 * 60_000;
const DROP_IDLE_MS = 45 * 60_000;

export interface Detection {
  /** Command found on PATH. */
  onPath: boolean;
  /** Local data directory exists. */
  hasData: boolean;
  /** Most recent write in the tool's data directory (Unix ms). */
  lastWrite?: number;
}

interface PendingPermission {
  req: PermissionRequest;
  resolve: (d: PermissionDecision) => void;
  timer: NodeJS.Timeout;
}

class Hub {
  private sessions = new Map<string, AgentSession>();
  private usage = new Map<PlanUsage['tool'], PlanUsage>();
  private limitNotes: HubState['limitNotes'] = {};
  private pending = new Map<string, PendingPermission>();
  private detection: Partial<Record<ToolId, Detection>> = {};
  private github?: GithubSnapshot | GithubError;
  private emitTimer: NodeJS.Timeout | null = null;
  private permissionListeners = new Set<(count: number) => void>();
  claude: ClaudeBridgeState = {
    hooksInstalled: false,
    statuslineInstalled: false,
    statuslineForeign: false,
    serverPort: 0,
    serverOk: false,
    settingsPath: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'),
  };
  antigravity: AntigravityBridgeState = {
    hooksInstalled: false,
    hooksPath: join(homedir(), '.gemini', 'config', 'hooks.json'),
  };

  constructor() {
    setInterval(() => this.prune(), 15_000).unref();
  }

  // ---------- sessions ----------

  getSession(id: string) {
    return this.sessions.get(id);
  }

  upsertSession(id: string, patch: Partial<AgentSession> & Pick<AgentSession, 'tool' | 'source'>): AgentSession {
    const now = Date.now();
    const prev = this.sessions.get(id);
    const next: AgentSession = {
      id,
      project: 'sessão',
      state: 'idle',
      steps: 0,
      startedAt: now,
      ...prev,
      ...patch,
      updatedAt: patch.updatedAt ?? now,
    };
    this.sessions.set(id, next);
    this.changed();
    return next;
  }

  removeSession(id: string) {
    if (this.sessions.delete(id)) this.changed();
  }

  private prune() {
    const now = Date.now();
    let dirty = false;
    for (const [id, s] of this.sessions) {
      const age = now - s.updatedAt;
      if ((s.state === 'working' || s.state === 'waiting') && age > STALE_WORKING_MS) {
        s.state = 'idle';
        s.current = 'Sem atividade recente';
        s.currentCode = undefined;
        dirty = true;
      } else if ((s.state === 'done' || s.state === 'error') && age > DROP_DONE_MS) {
        this.sessions.delete(id);
        dirty = true;
      } else if (s.state === 'idle' && age > DROP_IDLE_MS) {
        this.sessions.delete(id);
        dirty = true;
      }
    }
    if (dirty) this.changed();
  }

  // ---------- events ----------

  event(e: Omit<OrbiEvent, 'id' | 'at'> & { at?: number }) {
    const ev: OrbiEvent = { id: randomUUID(), at: Date.now(), ...e };
    send('hub:event', ev);
  }

  // ---------- usage ----------

  removeUsage(tool: PlanUsage['tool'], source?: string) {
    const prev = this.usage.get(tool);
    if (prev && (!source || prev.source === source)) {
      this.usage.delete(tool);
      store.forgetUsage(tool);
      this.changed();
    }
  }

  setUsage(u: PlanUsage, persist = true) {
    const prev = this.usage.get(u.tool);
    if (prev && prev.observedAt > u.observedAt) return;
    this.usage.set(u.tool, u);
    if (persist) store.saveUsage(u);
    this.setLimitNote(u.tool, undefined);
    this.changed();
  }

  /** Restore the last limits seen before Orbi was closed; they show their age. */
  restoreUsage(list: PlanUsage[]) {
    for (const u of list) this.setUsage(u, false);
  }

  setLimitNote(tool: PlanUsage['tool'], note: string | undefined) {
    if (this.limitNotes[tool] === note) return;
    if (note) this.limitNotes = { ...this.limitNotes, [tool]: note };
    else {
      const next = { ...this.limitNotes };
      delete next[tool];
      this.limitNotes = next;
    }
    this.changed();
  }

  // ---------- permissions ----------

  requestPermission(
    input: Omit<PermissionRequest, 'id' | 'createdAt' | 'expiresAt'>,
    signal?: AbortSignal,
  ): Promise<PermissionDecision> {
    const timeoutMs = store.settings.permissionTimeoutSec * 1000;
    const now = Date.now();
    const req: PermissionRequest = { ...input, id: randomUUID(), createdAt: now, expiresAt: now + timeoutMs };
    return new Promise((resolve) => {
      // No answer in time: hand the decision back to the terminal, never auto-allow.
      const timer = setTimeout(() => this.resolvePermission(req.id, 'pass'), timeoutMs);
      this.pending.set(req.id, { req, resolve, timer });
      // The asker went away (Claude Code timed out or was closed): drop the card.
      signal?.addEventListener('abort', () => this.resolvePermission(req.id, 'pass'), { once: true });
      this.changed();
      this.notifyPermissionListeners();
      this.event({
        kind: 'permission',
        tool: req.tool,
        title: `${toolName(req.tool)} precisa de permissão`,
        detail: req.summary,
        project: req.project,
        sessionId: req.sessionId,
        simulated: req.simulated,
      });
    });
  }

  resolvePermission(id: string, decision: PermissionDecision) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(decision);
    this.changed();
    this.notifyPermissionListeners();
  }

  /** Oldest pending request (the one the island shows). */
  firstPermission(): PermissionRequest | undefined {
    return [...this.pending.values()].sort((a, b) => a.req.createdAt - b.req.createdAt)[0]?.req;
  }

  onPermissionsChanged(fn: (count: number) => void) {
    this.permissionListeners.add(fn);
  }

  private notifyPermissionListeners() {
    for (const fn of this.permissionListeners) fn(this.pending.size);
  }

  // ---------- tools ----------

  setDetection(tool: ToolId, d: Detection) {
    this.detection[tool] = d;
    this.changed();
  }

  setGithub(g: GithubSnapshot | GithubError | undefined) {
    this.github = g;
    this.changed();
  }

  setClaude(patch: Partial<ClaudeBridgeState>) {
    this.claude = { ...this.claude, ...patch };
    this.changed();
  }

  setAntigravity(patch: Partial<AntigravityBridgeState>) {
    this.antigravity = { ...this.antigravity, ...patch };
    this.changed();
  }

  private tools(): ToolStatus[] {
    const now = Date.now();
    const sessions = [...this.sessions.values()];
    const pendingTools = new Set([...this.pending.values()].map((p) => p.req.tool));

    const agent = (id: 'claude' | 'codex' | 'antigravity' | 'gemini' | 'hermes', source: string, hint?: ToolStatus['installHint']) => {
      const d = this.detection[id];
      const mine = sessions.filter((s) => s.tool === id && !s.simulated).sort((a, b) => b.updatedAt - a.updatedAt);
      const live = mine.find((s) => (s.state === 'working' || s.state === 'waiting') && now - s.updatedAt < ACTIVE_MS);
      const last = Math.max(mine[0]?.updatedAt ?? 0, d?.lastWrite ?? 0) || undefined;
      const installed = Boolean(d?.onPath || d?.hasData);
      let availability: ToolStatus['availability'];
      let detail: string;
      if (live) {
        availability = 'active';
        detail = `Ativo em ${live.project}`;
      } else if (installed && d?.lastWrite && now - d.lastWrite < ACTIVE_MS) {
        availability = 'active';
        detail = 'Atividade agora';
      } else if (installed) {
        availability = 'idle';
        detail = last ? `Última atividade ${ago(last, now)}` : 'Instalado, sem atividade registrada';
      } else {
        availability = 'not-installed';
        detail = 'Não instalado neste computador';
      }
      return {
        id,
        ...BUILTIN_TOOLS[id],
        availability,
        detail,
        source,
        lastActivityAt: last,
        attention: pendingTools.has(id),
        installHint: availability === 'not-installed' ? hint : undefined,
      } satisfies ToolStatus;
    };

    const claudeSource = this.claude.hooksInstalled
      ? 'Hooks do Claude Code + transcrições em ~/.claude/projects'
      : 'Transcrições em ~/.claude/projects (conecte os hooks para eventos em tempo real)';

    const antigravitySource = this.antigravity.hooksInstalled
      ? 'Hooks globais em ~/.gemini/config/hooks.json + transcrições em ~/.gemini/antigravity'
      : 'Transcrições em ~/.gemini/antigravity (conecte os hooks para eventos instantâneos)';

    const list: ToolStatus[] = [
      agent('claude', claudeSource, { label: 'Como instalar', url: 'https://code.claude.com/docs/en/setup' }),
      agent('codex', 'Sessões em ~/.codex/sessions', { label: 'Como instalar', url: 'https://github.com/openai/codex' }),
      agent('antigravity', antigravitySource, {
        label: 'Como instalar',
        url: 'https://antigravity.google',
      }),
      agent('gemini', 'Comando gemini + ~/.gemini/tmp', {
        label: 'Como instalar',
        url: 'https://github.com/google-gemini/gemini-cli',
      }),
      agent('hermes', 'Comando hermes + ~/.hermes', {
        label: 'Como instalar',
        url: 'https://github.com/NousResearch/hermes-agent',
      }),
    ];

    const gh = this.github;
    const ghDetect = this.detection.github;
    let ghStatus: ToolStatus;
    if (gh?.ok) {
      const prs = gh.myOpenPRs.length;
      ghStatus = {
        id: 'github',
        ...BUILTIN_TOOLS.github,
        availability: 'idle',
        detail: `${prs} ${prs === 1 ? 'PR aberto' : 'PRs abertos'}, ${gh.reviewRequests} ${gh.reviewRequests === 1 ? 'revisão' : 'revisões'}`,
        source: gh.via === 'gh' ? 'GitHub CLI (gh)' : 'API do GitHub com seu token',
        lastActivityAt: gh.fetchedAt,
      };
    } else if (gh && !gh.ok) {
      ghStatus = {
        id: 'github',
        ...BUILTIN_TOOLS.github,
        availability: 'error',
        detail: gh.error,
        source: 'API do GitHub',
      };
    } else {
      ghStatus = {
        id: 'github',
        ...BUILTIN_TOOLS.github,
        availability: 'not-connected',
        detail: ghDetect?.onPath ? 'gh encontrado, faça login com gh auth login' : 'Conecte com um token pessoal',
        source: 'API do GitHub',
      };
    }
    list.push(ghStatus);

    for (const t of store.settings.customTools) {
      list.push({
        id: `custom:${t.id}`,
        name: t.name,
        color: t.color,
        availability: 'shortcut',
        detail: t.target,
        source: 'Atalho que você adicionou',
      });
    }
    return list;
  }

  // ---------- snapshot ----------

  snapshot(): HubState {
    const sessions = [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      tools: this.tools(),
      sessions,
      usage: [...this.usage.values()],
      limitNotes: this.limitNotes,
      permissions: [...this.pending.values()].map((p) => p.req).sort((a, b) => a.createdAt - b.createdAt),
      github: this.github,
      claude: this.claude,
      antigravity: this.antigravity,
    };
  }

  changed() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      send('hub:state', this.snapshot());
    }, 80);
  }
}

export function toolName(id: ToolId): string {
  if (id in BUILTIN_TOOLS) return BUILTIN_TOOLS[id as keyof typeof BUILTIN_TOOLS].name;
  return store.settings.customTools.find((t) => `custom:${t.id}` === id)?.name ?? 'Ferramenta';
}

export const hub = new Hub();
