import { AlertTriangle, Check, ChevronLeft, Copy, ExternalLink, FolderOpen, RefreshCw, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_TOOLS } from '@shared/tools';
import type { SkillActionResult, SkillCatalog, SkillCatalogEntry, SkillPlan, SkillTargetId } from '@shared/types';
import { Segmented } from '../components/ui';

/**
 * Skills Arsenal: cards side by side; a card opens its detail, with one
 * install button per agent (enabled only where the agent supports it), then
 * a review of exactly what will be written, then the result. Everything
 * that touches the disk or the network happens in the main process.
 */

type Screen =
  | { type: 'grid' }
  | { type: 'detail'; id: string }
  | { type: 'plan'; plan: SkillPlan }
  | { type: 'result'; id: string; result: SkillActionResult };

const AGENT_COLOR: Record<SkillTargetId, string> = {
  claude: BUILTIN_TOOLS.claude.color,
  codex: BUILTIN_TOOLS.codex.color,
  gemini: BUILTIN_TOOLS.gemini.color,
  antigravity: BUILTIN_TOOLS.antigravity.color,
  cursor: '#cbd5e1',
};

const PLAN_WORD: Record<SkillPlan['targets'][number]['status'], string> = {
  new: 'Instalação nova',
  update: 'Atualizar o que o Orbi instalou',
  same: 'Já instalado nesta versão: nada muda',
  modified: 'Você editou alguma pasta depois da instalação',
  conflict: 'Já existe pasta com esse nome que o Orbi não instalou',
};

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const short = (sha: string) => sha.slice(0, 7);
const installable = (s: SkillCatalogEntry) => Boolean(s.source) && s.skills.length > 0;

/**
 * The last catalog read, kept across tab switches: reopening the Arsenal shows
 * it at once and refreshes behind it, instead of a short "Carregando" box that
 * made the island shrink and then jump to the full grid.
 */
let lastCatalog: SkillCatalog | null = null;

export async function loadCatalog(): Promise<SkillCatalog> {
  lastCatalog = await window.orbi.skillsCatalog();
  return lastCatalog;
}

/** Read the catalog ahead of the first visit (the panel calls this when it opens). */
export function prefetchCatalog() {
  if (!lastCatalog) void loadCatalog().catch(() => undefined);
}

export function ArsenalSheet() {
  const [catalog, setCatalog] = useState<SkillCatalog | null>(lastCatalog);
  const [screen, setScreen] = useState<Screen>({ type: 'grid' });
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setCatalog(await loadCatalog());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, []);

  if (!catalog) return <div className="sheet__body arsenal__empty">Carregando o catálogo…</div>;
  if (catalog.error) return <div className="sheet__body arsenal__empty">{catalog.error}</div>;

  const item = (id: string) => catalog.skills.find((s) => s.id === id);
  const toGrid = () => setScreen({ type: 'grid' });
  const finish = (id: string) => async (result: SkillActionResult) => {
    await reload();
    setScreen({ type: 'result', id, result });
  };

  if (screen.type === 'detail' && item(screen.id)) {
    return <Detail catalog={catalog} skill={item(screen.id)!} onBack={toGrid} onPlan={(plan) => setScreen({ type: 'plan', plan })} onDone={finish(screen.id)} />;
  }
  if (screen.type === 'plan') {
    return <Review catalog={catalog} plan={screen.plan} onCancel={() => setScreen({ type: 'detail', id: screen.plan.skillId })} onDone={finish(screen.plan.skillId)} />;
  }
  if (screen.type === 'result') {
    return <Result catalog={catalog} result={screen.result} onBack={() => setScreen({ type: 'detail', id: screen.id })} onList={toGrid} />;
  }
  return <Grid catalog={catalog} loading={loading} onReload={reload} onOpen={(id) => setScreen({ type: 'detail', id })} />;
}

// ---------- grid ----------

function Grid({ catalog, loading, onReload, onOpen }: { catalog: SkillCatalog; loading: boolean; onReload: () => void; onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<'all' | 'mine' | 'installed'>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todas');
  const [updating, setUpdating] = useState(false);
  const [updateNote, setUpdateNote] = useState('');
  const update = async () => {
    setUpdating(true);
    setUpdateNote('Procurando versões novas no GitHub…');
    const r = await window.orbi.skillsRefresh();
    setUpdating(false);
    setUpdateNote(r.message);
    onReload();
  };
  const since = catalog.updatedAt ? new Date(catalog.updatedAt).toLocaleDateString('pt-BR') : null;
  const q = query.trim().toLowerCase();
  const pool = useMemo(() => {
    if (mode === 'mine') return catalog.skills.filter((s) => s.origin === 'refs' || s.mine);
    if (mode === 'installed') return catalog.skills.filter((s) => Object.values(s.installs).some((v) => v !== 'external'));
    return catalog.skills;
  }, [catalog, mode]);
  const categories = useMemo(() => ['Todas', ...new Set(pool.map((s) => s.category))], [pool]);
  const shown = pool.filter(
    (s) => (category === 'Todas' || s.category === category) && (!q || `${s.name} ${s.description} ${s.category} ${s.kind}`.toLowerCase().includes(q)),
  );

  return (
    <div className="sheet__body">
      <div className="arsenal__bar">
        <input className="field" style={{ flex: 1 }} placeholder="Buscar skills, plugins, MCPs…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Segmented
          label="Mostrar"
          value={mode}
          options={[
            { value: 'all', label: 'Tudo' },
            { value: 'mine', label: 'Meu site' },
            { value: 'installed', label: 'Instaladas' },
          ]}
          onChange={(m) => (setMode(m), setCategory('Todas'))}
        />
        <button className="icon-btn" aria-label="Recarregar" title="Recarregar" onClick={onReload} disabled={loading}>
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="arsenal__bar">
        <select className="field arsenal__select" aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'Todas' ? 'Todas as categorias' : c}
            </option>
          ))}
        </select>
        <span className="arsenal__count">
          {shown.length} {shown.length === 1 ? 'item' : 'itens'}
        </span>
        <button className="btn btn--ghost" disabled={updating} title={since ? `Catálogo de ${since}` : undefined} onClick={() => void update()}>
          <RefreshCw size={13} className={updating ? 'live__spin' : undefined} /> {updating ? 'Atualizando…' : 'Atualizar catálogo'}
        </button>
      </div>
      {updateNote ? <div className="arsenal__text arsenal__hint">{updateNote}</div> : null}
      {shown.length === 0 ? <div className="arsenal__empty">Nada encontrado.</div> : null}
      <div className="arsenal__grid">
        {shown.map((s) => (
          <Card key={s.id} s={s} onOpen={() => onOpen(s.id)} />
        ))}
      </div>
      {mode === 'installed' ? <External catalog={catalog} /> : null}
    </div>
  );
}

function Card({ s, onOpen }: { s: SkillCatalogEntry; onOpen: () => void }) {
  const installedIn = (Object.keys(s.installs) as SkillTargetId[]).filter((t) => s.installs[t] !== 'external');
  const update = Object.values(s.installs).includes('update');
  const edited = Object.values(s.installs).includes('modified');
  return (
    <button className="acard" onClick={onOpen}>
      <div className="acard__top">
        <span className={`acard__kind${installable(s) ? '' : ' acard__kind--manual'}`}>{s.kind}</span>
        {s.mine ? <Star size={12} className="acard__star" aria-label="Na minha stack" /> : null}
        {s.skills.length > 1 ? <span className="acard__count">{s.skills.length} skills</span> : null}
      </div>
      <div className="acard__name">{s.name}</div>
      <div className="acard__desc">{s.description}</div>
      <div className="acard__foot">
        <span className="acard__agents" title={`Suporte: ${s.support.join(', ')}`}>
          {s.support.map((t) => (
            <span key={t} className="acard__agent" style={{ background: AGENT_COLOR[t] }} />
          ))}
        </span>
        {edited ? <span className="arsenal__tag arsenal__tag--warn">editada</span> : update ? <span className="arsenal__tag arsenal__tag--warn">atualizar</span> : installedIn.length ? <span className="acard__ok"><Check size={12} /> {installedIn.length}</span> : null}
        {!installable(s) ? <span className="acard__manual">manual</span> : null}
      </div>
    </button>
  );
}

/** Skills found in the agents' folders that no catalog card covers. */
function External({ catalog }: { catalog: SkillCatalog }) {
  const known = new Set(catalog.skills.flatMap((s) => s.skills.map((k) => k.name)));
  const rest = catalog.installed.filter((i) => !i.managed && !known.has(i.name));
  if (rest.length === 0) return null;
  return (
    <>
      <div className="group-title">Nas pastas dos agentes, fora do catálogo</div>
      <div className="rows">
        {rest.map((i) => (
          <div key={`${i.targetId}/${i.name}`} className="row">
            <div className="row__main">
              <div className="row__title">
                {i.name}
                <span className="arsenal__tag arsenal__tag--dim">{catalog.targets.find((t) => t.id === i.targetId)?.name}</span>
              </div>
              {i.description ? <div className="row__sub arsenal__desc">{i.description}</div> : null}
            </div>
            <button className="btn btn--ghost" title="Abrir pasta" onClick={() => window.orbi.skillsOpen(i.targetId, i.name)}>
              <FolderOpen size={14} />
            </button>
          </div>
        ))}
      </div>
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<SkillTargetId | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [copied, setCopied] = useState(false);
  const files = skill.skills.flatMap((s) => s.files.map((f) => ({ ...f, path: skill.skills.length > 1 ? `${s.name}/${f.path}` : f.path })));
  const total = files.reduce((n, f) => n + f.size, 0);
  const canInstall = installable(skill);

  const review = async (targets: SkillTargetId[]) => {
    setBusy(true);
    setError('');
    const r = await window.orbi.skillsPlan(skill.id, targets);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onPlan(r);
  };
  const remove = async (t: SkillTargetId) => {
    if (confirmRemove !== t) return setConfirmRemove(t);
    setBusy(true);
    onDone(await window.orbi.skillsUninstall(skill.id, t));
  };
  const copy = async () => {
    await navigator.clipboard.writeText(skill.manual?.install ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const everywhere = catalog.targets.filter((t) => t.detected && skill.support.includes(t.id) && skill.installs[t.id] !== 'installed').map((t) => t.id);

  return (
    <div className="sheet__body">
      <button className="btn btn--ghost arsenal__back" onClick={onBack}>
        <ChevronLeft size={14} /> Arsenal
      </button>
      <div className="arsenal__head">
        <div className="arsenal__name">{skill.name}</div>
        <span className="arsenal__tag">{skill.kind}</span>
        <span className="arsenal__tag arsenal__tag--dim">{skill.category}</span>
        {skill.mine ? <Star size={13} className="acard__star" aria-label="Na minha stack" /> : null}
      </div>
      <div className="arsenal__text">{skill.description}</div>
      <div className="arsenal__meta arsenal__origin">
        {skill.origin === 'refs' ? 'Do seu site de referências' : 'Curadoria do Orbi'}
        {skill.source ? ` · ${skill.source.repo} · commit ${short(skill.source.commit)}` : ''}
        {skill.source?.private ? ' · repositório privado (precisa do GitHub conectado)' : ''}
        {skill.license ? ` · licença ${skill.license}` : ''}
      </div>

      {canInstall ? (
        <>
          <div className="group-title">Instalar em</div>
          <div className="agents">
            {catalog.targets.map((t) => {
              const supported = skill.support.includes(t.id);
              const state = skill.installs[t.id];
              const label = !supported ? 'Sem suporte' : state === 'installed' ? 'Instalada' : state === 'update' ? 'Atualizar' : state === 'modified' ? 'Editada por você' : state === 'external' ? 'Pasta existente' : 'Instalar';
              return (
                <div key={t.id} className="agent">
                  <button
                    className={`agent__btn${state === 'installed' ? ' agent__btn--done' : ''}`}
                    style={{ ['--agent' as string]: AGENT_COLOR[t.id] }}
                    disabled={!supported || busy}
                    title={supported ? t.dir : `${skill.name} não declara suporte a ${t.name}`}
                    onClick={() => void review([t.id])}
                  >
                    <span className="agent__name">{t.name}</span>
                    <span className="agent__state">
                      {state === 'installed' ? <Check size={12} /> : null} {label}
                    </span>
                    {supported && !t.detected ? <span className="agent__hint">não encontrado</span> : null}
                  </button>
                  {state === 'installed' || state === 'update' || state === 'modified' ? (
                    <button className="agent__remove" disabled={busy} onClick={() => void remove(t.id)}>
                      {confirmRemove === t.id ? 'Confirmar remoção' : 'Remover'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {everywhere.length > 1 ? (
            <div className="arsenal__actions" style={{ justifyContent: 'flex-start' }}>
              <button className="btn" disabled={busy} onClick={() => void review(everywhere)}>
                Instalar em todos os compatíveis encontrados ({everywhere.length})
              </button>
            </div>
          ) : null}
          {error ? <div className="feedback arsenal__error">{error}</div> : null}

          <div className="rows" style={{ marginTop: 12 }}>
            <div className="row">
              <div className="row__main">
                <div className="row__title">{skill.skills.length > 1 ? `${skill.skills.length} skills neste pacote` : 'Arquivos'}</div>
                <div className="row__sub row__sub--wrap">
                  {skill.skills.length > 1 ? `${skill.skills.map((s) => s.name).join(', ')}. ` : ''}
                  {files.length} arquivos, {kb(total)}, cada um conferido pelo hash antes de ser gravado.
                </div>
              </div>
              <button className="btn btn--ghost" onClick={() => setShowFiles((v) => !v)}>
                {showFiles ? 'Esconder' : 'Ver arquivos'}
              </button>
              {skill.source ? (
                <button className="btn btn--ghost" onClick={() => window.orbi.openExternal(skill.source!.url)}>
                  <ExternalLink size={14} /> GitHub
                </button>
              ) : null}
            </div>
            {showFiles ? <FileList files={files} /> : null}
            {skill.hasScripts ? (
              <div className="row arsenal__warn">
                <AlertTriangle size={15} />
                <div className="row__sub row__sub--wrap">Traz scripts que o agente poderá executar ao usar a skill. O Orbi nunca os executa; revise no GitHub antes de instalar.</div>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="group-title">Instalação manual</div>
          <div className="arsenal__text">
            {skill.manual?.note ?? `Este item é ${skill.kind === 'MCP' ? 'um servidor MCP' : `do tipo ${skill.kind}`}, não uma pasta de skill: o Orbi mostra como instalar, mas não instala sozinho.`} Funciona em:{' '}
            {skill.support.map((t) => catalog.targets.find((x) => x.id === t)?.name).join(', ')}.
          </div>
          {skill.manual?.install ? (
            <div className="arsenal__cmd">
              <pre>{skill.manual.install}</pre>
              <button className="btn btn--ghost" onClick={() => void copy()}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          ) : null}
          <div className="arsenal__actions" style={{ justifyContent: 'flex-start' }}>
            {skill.manual?.url ? (
              <button className="btn" onClick={() => window.orbi.openExternal(skill.manual!.url)}>
                <ExternalLink size={14} /> Abrir link
              </button>
            ) : null}
            {skill.manual?.docs ? (
              <button className="btn btn--ghost" onClick={() => window.orbi.openExternal(skill.manual!.docs!)}>
                Documentação
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function FileList({ files }: { files: SkillCatalogEntry['skills'][number]['files'] }) {
  return (
    <div className="arsenal__files">
      {files.map((f) => (
        <div key={f.path} className={f.script ? 'arsenal__file arsenal__file--script' : 'arsenal__file'}>
          <span>{f.path}</span>
          <span>
            {f.script ? 'script · ' : ''}
            {kb(f.size)}
          </span>
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
  const clashes = plan.targets.some((t) => t.folders.some((f) => f.status === 'conflict' || f.status === 'modified'));
  const writes = plan.targets.some((t) => t.folders.some((f) => f.status === 'new' || f.status === 'update' || (replace && (f.status === 'conflict' || f.status === 'modified'))));
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
        {plan.files.length} arquivos ({kb(plan.totalBytes)}) de {plan.source.repo} no commit {short(plan.source.commit)}
        {plan.license ? `, licença ${plan.license}` : ''}.
      </div>
      {plan.errors.length ? <div className="feedback arsenal__error">{plan.errors.join(' ')}</div> : null}

      <div className="rows">
        {plan.targets.map((t) => (
          <div key={t.targetId} className="row">
            <div className="row__main">
              <div className="row__title">{name(t.targetId)}</div>
              <div className="row__sub row__sub--wrap">
                {PLAN_WORD[t.status]}: <span className="arsenal__path">{t.dir}</span>.
                {t.folders.length > 1 ? ` Pastas: ${t.folders.map((f) => `${f.name}${f.status === 'new' ? '' : ` (${f.status === 'same' ? 'igual' : f.status === 'update' ? 'atualiza' : f.status === 'modified' ? 'editada' : 'conflito'})`}`).join(', ')}.` : ''}
                {t.alsoVisibleTo.length ? ` Também será lida por ${t.alsoVisibleTo.map(name).join(', ')}.` : ''}
                {t.redundant ? ' Este agente já recebe pela pasta de outra escolha: ficará duplicada.' : ''}
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
      <div className="arsenal__text arsenal__hint">Os agentes carregam skills novas ao iniciar uma sessão: abra uma sessão nova para usar.</div>
      <div className="arsenal__actions">
        <button className="btn btn--ghost" onClick={onList}>
          Voltar ao Arsenal
        </button>
        <button className="btn btn--light" onClick={onBack}>
          Ver o item
        </button>
      </div>
    </div>
  );
}
