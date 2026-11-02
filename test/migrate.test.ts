import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateState } from '../src/main/migrate.ts';

const v1 = {
  version: 1,
  settings: { alwaysOnTop: false, mascotStyle: '3d' },
  pet: { satiety: 40, energy: 50, mood: 60, sleeping: false, updatedAt: 1, bornAt: 1 },
  window: { cx: 500, y: 20, docked: false },
  view: 'pet',
  githubTokenEnc: 'abc',
  bridgeToken: 'tok',
  usage: { claude: { tool: 'claude', observedAt: 5, source: 'x' } },
};

test('v1 with a pet becomes v2 without it, everything else kept', () => {
  const r = migrateState(v1);
  assert.ok(r);
  assert.equal(r.hadPet, true);
  assert.equal(r.state.version, 2);
  assert.equal('pet' in r.state, false);
  assert.deepEqual(r.state.settings, v1.settings);
  assert.deepEqual(r.state.window, v1.window);
  assert.equal(r.state.githubTokenEnc, 'abc');
  assert.equal(r.state.bridgeToken, 'tok');
  assert.deepEqual(r.state.usage, v1.usage);
});

test('v1 without a pet reports hadPet false', () => {
  const { pet: _pet, ...noPet } = v1;
  assert.equal(migrateState(noPet)?.hadPet, false);
});

test('a file with no version is treated as v1', () => {
  const { version: _v, ...old } = v1;
  const r = migrateState(old);
  assert.equal(r?.state.version, 2);
  assert.equal(r?.hadPet, true);
});

test('v2 passes through unchanged', () => {
  const v2 = { version: 2, settings: {}, window: { docked: true }, bridgeToken: 't' };
  const r = migrateState(v2);
  assert.deepEqual(r?.state, v2);
  assert.equal(r?.hadPet, false);
});

test('anything that is not an object is rejected', () => {
  assert.equal(migrateState(null), null);
  assert.equal(migrateState(3), null);
  assert.equal(migrateState([1, 2]), null);
  assert.equal(migrateState('x'), null);
});
