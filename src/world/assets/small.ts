import { rng } from '../../shared/math';
import type { Part } from '../parts';
import { registerAsset, type Params } from '../registry';
import { facade, fbox, openingFrame, wallWithOpenings, type Opening, type Side } from './kit';

/**
 * Malé přístupné stavby: skutečné otvory dveří (≥ 1,0 × 2,1 m) a oken, stěny s tloušťkou,
 * střela projde otvorem, ne stěnou. Dveře bez otevírací mechaniky.
 */
const n = (p: Params, k: string) => p[k] as number;

const ENTRY_OPTIONS = [
  { value: 'front', label: 'Čelní' },
  { value: 'side', label: 'Boční' },
  { value: 'back', label: 'Zadní' },
  { value: 'frontSide', label: 'Čelní + boční' },
];

function entrySides(v: string): Side[] {
  return v === 'front' ? ['front'] : v === 'side' ? ['right'] : v === 'back' ? ['back'] : ['front', 'right'];
}

export interface RoomSpec {
  W: number;
  D: number;
  H: number;
  t: number;
  wall: string;
  trim: string;
  doors: Side[];
  windows: Partial<Record<Side, Array<{ u: number; w: number; bottom: number; top: number }>>>;
  doorW: number;
  doorH: number;
}

export function room(s: RoomSpec): Part[] {
  const parts: Part[] = [];
  // Vnější rozměr W×D; stěny jdou dovnitř o tloušťku t.
  for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
    const f = facade(side, s.W, s.D);
    const along = side === 'front' || side === 'back';
    const len = along ? s.W : s.D - 2 * s.t; // boční stěny mezi čely (bez zdvojených rohů)
    const ops: Opening[] = [];
    if (s.doors.includes(side)) ops.push({ u: 0, width: s.doorW, bottom: 0, top: s.doorH });
    for (const w of s.windows[side] ?? []) ops.push({ u: w.u, width: w.w, bottom: w.bottom, top: w.top });
    parts.push(...wallWithOpenings(f, len, s.H, s.t, ops, s.wall));
    for (const o of ops) parts.push(...openingFrame(f, o, s.t, s.trim, o.bottom > 0.05));
  }
  // Podlaha (mírně nad terénem) a střešní deska s kolizí.
  parts.push({ shape: 'box', pos: [0, 0.04, 0], size: [s.W - 0.02, 0.08, s.D - 0.02], material: 'concreteLight', collide: true });
  return parts;
}

registerAsset({
  assetId: 'small.house',
  label: 'Malý domek (přístupný)',
  category: 'buildings',
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'depth' },
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 3, max: 7, step: 0.5, unit: 'm', default: 4.5 },
    { key: 'depth', label: 'Hloubka', type: 'number', min: 3, max: 7, step: 0.5, unit: 'm', default: 4 },
    { key: 'entry', label: 'Vstup', type: 'enum', default: 'front', options: ENTRY_OPTIONS },
    { key: 'flatRoof', label: 'Plochá pochozí střecha', type: 'bool', default: true },
  ],
  materials: ['plasterWarm', 'plaster', 'plasterWhite', 'plasterOchre', 'brick', 'sandstone'],
  defaultMaterial: 'plasterOchre',
  describe: (p) => `vnitřek ${(n(p, 'width') - 0.5).toFixed(1)} × ${(n(p, 'depth') - 0.5).toFixed(1)} m, dveře 1,0 × 2,1 m`,
  generate(p, seed, material) {
    const W = n(p, 'width'), D = n(p, 'depth'), H = 2.8, t = 0.25;
    const doors = entrySides(p.entry as string);
    const win = { w: 1.0, bottom: 0.95, top: 2.05 };
    const windows: RoomSpec['windows'] = {};
    for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
      const len = side === 'front' || side === 'back' ? W : D - 2 * t;
      windows[side] = doors.includes(side) ? (len > 4 ? [{ u: len / 2 - 0.9, ...win }] : []) : [{ u: 0, ...win }];
    }
    const parts = room({ W, D, H, t, wall: material, trim: 'sandstone', doors, windows, doorW: 1.05, doorH: 2.15 });
    const roofT = 0.22;
    parts.push({ shape: 'box', pos: [0, H + roofT / 2, 0], size: [W + 0.3, roofT, D + 0.3], material: 'concreteLight', collide: true });
    if (p.flatRoof) {
      for (const [x, z, sx, sz] of [
        [0, -D / 2 - 0.05, W + 0.3, 0.2],
        [0, D / 2 + 0.05, W + 0.3, 0.2],
        [-W / 2 - 0.05, 0, 0.2, D + 0.1],
        [W / 2 + 0.05, 0, 0.2, D + 0.1],
      ] as const)
        parts.push({ shape: 'box', pos: [x, H + roofT + 0.3, z], size: [sx, 0.6, sz], material, collide: true });
    }
    // Vnitřní vybavení: stůl a polička (čitelný interiér bez vlastních světel).
    const r = rng(seed);
    parts.push({ shape: 'box', pos: [-W / 2 + 0.75, 0.4, D / 2 - 0.7], size: [1.0, 0.06, 0.7], material: 'wood', collide: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [-W / 2 + 0.75 + sx * 0.42, 0.2, D / 2 - 0.7 + sz * 0.28], size: [0.05, 0.4, 0.05], material: 'woodDark' });
    if (r() > 0.4) parts.push({ shape: 'box', pos: [W / 2 - 0.5, 0.45, D / 2 - 0.5], size: [0.6, 0.9, 0.6], material: 'wood', collide: true });
    return parts;
  },
});

registerAsset({
  assetId: 'small.bunker',
  label: 'Bunkr',
  category: 'buildings',
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'depth' },
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 3.5, max: 8, step: 0.5, unit: 'm', default: 5 },
    { key: 'depth', label: 'Hloubka', type: 'number', min: 3, max: 6, step: 0.5, unit: 'm', default: 4 },
    { key: 'entry', label: 'Vstup', type: 'enum', default: 'back', options: ENTRY_OPTIONS },
  ],
  materials: ['concrete', 'concreteLight'],
  defaultMaterial: 'concrete',
  describe: () => 'střílna 2,4 × 0,35 m ve výšce 1,1 m',
  generate(p, _seed, material) {
    const W = n(p, 'width'), D = n(p, 'depth'), H = 2.3, t = 0.5;
    const doors = entrySides(p.entry as string).filter((s) => s !== 'front');
    if (!doors.length) doors.push('back');
    const windows: RoomSpec['windows'] = { front: [{ u: 0, w: Math.min(2.4, W - 1.6), bottom: 1.1, top: 1.45 }] };
    const parts = room({ W, D, H, t, wall: material, trim: 'concreteDark', doors, windows, doorW: 1.05, doorH: 2.12 });
    parts.push({ shape: 'box', pos: [0, H + 0.25, 0], size: [W + 0.4, 0.5, D + 0.4], material, collide: true });
    // Zkosená hrana střechy a pytle s pískem na střeše.
    parts.push({ shape: 'box', pos: [0, H + 0.55, -D / 2 + 0.3], size: [W + 0.2, 0.12, 0.6], material: 'concreteDark' });
    for (let i = 0; i < Math.floor(W / 0.6); i++) {
      parts.push({ shape: 'box', pos: [-W / 2 + 0.3 + i * 0.6, H + 0.6, -D / 2], rot: [0, (i % 3) * 0.05, 0], size: [0.56, 0.18, 0.34], material: 'fabricSand' });
    }
    return parts;
  },
});

registerAsset({
  assetId: 'small.booth',
  label: 'Strážní budka',
  category: 'buildings',
  generatorVersion: 1,
  params: [{ key: 'entry', label: 'Vstup', type: 'enum', default: 'back', options: ENTRY_OPTIONS }],
  materials: ['paintedMetal', 'plasterWhite', 'concreteLight', 'wood'],
  defaultMaterial: 'plasterWhite',
  generate(p, _seed, material) {
    const W = 2.2, D = 2.2, H = 2.5, t = 0.12;
    const doors = entrySides(p.entry as string);
    const windows: RoomSpec['windows'] = {};
    for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
      if (!doors.includes(side)) windows[side] = [{ u: 0, w: 1.2, bottom: 1.05, top: 2.05 }];
    }
    const parts = room({ W, D, H, t, wall: material, trim: 'paintedMetal', doors, windows, doorW: 1.0, doorH: 2.1 });
    parts.push({ shape: 'wedge', pos: [0, H + 0.2, 0], rot: [0, Math.PI, 0], size: [W + 0.5, 0.25, D + 0.5], material: 'metalSheet', collide: true });
    parts.push({ shape: 'box', pos: [0, H + 0.04, 0], size: [W + 0.5, 0.08, D + 0.5], material: 'paintedMetal', collide: true });
    const f = facade('front', W, D);
    parts.push(fbox(f, 0, 2.3, 0.04, [0.4, 0.2, 0.08], 'lamp'));
    return parts;
  },
});
