/**
 * Brings a raw orbi-state.json up to the current version. Pure (no Electron),
 * so it is unit-tested. Version 2 dropped the Tamagotchi (`pet`): the caller
 * keeps a one-off backup of the original file when `hadPet` is true.
 */
export interface MigratedState {
  version: 2;
  [key: string]: unknown;
}

export function migrateState(raw: unknown): { state: MigratedState; hadPet: boolean } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version === 2) return { state: obj as MigratedState, hadPet: false };
  const { pet, version: _version, ...rest } = obj;
  return { state: { ...rest, version: 2 }, hadPet: pet !== undefined };
}
