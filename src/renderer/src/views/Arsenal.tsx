import { AlertTriangle, ChevronLeft, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SkillActionResult, SkillCatalog, SkillCatalogEntry, SkillPlan, SkillTargetId } from '@shared/types';
import { Segmented } from '../components/ui';

/**
 * Skills Arsenal: find a skill, pick the agents, review exactly what will be
 * written, confirm, see the result. Everything that touches the disk or the
 * network happens in the main process (src/main/skills).
 */

type Screen =
  | { type: 'list' }
  | { type: 'detail'; id: string }
  | { type: 'plan'; plan: SkillPlan }
  | { type: 'result'; id: string; result: SkillActionResult };

const STATE_WORD = { installed: 'instalada', update: 'atualização disponível', external: 'pasta com esse nome (não é do Orbi)' } as const;
const PLAN_WORD: Record<SkillPlan['targets'][number]['status'], string> = {
  new: 'Instalação nova',
  update: 'Atualizar a versão instalada pelo Orbi',
  same: 'Já instalada nesta versão: nada muda',
  modified: 'Você editou esta pasta depois da instalação',
  conflict: 'Já existe uma pasta com esse nome que o Orbi não instalou',
};

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const short = (sha: string) => sha.slice(0, 7);

export function ArsenalSheet() {
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [screen, setScreen] = useState<Screen>({ type: 'list' });
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setCatalog(await window.orbi.skillsCatalog());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, []);

  if (!catalog) return <div className="sheet__body arsenal__empty">Carregando o catálogo…</div>;
  if (catalog.error) return <div className="sheet__body arsenal__empty">{catalog.error}</div>;

  const skill = (id: string) => catalog.skills.find((s) => s.id === id);
  const back = () => setScreen({ type: 'list' });

  if (screen.type === 'detail' && skill(screen.id)) {
    return <Detail catalog={catalog} skill={skill(screen.id)!} onBack={back} onPlan={(plan) => setScreen({ type: 'plan', plan })} onDone={async (result) => (await reload(), setScreen({ type: 'result', id: screen.id, result }))} />;
  }
  if (screen.type === 'plan') {
    return (
      <Review
        catalog={catalog}
        plan={screen.plan}
        onCancel={() => setScreen({ type: 'detail', id: screen.plan.skillId })}
        onDone={async (result) => (await reload(), setScreen({ type: 'result', id: screen.plan.skillId, result }))}
      />
    );
  }
  if (screen.type === 'result') return <Result catalog={catalog} result={screen.result} onBack={() => setScreen({ type: 'detail', id: screen.id })} onList={back} />;
  return <List catalog={catalog} loading={loading} onReload={reload} onOpen={(id) => setScreen({ type: 'detail', id })} />;
}

// ---------- list ----------

function List({ catalog, loading, onReload, onOpen }: { catalog: SkillCatalog; loading: boolean; onReload: () => void; onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<'catalog' | 'installed'>('catalog');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todas');
  const categories = useMemo(() => ['Todas', ...new Set(catalog.skills.map((s) => s.category))], [catalog]);
  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const targetName = (id: SkillTargetId) => catalog.targets.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="sheet__body">
      <div className="arsenal__bar">
        <input className="field" style={{ flex: 1 }} placeholder="Buscar skills" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Segmented
          label="Mostrar"
          value={mode}
          options={[
            { value: 'catalog', label: 'Catálogo' },
            { value: 'installed', label: 'Instaladas' },
          ]}
          onChange={setMode}
        />
        <button className="icon-btn" aria-label="Recarregar" title="Recarregar" onClick={onReload} disabled={loading}>
          <RefreshCw size={14} />
        </button>
      </div>

      {mode === 'catalog' ? (
        <>
          <div className="chips arsenal__cats">
            {categories.map((c) => (
              <button key={c} className="chip" data-state={c === category ? 'active' : undefined} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="rows">
            {catalog.skills
              .filter((s) => (category === 'Todas' || s.category === category) && matches(`${s.name} ${s.description} ${s.category}`))
              .map((s) => (
                <button key={s.id} className="row arsenal__item" onClick={() => onOpen(s.id)}>
                  <div className="row__main">
                    <div className="row__title">
                      {s.name}
                      <span className="arsenal__tag">{s.category}</span>
                      {Object.values(s.installs).includes('update') ? <span className="arsenal__tag arsenal__tag--warn">atualização</span> : null}
                    </div>
                    <div className="row__sub arsenal__desc">{s.description}</div>
                    <div className="arsenal__meta">
                      {s.source.label} · {s.license} · {s.version ?? short(s.source.commit)}
                      {installedIn(s).length ? ` · instalada em ${installedIn(s).map(targetName).join(', ')}` : ''}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </>
      ) : (
        <Installed catalog={catalog} matches={matches} onOpen={onOpen} />
      )}
    </div>
  );
}

const installedIn = (s: SkillCatalogEntry) => (Object.keys(s.installs) as SkillTargetId[]).filter((t) => s.installs[t] !== 'external');

function Installed({ catalog, matches, onOpen }: { catalog: SkillCatalog; matches: (t: string) => boolean; onOpen: (id: string) => void }) {
  const groups = catalog.targets
    .map((t) => ({ t, items: catalog.installed.filter((i) => i.targetId === t.id && matches(`${i.name} ${i.description ?? ''}`)) }))
    .filter((g) => g.items.length > 0);
  if (groups.length === 0) return <div className="arsenal__empty">Nenhuma skill encontrada nas pastas dos agentes.</div>;
  return (
    <>
      {groups.map(({ t, items }) => (
        <div key={t.id}>
          <div className="group-title">
            {t.name} <span className="arsenal__path">{t.dir}</span>
          </div>
          <div className="rows">
            {items.map((i) => (
              <div key={i.name} className="row">
                <div className="row__main">
                  <div className="row__title">
                    {i.name}
                    <span className={`arsenal__tag${i.managed ? '' : ' arsenal__tag--dim'}`}>{i.managed ? `pelo Orbi · ${short(i.commit ?? '')}` : 'fora do Orbi'}</span>
                  </div>
                  {i.description ? <div className="row__sub arsenal__desc">{i.description}</div> : null}
                </div>
                <button className="btn btn--ghost" title="Abrir pasta" onClick={() => window.orbi.skillsOpen(i.targetId, i.name)}>
                  <FolderOpen size={14} />
                </button>
                {i.managed && i.skillId ? (
                  <button className="btn" onClick={() => onOpen(i.skillId!)}>
                    Gerenciar
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// ---------- detail ----------

function Detail({
  catalog,
  skill,
  onBack,
  onPlan,
  onDone,
}: {
  catalog: SkillCatalog;
  skill: SkillCatalogEntry;
  onBack: () => void;
  onPlan: (p: SkillPlan) => void;
  onDone: (r: SkillActionResult) => void;
}) {
  const [picked, setPicked] = useState<SkillTargetId[]>(() => catalog.targets.filter((t) => t.detected && !skill.installs[t.id]).map((t) => t.id).slice(0, 1));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<SkillTargetId | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const total = skill.files.reduce((n, f) => n + f.size, 0);
  const toggle = (id: SkillTargetId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const review = async () => {
    setBusy(true);
    setError('');
    const r = await window.orbi.skillsPlan(skill.id, picked);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onPlan(r);
  };
  const remove = async (t: SkillTargetId) => {
    if (confirmRemove !== t) return setConfirmRemove(t);
    setBusy(true);
    onDone(await window.orbi.skillsUninstall(skill.id, t));
  };

  return (
    <div className="sheet__body">
      <button className="btn btn--ghost arsenal__back" onClick={onBack}>
        <ChevronLeft size={14} /> Arsenal
      </button>
      <div className="arsenal__head">
        <div className="arsenal__name">{skill.name}</div>
        <span className="arsenal__tag">{skill.category}</span>
      </div>
      <div className="arsenal__text">{skill.description}</div>

      <div className="rows">
        <div className="row">
          <div className="row__main">
            <div className="row__title">Origem</div>
            <div className="row__sub">
              {skill.source.repo} · commit {short(skill.source.commit)} · {skill.license}
            </div>
          </div>
          <button className="btn btn--ghost" onClick={() => window.orbi.openExternal(skill.source.url)}>
            <ExternalLink size={14} /> Ver no GitHub
          </button>
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__title">Arquivos</div>
            <div className="row__sub">
              {skill.files.length} arquivos, {kb(total)}. Cada um é conferido pelo hash (sha256) antes de ser gravado.
            </div>
          </div>
          <button className="btn btn--ghost" onClick={() => setShowFiles((v) => !v)}>
            {showFiles ? 'Esconder' : 'Ver lista'}
          </button>
        </div>
        {showFiles ? <FileList files={skill.files} /> : null}
        {skill.hasScripts ? (
          <div className="row arsenal__warn">
            <AlertTriangle size={15} />
            <div className="row__sub row__sub--wrap">
              Traz scripts que o agente poderá executar quando usar a skill. O Orbi nunca os executa; revise no GitHub antes de instalar.
            </div>
          </div>
        ) : null}
      </div>

      <div className="group-title">Instalar em</div>
      <div className="rows">
        {catalog.targets.map((t) => {
          const state = skill.installs[t.id];
          return (
            <label key={t.id} className="row arsenal__target">
              <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
              <div className="row__main">
                <div className="row__title">
                  {t.name}
                  {!t.detected ? <span className="arsenal__tag arsenal__tag--dim">não encontrado</span> : null}
                  {state ? <span className={`arsenal__tag${state === 'update' ? ' arsenal__tag--warn' : ''}`}>{STATE_WORD[state]}</span> : null}
                </div>
                <div className="row__sub arsenal__path">
                  {t.dir}
                  {t.alsoVisibleTo.length ? ` · também lida por ${t.alsoVisibleTo.map((x) => catalog.targets.find((y) => y.id === x)?.name).join(', ')}` : ''}
                </div>
              </div>
              {state === 'installed' || state === 'update' ? (
                <button
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={(e) => (e.preventDefault(), void remove(t.id))}
                >
                  {confirmRemove === t.id ? 'Confirmar remoção' : 'Remover'}
                </button>
              ) : null}
            </label>
          );
        })}
      </div>
      {error ? <div className="feedback arsenal__error">{error}</div> : null}
      <div className="arsenal__actions">
        <button className="btn btn--light" disabled={busy || picked.length === 0} onClick={() => void review()}>
          Conferir instalação
        </button>
      </div>
    </div>
  );
}

function FileList({ files }: { files: SkillCatalogEntry['files'] }) {
  return (
    <div className="arsenal__files">
      {files.map((f) => (
        <div key={f.path} className={f.script ? 'arsenal__file arsenal__file--script' : 'arsenal__file'}>
          <span>{f.path}</span>
          <span>{f.script ? 'script · ' : ''}{kb(f.size)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- review & confirm ----------

function Review({ catalog, plan, onCancel, onDone }: { catalog: SkillCatalog; plan: SkillPlan; onCancel: () => void; onDone: (r: SkillActionResult) => void }) {
  const [replace, setReplace] = useState(false);
  const [allowScripts, setAllowScripts] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = (id: SkillTargetId) => catalog.targets.find((t) => t.id === id)?.name ?? id;
  const clashes = plan.targets.some((t) => t.status === 'conflict' || t.status === 'modified');
  const writes = plan.targets.some((t) => t.status === 'new' || t.status === 'update' || (replace && (t.status === 'conflict' || t.status === 'modified')));
  const blocked = plan.errors.length > 0 || (plan.hasScripts && !allowScripts) || !writes;

  const confirm = async () => {
    setBusy(true);
    onDone(await window.orbi.skillsApply(plan.id, { replace, allowScripts }));
  };

  return (
    <div className="sheet__body">
      <button className="btn btn--ghost arsenal__back" onClick={onCancel} disabled={busy}>
        <ChevronLeft size={14} /> Voltar
      </button>
      <div className="arsenal__head">
        <div className="arsenal__name">Conferir: {plan.name}</div>
      </div>
      <div className="arsenal__text">
        {plan.files.length} arquivos ({kb(plan.totalBytes)}) de {plan.source.repo} no commit {short(plan.source.commit)}, licença {plan.license}.
      </div>

      {plan.errors.length ? <div className="feedback arsenal__error">{plan.errors.join(' ')}</div> : null}

      <div className="rows">
        {plan.targets.map((t) => (
          <div key={t.targetId} className="row">
            <div className="row__main">
              <div className="row__title">{name(t.targetId)}</div>
              <div className="row__sub row__sub--wrap">
                {PLAN_WORD[t.status]}: <span className="arsenal__path">{t.dir}</span>.
                {t.alsoVisibleTo.length ? ` Também será lida por ${t.alsoVisibleTo.map(name).join(', ')}.` : ''}
                {t.redundant ? ' Este agente já vai receber a skill por outra pasta escolhida: ficará duplicada.' : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {clashes ? (
        <label className="row arsenal__target">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          <div className="row__sub row__sub--wrap">Substituir as pastas existentes. A versão atual de cada uma é guardada antes, em %APPDATA%\Orbi\skill-backups.</div>
        </label>
      ) : null}
      {plan.hasScripts ? (
        <label className="row arsenal__target arsenal__warn">
          <input type="checkbox" checked={allowScripts} onChange={(e) => setAllowScripts(e.target.checked)} />
          <div className="row__sub row__sub--wrap">
            Revisei os scripts ({plan.files.filter((f) => f.script).length}) e quero instalá-los. O Orbi não os executa; o agente poderá executá-los.
          </div>
        </label>
      ) : null}

      <div className="arsenal__actions">
        <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn--light" disabled={busy || blocked} onClick={() => void confirm()}>
          {busy ? 'Instalando…' : 'Confirmar instalação'}
        </button>
      </div>
    </div>
  );
}

// ---------- result ----------

function Result({ catalog, result, onBack, onList }: { catalog: SkillCatalog; result: SkillActionResult; onBack: () => void; onList: () => void }) {
  const name = (id: SkillTargetId) => catalog.targets.find((t) => t.id === id)?.name ?? id;
  return (
    <div className="sheet__body">
      <div className="arsenal__head">
        <div className="arsenal__name">{result.ok ? 'Pronto' : 'Não foi possível concluir'}</div>
      </div>
      <div className="arsenal__text">{result.message}</div>
      {result.details.length ? (
        <div className="rows">
          {result.details.map((d) => (
            <div key={d.targetId} className="row">
              <span className="dot" style={{ background: d.ok ? '#57c993' : '#f2b84b' }} />
              <div className="row__main">
                <div className="row__title">{name(d.targetId)}</div>
                <div className="row__sub row__sub--wrap">{d.message}</div>
              </div>
              <button className="btn btn--ghost" title="Abrir pasta" onClick={() => window.orbi.skillsOpen(d.targetId)}>
                <FolderOpen size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="arsenal__text arsenal__hint">Os agentes carregam skills novas ao iniciar uma sessão: abra uma sessão nova para usá-la.</div>
      <div className="arsenal__actions">
        <button className="btn btn--ghost" onClick={onList}>
          Voltar ao Arsenal
        </button>
        <button className="btn btn--light" onClick={onBack}>
          Ver a skill
        </button>
      </div>
    </div>
  );
}
