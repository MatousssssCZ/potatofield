import type { Team } from '../map/schema';
import { PF_MG, PF_PUMP, PF_RIFLE, PF_SEMISHOT, PF_SNIPER, type WeaponConfig } from './weapon';

/**
 * Arzenál: 12 primárních zbraní ve třech frakcích a čtyřech classách (pevné sestavy).
 * Vzhled je vlastní výtvarné zpracování; herní pravidla jsou fiktivní profily PF-* (N).
 * Server ověřuje, že zvolená zbraň patří frakci hráčova týmu.
 */
export type Faction = 'usmc' | 'mec' | 'pla';
export type Kit = 'assault' | 'medic' | 'support' | 'engineer' | 'sniper';

export interface ArsenalEntry {
  id: string;
  name: string;
  faction: Faction;
  kit: Kit;
  rules: WeaponConfig;
  /** false = zbraň zatím nemá hotový model (classa je vidět, nasazení s ní server odmítne). */
  available?: boolean;
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
  { id: 'm24', name: 'M24', faction: 'usmc', kit: 'sniper', rules: PF_SNIPER, available: false },
  { id: 'svd', name: 'SVD', faction: 'mec', kit: 'sniper', rules: PF_SNIPER, available: false },
];

/**
 * Pilot (Potatofield_Pilot_Platna_Rozhodnuti – podle shrnutí v zadáních UI a postav):
 * USMC × MEC, 8 proti 8, classy Assault / Medic / Support / Sniper; Engineer a PLA mimo pilot
 * (kód zůstává, výběr je skrytý a server je odmítne).
 */
export const PILOT = {
  factions: ['usmc', 'mec'] as Faction[],
  kits: ['assault', 'medic', 'support', 'sniper'] as Kit[],
  teamSize: 8,
  maxHp: 100,
  /** Okno pro oživení po vyřazení (s) a HP po oživení. */
  downedTime: 15,
  reviveHp: 50,
  /** Oživení: medik drží E u vyřazeného spoluhráče (s, m). Návrhové hodnoty (N). */
  reviveHold: 1.0,
  reviveRange: 1.6,
  /** Vzdát pomoc: podržení klávesy (s) – jen UI, server přijme zprávu. */
  giveUpHold: 1.0,
} as const;

export const KITS: Kit[] = ['assault', 'medic', 'support', 'engineer', 'sniper'];
export const FACTION_LABEL: Record<Faction, string> = { usmc: 'USMC', mec: 'MEC', pla: 'PLA' };
export const KIT_LABEL: Record<Kit, string> = { assault: 'Assault', medic: 'Medic', support: 'Support', engineer: 'Engineer', sniper: 'Sniper' };

/** Výchozí frakce týmů (mapa frakce zatím neurčuje; server je může změnit volbou). */
export const DEFAULT_FACTIONS: Record<Team, Faction> = { teamA: 'usmc', teamB: 'mec' };

export function arsenalEntry(id: string | undefined | null): ArsenalEntry | undefined {
  return ARSENAL.find((w) => w.id === id);
}

export function rulesOf(id: string | undefined | null): WeaponConfig {
  return arsenalEntry(id)?.rules ?? PF_RIFLE;
}

export function weaponFor(faction: Faction, kit: Kit): ArsenalEntry {
  return ARSENAL.find((w) => w.faction === faction && w.kit === kit) ?? ARSENAL.find((w) => w.faction === faction)!;
}

export function hasWeapon(faction: Faction, kit: Kit) {
  return ARSENAL.some((w) => w.faction === faction && w.kit === kit);
}

export const WEAPON_IDS = ARSENAL.map((w) => w.id);
