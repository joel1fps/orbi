/**
 * Skills Arsenal: the pure half (no I/O, unit-tested). Every agent here uses
 * the same open "Agent Skills" format — a folder with a SKILL.md — and only
 * the folder it reads differs, so a target is a row of data.
 */

import type { SkillTargetId } from '@shared/types';

export type { SkillTargetId };

export interface SkillTargetSpec {
  name: string;
  /** Where Orbi installs, relative to the home folder ('/' separated). */
  dir: string;
  /** Every folder the agent loads skills from (its own first). */
  reads: string[];
  docs: string;
}

/**
 * Checked on 02/11/2026 against each agent's docs and this machine:
 * Codex moved user skills to ~/.agents/skills (the old ~/.codex/skills is
 * still read by Cursor); Antigravity 2.0 keeps them in ~/.gemini/config/skills;
 * Cursor also loads the Claude, Codex and shared folders.
 */
export const SKILL_TARGETS: Record<SkillTargetId, SkillTargetSpec> = {
  claude: { name: 'Claude Code', dir: '.claude/skills', reads: ['.claude/skills'], docs: 'https://code.claude.com/docs/en/skills' },
  codex: {
    name: 'Codex',
    dir: '.agents/skills',
    reads: ['.agents/skills'],
    docs: 'https://developers.openai.com/codex/skills',
  },
  gemini: { name: 'Gemini CLI', dir: '.gemini/skills', reads: ['.gemini/skills'], docs: 'https://geminicli.com/docs/cli/skills/' },
  antigravity: {
    name: 'Antigravity',
    dir: '.gemini/config/skills',
    reads: ['.gemini/config/skills'],
    docs: 'https://codelabs.developers.google.com/getting-started-with-antigravity-skills',
  },
  cursor: {
    name: 'Cursor',
    dir: '.cursor/skills',
    reads: ['.cursor/skills', '.agents/skills', '.claude/skills', '.codex/skills'],
    docs: 'https://cursor.com/docs/skills',
  },
};

export const TARGET_IDS = Object.keys(SKILL_TARGETS) as SkillTargetId[];

/** Other agents that will also load what is installed for `id` (shared folders). */
export function alsoVisibleTo(id: SkillTargetId): SkillTargetId[] {
  const dir = SKILL_TARGETS[id].dir;
  return TARGET_IDS.filter((t) => t !== id && SKILL_TARGETS[t].reads.includes(dir));
}

/** Picks that would give an agent the same skill twice, through another pick's folder. */
export function redundantTargets(selected: SkillTargetId[]): SkillTargetId[] {
  return selected.filter((t) => selected.some((s) => s !== t && SKILL_TARGETS[t].reads.includes(SKILL_TARGETS[s].dir)));
}

// ---------- SKILL.md frontmatter (the small YAML subset skills use) ----------

export interface Frontmatter {
  name?: string;
  description?: string;
  license?: string;
  version?: string;
}

function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.indexOf('---', 1);
  const body = lines.slice(1, end === -1 ? lines.length : end);
  const out: Record<string, string> = {};
  for (let i = 0; i < body.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(body[i]);
    if (!m) continue;
    const [, key, raw] = m;
    // Indented lines that belong to this key (block scalar or nested map).
    const block: string[] = [];
    while (i + 1 < body.length && (body[i + 1].trim() === '' || /^\s/.test(body[i + 1]))) block.push(body[++i]);
    const style = /^([|>])[-+]?$/.exec(raw.trim());
    if (style) {
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
      const text = block.map((l) => l.slice(indent)).join('\n').trim();
      out[key] = style[1] === '|' ? text : text.replace(/\s*\n\s*/g, ' ');
    } else if (raw.trim() === '') {
      for (const l of block) {
        const n = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(l);
        if (n) out[`${key}.${n[1]}`] = unquote(n[2]);
      }
    } else out[key] = unquote(raw);
  }
  const fm: Frontmatter = {};
  if (out.name) fm.name = out.name;
  if (out.description) fm.description = out.description;
  if (out.license) fm.license = out.license;
  const version = out.version ?? out['metadata.version'];
  if (version) fm.version = version;
  return fm;
}

// ---------- what a skill may contain ----------

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** A plain relative path that stays inside the skill folder, on Windows too. */
export function isSafeRelPath(p: string): boolean {
  if (!p || p.includes('\\') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  if (/[\u0000-\u001f<>:"|?*]/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..' && !RESERVED.test(seg) && !/[. ]$/.test(seg));
}

const SCRIPT_EXT = /\.(sh|bash|zsh|fish|ps1|psm1|bat|cmd|vbs|py|js|mjs|cjs|ts|rb|pl|php|exe|dll|so|dylib|jar|msi)$/i;

/** Something an agent could run. Orbi never runs it; installing one needs a second, explicit yes. */
export function isScript(p: string): boolean {
  return p.split('/')[0] === 'scripts' || SCRIPT_EXT.test(p);
}

export const MAX_FILES = 200;
export const MAX_BYTES = 5 * 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export function validateManifest(m: { name: string; files: ManifestFile[] }): { errors: string[]; hasScripts: boolean } {
  const errors: string[] = [];
  if (!NAME.test(m.name)) errors.push(`Nome inválido: "${m.name}" (use minúsculas, números e hífens).`);
  if (!m.files.some((f) => f.path === 'SKILL.md')) errors.push('Falta o SKILL.md na raiz da skill.');
  if (m.files.length > MAX_FILES) errors.push(`Arquivos demais (${m.files.length}, máximo ${MAX_FILES}).`);
  const total = m.files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_BYTES) errors.push(`Grande demais (${(total / 1048576).toFixed(1)} MB, máximo 5 MB).`);
  const seen = new Set<string>();
  for (const f of m.files) {
    if (!isSafeRelPath(f.path)) errors.push(`Caminho recusado: ${JSON.stringify(f.path)}.`);
    const key = f.path.toLowerCase();
    if (seen.has(key)) errors.push(`Dois arquivos com o mesmo nome no Windows: ${f.path}.`);
    seen.add(key);
  }
  return { errors, hasScripts: m.files.some((f) => isScript(f.path)) };
}

// ---------- install / uninstall decisions ----------

export type TargetStatus = 'new' | 'same' | 'update' | 'modified' | 'conflict';

export interface LedgerFiles {
  commit: string;
  files: { path: string; sha256: string }[];
}

/**
 * What installing would do in one agent's folder. `onDisk` maps each file
 * now in the skill folder to its hash (null: no folder); `ledger` is what
 * Orbi installed there, if it did.
 */
export function targetStatus(i: { onDisk: Map<string, string> | null; ledger: LedgerFiles | null; commit: string }): TargetStatus {
  if (!i.onDisk) return 'new';
  if (!i.ledger) return 'conflict';
  const untouched = i.onDisk.size === i.ledger.files.length && i.ledger.files.every((f) => i.onDisk!.get(f.path) === f.sha256);
  if (!untouched) return 'modified';
  return i.ledger.commit === i.commit ? 'same' : 'update';
}

/** Uninstall deletes only files still byte-identical to what Orbi wrote; everything else stays. */
export function uninstallSplit(installed: { path: string; sha256: string }[], onDisk: Map<string, string>): { remove: string[]; keep: string[] } {
  const remove = installed.filter((f) => onDisk.get(f.path) === f.sha256).map((f) => f.path);
  const removed = new Set(remove);
  return { remove, keep: [...onDisk.keys()].filter((p) => !removed.has(p)) };
}

// ---------- catalog update ----------

export interface TreeBlob {
  path: string;
  size?: number;
}

/**
 * The files of the skill folder `dir` in a repository tree (a GitHub
 * `git/trees?recursive=1` listing), relative to it, without nested skill
 * folders; null when the folder no longer has a SKILL.md.
 */
export function folderFiles(blobs: TreeBlob[], dir: string): { path: string; size: number }[] | null {
  const inside = (p: string) => dir === '.' || p.startsWith(dir + '/');
  const rel = (p: string) => (dir === '.' ? p : p.slice(dir.length + 1));
  if (!blobs.some((b) => inside(b.path) && rel(b.path) === 'SKILL.md')) return null;
  const nested = blobs
    .filter((b) => inside(b.path) && rel(b.path) !== 'SKILL.md' && /(^|\/)SKILL\.md$/.test(rel(b.path)))
    .map((b) => rel(b.path).slice(0, -'/SKILL.md'.length));
  return blobs
    .filter((b) => inside(b.path))
    .map((b) => ({ path: rel(b.path), size: b.size ?? 0 }))
    .filter((f) => !nested.some((n) => f.path.startsWith(n + '/')))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** One status for a package in one agent: the most cautious of its folders. */
export function aggregateStatus(statuses: TargetStatus[]): TargetStatus {
  if (statuses.includes('conflict')) return 'conflict';
  if (statuses.includes('modified')) return 'modified';
  if (statuses.every((s) => s === 'same')) return 'same';
  if (statuses.every((s) => s === 'new')) return 'new';
  return 'update';
}
