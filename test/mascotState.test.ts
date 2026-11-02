import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReplace, resolveCondition, resolveLook, type ConditionInput } from '../src/renderer/src/mascot/state.ts';

const now = 1_000_000;
const base: ConditionInput = { now, permissions: 0, sessions: [], usage: [], idle: 'active' };
const working = (current: string) => ({ state: 'working' as const, updatedAt: now - 1000, current });

test('a pending permission outranks everything else', () => {
  const c = resolveCondition({ ...base, permissions: 1, sessions: [working('Edit a.ts'), { state: 'error', updatedAt: now }], idle: 'asleep' });
  assert.equal(c, 'permission');
});

test('a recent error outranks work, an old one does not', () => {
  assert.equal(resolveCondition({ ...base, sessions: [{ state: 'error', updatedAt: now - 10_000 }, working('Edit a.ts')] }), 'error');
  assert.equal(resolveCondition({ ...base, sessions: [{ state: 'error', updatedAt: now - 120_000 }, working('Edit a.ts')] }), 'running');
});

test('thinking and running are told apart by what the agent is doing', () => {
  assert.equal(resolveCondition({ ...base, sessions: [working('Pensando…')] }), 'thinking');
  assert.equal(resolveCondition({ ...base, sessions: [working('Analisando resultado')] }), 'thinking');
  assert.equal(resolveCondition({ ...base, sessions: [working('Bash npm test')] }), 'running');
});

test('stale working sessions do not count', () => {
  assert.equal(resolveCondition({ ...base, sessions: [{ state: 'working', updatedAt: now - 5 * 60_000, current: 'x' }] }), 'idle');
});

test('a plan window at 100% that has not reset means rate limited', () => {
  const full = { tool: 'claude' as const, fiveHour: { usedPercent: 100, resetsAt: now + 60_000 } };
  const reset = { tool: 'claude' as const, fiveHour: { usedPercent: 100, resetsAt: now - 1 } };
  const oneModel = { tool: 'antigravity' as const, fiveHour: { usedPercent: 100, resetsAt: now + 60_000 } };
  assert.equal(resolveCondition({ ...base, usage: [oneModel] }), 'idle', 'one Antigravity model at 100% is not a rate limit');
  assert.equal(resolveCondition({ ...base, usage: [full] }), 'ratelimit');
  assert.equal(resolveCondition({ ...base, usage: [reset] }), 'idle');
});

test('agent work keeps Orbi awake even when the user is away', () => {
  assert.equal(resolveCondition({ ...base, idle: 'asleep', sessions: [working('Edit a.ts')] }), 'running');
  assert.equal(resolveCondition({ ...base, idle: 'asleep' }), 'asleep');
  assert.equal(resolveCondition({ ...base, idle: 'drowsy' }), 'drowsy');
});

test('a decorative reaction never cuts an important one short', () => {
  const done = { kind: 'done' as const, until: now + 2000 };
  assert.equal(canReplace(done, 'boop', now), false);
  assert.equal(canReplace(done, 'error', now), true);
  assert.equal(canReplace(done, 'boop', now + 2001), true);
  assert.equal(canReplace(null, 'boop', now), true);
  assert.equal(canReplace({ kind: 'boop', until: now + 500 }, 'boop', now), true);
});

test('the permission badge and glow survive any reaction', () => {
  const l = resolveLook('permission', 'pet', false);
  assert.equal(l.expression, 'love');
  assert.equal(l.badge, 'alert');
  assert.equal(l.glow, 'amber');
});

test('without a reaction the condition decides the look', () => {
  assert.deepEqual(
    { ...resolveLook('asleep', null, false) },
    { expression: 'asleep', badge: null, glow: null, particles: 'zzz', sleeping: true, working: false },
  );
  assert.equal(resolveLook('running', null, false).expression, 'focused');
  assert.equal(resolveLook('running', null, true).expression, 'curious');
  assert.equal(resolveLook('idle', null, true).expression, 'curious');
  assert.equal(resolveLook('error', null, false).badge, 'error');
  assert.equal(resolveLook('idle', 'done', false).glow, 'green');
});
