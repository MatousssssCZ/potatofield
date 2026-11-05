import { buildM16A2, buildM4A1 } from './ar';
import { buildAK101, buildAKM, buildType81 } from './ak';
import { buildQBB95, buildQBZ95 } from './bullpup';
import { buildM249, buildPKM } from './belt';
import type { WeaponModel } from './types';

export type Faction = 'usmc' | 'mec' | 'pla';
export type Kit = 'assault' | 'medic' | 'support' | 'engineer';

export interface WeaponDef {
  id: string;
  name: string;
  faction: Faction;
  kit: Kit;
  /** Výchozí vzhled rukou (frakce + classa). */
  hands: string;
  /** null = model zatím není hotový (v prohlížeči „čeká“, ve hře nedostupný). */
  build: ((segScale: number) => WeaponModel) | null;
}

/** Pevné sestavy podle grafického zadání: jen Assault má kolimátor. */
export const WEAPON_DEFS: WeaponDef[] = [
  { id: 'm4a1', name: 'M4A1', faction: 'usmc', kit: 'assault', hands: 'usmcAssault', build: buildM4A1 },
  { id: 'm16a2', name: 'M16A2', faction: 'usmc', kit: 'medic', hands: 'usmcMedic', build: buildM16A2 },
  { id: 'm249', name: 'M249', faction: 'usmc', kit: 'support', hands: 'usmcSupport', build: buildM249 },
  { id: 'r870', name: 'Remington 870', faction: 'usmc', kit: 'engineer', hands: 'usmcEngineer', build: null },
  { id: 'ak101', name: 'AK-101', faction: 'mec', kit: 'assault', hands: 'mecAssault', build: buildAK101 },
  { id: 'akm', name: 'AKM', faction: 'mec', kit: 'medic', hands: 'mecMedic', build: buildAKM },
  { id: 'pkm', name: 'PKM', faction: 'mec', kit: 'support', hands: 'mecSupport', build: buildPKM },
  { id: 'saiga', name: 'Saiga-12', faction: 'mec', kit: 'engineer', hands: 'mecEngineer', build: null },
  { id: 'qbz95', name: 'QBZ-95', faction: 'pla', kit: 'assault', hands: 'plaAssault', build: buildQBZ95 },
  { id: 't81', name: 'Type 81', faction: 'pla', kit: 'medic', hands: 'plaMedic', build: buildType81 },
  { id: 'qbb95', name: 'QBB-95', faction: 'pla', kit: 'support', hands: 'plaSupport', build: buildQBB95 },
  { id: 'hawk97', name: 'Hawk Type 97', faction: 'pla', kit: 'engineer', hands: 'plaEngineer', build: null },
];

export const FACTION_LABEL: Record<Faction, string> = { usmc: 'USMC', mec: 'MEC', pla: 'PLA' };
export const KIT_LABEL: Record<Kit, string> = { assault: 'Assault', medic: 'Medic', support: 'Support', engineer: 'Engineer' };

export function weaponDef(id: string): WeaponDef {
  const d = WEAPON_DEFS.find((w) => w.id === id && w.build);
  return d ?? WEAPON_DEFS[0];
}

export function readyWeapons() {
  return WEAPON_DEFS.filter((w) => w.build);
}
