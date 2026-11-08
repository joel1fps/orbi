import type { LocalState } from '@shared/types';

/**
 * The pure half of the "Locais" tab (no I/O, unit-tested): reading `git
 * status`, telling which GitHub repository a remote points to, and spotting
 * files that must never be sent (keys, .env, tokens inside a file).
 */

export interface GitStatus {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: { path: string; status: string }[];
}

/** `git status --porcelain=v2 --branch -z --untracked-files=all`. */
export function parseStatus(raw: string): GitStatus {
  const out: GitStatus = { ahead: 0, behind: 0, files: [] };
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      const head = line.slice(14);
      if (head !== '(detached)') out.branch = head;
    } else if (line.startsWith('# branch.upstream ')) out.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) [out.ahead, out.behind] = [Number(m[1]), Number(m[2])];
    } else if (line.startsWith('1 ')) out.files.push({ status: line.slice(2, 4), path: line.split(' ').slice(8).join(' ') });
    else if (line.startsWith('2 ')) {
      out.files.push({ status: line.slice(2, 4), path: line.split(' ').slice(9).join(' ') });
      i++; // a rename is followed by its old path
    } else if (line.startsWith('u ')) out.files.push({ status: 'UU', path: line.split(' ').slice(10).join(' ') });
    else if (line.startsWith('? ')) out.files.push({ status: '??', path: line.slice(2) });
  }
  return out;
}

/** "owner/name" when the remote is on github.com (https or ssh), else null. */
export function githubRepoOf(url: string | undefined): string | null {
  if (!url) return null;
  const m =
    /^https:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim()) ??
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function stateOf(p: { git: boolean; repo?: string | null; changes: number; ahead: number; behind: number }): LocalState {
  if (!p.git) return 'not-git';
  if (!p.repo) return 'no-remote';
  if (p.behind > 0) return 'behind';
  if (p.changes > 0) return 'changes';
  if (p.ahead > 0) return 'ahead';
  return 'clean';
}

/** A GitHub repository name Orbi will create. */
export function isNewRepoName(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(s) && s !== '.' && s !== '..' && !s.endsWith('.git');
}

/** Turns a folder name into a valid repository name ("Meu Projeto (1)" → "Meu-Projeto-1"). */
export function repoNameFor(folder: string): string {
  return folder.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100) || 'projeto';
}

// ---------- what must never be sent ----------

const SECRET_FILES: [RegExp, string][] = [
  [/(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[^/]+)?$/i, 'arquivo de variáveis (.env)'],
  [/\.(pem|key|p12|pfx|jks|keystore|ppk)$/i, 'chave ou certificado'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, 'chave SSH'],
  [/(^|\/)(credentials|client_secret[^/]*|service[-_]?account[^/]*)\.json$/i, 'credenciais'],
  [/(^|\/)\.(npmrc|pypirc|netrc|git-credentials)$/i, 'arquivo com login'],
  [/(^|\/)secrets?\.(json|ya?ml|toml|txt)$/i, 'arquivo de segredos'],
];

/** Why a path looks like a secret, or null. `.env.example` and the like are fine. */
export function secretPathReason(path: string): string | null {
  for (const [re, why] of SECRET_FILES) if (re.test(path)) return why;
  return null;
}

const SECRET_TEXT: [RegExp, string][] = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/, 'chave privada'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/, 'token do GitHub'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'chave da Anthropic'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, 'chave da OpenAI'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave da AWS'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'chave do Google'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'token do Slack'],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/, 'chave do Stripe'],
];

/** The kind of credential found inside a file's text, or null. */
export function secretInText(text: string): string | null {
  for (const [re, why] of SECRET_TEXT) if (re.test(text)) return why;
  return null;
}

/** Proposed for a folder published without a .gitignore. */
export const DEFAULT_GITIGNORE = [
  '# Criado pelo Orbi ao publicar no GitHub',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  'coverage/',
  '__pycache__/',
  '.venv/',
  'venv/',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '',
  '# Segredos: nunca enviar',
  '.env',
  '.env.*',
  '!.env.example',
  '*.pem',
  '*.key',
  '',
].join('\n');

export const BIG_FILE = 50 * 1024 * 1024;
export const MAX_FILE = 100 * 1024 * 1024;
