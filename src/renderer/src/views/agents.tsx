import { BUILTIN_TOOLS } from '@shared/tools';
import type { AgentSession, ToolStatus } from '@shared/types';
import { useApp } from '../store';

/** Agents with a session card and a live window. */
export const LIVE_AGENTS = ['claude', 'codex', 'antigravity'] as const;
export type LiveAgent = (typeof LIVE_AGENTS)[number];

/**
 * The agent the session card and the live window show, its sessions and the
 * selected one. 'auto' follows whichever agent worked last; clicking a tab
 * pins that agent.
 */
export function useAgentView() {
  const sessions = useApp((s) => s.hub.sessions);
  const tools = useApp((s) => s.hub.tools);
  const agent = useApp((s) => s.agent);
  const setAgent = useApp((s) => s.setAgent);
  const index = useApp((s) => s.sessionIndex);
  const setIndex = useApp((s) => s.setSessionIndex);

  const available = LIVE_AGENTS.filter((a) => sessions.some((s) => s.tool === a) || tools.find((t) => t.id === a)?.availability !== 'not-installed');
  const latest = sessions.find((s) => !s.simulated && (LIVE_AGENTS as readonly string[]).includes(s.tool))?.tool as LiveAgent | undefined;
  // Simulated events always show, whatever is selected, so the simulator stays useful.
  const simulated = sessions.find((s) => s.simulated);
  const current: LiveAgent | undefined =
    agent !== 'auto' && (LIVE_AGENTS as readonly string[]).includes(agent) ? (agent as LiveAgent) : (latest ?? available[0]);
  const mine = simulated && agent === 'auto' ? [simulated] : sessions.filter((s) => s.tool === current);
  const i = Math.min(index, Math.max(0, mine.length - 1));
  const status: ToolStatus | undefined = tools.find((t) => t.id === current);
  return { available, current, pinned: agent !== 'auto', setAgent, sessions: mine, session: mine[i] as AgentSession | undefined, i, setIndex, status };
}

/** Claude Code / Codex / Antigravity tabs: a coloured dot, pulsing while that agent works. */
export function AgentTabs({ compact = false }: { compact?: boolean }) {
  const { available, current, setAgent } = useAgentView();
  const sessions = useApp((s) => s.hub.sessions);
  if (available.length < 2) return null;
  return (
    <div className={`agent-tabs${compact ? ' agent-tabs--column' : ''}`} role="tablist" aria-label="Agente">
      {available.map((a) => {
        const t = BUILTIN_TOOLS[a];
        const working = sessions.some((s) => s.tool === a && (s.state === 'working' || s.state === 'waiting'));
        return (
          <button
            key={a}
            role="tab"
            aria-selected={a === current}
            className="agent-tab"
            onClick={(e) => (e.stopPropagation(), setAgent(a))}
            title={working ? `${t.name} trabalhando` : t.name}
          >
            <span className={`dot${working ? ' dot--live' : ''}`} style={{ background: t.color, color: t.color }} />
            {t.short}
          </button>
        );
      })}
    </div>
  );
}
