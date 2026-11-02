import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODEX_HOOK_FLAG,
  codexCommand,
  codexHooksInstalled,
  codexPermissionSummary,
  stripCodexOrbi,
  withCodexHooks,
} from '../src/main/bridge/codexHookSettings.ts';

test('command line: plain paths unquoted, a lone path with spaces quoted, anything else refused', () => {
  assert.equal(codexCommand({ command: 'C:\\Apps\\Orbi.exe', args: [] }), `C:\\Apps\\Orbi.exe ${CODEX_HOOK_FLAG}`);
  assert.equal(codexCommand({ command: 'C:\\Program Files\\Orbi\\Orbi.exe', args: [] }), `"C:\\Program Files\\Orbi\\Orbi.exe" ${CODEX_HOOK_FLAG}`);
  assert.equal(codexCommand({ command: 'C:\\dev\\electron.exe', args: ['C:\\dev\\orbi'] }), `C:\\dev\\electron.exe C:\\dev\\orbi ${CODEX_HOOK_FLAG}`);
  // Two quoted words would be mangled by cmd /C.
  assert.equal(codexCommand({ command: 'C:\\my dev\\electron.exe', args: ['C:\\my dev\\orbi'] }), null);
});

const cmd = `C:\\Apps\\Orbi.exe ${CODEX_HOOK_FLAG}`;
const theirs = { hooks: [{ type: 'command', command: 'python3 guard.py', timeout: 5 }] };

test('install adds one PermissionRequest group and keeps everything else', () => {
  const before = { other: true, hooks: { PreToolUse: [theirs], PermissionRequest: [theirs] } };
  const after = withCodexHooks(before, cmd, 150);
  assert.equal(after.other, true);
  assert.deepEqual(after.hooks?.PreToolUse, [theirs]);
  assert.equal(after.hooks?.PermissionRequest?.length, 2);
  const mine = after.hooks?.PermissionRequest?.[1].hooks?.[0];
  assert.equal(mine?.command, cmd);
  assert.equal(mine?.timeout, 150);
  assert.ok(typeof mine?.statusMessage === 'string');
  assert.equal(codexHooksInstalled(after), true);
  assert.equal(codexHooksInstalled(before), false);
});

test('install is idempotent and uninstall removes exactly what Orbi added', () => {
  const once = withCodexHooks({}, cmd, 150);
  assert.deepEqual(withCodexHooks(once, cmd, 150), once);
  assert.deepEqual(stripCodexOrbi(once), {});
  const mixed = withCodexHooks({ hooks: { PermissionRequest: [theirs] } }, cmd, 150);
  assert.deepEqual(stripCodexOrbi(mixed), { hooks: { PermissionRequest: [theirs] } });
});

test('a file of an unexpected shape is refused, not overwritten', () => {
  assert.throws(() => withCodexHooks({ hooks: [] } as never, cmd, 150));
  assert.throws(() => withCodexHooks({ hooks: { PermissionRequest: {} } } as never, cmd, 150));
});

test('the permission card shows the actual command', () => {
  assert.equal(codexPermissionSummary('shell', { command: ['git', 'push', 'origin', 'main'] }), 'git push origin main');
  assert.equal(codexPermissionSummary('shell', { command: ['bash', '-lc', 'npm test && npm run build'] }), 'npm test && npm run build');
  assert.equal(codexPermissionSummary('shell', { command: ['powershell.exe', '-Command', 'Remove-Item x'] }), 'Remove-Item x');
  assert.equal(codexPermissionSummary('shell', { command: ['C:\\Windows\\System32\\cmd.exe', '/c', 'dir'] }), 'dir');
  assert.equal(codexPermissionSummary('exec_command', { cmd: 'rm -rf dist' }), 'rm -rf dist');
  assert.equal(codexPermissionSummary('apply_patch', { input: '*** Begin Patch\n*** Update File: src/a.ts\n' }), 'Editar src/a.ts');
  assert.equal(codexPermissionSummary('mystery', { a: 1 }), 'mystery {"a":1}');
  assert.equal(codexPermissionSummary('shell', undefined), 'shell');
});
