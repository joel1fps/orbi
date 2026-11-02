import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateStatus,
  alsoVisibleTo,
  isSafeRelPath,
  isScript,
  parseFrontmatter,
  redundantTargets,
  targetStatus,
  uninstallSplit,
  validateManifest,
} from '../src/main/skills/logic.ts';

test('frontmatter: inline, quoted, folded and nested values', () => {
  const md = [
    '---',
    'name: gh-fix-ci',
    'description: "Fix failing CI: reads logs"',
    'license: Apache-2.0',
    'metadata:',
    '  version: 1.2.0',
    '---',
    '# Body',
  ].join('\n');
  assert.deepEqual(parseFrontmatter(md), { name: 'gh-fix-ci', description: 'Fix failing CI: reads logs', license: 'Apache-2.0', version: '1.2.0' });

  const folded = "---\r\nname: x\r\ndescription: >\r\n  first line\r\n  second line\r\n---\r\n";
  assert.equal(parseFrontmatter(folded).description, 'first line second line');
  const literal = "---\nname: x\ndescription: |\n  a\n  b\n---\n";
  assert.equal(parseFrontmatter(literal).description, 'a\nb');
  assert.equal(parseFrontmatter("---\nname: 'quoted'\n---").name, 'quoted');
  assert.deepEqual(parseFrontmatter('# no frontmatter'), {});
});

test('paths: only plain relative paths inside the skill', () => {
  for (const ok of ['SKILL.md', 'scripts/run.py', 'references/a b.md']) assert.equal(isSafeRelPath(ok), true, ok);
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'C:x', 'a\\b', 'a//b', '', 'CON', 'docs/nul.txt', 'com1.md', 'trail.', 'trail ', 'a/\u0001b'])
    assert.equal(isSafeRelPath(bad), false, JSON.stringify(bad));
});

test('scripts are recognised by folder and extension', () => {
  assert.equal(isScript('scripts/README.md'), true);
  assert.equal(isScript('tools/run.ps1'), true);
  assert.equal(isScript('bin/tool.exe'), true);
  assert.equal(isScript('references/guide.md'), false);
  assert.equal(isScript('assets/logo.png'), false);
});

const manifest = (over: Partial<Parameters<typeof validateManifest>[0]> = {}) => ({
  name: 'good-skill',
  files: [
    { path: 'SKILL.md', size: 100, sha256: 'a' },
    { path: 'scripts/x.py', size: 10, sha256: 'b' },
  ],
  ...over,
});

test('manifest: SKILL.md, name, sizes and paths are checked; scripts are a warning', () => {
  const ok = validateManifest(manifest());
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.hasScripts, true);
  assert.ok(validateManifest(manifest({ name: 'Bad Name' })).errors.length > 0);
  assert.ok(validateManifest(manifest({ files: [{ path: 'README.md', size: 1, sha256: 'a' }] })).errors.length > 0);
  assert.ok(validateManifest(manifest({ files: [{ path: 'SKILL.md', size: 1, sha256: 'a' }, { path: '../evil', size: 1, sha256: 'b' }] })).errors.length > 0);
  assert.ok(validateManifest(manifest({ files: [{ path: 'SKILL.md', size: 6 * 1024 * 1024, sha256: 'a' }] })).errors.length > 0);
  const dup = [{ path: 'SKILL.md', size: 1, sha256: 'a' }, { path: 'skill.md', size: 1, sha256: 'b' }];
  assert.ok(validateManifest(manifest({ files: dup })).errors.length > 0, 'case-insensitive duplicates collide on Windows');
});

test('target status: new, same, update, modified by the user, or not ours', () => {
  const files = [{ path: 'SKILL.md', sha256: 'h1' }];
  const disk = new Map([['SKILL.md', 'h1']]);
  assert.equal(targetStatus({ onDisk: null, ledger: null, commit: 'c2' }), 'new');
  assert.equal(targetStatus({ onDisk: disk, ledger: null, commit: 'c2' }), 'conflict');
  assert.equal(targetStatus({ onDisk: disk, ledger: { commit: 'c2', files }, commit: 'c2' }), 'same');
  assert.equal(targetStatus({ onDisk: disk, ledger: { commit: 'c1', files }, commit: 'c2' }), 'update');
  assert.equal(targetStatus({ onDisk: new Map([['SKILL.md', 'edited']]), ledger: { commit: 'c1', files }, commit: 'c2' }), 'modified');
  assert.equal(targetStatus({ onDisk: new Map([...disk, ['notes.md', 'x']]), ledger: { commit: 'c1', files }, commit: 'c2' }), 'modified');
});

test('uninstall removes only what is still exactly what Orbi installed', () => {
  const r = uninstallSplit(
    [
      { path: 'SKILL.md', sha256: 'h1' },
      { path: 'a.md', sha256: 'h2' },
      { path: 'gone.md', sha256: 'h3' },
    ],
    new Map([
      ['SKILL.md', 'h1'],
      ['a.md', 'changed'],
      ['mine.md', 'x'],
    ]),
  );
  assert.deepEqual(r.remove, ['SKILL.md']);
  assert.deepEqual(r.keep.sort(), ['a.md', 'mine.md']);
});

test('shared folders: who else sees an install, and which picks are redundant', () => {
  assert.deepEqual(alsoVisibleTo('claude'), ['cursor']);
  assert.deepEqual(alsoVisibleTo('codex'), ['cursor']);
  assert.deepEqual(alsoVisibleTo('antigravity'), []);
  assert.deepEqual(redundantTargets(['claude', 'cursor']), ['cursor']);
  assert.deepEqual(redundantTargets(['claude', 'codex']), []);
});

test('a package status in one agent sums up its folders', () => {
  assert.equal(aggregateStatus(['new', 'new']), 'new');
  assert.equal(aggregateStatus(['same', 'same']), 'same');
  assert.equal(aggregateStatus(['same', 'new']), 'update');
  assert.equal(aggregateStatus(['update', 'same']), 'update');
  assert.equal(aggregateStatus(['new', 'modified']), 'modified');
  assert.equal(aggregateStatus(['modified', 'conflict', 'new']), 'conflict');
});
