import type { Team } from '../map/schema';
import { PF_MG, PF_PISTOL, PF_PUMP, PF_RIFLE, PF_SEMISHOT, PF_SNIPER, itemConfig, type WeaponConfig } from './weapon';

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
  /** Pevná mířidla (bez volby příslušenství): kolimátor, mechanická, puškohled se zvětšením. */
  sight: { kind: 'reddot' | 'iron' | 'scope'; zoom?: number };
}

const RD = { kind: 'reddot' } as const, IRON = { kind: 'iron' } as const;

export const ARSENAL: ArsenalEntry[] = [
  { id: 'm4a1', name: 'FC-4 Carbine', faction: 'usmc', kit: 'assault', rules: PF_RIFLE, sight: RD },
  { id: 'm16a2', name: 'FC-16 Rifle', faction: 'usmc', kit: 'medic', rules: PF_RIFLE, sight: IRON },
  { id: 'm249', name: 'FC-49 LMG', faction: 'usmc', kit: 'support', rules: PF_MG, sight: IRON },
  { id: 'r870', name: 'FC-87 Pump', faction: 'usmc', kit: 'engineer', rules: PF_PUMP, sight: IRON },
  { id: 'ak101', name: 'DL-101 Rifle', faction: 'mec', kit: 'assault', rules: PF_RIFLE, sight: RD },
  { id: 'akm', name: 'DL-62 Rifle', faction: 'mec', kit: 'medic', rules: PF_RIFLE, sight: IRON },
  { id: 'pkm', name: 'DL-61 LMG', faction: 'mec', kit: 'support', rules: PF_MG, sight: IRON },
  { id: 'saiga', name: 'DL-12 Auto', faction: 'mec', kit: 'engineer', rules: PF_SEMISHOT, sight: IRON },
  { id: 'qbz95', name: 'JP-95 Bullpup', faction: 'pla', kit: 'assault', rules: PF_RIFLE, sight: RD },
  { id: 't81', name: 'JP-81 Rifle', faction: 'pla', kit: 'medic', rules: PF_RIFLE, sight: IRON },
  { id: 'qbb95', name: 'JP-95 LMG', faction: 'pla', kit: 'support', rules: PF_MG, sight: IRON },
  { id: 'hawk97', name: 'JP-97 Pump', faction: 'pla', kit: 'engineer', rules: PF_PUMP, sight: IRON },
  { id: 'm24', name: 'FC-24 Sniper', faction: 'usmc', kit: 'sniper', rules: PF_SNIPER, sight: { kind: 'scope', zoom: 10 } },
  { id: 'svd', name: 'DL-63 Marksman', faction: 'mec', kit: 'sniper', rules: PF_SNIPER, sight: { kind: 'scope', zoom: 4 } },
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
  /**
   * Poškození pádem podle výšky pádu (m), počítané z rychlosti dopadu: do `fallSafe` bez
   * zranění, pak lineárně, od `fallLethal` smrtelný pád (vyřazení – medik může oživit). (N)
   */
  fallSafe: 3.5,
  fallLethal: 12,
} as const;

/** Poškození pádem z rychlosti dopadu (m/s) a gravitace (m/s²). */
export function fallDamage(landSpeed: number, gravity: number): number {
  const h = (landSpeed * landSpeed) / (2 * gravity);
  if (h <= PILOT.fallSafe) return 0;
  return Math.min(PILOT.maxHp, Math.round(((h - PILOT.fallSafe) / (PILOT.fallLethal - PILOT.fallSafe)) * PILOT.maxHp));
}

export const KITS: Kit[] = ['assault', 'medic', 'support', 'engineer', 'sniper'];
/**
 * Zobrazované názvy frakcí a zbraní jsou fiktivní (žádné cizí značky ani frakce jiných her).
 * Interní ID (usmc / mec / pla, m4a1 …) zůstávají kvůli uloženým datům a protokolu – hráč je nevidí.
 */
export const FACTION_LABEL: Record<Faction, string> = { usmc: 'Falcon Corps', mec: 'Dune League', pla: 'Jade Pact' };
export const KIT_LABEL: Record<Kit, string> = { assault: 'Assault', medic: 'Medic', support: 'Support', engineer: 'Engineer', sniper: 'Sniper' };

/** Výchozí frakce týmů (mapa frakce zatím neurčuje; server je může změnit volbou). */
export const DEFAULT_FACTIONS: Record<Team, Faction> = { teamA: 'usmc', teamB: 'mec' };

export function arsenalEntry(id: string | undefined | null): ArsenalEntry | undefined {
  return ARSENAL.find((w) => w.id === id);
}

/** Pistole frakcí (slot 2). */
export const SIDEARMS: Record<string, { name: string; rules: WeaponConfig }> = {
  m9: { name: 'FC-9 Pistol', rules: PF_PISTOL },
  pm: { name: 'DL-8 Pistol', rules: PF_PISTOL },
  qsz92: { name: 'JP-92 Pistol', rules: PF_PISTOL },
};

/** Tasení nestřelných položek (s). Návrh (N). */
export const ITEM_EQUIP: Record<string, number> = { knife: 0.3, frag: 0.45, smoke: 0.45, medkit: 0.5, defib: 0.6, ammo: 0.5 };
const itemRules = new Map<string, WeaponConfig>();

export function rulesOf(id: string | undefined | null): WeaponConfig {
  const a = arsenalEntry(id);
  if (a) return a.rules;
  if (id && SIDEARMS[id]) return SIDEARMS[id].rules;
  if (id && ITEM_EQUIP[id] !== undefined) {
    let r = itemRules.get(id);
    if (!r) itemRules.set(id, (r = itemConfig(id, ITEM_EQUIP[id])));
    return r;
  }
  return PF_RIFLE;
}

/** Střelná zbraň (primární nebo pistole) – simuluje ji `stepWeapon`. */
export function isGun(id: string | undefined | null) {
  return !!arsenalEntry(id) || (!!id && !!SIDEARMS[id]);
}

export function weaponFor(faction: Faction, kit: Kit): ArsenalEntry {
  return ARSENAL.find((w) => w.faction === faction && w.kit === kit) ?? ARSENAL.find((w) => w.faction === faction)!;
}

export function hasWeapon(faction: Faction, kit: Kit) {
  return ARSENAL.some((w) => w.faction === faction && w.kit === kit);
}

export const WEAPON_IDS = ARSENAL.map((w) => w.id);
