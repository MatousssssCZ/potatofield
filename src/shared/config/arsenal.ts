import type { Team } from '../map/schema';
import { PF_MG, PF_PUMP, PF_RIFLE, PF_SEMISHOT, type WeaponConfig } from './weapon';

/**
 * Arzenál: 12 primárních zbraní ve třech frakcích a čtyřech classách (pevné sestavy).
 * Vzhled je vlastní výtvarné zpracování; herní pravidla jsou fiktivní profily PF-* (N).
 * Server ověřuje, že zvolená zbraň patří frakci hráčova týmu.
 */
export type Faction = 'usmc' | 'mec' | 'pla';
export type Kit = 'assault' | 'medic' | 'support' | 'engineer';

export interface ArsenalEntry {
  id: string;
  name: string;
  faction: Faction;
  kit: Kit;
  rules: WeaponConfig;
}

export const ARSENAL: ArsenalEntry[] = [
  { id: 'm4a1', name: 'M4A1', faction: 'usmc', kit: 'assault', rules: PF_RIFLE },
  { id: 'm16a2', name: 'M16A2', faction: 'usmc', kit: 'medic', rules: PF_RIFLE },
  { id: 'm249', name: 'M249', faction: 'usmc', kit: 'support', rules: PF_MG },
  { id: 'r870', name: 'Remington 870', faction: 'usmc', kit: 'engineer', rules: PF_PUMP },
  { id: 'ak101', name: 'AK-101', faction: 'mec', kit: 'assault', rules: PF_RIFLE },
  { id: 'akm', name: 'AKM', faction: 'mec', kit: 'medic', rules: PF_RIFLE },
  { id: 'pkm', name: 'PKM', faction: 'mec', kit: 'support', rules: PF_MG },
  { id: 'saiga', name: 'Saiga-12', faction: 'mec', kit: 'engineer', rules: PF_SEMISHOT },
  { id: 'qbz95', name: 'QBZ-95', faction: 'pla', kit: 'assault', rules: PF_RIFLE },
  { id: 't81', name: 'Type 81', faction: 'pla', kit: 'medic', rules: PF_RIFLE },
  { id: 'qbb95', name: 'QBB-95', faction: 'pla', kit: 'support', rules: PF_MG },
  { id: 'hawk97', name: 'Hawk Type 97 (návrh)', faction: 'pla', kit: 'engineer', rules: PF_PUMP },
];

export const KITS: Kit[] = ['assault', 'medic', 'support', 'engineer'];
export const FACTION_LABEL: Record<Faction, string> = { usmc: 'USMC', mec: 'MEC', pla: 'PLA' };
export const KIT_LABEL: Record<Kit, string> = { assault: 'Assault', medic: 'Medic', support: 'Support', engineer: 'Engineer' };

/** Výchozí frakce týmů (mapa frakce zatím neurčuje; server je může změnit volbou). */
export const DEFAULT_FACTIONS: Record<Team, Faction> = { teamA: 'usmc', teamB: 'mec' };

export function arsenalEntry(id: string | undefined | null): ArsenalEntry | undefined {
  return ARSENAL.find((w) => w.id === id);
}

export function rulesOf(id: string | undefined | null): WeaponConfig {
  return arsenalEntry(id)?.rules ?? PF_RIFLE;
}

export function weaponFor(faction: Faction, kit: Kit): ArsenalEntry {
  return ARSENAL.find((w) => w.faction === faction && w.kit === kit)!;
}

export const WEAPON_IDS = ARSENAL.map((w) => w.id);
