import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export async function readBytes(path: string, start: number, end: number): Promise<Buffer> {
  const len = Math.max(0, end - start);
  if (len === 0) return Buffer.alloc(0);
  const fh = await fs.open(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Read bytes [start, end) of a file as UTF-8, dropping a leading partial line when start > 0. */
export async function readRange(path: string, start: number, end: number): Promise<string> {
  let text = (await readBytes(path, start, end)).toString('utf8');
  if (start > 0) {
    const nl = text.indexOf('\n');
    text = nl >= 0 ? text.slice(nl + 1) : '';
  }
  return text;
}

/** Parse JSONL text, skipping incomplete or invalid lines. */
export function parseLines<T = Record<string, unknown>>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line || line[0] !== '{') continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* partial line still being written */
    }
  }
  return out;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Newest mtime among files up to `depth` levels below `dir`. */
export async function newestWrite(dir: string, depth = 2): Promise<number | undefined> {
  let newest: number | undefined;
  async function walk(d: string, level: number) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (level < depth) await walk(p, level + 1);
      } else {
        try {
          const st = await fs.stat(p);
          if (!newest || st.mtimeMs > newest) newest = st.mtimeMs;
        } catch {
          /* vanished */
        }
      }
    }
  }
  await walk(dir, 0);
  return newest;
}
