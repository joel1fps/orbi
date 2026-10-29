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
  dataDir?: string;
  /** Directory whose newest write counts as "activity". */
  activityDir?: string;
  depth?: number;
}

const PROBES: Probe[] = [
  { id: 'claude', commands: ['claude'], dataDir: join(home, '.claude', 'projects'), activityDir: join(home, '.claude', 'projects'), depth: 1 },
  { id: 'codex', commands: ['codex'], dataDir: join(home, '.codex', 'sessions'), activityDir: join(home, '.codex', 'sessions'), depth: 3 },
  {
    id: 'antigravity',
    commands: [],
    dataDir: join(home, '.gemini', 'antigravity-ide'),
    activityDir: join(home, '.gemini', 'antigravity-ide', 'conversations'),
    depth: 1,
  },
  // ~/.gemini also exists for Antigravity, so only the CLI's own tmp/ counts as Gemini CLI data.
  { id: 'gemini', commands: ['gemini'], dataDir: join(home, '.gemini', 'tmp'), activityDir: join(home, '.gemini', 'tmp'), depth: 3 },
  { id: 'hermes', commands: ['hermes'], dataDir: join(home, '.hermes'), activityDir: join(home, '.hermes', 'sessions'), depth: 2 },
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
  const hasData = p.dataDir ? await exists(p.dataDir) : false;
  const lastWrite = p.activityDir && hasData ? await newestWrite(p.activityDir, p.depth ?? 2) : undefined;
  hub.setDetection(p.id, { onPath, hasData, lastWrite });
}

export function startDetection(): void {
  const run = () => Promise.all(PROBES.map(probe)).catch(() => undefined);
  void run();
  setInterval(run, 90_000).unref();
}
