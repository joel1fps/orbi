import { BookOpen, Brain, ChevronLeft, ChevronRight, Circle, CircleCheck, CircleX, FileCode, Globe, LoaderCircle, Pencil, Search, SquareTerminal } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { BUILTIN_TOOLS, isBuiltin } from '@shared/tools';
import type { SessionFileView, StepKind } from '@shared/types';
import { Mascot } from '../mascot/Mascot';
import { useApp } from '../store';
import { AgentTabs, useAgentView } from './agents';

/**
 * Live session window: what the agent is doing, step by step, next to the
 * file it touched last, centred on what it just wrote. Fed by the session
 * trail the hub records from every integration (Claude, Codex, Antigravity).
 */

const STEP_ICON: Record<StepKind, (s: number) => ReactNode> = {
  think: (s) => <Brain size={s} />,
  read: (s) => <BookOpen size={s} />,
  edit: (s) => <Pencil size={s} />,
  bash: (s) => <SquareTerminal size={s} />,
  search: (s) => <Search size={s} />,
  web: (s) => <Globe size={s} />,
  done: (s) => <CircleCheck size={s} />,
  error: (s) => <CircleX size={s} />,
  other: (s) => <Circle size={s} />,
};

const SHOWN_STEPS = 7;

export function LiveSession() {
  const { current, sessions, session: s, i, setIndex } = useAgentView();
  const setTab = useApp((s) => s.setTab);
  const [file, setFile] = useState<SessionFileView | null>(null);

  // Re-read the file whenever the agent touches it again.
  const stamp = s ? `${s.id}|${s.file}|${s.fileHint?.length}|${s.trail?.length}|${s.updatedAt}` : '';
  useEffect(() => {
    if (!s?.file) {
      setFile(null);
      return;
    }
    let alive = true;
    void window.orbi.sessionFile(s.id).then((v) => alive && setFile(v));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  if (!s) {
    return (
      <div className="live__empty">
        <AgentTabs />
        <Mascot size={72} interactive />
        <div>{current ? `O ${BUILTIN_TOOLS[current].name} não tem sessão recente para acompanhar.` : 'Nenhuma sessão de agente para acompanhar agora.'}</div>
        <button className="btn" onClick={() => setTab('home')}>
          Voltar
        </button>
      </div>
    );
  }

  const tool = isBuiltin(s.tool) ? BUILTIN_TOOLS[s.tool] : { name: 'Ferramenta', color: '#91aa9b' };
  const trail = (s.trail ?? []).slice(-SHOWN_STEPS);
  const working = s.state === 'working' || s.state === 'waiting';

  return (
    <div className="live__body">
      <aside className="live__side">
        <button className="btn btn--ghost live__back" onClick={() => setTab('home')}>
          <ChevronLeft size={14} /> Início
        </button>
        <AgentTabs compact />
        <Mascot size={64} interactive />
        <div className="live__project">{s.project}</div>
        <div className="live__tool" style={{ color: tool.color }}>
          {tool.name}
        </div>
        <ol className="live__steps">
          {trail.length === 0 ? <li className="live__step live__step--past">{s.current ?? 'Sem passos ainda'}</li> : null}
          {trail.map((step, n) => {
            const last = n === trail.length - 1;
            const live = last && working && step.kind !== 'done' && step.kind !== 'error';
            return (
              <li key={`${step.at}-${n}`} className={`live__step${last ? ' live__step--now' : ' live__step--past'} live__step--${step.kind}`} title={step.code ?? step.label}>
                <span className="live__icon">{live ? <LoaderCircle size={13} className="live__spin" /> : STEP_ICON[step.kind](13)}</span>
                <span className="live__label">{step.label}</span>
              </li>
            );
          })}
        </ol>
        {sessions.length > 1 ? (
          <div className="live__nav">
            <button className="icon-btn" aria-label="Sessão anterior" onClick={() => setIndex((i - 1 + sessions.length) % sessions.length)}>
              <ChevronLeft size={13} />
            </button>
            {i + 1}/{sessions.length}
            <button className="icon-btn" aria-label="Próxima sessão" onClick={() => setIndex((i + 1) % sessions.length)}>
              <ChevronRight size={13} />
            </button>
          </div>
        ) : null}
      </aside>

      <section className="live__code">
        {file ? (
          <>
            <div className="live__file">
              <span className="live__tab">
                <FileCode size={13} /> {file.name}
              </span>
              <span className="live__path" title={file.path}>
                {file.path}
              </span>
            </div>
            <pre className="live__pre">
              {file.lines.map((line, n) => {
                const no = file.start + n;
                return (
                  <div key={no} className={file.highlight.includes(no) ? 'live__line live__line--hl' : 'live__line'}>
                    <span className="live__no">{no}</span>
                    <span className="live__src">{line || ' '}</span>
                  </div>
                );
              })}
            </pre>
          </>
        ) : (
          <div className="live__nofile">
            <div className="live__now">{s.current ?? 'Sem atividade'}</div>
            {s.currentCode ? <pre className="live__cmd">{s.currentCode}</pre> : null}
            {s.summary ? <div className="live__summary">{s.summary}</div> : null}
            <div className="live__hint">Quando o agente ler ou editar um arquivo, ele aparece aqui, no trecho que acabou de mudar.</div>
          </div>
        )}
      </section>
    </div>
  );
}
