import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EVENTS,
  HOOK_FLAG,
  hooksInstalled,
  isOrbiHandler,
  needsUpgrade,
  parseVersion,
  stripOrbi,
  versionAtLeast,
  withOrbiHooks,
  type ClaudeSettings,
} from '../src/main/bridge/hookSettings.ts';

const target = { command: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\Orbi\\Orbi.exe', args: [HOOK_FLAG] };

// A user's real-world settings: plugins, their own hook and their own statusline.
const userSettings = (): ClaudeSettings => ({
  enabledPlugins: { 'hyperframes@hyperframes': true },
  theme: 'dark',
  statusLine: { type: 'command', command: '~/.claude/my-status.sh' },
  hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx prettier --write' }] }] },
});

test('connecting adds an exec-form hook for every event and keeps the user settings', () => {
  const s = withOrbiHooks(userSettings(), target, 60);
  assert.equal(hooksInstalled(s), true);
  for (const e of EVENTS) {
    const h = s.hooks![e].flatMap((g) => g.hooks ?? []).find(isOrbiHandler)!;
    assert.equal(h.command, target.command); // no quoting: exec form, no shell
    assert.deepEqual(h.args, [HOOK_FLAG]);
    assert.equal(h.async, e === 'PermissionRequest' ? undefined : true);
  }
  assert.equal(s.hooks!.PermissionRequest[0].hooks![0].timeout, 90);
  assert.deepEqual(s.statusLine, { type: 'command', command: '~/.claude/my-status.sh' });
  assert.equal(s.hooks!.PostToolUse[0].hooks![0].command, 'npx prettier --write');
  assert.equal(s.theme, 'dark');
});

test('connecting twice does not duplicate hooks', () => {
  const twice = withOrbiHooks(withOrbiHooks(userSettings(), target, 60), target, 60);
  for (const e of EVENTS) assert.equal(twice.hooks![e].flatMap((g) => g.hooks ?? []).filter(isOrbiHandler).length, 1);
});

test('disconnecting restores exactly the original settings', () => {
  const original = userSettings();
  assert.deepEqual(stripOrbi(withOrbiHooks(original, target, 60)), original);
  assert.deepEqual(stripOrbi({}), {});
});

test('Orbi 0.1 entries (Node script + statusline) are recognised, upgraded and cleaned', () => {
  const legacyCmd = '"C:/Program Files/nodejs/node.exe" "C:/Users/x/AppData/Roaming/Orbi/bridge/orbi-hook.cjs"';
  const legacy: ClaudeSettings = { hooks: {}, statusLine: { type: 'command', command: '"node" "C:/x/orbi-statusline.cjs"' } };
  for (const e of EVENTS) legacy.hooks![e] = [{ hooks: [{ type: 'command', command: legacyCmd, async: true }] }];
  assert.equal(hooksInstalled(legacy), true);
  assert.equal(needsUpgrade(legacy, () => true), true);

  const upgraded = withOrbiHooks(legacy, target, 60);
  assert.equal(needsUpgrade(upgraded, () => true), false);
  assert.equal(upgraded.statusLine, undefined);
  assert.ok(JSON.stringify(upgraded).indexOf('orbi-hook.cjs') === -1);
});

test('a hook pointing to a deleted Orbi executable needs an upgrade', () => {
  const s = withOrbiHooks({}, target, 60);
  assert.equal(needsUpgrade(s, () => true), false);
  assert.equal(needsUpgrade(s, () => false), true);
});

test('Claude Code version gate for exec-form hooks (2.1.139+)', () => {
  assert.deepEqual(parseVersion('2.1.295 (Claude Code)'), [2, 1, 295]);
  assert.equal(versionAtLeast([2, 1, 295], [2, 1, 139]), true);
  assert.equal(versionAtLeast([2, 1, 139], [2, 1, 139]), true);
  assert.equal(versionAtLeast([2, 1, 138], [2, 1, 139]), false);
  assert.equal(versionAtLeast([2, 0, 999], [2, 1, 139]), false);
  assert.equal(versionAtLeast([3, 0, 0], [2, 1, 139]), true);
  assert.equal(parseVersion('not a version'), null);
});
