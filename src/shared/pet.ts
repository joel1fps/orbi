import type { PetState } from './types';

/**
 * Orbi's needs, all on a 0–100 scale where 100 is "well cared for".
 * Rates are per hour of real time and also apply while the app is closed
 * (capped), so Orbi feels like it lives on without punishing a weekend away.
 */
const HOUR = 3_600_000;
const OFFLINE_CAP_H = 36;

export const RATES = {
  satietyAwake: -9,
  satietyAsleep: -4,
  energyAwake: -7,
  energyAsleep: +32,
  moodBase: -5,
  moodAsleep: -1,
  moodHungry: -6,
  moodTired: -4,
} as const;

export type PetAction = 'feed' | 'play' | 'rest' | 'pet';

export type PetOutcome =
  | 'ok'
  | 'full' // refused food
  | 'tired' // too tired to play
  | 'hungry' // too hungry to play
  | 'asleep' // action needs Orbi awake
  | 'woke' // rest toggled off
  | 'slept'; // rest toggled on

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function createPet(now: number): PetState {
  return { satiety: 80, energy: 85, mood: 75, sleeping: false, updatedAt: now, bornAt: now };
}

/** Advance the needs to `now`. Pure. */
export function tick(pet: PetState, now: number): PetState {
  const elapsedH = Math.min(Math.max(0, now - pet.updatedAt) / HOUR, OFFLINE_CAP_H);
  if (elapsedH <= 0) return pet;

  let { satiety, energy, mood, sleeping } = pet;
  // Integrate in small steps so thresholds (hunger, auto-wake) apply mid-way.
  const steps = Math.max(1, Math.ceil(elapsedH * 12));
  const dt = elapsedH / steps;
  for (let i = 0; i < steps; i++) {
    satiety += (sleeping ? RATES.satietyAsleep : RATES.satietyAwake) * dt;
    energy += (sleeping ? RATES.energyAsleep : RATES.energyAwake) * dt;
    let moodRate = sleeping ? RATES.moodAsleep : RATES.moodBase;
    if (satiety < 30) moodRate += RATES.moodHungry;
    if (energy < 20 && !sleeping) moodRate += RATES.moodTired;
    mood += moodRate * dt;
    satiety = clamp(satiety);
    energy = clamp(energy);
    mood = clamp(mood);
    if (sleeping && energy >= 100) sleeping = false; // wakes up rested
  }
  return { ...pet, satiety, energy, mood, sleeping, updatedAt: now };
}

export function act(pet: PetState, action: PetAction, now: number): { pet: PetState; outcome: PetOutcome } {
  const p = tick(pet, now);
  switch (action) {
    case 'feed': {
      if (p.sleeping) return { pet: p, outcome: 'asleep' };
      if (p.satiety >= 95) return { pet: p, outcome: 'full' };
      return {
        pet: { ...p, satiety: clamp(p.satiety + 28), mood: clamp(p.mood + 4), energy: clamp(p.energy + 2) },
        outcome: 'ok',
      };
    }
    case 'play': {
      if (p.sleeping) return { pet: p, outcome: 'asleep' };
      if (p.energy < 15) return { pet: p, outcome: 'tired' };
      if (p.satiety < 10) return { pet: p, outcome: 'hungry' };
      return {
        pet: { ...p, energy: clamp(p.energy - 14), satiety: clamp(p.satiety - 6), mood: clamp(p.mood + 16) },
        outcome: 'ok',
      };
    }
    case 'rest':
      return p.sleeping
        ? { pet: { ...p, sleeping: false }, outcome: 'woke' }
        : { pet: { ...p, sleeping: true }, outcome: 'slept' };
    case 'pet': {
      // Rapid petting still counts, just less: affection has diminishing returns.
      const recent = p.lastPettedAt !== undefined && now - p.lastPettedAt < 2500;
      const gain = p.sleeping ? 2 : recent ? 1.5 : 6;
      return { pet: { ...p, mood: clamp(p.mood + gain), lastPettedAt: now }, outcome: 'ok' };
    }
  }
}

export type NeedLevel = 'great' | 'ok' | 'low' | 'critical';

export function level(value: number): NeedLevel {
  if (value >= 70) return 'great';
  if (value >= 40) return 'ok';
  if (value >= 20) return 'low';
  return 'critical';
}

const WORDS = {
  satiety: { great: 'Satisfeito', ok: 'Beliscaria algo', low: 'Com fome', critical: 'Faminto' },
  energy: { great: 'Cheio de energia', ok: 'Disposto', low: 'Cansado', critical: 'Exausto' },
  mood: { great: 'Feliz', ok: 'Tranquilo', low: 'Meio para baixo', critical: 'Triste' },
} as const;

export function needWord(need: keyof typeof WORDS, value: number): string {
  return WORDS[need][level(value)];
}

/** One line that sums up how Orbi is doing, most urgent need first. */
export function headline(p: PetState): string {
  if (p.sleeping) return 'Orbi está dormindo';
  if (p.satiety < 20) return 'Orbi está com fome';
  if (p.energy < 20) return 'Orbi está exausto';
  if (p.mood < 25) return 'Orbi precisa de atenção';
  if (p.satiety < 40) return 'Orbi beliscaria algo';
  if (p.energy < 40) return 'Orbi está ficando cansado';
  if (p.mood >= 80) return 'Orbi está radiante';
  return 'Orbi está tranquilo';
}

export function ageLabel(p: PetState, now: number): string {
  const days = Math.floor((now - p.bornAt) / (24 * HOUR));
  if (days <= 0) return 'Nasceu hoje';
  if (days === 1) return '1 dia com você';
  return `${days} dias com você`;
}
