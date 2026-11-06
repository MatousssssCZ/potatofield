import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bevelBox, crossProfile, lathe, merge, plainBox, sideProfile, transform, tube, type P2 } from './meshkit';
import { PAL as C } from './types';

/**
 * Nestřelné položky kitu (vlastní programové modely, umělecký odhad tvarů):
 * nůž, tříštivý granát, dýmovnice, lékárna, defibrilátor (dvě elektrody), zásobování (brašna).
 * Souřadnice „úchopu“: počátek = střed sevřené dlaně, osa úchopu podél −Y (prsty kolem ní),
 * vpřed −Z, palec nahoru +Y. Stejné geometrie slouží pro první osobu, model na vojákovi
 * i siluetu v overlayi.
 */
export type ItemKindModel = 'knife' | 'frag' | 'smoke' | 'medkit' | 'defib' | 'ammo';

export interface ItemModel {
  metal: THREE.BufferGeometry;
  soft: THREE.BufferGeometry;
  /** Druhá ruka drží vlastní díl (elektroda defibrilátoru). */
  second?: { metal: THREE.BufferGeometry; soft: THREE.BufferGeometry };
  triangles: number;
}

const tri = (...g: Array<THREE.BufferGeometry | undefined>) => g.reduce((a, x) => a + (x ? (x.index ? x.index.count : x.getAttribute('position').count) / 3 : 0), 0);

function knife(): ItemModel {
  const metal: THREE.BufferGeometry[] = [], soft: THREE.BufferGeometry[] = [];
  // Rukojeť s kroužky (kůže) v ose úchopu, hlavice dole, záštita nahoře, čepel s hrotem nahoře.
  const rings: Array<[number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    const y = -0.055 + i * 0.011;
    rings.push([0.0125 + (i % 2 ? 0.0012 : 0), y]);
  }
  soft.push(lathe([[0, -0.056], ...rings, [0, 0.056]].map(([r, y]) => [r, y] as [number, number]), 12, '#4a3a2a').rotateX(Math.PI / 2));
  metal.push(lathe([[0, 0], [0.014, 0], [0.015, 0.006], [0.01, 0.014], [0, 0.015]], 12, C.metalDark).rotateX(-Math.PI / 2).translate(0, -0.056, 0)); // hlavice
  metal.push(bevelBox(0.016, 0.008, 0.05, 0.002, C.metalDark, [0, 0.06, -0.004])); // záštita
  const blade: P2[] = [[0.0, 0.064], [0.012, 0.064], [0.014, 0.12], [0.012, 0.19], [0.004, 0.236], [-0.006, 0.214], [-0.012, 0.19], [-0.014, 0.12], [-0.012, 0.064]];
  metal.push(sideProfile(blade.map(([z, y]) => [z, y] as P2), 0.0045, 0.0012, '#9a9d9f'));
  metal.push(sideProfile([[0.013, 0.08], [0.0135, 0.18], [0.008, 0.2], [0.0115, 0.08]], 0.005, 0.0005, '#6d7073')); // hřbet
  const m = merge(metal), s = merge(soft);
  return { metal: m, soft: s, triangles: tri(m, s) };
}

function frag(): ItemModel {
  const metal: THREE.BufferGeometry[] = [], soft: THREE.BufferGeometry[] = [];
  // Kulové tělo (olivové) v dlani, rozbuška nahoře, páka (spoon) podél zadní strany, kroužek pojistky.
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI;
    prof.push([Math.cos(a) * 0.031, Math.sin(a) * 0.033]);
  }
  soft.push(lathe(prof, 16, '#4c5338').rotateX(Math.PI / 2));
  metal.push(lathe([[0, 0], [0.012, 0], [0.012, 0.016], [0.008, 0.02], [0, 0.021]], 12, C.metalWorn).rotateX(-Math.PI / 2).translate(0, 0.03, 0));
  metal.push(sideProfile([[0.006, 0.05], [0.014, 0.05], [0.036, 0.02], [0.036, -0.03], [0.031, -0.03], [0.03, 0.016], [0.01, 0.044]], 0.012, 0.0008, C.metalWorn));
  const ring = new THREE.TorusGeometry(0.011, 0.0018, 6, 14);
  metal.push(transform(merge([ring.toNonIndexed()].map((g) => { g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(0.55), 3)); return g; })), [-0.014, 0.046, 0], [0, Math.PI / 2, 0]));
  ring.dispose();
  const m = merge(metal), s = merge(soft);
  return { metal: m, soft: s, triangles: tri(m, s) };
}

function smoke(): ItemModel {
  const metal: THREE.BufferGeometry[] = [], soft: THREE.BufferGeometry[] = [];
  // Válcová nádoba (šedozelená) s barevným pruhem, rozbuška a páka nahoře.
  soft.push(tube(0.03, -0.055, 0.055, 16, '#5d6559').rotateX(Math.PI / 2));
  soft.push(tube(0.0305, 0.03, 0.045, 16, '#cfcfc6').rotateX(Math.PI / 2)); // pruh (bílý kouř)
  metal.push(lathe([[0, 0], [0.012, 0], [0.012, 0.016], [0.008, 0.02], [0, 0.021]], 12, C.metalWorn).rotateX(-Math.PI / 2).translate(0, 0.055, 0));
  metal.push(sideProfile([[0.006, 0.075], [0.014, 0.075], [0.035, 0.05], [0.035, -0.04], [0.03, -0.04], [0.029, 0.046], [0.01, 0.07]], 0.012, 0.0008, C.metalWorn));
  for (const y of [-0.055, 0.055]) metal.push(tube(0.031, y - 0.003, y + 0.003, 16, C.metalDark).rotateX(Math.PI / 2));
  const m = merge(metal), s = merge(soft);
  return { metal: m, soft: s, triangles: tri(m, s) };
}

function medkit(): ItemModel {
  const metal: THREE.BufferGeometry[] = [], soft: THREE.BufferGeometry[] = [];
  // Měkká brašna s rukojetí nahoře (v dlani), červený kříž na boku, přezky.
  soft.push(bevelBox(0.07, 0.11, 0.17, 0.016, '#55613f', [0, -0.085, -0.02]));
  soft.push(bevelBox(0.074, 0.03, 0.172, 0.01, '#4a5537', [0, -0.03, -0.02])); // víko
  soft.push(bevelBox(0.016, 0.012, 0.09, 0.005, '#2d2d2a', [0, 0.004, -0.02])); // rukojeť
  for (const sx of [-1, 1]) {
    soft.push(plainBox(0.002, 0.05, 0.016, '#e8e4dc', [sx * 0.036, -0.085, -0.02]));
    soft.push(plainBox(0.002, 0.016, 0.05, '#e8e4dc', [sx * 0.036, -0.085, -0.02]));
    soft.push(plainBox(0.0025, 0.04, 0.012, '#b3261e', [sx * 0.0362, -0.085, -0.02]));
    soft.push(plainBox(0.0025, 0.012, 0.04, '#b3261e', [sx * 0.0362, -0.085, -0.02]));
  }
  for (const z of [-0.08, 0.04]) metal.push(bevelBox(0.078, 0.012, 0.012, 0.002, C.metalDark, [0, -0.04, z]));
  const m = merge(metal), s = merge(soft);
  return { metal: m, soft: s, triangles: tri(m, s) };
}

function paddle(): { metal: THREE.BufferGeometry; soft: THREE.BufferGeometry } {
  const metal: THREE.BufferGeometry[] = [], soft: THREE.BufferGeometry[] = [];
  // Rukojeť v ose úchopu, dole elektroda (deska) natočená dopředu, tlačítko nahoře, kabel.
  soft.push(crossProfile([[-0.014, -0.012], [0.014, -0.012], [0.016, 0.0], [0.014, 0.012], [-0.014, 0.012], [-0.016, 0.0]], 0.05, -0.05, 0.004, '#d9d6cc').rotateX(Math.PI / 2));
  soft.push(bevelBox(0.07, 0.024, 0.09, 0.008, '#e3e0d6', [0, -0.07, -0.02]));
  metal.push(bevelBox(0.064, 0.004, 0.084, 0.001, '#9a9d9f', [0, -0.083, -0.02])); // kovová elektroda
  soft.push(bevelBox(0.012, 0.008, 0.012, 0.002, '#c0392b', [0, 0.054, 0]));
  soft.push(tube(0.004, 0.0, 0.1, 6, '#2b2b2b').rotateX(-0.6).translate(0, 0.05, 0.02));
  return { metal: merge(metal), soft: merge(soft) };
}

function defib(): ItemModel {
  const a = paddle(), b = paddle();
  return { metal: a.metal, soft: a.soft, second: b, triangles: tri(a.metal, a.soft, b.metal, b.soft) };
}

function ammo(): ItemModel {
  const metal: THREE.BufferGeometry[] = [], soft: THREE.BufferGeometry[] = [];
  // Brašna se zásobníky: popruh v dlani, tělo pod ním, víko s přezkami, žlutý pruh.
  soft.push(bevelBox(0.09, 0.14, 0.2, 0.014, '#5a5a41', [0, -0.1, -0.02]));
  soft.push(bevelBox(0.094, 0.035, 0.204, 0.01, '#4d4d38', [0, -0.03, -0.02]));
  soft.push(bevelBox(0.014, 0.02, 0.07, 0.004, '#2b2a24', [0, 0.004, -0.02]));
  for (const sx of [-1, 1]) soft.push(plainBox(0.002, 0.02, 0.16, '#c9a43a', [sx * 0.046, -0.12, -0.02]));
  for (const z of [-0.09, 0.05]) metal.push(bevelBox(0.098, 0.014, 0.014, 0.002, C.metalDark, [0, -0.045, z]));
  // Vyčnívající zásobníky.
  for (const z of [-0.06, -0.02, 0.02]) metal.push(bevelBox(0.024, 0.03, 0.018, 0.003, C.magSteel, [0.02, -0.01, z]));
  const m = merge(metal), s = merge(soft);
  return { metal: m, soft: s, triangles: tri(m, s) };
}

const BUILDERS: Record<ItemKindModel, () => ItemModel> = { knife, frag, smoke, medkit, defib, ammo };

export function buildItem(kind: ItemKindModel): ItemModel {
  return BUILDERS[kind]();
}

export function isItemModel(id: string): id is ItemKindModel {
  return id in BUILDERS;
}

/** Jedna sloučená geometrie (model na vojákovi, silueta, náhled). Mezipaměť. */
const merged = new Map<string, THREE.BufferGeometry>();
export function itemGeometry(kind: ItemKindModel): THREE.BufferGeometry {
  let g = merged.get(kind);
  if (!g) {
    const m = buildItem(kind);
    const parts = [m.metal, m.soft];
    if (m.second) parts.push(m.second.metal.clone().translate(-0.09, 0, 0), m.second.soft.clone().translate(-0.09, 0, 0));
    g = mergeGeometries(parts, false)!;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    merged.set(kind, g);
  }
  return g;
}
