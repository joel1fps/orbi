import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createPet, headline, needWord, tick } from '../src/shared/pet.ts';

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 18, 12);

test('needs decay over real time while awake', () => {
  const p = tick(createPet(t0), t0 + 2 * H);
  assert.ok(Math.abs(p.satiety - (80 - 18)) < 0.01);
  assert.ok(Math.abs(p.energy - (85 - 14)) < 0.01);
  assert.ok(p.mood < 75);
});

test('sleeping recharges energy and wakes Orbi up when full', () => {
  let p = act({ ...createPet(t0), energy: 20 }, 'rest', t0).pet;
  assert.equal(p.sleeping, true);
  p = tick(p, t0 + 1 * H);
  assert.ok(Math.abs(p.energy - 52) < 0.01);
  assert.equal(p.sleeping, true);
  p = tick(p, t0 + 3 * H);
  assert.equal(p.sleeping, false); // woke up rested at 100, then a little awake time
  assert.ok(p.energy > 90);
});

test('offline time is capped so a long absence never empties everything at once', () => {
  const p = tick(createPet(t0), t0 + 30 * 24 * H);
  const capped = tick(createPet(t0), t0 + 36 * H);
  assert.deepEqual({ ...p, updatedAt: 0 }, { ...capped, updatedAt: 0 });
});

test('feeding raises satiety, a full Orbi refuses food', () => {
  const hungry = { ...createPet(t0), satiety: 30 };
  const fed = act(hungry, 'feed', t0);
  assert.equal(fed.outcome, 'ok');
  assert.equal(fed.pet.satiety, 58);
  const full = act({ ...createPet(t0), satiety: 97 }, 'feed', t0);
  assert.equal(full.outcome, 'full');
  assert.equal(full.pet.satiety, 97);
});

test('play costs energy and needs a minimum of it', () => {
  const ok = act(createPet(t0), 'play', t0);
  assert.equal(ok.outcome, 'ok');
  assert.equal(ok.pet.energy, 85 - 14);
  assert.equal(ok.pet.mood, 75 + 16);
  assert.equal(act({ ...createPet(t0), energy: 10 }, 'play', t0).outcome, 'tired');
  assert.equal(act({ ...createPet(t0), satiety: 5 }, 'play', t0).outcome, 'hungry');
});

test('actions that need Orbi awake are refused while sleeping', () => {
  const asleep = { ...createPet(t0), sleeping: true };
  assert.equal(act(asleep, 'feed', t0).outcome, 'asleep');
  assert.equal(act(asleep, 'play', t0).outcome, 'asleep');
  assert.equal(act(asleep, 'rest', t0).outcome, 'woke');
});

test('petting has diminishing returns when spammed', () => {
  const first = act({ ...createPet(t0), mood: 50 }, 'pet', t0).pet;
  assert.equal(first.mood, 56);
  const second = act(first, 'pet', t0 + 500).pet;
  assert.ok(Math.abs(second.mood - 57.5) < 0.01); // tiny decay over 0.5 s
  const later = act(second, 'pet', t0 + 10_000).pet;
  assert.ok(later.mood > 57.5 + 5);
});

test('stats stay within 0..100', () => {
  let p = { ...createPet(t0), mood: 99 };
  for (let i = 0; i < 10; i++) p = act(p, 'play', t0).pet;
  assert.ok(p.mood <= 100 && p.energy >= 0 && p.satiety >= 0);
});

test('headline reports the most urgent need', () => {
  assert.equal(headline({ ...createPet(t0), satiety: 10, energy: 10 }), 'Orbi está com fome');
  assert.equal(headline({ ...createPet(t0), sleeping: true, satiety: 10 }), 'Orbi está dormindo');
  assert.equal(needWord('energy', 15), 'Exausto');
});
