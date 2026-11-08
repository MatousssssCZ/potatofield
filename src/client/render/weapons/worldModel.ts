import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SIDEARM_DEFS, buildWorldLod0 } from './catalog';
import { isItemModel, itemGeometry } from './items';
import { WEAPON_BUDGET } from './budget';
import { arsenalEntry } from '../../../shared/config/arsenal';

/**
 * Světové modely zbraní pro vzdálené postavy: stejný generátor jako v první osobě v rozpočtu
 * v nižším rozlišení oblouků (LOD0) a dvě odvozené siluety (LOD1 z řezů podél hlavně,
 * LOD2 z obalových kvádrů dílů). Bez rukou, bez skla a tečky kolimátoru.
 */
export interface WorldWeapon {
  lods: [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry];
  triangles: [number, number, number];
  muzzle: THREE.Vector3;
  /** Úchopy pro IK paží vzdáleného vojáka a šachta pro přebití (prostor zbraně). */
  gripRight: THREE.Vector3;
  gripLeft: THREE.Vector3;
  magazineSocket: THREE.Vector3;
  /** Zadní konec pažby (z) – opření o rameno. */
  stockZ: number;
  hold: 'rifle' | 'pistol' | 'item';
  /** Styl držení dlouhé zbraně: kulomet u boku, odstřelovačka hlavní dolů, brokovnice, puška. */
  style: HoldStyle;
}

export type HoldStyle = 'rifle' | 'heavy' | 'sniper' | 'shotgun';

/** Styl držení podle role zbraně v arzenálu (Support = kulomet, Sniper, Engineer = brokovnice). */
export function holdStyleOf(id: string): HoldStyle {
  const kit = arsenalEntry(id)?.kit;
  return kit === 'support' ? 'heavy' : kit === 'sniper' ? 'sniper' : kit === 'engineer' ? 'shotgun' : 'rifle';
}

const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/** Krabice s barvou vrcholů (kompatibilní atributy se sloučenými díly). */
function colorBox(min: THREE.Vector3, max: THREE.Vector3, color: THREE.Color) {
  const g = new THREE.BoxGeometry(Math.max(1e-3, max.x - min.x), Math.max(1e-3, max.y - min.y), Math.max(1e-3, max.z - min.z)).toNonIndexed();
  g.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Siluetu dílu tvoří kvádry z řezů podél osy Z (průměrná barva řezu). */
function slices(g: THREE.BufferGeometry, n: number) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const out: THREE.BufferGeometry[] = [];
  const len = bb.max.z - bb.min.z;
  const mins = Array.from({ length: n }, () => new THREE.Vector3(Infinity, Infinity, Infinity));
  const maxs = Array.from({ length: n }, () => new THREE.Vector3(-Infinity, -Infinity, -Infinity));
  const cs = Array.from({ length: n }, () => ({ c: new THREE.Color(0, 0, 0), k: 0 }));
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const s = Math.min(n - 1, Math.max(0, Math.floor(((v.z - bb.min.z) / Math.max(1e-6, len)) * n)));
    mins[s].min(v);
    maxs[s].max(v);
    if (col) {
      cs[s].c.r += col.getX(i);
      cs[s].c.g += col.getY(i);
      cs[s].c.b += col.getZ(i);
      cs[s].k++;
    }
  }
  for (let s = 0; s < n; s++) {
    if (!isFinite(mins[s].x)) continue;
    const c = cs[s].k ? cs[s].c.multiplyScalar(1 / cs[s].k) : new THREE.Color('#333333');
    out.push(colorBox(mins[s], maxs[s], c));
  }
  return out;
}

const cache = new Map<string, WorldWeapon>();

export function worldWeapon(id: string, quality: 'low' | 'standard' | 'high'): WorldWeapon {
  const key = `${id}:${quality}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (isItemModel(id)) {
    // Nestřelná položka v ruce: jedna geometrie (malá), vzdálené LOD jen obalové kvádry.
    const g0 = itemGeometry(id).clone();
    const far = mergeGeometries(slices(g0, 1), false)!;
    const w: WorldWeapon = { lods: [g0, far, far.clone()], triangles: [tri(g0), tri(far), tri(far)], muzzle: new THREE.Vector3(0, 0.1, -0.05), gripRight: new THREE.Vector3(), gripLeft: new THREE.Vector3(id === 'defib' ? -0.09 : -0.03, -0.02, 0.02), magazineSocket: new THREE.Vector3(), stockZ: 0.05, hold: 'item', style: 'rifle' };
    cache.set(key, w);
    return w;
  }
  void quality; // rozpočet world modelu je pevný (1 000–1 300 / 200–300 trojúhelníků)
  const m = buildWorldLod0(id);
  // Díly v klidové poloze (pohyblivé díly posunuté na svůj pivot). Volný náboj brokovnice se nezobrazuje.
  const parts: THREE.BufferGeometry[] = [m.static.metal, m.static.polymer];
  const mv = m.moving;
  const placed = (p: { geometry: THREE.BufferGeometry; pivot: THREE.Vector3 } | undefined) => {
    if (!p) return;
    const g = p.geometry.clone();
    g.translate(p.pivot.x, p.pivot.y, p.pivot.z);
    parts.push(g);
  };
  if (m.reloadStyle !== 'single') placed(mv.magazine);
  placed(mv.chargingHandle);
  placed(mv.feedCover);
  placed(mv.pump);
  for (const p of [mv.magazine, mv.chargingHandle, mv.feedCover, mv.pump]) p?.geometry.dispose();
  m.optic?.glass.dispose();
  const lod0 = mergeGeometries(parts, false)!;
  // Vzdálená varianta: nejvíc řezů, které se vejdou do 200–300 trojúhelníků.
  let lod1: THREE.BufferGeometry | null = null;
  for (let n = 16; n >= 1; n--) {
    const g = mergeGeometries(parts.flatMap((p) => slices(p, n)), false)!;
    if (tri(g) <= WEAPON_BUDGET.worldFar.max) {
      lod1 = g;
      break;
    }
    g.dispose();
  }
  lod1 ??= mergeGeometries(parts.flatMap((p) => slices(p, 1)), false)!;
  const lod2 = mergeGeometries(parts.flatMap((g) => slices(g, 1)), false)!;
  for (const g of parts) g.dispose();
  for (const g of [lod0, lod1, lod2]) g.computeBoundingSphere();
  lod0.computeBoundingBox();
  const w: WorldWeapon = {
    lods: [lod0, lod1, lod2],
    triangles: [tri(lod0), tri(lod1), tri(lod2)],
    muzzle: m.points.muzzle.clone(),
    gripRight: m.points.gripRight.clone(),
    gripLeft: (m.points.pumpGrip ?? m.points.gripLeft).clone(),
    magazineSocket: m.points.magazineSocket.clone(),
    stockZ: lod0.boundingBox!.max.z,
    hold: SIDEARM_DEFS.some((d) => d.id === id) ? 'pistol' : 'rifle',
    style: holdStyleOf(id),
  };
  cache.set(key, w);
  return w;
}

/** Přepnutí LOD (m): do 25 m model 1 000–1 300 trojúhelníků, do 120 m vzdálená varianta 200–300, dál jen obrys. */
export const WORLD_LOD = [25, 120] as const;

export function disposeWorldWeapons() {
  for (const w of cache.values()) for (const g of w.lods) g.dispose();
  cache.clear();
}
