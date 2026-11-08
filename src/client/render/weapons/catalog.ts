import { ARSENAL, FACTION_LABEL, KIT_LABEL, type Faction, type Kit } from '../../../shared/config/arsenal';
import { buildM16A2, buildM4A1 } from './ar';
import { buildAK101, buildAKM, buildSaiga12, buildType81 } from './ak';
import { buildQBB95, buildQBZ95 } from './bullpup';
import { buildM249, buildPKM } from './belt';
import { buildHawk97, buildR870 } from './shotgun';
import { buildM24, buildSVD } from './sniper';
import { buildM9, buildPM } from './pistol';
import type { WeaponModel } from './types';
import { BUDGET_TABLE } from './budgetTable';
import { FULL_DETAIL, withDetail } from './meshkit';
import { buildGlbWeapon, hasGlbGun } from './glbWeapon';

export type { Faction, Kit };
export { FACTION_LABEL, KIT_LABEL };

export interface WeaponDef {
  id: string;
  name: string;
  faction: Faction;
  kit: Kit;
  /** Výchozí vzhled rukou (frakce + classa). */
  hands: string;
  build: ((segScale: number) => WeaponModel) | null;
  /** false = výtvarný návrh bez ověřené reference (nesmí se vydávat za věrný model). */
  verified: boolean;
}

const BUILD: Record<string, { build: (s: number) => WeaponModel; verified?: boolean }> = {
  m4a1: { build: buildM4A1 },
  m16a2: { build: buildM16A2 },
  m249: { build: buildM249 },
  r870: { build: buildR870 },
  ak101: { build: buildAK101 },
  akm: { build: buildAKM },
  pkm: { build: buildPKM },
  saiga: { build: buildSaiga12 },
  qbz95: { build: buildQBZ95 },
  t81: { build: buildType81 },
  qbb95: { build: buildQBB95 },
  hawk97: { build: buildHawk97, verified: false },
  m24: { build: buildM24 },
  svd: { build: buildSVD },
};

/** Vizuální katalog nad sdíleným arzenálem (pravidla a frakce jsou v shared/config/arsenal). */
export const WEAPON_DEFS: WeaponDef[] = ARSENAL.map((a) => ({
  id: a.id,
  name: a.name,
  faction: a.faction,
  kit: a.kit,
  hands: `${a.faction}${a.kit[0].toUpperCase()}${a.kit.slice(1)}`,
  build: BUILD[a.id]?.build ?? null,
  verified: BUILD[a.id]?.verified ?? true,
}));

/**
 * Pistole (slot 2) – modely mimo arzenál primárních zbraní. Ruce podle nositele (předává hra);
 * rozpočet v první osobě 1 500–2 000 trojúhelníků.
 */
export const SIDEARM_DEFS: WeaponDef[] = [
  { id: 'm9', name: 'M9', faction: 'usmc', kit: 'assault', hands: 'usmcAssault', build: buildM9, verified: true },
  { id: 'pm', name: 'PM', faction: 'mec', kit: 'assault', hands: 'mecAssault', build: buildPM, verified: true },
];

export function weaponDef(id: string): WeaponDef {
  const d = WEAPON_DEFS.find((w) => w.id === id && w.build) ?? SIDEARM_DEFS.find((w) => w.id === id);
  return d ?? WEAPON_DEFS[0];
}

/** Má položka vlastní 3D model zbraně (primární nebo pistole)? */
export function hasGunModel(id: string) {
  return WEAPON_DEFS.some((w) => w.id === id && w.build) || SIDEARM_DEFS.some((w) => w.id === id);
}

/**
 * Model pro vlastní pohled v rozpočtu 3 000–3 500 trojúhelníků (bez rukou) a pro ostatní hráče
 * v rozpočtu 1 000–1 300. Stupeň detailu je předpočítaný (scripts/weapon-budget.ts).
 */
export function buildFirstPerson(id: string): WeaponModel {
  const d = weaponDef(id);
  const proc = withDetail(BUDGET_TABLE[d.id]?.fp ?? FULL_DETAIL, () => d.build!(1));
  // Model z balíčku (Flat Guns), je-li načtený; chování (přebití, optika) zůstává z procedurálního.
  return (hasGlbGun(d.id) && buildGlbWeapon(d.id, proc)) || proc;
}

export function buildWorldLod0(id: string): WeaponModel {
  const d = weaponDef(id);
  const proc = withDetail(BUDGET_TABLE[d.id]?.world ?? FULL_DETAIL, () => d.build!(1));
  return (hasGlbGun(d.id) && buildGlbWeapon(d.id, proc)) || proc;
}

export function readyWeapons() {
  return WEAPON_DEFS.filter((w) => w.build);
}
