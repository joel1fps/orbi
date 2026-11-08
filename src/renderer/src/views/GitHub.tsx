import { Check, ChevronLeft, Download, ExternalLink, FolderOpen, GitFork, Lock, RefreshCw, Search, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ago } from '@shared/tools';
import type { CloneProgress, CloneResult, GithubRepo, RepoListKind } from '@shared/types';
import { Segmented } from '../components/ui';
import { useApp } from '../store';

/**
 * GitHub tab, next to the Arsenal: repositories as cards — yours, the ones
 * you starred, someone's, or a search of all of GitHub. A card opens its
 * detail, where "Puxar para a Área de Trabalho" clones it. Listing and
 * cloning happen in the main process; this page only sends names.
 */

const LANG_COLOR: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572a5',
  Rust: '#dea584',
  Go: '#00add8',
  Java: '#b07219',
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#555555',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  PHP: '#4f5d95',
  Ruby: '#701516',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  Dart: '#00b4ab',
  Vue: '#41b883',
};

const PLACEHOLDER: Record<RepoListKind, string> = {
  mine: 'Filtrar meus repositórios…',
  starred: 'Filtrar os que você marcou com estrela…',
  user: 'Usuário do GitHub (ex.: torvalds) e Enter',
  search: 'Buscar projetos em todo o GitHub e Enter',
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

export function GithubSheet() {
  const gh = useApp((s) => s.hub.github);
  const [kind, setKind] = useState<RepoListKind>('mine');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<GithubRepo | null>(null);
  const remote = kind === 'user' || kind === 'search';

  const load = async (k: RepoListKind, q: string) => {
    setLoading(true);
    setError('');
    const r = await window.orbi.githubRepos(k, q);
    setLoading(false);
    setRepos(r.repos);
    setError(r.error ?? '');
  };
  // "Meus" and "Estrelas" load at once; "De alguém" and "Explorar" wait for Enter.
  useEffect(() => {
    if (!remote) void load(kind, '');
    else if (submitted) void load(kind, submitted);
    else setRepos([]);
  }, [kind, submitted]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (repos ?? []).filter((r) => remote || !q || `${r.fullName} ${r.description ?? ''} ${r.language ?? ''}`.toLowerCase().includes(q)),
    [repos, q, remote],
  );

  if (open) return <RepoDetail repo={open} onBack={() => setOpen(null)} />;

  return (
    <div className="sheet__body">
      <div className="arsenal__bar">
        <div className="gh__search">
          <Search size={13} />
          <input
            className="field"
            placeholder={PLACEHOLDER[kind]}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && remote && setSubmitted(query.trim())}
          />
        </div>
        <button
          className="icon-btn"
          aria-label="Recarregar"
          title="Recarregar"
          disabled={loading}
          onClick={() => void load(kind, remote ? submitted : '')}
        >
          <RefreshCw size={14} className={loading ? 'live__spin' : undefined} />
        </button>
      </div>
      <div className="arsenal__bar">
        <Segmented
          label="Mostrar"
          value={kind}
          options={[
            { value: 'mine', label: 'Meus' },
            { value: 'starred', label: 'Estrelas' },
            { value: 'user', label: 'De alguém' },
            { value: 'search', label: 'Explorar' },
          ]}
          onChange={(k) => (setKind(k), setQuery(''), setSubmitted(''), setRepos(null))}
        />
        <span className="arsenal__count">
          {gh?.ok ? `@${gh.login}` : ''} {repos ? `· ${shown.length} ${shown.length === 1 ? 'projeto' : 'projetos'}` : ''}
        </span>
      </div>
      {error ? <div className="feedback arsenal__error">{error}</div> : null}
      {repos === null || (loading && shown.length === 0) ? (
        <div className="arsenal__empty">Carregando…</div>
      ) : shown.length === 0 && !error ? (
        <div className="arsenal__empty">{remote && !submitted ? 'Digite e aperte Enter.' : 'Nenhum projeto.'}</div>
      ) : null}
      <div className="arsenal__grid">
        {shown.map((r) => (
          <RepoCard key={r.fullName} r={r} showOwner={kind !== 'mine'} onOpen={() => setOpen(r)} />
        ))}
      </div>
    </div>
  );
}

function RepoCard({ r, showOwner, onOpen }: { r: GithubRepo; showOwner: boolean; onOpen: () => void }) {
  return (
    <button className="acard" onClick={onOpen}>
      <div className="acard__top">
        {r.avatar ? <img className="gh__avatar" src={`${r.avatar}&s=40`} alt="" /> : null}
        <span className="gh__owner">{showOwner ? r.owner : r.private ? 'privado' : 'público'}</span>
        {r.private ? <Lock size={11} className="gh__lock" aria-label="Privado" /> : null}
        {r.fork ? <GitFork size={11} className="gh__lock" aria-label="Fork" /> : null}
      </div>
      <div className="acard__name">{r.name}</div>
      <div className="acard__desc">{r.description ?? 'Sem descrição.'}</div>
      <div className="acard__foot">
        {r.language ? (
          <span className="gh__lang">
            <span className="acard__agent" style={{ background: LANG_COLOR[r.language] ?? '#8b949e' }} /> {r.language}
          </span>
        ) : null}
        <span className="gh__stars">
          <Star size={11} /> {fmt(r.stars)}
        </span>
      </div>
    </button>
  );
}

function RepoDetail({ repo, onBack }: { repo: GithubRepo; onBack: () => void }) {
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [result, setResult] = useState<CloneResult | null>(null);
  const busy = progress !== null && result === null;
  const updated = repo.updatedAt ? Date.parse(repo.updatedAt) : NaN;

  useEffect(() => {
    const off = window.orbi.onClone((p) => p.fullName === repo.fullName && setProgress(p));
    return () => void off();
  }, [repo.fullName]);

  const clone = async (pick: boolean) => {
    setResult(null);
    setProgress({ fullName: repo.fullName, percent: 0, phase: 'Conectando' });
    const r = await window.orbi.githubClone(repo.fullName, pick);
    setResult(r);
    if (!r.ok) setProgress(null);
  };

  return (
    <div className="sheet__body">
      <button className="btn btn--ghost arsenal__back" onClick={onBack} disabled={busy}>
        <ChevronLeft size={14} /> GitHub
      </button>
      <div className="arsenal__head">
        {repo.avatar ? <img className="gh__avatar gh__avatar--big" src={`${repo.avatar}&s=64`} alt="" /> : null}
        <div className="arsenal__name">{repo.fullName}</div>
        {repo.private ? <span className="arsenal__tag arsenal__tag--warn">privado</span> : null}
        {repo.archived ? <span className="arsenal__tag arsenal__tag--dim">arquivado</span> : null}
        {repo.fork ? <span className="arsenal__tag arsenal__tag--dim">fork</span> : null}
      </div>
      <div className="arsenal__text">{repo.description ?? 'Sem descrição.'}</div>
      <div className="arsenal__meta arsenal__origin">
        {repo.language ? `${repo.language} · ` : ''}
        {fmt(repo.stars)} estrelas · {fmt(repo.forks)} forks
        {Number.isFinite(updated) ? ` · último push ${ago(updated)}` : ''}
      </div>

      <div className="group-title">Puxar o projeto</div>
      <div className="arsenal__actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn--light" disabled={busy} onClick={() => void clone(false)}>
          <Download size={14} /> Puxar para a Área de Trabalho
        </button>
        <button className="btn" disabled={busy} onClick={() => void clone(true)}>
          <FolderOpen size={14} /> Escolher pasta…
        </button>
        <button className="btn btn--ghost" onClick={() => window.orbi.openExternal(repo.url)}>
          <ExternalLink size={14} /> Abrir no GitHub
        </button>
      </div>

      {progress && !result ? (
        <div className="gh__progress" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="gh__bar">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="gh__phase">
            {progress.phase} · {progress.percent}%
          </span>
        </div>
      ) : null}
      {result ? (
        <div className={`feedback${result.ok ? '' : ' arsenal__error'}`}>
          {result.ok ? <Check size={13} /> : null} {result.message}
          {result.path ? (
            <button className="btn btn--ghost" style={{ marginLeft: 8 }} onClick={() => window.orbi.openPath(result.path!)}>
              <FolderOpen size={14} /> Abrir pasta
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="arsenal__text arsenal__hint">
        O Orbi usa o seu Git para copiar o projeto e não executa nada dele. Projetos privados usam o token conectado em Ferramentas.
      </div>
    </div>
  );
}
