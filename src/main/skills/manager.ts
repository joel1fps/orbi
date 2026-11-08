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
  ToolStatus,
} from '@shared/types';
import { hub } from '../hub';
import { resource } from '../resources';
import { dataDir, store } from '../store';
import {
  aggregateStatus,
  alsoVisibleTo,
  folderFiles,
  isScript,
  parseFrontmatter,
  redundantTargets,
  SKILL_TARGETS,
  TARGET_IDS,
  targetStatus,
  uninstallSplit,
  validateManifest,
  type ManifestFile,
  type TargetStatus,
} from './logic';

/**
 * Skills Arsenal: the half that touches the disk and the network. The
 * renderer only ever sends ids; every path is built here from the bundled
 * index and the target table. Nothing a skill contains is ever executed.
 *
 * A package is one or more SKILL.md folders pinned to a commit. Install:
 * download into a staging folder, check each file's size and sha256 against
 * the index, re-check that each agent folder is still what the user
 * reviewed, move whatever was there to a dated backup, then move the new
 * folder into place. Every folder is recorded in the ledger, and uninstall
 * removes only files still identical to what Orbi wrote.
 */

interface IndexFolder {
  name: string;
  path: string;
  files: ManifestFile[];
}

interface IndexPackage {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: string;
  origin: 'curated' | 'refs';
  mine?: boolean;
  support: SkillTargetId[];
  license: string;
  version?: string;
  source?: { label: string; repo: string; commit: string; url: string; private?: boolean };
  skills: IndexFolder[];
  hasScripts: boolean;
  manual?: SkillCatalogEntry['manual'];
}

interface LedgerEntry {
  /** Package id. */
  skillId: string;
  /** Folder name. */
  name: string;
  targetId: SkillTargetId;
  commit: string;
  files: { path: string; sha256: string }[];
  installedAt: number;
}

const FETCH_TIMEOUT_MS = 20_000;
const PLAN_TTL_MS = 10 * 60_000;
const MAX_SCAN_FILES = 500;

interface IndexFile {
  version: number;
  generatedAt?: string;
  packages: IndexPackage[];
}

let indexCache: IndexPackage[] | null = null;
let indexUpdatedAt: string | undefined;

/** "Atualizar catálogo" writes here; the copy bundled with the app wins again once it is newer (an app update). */
const updatedIndexFile = () => join(dataDir(), 'skills-index.json');

function readIndexFile(path: string): IndexFile | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as IndexFile;
    return raw.version === 2 && Array.isArray(raw.packages) ? raw : null;
  } catch {
    return null;
  }
}

function loadIndex(): IndexPackage[] {
  if (indexCache) return indexCache;
  const bundled = readIndexFile(resource('skills-index.json'));
  const updated = existsSync(updatedIndexFile()) ? readIndexFile(updatedIndexFile()) : null;
  const raw = updated && (!bundled || (updated.generatedAt ?? '') > (bundled.generatedAt ?? '')) ? updated : bundled;
  if (!raw) throw new Error('Formato do catálogo desconhecido.');
  indexUpdatedAt = raw.generatedAt;
  // The index ships with the app, but it is checked like any input: a folder that fails is left out, loudly.
  indexCache = raw.packages.map((p) => {
    const skills = p.skills.filter((s) => {
      const { errors } = validateManifest({ name: s.name, files: s.files });
      if (errors.length) console.warn(`[orbi] skills index: ${p.id}/${s.name} ignored: ${errors.join(' ')}`);
      return errors.length === 0;
    });
    return { ...p, skills, support: p.support.filter(isTarget) };
  });
  return indexCache;
}

const targetDir = (t: SkillTargetId) => join(homedir(), ...SKILL_TARGETS[t].dir.split('/'));
const skillDir = (t: SkillTargetId, name: string) => join(targetDir(t), name);
const isTarget = (t: unknown): t is SkillTargetId => typeof t === 'string' && (TARGET_IDS as string[]).includes(t);

function detected(t: SkillTargetId, tools: ToolStatus[]): boolean {
  if (t === 'cursor') {
    return existsSync(join(homedir(), '.cursor')) || existsSync(join(process.env.LOCALAPPDATA ?? '', 'Programs', 'cursor'));
  }
  return tools.find((x) => x.id === t)?.availability !== 'not-installed';
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

const findEntry = (l: LedgerEntry[], pkg: string, t: SkillTargetId, name: string) =>
  l.find((e) => e.skillId === pkg && e.targetId === t && e.name === name);

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

const fileInfo = (f: ManifestFile) => ({ path: f.path, size: f.size, script: isScript(f.path) });

async function installsOf(p: IndexPackage, ledger: LedgerEntry[]): Promise<Partial<Record<SkillTargetId, SkillInstallState>>> {
  const out: Partial<Record<SkillTargetId, SkillInstallState>> = {};
  if (!p.source || p.skills.length === 0) return out;
  for (const t of TARGET_IDS) {
    const there = p.skills.filter((s) => existsSync(skillDir(t, s.name)));
    if (there.length === 0) continue;
    const mine = there.map((s) => findEntry(ledger, p.id, t, s.name));
    if (mine.some((m) => !m)) {
      out[t] = 'external';
      continue;
    }
    // Hashing only folders Orbi installed: a few small folders, so this stays cheap.
    const statuses = await Promise.all(
      there.map(async (s, i) => targetStatus({ onDisk: await hashDir(skillDir(t, s.name)), ledger: mine[i]!, commit: p.source!.commit })),
    );
    if (statuses.includes('modified')) out[t] = 'modified';
    else out[t] = there.length === p.skills.length && statuses.every((s) => s === 'same') ? 'installed' : 'update';
  }
  return out;
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
  const tools = hub.snapshot().tools;
  const targets: SkillTargetInfo[] = TARGET_IDS.map((t) => ({
    id: t,
    name: SKILL_TARGETS[t].name,
    dir: targetDir(t),
    detected: detected(t, tools),
    alsoVisibleTo: alsoVisibleTo(t),
    docs: SKILL_TARGETS[t].docs,
  }));
  let index: IndexPackage[];
  try {
    index = loadIndex();
  } catch (err) {
    return { skills: [], targets, installed: [], error: `Não foi possível ler o catálogo: ${(err as Error).message}` };
  }
  const ledger = await readLedger();
  const installs = await Promise.all(index.map((p) => installsOf(p, ledger)));
  const skills: SkillCatalogEntry[] = index.map((p, i) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    kind: p.kind,
    origin: p.origin,
    mine: Boolean(p.mine),
    support: p.support,
    license: p.license,
    version: p.version,
    source: p.source,
    skills: p.skills.map((s) => ({ name: s.name, files: s.files.map(fileInfo) })),
    hasScripts: p.hasScripts,
    manual: p.manual,
    installs: installs[i],
  }));
  return { skills, targets, installed: await scanInstalled(ledger), updatedAt: indexUpdatedAt };
}

// ---------- catalog update ----------

const GH_API = 'https://api.github.com';
let refreshing = false;

async function gh<T>(path: string, accept = 'application/vnd.github+json'): Promise<T> {
  const token = store.getGithubToken();
  const res = await fetch(`${GH_API}${path}`, {
    headers: { accept, 'user-agent': 'orbi-desktop', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 403 || res.status === 429) throw new Error('limite de consultas do GitHub atingido; conecte o GitHub em Ferramentas ou tente mais tarde');
  if (res.status === 404 && !token) throw new Error(PRIVATE_NOTE);
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  return (accept.endsWith('.sha') ? await res.text() : await res.json()) as T;
}

const PRIVATE_NOTE = 'repositório privado: conecte o GitHub em Ferramentas com um token que tenha acesso a ele';

/** One file at a pinned commit. A private repository needs the GitHub token saved in Ferramentas. */
async function rawFile(repo: string, commit: string, path: string[], isPrivate?: boolean, size?: number): Promise<Buffer> {
  // raw.githubusercontent.com answers 501 for empty files.
  if (size === 0) return Buffer.alloc(0);
  const token = isPrivate ? store.getGithubToken() : null;
  if (isPrivate && !token) throw new Error(PRIVATE_NOTE);
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${commit}/${path.map(encodeURIComponent).join('/')}`, {
    headers: token ? { authorization: `token ${token}` } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404 && isPrivate) throw new Error(`${PRIVATE_NOTE} (o token salvo não chega a ${repo})`);
  if (!res.ok) throw new Error(`falha ao baixar ${path.join('/')} (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * "Atualizar catálogo": moves every installable package to the newest commit
 * of its repository, re-reading each folder's files and hashing them again,
 * exactly as scripts/build-skills-index.mjs does. One API call per repository
 * when nothing changed, two plus the downloads when it did. New items from
 * the references site still need the script.
 */
export async function refreshCatalog(): Promise<{ ok: boolean; message: string }> {
  if (refreshing) return { ok: false, message: 'O catálogo já está sendo atualizado.' };
  refreshing = true;
  try {
    const index = loadIndex().map((p) => ({ ...p, skills: p.skills.map((s) => ({ ...s })) }));
    const byRepo = new Map<string, IndexPackage[]>();
    for (const p of index) if (p.source && p.skills.length) byRepo.set(p.source.repo, [...(byRepo.get(p.source.repo) ?? []), p]);
    let updated = 0;
    const failed: string[] = [];
    for (const [repo, pkgs] of byRepo) {
      try {
        const commit = (await gh<string>(`/repos/${repo}/commits/HEAD`, 'application/vnd.github.sha')).trim();
        if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('commit inválido');
        if (pkgs.every((p) => p.source!.commit === commit)) continue;
        const tree = await gh<{ truncated?: boolean; tree: { path: string; type: string; size?: number }[] }>(`/repos/${repo}/git/trees/${commit}?recursive=1`);
        if (tree.truncated) throw new Error('repositório grande demais para ler de uma vez');
        const blobs = tree.tree.filter((e) => e.type === 'blob');
        for (const p of pkgs) {
          const skills: IndexFolder[] = [];
          for (const s of p.skills) {
            const listed = folderFiles(blobs, s.path);
            if (!listed) continue;
            if (listed.length > 200 || listed.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) throw new Error(`${s.name} ficou grande demais`);
            const files: ManifestFile[] = [];
            for (const f of listed) {
              const parts = [...(s.path === '.' ? [] : s.path.split('/')), ...f.path.split('/')];
              const bytes = await rawFile(repo, commit, parts, p.source!.private, f.size);
              files.push({ path: f.path, size: bytes.length, sha256: sha256(bytes) });
            }
            if (validateManifest({ name: s.name, files }).errors.length === 0) skills.push({ ...s, files });
          }
          if (skills.length === 0) throw new Error(`${p.name} não tem mais pastas SKILL.md válidas`);
          p.skills = skills;
          p.hasScripts = skills.some((s) => s.files.some((f) => isScript(f.path)));
          p.source = { ...p.source!, commit, url: p.source!.url.replace(/\/tree\/[0-9a-f]{40}/, `/tree/${commit}`) };
          updated++;
        }
      } catch (err) {
        failed.push(`${repo} (${(err as Error).message})`);
      }
    }
    const generatedAt = new Date().toISOString();
    const tmp = `${updatedIndexFile()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 2, generatedAt, packages: index }, null, 2));
    await rename(tmp, updatedIndexFile());
    indexCache = null;
    const head = updated ? `${updated} ${updated === 1 ? 'item atualizado' : 'itens atualizados'}.` : 'Tudo já estava na versão mais nova.';
    return {
      ok: failed.length === 0,
      message: failed.length ? `${head} Não consegui ler ${failed.length}: ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '…' : ''}` : head,
    };
  } catch (err) {
    return { ok: false, message: `Não foi possível atualizar: ${(err as Error).message}` };
  } finally {
    refreshing = false;
  }
}

// ---------- plan & apply ----------

interface StoredPlan {
  plan: SkillPlan;
  pkg: IndexPackage;
  /** target → folder → what the folder looked like when reviewed. */
  fingerprints: Partial<Record<SkillTargetId, Record<string, string>>>;
  expiresAt: number;
}

const plans = new Map<string, StoredPlan>();
let busy = false;

export async function planInstall(packageId: string, picked: unknown[]): Promise<SkillPlan | { error: string }> {
  const pkg = loadIndex().find((p) => p.id === packageId);
  if (!pkg) return { error: 'Item não encontrado no catálogo.' };
  if (!pkg.source || pkg.skills.length === 0) return { error: 'Este item é de instalação manual: use o comando mostrado.' };
  const targets = [...new Set(picked.filter(isTarget))];
  if (targets.length === 0) return { error: 'Escolha pelo menos um agente.' };
  const unsupported = targets.filter((t) => !pkg.support.includes(t));
  if (unsupported.length) return { error: `Sem suporte em ${unsupported.map((t) => SKILL_TARGETS[t].name).join(', ')}.` };

  const errors = pkg.skills.flatMap((s) => validateManifest({ name: s.name, files: s.files }).errors);
  const ledger = await readLedger();
  const redundant = redundantTargets(targets);
  const fingerprints: StoredPlan['fingerprints'] = {};
  const planTargets: SkillPlan['targets'] = [];
  for (const t of targets) {
    fingerprints[t] = {};
    const folders: { name: string; status: TargetStatus }[] = [];
    for (const s of pkg.skills) {
      const onDisk = await hashDir(skillDir(t, s.name));
      fingerprints[t]![s.name] = fingerprint(onDisk);
      const mine = findEntry(ledger, pkg.id, t, s.name);
      folders.push({ name: s.name, status: targetStatus({ onDisk, ledger: mine ?? null, commit: pkg.source.commit }) });
    }
    planTargets.push({
      targetId: t,
      dir: targetDir(t),
      status: aggregateStatus(folders.map((f) => f.status)),
      alsoVisibleTo: alsoVisibleTo(t),
      redundant: redundant.includes(t),
      folders,
    });
  }
  const files = pkg.skills.flatMap((s) => s.files.map((f) => ({ ...fileInfo(f), path: `${s.name}/${f.path}` })));
  const plan: SkillPlan = {
    id: randomUUID(),
    skillId: pkg.id,
    name: pkg.name,
    source: pkg.source,
    license: pkg.license,
    files,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    hasScripts: files.some((f) => f.script),
    targets: planTargets,
    errors,
  };
  for (const [id, p] of plans) if (p.expiresAt < Date.now()) plans.delete(id);
  plans.set(plan.id, { plan, pkg, fingerprints, expiresAt: Date.now() + PLAN_TTL_MS });
  return plan;
}

async function download(pkg: IndexPackage, into: string) {
  const { repo, commit } = pkg.source!;
  for (const s of pkg.skills) {
    for (const f of s.files) {
      const parts = [...(s.path === '.' ? [] : s.path.split('/')), ...f.path.split('/')];
      const bytes = await rawFile(repo, commit, parts, pkg.source!.private, f.size);
      if (bytes.length !== f.size || sha256(bytes) !== f.sha256) {
        throw new Error(`${s.name}/${f.path} não confere com o catálogo (tamanho ou hash diferente). Nada foi instalado.`);
      }
      const dest = join(into, s.name, ...f.path.split('/'));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, bytes);
    }
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const STATUS_NOTE: Record<TargetStatus, string> = {
  new: '',
  same: 'já estava instalada nesta versão',
  update: '',
  modified: 'mantida: a pasta foi editada depois da instalação',
  conflict: 'mantida: já existe uma pasta com esse nome que não foi instalada pelo Orbi',
};

export async function applyPlan(planId: string, opts: { replace: boolean; allowScripts: boolean }): Promise<SkillActionResult> {
  const stored = plans.get(planId);
  if (!stored || stored.expiresAt < Date.now()) return { ok: false, message: 'A conferência expirou. Abra o item de novo.', details: [] };
  const { plan, pkg } = stored;
  if (plan.errors.length) return { ok: false, message: plan.errors.join(' '), details: [] };
  if (plan.hasScripts && !opts.allowScripts) return { ok: false, message: 'Este item traz scripts. Confirme que você revisou antes de instalar.', details: [] };
  if (busy) return { ok: false, message: 'Outra instalação está em andamento.', details: [] };
  busy = true;
  plans.delete(planId);
  const staging = join(dataDir(), 'staging', randomUUID());
  const details: SkillActionResult['details'] = [];
  const writes = (s: TargetStatus) => s === 'new' || s === 'update' || (opts.replace && (s === 'modified' || s === 'conflict'));
  try {
    if (!plan.targets.some((t) => t.folders.some((f) => writes(f.status)))) {
      for (const t of plan.targets) details.push({ targetId: t.targetId, ok: t.status === 'same', message: STATUS_NOTE[t.status] || 'Nada para instalar.' });
      return { ok: details.every((d) => d.ok), message: 'Nada para instalar.', details };
    }

    await download(pkg, staging);
    let ledger = await readLedger();
    for (const t of plan.targets) {
      const notes: string[] = [];
      let ok = true;
      let installed = 0;
      for (const f of t.folders) {
        if (!writes(f.status)) {
          if (f.status !== 'same') ok = false;
          notes.push(`${f.name}: ${STATUS_NOTE[f.status]}`);
          continue;
        }
        const final = skillDir(t.targetId, f.name);
        try {
          // The folder must still be what the user reviewed.
          if (fingerprint(await hashDir(final)) !== stored.fingerprints[t.targetId]?.[f.name]) {
            ok = false;
            notes.push(`${f.name}: a pasta mudou depois da conferência, nada foi alterado`);
            continue;
          }
          const tmp = `${final}.orbi-new-${randomUUID().slice(0, 8)}`;
          await mkdir(targetDir(t.targetId), { recursive: true });
          await cp(join(staging, f.name), tmp, { recursive: true, errorOnExist: true, force: false });
          let backup: string | null = null;
          if (existsSync(final)) {
            backup = join(dataDir(), 'skill-backups', `${f.name}-${t.targetId}-${stamp()}`);
            await move(final, backup);
          }
          try {
            await rename(tmp, final);
          } catch (err) {
            if (backup) await move(backup, final).catch(() => undefined);
            await rm(tmp, { recursive: true, force: true });
            throw err;
          }
          const folder = pkg.skills.find((s) => s.name === f.name)!;
          ledger = [
            ...ledger.filter((e) => !(e.targetId === t.targetId && e.name === f.name)),
            {
              skillId: pkg.id,
              name: f.name,
              targetId: t.targetId,
              commit: pkg.source!.commit,
              files: folder.files.map((x) => ({ path: x.path, sha256: x.sha256 })),
              installedAt: Date.now(),
            },
          ];
          await writeLedger(ledger);
          installed++;
          if (backup) notes.push(`${f.name}: versão anterior guardada em ${backup}`);
        } catch (err) {
          ok = false;
          notes.push(`${f.name}: falhou (${(err as Error).message})`);
        }
      }
      const head = installed ? `${installed} ${installed === 1 ? 'skill instalada' : 'skills instaladas'}.` : 'Nada instalado.';
      details.push({ targetId: t.targetId, ok, message: [head, ...notes].join(' ') });
    }
    const allOk = details.every((d) => d.ok);
    return { ok: allOk, message: allOk ? `${pkg.name} instalado.` : 'Terminado, com avisos.', details };
  } catch (err) {
    return { ok: false, message: (err as Error).message, details };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    busy = false;
  }
}

// ---------- uninstall & open ----------

export async function uninstallSkill(packageId: string, targetId: unknown): Promise<SkillActionResult> {
  if (!isTarget(targetId)) return { ok: false, message: 'Agente desconhecido.', details: [] };
  const ledger = await readLedger();
  const entries = ledger.filter((e) => e.skillId === packageId && e.targetId === targetId);
  if (entries.length === 0) return { ok: false, message: 'Este item não foi instalado pelo Orbi neste agente. O Orbi não remove o que não instalou.', details: [] };
  let removed = 0;
  const kept: string[] = [];
  for (const entry of entries) {
    const dir = skillDir(targetId, entry.name);
    const onDisk = (await hashDir(dir)) ?? new Map<string, string>();
    const split = uninstallSplit(entry.files, onDisk);
    for (const p of split.remove) await rm(join(dir, ...p.split('/')), { force: true });
    await removeEmptyDirs(dir);
    removed += split.remove.length;
    kept.push(...split.keep.map((p) => `${entry.name}/${p}`));
  }
  await writeLedger(ledger.filter((e) => !entries.includes(e)));
  const message = kept.length
    ? `${removed === 1 ? "Removido 1 arquivo" : `Removidos ${removed} arquivos`}. ${kept.length === 1 ? "Ficou 1 que foi editado ou criado" : `Ficaram ${kept.length} que foram editados ou criados`} por você: ${kept.slice(0, 5).join(', ')}${kept.length > 5 ? '…' : ''}`
    : `Removido de ${SKILL_TARGETS[targetId].name}.`;
  return { ok: true, message, details: [{ targetId, ok: true, message }] };
}

/** Opens a skill folder (or the agent's skills folder) in Explorer. Only folders Orbi knows about. */
export function openSkillFolder(targetId: unknown, name?: unknown) {
  if (!isTarget(targetId)) return;
  const dir = typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ? skillDir(targetId, name) : targetDir(targetId);
  if (existsSync(dir)) void shell.openPath(dir);
}
