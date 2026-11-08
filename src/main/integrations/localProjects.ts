import { app, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, resolve } from 'node:path';
import type { LocalActionResult, LocalFile, LocalProject, LocalReview } from '@shared/types';
import { store } from '../store';
import { getWidget, send } from '../widget';
import { whichCommand } from './detect';
import { githubAuth } from './github';
import { api, gitEnv } from './githubRepos';
import {
  BIG_FILE,
  DEFAULT_GITIGNORE,
  githubRepoOf,
  isNewRepoName,
  MAX_FILE,
  parseStatus,
  secretInText,
  secretPathReason,
  stateOf,
} from './localLogic';

/**
 * The "Locais" tab: project folders on this computer, and sending them to
 * GitHub. Folders come from the Desktop, Documents and the ones the user
 * adds in a dialog; the renderer can only point at a folder from that list.
 * Before anything is written, a review lists every file that would go up
 * and stops on keys, .env files, tokens inside files and files GitHub
 * refuses. Never force-pushes, never rewrites history, never merges on its
 * own: when GitHub has news the PC lacks, it only fast-forwards.
 */

const SKIP = new Set(['node_modules', 'AppData', '$RECYCLE.BIN', 'System Volume Information', 'OneDriveTemp']);
const MAX_PROJECTS = 200;
const MAX_LISTED = 4000;
const SCAN_BYTES = 50 * 1024 * 1024;
const TEXT_LIMIT = 1024 * 1024;

const key = (p: string) => normalize(p).toLowerCase();
let known = new Map<string, LocalProject>();

interface GitRun {
  code: number;
  out: string;
  err: string;
}

let gitBin: string | null | undefined;
async function git(cwd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<GitRun> {
  if (gitBin === undefined) gitBin = await whichCommand('git');
  if (!gitBin) return { code: -1, out: '', err: 'O Git não está instalado neste computador.' };
  return new Promise((done) => {
    const child = spawn(gitBin!, ['-c', 'core.quotepath=false', ...args], {
      cwd,
      env: opts.env ?? { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), opts.timeout ?? 60_000);
    child.stdout.on('data', (b: Buffer) => (out.length < 64 * 1024 * 1024 ? (out += b.toString('utf8')) : undefined));
    child.stderr.on('data', (b: Buffer) => (err = (err + b.toString('utf8')).slice(-8000)));
    child.on('error', (e) => (clearTimeout(timer), done({ code: -1, out, err: e.message })));
    child.on('close', (c) => (clearTimeout(timer), done({ code: c ?? -1, out, err })));
  });
}

/** git's last error line, readable. */
const why = (r: GitRun) =>
  r.err
    .split(/\r?\n/)
    .filter((l) => /fatal|error|rejected|hint: Updates/i.test(l))
    .map((l) => l.replace(/^(fatal|error):\s*/i, ''))
    .slice(-2)
    .join(' ') || 'o git parou sem dizer o motivo.';

/** The files git names in "would be overwritten" and similar errors (tab-indented lines). */
const filesIn = (r: GitRun) =>
  r.err
    .split(/\r?\n/)
    .filter((l) => l.startsWith('\t'))
    .map((l) => l.trim());

// ---------- listing ----------

async function findRepos(dir: string, depth: number, out: string[]) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_PROJECTS) return;
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (existsSync(join(p, '.git'))) out.push(p);
    else if (depth > 1) await findRepos(p, depth - 1, out);
  }
}

async function describe(path: string, added: boolean): Promise<LocalProject | null> {
  try {
    if (!(await lstat(path)).isDirectory()) return null;
  } catch {
    return null;
  }
  const isGit = existsSync(join(path, '.git'));
  let updatedAt = 0;
  try {
    updatedAt = (await stat(path)).mtimeMs;
  } catch {
    /* keep 0 */
  }
  if (!isGit) {
    // A folder inside another project is that project: publishing it alone would nest a second repository.
    const top = await git(path, ['rev-parse', '--show-toplevel']);
    if (top.code === 0 && top.out.trim() && key(top.out.trim()) !== key(path)) return describe(normalize(top.out.trim()), added);
    return { path, name: basename(path), git: false, changes: 0, ahead: 0, behind: 0, state: 'not-git', updatedAt, added };
  }
  const [st, remote, last] = await Promise.all([
    git(path, ['status', '--porcelain=v2', '--branch', '-z']),
    // The URL as written: get-url would apply insteadOf rewrites and hide that it is GitHub.
    git(path, ['config', '--get', 'remote.origin.url']),
    git(path, ['log', '-1', '--format=%ct']),
  ]);
  // The last saved version is what "mexido há…" means for a project; the folder date when there is none yet.
  if (last.code === 0 && Number(last.out.trim()) > 0) updatedAt = Number(last.out.trim()) * 1000;
  const s = parseStatus(st.out);
  const url = remote.code === 0 ? remote.out.trim() : '';
  const repo = githubRepoOf(url) ?? undefined;
  const p = { git: true, repo, changes: s.files.length, ahead: s.ahead, behind: s.behind };
  return {
    path,
    name: basename(path),
    branch: s.branch,
    otherRemote: Boolean(url) && !repo,
    updatedAt,
    added,
    ...p,
    state: stateOf(p),
  };
}

const lastFetch = new Map<string, number>();
const FETCH_EVERY_MS = 2 * 60_000;

/**
 * Asks GitHub what changed (git fetch, nothing in the folder moves), so a
 * card can say "novidades no GitHub". Quiet: a project that can't be
 * reached keeps its last known state.
 */
async function fetchAll(projects: LocalProject[]) {
  const env = gitEnv((await githubAuth())?.token);
  const due = projects.filter((p) => p.repo && Date.now() - (lastFetch.get(key(p.path)) ?? 0) > FETCH_EVERY_MS);
  for (let i = 0; i < due.length; i += 6) {
    await Promise.all(
      due.slice(i, i + 6).map(async (p) => {
        lastFetch.set(key(p.path), Date.now());
        await git(p.path, ['fetch', '--quiet', 'origin'], { env, timeout: 20_000 });
      }),
    );
  }
  return due.length;
}

/**
 * Desktop and Documents (two levels deep), plus the folders added by hand.
 * With `fetch`, also asks GitHub for news first (the tab calls it right
 * after the quick listing).
 */
export async function listLocal(fetch?: unknown): Promise<{ projects: LocalProject[]; error?: string }> {
  if (fetch === true && known.size && (await fetchAll([...known.values()])) === 0) {
    return { projects: [...known.values()] };
  }
  const found: string[] = [];
  for (const root of [app.getPath('desktop'), app.getPath('documents')]) await findRepos(root, 2, found);
  const added = store.settings.localFolders.filter((f) => typeof f === 'string');
  const paths = new Map<string, { path: string; added: boolean }>();
  for (const p of found) paths.set(key(p), { path: p, added: false });
  for (const p of added) paths.set(key(p), { path: p, added: true });

  const list = [...paths.values()];
  const byPath = new Map<string, LocalProject>();
  // A few git runs at a time: each one is quick, a hundred at once is not.
  for (let i = 0; i < list.length; i += 6) {
    const chunk = await Promise.all(list.slice(i, i + 6).map((x) => describe(x.path, x.added)));
    // A folder added from inside a project resolves to that project: keep one card.
    for (const p of chunk) if (p && !byPath.has(key(p.path))) byPath.set(key(p.path), p);
  }
  const projects = [...byPath.values()];
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  known = new Map(projects.map((p) => [key(p.path), p]));
  const error = (await whichCommand('git')) ? undefined : 'O Git não está instalado. Instale em git-scm.com para enviar projetos ao GitHub.';
  return { projects, error };
}

/** Only folders from the last listing (or added in the dialog) are ever touched. */
function project(path: unknown): LocalProject | null {
  return typeof path === 'string' ? (known.get(key(path)) ?? null) : null;
}

export async function addLocalFolder(): Promise<{ ok: boolean; message?: string }> {
  const win = getWidget();
  const options = { title: 'Escolha a pasta do projeto', defaultPath: app.getPath('desktop'), properties: ['openDirectory'] as 'openDirectory'[] };
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  let p = resolve(r.filePaths[0]);
  // A folder inside a project stands for the whole project.
  const top = await git(p, ['rev-parse', '--show-toplevel']);
  if (top.code === 0 && top.out.trim()) p = normalize(top.out.trim());
  if (key(p) === key(app.getPath('desktop')) || key(p) === key(app.getPath('home'))) {
    return { ok: false, message: 'Escolha a pasta do projeto, não a Área de Trabalho ou a pasta do usuário inteira.' };
  }
  const folders = store.settings.localFolders.filter((f) => key(f) !== key(p));
  send('orbi:settings', store.updateSettings({ localFolders: [...folders, p] }));
  return { ok: true };
}

export function removeLocalFolder(path: unknown) {
  if (typeof path !== 'string') return;
  send('orbi:settings', store.updateSettings({ localFolders: store.settings.localFolders.filter((f) => key(f) !== key(path)) }));
}

// ---------- review ----------

function nulList(text: string): string[] {
  return text.split('\0').filter(Boolean);
}

async function looksBinary(path: string): Promise<boolean> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

/** Every file that would go up, with sizes and anything that must stop the send. */
export async function reviewLocal(path: unknown): Promise<LocalReview | { error: string }> {
  const p = project(path);
  if (!p) return { error: 'Projeto não encontrado. Atualize a lista.' };
  const publishing = !p.repo;
  let entries: { path: string; status: string }[] = [];
  let gitignore: string | undefined;

  if (!p.git) {
    // Not a repository yet: list what `git add` would take, using a throwaway repository so the folder stays untouched.
    gitignore = existsSync(join(p.path, '.gitignore')) ? undefined : DEFAULT_GITIGNORE;
    const tmp = await mkdtemp(join(tmpdir(), 'orbi-review-'));
    try {
      await git(tmp, ['init', '-q']);
      let excludes: string[] = [];
      if (gitignore) {
        await writeFile(join(tmp, 'exclude'), gitignore);
        excludes = [`--exclude-from=${join(tmp, 'exclude')}`];
      }
      const r = await git(p.path, [`--git-dir=${join(tmp, '.git')}`, `--work-tree=${p.path}`, 'ls-files', '-z', '--others', '--exclude-standard', ...excludes]);
      if (r.code !== 0) return { error: `Não consegui listar os arquivos: ${why(r)}` };
      entries = nulList(r.out).map((f) => ({ path: f, status: 'A' }));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  } else if (publishing) {
    const [tracked, others] = await Promise.all([
      git(p.path, ['ls-files', '-z']),
      git(p.path, ['ls-files', '-z', '--others', '--exclude-standard']),
    ]);
    entries = [...nulList(tracked.out).map((f) => ({ path: f, status: 'T' })), ...nulList(others.out).map((f) => ({ path: f, status: '??' }))];
  } else {
    const st = await git(p.path, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    if (st.code !== 0) return { error: `Não consegui ler o projeto: ${why(st)}` };
    entries = parseStatus(st.out).files;
    // Versions saved here but not on GitHub yet go up too: their files are checked like the changes.
    const unpushed = await git(p.path, ['log', '--format=', '--name-only', '-z', 'HEAD', '--not', '--remotes=origin']);
    const seen = new Set(entries.map((e) => e.path));
    for (const f of new Set(nulList(unpushed.out.replace(/\n/g, '\0')))) if (!seen.has(f)) entries.push({ path: f, status: 'C' });
  }

  const files: LocalFile[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  let scanned = 0;
  let partial = false;
  for (const e of entries.slice(0, MAX_LISTED)) {
    const abs = join(p.path, ...e.path.split('/'));
    let size = 0;
    try {
      const s = await stat(abs);
      if (!s.isFile()) continue;
      size = s.size;
    } catch {
      // Gone from the folder. Inside an unsent version it still goes up, so its name is still checked.
      const secret = e.status === 'C' ? (secretPathReason(e.path) ?? undefined) : undefined;
      files.push({ path: e.path, status: e.status, size: 0, secret });
      continue;
    }
    const f: LocalFile = { path: e.path, status: e.status, size };
    f.secret = secretPathReason(e.path) ?? undefined;
    // A secret already inside a saved, unsent version can't be fixed by .gitignore.
    if (f.secret && e.status !== 'C') f.ignorable = true;
    if (!f.secret && size <= TEXT_LIMIT) {
      if (scanned + size > SCAN_BYTES) partial = true;
      else {
        scanned += size;
        try {
          if (!(await looksBinary(abs))) {
            f.secret = secretInText(await readFile(abs, 'utf8')) ?? undefined;
          }
        } catch {
          /* unreadable: skip */
        }
      }
    }
    if (size > BIG_FILE) f.big = true;
    files.push(f);
  }
  const list = (fs: LocalFile[]) => `${fs.slice(0, 4).map((f) => `${f.path} (${f.secret})`).join(', ')}${fs.length > 4 ? '…' : ''}`;
  const byName = files.filter((f) => f.ignorable);
  const saved = files.filter((f) => f.secret && f.status === 'C');
  const inside = files.filter((f) => f.secret && !f.ignorable && f.status !== 'C');
  if (byName.length) blockers.push(`${byName.length === 1 ? 'Arquivo secreto' : `${byName.length} arquivos secretos`} na lista: ${list(byName)}. Coloque no .gitignore para que ${byName.length === 1 ? 'fique' : 'fiquem'} só neste PC.`);
  if (saved.length) blockers.push(`Uma versão salva aqui e ainda não enviada traz ${list(saved)}. Desfaça essa versão no terminal (git reset HEAD~1, sem --hard) e salve de novo sem o segredo.`);
  if (inside.length) blockers.push(`${inside.length === 1 ? 'Há senha, chave ou token dentro de' : 'Há senhas, chaves ou tokens dentro de'} ${list(inside)}. Tire do código (use um .env) antes de enviar.`);
  const huge = files.filter((f) => f.size > MAX_FILE);
  if (huge.length) blockers.push(`O GitHub recusa arquivos acima de 100 MB: ${huge.map((f) => f.path).slice(0, 3).join(', ')}.`);
  const big = files.filter((f) => f.big && f.size <= MAX_FILE);
  if (big.length) warnings.push(`Arquivos grandes (mais de 50 MB) deixam o envio lento: ${big.map((f) => f.path).slice(0, 3).join(', ')}.`);
  if (partial) warnings.push('O projeto é grande: o Orbi conferiu o conteúdo dos primeiros 50 MB de arquivos de texto.');
  if (entries.length > MAX_LISTED) warnings.push(`A lista mostra ${MAX_LISTED} de ${entries.length} arquivos.`);
  if (publishing && p.git) {
    const n = await git(p.path, ['rev-list', '--count', 'HEAD']);
    if (n.code === 0 && Number(n.out) > 0) warnings.push(`As ${Number(n.out)} versões já salvas neste projeto vão junto; o Orbi só confere os arquivos de agora.`);
  }
  if (!publishing && files.length === 0 && p.ahead === 0) warnings.push('Nada para enviar: o projeto está igual ao último envio.');
  return { path: p.path, files, total: entries.length, truncated: entries.length > MAX_LISTED, blockers, warnings, gitignore };
}

/**
 * "Colocar no .gitignore": for files that are secrets by their name (.env,
 * keys), appends them to the project's .gitignore, creating it if needed.
 * Source files with a token inside are not offered: the token must go.
 */
export async function ignoreSecrets(path: unknown): Promise<LocalActionResult> {
  const p = project(path);
  if (!p) return { ok: false, message: 'Projeto não encontrado. Atualize a lista.' };
  const review = await reviewLocal(p.path);
  if ('error' in review) return { ok: false, message: review.error };
  const names = review.files.filter((f) => secretPathReason(f.path)).map((f) => f.path);
  if (names.length === 0) return { ok: true, message: 'Nenhum arquivo secreto para ignorar.' };
  const file = join(p.path, '.gitignore');
  let current = '';
  try {
    current = await readFile(file, 'utf8');
  } catch {
    current = review.gitignore ?? '';
  }
  const lines = names.map((n) => `/${n}`).filter((l) => !current.split(/\r?\n/).includes(l));
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  await writeFile(file, `${current}${sep}${current ? '\n' : ''}# Segredos (adicionado pelo Orbi)\n${lines.join('\n')}\n`);
  // Already versioned secrets stay in git's index until removed from it (the file itself stays on disk).
  const tracked = (await git(p.path, ['ls-files', '-z', '--', ...names])).out.split('\0').filter(Boolean);
  if (tracked.length) await git(p.path, ['rm', '--cached', '-q', '--', ...tracked]);
  return {
    ok: true,
    message: `${names.length === 1 ? `${names[0]} não vai` : `${names.length} arquivos não vão`} mais para o GitHub.${tracked.length ? ' Eles continuam na sua pasta.' : ''}`,
  };
}

// ---------- publish, send, pull ----------

const cleanMessage = (m: unknown) => (typeof m === 'string' ? m.trim().slice(0, 500) : '');

export async function publishLocal(
  path: unknown,
  opts: { name?: unknown; description?: unknown; private?: unknown; message?: unknown },
): Promise<LocalActionResult> {
  const p = project(path);
  if (!p) return { ok: false, message: 'Projeto não encontrado. Atualize a lista.' };
  if (p.repo) return { ok: false, message: 'Este projeto já está no GitHub.' };
  if (p.otherRemote) return { ok: false, message: 'Este projeto já tem um remoto "origin" fora do GitHub; o Orbi não o substitui.' };
  if (!isNewRepoName(opts.name)) return { ok: false, message: 'Nome inválido: use letras, números, ponto, hífen ou sublinhado.' };
  const auth = await githubAuth();
  if (!auth) return { ok: false, message: 'Conecte o GitHub em Ferramentas para publicar.' };
  const review = await reviewLocal(p.path);
  if ('error' in review) return { ok: false, message: review.error };
  if (review.blockers.length) return { ok: false, message: review.blockers.join(' ') };
  if (review.files.length === 0) return { ok: false, message: 'A pasta não tem arquivos para enviar.' };

  let created: { full_name?: string; html_url?: string };
  try {
    created = (await api('/user/repos', auth.token, {
      method: 'POST',
      body: {
        name: opts.name,
        description: typeof opts.description === 'string' ? opts.description.slice(0, 350) : undefined,
        private: opts.private !== false,
        auto_init: false,
      },
    })) as typeof created;
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  const full = created.full_name ?? '';
  const url = created.html_url ?? `https://github.com/${full}`;
  const fail = (step: string, r: GitRun): LocalActionResult => ({
    ok: false,
    message: `O repositório ${full} foi criado, mas ${step}: ${why(r)}`,
    url,
  });

  if (!p.git) {
    let r = await git(p.path, ['init', '-b', 'main']);
    if (r.code !== 0) r = await git(p.path, ['init']);
    if (r.code !== 0) return fail('não consegui iniciar o Git na pasta', r);
    if (review.gitignore && !existsSync(join(p.path, '.gitignore'))) await writeFile(join(p.path, '.gitignore'), review.gitignore);
  }
  const add = await git(p.path, ['add', '-A']);
  if (add.code !== 0) return fail('não consegui preparar os arquivos', add);
  const pending = await git(p.path, ['status', '--porcelain']);
  if (pending.out.trim()) {
    const c = await git(p.path, ['commit', '-m', cleanMessage(opts.message) || 'Primeira versão'], { timeout: 120_000 });
    if (c.code !== 0) {
      return /user\.(name|email)|Please tell me who you are/i.test(c.err)
        ? { ok: false, message: `O repositório ${full} foi criado, mas o Git não sabe seu nome e e-mail. Rode git config --global user.name "Seu Nome" e user.email, e envie de novo.`, url }
        : fail('a versão não foi salva', c);
    }
  }
  const remote = await git(p.path, ['remote', 'add', 'origin', `https://github.com/${full}.git`]);
  if (remote.code !== 0) return fail('não consegui ligar a pasta a ele', remote);
  const push = await git(p.path, ['push', '-u', 'origin', 'HEAD'], { env: gitEnv(auth.token), timeout: 15 * 60_000 });
  if (push.code !== 0) return fail('o envio falhou', push);
  return { ok: true, message: `Publicado em ${full}${opts.private === false ? '' : ' (privado)'}.`, url };
}

export async function sendLocal(path: unknown, message: unknown): Promise<LocalActionResult> {
  const p = project(path);
  if (!p?.repo) return { ok: false, message: 'Projeto não encontrado no GitHub. Atualize a lista.' };
  const env = gitEnv((await githubAuth())?.token);
  const fetched = await git(p.path, ['fetch', 'origin'], { env, timeout: 5 * 60_000 });
  if (fetched.code !== 0) return { ok: false, message: `Não consegui falar com o GitHub: ${why(fetched)}` };
  let s = parseStatus((await git(p.path, ['status', '--porcelain=v2', '--branch', '-z'])).out);
  if (s.behind > 0) {
    if (s.ahead > 0) {
      return { ok: false, message: 'O GitHub e este PC têm versões diferentes do projeto. Junte as duas no terminal (git pull) e envie de novo; o Orbi não mistura versões sozinho.' };
    }
    const pull = await git(p.path, ['merge', '--ff-only', '@{upstream}'], { env });
    if (pull.code !== 0) {
      const clash = filesIn(pull);
      return {
        ok: false,
        message: clash.length
          ? `O GitHub tem novidades em ${clash.slice(0, 3).join(', ')}${clash.length > 3 ? '…' : ''}, que você também mudou aqui. Junte as duas versões no terminal (git stash, git pull, git stash pop) e envie de novo.`
          : `Não deu para trazer as novidades do GitHub sem misturar versões: ${why(pull)}`,
      };
    }
    s = parseStatus((await git(p.path, ['status', '--porcelain=v2', '--branch', '-z'])).out);
  }
  const review = await reviewLocal(p.path);
  if ('error' in review) return { ok: false, message: review.error };
  if (review.blockers.length) return { ok: false, message: review.blockers.join(' ') };
  if (s.files.length > 0) {
    const msg = cleanMessage(message);
    if (!msg) return { ok: false, message: 'Escreva o que mudou antes de enviar.' };
    const add = await git(p.path, ['add', '-A']);
    if (add.code !== 0) return { ok: false, message: `Não consegui preparar os arquivos: ${why(add)}` };
    const c = await git(p.path, ['commit', '-m', msg], { timeout: 120_000 });
    if (c.code !== 0) return { ok: false, message: `A versão não foi salva: ${why(c)}` };
  } else if (s.ahead === 0) return { ok: true, message: 'Nada para enviar: o GitHub já está igual.', url: `https://github.com/${p.repo}` };
  const push = await git(p.path, s.upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'], { env, timeout: 15 * 60_000 });
  if (push.code !== 0) return { ok: false, message: `O envio falhou: ${why(push)}` };
  return { ok: true, message: `Enviado para ${p.repo}${s.branch ? ` (${s.branch})` : ''}.`, url: `https://github.com/${p.repo}` };
}

/** Brings GitHub's news to this PC, only when it is a plain fast-forward. */
export async function pullLocal(path: unknown): Promise<LocalActionResult> {
  const p = project(path);
  if (!p?.repo) return { ok: false, message: 'Projeto não encontrado no GitHub. Atualize a lista.' };
  const env = gitEnv((await githubAuth())?.token);
  const fetched = await git(p.path, ['fetch', 'origin'], { env, timeout: 5 * 60_000 });
  if (fetched.code !== 0) return { ok: false, message: `Não consegui falar com o GitHub: ${why(fetched)}` };
  const r = await git(p.path, ['merge', '--ff-only', '@{upstream}']);
  if (r.code !== 0) {
    const clash = filesIn(r);
    return {
      ok: false,
      message: clash.length
        ? `O GitHub tem novidades em ${clash.slice(0, 3).join(', ')}${clash.length > 3 ? '…' : ''}, que você também mudou aqui. Junte no terminal (git stash, git pull, git stash pop).`
        : `Não deu para trazer sem misturar versões: ${why(r)} Resolva no terminal (git pull).`,
    };
  }
  return { ok: true, message: 'Novidades do GitHub trazidas para este PC.' };
}
