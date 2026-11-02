import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AGY_EVENTS,
  AGY_HOOK_KEY,
  antigravityHooksInstalled,
  buildAgyHookCommand,
  needsAntigravityUpgrade,
  stripAntigravityOrbi,
  withAntigravityHooks,
  type AntigravityHooksDoc,
} from '../src/main/bridge/antigravityHookSettings.ts';
import { parseHubFile } from '../src/main/integrations/antigravityTranscript.ts';
import {
  applyAntigravityTranscriptLine,
  cleanAntigravityArg,
  cleanUserPrompt,
  createAgyTracker,
  describeAntigravityTool,
} from '../src/main/integrations/antigravityTranscript.ts';

const installedTarget = {
  command: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\orbi-desktop\\Orbi.exe',
  args: [],
};

const devTarget = {
  command: 'C:\\Users\\Administrator\\Desktop\\orbi\\node_modules\\electron\\dist\\electron.exe',
  args: ['C:\\Users\\Administrator\\Desktop\\orbi'],
};

const existingUserHooks = (): AntigravityHooksDoc => ({
  'lint-checker': {
    PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: './scripts/lint.sh' }] }],
  },
});

test('Antigravity hooks: connecting adds named "orbi" lifecycle hooks and preserves user hooks', () => {
  const doc = withAntigravityHooks(existingUserHooks(), installedTarget);
  assert.equal(antigravityHooksInstalled(doc), true);
  assert.deepEqual(doc['lint-checker'], existingUserHooks()['lint-checker']);

  const orbi = doc[AGY_HOOK_KEY] as Record<string, { command: string }[]>;
  for (const e of AGY_EVENTS) {
    assert.equal(orbi[e].length, 1);
    assert.ok(orbi[e][0].command.endsWith(`--orbi-agy-hook=${e}`));
    assert.ok(orbi[e][0].command.startsWith('"C:\\Users\\Ana Maria\\'));
  }
});

test('Antigravity hooks: paths without spaces stay unquoted; disconnect restores original file', () => {
  const cmd = buildAgyHookCommand(devTarget, 'Stop');
  assert.equal(cmd.includes('"'), false);
  assert.ok(cmd.endsWith('--orbi-agy-hook=Stop'));

  const original = existingUserHooks();
  assert.deepEqual(stripAntigravityOrbi(withAntigravityHooks(original, devTarget)), original);
});

test('Antigravity hooks: moving Orbi from dev to installed exe triggers automatic upgrade', () => {
  const devDoc = withAntigravityHooks(existingUserHooks(), devTarget);
  assert.equal(needsAntigravityUpgrade(devDoc, devTarget), false);
  assert.equal(needsAntigravityUpgrade(devDoc, installedTarget), true);

  const upgraded = withAntigravityHooks(devDoc, installedTarget);
  assert.equal(needsAntigravityUpgrade(upgraded, installedTarget), false);
  assert.equal(needsAntigravityUpgrade({}, installedTarget), false);
});

test('Antigravity transcript: unwraps JSON-stringified tool args from real transcript.jsonl', () => {
  assert.equal(cleanAntigravityArg('"\\"Run agy --help\\""'), 'Run agy --help');
  assert.equal(cleanAntigravityArg('npm test'), 'npm test');

  const d = describeAntigravityTool('run_command', {
    CommandLine: '"& \\"$HOME\\\\.gemini\\\\bin\\\\agy.exe\\" --help"',
    toolSummary: '"Run agy --help"',
  });
  assert.equal(d.label, 'Run agy --help');
  assert.equal(d.code, '& "$HOME\\.gemini\\bin\\agy.exe" --help');

  const edit = describeAntigravityTool('edit_file', {
    Path: '"C:\\\\Users\\\\Administrator\\\\Desktop\\\\orbi\\\\src\\\\main\\\\hub.ts"',
    Target: '"a\\nb"',
    Replacement: '"a\\nb\\nc"',
  });
  assert.equal(edit.label, 'Editando hub.ts');
  assert.equal(edit.code, '+3 −2');
  assert.equal(edit.filePath, 'C:\\Users\\Administrator\\Desktop\\orbi\\src\\main\\hub.ts');
});

test('Antigravity transcript: tracks start, parallel tool steps, errors, questions and completion', () => {
  const tracker = createAgyTracker('4f47dc7a-cc6e-4858-83da-f416fbc7f88f', 1000);

  // 1. User prompt wrapped in <USER_REQUEST>
  const start = applyAntigravityTranscriptLine(tracker, {
    step_index: 0,
    source: 'USER_EXPLICIT',
    type: 'USER_INPUT',
    status: 'DONE',
    created_at: '2026-11-02T17:57:15Z',
    content: '<USER_REQUEST>\ncheca o porque que ele nao esta conectando\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>',
  });
  assert.equal(cleanUserPrompt('<USER_REQUEST>\noi\n</USER_REQUEST>'), 'oi');
  assert.equal(start.event, 'start');
  assert.equal(start.detail, 'checa o porque que ele nao esta conectando');
  assert.equal(tracker.state, 'working');
  assert.equal(tracker.current, 'Pensando…');

  // 2. Planner calls read_file + run_command in parallel
  const plan = applyAntigravityTranscriptLine(tracker, {
    step_index: 1,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: '2026-11-02T17:57:16Z',
    tool_calls: [
      { name: 'read_file', args: { Path: '"C:\\\\Users\\\\Administrator\\\\Desktop\\\\orbi\\\\README.md"' } },
      { name: 'run_command', args: { CommandLine: '"npm test"', toolSummary: '"Run unit tests"' } },
    ],
  });
  assert.equal(tracker.state, 'working');
  assert.equal(tracker.current, 'Run unit tests');
  assert.equal(tracker.currentCode, 'npm test');
  assert.deepEqual(plan.touchedPaths, ['C:\\Users\\Administrator\\Desktop\\orbi\\README.md']);

  // 3. First tool completes, second tool fails
  applyAntigravityTranscriptLine(tracker, { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE' });
  assert.equal(tracker.steps, 1);
  assert.deepEqual(tracker.lastStep, { label: 'Lendo README.md', ok: true });
  assert.equal(tracker.current, 'Run unit tests');

  applyAntigravityTranscriptLine(tracker, { step_index: 3, source: 'MODEL', type: 'GENERIC', status: 'ERROR' });
  assert.equal(tracker.steps, 2);
  assert.deepEqual(tracker.lastStep, { label: 'Run unit tests falhou', ok: false });
  assert.equal(tracker.current, 'Analisando resultado');

  // 4. Final response without tool_calls marks done with first-sentence summary
  const finish = applyAntigravityTranscriptLine(tracker, {
    step_index: 4,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: '2026-11-02T17:58:00Z',
    content: 'O motivo é que o **Antigravity atualizou para a versão 2.0**. Detalhes extras aqui.',
  });
  assert.equal(finish.event, 'done');
  assert.equal(tracker.state, 'done');
  assert.equal(tracker.current, 'Concluído');
  assert.equal(tracker.summary, 'O motivo é que o Antigravity atualizou para a versão 2.0.');
});


test('Antigravity 2.0 hub file: ports and CSRF token of the agy daemon', () => {
  const ok = parseHubFile('{"pid":21252,"httpsPort":59839,"httpPort":59837,"lsVersion":"2.28.2","csrfToken":"abc-123"}');
  assert.deepEqual(ok, { pid: 21252, httpPort: 59837, httpsPort: 59839, csrf: 'abc-123' });
  assert.equal(parseHubFile('{"pid":1,"httpPort":"x","csrfToken":"t"}'), null);
  assert.equal(parseHubFile('{"pid":1,"httpPort":5,"httpsPort":6}'), null, 'no token, no call');
  assert.equal(parseHubFile('not json'), null);
});
