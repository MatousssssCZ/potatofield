import { rng } from '../../shared/math';
import type { Part } from '../parts';
import { registerAsset, type Params } from '../registry';
import { FOLLOW_PARAM, slopeBox } from './kit';

const n = (p: Params, k: string) => p[k] as number;
const b = (p: Params, k: string) => p[k] as boolean;

/** Pravidlo plotu: počet polí = ⌈délka / max. rozteč⌉, sloupky = pole + 1, rovnoměrná rozteč. */
export function fenceLayout(length: number, maxSpacing: number) {
  const panels = Math.max(1, Math.ceil(length / maxSpacing - 1e-9));
  return { panels, posts: panels + 1, spacing: length / panels };
}

registerAsset({
  assetId: 'struct.fence',
  label: 'Plot',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { x: 'length', y: 'height' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 1, max: 60, step: 0.5, unit: 'm', default: 10 },
    { key: 'height', label: 'Výška', type: 'number', min: 0.6, max: 4, step: 0.1, unit: 'm', default: 1.8 },
    {
      key: 'fill',
      label: 'Výplň',
      type: 'enum',
      default: 'mesh',
      options: [
        { value: 'mesh', label: 'Pletivo' },
        { value: 'planks', label: 'Prkna' },
        { value: 'sheet', label: 'Plech' },
        { value: 'bars', label: 'Tyče' },
      ],
    },
    { key: 'maxSpacing', label: 'Max. rozteč sloupků', type: 'number', min: 1, max: 5, step: 0.25, unit: 'm', default: 2 },
    { key: 'startPost', label: 'Sloupek na začátku', type: 'bool', default: true },
    { key: 'endPost', label: 'Sloupek na konci', type: 'bool', default: true },
    FOLLOW_PARAM,
  ],
  usesTerrain: (p) => b(p, 'follow'),
  materials: ['paintedMetal', 'metal', 'wood'],
  defaultMaterial: 'metal',
  describe(p) {
    const l = fenceLayout(n(p, 'length'), n(p, 'maxSpacing'));
    return `${l.panels} polí, ${l.posts} sloupků po ${l.spacing.toFixed(2)} m`;
  },
  generate(p, seed, material, ctx) {
    const L = n(p, 'length'), H = n(p, 'height');
    const fill = p.fill as string;
    const { panels, spacing } = fenceLayout(L, n(p, 'maxSpacing'));
    const parts: Part[] = [];
    const postW = 0.08;
    // Výška terénu pod osou plotu (0 = rovina nebo vypnuté kopírování).
    const g = (x: number) => (b(p, 'follow') ? ctx.ground(x, 0) : 0);
    const gs = Array.from({ length: panels + 1 }, (_, i) => g(i * spacing));
    const flat = gs.every((v) => Math.abs(v - gs[0]) < 0.01);
    // Plot vede od x = 0 do x = L (koncové body jsou na ose X → snadné napojování).
    for (let i = 0; i <= panels; i++) {
      if (i === 0 && !b(p, 'startPost')) continue;
      if (i === panels && !b(p, 'endPost')) continue;
      parts.push({ shape: 'box', pos: [i * spacing, gs[i] + H / 2 + 0.05, 0], size: [postW, H + 0.1, postW], material, collide: true });
    }
    const r = rng(seed);
    for (let i = 0; i < panels; i++) {
      const x0 = i * spacing, x1 = x0 + spacing, g0 = gs[i], g1 = gs[i + 1];
      const cx = (x0 + x1) / 2, w = spacing - postW;
      const at = (x: number) => g0 + ((x - x0) / spacing) * (g1 - g0);
      // Vodorovný prvek panelu (latě, pletivo): šikmo podél terénu.
      const rail = (y: number, h: number, t: number, z: number, mat: string, extra: Partial<Part> = {}) =>
        slopeBox(x0 + postW / 2, at(x0 + postW / 2) + y - h / 2, x1 - postW / 2, at(x1 - postW / 2) + y - h / 2, 0, h, t, z, mat, extra);
      if (fill === 'mesh') {
        parts.push(rail(H - 0.03, 0.04, 0.04, 0, 'metal'));
        parts.push(rail(0.08, 0.03, 0.03, 0, 'metal'));
        parts.push(rail(H / 2 + 0.03, H - 0.1, 0.01, 0, 'chainLink', { castShadow: false }));
      } else if (fill === 'planks') {
        const count = Math.max(2, Math.round(w / 0.16));
        for (let k = 0; k < count; k++) {
          const x = cx - w / 2 + (k + 0.5) * (w / count);
          const h = H * (0.94 + r() * 0.06);
          parts.push({ shape: 'box', pos: [x, at(x) + h / 2 + 0.02, 0.03], size: [w / count - 0.015, h, 0.025], material: 'wood' });
        }
        parts.push(rail(H * 0.25, 0.08, 0.035, -0.01, 'woodDark'));
        parts.push(rail(H * 0.78, 0.08, 0.035, -0.01, 'woodDark'));
      } else if (fill === 'sheet') {
        parts.push(rail(H / 2 + 0.02, H - 0.04, 0.02, 0.02, r() > 0.5 ? 'metalSheet' : 'metalSheetRust'));
      } else {
        const count = Math.max(2, Math.round(w / 0.13));
        for (let k = 0; k < count; k++) {
          const x = cx - w / 2 + (k + 0.5) * (w / count);
          parts.push({ shape: 'box', pos: [x, at(x) + H / 2, 0], size: [0.02, H - 0.1, 0.02], material });
        }
        parts.push(rail(H - 0.08, 0.04, 0.04, 0, material));
        parts.push(rail(0.12, 0.04, 0.04, 0, material));
      }
    }
    // Kolize: na rovině jeden kvádr přes celou délku, ve svahu po polích. Pletivo a tyče propustí střely.
    const moveOnly = fill === 'mesh' || fill === 'bars';
    if (flat) parts.push({ shape: 'box', pos: [L / 2, gs[0] + H / 2, 0], size: [L, H, 0.06], material, collide: true, render: false, moveOnly });
    else for (let i = 0; i < panels; i++) parts.push(slopeBox(i * spacing, gs[i], (i + 1) * spacing, gs[i + 1], 0.1, H, 0.06, 0, material, { collide: true, render: false, moveOnly }));
    return parts;
  },
});

registerAsset({
  assetId: 'struct.wall',
  label: 'Betonová zeď',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { x: 'length', y: 'height' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 1, max: 60, step: 0.5, unit: 'm', default: 8 },
    { key: 'height', label: 'Výška', type: 'number', min: 0.5, max: 5, step: 0.1, unit: 'm', default: 2.4 },
    { key: 'thickness', label: 'Tloušťka', type: 'number', min: 0.15, max: 0.6, step: 0.05, unit: 'm', default: 0.25 },
    { key: 'segment', label: 'Délka segmentu', type: 'number', min: 1, max: 4, step: 0.25, unit: 'm', default: 2 },
    FOLLOW_PARAM,
  ],
  usesTerrain: (p) => b(p, 'follow'),
  materials: ['concrete', 'concreteLight', 'plaster', 'plasterWarm', 'brick', 'sandstone'],
  defaultMaterial: 'concrete',
  describe(p) {
    const l = fenceLayout(n(p, 'length'), n(p, 'segment'));
    return `${l.panels} segmentů po ${l.spacing.toFixed(2)} m`;
  },
  generate(p, _seed, material, ctx) {
    const L = n(p, 'length'), H = n(p, 'height'), T = n(p, 'thickness');
    const { panels, spacing } = fenceLayout(L, n(p, 'segment'));
    const g = (x: number) => (b(p, 'follow') ? ctx.ground(x, 0) : 0);
    const gs = Array.from({ length: panels + 1 }, (_, i) => g(i * spacing));
    const flat = gs.every((v) => Math.abs(v - gs[0]) < 0.01);
    const parts: Part[] = [];
    if (flat) {
      const y = gs[0];
      parts.push({ shape: 'box', pos: [L / 2, y + H / 2, 0], size: [L, H, T], material, collide: true });
      for (let i = 1; i < panels; i++) parts.push({ shape: 'box', pos: [i * spacing, y + H / 2, 0], size: [0.05, H - 0.02, T + 0.012], material: 'concreteDark' });
      parts.push({ shape: 'box', pos: [L / 2, y + H + 0.04, 0], size: [L + 0.06, 0.08, T + 0.08], material: 'concreteLight', collide: true });
      parts.push({ shape: 'box', pos: [L / 2, y + 0.1, 0], size: [L + 0.02, 0.2, T + 0.06], material: 'concreteDark' });
    } else {
      // Ve svahu: segmenty šikmo podél terénu, pata 0,4 m pod zem (žádné mezery pod zdí).
      for (let i = 0; i < panels; i++) {
        const x0 = i * spacing, x1 = x0 + spacing, g0 = gs[i], g1 = gs[i + 1];
        parts.push(slopeBox(x0, g0, x1, g1, 0.4, H, T, 0, material, { collide: true }));
        parts.push(slopeBox(x0, g0 + H, x1, g1 + H, 0, 0.08, T + 0.08, 0, 'concreteLight', { collide: true }));
        parts.push(slopeBox(x0, g0, x1, g1, 0.2, 0.2, T + 0.06, 0, 'concreteDark'));
        if (i > 0) parts.push({ shape: 'box', pos: [x0, g0 + H / 2 - 0.2, 0], size: [0.05, H + 0.36, T + 0.012], material: 'concreteDark' });
      }
    }
    for (const [x, y] of [[0, gs[0]], [L, gs[panels]]]) parts.push({ shape: 'box', pos: [x, y + H / 2 - 0.2, 0], size: [0.3, H + 0.42, T + 0.1], material, collide: true });
    return parts;
  },
});

registerAsset({
  assetId: 'struct.lowWall',
  label: 'Nízká zídka',
  category: 'cover',
  generatorVersion: 1,
  sizeParams: { x: 'length', y: 'height' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 0.5, max: 30, step: 0.25, unit: 'm', default: 3 },
    { key: 'height', label: 'Výška', type: 'number', min: 0.3, max: 1.4, step: 0.05, unit: 'm', default: 0.9 },
    FOLLOW_PARAM,
  ],
  usesTerrain: (p) => b(p, 'follow'),
  materials: ['brick', 'sandstone', 'concrete', 'plasterWarm'],
  defaultMaterial: 'sandstone',
  generate(p, _seed, material, ctx) {
    const L = n(p, 'length'), H = n(p, 'height');
    const k = Math.max(1, Math.ceil(L / 2));
    const g = (x: number) => (b(p, 'follow') ? ctx.ground(x, 0) : 0);
    const parts: Part[] = [];
    for (let i = 0; i < k; i++) {
      const x0 = -L / 2 + (i / k) * L, x1 = -L / 2 + ((i + 1) / k) * L, g0 = g(x0), g1 = g(x1);
      const below = Math.abs(g1 - g0) > 0.01 ? 0.3 : 0;
      parts.push(slopeBox(x0, g0, x1, g1, below, H, 0.35, 0, material, { collide: true }));
      parts.push(slopeBox(x0 - (i === 0 ? 0.03 : 0), g0 + H, x1 + (i === k - 1 ? 0.03 : 0), g1 + H, 0, 0.06, 0.42, 0, 'concreteLight', { collide: true }));
    }
    return parts;
  },
});

registerAsset({
  assetId: 'struct.stairs',
  label: 'Schodiště',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { x: 'width', y: 'height', z: 'length' },
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 0.8, max: 6, step: 0.1, unit: 'm', default: 1.4 },
    { key: 'height', label: 'Celková výška', type: 'number', min: 0.3, max: 12, step: 0.1, unit: 'm', default: 3 },
    { key: 'length', label: 'Délka', type: 'number', min: 0.5, max: 24, step: 0.1, unit: 'm', default: 4.5 },
    { key: 'railing', label: 'Zábradlí', type: 'enum', default: 'both', options: [
      { value: 'none', label: 'Bez' },
      { value: 'left', label: 'Vlevo' },
      { value: 'right', label: 'Vpravo' },
      { value: 'both', label: 'Obě strany' },
    ] },
    { key: 'solid', label: 'Plná podstava', type: 'bool', default: true },
  ],
  materials: ['concrete', 'concreteLight', 'sandstone', 'metal'],
  defaultMaterial: 'concreteLight',
  describe(p) {
    const h = n(p, 'height'), l = Math.max(n(p, 'length'), h);
    const steps = Math.max(2, Math.ceil(h / 0.19));
    return `${steps} stupňů po ${((h / steps) * 100).toFixed(0)} cm, sklon ${((Math.atan2(h, l) * 180) / Math.PI).toFixed(0)}°`;
  },
  generate(p, _seed, material) {
    const W = n(p, 'width'), H = n(p, 'height');
    // Sklon nejvýš 45° (limit controlleru) – délka se případně prodlouží.
    const L = Math.max(n(p, 'length'), H);
    const steps = Math.max(2, Math.ceil(H / 0.19));
    const rise = H / steps, run = L / steps;
    const parts: Part[] = [];
    // Schodiště stoupá od z = 0 k z = −L.
    for (let i = 0; i < steps; i++) {
      const top = rise * (i + 1);
      const solid = b(p, 'solid');
      const h = solid ? top : rise + 0.06;
      parts.push({ shape: 'box', pos: [0, top - h / 2, -(i + 0.5) * run], size: [W, h, run], material });
      parts.push({ shape: 'box', pos: [0, top - 0.015, -i * run - 0.03], size: [W, 0.03, 0.06], material: 'concreteDark' });
    }
    // Zjednodušená kolize: rampa (schod se autostepem nehoupe, stupně zůstávají vidět).
    parts.push({ shape: 'wedge', pos: [0, H / 2, -L / 2], rot: [0, Math.PI, 0], size: [W, H, L], material, collide: true, render: false });
    if (!b(p, 'solid')) {
      for (const sx of [-1, 1]) {
        const len = Math.hypot(H, L);
        const ang = Math.atan2(H, L);
        parts.push({ shape: 'box', pos: [sx * (W / 2 - 0.06), H / 2 - 0.15, -L / 2], rot: [ang, 0, 0], size: [0.1, 0.3, len], material: 'metal' });
      }
    }
    const rail = p.railing as string;
    const sides = rail === 'both' ? [-1, 1] : rail === 'left' ? [-1] : rail === 'right' ? [1] : [];
    for (const sx of sides) {
      const x = sx * (W / 2 - 0.04);
      const posts = Math.max(2, Math.ceil(L / 1.5) + 1);
      for (let i = 0; i < posts; i++) {
        const z = -(i / (posts - 1)) * L;
        const y = (-z / L) * H;
        parts.push({ shape: 'box', pos: [x, y + 0.5, z], size: [0.05, 1.0, 0.05], material: 'metal' });
      }
      const len = Math.hypot(H, L), ang = Math.atan2(H, L);
      parts.push({ shape: 'box', pos: [x, H / 2 + 1.0, -L / 2], rot: [ang, 0, 0], size: [0.06, 0.06, len], material: 'paintedMetal' });
      parts.push({ shape: 'box', pos: [x, H / 2 + 0.55, -L / 2], rot: [ang, 0, 0], size: [0.04, 0.04, len], material: 'metal' });
      parts.push({ shape: 'box', pos: [x, H / 2 + 0.55, -L / 2], rot: [ang, 0, 0], size: [0.06, 1.0, len], material: 'metal', collide: true, render: false, moveOnly: true });
    }
    return parts;
  },
});

registerAsset({
  assetId: 'struct.ladder',
  label: 'Žebřík',
  category: 'structures',
  mount: { kind: 'wall', back: 0.05 },
  generatorVersion: 1,
  sizeParams: { y: 'height', x: 'width' },
  params: [
    { key: 'height', label: 'Délka', type: 'number', min: 1, max: 15, step: 0.1, unit: 'm', default: 4 },
    { key: 'width', label: 'Šířka', type: 'number', min: 0.4, max: 0.8, step: 0.05, unit: 'm', default: 0.5 },
    { key: 'cage', label: 'Ochranný koš', type: 'bool', default: false },
  ],
  materials: ['metal', 'paintedMetal'],
  defaultMaterial: 'paintedMetal',
  describe(p) {
    return `${Math.floor(n(p, 'height') / 0.3)} příček · dojdi k němu = nastoupí, pohled nahoru/dolů + W = směr, Space seskočí`;
  },
  // Žebřík stojí v z = 0 (u zdi na straně +Z), lezec přichází z −Z.
  ladders(p) {
    return [{ base: [0, 0, 0], height: n(p, 'height'), width: n(p, 'width'), yaw: 0 }];
  },
  generate(p, _seed, material) {
    const H = n(p, 'height'), W = n(p, 'width');
    const parts: Part[] = [];
    for (const sx of [-1, 1]) parts.push({ shape: 'box', pos: [(sx * W) / 2, (H + 1) / 2, 0], size: [0.05, H + 1, 0.06], material });
    // Madla nad hranou (1 m) usnadní výstup.
    for (let y = 0.3; y < H; y += 0.3) parts.push({ shape: 'cylinder', pos: [0, y, 0], rot: [0, 0, Math.PI / 2], size: [0.03, W, 0.03], material: 'metal' });
    if (b(p, 'cage')) {
      for (let y = 2.2; y < H + 0.9; y += 0.8) {
        parts.push({ shape: 'box', pos: [0, y, -0.38], size: [W + 0.2, 0.04, 0.04], material });
        for (const sx of [-1, 1]) parts.push({ shape: 'box', pos: [sx * (W / 2 + 0.1), y, -0.19], size: [0.04, 0.04, 0.38], material });
      }
    }
    // Žebřík má jen kolizi pro střely (pohyb řeší lezení), aby hráč nenarážel do příček.
    parts.push({ shape: 'box', pos: [0, H / 2, 0], size: [W, H, 0.06], material, collide: true, render: false, bulletOnly: true });
    return parts;
  },
});

registerAsset({
  assetId: 'struct.bridge',
  label: 'Most',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'length', y: 'clearance' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 4, max: 80, step: 0.5, unit: 'm', default: 20 },
    { key: 'width', label: 'Šířka', type: 'number', min: 2, max: 16, step: 0.5, unit: 'm', default: 6 },
    { key: 'clearance', label: 'Výška mostovky', type: 'number', min: 1, max: 15, step: 0.25, unit: 'm', default: 4 },
    { key: 'span', label: 'Max. rozpětí pilířů', type: 'number', min: 4, max: 20, step: 0.5, unit: 'm', default: 8 },
    { key: 'railing', label: 'Zábradlí', type: 'bool', default: true },
  ],
  materials: ['concrete', 'concreteLight', 'sandstone'],
  defaultMaterial: 'concrete',
  describe(p) {
    const l = fenceLayout(n(p, 'length'), n(p, 'span'));
    return `${l.posts - 2} pilířů, pole ${l.spacing.toFixed(1)} m`;
  },
  generate(p, _seed, material) {
    const L = n(p, 'length'), W = n(p, 'width'), C = n(p, 'clearance');
    const deck = 0.5;
    const parts: Part[] = [];
    // Mostovka od z = 0 do z = −L, horní hrana v y = C.
    parts.push({ shape: 'box', pos: [0, C - deck / 2, -L / 2], size: [W, deck, L], material, collide: true });
    parts.push({ shape: 'box', pos: [0, C + 0.01, -L / 2], size: [W - 1.2, 0.02, L], material: 'asphalt', collide: false });
    for (const sx of [-1, 1]) {
      parts.push({ shape: 'box', pos: [sx * (W / 2 - 0.3), C + 0.1, -L / 2], size: [0.6, 0.2, L], material: 'concreteLight', collide: true });
      parts.push({ shape: 'box', pos: [sx * (W / 2 - 0.05), C - deck - 0.25, -L / 2], size: [0.3, 0.5, L], material });
    }
    const { panels, spacing } = fenceLayout(L, n(p, 'span'));
    for (let i = 0; i <= panels; i++) {
      const z = -i * spacing;
      const end = i === 0 || i === panels;
      const ph = C - deck;
      if (ph <= 0.05) continue;
      if (end) parts.push({ shape: 'box', pos: [0, ph / 2, z], size: [W, ph, 1.2], material, collide: true });
      else {
        parts.push({ shape: 'box', pos: [0, ph / 2, z], size: [Math.min(W * 0.4, 2.2), ph, 0.9], material, collide: true });
        parts.push({ shape: 'box', pos: [0, ph - 0.25, z], size: [W - 0.4, 0.5, 1.0], material });
      }
    }
    if (b(p, 'railing')) {
      for (const sx of [-1, 1]) {
        const x = sx * (W / 2 - 0.08);
        const posts = Math.ceil(L / 2) + 1;
        for (let i = 0; i < posts; i++) parts.push({ shape: 'box', pos: [x, C + 0.2 + 0.5, -(i / (posts - 1)) * L], size: [0.07, 1.0, 0.07], material: 'paintedMetal' });
        parts.push({ shape: 'box', pos: [x, C + 1.2, -L / 2], size: [0.08, 0.06, L], material: 'paintedMetal' });
        parts.push({ shape: 'box', pos: [x, C + 0.75, -L / 2], size: [0.04, 0.04, L], material: 'metal' });
        parts.push({ shape: 'box', pos: [x, C + 0.7, -L / 2], size: [0.08, 1.0, L], material: 'metal', collide: true, render: false, moveOnly: true });
      }
    }
    return parts;
  },
});

registerAsset({
  assetId: 'street.road',
  label: 'Silnice – díl (rovinka, křižovatka)',
  category: 'street',
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'length' },
  params: [
    { key: 'kind', label: 'Typ', type: 'enum', default: 'straight', options: [
      { value: 'straight', label: 'Rovný úsek' },
      { value: 'corner', label: 'Roh' },
      { value: 'cross', label: 'Křižovatka' },
    ] },
    { key: 'length', label: 'Délka', type: 'number', min: 2, max: 100, step: 1, unit: 'm', default: 20 },
    { key: 'width', label: 'Šířka vozovky', type: 'number', min: 3, max: 16, step: 0.5, unit: 'm', default: 7 },
    { key: 'sidewalk', label: 'Chodník', type: 'number', min: 0, max: 5, step: 0.25, unit: 'm', default: 2.5 },
    { key: 'markings', label: 'Vodorovné značení', type: 'bool', default: true },
  ],
  materials: ['asphalt'],
  defaultMaterial: 'asphalt',
  generate(p) {
    const W = n(p, 'width'), S = n(p, 'sidewalk'), kind = p.kind as string;
    const L = kind === 'straight' ? n(p, 'length') : W;
    const parts: Part[] = [];
    const curbH = 0.15, slab = 0.06;
    // Vozovka mírně nad terénem (žádný z-fighting); chodník = obrubník + dlažba (pochozí, pod výškou schodu).
    parts.push({ shape: 'box', pos: [0, slab / 2, 0], size: [W, slab, L], material: 'asphalt', collide: true });
    const sidewalk = (cx: number, cz: number, sx: number, sz: number, curbAxis: 'x' | 'z', curbSide: number) => {
      if (S <= 0) return;
      parts.push({ shape: 'box', pos: [cx, curbH / 2, cz], size: [sx, curbH, sz], material: 'paving', collide: true });
      if (curbAxis === 'x') parts.push({ shape: 'box', pos: [cx + (curbSide * sx) / 2, curbH / 2 + 0.005, cz], size: [0.16, curbH + 0.01, sz], material: 'concreteLight' });
      else parts.push({ shape: 'box', pos: [cx, curbH / 2 + 0.005, cz + (curbSide * sz) / 2], size: [sx, curbH + 0.01, 0.16], material: 'concreteLight' });
    };
    if (kind === 'straight') {
      sidewalk(-(W + S) / 2, 0, S, L, 'x', 1);
      sidewalk((W + S) / 2, 0, S, L, 'x', -1);
      if (b(p, 'markings')) {
        const dash = 3, gap = 3;
        for (let z = -L / 2 + 1; z + dash <= L / 2; z += dash + gap) {
          parts.push({ shape: 'box', pos: [0, slab + 0.004, z + dash / 2], size: [0.14, 0.008, dash], material: 'paint', castShadow: false });
        }
        for (const sx of [-1, 1]) parts.push({ shape: 'box', pos: [sx * (W / 2 - 0.3), slab + 0.004, 0], size: [0.12, 0.008, L], material: 'paintDim', castShadow: false });
      }
    } else if (kind === 'corner') {
      // Roh: vozovka pokračuje k −Z a k +X; chodník na vnější straně (−X a +Z) a malý v rohu.
      sidewalk(-(W + S) / 2, 0, S, W + 2 * S, 'x', 1);
      sidewalk(0, (W + S) / 2, W, S, 'z', -1);
      sidewalk((W + S) / 2, -(W + S) / 2, S, S, 'x', -1);
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) sidewalk((sx * (W + S)) / 2, (sz * (W + S)) / 2, S, S, 'x', -sx);
      if (b(p, 'markings')) {
        for (let i = 0; i < 6; i++) {
          parts.push({ shape: 'box', pos: [-W / 2 + 0.5 + i * ((W - 1) / 5), slab + 0.004, -W / 2 - 1], size: [0.5, 0.008, 2], material: 'paint', castShadow: false });
        }
      }
    }
    return parts;
  },
});
