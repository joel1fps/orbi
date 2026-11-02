import { shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  InstalledSkill,
  SkillActionResult,
  SkillCatalog,
  SkillCatalogEntry,
  SkillInstallState,
  SkillPlan,
  SkillTargetId,
  SkillTargetInfo,
} from '@shared/types';
import { hub } from '../hub';
import { resource } from '../resources';
import { dataDir } from '../store';
import {
  alsoVisibleTo,
  isScript,
  parseFrontmatter,
  redundantTargets,
  SKILL_TARGETS,
  TARGET_IDS,
  targetStatus,
  uninstallSplit,
  validateManifest,
  type ManifestFile,
} from './logic';

/**
 * Skills Arsenal: the half that touches the disk and the network. The
 * renderer only ever sends ids; every path is built here from the curated
 * index and the target table. Nothing a skill contains is ever executed.
 *
 * Install: download into a staging folder, check each file's size and
 * sha256 against the index, re-check that the agent's folder is still what
 * the user reviewed, move whatever was there to a dated backup, then move
 * the new folder into place. Every install is recorded in the ledger, and
 * uninstall removes only files still identical to what Orbi wrote.
 */

interface IndexSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  license: string;
  version?: string;
  source: { id: string; label: string; repo: string; commit: string; path: string; url: string };
  hasScripts: boolean;
  files: ManifestFile[];
}

interface LedgerEntry {
  skillId: string;
  name: string;
  targetId: SkillTargetId;
  commit: string;
  files: { path: string; sha256: string }[];
  installedAt: number;
}

const FETCH_TIMEOUT_MS = 20_000;
const PLAN_TTL_MS = 10 * 60_000;
const MAX_SCAN_FILES = 500;

let indexCache: IndexSkill[] | null = null;

function loadIndex(): IndexSkill[] {
  if (indexCache) return indexCache;
  const raw = JSON.parse(readFileSync(resource('skills-index.json'), 'utf8')) as { version: number; skills: IndexSkill[] };
  if (raw.version !== 1 || !Array.isArray(raw.skills)) throw new Error('Formato do catálogo desconhecido.');
  // The index ships with the app, but it is checked like any input.
  indexCache = raw.skills.filter((s) => validateManifest({ name: s.name, files: s.files }).errors.length === 0);
  return indexCache;
}

const targetDir = (t: SkillTargetId) => join(homedir(), ...SKILL_TARGETS[t].dir.split('/'));
const skillDir = (t: SkillTargetId, name: string) => join(targetDir(t), name);
const isTarget = (t: unknown): t is SkillTargetId => typeof t === 'string' && (TARGET_IDS as string[]).includes(t);

function detected(t: SkillTargetId): boolean {
  if (t === 'cursor') {
    return existsSync(join(homedir(), '.cursor')) || existsSync(join(process.env.LOCALAPPDATA ?? '', 'Programs', 'cursor'));
  }
  return hub.snapshot().tools.find((x) => x.id === t)?.availability !== 'not-installed';
}

// ---------- ledger ----------

const ledgerFile = () => join(dataDir(), 'skills-ledger.json');

async function readLedger(): Promise<LedgerEntry[]> {
  if (!existsSync(ledgerFile())) return [];
  try {
    const raw = JSON.parse(await readFile(ledgerFile(), 'utf8')) as { version: number; installs: LedgerEntry[] };
    return Array.isArray(raw.installs) ? raw.installs : [];
  } catch {
    // Unreadable: keep it aside. Without a ledger, existing folders count as "not Orbi's" and are never overwritten silently.
    await rename(ledgerFile(), `${ledgerFile()}.corrupt-${Date.now()}`).catch(() => undefined);
    return [];
  }
}

async function writeLedger(entries: LedgerEntry[]) {
  const tmp = `${ledgerFile()}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, installs: entries }, null, 2));
  await rename(tmp, ledgerFile());
}

const findEntry = (l: LedgerEntry[], skillId: string, t: SkillTargetId) => l.find((e) => e.skillId === skillId && e.targetId === t);

// ---------- disk ----------

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Each file under `dir` (relative '/' path → sha256), or null when there is no folder. Links are never followed. */
async function hashDir(dir: string): Promise<Map<string, string> | null> {
  try {
    if (!(await lstat(dir)).isDirectory()) return new Map([['', 'not-a-folder']]);
  } catch {
    return null;
  }
  const out = new Map<string, string>();
  const walk = async (abs: string, rel: string) => {
    for (const e of await readdir(abs, { withFileTypes: true })) {
      if (out.size > MAX_SCAN_FILES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = join(abs, e.name);
      if (e.isSymbolicLink()) out.set(r, 'symlink');
      else if (e.isDirectory()) await walk(p, r);
      else if (e.isFile()) out.set(r, sha256(await readFile(p)));
    }
  };
  await walk(dir, '');
  return out;
}

const fingerprint = (m: Map<string, string> | null) =>
  m ? [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, h]) => `${p}:${h}`).join('|') : 'none';

async function removeEmptyDirs(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const e of entries) {
    if (e.isDirectory() && !e.isSymbolicLink()) {
      if (!(await removeEmptyDirs(join(dir, e.name)))) empty = false;
    } else empty = false;
  }
  if (empty) await rmdir(dir).catch(() => (empty = false));
  return empty;
}

/** rename, or copy + delete when the two folders are on different drives. */
async function move(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true, force: true });
  }
}

// ---------- catalog ----------

function toEntry(s: IndexSkill, installs: SkillCatalogEntry['installs']): SkillCatalogEntry {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    license: s.license,
    version: s.version,
    source: { label: s.source.label, repo: s.source.repo, commit: s.source.commit, url: s.source.url },
    hasScripts: s.hasScripts,
    files: s.files.map((f) => ({ path: f.path, size: f.size, script: isScript(f.path) })),
    installs,
  };
}

async function scanInstalled(ledger: LedgerEntry[]): Promise<InstalledSkill[]> {
  const out: InstalledSkill[] = [];
  for (const t of TARGET_IDS) {
    let entries;
    try {
      entries = await readdir(targetDir(t), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const md = join(targetDir(t), e.name, 'SKILL.md');
      if (!existsSync(md)) continue;
      const fm = parseFrontmatter((await readFile(md, 'utf8')).slice(0, 16_384));
      const mine = ledger.find((l) => l.targetId === t && l.name === e.name);
      out.push({
        name: e.name,
        description: fm.description,
        targetId: t,
        managed: Boolean(mine),
        skillId: mine?.skillId,
        commit: mine?.commit,
        installedAt: mine?.installedAt,
      });
    }
  }
  return out;
}

export async function skillsCatalog(): Promise<SkillCatalog> {
  const targets: SkillTargetInfo[] = TARGET_IDS.map((t) => ({
    id: t,
    name: SKILL_TARGETS[t].name,
    dir: targetDir(t),
    detected: detected(t),
    alsoVisibleTo: alsoVisibleTo(t),
    docs: SKILL_TARGETS[t].docs,
  }));
  let index: IndexSkill[];
  try {
    index = loadIndex();
  } catch (err) {
    return { skills: [], targets, installed: [], error: `Não foi possível ler o catálogo: ${(err as Error).message}` };
  }
  const ledger = await readLedger();
  const skills = index.map((s) => {
    const installs: Partial<Record<SkillTargetId, SkillInstallState>> = {};
    for (const t of TARGET_IDS) {
      const there = existsSync(skillDir(t, s.name));
      const mine = findEntry(ledger, s.id, t);
      if (mine && there) installs[t] = mine.commit === s.source.commit ? 'installed' : 'update';
      else if (there) installs[t] = 'external';
    }
    return toEntry(s, installs);
  });
  return { skills, targets, installed: await scanInstalled(ledger) };
}

// ---------- plan & apply ----------

interface StoredPlan {
  plan: SkillPlan;
  skill: IndexSkill;
  fingerprints: Partial<Record<SkillTargetId, string>>;
  expiresAt: number;
}

const plans = new Map<string, StoredPlan>();
let busy = false;

export async function planInstall(skillId: string, picked: unknown[]): Promise<SkillPlan | { error: string }> {
  const skill = loadIndex().find((s) => s.id === skillId);
  if (!skill) return { error: 'Skill não encontrada no catálogo.' };
  const targets = [...new Set(picked.filter(isTarget))];
  if (targets.length === 0) return { error: 'Escolha pelo menos um agente.' };
  const { errors, hasScripts } = validateManifest({ name: skill.name, files: skill.files });
  const ledger = await readLedger();
  const redundant = redundantTargets(targets);
  const fingerprints: StoredPlan['fingerprints'] = {};
  const planTargets: SkillPlan['targets'] = [];
  for (const t of targets) {
    const onDisk = await hashDir(skillDir(t, skill.name));
    fingerprints[t] = fingerprint(onDisk);
    const mine = findEntry(ledger, skill.id, t);
    planTargets.push({
      targetId: t,
      dir: skillDir(t, skill.name),
      status: targetStatus({ onDisk, ledger: mine ?? null, commit: skill.source.commit }),
      alsoVisibleTo: alsoVisibleTo(t),
      redundant: redundant.includes(t),
    });
  }
  const plan: SkillPlan = {
    id: randomUUID(),
    skillId: skill.id,
    name: skill.name,
    source: { label: skill.source.label, repo: skill.source.repo, commit: skill.source.commit, url: skill.source.url },
    license: skill.license,
    files: skill.files.map((f) => ({ path: f.path, size: f.size, script: isScript(f.path) })),
    totalBytes: skill.files.reduce((n, f) => n + f.size, 0),
    hasScripts,
    targets: planTargets,
    errors,
  };
  for (const [id, p] of plans) if (p.expiresAt < Date.now()) plans.delete(id);
  plans.set(plan.id, { plan, skill, fingerprints, expiresAt: Date.now() + PLAN_TTL_MS });
  return plan;
}

async function download(skill: IndexSkill, into: string) {
  const { repo, commit, path } = skill.source;
  for (const f of skill.files) {
    const url = `https://raw.githubusercontent.com/${repo}/${commit}/${[...path.split('/'), ...f.path.split('/')].map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Falha ao baixar ${f.path} (HTTP ${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length !== f.size || sha256(bytes) !== f.sha256) throw new Error(`${f.path} não confere com o catálogo (tamanho ou hash diferente). Nada foi instalado.`);
    const dest = join(into, ...f.path.split('/'));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const STATUS_NOTE: Record<SkillPlan['targets'][number]['status'], string> = {
  new: '',
  same: 'Já estava instalada nesta versão.',
  update: '',
  modified: 'Mantida: a pasta foi editada depois da instalação.',
  conflict: 'Mantida: já existe uma pasta com esse nome que não foi instalada pelo Orbi.',
};

export async function applyPlan(planId: string, opts: { replace: boolean; allowScripts: boolean }): Promise<SkillActionResult> {
  const stored = plans.get(planId);
  if (!stored || stored.expiresAt < Date.now()) return { ok: false, message: 'A conferência expirou. Abra a skill de novo.', details: [] };
  const { plan, skill } = stored;
  if (plan.errors.length) return { ok: false, message: plan.errors.join(' '), details: [] };
  if (plan.hasScripts && !opts.allowScripts) return { ok: false, message: 'Esta skill traz scripts. Confirme que você revisou antes de instalar.', details: [] };
  if (busy) return { ok: false, message: 'Outra instalação está em andamento.', details: [] };
  busy = true;
  plans.delete(planId);
  const staging = join(dataDir(), 'staging', randomUUID());
  const details: SkillActionResult['details'] = [];
  try {
    const todo = plan.targets.filter((t) => t.status === 'new' || t.status === 'update' || (opts.replace && (t.status === 'modified' || t.status === 'conflict')));
    for (const t of plan.targets.filter((x) => !todo.includes(x))) details.push({ targetId: t.targetId, ok: t.status === 'same', message: STATUS_NOTE[t.status] });
    if (todo.length === 0) return { ok: details.every((d) => d.ok), message: 'Nada para instalar.', details };

    await download(skill, staging);
    const files = skill.files.map((f) => ({ path: f.path, sha256: f.sha256 }));
    let ledger = await readLedger();
    for (const t of todo) {
      const final = skillDir(t.targetId, skill.name);
      try {
        // The folder must still be what the user reviewed.
        if (fingerprint(await hashDir(final)) !== stored.fingerprints[t.targetId]) {
          details.push({ targetId: t.targetId, ok: false, message: 'A pasta mudou depois da conferência. Nada foi alterado.' });
          continue;
        }
        const tmp = `${final}.orbi-new-${randomUUID().slice(0, 8)}`;
        await mkdir(targetDir(t.targetId), { recursive: true });
        await cp(staging, tmp, { recursive: true, errorOnExist: true, force: false });
        let backup: string | null = null;
        if (existsSync(final)) {
          backup = join(dataDir(), 'skill-backups', `${skill.name}-${t.targetId}-${stamp()}`);
          await move(final, backup);
        }
        try {
          await rename(tmp, final);
        } catch (err) {
          if (backup) await move(backup, final).catch(() => undefined);
          await rm(tmp, { recursive: true, force: true });
          throw err;
        }
        ledger = [
          ...ledger.filter((e) => !(e.targetId === t.targetId && e.name === skill.name)),
          { skillId: skill.id, name: skill.name, targetId: t.targetId, commit: skill.source.commit, files, installedAt: Date.now() },
        ];
        await writeLedger(ledger);
        details.push({
          targetId: t.targetId,
          ok: true,
          message: backup ? `Instalada. A versão anterior foi guardada em ${backup}.` : 'Instalada.',
        });
      } catch (err) {
        details.push({ targetId: t.targetId, ok: false, message: `Falhou: ${(err as Error).message}` });
      }
    }
    const ok = details.every((d) => d.ok);
    return { ok, message: ok ? `${skill.name} instalada.` : 'Terminado, com avisos.', details };
  } catch (err) {
    return { ok: false, message: (err as Error).message, details };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    busy = false;
  }
}

// ---------- uninstall & open ----------

export async function uninstallSkill(skillId: string, targetId: unknown): Promise<SkillActionResult> {
  if (!isTarget(targetId)) return { ok: false, message: 'Agente desconhecido.', details: [] };
  const ledger = await readLedger();
  const entry = findEntry(ledger, skillId, targetId);
  if (!entry) return { ok: false, message: 'Esta skill não foi instalada pelo Orbi neste agente. O Orbi não remove o que não instalou.', details: [] };
  const dir = skillDir(targetId, entry.name);
  const onDisk = (await hashDir(dir)) ?? new Map<string, string>();
  const { remove, keep } = uninstallSplit(entry.files, onDisk);
  for (const p of remove) await rm(join(dir, ...p.split('/')), { force: true });
  await removeEmptyDirs(dir);
  await writeLedger(ledger.filter((e) => e !== entry));
  const message = keep.length
    ? `Removidos ${remove.length} arquivos. Ficaram ${keep.length} que foram editados ou criados por você: ${keep.slice(0, 5).join(', ')}${keep.length > 5 ? '…' : ''}`
    : `${entry.name} removida de ${SKILL_TARGETS[targetId].name}.`;
  return { ok: true, message, details: [{ targetId, ok: true, message }] };
}

/** Opens a skill folder (or the agent's skills folder) in Explorer. Only folders Orbi knows about. */
export function openSkillFolder(targetId: unknown, name?: unknown) {
  if (!isTarget(targetId)) return;
  const dir = typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ? skillDir(targetId, name) : targetDir(targetId);
  if (existsSync(dir)) void shell.openPath(dir);
}
