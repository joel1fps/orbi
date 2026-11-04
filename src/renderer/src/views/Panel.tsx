import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, FolderOpen, House, LayoutGrid, Radio, Swords, Settings as SettingsIcon, Check, X, RefreshCw, RotateCw } from 'lucide-react';
import { ago, BUILTIN_TOOLS, isBuiltin, until } from '@shared/tools';
import type { AgentSession, CiState, PlanUsage, ToolStatus } from '@shared/types';
import { SimTag, ToolFace } from '../components/ui';
import { headlineWindow, isStale, levelTone, liveWindow, PLAN_NAME, PLAN_TONE, PLAN_TOOLS, UsageRing, useNow, type PlanTool } from '../components/usage';
import { Mascot } from '../mascot/Mascot';
import { useApp } from '../store';
import { PermissionCard } from './PermissionCard';
import { ArsenalSheet } from './Arsenal';
import { LiveSession } from './Live';
import { SettingsSheet } from './Settings';
import { ToolsSheet } from './Tools';

export function Panel() {
  const tab = useApp((s) => s.tab);
  return (
    <div className={tab === 'home' ? 'panel' : tab === 'live' ? 'live' : 'sheet'}>
      <PanelHead />
      {tab === 'home' ? <Home /> : tab === 'live' ? <LiveSession /> : tab === 'arsenal' ? <ArsenalSheet /> : tab === 'tools' ? <ToolsSheet /> : <SettingsSheet />}
    </div>
  );
}

function PanelHead() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const setView = useApp((s) => s.setView);

  return (
    <div className="panel__head">
      <button className="tab" aria-pressed={tab === 'home'} aria-label="Início" title="Início" onClick={() => setTab('home')}>
        <House size={15} />
      </button>
      <button className="tab" aria-pressed={tab === 'arsenal'} aria-label="Arsenal de Skills" title="Arsenal de Skills" onClick={() => setTab('arsenal')}>
        <Swords size={15} />
      </button>
      <button className="tab" aria-pressed={tab === 'tools'} aria-label="Ferramentas" title="Ferramentas" onClick={() => setTab('tools')}>
        <LayoutGrid size={15} />
      </button>
      <div className="panel__spacer" title="Arraste para mover" />
      {tab === 'home' ? <UsagePills /> : null}
      <button className="icon-btn" aria-label="Configurações" title="Configurações" aria-pressed={tab === 'settings'} onClick={() => setTab(tab === 'settings' ? 'home' : 'settings')}>
        <SettingsIcon size={15} />
      </button>
      <button className="icon-btn" aria-label="Recolher" title="Recolher (Esc)" onClick={() => setView('compact')}>
        <ChevronUp size={16} />
      </button>
    </div>
  );
}

/** Plan limit counters, always in sight: a ring for the 5-hour window and its percentage. */
function UsagePills() {
  const usage = useApp((s) => s.hub.usage);
  const tools = useApp((s) => s.hub.tools);
  const detail = useApp((s) => s.detail);
  const setDetail = useApp((s) => s.setDetail);
  const now = useNow();
  // Installed but no reading yet: the pill shows "—" and its card says why (e.g. Antigravity closed).
  const shown = PLAN_TOOLS.filter((t) => usage.some((u) => u.tool === t) || tools.find((x) => x.id === t)?.availability !== 'not-installed');
  return (
    <>
      {shown.map((t) => {
        const u = usage.find((x) => x.tool === t);
        const w = headlineWindow(u, now);
        const stale = isStale(u, now);
        const active = detail.type === 'usage' && detail.tool === t;
        return (
          <button
            key={t}
            className="usage-pill"
            aria-pressed={active}
            style={{ ['--tone' as string]: PLAN_TONE[t] }}
            onClick={() => setDetail(active ? { type: 'session' } : { type: 'usage', tool: t })}
            title={u ? `Limite do plano ${PLAN_NAME[t]}. Fonte: ${u.source}${stale ? ` (desatualizado, ${ago(u.observedAt, now)})` : ''}` : `Uso do plano ${PLAN_NAME[t]} ainda sem fonte de dados`}
          >
            {w ? <UsageRing pct={w.usedPercent} tone={PLAN_TONE[t]} size={13} /> : <span className="usage-pill__dot" style={{ opacity: 0.35 }} />}
            {PLAN_NAME[t]}{' '}
            <span style={stale ? { opacity: 0.5 } : w ? { color: levelTone(w.usedPercent, 'inherit') } : undefined}>
              {w ? `${Math.round(w.usedPercent)}%${stale ? '?' : ''}` : u && !stale ? 'renovado' : '—'}
            </span>
          </button>
        );
      })}
    </>
  );
}

// ---------- home ----------

function Home() {
  const permission = useApp((s) => s.hub.permissions[0]);
  const detail = useApp((s) => s.detail);
  const tools = useApp((s) => s.hub.tools);
  return (
    <div className="panel__body">
      {permission ? (
        <PermissionCard request={permission} />
      ) : detail.type === 'usage' ? (
        <UsageDetail tool={detail.tool} />
      ) : detail.type === 'github' ? (
        <GithubDetail />
      ) : (
        <SessionDetail />
      )}
      <ToolChips tools={tools} />
    </div>
  );
}

const STATE_TEXT: Record<AgentSession['state'], string> = {
  working: 'trabalhando',
  waiting: 'aguardando você',
  done: 'concluído',
  error: 'parou com erro',
  idle: 'ocioso',
};

function SessionDetail() {
  const sessions = useApp((s) => s.hub.sessions);
  const index = useApp((s) => s.sessionIndex);
  const setIndex = useApp((s) => s.setSessionIndex);
  const setTab = useApp((s) => s.setTab);

  if (sessions.length === 0) {
    return (
      <div className="hero">
        <div className="hero__glow" style={{ ['--glow' as string]: 'rgba(79, 183, 162, 0.16)' }} />
        <Mascot size={96} interactive />
        <div className="hero__info">
          <div className="hero__now">Nenhum agente trabalhando agora</div>
          <div className="hero__summary">
            O Orbi acompanha o Claude Code, o Codex e o Antigravity neste computador e reage quando uma tarefa começa, termina ou precisa de você.
          </div>
        </div>
      </div>
    );
  }

  const i = Math.min(index, sessions.length - 1);
  const s = sessions[i];
  const tool = isBuiltin(s.tool) ? BUILTIN_TOOLS[s.tool] : { name: 'Ferramenta', color: '#91aa9b' };
  const glow =
    s.state === 'done' ? 'rgba(87, 201, 147, 0.26)' : s.state === 'error' ? 'rgba(242, 116, 121, 0.26)' : s.state === 'working' ? 'rgba(79, 183, 162, 0.22)' : 'rgba(79, 183, 162, 0.1)';

  return (
    <div className="hero">
      <div className="hero__glow" style={{ ['--glow' as string]: glow }} />
      <Mascot size={96} interactive />
      <div className="hero__info">
        <div className="hero__top">
          <span className={`dot${s.state === 'working' ? ' dot--live' : ''}`} style={{ background: tool.color, color: tool.color }} />
          <span className="hero__project">{s.project}</span>
          <span className="hero__tool">{tool.name}</span>
          {s.simulated ? <SimTag /> : null}
          {sessions.length > 1 ? (
            <span className="hero__count" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button className="icon-btn" style={{ width: 20, height: 20 }} aria-label="Sessão anterior" onClick={() => setIndex((i - 1 + sessions.length) % sessions.length)}>
                <ChevronLeft size={13} />
              </button>
              {i + 1}/{sessions.length}
              <button className="icon-btn" style={{ width: 20, height: 20 }} aria-label="Próxima sessão" onClick={() => setIndex((i + 1) % sessions.length)}>
                <ChevronRight size={13} />
              </button>
            </span>
          ) : (
            <span className="hero__count">{ago(s.updatedAt)}</span>
          )}
        </div>

        {s.lastStep ? (
          <div className="hero__step">
            {s.lastStep.ok ? <Check size={13} color="#57c993" /> : <X size={13} color="#f27479" />}
            <span>{s.lastStep.label}</span>
            {s.steps > 0 ? <span style={{ marginLeft: 'auto', flex: 'none' }}>{s.steps} {s.steps === 1 ? 'passo' : 'passos'}</span> : null}
          </div>
        ) : null}

        {s.state === 'done' || s.state === 'error' ? (
          <>
            <div className="hero__now">
              <span className="hero__now-label" style={{ color: s.state === 'done' ? '#8be0b5' : '#f6a0a3' }}>
                {s.state === 'done' ? 'Terminou' : 'Parou com erro'}
              </span>
            </div>
            {s.summary ? <div className="hero__summary">{s.summary}</div> : null}
          </>
        ) : (
          <>
            <div className="hero__now">
              <ChevronRight size={14} color="#758379" style={{ flex: 'none', alignSelf: 'center' }} />
              <span className="hero__now-label">{s.current ?? STATE_TEXT[s.state]}</span>
            </div>
            {s.currentCode ? <div className="hero__code">{s.currentCode}</div> : null}
          </>
        )}

        <div className="hero__actions">
          <button className="btn btn--light" onClick={() => setTab('live')}>
            <Radio size={13} /> Ao vivo
          </button>
          {s.cwd && !s.simulated ? (
            <button className="btn" onClick={() => window.orbi.openPath(s.cwd!)}>
              <FolderOpen size={13} /> Abrir pasta
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_NOTE: Record<PlanTool, string> = {
  claude: 'Buscando o limite na sua conta Claude pelo login do Claude Code…',
  codex: 'O Codex registra os limites nas sessões; eles aparecem depois que você usar o Codex.',
  antigravity: 'Procurando o Antigravity aberto para ler a cota de cada modelo…',
  gemini: 'Buscando a cota na sua conta Google pelo login do Gemini CLI…',
};

/** How Orbi itself (re)connects each limit source; the numbers update by themselves afterwards. */
const CONNECT: Partial<Record<PlanTool, { label: string; run: () => Promise<unknown> }>> = {
  claude: { label: 'Conectar conta Claude', run: () => window.orbi.claudeLogin() },
  codex: { label: 'Conectar Codex', run: () => window.orbi.codexConnect() },
  antigravity: { label: 'Abrir Antigravity', run: () => window.orbi.antigravityOpen() },
};

function ConnectButton({ tool }: { tool: PlanTool }) {
  const [busy, setBusy] = useState(false);
  const c = CONNECT[tool];
  if (!c) return null;
  return (
    <button
      className="btn btn--light"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        setBusy(true);
        void c.run().finally(() => setTimeout(() => setBusy(false), 4000));
      }}
    >
      {busy ? 'Abrindo…' : c.label}
    </button>
  );
}

function UsageDetail({ tool }: { tool: PlanTool }) {
  const u = useApp((s) => s.hub.usage.find((x) => x.tool === tool));
  const accountUsage = useApp((s) => s.settings.claudeAccountUsage);
  const setDetail = useApp((s) => s.setDetail);
  const setTab = useApp((s) => s.setTab);
  const now = useNow(10_000);
  const tone = PLAN_TONE[tool];
  const limitNote = useApp((s) => s.hub.limitNotes?.[tool]);
  const noteText = limitNote ?? DEFAULT_NOTE[tool];

  if (!u) {
    // No real source yet: say how to get one instead of showing a number.
    return (
      <div className="hero">
        <div className="hero__glow" style={{ ['--glow' as string]: `${tone}26` }} />
        <Mascot size={72} flat />
        <div className="hero__info" style={{ gap: 7 }}>
          <div className="hero__top">
            <span className="dot" style={{ background: tone, opacity: 0.4 }} />
            <span className="hero__project">Plano {PLAN_NAME[tool]}</span>
            <span>sem dados ainda</span>
          </div>
          <div className="hero__summary">{noteText}</div>
          <div className="hero__actions">
            {tool === 'claude' && !accountUsage ? (
              <button className="btn btn--light" onClick={() => setTab('tools')}>
                Ativar em Ferramentas
              </button>
            ) : (
              <ConnectButton tool={tool} />
            )}
            <button className="btn btn--ghost" onClick={() => setDetail({ type: 'session' })}>
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Antigravity's models usually renew together: show that once, in the title line.
  const resets = (u.models ?? []).map((m) => m.resetsAt ?? 0);
  const sharedReset = resets.length > 0 && resets.every((r) => Math.abs(r - resets[0]) < 60_000) ? resets[0] || undefined : undefined;

  const stale = isStale(u, now);
  const row = (label: string, raw: PlanUsage['fiveHour'], showReset = true) => {
    if (!raw) return null;
    const w = liveWindow(raw, now);
    const pct = w ? Math.min(100, w.usedPercent) : 0;
    const color = w ? levelTone(w.usedPercent, tone) : tone;
    return (
      <div className="meter-row" style={{ ['--tone' as string]: color, ...(stale ? { opacity: 0.5 } : {}) }}>
        <span>{label}</span>
        <div className="meter">
          <div style={{ width: `${pct}%` }} />
        </div>
        <strong style={w && w.usedPercent >= 70 ? { color } : undefined}>{w ? `${Math.round(w.usedPercent)}%` : stale ? '—' : '0%'}</strong>
        {showReset ? (
          <span className="meter-reset" title="Quando a janela renova">
            <RotateCw size={10} />
            {w ? until(w.resetsAt, now) : stale ? '—' : 'renovado'}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="hero" onClick={() => setDetail({ type: 'session' })} title="Clique para voltar à sessão">
      <div className="hero__glow" style={{ ['--glow' as string]: `${tone}38` }} />
      <Mascot size={72} flat />
      <div className="hero__info" style={{ gap: 9 }}>
        <div className="hero__top">
          <span className="dot" style={{ background: tone }} />
          <span className="hero__project">{tool === 'antigravity' ? PLAN_NAME[tool] : `Plano ${PLAN_NAME[tool]}`}</span>
          {u.plan ? <span style={{ textTransform: 'capitalize' }}>{u.plan}</span> : null}
          {sharedReset ? (
            <span className="meter-reset" title="Quando a cota renova" style={{ marginLeft: 'auto' }}>
              <RotateCw size={10} />
              {sharedReset > now ? until(sharedReset, now) : 'renovado'}
            </span>
          ) : (
            <span
              className="hero__count"
              title="Momento em que a fonte registrou estes números"
              style={stale ? { color: '#f2b84b' } : undefined}
            >
              {stale ? `desatualizado · ${ago(u.observedAt, now)}` : ago(u.observedAt, now) === 'agora' ? 'atualizado agora' : ago(u.observedAt, now)}
            </span>
          )}
        </div>
        {u.models ? (
          <div className="meter-list">
            {u.models
              .slice()
              .sort((a, b) => b.usedPercent - a.usedPercent)
              .map((m) => (
                <div key={m.label} className={`meter-row meter-row--model${sharedReset ? ' meter-row--noreset' : ''}`} title={m.label}>
                  {row(m.label, { usedPercent: m.usedPercent, resetsAt: m.resetsAt }, !sharedReset)}
                </div>
              ))}
          </div>
        ) : (
          <>
            {row('5 horas', u.fiveHour)}
            {row('Semana', u.week)}
          </>
        )}
        <div className="hero__step">
          <span title={limitNote}>{limitNote ??
              (stale
                ? `Sem leitura nova da fonte (${u.source}).${CONNECT[tool] ? ` ${CONNECT[tool]!.label} para ver ao vivo.` : ''}`
                : `Fonte: ${u.source}`)}</span>
        </div>
        {CONNECT[tool] && (tool !== 'claude' || accountUsage) && (stale || limitNote) ? (
          <div className="hero__actions">
            <ConnectButton tool={tool} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const CI_COLOR: Record<CiState, string> = { success: '#57c993', failure: '#f27479', pending: '#f2b84b', none: '#4a5950' };
const CI_WORD: Record<CiState, string> = { success: 'tudo verde', failure: 'falhando', pending: 'rodando', none: 'sem checks' };

function GithubDetail() {
  const gh = useApp((s) => s.hub.github);
  const setTab = useApp((s) => s.setTab);
  const setDetail = useApp((s) => s.setDetail);

  if (!gh || !gh.ok) {
    return (
      <div className="hero">
        <Mascot size={86} flat />
        <div className="hero__info">
          <div className="hero__top">
            <span className="dot" style={{ background: '#f27479' }} />
            <span className="hero__project">GitHub</span>
          </div>
          <div className="hero__summary">{gh && !gh.ok ? gh.error : 'Conecte um token pessoal para ver seus PRs, revisões, CI e sequência de contribuições.'}</div>
          <div className="hero__actions">
            <button className="btn" onClick={() => setTab('tools')}>
              Conectar GitHub
            </button>
            <button className="btn btn--ghost" onClick={() => setDetail({ type: 'session' })}>
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const running = gh.myOpenPRs.filter((p) => p.ci === 'pending').length;
  const days = gh.contributions?.days.slice(-56) ?? [];
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="hero" style={{ alignItems: 'flex-start' }}>
      <div className="hero__glow" style={{ ['--glow' as string]: 'rgba(242, 116, 121, 0.16)' }} />
      <Mascot size={78} flat />
      <div className="hero__info" style={{ gap: 6 }}>
        <div className="hero__top">
          <span className="dot" style={{ background: '#f27479' }} />
          <span className="hero__project">{gh.login}</span>
          {gh.contributions ? <span>{gh.contributions.streak} dias seguidos</span> : null}
          <button className="icon-btn" style={{ width: 22, height: 22, marginLeft: 'auto' }} aria-label="Atualizar" onClick={() => void window.orbi.refreshGithub()}>
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="gh-row">
          Meus PRs <b>{gh.myOpenPRs.length}{running ? `, ${running} rodando` : ''}</b>
        </div>
        <div className="gh-row">
          Para revisar <b>{gh.reviewRequests}</b>
        </div>
        {gh.defaultBranchCI ? (
          <div className="gh-row">
            CI de {gh.defaultBranchCI.branch}
            <b style={{ color: CI_COLOR[gh.defaultBranchCI.state] }}>{CI_WORD[gh.defaultBranchCI.state]}</b>
          </div>
        ) : null}
        {gh.myOpenPRs.slice(0, 2).map((p) => (
          <button key={p.url} className="gh-pr" onClick={() => window.orbi.openExternal(p.url)}>
            <span className="dot" style={{ background: CI_COLOR[p.ci] }} />
            <span style={{ color: '#758379', flex: 'none' }}>
              {p.repo.split('/')[1]}#{p.number}
            </span>
            <span>{p.title}</span>
          </button>
        ))}
        {days.length ? (
          <div className="heat" title={`${gh.contributions?.total ?? 0} contribuições no último ano`}>
            {days.map((d) => (
              <i key={d.date} title={`${d.date}: ${d.count}`} style={d.count ? { background: `rgba(87, 201, 147, ${0.25 + (0.75 * d.count) / max})` } : undefined} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolChips({ tools }: { tools: ToolStatus[] }) {
  const setDetail = useApp((s) => s.setDetail);
  const setTab = useApp((s) => s.setTab);
  const sessions = useApp((s) => s.hub.sessions);
  const setIndex = useApp((s) => s.setSessionIndex);

  const onChip = (t: ToolStatus) => {
    if (t.id === 'github') return setDetail({ type: 'github' });
    if (t.id.startsWith('custom:')) return window.orbi.launchTool(t.id);
    const idx = sessions.findIndex((s) => s.tool === t.id);
    if (idx >= 0) {
      setIndex(idx);
      setDetail({ type: 'session' });
    } else setTab('tools');
  };

  return (
    <div className="chips">
      {tools.map((t) => (
        <button
          key={t.id}
          className="chip"
          data-state={t.availability}
          style={{ ['--tone' as string]: t.color }}
          title={`${t.detail}\nFonte: ${t.source}`}
          onClick={() => onChip(t)}
        >
          <ToolFace color={t.color} dim={t.availability === 'not-installed' || t.availability === 'not-connected'} />
          <span className="chip__name">{t.short ?? t.name}</span>
          {t.availability === 'active' ? <span className="dot dot--live" style={{ background: '#57c993', color: '#57c993' }} /> : null}
          {t.attention ? <span className="chip__alert">!</span> : null}
        </button>
      ))}
    </div>
  );
}
