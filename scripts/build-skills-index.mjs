// Builds resources/skills-index.json, the curated catalog of the Skills Arsenal.
//
//   node scripts/build-skills-index.mjs            # pin the current commit of each source
//   node scripts/build-skills-index.mjs --keep     # re-hash the commits already pinned
//
// Each skill is pinned to a commit and every file gets its size and sha256;
// the app refuses anything that does not match. To add a skill, add it to
// SOURCES (only Apache-2.0 or MIT skills), run this script and review the diff.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, validateManifest } from '../src/main/skills/logic.ts';

const OUT = join(import.meta.dirname, '..', 'resources', 'skills-index.json');

const SOURCES = [
  {
    id: 'anthropics',
    label: 'Anthropic',
    repo: 'anthropics/skills',
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
    id: 'openai',
    label: 'OpenAI',
    repo: 'openai/skills',
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

const ALLOWED_LICENSES = ['Apache-2.0', 'MIT'];

async function json(url) {
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'orbi-skills-index' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function raw(repo, commit, path) {
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function licenseOf(text) {
  if (/Apache License/i.test(text)) return 'Apache-2.0';
  if (/MIT License/i.test(text)) return 'MIT';
  return 'unknown';
}

const keep = process.argv.includes('--keep');
const previous = keep && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const skills = [];

for (const src of SOURCES) {
  const commit = previous?.sources.find((s) => s.id === src.id)?.commit ?? (await json(`https://api.github.com/repos/${src.repo}/commits/HEAD`)).sha;
  const tree = await json(`https://api.github.com/repos/${src.repo}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new Error(`tree of ${src.repo} is truncated`);
  for (const [dir, category] of Object.entries(src.skills)) {
    const prefix = `${src.base}/${dir}/`;
    const blobs = tree.tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix));
    const files = [];
    let skillMd = '';
    let license = 'unknown';
    for (const b of blobs) {
      const rel = b.path.slice(prefix.length);
      const bytes = await raw(src.repo, commit, b.path);
      files.push({ path: rel, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      if (rel === 'SKILL.md') skillMd = bytes.toString('utf8');
      if (/^LICENSE(\.txt|\.md)?$/i.test(rel)) license = licenseOf(bytes.toString('utf8'));
    }
    const fm = parseFrontmatter(skillMd);
    const name = fm.name ?? dir;
    const { errors, hasScripts } = validateManifest({ name, files });
    if (errors.length) throw new Error(`${src.repo}/${dir}: ${errors.join(' ')}`);
    if (!ALLOWED_LICENSES.includes(license)) throw new Error(`${src.repo}/${dir}: license ${license}`);
    skills.push({
      id: `${src.id}/${name}`,
      name,
      description: fm.description ?? '',
      category,
      license,
      version: fm.version,
      source: { id: src.id, label: src.label, repo: src.repo, commit, path: `${src.base}/${dir}`, url: `https://github.com/${src.repo}/tree/${commit}/${src.base}/${dir}` },
      hasScripts,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    });
    console.log(`${src.repo}/${dir}: ${files.length} files${hasScripts ? ', scripts' : ''}`);
  }
}

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sources: SOURCES.map((s) => ({ id: s.id, label: s.label, repo: s.repo, commit: skills.find((k) => k.source.id === s.id)?.source.commit })),
  skills,
};
writeFileSync(OUT, JSON.stringify(index, null, 2) + '\n');
console.log(`${skills.length} skills → ${OUT}`);
