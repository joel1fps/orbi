// Builds resources/skills-index.json, the catalog of the Skills Arsenal.
//
//   node scripts/build-skills-index.mjs [--refs <pasta do site de referências>]
//
// Two sources:
//  - CURATED: hand-picked Apache-2.0/MIT skills from official repositories;
//  - the references site (minhas-referencias, src/data/ai.ts): every Skill or
//    Plugin with a GitHub repository becomes a package with the SKILL.md
//    folders found in it; everything else (MCPs, CLIs, guides…) becomes a
//    manual card with the site's own install command.
// Each package is pinned to a commit and every file gets its size and sha256;
// the app refuses anything that does not match. Commits come from
// `git ls-remote` (no API quota); each repository costs one GitHub API call
// for its file tree. Review the diff before publishing.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFrontmatter, validateManifest } from '../src/main/skills/logic.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'resources', 'skills-index.json');
const ALL = ['claude', 'codex', 'gemini', 'antigravity', 'cursor'];
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const MAX_SKILLS = { Skill: 60, Plugin: 30 };

const CURATED = [
  {
    repo: 'anthropics/skills',
    label: 'Anthropic',
    base: 'skills',
    skills: {
      'frontend-design': 'Frontend',
      'web-artifacts-builder': 'Frontend',
      'webapp-testing': 'Testes',
      'mcp-builder': 'Agentes e MCP',
      'skill-creator': 'Agentes e MCP',
      'claude-api': 'Agentes e MCP',
    },
  },
  {
    repo: 'openai/skills',
    label: 'OpenAI',
    base: 'skills/.curated',
    skills: {
      'gh-address-comments': 'GitHub',
      'gh-fix-ci': 'GitHub',
      playwright: 'Testes',
      'security-best-practices': 'Segurança',
      'security-threat-model': 'Segurança',
      sentry: 'Observabilidade',
      'vercel-deploy': 'Deploy',
      'jupyter-notebook': 'Dados',
    },
  },
];

// ---------- GitHub ----------

const commits = new Map();
function commitOf(repo, ref) {
  const key = `${repo}@${ref ?? 'HEAD'}`;
  if (!commits.has(key)) {
    const want = ref ? [`refs/heads/${ref}`, `refs/tags/${ref}`] : ['HEAD'];
    const out = execFileSync('git', ['ls-remote', `https://github.com/${repo}`, ...want], { encoding: 'utf8', timeout: 30_000 });
    const sha = out.split('\n')[0]?.split('\t')[0];
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error(`no commit for ${key}`);
    commits.set(key, sha);
  }
  return commits.get(key);
}

const trees = new Map();
/** Private repositories (the API answers 404 without a login) are read from a shallow clone, with your git login. */
const clones = new Map();
const CLONES = join(tmpdir(), 'orbi-skills-index');

function cloneOf(repo, commit) {
  const key = `${repo}@${commit}`;
  if (!clones.has(key)) {
    const dir = join(CLONES, repo.replace('/', '__'));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const git = (...args) => execFileSync('git', args, { cwd: dir, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('fetch', '-q', '--depth', '1', `https://github.com/${repo}`, commit);
    git('-c', 'core.autocrlf=false', 'checkout', '-q', 'FETCH_HEAD');
    clones.set(key, dir);
  }
  return clones.get(key);
}

async function treeOf(repo, commit) {
  const key = `${repo}@${commit}`;
  if (!trees.has(key)) {
    const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'orbi-skills-index' },
    });
    if (res.status === 404) {
      const dir = cloneOf(repo, commit);
      const blobs = [];
      const walk = (abs, rel) => {
        for (const e of readdirSync(abs, { withFileTypes: true })) {
          if (!rel && e.name === '.git') continue;
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(join(abs, e.name), r);
          else if (e.isFile()) blobs.push({ path: r, size: statSync(join(abs, e.name)).size });
        }
      };
      walk(dir, '');
      trees.set(key, blobs);
      console.log(`  ${repo}: privado, lido de um clone local`);
      return blobs;
    }
    if (!res.ok) throw new Error(`${res.status} tree of ${repo}`);
    const body = await res.json();
    if (body.truncated) throw new Error(`tree of ${repo} is truncated`);
    trees.set(key, body.tree.filter((e) => e.type === 'blob'));
  }
  return trees.get(key);
}

async function raw(repo, commit, path) {
  const clone = clones.get(`${repo}@${commit}`);
  if (clone) return readFileSync(join(clone, ...path.split('/')));
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function licenseName(text) {
  if (/Apache License/i.test(text)) return 'Apache-2.0';
  if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  if (/BSD/i.test(text)) return 'BSD';
  if (/Mozilla Public License/i.test(text)) return 'MPL-2.0';
  if (/GNU (AFFERO|LESSER|GENERAL)/i.test(text)) return 'GPL';
  if (/ISC License/i.test(text)) return 'ISC';
  if (/unlicense/i.test(text)) return 'Unlicense';
  if (/Creative Commons/i.test(text)) return 'CC';
  return 'desconhecida';
}

async function licenseOf(repo, commit, blobs, dir) {
  const pick = (prefix) => blobs.find((b) => new RegExp(`^${prefix}LICEN[CS]E(\\.(md|txt))?$`, 'i').test(b.path));
  const own = dir ? pick(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/') : undefined;
  const b = own ?? pick('');
  return b ? licenseName((await raw(repo, commit, b.path)).toString('utf8')) : 'desconhecida';
}

// ---------- skills inside a repository ----------

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill';

/** The SKILL.md folders under `prefix` and their files (minus nested skills), from the tree alone: no download. */
function layoutOf(blobs, prefix) {
  const inPrefix = (p) => !prefix || p === prefix || p.startsWith(prefix + '/');
  const dirs = blobs.filter((b) => inPrefix(b.path) && posix.basename(b.path) === 'SKILL.md').map((b) => posix.dirname(b.path));
  return dirs.map((dir) => {
    const nested = dirs.filter((d) => d !== dir && (dir === '.' || d.startsWith(dir + '/')));
    const own = blobs.filter((b) => (dir === '.' || b.path.startsWith(dir + '/')) && !nested.some((n) => b.path.startsWith(n + '/')));
    return { dir, own, bytes: own.reduce((n, b) => n + (b.size ?? 0), 0) };
  });
}

/** Downloads and hashes every file of the given folders. */
async function skillsIn(repo, commit, layout) {
  const out = [];
  const used = new Set();
  for (const { dir, own } of layout) {
    const files = [];
    let skillMd = '';
    for (const b of own) {
      const rel = dir === '.' ? b.path : b.path.slice(dir.length + 1);
      // raw.githubusercontent.com answers 501 for empty files.
      const bytes = b.size === 0 ? Buffer.alloc(0) : await raw(repo, commit, b.path);
      files.push({ path: rel, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      if (rel === 'SKILL.md') skillMd = bytes.toString('utf8');
    }
    const fm = parseFrontmatter(skillMd);
    let name = fm.name && NAME.test(fm.name) ? fm.name : slug(fm.name ?? posix.basename(dir === '.' ? repo : dir));
    for (let n = 2; used.has(name); n++) name = `${slug(name).slice(0, 60)}-${n}`;
    const { errors } = validateManifest({ name, files });
    if (errors.length) {
      console.warn(`  skip ${repo}/${dir}: ${errors.join(' ')}`);
      continue;
    }
    used.add(name);
    out.push({ name, path: dir, description: fm.description, files: files.sort((a, b) => a.path.localeCompare(b.path)) });
  }
  return out;
}

function githubTarget(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/(tree|blob)\/([^/]+)\/(.+))?\/?$/.exec(url ?? '');
  if (!m) return null;
  let path = m[5] ?? '';
  if (m[3] === 'blob') path = posix.dirname(path);
  return { repo: `${m[1]}/${m[2].replace(/\.git$/, '')}`, ref: m[4], path: path.replace(/\/$/, '') };
}

const hasScripts = (skills) =>
  skills.some((s) => s.files.some((f) => f.path.split('/')[0] === 'scripts' || /\.(sh|ps1|bat|cmd|py|js|mjs|cjs|ts|rb|exe)$/i.test(f.path)));

// ---------- build ----------

const packages = [];

for (const src of CURATED) {
  const commit = commitOf(src.repo);
  const blobs = await treeOf(src.repo, commit);
  for (const [dir, category] of Object.entries(src.skills)) {
    const path = `${src.base}/${dir}`;
    const [skill] = await skillsIn(src.repo, commit, layoutOf(blobs, path));
    if (!skill) throw new Error(`${src.repo}/${path}: no valid SKILL.md`);
    const license = await licenseOf(src.repo, commit, blobs, path);
    if (!['Apache-2.0', 'MIT'].includes(license)) throw new Error(`${src.repo}/${path}: license ${license}`);
    packages.push({
      id: `${src.repo.split('/')[0]}/${skill.name}`,
      name: skill.name,
      description: skill.description ?? '',
      category,
      kind: 'Skill',
      origin: 'curated',
      support: ALL,
      license,
      source: { label: src.label, repo: src.repo, commit, url: `https://github.com/${src.repo}/tree/${commit}/${path}` },
      skills: [{ name: skill.name, path, files: skill.files }],
      hasScripts: hasScripts([skill]),
    });
    console.log(`curated ${src.repo}/${dir}`);
  }
}

const refsArg = process.argv.indexOf('--refs');
const refsDir = refsArg > 0 ? process.argv[refsArg + 1] : join(ROOT, '..', 'minhas-referencias');
const refsFile = join(refsDir, 'src', 'data', 'ai.ts');
if (existsSync(refsFile)) {
  const { AI_RESOURCES } = await import(pathToFileURL(refsFile).href);
  for (const r of AI_RESOURCES) {
    const support = r.compat === 'claude' ? ['claude'] : r.compat === 'codex' ? ['codex'] : ALL;
    const category = r.mineSub ?? r.sub;
    const base = {
      id: `refs/${r.id}`,
      name: r.name,
      description: r.description,
      category,
      kind: r.kind,
      origin: 'refs',
      mine: Boolean(r.mine),
      support,
      manual: { install: r.install, url: r.url, docs: r.docs },
    };
    const gh = (r.kind === 'Skill' || r.kind === 'Plugin') && githubTarget(r.url);
    if (!gh) {
      packages.push({ ...base, skills: [], hasScripts: false, license: '' });
      continue;
    }
    try {
      const commit = commitOf(gh.repo, gh.ref);
      const blobs = await treeOf(gh.repo, commit);
      const curated = packages.find((p) => p.origin === 'curated' && p.source.repo === gh.repo && p.skills[0].path === gh.path);
      if (curated) {
        // The same skill is already curated: keep it once, with the site's description and category.
        Object.assign(curated, { description: r.description, mine: Boolean(r.mine), refsId: r.id });
        console.log(`refs ${r.id}: merged into ${curated.id}`);
        continue;
      }
      // Limits from the tree's sizes first: a huge plugin repository is never downloaded just to be turned down.
      const layout = layoutOf(blobs, gh.path);
      const bytes = layout.reduce((n, l) => n + l.bytes, 0);
      const tooMany = layout.length > (MAX_SKILLS[r.kind] ?? 30) || bytes > MAX_PACKAGE_BYTES;
      const skills = layout.length === 0 || tooMany ? [] : await skillsIn(gh.repo, commit, layout);
      if (skills.length === 0) {
        const note =
          layout.length === 0
            ? 'Não traz pastas SKILL.md: instale pelo comando abaixo.'
            : tooMany
              ? `Grande demais para instalar por aqui (${layout.length} skills, ${(bytes / 1048576).toFixed(1)} MB): use o comando abaixo.`
              : 'Nenhuma pasta passou na validação: instale pelo comando abaixo.';
        packages.push({ ...base, manual: { ...base.manual, note }, skills: [], hasScripts: false, license: '' });
        console.log(`refs ${r.id}: manual (${note})`);
        continue;
      }
      packages.push({
        ...base,
        license: await licenseOf(gh.repo, commit, blobs, gh.path),
        source: {
          label: gh.repo.split('/')[0],
          repo: gh.repo,
          commit,
          url: `https://github.com/${gh.repo}/tree/${commit}/${gh.path}`,
          ...(clones.has(`${gh.repo}@${commit}`) ? { private: true } : {}),
        },
        skills: skills.map(({ description: _d, ...s }) => s),
        hasScripts: hasScripts(skills),
      });
      console.log(`refs ${r.id}: ${skills.length} skill(s)`);
    } catch (err) {
      console.warn(`refs ${r.id}: ${err.message} → manual`);
      packages.push({ ...base, skills: [], hasScripts: false, license: '' });
    }
  }
} else console.warn(`references site not found at ${refsDir}; only the curated skills`);

rmSync(CLONES, { recursive: true, force: true });
writeFileSync(OUT, JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), packages }, null, 2) + '\n');
const installable = packages.filter((p) => p.skills.length > 0);
console.log(`${packages.length} packages (${installable.length} installable, ${installable.reduce((n, p) => n + p.skills.length, 0)} skills) → ${OUT}`);
