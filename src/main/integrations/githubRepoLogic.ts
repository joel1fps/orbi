import type { GithubRepo } from '@shared/types';

/**
 * The pure half of the GitHub tab (no I/O, unit-tested): which names are
 * accepted from the renderer, how the API's repositories are shown, and how
 * far a `git clone --progress` has got.
 */

/** "owner/name" exactly as GitHub allows it; anything else never reaches git. */
export function isRepoName(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  return Boolean(m) && m![2] !== '.' && m![2] !== '..' && !m![2].endsWith('.git');
}

/** A GitHub login, for "projects of a person". */
export function isLogin(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(s);
}

interface ApiRepo {
  full_name?: string;
  name?: string;
  owner?: { login?: string; avatar_url?: string };
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  private?: boolean;
  fork?: boolean;
  archived?: boolean;
  pushed_at?: string | null;
  updated_at?: string | null;
  html_url?: string;
}

export function toRepo(r: ApiRepo): GithubRepo | null {
  if (!isRepoName(r.full_name)) return null;
  const [owner, name] = r.full_name.split('/');
  const avatar = r.owner?.avatar_url;
  return {
    fullName: r.full_name,
    owner,
    name,
    description: r.description ?? undefined,
    language: r.language ?? undefined,
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    private: Boolean(r.private),
    fork: Boolean(r.fork),
    archived: Boolean(r.archived),
    updatedAt: r.pushed_at ?? r.updated_at ?? '',
    url: `https://github.com/${r.full_name}`,
    // The page only loads images from this host (see the CSP in index.html).
    avatar: avatar && avatar.startsWith('https://avatars.githubusercontent.com/') ? avatar : undefined,
  };
}

/**
 * git prints "Receiving objects:  42% (420/1000)" and the like on stderr,
 * separated by carriage returns. Counting and compressing are quick; the
 * download and the checkout take the time, so they fill most of the bar.
 */
const PHASES: [RegExp, string, number, number][] = [
  [/Counting objects:\s+(\d+)%/, 'Contando arquivos', 0, 5],
  [/Compressing objects:\s+(\d+)%/, 'Preparando', 5, 10],
  [/Receiving objects:\s+(\d+)%/, 'Baixando', 10, 85],
  [/Resolving deltas:\s+(\d+)%/, 'Montando', 85, 95],
  [/Updating files:\s+(\d+)%/, 'Gravando arquivos', 95, 100],
];

export function parseCloneProgress(chunk: string): { percent: number; phase: string } | null {
  let out: { percent: number; phase: string } | null = null;
  for (const line of chunk.split(/[\r\n]+/)) {
    for (const [re, phase, from, to] of PHASES) {
      const m = re.exec(line);
      if (m) out = { phase, percent: Math.round(from + ((to - from) * Math.min(100, Number(m[1]))) / 100) };
    }
  }
  return out;
}
