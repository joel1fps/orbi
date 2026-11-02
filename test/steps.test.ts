import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendStep, focusLines, stepKind } from '../src/shared/steps.ts';

test('step kinds come from the labels every integration already produces', () => {
  assert.equal(stepKind('Lendo invoice.ts'), 'read');
  assert.equal(stepKind('Editando invoice.ts'), 'edit');
  assert.equal(stepKind('Escrevendo types.ts'), 'edit');
  assert.equal(stepKind('Escrevendo resposta'), 'think');
  assert.equal(stepKind('Pensando…'), 'think');
  assert.equal(stepKind('Analisando resultado'), 'think');
  assert.equal(stepKind('Executando comando'), 'bash');
  assert.equal(stepKind('Rodar os testes', 'npm test'), 'bash');
  assert.equal(stepKind('Buscando no código'), 'search');
  assert.equal(stepKind('Pesquisando na web'), 'web');
  assert.equal(stepKind('Concluído'), 'done');
  assert.equal(stepKind('Parou com erro'), 'error');
  assert.equal(stepKind('Organizando tarefas'), 'other');
});

test('the trail keeps the last 12 steps and skips repeats', () => {
  let trail = appendStep([], { kind: 'read', label: 'Lendo a.ts', at: 1 });
  trail = appendStep(trail, { kind: 'read', label: 'Lendo a.ts', at: 2 });
  assert.equal(trail.length, 1);
  for (let i = 0; i < 20; i++) trail = appendStep(trail, { kind: 'bash', label: `passo ${i}`, at: 10 + i });
  assert.equal(trail.length, 12);
  assert.equal(trail.at(-1)?.label, 'passo 19');
});

test('the code view centres on the edited text', () => {
  const text = Array.from({ length: 40 }, (_, i) => `linha ${i + 1}`).join('\n');
  const v = focusLines(text, 'linha 20\nlinha 21', 4);
  assert.deepEqual(v.highlight, [20, 21]);
  assert.equal(v.start, 16);
  assert.equal(v.lines.length, 10);
  assert.equal(v.lines[0], 'linha 16');
  const top = focusLines(text, undefined, 4);
  assert.equal(top.start, 1);
  assert.deepEqual(top.highlight, []);
  assert.deepEqual(focusLines(text, 'não existe', 4).highlight, []);
});
