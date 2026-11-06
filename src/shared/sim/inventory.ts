import { rulesOf, type Faction, type Kit } from '../config/arsenal';
import { kitItems, type ItemKind } from '../config/kits';
import { SLOT_NEXT, SLOT_PREV } from './input';
import { createWeaponState, type WeaponState } from './weapon';

/**
 * Inventář hráče podle kitu (frakce + classa): každý slot má vlastní stav (střelné zbraně
 * mají zásobník a rezervu, granáty počet, nástroje jen časování). `p.weapon` v simulaci je
 * vždy stav aktivního slotu, takže zbytek simulace, sítě i prezentace pracuje beze změny.
 * Přepnutí respektuje tasení (equip); rozběhnuté přebíjení se zruší bez připsání nábojů
 * (nezkracuje se), hod granátu nebo použití nástroje přepnutí nedovolí, dokud neskončí.
 */
export interface InvItem {
  kind: ItemKind;
  id: string;
  slot: number;
  /** Výchozí počet (granáty) – po doplnění se vrací sem. */
  max?: number;
}

export interface Inventory {
  items: InvItem[];
  states: Record<number, WeaponState>;
  active: number;
  /** Poslední střelná zbraň (návrat po posledním granátu). */
  lastGun: number;
}

export function createInventory(faction: Faction, kit: Kit, t: number): Inventory {
  const items = kitItems(faction, kit).map((it) => ({ kind: it.kind, id: it.id, slot: it.slot, max: it.count }));
  const states: Record<number, WeaponState> = {};
  for (const it of items) {
    const ws = createWeaponState(rulesOf(it.id), t, it.id);
    if (it.max !== undefined) {
      ws.mag = it.max;
      ws.reserve = 0;
    }
    if (it.kind !== 'primary' && it.kind !== 'pistol' && it.max === undefined) ws.mag = ws.reserve = 0;
    states[it.slot] = ws;
  }
  return { items, states, active: 3, lastGun: 3 };
}

export function itemAt(inv: Inventory, slot: number) {
  return inv.items.find((i) => i.slot === slot);
}

export function activeItem(inv: Inventory) {
  return itemAt(inv, inv.active)!;
}

/** Lze slot zvolit? Spotřebované granáty ne; prázdná střelná zbraň ano (ukazuje 0). */
export function selectable(inv: Inventory, slot: number) {
  const it = itemAt(inv, slot);
  if (!it) return false;
  if (it.max !== undefined) return inv.states[slot].mag > 0;
  return true;
}

/** Požadavek ze vstupu (číslo slotu / další / předchozí) → cílový slot nebo null. */
export function resolveRequest(inv: Inventory, req: number): number | null {
  if (!req) return null;
  if (req === SLOT_NEXT || req === SLOT_PREV) {
    const slots = inv.items.map((i) => i.slot).filter((s) => selectable(inv, s));
    if (!slots.length) return null;
    const i = slots.indexOf(inv.active);
    const n = slots.length;
    return slots[((i < 0 ? 0 : i) + (req === SLOT_NEXT ? 1 : -1) + n) % n];
  }
  return selectable(inv, req) ? req : null;
}

/** Probíhá akce, kterou přepnutí nesmí přerušit (hod, použití nástroje, útok nožem). */
export function switchLocked(ws: WeaponState) {
  return ws.action === 'throw' || ws.action === 'use' || ws.action === 'attack';
}

/**
 * Přepnutí na slot (server; klient jen požaduje). Vrací true při změně. Tasení podle pravidel
 * položky; přerušený reload předchozí zbraně se zahodí (náboje se nepřipíšou).
 */
export function switchTo(inv: Inventory, slot: number, t: number): boolean {
  if (slot === inv.active || !selectable(inv, slot)) return false;
  const prev = inv.states[inv.active];
  if (switchLocked(prev)) return false;
  if (prev.action === 'reload' || prev.action === 'sprintOut' || prev.action === 'equip') prev.action = 'idle';
  prev.adsToggle = false;
  prev.adsProgress = 0;
  const it = itemAt(inv, slot)!;
  const ws = inv.states[slot];
  ws.action = 'equip';
  ws.actionStart = t;
  ws.actionEnd = t + rulesOf(it.id).equipTime;
  ws.adsToggle = false;
  ws.adsProgress = 0;
  ws.recoilPitch = ws.recoilYaw = 0;
  inv.active = slot;
  if (it.kind === 'primary' || it.kind === 'pistol') inv.lastGun = slot;
  return true;
}

/** Kompaktní pohled pro síť a UI (skutečné počty, ne odhad). */
export interface InvView {
  active: number;
  items: Array<{ slot: number; kind: ItemKind; id: string; mag: number; reserve: number; max?: number }>;
}

export function invView(inv: Inventory): InvView {
  return { active: inv.active, items: inv.items.map((i) => ({ slot: i.slot, kind: i.kind, id: i.id, mag: inv.states[i.slot].mag, reserve: inv.states[i.slot].reserve, max: i.max })) };
}

/** Stejné rozhodnutí nad síťovým pohledem (klient: co hráč požaduje, než server potvrdí). */
export function resolveView(v: InvView, req: number): number | null {
  const ok = (s: number) => {
    const it = v.items.find((i) => i.slot === s);
    return !!it && (it.max === undefined || it.mag > 0);
  };
  if (!req) return null;
  if (req === SLOT_NEXT || req === SLOT_PREV) {
    const slots = v.items.map((i) => i.slot).filter(ok);
    if (!slots.length) return null;
    const i = slots.indexOf(v.active);
    return slots[((i < 0 ? 0 : i) + (req === SLOT_NEXT ? 1 : -1) + slots.length) % slots.length];
  }
  return ok(req) ? req : null;
}
