/**
 * The file a Codex patch touches and the first lines it adds, for the live
 * session window. Pure (unit-tested). Codex sends apply_patch either as its
 * own tool call (plain patch text) or inside an `exec` call, as a JavaScript
 * string literal — so newlines and quotes may arrive escaped.
 */
export function codexPatchTarget(input: string | undefined): { file: string; hint: string | undefined } | null {
  if (!input || !/\*\*\* (Update|Add|Delete) File: /.test(input)) return null;
  // Unescape a JS string literal body when the patch came inside exec code.
  const text = /\\n\*\*\* /.test(input) || input.startsWith('text(') || /apply_patch\("/.test(input)
    ? input.replace(/\\(["'\\nrt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '' : c === 't' ? '\t' : c))
    : input;
  const m = /^\*\*\* (Update|Add|Delete) File: (.+)$/m.exec(text);
  if (!m) return null;
  const file = m[2].trim();
  const after = text.slice(m.index + m[0].length).split('\n');
  const added: string[] = [];
  for (const line of after) {
    if (line.startsWith('*** ')) break;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (added.length) break;
  }
  return { file, hint: added.length ? added.slice(0, 8).join('\n') : undefined };
}
