import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codexPatchTarget } from '../src/main/integrations/codexPatch.ts';

test('the file and first added lines of an apply_patch inside an exec call', () => {
  const input = 'text(await tools.apply_patch("*** Begin Patch\\n*** Add File: work/brain_server.py\\n+\\"\\"\\"AI Brain.\\"\\"\\"\\n+import os\\n*** End Patch"))';
  assert.deepEqual(codexPatchTarget(input), { file: 'work/brain_server.py', hint: '"""AI Brain."""\nimport os' });
});

test('an update keeps only the first run of added lines', () => {
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n const x = 1;\n-const y = 2;\n+const y = 3;\n+const z = 4;\n context\n+later\n*** End Patch';
  assert.deepEqual(codexPatchTarget(patch), { file: 'src/a.ts', hint: 'const y = 3;\nconst z = 4;' });
});

test('a delete has a file and no hint; anything else is ignored', () => {
  assert.deepEqual(codexPatchTarget('*** Delete File: old.txt\n'), { file: 'old.txt', hint: undefined });
  assert.equal(codexPatchTarget('await tools.exec_command({cmd: "ls"})'), null);
  assert.equal(codexPatchTarget(undefined), null);
});
