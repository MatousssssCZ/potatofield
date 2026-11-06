import { weaponFor, type Faction, type Kit } from './arsenal';

/**
 * Sestavy kitů (frakce + classa): pevná výbava bez odemykání. Společné: nůž, pistole, primární
 * zbraň; další položky podle classy. Počty jsou návrhové hodnoty (N) pro Potatofield, ne údaje BF2.
 * Sloty: 1 nůž, 2 pistole, 3 primární, 4 tříštivý granát (má-li ho kit), 5+ ostatní v pořadí dat.
 */
export type ItemKind = 'knife' | 'pistol' | 'primary' | 'frag' | 'smoke' | 'medkit' | 'defib' | 'ammo';

export interface KitItem {
  kind: ItemKind;
  /** ID položky: zbraně z arzenálu / pistole (m9, pm), jinak druh. */
  id: string;
  name: string;
  /** Počet kusů (granáty); u nástrojů bez spotřeby chybí. */
  count?: number;
  slot: number;
}

export const PISTOLS: Record<Faction, { id: string; name: string }> = {
  usmc: { id: 'm9', name: 'M9' },
  mec: { id: 'pm', name: 'PM' },
  pla: { id: 'qsz92', name: 'QSZ-92' },
};

const ITEM_NAMES: Record<Exclude<ItemKind, 'primary' | 'pistol'>, string> = {
  knife: 'Nůž',
  frag: 'Tříštivý granát',
  smoke: 'Dýmovnice',
  medkit: 'Lékárna',
  defib: 'Defibrilátor',
  ammo: 'Zásobování',
};

/** Classa → výbava navíc (pořadí = pořadí slotů od 5). Granáty: Assault více než Medic. */
const EXTRAS: Record<Kit, Array<{ kind: ItemKind; count?: number }>> = {
  assault: [{ kind: 'frag', count: 4 }, { kind: 'smoke', count: 2 }],
  medic: [{ kind: 'frag', count: 2 }, { kind: 'medkit' }, { kind: 'defib' }],
  support: [{ kind: 'frag', count: 2 }, { kind: 'ammo' }],
  sniper: [{ kind: 'frag', count: 1 }],
  engineer: [{ kind: 'frag', count: 2 }],
};

export function kitItems(faction: Faction, kit: Kit): KitItem[] {
  const prim = weaponFor(faction, kit);
  const pis = PISTOLS[faction];
  const items: KitItem[] = [
    { kind: 'knife', id: 'knife', name: ITEM_NAMES.knife, slot: 1 },
    { kind: 'pistol', id: pis.id, name: pis.name, slot: 2 },
    { kind: 'primary', id: prim.id, name: prim.name, slot: 3 },
  ];
  let next = 5;
  for (const x of EXTRAS[kit]) {
    const name = ITEM_NAMES[x.kind as keyof typeof ITEM_NAMES];
    items.push({ kind: x.kind, id: x.kind, name, count: x.count, slot: x.kind === 'frag' ? 4 : next++ });
  }
  return items.sort((a, b) => a.slot - b.slot);
}

/** Kit podle primární zbraně (server zná zbraň hráče). */
export function kitOfWeapon(faction: Faction, weaponId: string): Kit | null {
  for (const k of ['assault', 'medic', 'support', 'sniper', 'engineer'] as Kit[]) if (weaponFor(faction, k).id === weaponId) return k;
  return null;
}
