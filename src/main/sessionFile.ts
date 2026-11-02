import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { focusLines } from '@shared/steps';
import type { SessionFileView } from '@shared/types';
import { hub } from './hub';

const MAX_BYTES = 512 * 1024;

/**
 * The live session window's code view: the file the agent touched last,
 * centred on what it just wrote. The renderer sends a session id, never a
 * path; the file is read, never written, and binary or large files are skipped.
 */
export async function sessionFile(sessionId: unknown): Promise<SessionFileView | null> {
  if (typeof sessionId !== 'string') return null;
  const s = hub.getSession(sessionId);
  if (!s?.file || !isAbsolute(s.file)) return null;
  try {
    const st = await stat(s.file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const buf = await readFile(s.file);
    if (buf.includes(0)) return null; // binary
    const text = buf.toString('utf8');
    const view = focusLines(text, s.fileHint, 6);
    return { path: s.file, name: basename(s.file), ...view, totalLines: text.split(/\r?\n/).length };
  } catch {
    return null;
  }
}
