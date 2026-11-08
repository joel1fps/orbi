import { AlertTriangle, ArrowDownToLine, Check, ChevronLeft, ExternalLink, FolderOpen, FolderPlus, GitBranch, Lock, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ago } from '@shared/tools';
import type { LocalActionResult, LocalProject, LocalReview, LocalState } from '@shared/types';

/**
 * "Locais": project folders on this computer, as cards, and sending them to
 * GitHub. The main process lists the folders, reviews every file before a
 * send and does the git work; this page only points at a listed folder.
 */

const STATE: Record<LocalState, { label: string; tone: '' | 'warn' | 'dim' | 'ok' }> = {
  'not-git': { label: 'fora do GitHub', tone: 'dim' },
  'no-remote': { label: 'fora do GitHub', tone: 'dim' },
  changes: { label: 'alterações', tone: 'warn' },
  ahead: { label: 'para enviar', tone: 'warn' },
  behind: { label: 'novidades no GitHub', tone: 'warn' },
  clean: { label: 'em dia', tone: 'ok' },
};

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const repoNameFor = (folder: string) => folder.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100) || 'projeto';

function stateText(p: LocalProject): string {
  if (p.state === 'changes') return `${p.changes} ${p.changes === 1 ? 'alteração' : 'alterações'}`;
  if (p.state === 'ahead') return `${p.ahead} para enviar`;
  if (p.state === 'behind') return `${p.behind} novidade${p.behind === 1 ? '' : 's'} no GitHub`;
  return STATE[p.state].label;
}

function Tag({ p }: { p: LocalProject }) {
  const tone = STATE[p.state].tone;
  return <span className={`arsenal__tag${tone === 'warn' ? ' arsenal__tag--warn' : tone === 'dim' ? ' arsenal__tag--dim' : ''}`}>{stateText(p)}</span>;
}

export function LocalList({ query, onOpen, reloadKey }: { query: string; onOpen: (p: LocalProject) => void; reloadKey: number }) {
  const [projects, setProjects] = useState<LocalProject[] | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    const r = await window.orbi.localList();
    setProjects(r.projects);
    setError(r.error ?? '');
  };
  useEffect(() => {
    void load();
  }, [reloadKey]);

  const add = async () => {
    const r = await window.orbi.localAdd();
    setNote(r.message ?? '');
    if (r.ok) await load();
  };

  const q = query.trim().toLowerCase();
  const shown = (projects ?? []).filter((p) => !q || `${p.name} ${p.repo ?? ''} ${p.path}`.toLowerCase().includes(q));

  return (
    <>
      <div className="arsenal__bar">
        <span className="arsenal__count">
          {projects ? `${shown.length} ${shown.length === 1 ? 'projeto' : 'projetos'} da Área de Trabalho, Documentos e pastas adicionadas` : ''}
        </span>
        <button className="btn btn--ghost" style={{ marginLeft: 'auto' }} onClick={() => void add()}>
          <FolderPlus size={14} /> Adicionar pasta…
        </button>
      </div>
      {error ? <div className="feedback arsenal__error">{error}</div> : null}
      {note ? <div className="arsenal__text arsenal__hint">{note}</div> : null}
      {projects === null ? <div className="arsenal__empty">Procurando projetos…</div> : shown.length === 0 ? <div className="arsenal__empty">Nenhum projeto.</div> : null}
      <div className="arsenal__grid">
        {shown.map((p) => (
          <button key={p.path} className="acard" onClick={() => onOpen(p)}>
            <div className="acard__top">
              <span className="gh__owner">{p.repo ?? (p.git ? 'só neste PC' : 'pasta')}</span>
              {p.added ? <span className="acard__count">adicionada</span> : null}
            </div>
            <div className="acard__name">{p.name}</div>
            <div className="acard__desc gh__path">{p.path}</div>
            <div className="acard__foot">
              {p.branch ? (
                <span className="gh__lang">
                  <GitBranch size={11} /> {p.branch}
                </span>
              ) : null}
              <span style={{ marginLeft: 'auto' }}>
                <Tag p={p} />
              </span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

export function LocalDetail({ project: p, onBack, onChanged }: { project: LocalProject; onBack: () => void; onChanged: () => void }) {
  const publishing = !p.repo;
  const [review, setReview] = useState<LocalReview | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const [name, setName] = useState(repoNameFor(p.name));
  const [description, setDescription] = useState('');
  const [priv, setPriv] = useState(true);
  const [message, setMessage] = useState(publishing ? 'Primeira versão' : '');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<LocalActionResult | null>(null);

  const loadReview = async () => {
    setReview(null);
    setReviewError('');
    const r = await window.orbi.localReview(p.path);
    if ('error' in r) setReviewError(r.error);
    else setReview(r);
  };
  useEffect(() => {
    if (p.state !== 'clean') void loadReview();
  }, [p.path]);

  const run = async (label: string, fn: () => Promise<LocalActionResult>) => {
    setBusy(label);
    setResult(null);
    const r = await fn();
    setBusy('');
    setResult(r);
    if (r.ok) onChanged();
    else void loadReview();
  };

  const blocked = !review || review.blockers.length > 0;
  const nothing = review !== null && review.files.length === 0 && p.ahead === 0;
  const secretCount = review?.files.filter((f) => f.secret).length ?? 0;
  // Secret by name (.env, keys) can be ignored; a token inside source code has to be removed by hand.
  const secretFiles = review?.files.filter((f) => f.ignorable).length ?? 0;
  const ignore = async () => {
    setBusy('ignore');
    const r = await window.orbi.localIgnore(p.path);
    setBusy('');
    setResult(r.ok ? null : r);
    await loadReview();
  };

  return (
    <div className="sheet__body">
      <button className="btn btn--ghost arsenal__back" onClick={onBack} disabled={Boolean(busy)}>
        <ChevronLeft size={14} /> Locais
      </button>
      <div className="arsenal__head">
        <div className="arsenal__name">{p.name}</div>
        <Tag p={p} />
        {p.branch ? <span className="arsenal__tag arsenal__tag--dim">{p.branch}</span> : null}
      </div>
      <div className="arsenal__meta arsenal__origin">
        <span className="arsenal__path">{p.path}</span>
        {p.repo ? ` · ${p.repo}` : ''}
        {p.updatedAt ? ` · mexido ${ago(p.updatedAt)}` : ''}
      </div>
      <div className="arsenal__actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn--ghost" onClick={() => window.orbi.openPath(p.path)}>
          <FolderOpen size={14} /> Abrir pasta
        </button>
        {p.repo ? (
          <button className="btn btn--ghost" onClick={() => window.orbi.openExternal(`https://github.com/${p.repo}`)}>
            <ExternalLink size={14} /> Abrir no GitHub
          </button>
        ) : null}
        {p.added ? (
          <button className="btn btn--ghost" onClick={() => (window.orbi.localRemove(p.path), onChanged(), onBack())}>
            Tirar da lista
          </button>
        ) : null}
      </div>

      {p.otherRemote && publishing ? (
        <div className="arsenal__text">Este projeto já está ligado a outro servidor Git (fora do GitHub). O Orbi não troca isso.</div>
      ) : publishing ? (
        <>
          <div className="group-title">Publicar no GitHub</div>
          <div className="rows">
            <label className="row">
              <div className="row__main">
                <div className="row__title">Nome do repositório</div>
              </div>
              <input className="field" style={{ width: 240 }} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            </label>
            <label className="row">
              <div className="row__main">
                <div className="row__title">Descrição</div>
              </div>
              <input className="field" style={{ width: 240 }} placeholder="Opcional" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="row arsenal__target">
              <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
              <Lock size={13} />
              <div className="row__sub row__sub--wrap">Privado: só você (e quem você convidar) vê o projeto.</div>
            </label>
          </div>
        </>
      ) : p.state === 'clean' ? (
        <div className="arsenal__text">
          <Check size={13} /> Em dia: o GitHub tem tudo o que está neste PC.
        </div>
      ) : (
        <div className="group-title">{p.state === 'behind' ? 'O GitHub tem novidades' : 'Enviar para o GitHub'}</div>
      )}

      {p.state === 'behind' ? (
        <div className="arsenal__actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn" disabled={Boolean(busy)} onClick={() => void run('pull', () => window.orbi.localPull(p.path))}>
            <ArrowDownToLine size={14} /> {busy === 'pull' ? 'Trazendo…' : 'Trazer para este PC'}
          </button>
        </div>
      ) : null}

      {p.state !== 'clean' && !(p.otherRemote && publishing) && !result?.ok ? (
        <>
          {reviewError ? <div className="feedback arsenal__error">{reviewError}</div> : null}
          {!review && !reviewError ? <div className="arsenal__text arsenal__hint">Conferindo os arquivos…</div> : null}
          {review ? (
            <div className="rows" style={{ marginTop: 8 }}>
              <div className="row">
                <div className="row__main">
                  <div className="row__title">
                    {review.total} {review.total === 1 ? 'arquivo' : 'arquivos'} {publishing ? 'vão para o GitHub' : 'mudaram'}
                    {secretCount ? <span className="arsenal__tag arsenal__tag--warn">{secretCount} com segredo</span> : null}
                  </div>
                  <div className="row__sub row__sub--wrap">
                    {kb(review.files.reduce((n, f) => n + f.size, 0))}. Cada arquivo de texto foi conferido atrás de senhas, chaves e tokens.
                  </div>
                </div>
                <button className="btn btn--ghost" onClick={() => setShowFiles((v) => !v)}>
                  {showFiles ? 'Esconder' : 'Ver arquivos'}
                </button>
              </div>
              {showFiles ? (
                <div className="arsenal__files">
                  {review.files.map((f) => (
                    <div key={f.path} className={f.secret || f.big ? 'arsenal__file arsenal__file--script' : 'arsenal__file'}>
                      <span>
                        {f.status === ' D' || f.status === 'D ' ? '(apagado) ' : ''}
                        {f.path}
                      </span>
                      <span>{f.secret ? f.secret : kb(f.size)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {review.gitignore ? (
                <div className="row">
                  <div className="row__sub row__sub--wrap">
                    A pasta não tem .gitignore: o Orbi cria um que deixa de fora node_modules, builds, logs e segredos (.env, chaves).
                  </div>
                </div>
              ) : null}
              {review.blockers.map((b) => (
                <div key={b} className="row arsenal__warn">
                  <AlertTriangle size={15} />
                  <div className="row__sub row__sub--wrap">{b}</div>
                </div>
              ))}
              {secretFiles > 0 ? (
                <div className="row">
                  <div className="row__sub row__sub--wrap">
                    {secretFiles === 1 ? 'O arquivo secreto pode' : `Os ${secretFiles} arquivos secretos podem`} ficar só neste PC: o Orbi coloca no .gitignore e eles continuam na pasta.
                    {secretCount > secretFiles ? ' Nos outros, tire a senha ou o token do código.' : ''}
                  </div>
                  <button className="btn" disabled={Boolean(busy)} onClick={() => void ignore()}>
                    Colocar no .gitignore
                  </button>
                </div>
              ) : null}
              {review.warnings.map((w) => (
                <div key={w} className="row">
                  <div className="row__sub row__sub--wrap">{w}</div>
                </div>
              ))}
            </div>
          ) : null}

          {p.state !== 'behind' || p.changes > 0 ? (
            <div className="rows" style={{ marginTop: 8 }}>
              <label className="row">
                <div className="row__main">
                  <div className="row__title">O que mudou</div>
                  <div className="row__sub">Vira a descrição desta versão no GitHub.</div>
                </div>
                <input
                  className="field"
                  style={{ width: 260 }}
                  placeholder="Ex.: corrige o login"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={!publishing && p.changes === 0}
                />
              </label>
            </div>
          ) : null}

          <div className="arsenal__actions">
            {publishing ? (
              <button
                className="btn btn--light"
                disabled={Boolean(busy) || blocked || nothing || !name.trim()}
                onClick={() => void run('publish', () => window.orbi.localPublish(p.path, { name: name.trim(), description, private: priv, message }))}
              >
                <Upload size={14} /> {busy === 'publish' ? 'Publicando…' : `Publicar ${priv ? 'como privado' : 'como público'}`}
              </button>
            ) : p.changes > 0 || p.ahead > 0 ? (
              <button
                className="btn btn--light"
                disabled={Boolean(busy) || blocked || (p.changes > 0 && !message.trim())}
                onClick={() => void run('send', () => window.orbi.localSend(p.path, message))}
              >
                <Upload size={14} /> {busy === 'send' ? 'Enviando…' : 'Enviar para o GitHub'}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {result ? (
        <div className={`feedback${result.ok ? '' : ' arsenal__error'}`}>
          {result.ok ? <Check size={13} /> : null} {result.message}
          {result.url ? (
            <button className="btn btn--ghost" style={{ marginLeft: 8 }} onClick={() => window.orbi.openExternal(result.url!)}>
              <ExternalLink size={14} /> Ver no GitHub
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="arsenal__text arsenal__hint">
        O Orbi nunca força um envio nem apaga nada no GitHub. Se o GitHub e este PC tiverem versões diferentes, ele para e explica.
      </div>
    </div>
  );
}
