import { app, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CloneResult, GithubPerson, GithubRepo, PeopleList, RepoList, RepoListKind, TopList } from '@shared/types';
import { dataDir, store } from '../store';
import { getWidget, send } from '../widget';
import { whichCommand } from './detect';
import { githubAuth } from './github';
import { isFresh, isLogin, isRepoName, isTopLang, parseCloneProgress, toPerson, topSearchPath, toRepo, type TopLang } from './githubRepoLogic';

/**
 * The GitHub tab: lists repositories through the REST API and clones one into
 * the Desktop (or a folder the user picks) with the user's own git. The
 * renderer only sends a kind, a search text or an "owner/name"; every URL and
 * path is built here. Cloning only copies files: nothing from the repository
 * is run, and the token goes to git through its environment, never into the
 * URL or the clone's .git/config.
 */
const API = 'https://api.github.com';
const CLONE_TIMEOUT_MS = 15 * 60_000;
const cloning = new Set<string>();

/**
 * The environment for a git run that talks to GitHub: never prompts, and
 * carries the token only for this run — git reads it from the environment
 * and does not save it in the repository.
 */
export function gitEnv(token?: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  }
  return env;
}

export async function api(path: string, token: string | null, init?: { method: string; body: unknown }): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    body: init ? JSON.stringify(init.body) : undefined,
    headers: {
      ...(init ? { 'content-type': 'application/json' } : {}),
      accept: 'application/vnd.github+json',
      'user-agent': 'orbi-desktop',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new Error('O token do GitHub foi recusado. Troque-o em Ferramentas.');
  if (res.status === 403 && init) throw new Error('O login do GitHub não tem permissão para criar repositórios (precisa do escopo repo).');
  if (res.status === 403 || res.status === 429) throw new Error('Limite de consultas do GitHub atingido. Tente de novo em alguns minutos.');
  if (res.status === 404) throw new Error(init ? 'O login do GitHub não tem permissão para criar repositórios (precisa do escopo repo).' : 'Não encontrado no GitHub.');
  if (res.status === 422) throw new Error(init ? 'Já existe um repositório com esse nome na sua conta.' : 'Busca inválida.');
  if (!res.ok) throw new Error(`O GitHub respondeu ${res.status}.`);
  return res.json();
}

export async function listRepos(kind: unknown, query: unknown): Promise<RepoList> {
  const k: RepoListKind = kind === 'starred' || kind === 'user' || kind === 'search' ? kind : 'mine';
  const q = typeof query === 'string' ? query.trim().slice(0, 200) : '';
  const auth = await githubAuth();
  const token = auth?.token ?? null;
  try {
    let raw: unknown;
    if (k === 'mine' || k === 'starred') {
      if (!token) return { repos: [], error: 'Conecte o GitHub em Ferramentas para ver os seus repositórios.' };
      raw =
        k === 'mine'
          ? await api('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token)
          : await api('/user/starred?per_page=100&sort=created', token);
    } else if (k === 'user') {
      const login = q.replace(/^@/, '');
      if (!isLogin(login)) return { repos: [], error: 'Digite o usuário do GitHub, por exemplo: torvalds' };
      raw = await api(`/users/${login}/repos?per_page=100&sort=pushed&type=owner`, token);
    } else {
      if (!q) return { repos: [] };
      const body = (await api(`/search/repositories?per_page=50&sort=stars&q=${encodeURIComponent(q)}`, token)) as { items?: unknown[] };
      raw = body.items ?? [];
    }
    return { repos: toRepos(raw) };
  } catch (err) {
    return { repos: [], error: netMessage(err) };
  }
}

const toRepos = (raw: unknown) => (Array.isArray(raw) ? raw : []).map((r) => toRepo(r as never)).filter((r): r is GithubRepo => r !== null);

function netMessage(err: unknown): string {
  const msg = (err as Error).message;
  return /fetch failed|timeout|aborted/i.test(msg) ? 'Sem conexão com o GitHub.' : msg;
}

/**
 * "Top 10 da semana" in Explorar. Public data, asked for without the user's
 * token so the search says nothing about who is looking. Kept per language
 * in memory and in a small file, and asked for again only after TOP_TTL_MS
 * (or on the refresh button), so the tab costs a few requests a day.
 */
type TopCache = Partial<Record<TopLang, { fetchedAt: number; repos: GithubRepo[] }>>;
const topFile = () => join(dataDir(), 'github-top.json');
let topCache: TopCache | null = null;
const topLoading = new Map<TopLang, Promise<TopList>>();

function readTopCache(): TopCache {
  if (topCache) return topCache;
  topCache = {};
  try {
    const raw = JSON.parse(readFileSync(topFile(), 'utf8')) as TopCache;
    for (const [lang, hit] of Object.entries(raw ?? {})) {
      if (isTopLang(lang) && hit && typeof hit.fetchedAt === 'number' && Array.isArray(hit.repos)) topCache[lang] = hit;
    }
  } catch {
    // No list kept yet.
  }
  return topCache;
}

export function listTop(lang: unknown, force: unknown): Promise<TopList> {
  const l: TopLang = isTopLang(lang) ? lang : '';
  const cache = readTopCache();
  const hit = cache[l];
  if (force !== true && hit && isFresh(hit.fetchedAt, Date.now())) return Promise.resolve({ repos: hit.repos, fetchedAt: hit.fetchedAt });
  const running = topLoading.get(l);
  if (running) return running;
  const job = (async (): Promise<TopList> => {
    const now = Date.now();
    try {
      const body = (await api(topSearchPath(l, now), null)) as { items?: unknown[] };
      const repos = toRepos(body.items).slice(0, 10);
      cache[l] = { fetchedAt: now, repos };
      await writeFile(topFile(), JSON.stringify(cache)).catch(() => undefined);
      return { repos, fetchedAt: now };
    } catch (err) {
      const msg = netMessage(err);
      return hit ? { repos: hit.repos, fetchedAt: hit.fetchedAt, error: `${msg} Mostrando a última lista guardada.` } : { repos: [], error: msg };
    } finally {
      topLoading.delete(l);
    }
  })();
  topLoading.set(l, job);
  return job;
}

/** The people the user follows, for "De alguém" before anything is typed. Needs the token. */
let following: { at: number; token: string; people: GithubPerson[] } | null = null;
const FOLLOWING_TTL_MS = 10 * 60_000;

export async function listFollowing(force: unknown): Promise<PeopleList> {
  const token = (await githubAuth())?.token;
  // Kept per token, so connecting another account (or none) never shows the old list.
  if (force !== true && token && following?.token === token && Date.now() - following.at < FOLLOWING_TTL_MS) return { people: following.people };
  if (!token) return { people: [], error: 'Conecte o GitHub em Ferramentas para ver quem você segue.' };
  try {
    const raw = await api('/user/following?per_page=100', token);
    const people = (Array.isArray(raw) ? raw : []).map((p) => toPerson(p as never)).filter((p): p is GithubPerson => p !== null);
    following = { at: Date.now(), token, people };
    return { people };
  } catch (err) {
    return { people: [], error: netMessage(err) };
  }
}

/**
 * "Usar o login do Git deste PC": asks git's own credential helper for the
 * github.com login it already keeps (the one `git push` uses), checks it
 * with GitHub and saves it like a pasted token (OS encryption). Runs only on
 * the user's click; never prompts; the token never goes to the renderer.
 */
export async function githubFromGit(): Promise<{ ok: boolean; message: string }> {
  const git = await whichCommand('git');
  if (!git) return { ok: false, message: 'O Git não está instalado neste computador.' };
  const out = await new Promise<string>((resolve) => {
    const child = spawn(git, ['credential', 'fill'], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      windowsHide: true,
    });
    let text = '';
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout.on('data', (b: Buffer) => (text += b.toString('utf8')));
    child.on('error', () => (clearTimeout(timer), resolve('')));
    child.on('close', (code) => (clearTimeout(timer), resolve(code === 0 ? text : '')));
    child.stdin.end('protocol=https\nhost=github.com\n\n');
  });
  const token = /^password=(.+)$/m.exec(out)?.[1]?.trim();
  if (!token) return { ok: false, message: 'O Git deste PC não tem um login do GitHub salvo. Cole um token pessoal.' };
  try {
    const me = (await api('/user', token)) as { login?: string };
    if (!store.setGithubToken(token)) return { ok: false, message: 'Não foi possível guardar o login com segurança neste computador.' };
    return { ok: true, message: `Conectado como ${me.login ?? 'você'} com o login do Git.` };
  } catch (err) {
    return { ok: false, message: `O GitHub recusou o login salvo no Git (${(err as Error).message}). Cole um token pessoal.` };
  }
}

/** Clones `fullName` into the Desktop, or into a folder picked in a dialog when `pick` is true. */
export async function cloneRepo(fullName: unknown, pick: unknown): Promise<CloneResult> {
  if (!isRepoName(fullName)) return { ok: false, message: 'Repositório inválido.' };
  if (cloning.has(fullName)) return { ok: false, message: 'Este repositório já está sendo baixado.' };
  const git = await whichCommand('git');
  if (!git) return { ok: false, message: 'O Git não está instalado. Instale em git-scm.com e tente de novo.' };

  let parent = app.getPath('desktop');
  if (pick === true) {
    const win = getWidget();
    const options = { title: 'Onde salvar o projeto', defaultPath: parent, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (r.canceled || !r.filePaths[0]) return { ok: false, message: 'Cancelado.' };
    parent = r.filePaths[0];
  }
  const name = fullName.split('/')[1];
  const dest = join(parent, name);
  if (existsSync(dest)) return { ok: false, message: `Já existe uma pasta ${name} em ${parent}. Nada foi alterado.`, path: dest };

  const env = gitEnv((await githubAuth())?.token);

  cloning.add(fullName);
  send('github:clone', { fullName, percent: 0, phase: 'Conectando' });
  try {
    const code = await new Promise<{ code: number | null; err: string }>((resolve) => {
      const child = spawn(git, ['clone', '--progress', '--', `https://github.com/${fullName}.git`, dest], { env, windowsHide: true });
      let err = '';
      const timer = setTimeout(() => child.kill(), CLONE_TIMEOUT_MS);
      child.stderr.on('data', (b: Buffer) => {
        const text = b.toString('utf8');
        err = (err + text).slice(-4000);
        const p = parseCloneProgress(text);
        if (p) send('github:clone', { fullName, ...p });
      });
      child.on('error', (e) => (clearTimeout(timer), resolve({ code: -1, err: e.message })));
      child.on('close', (c) => (clearTimeout(timer), resolve({ code: c, err })));
    });
    if (code.code !== 0) {
      const last = code.err.split(/[\r\n]+/).filter((l) => /fatal|error/i.test(l)).pop() ?? '';
      const why = /not found|Authentication failed|could not read Username/i.test(last)
        ? 'O GitHub não liberou o acesso. Se o repositório é privado, conecte um token com acesso a ele em Ferramentas.'
        : last.replace(/^fatal:\s*/i, '') || 'o git parou sem dizer o motivo.';
      return { ok: false, message: `Não consegui baixar: ${why}` };
    }
    send('github:clone', { fullName, percent: 100, phase: 'Pronto' });
    return { ok: true, message: `Projeto salvo em ${dest}`, path: dest };
  } finally {
    cloning.delete(fullName);
  }
}
