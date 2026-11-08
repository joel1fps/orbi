import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ToolId } from '@shared/types';
import { hub } from '../hub';
import { exists, newestWrite } from './files';

const home = homedir();

/** Locate a command on PATH (`where` on Windows, `which` elsewhere). */
export function whichCommand(cmd: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(finder, [cmd], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      resolve(first ?? null);
    });
  });
}

interface Probe {
  id: ToolId;
  commands: string[];
  /** Known executable paths outside PATH (e.g. ~/.gemini/bin/agy.exe for GUI apps). */
  extraBins?: { name: string; path: string }[];
  dataDir?: string;
  dataDirs?: string[];
  /** Directory whose newest write counts as "activity". */
  activityDir?: string;
  activityDirs?: string[];
  depth?: number;
}

const agyBin = join(home, '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy');
const agyAppBins =
  process.platform === 'win32'
    ? [
        { name: 'agy', path: agyBin },
        { name: 'antigravity', path: join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe') },
      ]
    : process.platform === 'darwin'
      ? [
          { name: 'agy', path: agyBin },
          { name: 'antigravity', path: '/Applications/Antigravity.app' },
        ]
      : [{ name: 'agy', path: agyBin }];

const PROBES: Probe[] = [
  { id: 'claude', commands: ['claude'], dataDir: join(home, '.claude', 'projects'), activityDir: join(home, '.claude', 'projects'), depth: 1 },
  { id: 'codex', commands: ['codex'], dataDir: join(home, '.codex', 'sessions'), activityDir: join(home, '.codex', 'sessions'), depth: 3 },
  {
    id: 'antigravity',
    commands: ['agy', 'antigravity'],
    extraBins: agyAppBins,
    // Antigravity 2.0 uses ~/.gemini/antigravity (and ~/.gemini/antigravity-cli);
    // legacy 1.x used ~/.gemini/antigravity-ide/conversations (an empty migrated dir only has .ide_migration).
    dataDirs: [
      join(home, '.gemini', 'antigravity'),
      join(home, '.gemini', 'antigravity-cli'),
      join(home, '.gemini', 'antigravity-ide', 'conversations'),
    ],
    activityDirs: [
      join(home, '.gemini', 'antigravity', 'conversations'),
      join(home, '.gemini', 'antigravity-cli', 'conversations'),
      join(home, '.gemini', 'antigravity-ide', 'conversations'),
    ],
    depth: 1,
  },
  // ~/.gemini also exists for Antigravity, so only the CLI's own tmp/ counts as Gemini CLI data.
  { id: 'gemini', commands: ['gemini'], dataDir: join(home, '.gemini', 'tmp'), activityDir: join(home, '.gemini', 'tmp'), depth: 3 },
  { id: 'github', commands: ['gh'] },
];

export const commandPaths: Partial<Record<string, string>> = {};

async function probe(p: Probe) {
  let onPath = false;
  for (const c of p.commands) {
    const found = await whichCommand(c);
    if (found) {
      commandPaths[c] = found;
      onPath = true;
      break;
    }
  }
  if (!onPath && p.extraBins) {
    for (const b of p.extraBins) {
      if (b.path && (await exists(b.path))) {
        commandPaths[b.name] = b.path;
        onPath = true;
        break;
      }
    }
  }
  const dataDirs = p.dataDirs ?? (p.dataDir ? [p.dataDir] : []);
  let hasData = false;
  for (const d of dataDirs) {
    if (await exists(d)) {
      hasData = true;
      break;
    }
  }
  const activityDirs = p.activityDirs ?? (p.activityDir ? [p.activityDir] : []);
  let lastWrite: number | undefined;
  if (hasData && activityDirs.length > 0) {
    for (const d of activityDirs) {
      const w = await newestWrite(d, p.depth ?? 2);
      if (w && (!lastWrite || w > lastWrite)) lastWrite = w;
    }
  }
  hub.setDetection(p.id, { onPath, hasData, lastWrite });
}

export function startDetection(): void {
  const run = () => Promise.all(PROBES.map(probe)).catch(() => undefined);
  void run();
  setInterval(run, 90_000).unref();
}
