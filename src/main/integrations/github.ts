import { execFile } from 'node:child_process';
import type { CiState, GithubSnapshot } from '@shared/types';
import { hub } from '../hub';
import { store } from '../store';
import { commandPaths, whichCommand } from './detect';

/**
 * GitHub through the official GraphQL API. Auth comes from a personal token
 * the user pastes in Orbi (stored with the OS keychain) or from an existing
 * `gh auth` login. Nothing is shown until one of them works.
 */
const QUERY = `
query($owner: String!, $name: String!, $withRepo: Boolean!) {
  viewer {
    login
    pullRequests(states: OPEN, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title url
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
    contributionsCollection {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
  reviews: search(query: "is:pr is:open review-requested:@me archived:false", type: ISSUE, first: 1) { issueCount }
  repository(owner: $owner, name: $name) @include(if: $withRepo) {
    nameWithOwner
    defaultBranchRef { name target { ... on Commit { statusCheckRollup { state } } } }
  }
}`;

type Rollup = { state?: string } | null | undefined;

function ci(r: Rollup): CiState {
  switch (r?.state) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failure';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

async function ghToken(): Promise<string | null> {
  const gh = commandPaths.gh ?? (await whichCommand('gh'));
  if (!gh) return null;
  return new Promise((resolve) => {
    execFile(gh, ['auth', 'token'], { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : out.trim() || null));
  });
}

let timer: NodeJS.Timeout | null = null;
let inflight: Promise<void> | null = null;

export function refreshGithub(): Promise<void> {
  if (inflight) return inflight;
  inflight = doRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doRefresh() {
  let token = store.getGithubToken();
  let via: GithubSnapshot['via'] = 'token';
  if (!token) {
    token = await ghToken();
    via = 'gh';
  }
  if (!token) {
    hub.setGithub(undefined);
    return;
  }
  const repo = store.settings.githubRepo.trim();
  const [owner, name] = repo.includes('/') ? repo.split('/', 2) : ['', ''];
  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'orbi-desktop' },
      body: JSON.stringify({ query: QUERY, variables: { owner, name, withRepo: Boolean(owner && name) } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) throw new Error('Token inválido ou expirado');
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
    const json = (await res.json()) as { data?: GraphData; errors?: { message: string }[] };
    if (!json.data) throw new Error(json.errors?.[0]?.message ?? 'Resposta inesperada do GitHub');
    hub.setGithub(toSnapshot(json.data, via));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hub.setGithub({ ok: false, error: /fetch failed|timeout/i.test(msg) ? 'Sem conexão com o GitHub' : msg, fetchedAt: Date.now() });
  }
}

interface GraphData {
  viewer: {
    login: string;
    pullRequests: {
      nodes: {
        number: number;
        title: string;
        url: string;
        repository: { nameWithOwner: string };
        commits: { nodes: { commit: { statusCheckRollup: Rollup } }[] };
      }[];
    };
    contributionsCollection: {
      contributionCalendar: { totalContributions: number; weeks: { contributionDays: { date: string; contributionCount: number }[] }[] };
    };
  };
  reviews: { issueCount: number };
  repository?: { nameWithOwner: string; defaultBranchRef?: { name: string; target?: { statusCheckRollup?: Rollup } } } | null;
}

function toSnapshot(d: GraphData, via: GithubSnapshot["via"]): GithubSnapshot {
  const days = d.viewer.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((x) => ({ date: x.date, count: x.contributionCount }));
  // Streak: consecutive days with contributions, ending today (or yesterday if today is still empty).
  let streak = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  for (; i >= 0 && days[i].count > 0; i--) streak++;

  const repo = d.repository;
  return {
    ok: true,
    login: d.viewer.login,
    myOpenPRs: d.viewer.pullRequests.nodes.map((n) => ({
      repo: n.repository.nameWithOwner,
      number: n.number,
      title: n.title,
      url: n.url,
      ci: ci(n.commits.nodes[0]?.commit.statusCheckRollup),
    })),
    reviewRequests: d.reviews.issueCount,
    defaultBranchCI: repo?.defaultBranchRef
      ? { repo: repo.nameWithOwner, branch: repo.defaultBranchRef.name, state: ci(repo.defaultBranchRef.target?.statusCheckRollup) }
      : undefined,
    contributions: { total: d.viewer.contributionsCollection.contributionCalendar.totalContributions, streak, days: days.slice(-84) },
    fetchedAt: Date.now(),
    via,
  };
}

export function startGithub(): void {
  void refreshGithub();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void refreshGithub(), 5 * 60_000);
  timer.unref();
}
