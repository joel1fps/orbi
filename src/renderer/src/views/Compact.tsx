import { headline } from '@shared/pet';
import { BUILTIN_TOOLS, isBuiltin } from '@shared/tools';
import type { OrbiEvent, ToolId } from '@shared/types';
import { SimTag } from '../components/ui';
import { headlineWindow, levelTone, PLAN_NAME, PLAN_TONE, PLAN_TOOLS, UsageRing, useNow } from '../components/usage';
import { Mascot } from '../mascot/Mascot';
import { useApp } from '../store';

const EVENT_TONE: Record<OrbiEvent['kind'], string> = {
  start: '#4fb7a2',
  progress: '#4fb7a2',
  done: '#57c993',
  error: '#f27479',
  permission: '#f2b84b',
  waiting: '#5eead4',
};

const toolLabel = (id: ToolId) => (isBuiltin(id) ? BUILTIN_TOOLS[id].name : 'Ferramenta');

export function Compact() {
  const toast = useApp((s) => s.toast);
  const pet = useApp((s) => s.pet);
  const live = useApp((s) =>
    s.hub.sessions.find((x) => (x.state === 'working' || x.state === 'waiting') && Date.now() - x.updatedAt < 120_000),
  );

  if (toast) {
    return (
      <div className="pill pill--toast">
        <Mascot size={52} flat />
        <div className="pill__text">
          <div className="pill__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="dot" style={{ background: EVENT_TONE[toast.kind] }} />
            {toast.title}
            {toast.simulated ? <SimTag /> : null}
          </div>
          {toast.detail ? <div className="pill__sub">{toast.detail}</div> : null}
        </div>
      </div>
    );
  }

  let title: string;
  let sub: string | undefined;
  let dot: { color: string; live: boolean } | null = null;
  if (live) {
    title = live.state === 'waiting' ? `${toolLabel(live.tool)} aguarda você` : toolLabel(live.tool);
    sub = live.state === 'waiting' ? live.project : live.current;
    dot = { color: live.state === 'waiting' ? '#5eead4' : '#4fb7a2', live: live.state === 'working' };
  } else {
    title = headline(pet);
    if (!pet.sleeping && (pet.satiety < 30 || pet.energy < 25 || pet.mood < 30)) dot = { color: '#f2b84b', live: false };
  }

  return (
    <div className="pill" title="Clique para abrir · arraste para mover">
      <Mascot size={38} flat />
      <div className="pill__text" style={{ maxWidth: 220 }}>
        <div className="pill__title">{title}</div>
        {sub ? <div className="pill__sub">{sub}</div> : null}
      </div>
      {dot ? <span className={`pill__dot${dot.live ? ' dot--live' : ''}`} style={{ background: dot.color, color: dot.color }} /> : null}
      <UsageMini />
    </div>
  );
}

/** Plan limits stay in sight even in the smallest island. Only real, unexpired windows. */
function UsageMini() {
  const usage = useApp((s) => s.hub.usage);
  const now = useNow(30_000);
  const items = PLAN_TOOLS.map((t) => ({ t, w: headlineWindow(usage.find((u) => u.tool === t), now) })).filter((x) => x.w);
  if (items.length === 0) return null;
  return (
    <span className="pill__usage">
      {items.map(({ t, w }) => (
        <span
          key={t}
          className="pill__usage-item"
          title={t === 'antigravity' ? 'Cota do Antigravity (modelo mais usado)' : `Limite ${(w!.windowMinutes ?? 0) > 600 ? 'da semana' : 'de 5 horas'} do ${PLAN_NAME[t]}`}
        >
          <UsageRing pct={w!.usedPercent} tone={PLAN_TONE[t]} size={14} />
          <span style={{ color: levelTone(w!.usedPercent, 'inherit') }}>{Math.round(w!.usedPercent)}%</span>
        </span>
      ))}
    </span>
  );
}
