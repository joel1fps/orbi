import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubRepoOf, isNewRepoName, parseStatus, repoNameFor, secretInText, secretPathReason, stateOf } from '../src/main/integrations/localLogic.ts';

test('git status v2: branch, ahead/behind and every kind of change', () => {
  const raw = [
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/a file.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R100 novo.ts',
    'velho.ts',
    '? notas.md',
    '',
  ].join('\0');
  const s = parseStatus(raw);
  assert.equal(s.branch, 'main');
  assert.equal(s.upstream, 'origin/main');
  assert.equal(s.ahead, 2);
  assert.equal(s.behind, 1);
  assert.deepEqual(s.files, [
    { status: '.M', path: 'src/a file.ts' },
    { status: 'R.', path: 'novo.ts' },
    { status: '??', path: 'notas.md' },
  ]);
  assert.equal(parseStatus('# branch.head (detached)\0').branch, undefined);
});

test('which GitHub repository a remote points to', () => {
  assert.equal(githubRepoOf('https://github.com/joel1fps/orbi.git'), 'joel1fps/orbi');
  assert.equal(githubRepoOf('https://joel1fps@github.com/joel1fps/orbi'), 'joel1fps/orbi');
  assert.equal(githubRepoOf('git@github.com:joel1fps/orbi.git'), 'joel1fps/orbi');
  assert.equal(githubRepoOf('ssh://git@github.com/joel1fps/orbi.git'), 'joel1fps/orbi');
  assert.equal(githubRepoOf('https://gitlab.com/a/b.git'), null);
  assert.equal(githubRepoOf(''), null);
});

test('state of a project card', () => {
  assert.equal(stateOf({ git: false, changes: 0, ahead: 0, behind: 0 }), 'not-git');
  assert.equal(stateOf({ git: true, repo: null, changes: 3, ahead: 0, behind: 0 }), 'no-remote');
  assert.equal(stateOf({ git: true, repo: 'a/b', changes: 0, ahead: 0, behind: 2 }), 'behind');
  assert.equal(stateOf({ git: true, repo: 'a/b', changes: 1, ahead: 1, behind: 0 }), 'changes');
  assert.equal(stateOf({ git: true, repo: 'a/b', changes: 0, ahead: 1, behind: 0 }), 'ahead');
  assert.equal(stateOf({ git: true, repo: 'a/b', changes: 0, ahead: 0, behind: 0 }), 'clean');
});

test('secret files and secrets inside files never go up', () => {
  assert.ok(secretPathReason('.env'));
  assert.ok(secretPathReason('api/.env.local'));
  assert.equal(secretPathReason('.env.example'), null);
  assert.ok(secretPathReason('certs/server.pem'));
  assert.ok(secretPathReason('home/.ssh/id_ed25519'));
  assert.ok(secretPathReason('config/credentials.json'));
  assert.equal(secretPathReason('src/environment.ts'), null);
  assert.ok(secretInText(`const t = "ghp_${'a'.repeat(36)}";`));
  assert.ok(secretInText('-----BEGIN OPENSSH PRIVATE KEY-----\nabc'));
  assert.ok(secretInText('AWS=AKIAABCDEFGHIJKLMNOP'));
  assert.ok(secretInText(`key: sk-ant-${'x'.repeat(30)}`));
  assert.equal(secretInText('const sk = "skip"; // AKIA but short'), null);
});

test('repository names', () => {
  assert.equal(repoNameFor('Meu Projeto (1)'), 'Meu-Projeto-1');
  assert.equal(repoNameFor('...'), 'projeto');
  assert.equal(isNewRepoName('orbi'), true);
  assert.equal(isNewRepoName('a b'), false);
  assert.equal(isNewRepoName('x.git'), false);
});
