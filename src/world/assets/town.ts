import { rng } from '../../shared/math';
import type { LadderLocal, Part } from '../parts';
import { registerAsset, type Params } from '../registry';
import { facade, openingFrame, wallWithOpenings } from './kit';
import { eulerYXZ, foliage, limb } from './nature';
import { room, type RoomSpec } from './small';

/**
 * Vesnické a městské objekty pro pouštní mapy (dvorní zdi, zídky, sloupy vedení, lampy,
 * tabule, silo, střešní nádrže, čerpací stanice, náměstí, fontána, dům s terasou).
 * Vlastní parametrické tvary; inspirace žánrem, žádné převzaté modely.
 */
const n = (p: Params, k: string) => p[k] as number;

const WALL_MATS = ['brick', 'plasterWarm', 'plasterOchre', 'plaster', 'sandstone', 'concrete'];

registerAsset({
  assetId: 'struct.compoundWall',
  label: 'Zeď dvora s pilíři',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { x: 'length', y: 'height' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 2, max: 40, step: 0.5, unit: 'm', default: 12 },
    { key: 'height', label: 'Výška', type: 'number', min: 1, max: 3.5, step: 0.1, unit: 'm', default: 2.0 },
    { key: 'spacing', label: 'Rozteč pilířů', type: 'number', min: 1.5, max: 6, step: 0.25, unit: 'm', default: 3 },
    {
      key: 'breach',
      label: 'Proražení',
      type: 'enum',
      default: 'none',
      options: [
        { value: 'none', label: 'Žádné' },
        { value: 'middle', label: 'Uprostřed' },
        { value: 'random', label: 'Náhodné pole' },
      ],
    },
    { key: 'endPillars', label: 'Pilíře na koncích', type: 'bool', default: true },
  ],
  materials: WALL_MATS,
  defaultMaterial: 'brick',
  describe: (p) => `${Math.max(1, Math.round(n(p, 'length') / n(p, 'spacing')))} polí; proražení je průchozí`,
  generate(p, seed, material) {
    const L = n(p, 'length'), H = n(p, 'height'), t = 0.24;
    const panels = Math.max(1, Math.round(L / n(p, 'spacing')));
    const sp = L / panels;
    const r = rng(seed);
    const breach = p.breach === 'middle' ? Math.floor(panels / 2) : p.breach === 'random' ? Math.floor(r() * panels) : -1;
    const parts: Part[] = [];
    const cap = material === 'brick' ? 'sandstone' : 'concreteLight';
    for (let i = 0; i < panels; i++) {
      const x0 = -L / 2 + i * sp, xc = x0 + sp / 2;
      if (i !== breach) {
        parts.push({ shape: 'box', pos: [xc, H / 2, 0], size: [sp, H, t], material, collide: true });
        parts.push({ shape: 'box', pos: [xc, H + 0.03, 0], size: [sp, 0.06, t + 0.06], material: cap });
        continue;
      }
      // Proražené pole: zubaté pahýly po stranách, sutina na zemi, střed průchozí.
      const cols = Math.max(2, Math.round(sp / 0.3));
      const cw = sp / cols;
      for (let c = 0; c < cols; c++) {
        const edge = Math.min(c, cols - 1 - c) / (cols / 2); // 0 u pilíře, 1 uprostřed
        const h = edge < 0.35 ? H * (1 - edge * 1.6 - r() * 0.25) : edge < 0.6 ? 0.25 + r() * 0.35 : 0;
        if (h > 0.05) parts.push({ shape: 'box', pos: [x0 + (c + 0.5) * cw, h / 2, 0], size: [cw, h, t], material, collide: true });
      }
      for (let k = 0; k < 10; k++) {
        const s = 0.12 + r() * 0.2;
        parts.push({ shape: 'box', pos: [xc + (r() - 0.5) * sp * 0.8, s * 0.3, (r() - 0.3) * 1.4], rot: [r() * 0.5, r() * 3, r() * 0.5], size: [s * 1.8, s, s], material });
      }
    }
    for (let i = 0; i <= panels; i++) {
      if (!p.endPillars && (i === 0 || i === panels)) continue;
      const x = -L / 2 + i * sp;
      parts.push({ shape: 'box', pos: [x, (H + 0.15) / 2, 0], size: [0.42, H + 0.15, 0.42], material, collide: true });
      parts.push({ shape: 'box', pos: [x, H + 0.21, 0], size: [0.5, 0.12, 0.5], material: cap });
    }
    return parts;
  },
});

registerAsset({
  assetId: 'struct.stoneWall',
  label: 'Kamenná zídka',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { x: 'length', y: 'height' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 1, max: 30, step: 0.25, unit: 'm', default: 8 },
    { key: 'height', label: 'Výška', type: 'number', min: 0.4, max: 1.6, step: 0.05, unit: 'm', default: 0.8 },
  ],
  materials: ['stoneWall'],
  defaultMaterial: 'stoneWall',
  describe: () => 'kryt vleže a v podřepu',
  generate(p, seed, material) {
    const L = n(p, 'length'), H = n(p, 'height'), W = 0.55;
    const r = rng(seed);
    const parts: Part[] = [{ shape: 'box', pos: [0, (H - 0.12) / 2, 0], size: [L, H - 0.12, W], material, collide: true }];
    // Zaoblená nepravidelná koruna z kamenů a zakulacené konce.
    const k = Math.max(2, Math.round(L / 0.55));
    for (let i = 0; i < k; i++) {
      const x = -L / 2 + ((i + 0.5) / k) * L;
      parts.push({ shape: 'blob', pos: [x, H - 0.1 + (r() - 0.5) * 0.05, (r() - 0.5) * 0.06], size: [(L / k) * 1.25, 0.24, W * 0.95], seed: Math.floor(r() * 1e6), rough: 0.9, material, collide: false });
    }
    // Vyčnívající kameny na bocích (nerovný líc zdi).
    for (let i = 0; i < Math.round(L * 1.5); i++) {
      const s = 0.18 + r() * 0.16;
      parts.push({ shape: 'blob', pos: [(r() - 0.5) * (L - 0.3), 0.12 + r() * (H - 0.35), (r() < 0.5 ? -1 : 1) * W * 0.46], size: [s * 1.5, s, s], seed: Math.floor(r() * 1e6), rough: 0.6, material });
    }
    for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [(s * (L - 0.1)) / 2, (H - 0.12) / 2, 0], size: [0.1, H - 0.12, W], material });
    parts.push({ shape: 'box', pos: [0, H - 0.08, 0], size: [L, 0.16, W * 0.9], material, collide: true, render: false });
    return parts;
  },
});

registerAsset({
  assetId: 'struct.powerPole',
  label: 'Sloup elektrického vedení',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { y: 'height' },
  params: [
    { key: 'height', label: 'Výška', type: 'number', min: 6, max: 12, step: 0.5, unit: 'm', default: 8.5 },
    { key: 'span', label: 'Dráty k dalšímu sloupu (+X)', type: 'number', min: 0, max: 60, step: 0.5, unit: 'm', default: 25 },
    { key: 'sag', label: 'Průvěs drátů', type: 'number', min: 0, max: 3, step: 0.1, unit: 'm', default: 0.9 },
  ],
  materials: ['wood', 'woodDark', 'concrete'],
  defaultMaterial: 'woodDark',
  describe: (p) => (n(p, 'span') > 0 ? `dráty ${n(p, 'span')} m ve směru +X (napoj další sloup)` : 'bez drátů'),
  generate(p, _seed, material) {
    const H = n(p, 'height'), S = n(p, 'span'), sag = n(p, 'sag');
    const parts: Part[] = [{ shape: 'cylinder', pos: [0, H / 2, 0], size: [0.28, H, 0.28], taper: 0.75, material, collide: true }];
    // Příčník kolmo na vedení, tři izolátory.
    parts.push({ shape: 'box', pos: [0, H - 0.35, 0], size: [0.12, 0.12, 1.9], material: material === 'concrete' ? 'metal' : 'wood' });
    const zs = [-0.8, 0, 0.8];
    for (const z of zs) parts.push({ shape: 'cylinder', pos: [0, H - 0.2 + (z === 0 ? 0.25 : 0), z], size: [0.08, 0.2, 0.08], material: 'concreteLight' });
    if (S > 0) {
      const segs = Math.max(4, Math.round(S / 3));
      for (const z of zs) {
        const y0 = H - 0.08 + (z === 0 ? 0.25 : 0);
        for (let i = 0; i < segs; i++) {
          const t0 = i / segs, t1 = (i + 1) / segs;
          const y = (t: number) => y0 - sag * 4 * t * (1 - t);
          const a: [number, number, number] = [t0 * S, y(t0), z], b: [number, number, number] = [t1 * S, y(t1), z];
          parts.push({ ...limb(a, b, 0.025, 0.025, 'concreteDark'), castShadow: false });
        }
      }
    }
    return parts;
  },
});

registerAsset({
  assetId: 'struct.streetLamp',
  label: 'Pouliční lampa',
  category: 'street',
  generatorVersion: 1,
  sizeParams: { y: 'height' },
  params: [
    { key: 'height', label: 'Výška', type: 'number', min: 4, max: 10, step: 0.25, unit: 'm', default: 7 },
    {
      key: 'arms',
      label: 'Ramena',
      type: 'enum',
      default: 'single',
      options: [
        { value: 'single', label: 'Jedno' },
        { value: 'double', label: 'Dvě' },
      ],
    },
  ],
  materials: ['paintedMetal', 'metal', 'concrete'],
  defaultMaterial: 'metal',
  generate(p, _seed, material) {
    const H = n(p, 'height');
    const parts: Part[] = [
      { shape: 'cylinder', pos: [0, H / 2, 0], size: [0.18, H, 0.18], taper: 0.6, material, collide: true },
      { shape: 'cylinder', pos: [0, 0.3, 0], size: [0.3, 0.6, 0.3], material },
    ];
    const sides = p.arms === 'double' ? [-1, 1] : [1];
    for (const s of sides) {
      parts.push(limb([0, H - 0.6, 0], [s * 0.8, H - 0.05, 0], 0.08, 0.06, material));
      parts.push(limb([s * 0.8, H - 0.05, 0], [s * 1.7, H - 0.12, 0], 0.06, 0.06, material));
      parts.push({ shape: 'box', pos: [s * 1.95, H - 0.18, 0], size: [0.65, 0.12, 0.3], material: 'paintedMetal' });
      parts.push({ shape: 'box', pos: [s * 1.95, H - 0.25, 0], size: [0.5, 0.03, 0.22], material: 'lamp', castShadow: false });
    }
    return parts;
  },
});

registerAsset({
  assetId: 'street.roadSign',
  label: 'Směrová tabule',
  category: 'street',
  generatorVersion: 1,
  sizeParams: { x: 'width' },
  params: [
    { key: 'text', label: 'Horní řádek', type: 'string', default: '↑ CITY CENTRE' },
    { key: 'text2', label: 'Dolní řádek', type: 'string', default: '→ AIRPORT 12' },
    { key: 'width', label: 'Šířka', type: 'number', min: 1.5, max: 6, step: 0.1, unit: 'm', default: 2.6 },
    { key: 'height', label: 'Výška spodní hrany', type: 'number', min: 2, max: 6, step: 0.1, unit: 'm', default: 3.2 },
  ],
  materials: ['paintedMetal', 'metal'],
  defaultMaterial: 'metal',
  generate(p, _seed, material) {
    const w = n(p, 'width'), y0 = n(p, 'height'), h = 1.3;
    const parts: Part[] = [
      { shape: 'box', pos: [0, y0 + h / 2, 0], size: [w, h, 0.06], material: 'paintedMetal', collide: true },
      { shape: 'label', pos: [0, y0 + h * 0.74, -0.035], rot: [0, Math.PI, 0], size: [w - 0.1, h * 0.46, 0], material: 'labelRoad', text: String(p.text) },
      { shape: 'label', pos: [0, y0 + h * 0.26, -0.035], rot: [0, Math.PI, 0], size: [w - 0.1, h * 0.46, 0], material: 'labelRoad', text: String(p.text2) },
    ];
    for (const s of [-1, 1]) parts.push({ shape: 'cylinder', pos: [(s * w) / 2.8, (y0 + h) / 2, 0.1], size: [0.1, y0 + h, 0.1], material, collide: true });
    return parts;
  },
});

registerAsset({
  assetId: 'struct.silo',
  label: 'Silo / vodojem',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { y: 'height', x: 'diameter' },
  params: [
    { key: 'height', label: 'Výška', type: 'number', min: 2, max: 16, step: 0.25, unit: 'm', default: 7 },
    { key: 'diameter', label: 'Průměr', type: 'number', min: 1.5, max: 8, step: 0.1, unit: 'm', default: 3.4 },
    { key: 'ladder', label: 'Žebřík na střechu', type: 'bool', default: true },
  ],
  materials: ['concrete', 'concreteLight', 'metalSheet', 'paintedMetal'],
  defaultMaterial: 'concrete',
  describe: (p) => (p.ladder ? 'žebřík na straně −Z, pochozí střecha' : 'pochozí střecha'),
  ladders(p) {
    if (!p.ladder) return [];
    const R = n(p, 'diameter') / 2;
    return [{ base: [0, 0, -R - 0.02], height: n(p, 'height') + 0.15, width: 0.5, yaw: 0 }] as LadderLocal[];
  },
  generate(p, _seed, material) {
    const H = n(p, 'height'), D = n(p, 'diameter'), R = D / 2;
    const parts: Part[] = [
      { shape: 'cylinder', pos: [0, H / 2, 0], size: [D, H, D], material, collide: true },
      { shape: 'cylinder', pos: [0, H + 0.08, 0], size: [D + 0.15, 0.16, D + 0.15], material: 'concreteDark', collide: true },
      { shape: 'cylinder', pos: [0, H + 0.4, 0], size: [0.8, 0.5, 0.8], taper: 0.4, material: 'metal' },
    ];
    // Obvodové zábradlí z tyček.
    const posts = Math.max(8, Math.round((Math.PI * D) / 1.2));
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      parts.push({ shape: 'box', pos: [Math.sin(a) * (R - 0.05), H + 0.6, Math.cos(a) * (R - 0.05)], size: [0.04, 0.9, 0.04], material: 'metal' });
      const a2 = ((i + 0.5) / posts) * Math.PI * 2, chord = 2 * (R - 0.05) * Math.sin(Math.PI / posts);
      if (!(p.ladder && Math.abs(Math.cos(a2) + 1) < 0.05)) parts.push({ shape: 'box', pos: [Math.sin(a2) * (R - 0.05) * Math.cos(Math.PI / posts), H + 1.05, Math.cos(a2) * (R - 0.05) * Math.cos(Math.PI / posts)], rot: [0, a2 + Math.PI / 2, 0], size: [chord, 0.05, 0.05], material: 'metal' });
    }
    if (p.ladder) {
      for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [s * 0.25, (H + 1) / 2, -R - 0.08], size: [0.05, H + 1, 0.06], material: 'metal' });
      for (let y = 0.3; y < H; y += 0.3) parts.push({ shape: 'cylinder', pos: [0, y, -R - 0.08], rot: [0, 0, Math.PI / 2], size: [0.03, 0.5, 0.03], material: 'metal' });
    }
    // Obruče (výztuha pláště).
    for (let y = 1.5; y < H - 0.5; y += 2.5) parts.push({ shape: 'cylinder', pos: [0, y, 0], size: [D + 0.06, 0.12, D + 0.06], material: 'concreteDark' });
    return parts;
  },
});

registerAsset({
  assetId: 'street.roofTank',
  label: 'Nádrž na vodu (na nohách)',
  category: 'street',
  generatorVersion: 1,
  uniformScale: { min: 0.6, max: 1.8 },
  params: [
    { key: 'legs', label: 'Výška nohou', type: 'number', min: 0, max: 3, step: 0.1, unit: 'm', default: 1.2 },
  ],
  materials: ['paintedMetal', 'metal', 'concreteDark', 'rubber'],
  defaultMaterial: 'rubber',
  describe: () => 'polož na střechu domu',
  generate(p, _seed, material) {
    const L = n(p, 'legs');
    const parts: Part[] = [
      { shape: 'cylinder', pos: [0, L + 0.65, 0], size: [1.2, 1.3, 1.2], material, collide: true },
      { shape: 'cylinder', pos: [0, L + 1.35, 0], size: [1.1, 0.12, 1.1], taper: 0.5, material },
      { shape: 'cylinder', pos: [0.2, L + 1.45, 0], size: [0.25, 0.1, 0.25], material: 'metal' },
    ];
    if (L > 0.05) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [sx * 0.42, L / 2, sz * 0.42], size: [0.06, L, 0.06], material: 'metal', collide: true });
      parts.push({ shape: 'box', pos: [0, L - 0.03, 0], size: [1.0, 0.06, 1.0], material: 'metal', collide: true });
      parts.push(limb([0.45, L, 0], [0.3, 0.05, -0.6], 0.05, 0.05, 'metal'));
    }
    return parts;
  },
});

registerAsset({
  assetId: 'cover.pipeStack',
  label: 'Stoh kovových trubek',
  category: 'cover',
  generatorVersion: 1,
  sizeParams: { x: 'length' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 1, max: 12, step: 0.25, unit: 'm', default: 6 },
    { key: 'rows', label: 'Řady', type: 'int', min: 1, max: 4, default: 2 },
    { key: 'diameter', label: 'Průměr trubky', type: 'number', min: 0.15, max: 0.8, step: 0.05, unit: 'm', default: 0.35 },
  ],
  materials: ['paintedMetal', 'metal', 'concreteLight', 'paintDim'],
  defaultMaterial: 'paintDim',
  generate(p, _seed, material) {
    const L = n(p, 'length'), d = n(p, 'diameter'), rows = n(p, 'rows');
    const parts: Part[] = [];
    for (let row = 0; row < rows; row++) {
      const k = rows + 1 - row;
      for (let i = 0; i < k; i++) {
        const z = (i - (k - 1) / 2) * d * 1.02;
        parts.push({ shape: 'cylinder', pos: [0, d / 2 + row * d * 0.87, z], rot: [0, 0, Math.PI / 2], size: [d, L, d], material, collide: true });
      }
    }
    for (const x of [-L / 3, L / 3]) parts.push({ shape: 'box', pos: [x, 0.04, 0], size: [0.12, 0.08, (rows + 1) * d * 1.1], material: 'wood' });
    return parts;
  },
});

registerAsset({
  assetId: 'struct.gasCanopy',
  label: 'Čerpací stanice (přístřešek)',
  category: 'structures',
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'depth' },
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 6, max: 24, step: 0.5, unit: 'm', default: 14 },
    { key: 'depth', label: 'Hloubka', type: 'number', min: 5, max: 14, step: 0.5, unit: 'm', default: 8 },
    { key: 'height', label: 'Podjezdná výška', type: 'number', min: 3.5, max: 6, step: 0.1, unit: 'm', default: 4.6 },
    { key: 'pumps', label: 'Ostrůvky se stojany', type: 'int', min: 0, max: 4, default: 2 },
  ],
  materials: ['paintedMetal', 'paintDim', 'concreteLight'],
  defaultMaterial: 'paintDim',
  generate(p, _seed, material) {
    const W = n(p, 'width'), D = n(p, 'depth'), H = n(p, 'height');
    const parts: Part[] = [
      { shape: 'box', pos: [0, H + 0.4, 0], size: [W, 0.8, D], material, collide: true },
      { shape: 'box', pos: [0, H + 0.4, 0], size: [W + 0.06, 0.25, D + 0.06], material: 'paintedMetalRed' },
      { shape: 'box', pos: [0, H - 0.02, 0], size: [W - 0.2, 0.04, D - 0.2], material: 'concreteLight' },
    ];
    const pumps = n(p, 'pumps');
    const cols = pumps > 0 ? pumps : 2;
    for (let i = 0; i < cols; i++) {
      const x = (i - (cols - 1) / 2) * (W / cols);
      parts.push({ shape: 'box', pos: [x, H / 2, 0], size: [0.45, H, 0.45], material: 'concreteLight', collide: true });
      if (pumps > 0) {
        parts.push({ shape: 'box', pos: [x, 0.1, 0], size: [1.2, 0.2, D * 0.55], material: 'concreteLight', collide: true });
        for (const z of [-D * 0.17, D * 0.17]) {
          parts.push({ shape: 'box', pos: [x, 0.95, z], size: [0.55, 1.5, 0.75], material: 'paintedMetal', collide: true });
          parts.push({ shape: 'box', pos: [x, 1.3, z], size: [0.57, 0.35, 0.5], material: 'glass' });
        }
      }
    }
    for (let i = 0; i < 6; i++) parts.push({ shape: 'box', pos: [-W / 2 + 0.6 + i * 0.3, H + 0.82, -D / 2 + 0.6], size: [0.25, 0.04, 0.25], material: 'metal' });
    return parts;
  },
});

registerAsset({
  assetId: 'street.plaza',
  label: 'Náměstí s dlažbou',
  category: 'street',
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'depth' },
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 6, max: 50, step: 0.5, unit: 'm', default: 20 },
    { key: 'depth', label: 'Hloubka', type: 'number', min: 6, max: 50, step: 0.5, unit: 'm', default: 20 },
    { key: 'raise', label: 'Výška nad ulicí', type: 'number', min: 0.05, max: 0.6, step: 0.05, unit: 'm', default: 0.3 },
    { key: 'border', label: 'Šířka obruby', type: 'number', min: 0.3, max: 3, step: 0.1, unit: 'm', default: 1.6 },
  ],
  materials: ['plazaTile', 'paving'],
  defaultMaterial: 'plazaTile',
  describe: () => 'obruba je schodek (vyjde se bez skoku do 0,35 m)',
  generate(p, _seed, material) {
    const W = n(p, 'width'), D = n(p, 'depth'), h = n(p, 'raise'), b = n(p, 'border');
    const parts: Part[] = [
      { shape: 'box', pos: [0, h / 2, 0], size: [W, h, D], material: 'paving', collide: true },
      { shape: 'box', pos: [0, h + 0.005, 0], size: [W - 2 * b, 0.01, D - 2 * b], material, castShadow: false },
    ];
    // Lem z tmavších kamenů a nízký schod kolem.
    for (const [x, z, sx, sz] of [
      [0, -D / 2 + b, W - 2 * b + 0.3, 0.3],
      [0, D / 2 - b, W - 2 * b + 0.3, 0.3],
      [-W / 2 + b, 0, 0.3, D - 2 * b],
      [W / 2 - b, 0, 0.3, D - 2 * b],
    ] as const)
      parts.push({ shape: 'box', pos: [x, h + 0.012, z], size: [sx, 0.02, sz], material: 'concreteDark', castShadow: false });
    if (h > 0.2) parts.push({ shape: 'box', pos: [0, h / 4, 0], size: [W + 0.7, h / 2, D + 0.7], material: 'concreteLight', collide: true });
    return parts;
  },
});

registerAsset({
  assetId: 'street.fountain',
  label: 'Fontána',
  category: 'street',
  generatorVersion: 1,
  uniformScale: { min: 0.6, max: 2 },
  params: [
    { key: 'diameter', label: 'Průměr nádrže', type: 'number', min: 2, max: 8, step: 0.1, unit: 'm', default: 3.6 },
    { key: 'water', label: 'S vodou', type: 'bool', default: true },
  ],
  materials: ['sandstone', 'concreteLight', 'plasterWhite'],
  defaultMaterial: 'sandstone',
  generate(p, _seed, material) {
    const D = n(p, 'diameter'), R = D / 2;
    const parts: Part[] = [];
    // Osmiboká obruba z kvádrů.
    const side = 2 * R * Math.tan(Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push({ shape: 'box', pos: [Math.sin(a) * R, 0.3, Math.cos(a) * R], rot: [0, a, 0], size: [side + 0.28, 0.6, 0.35], material, collide: true });
    }
    parts.push({ shape: 'cylinder', pos: [0, 0.05, 0], size: [D, 0.1, D], material: 'concreteDark' });
    if (p.water) parts.push({ shape: 'cylinder', pos: [0, 0.42, 0], size: [D - 0.2, 0.02, D - 0.2], material: 'water', castShadow: false });
    parts.push({ shape: 'cylinder', pos: [0, 0.6, 0], size: [0.45, 1.2, 0.45], material, collide: true });
    parts.push({ shape: 'cylinder', pos: [0, 1.2, 0], size: [1.3, 0.25, 1.3], taper: 1.3, material });
    parts.push({ shape: 'cylinder', pos: [0, 1.5, 0], size: [0.18, 0.5, 0.18], material });
    return parts;
  },
});

registerAsset({
  assetId: 'street.planter',
  label: 'Květináč s rostlinou',
  category: 'street',
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'depth' },
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 0.8, max: 6, step: 0.1, unit: 'm', default: 1.6 },
    { key: 'depth', label: 'Hloubka', type: 'number', min: 0.8, max: 6, step: 0.1, unit: 'm', default: 1.6 },
    {
      key: 'plant',
      label: 'Rostlina',
      type: 'enum',
      default: 'cycad',
      options: [
        { value: 'cycad', label: 'Nízká palma' },
        { value: 'shrub', label: 'Keř' },
        { value: 'none', label: 'Žádná' },
      ],
    },
  ],
  materials: ['concreteLight', 'sandstone', 'brick', 'plasterWhite'],
  defaultMaterial: 'concreteLight',
  generate(p, seed, material) {
    const W = n(p, 'width'), D = n(p, 'depth'), H = 0.55, t = 0.15;
    const parts: Part[] = [];
    for (const [x, z, sx, sz] of [
      [0, -D / 2 + t / 2, W, t],
      [0, D / 2 - t / 2, W, t],
      [-W / 2 + t / 2, 0, t, D - 2 * t],
      [W / 2 - t / 2, 0, t, D - 2 * t],
    ] as const)
      parts.push({ shape: 'box', pos: [x, H / 2, z], size: [sx, H, sz], material, collide: true });
    parts.push({ shape: 'box', pos: [0, H - 0.1, 0], size: [W - 2 * t, 0.04, D - 2 * t], material: 'dirt', castShadow: false });
    const r = rng(seed);
    if (p.plant === 'cycad') {
      const L = 11;
      for (let i = 0; i < L; i++) parts.push({ shape: 'card', pos: [0, H, 0], rot: eulerYXZ((i / L) * Math.PI * 2 + r() * 0.3, 0.55 + r() * 0.45, 0), size: [0.7, 1.3 + r() * 0.3, 0], bend: -0.4, material: 'palmFrond' });
    } else if (p.plant === 'shrub') {
      const s = Math.min(W, D) * 0.8;
      parts.push(...foliage([0, H + s * 0.35, 0], [s, s * 0.7, s], seed, 'crownGreen', 'leafGreen', 3, 9, s * 0.6));
    }
    return parts;
  },
});

registerAsset({
  assetId: 'street.trafficIsland',
  label: 'Ostrůvek s obrubníkem',
  category: 'street',
  generatorVersion: 1,
  sizeParams: { x: 'length', z: 'width' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 2, max: 30, step: 0.5, unit: 'm', default: 8 },
    { key: 'width', label: 'Šířka', type: 'number', min: 0.8, max: 6, step: 0.1, unit: 'm', default: 1.6 },
  ],
  materials: ['concreteLight', 'paving', 'sand'],
  defaultMaterial: 'concreteLight',
  generate(p, _seed, material) {
    const L = n(p, 'length'), W = n(p, 'width'), h = 0.18;
    return [
      { shape: 'box', pos: [0, h / 2, 0], size: [Math.max(0.01, L - W), h, W], material, collide: true },
      { shape: 'cylinder', pos: [-(L - W) / 2, h / 2, 0], size: [W, h, W], material, collide: true },
      { shape: 'cylinder', pos: [(L - W) / 2, h / 2, 0], size: [W, h, W], material, collide: true },
      { shape: 'box', pos: [0, h + 0.004, 0], size: [Math.max(0.01, L - W), 0.008, W - 0.3], material: 'paving', castShadow: false },
    ];
  },
});

registerAsset({
  assetId: 'street.bench',
  label: 'Lavička',
  category: 'street',
  generatorVersion: 1,
  params: [{ key: 'length', label: 'Délka', type: 'number', min: 1, max: 4, step: 0.1, unit: 'm', default: 1.8 }],
  materials: ['wood', 'woodDark', 'concreteLight'],
  defaultMaterial: 'wood',
  generate(p, _seed, material) {
    const L = n(p, 'length');
    const parts: Part[] = [];
    for (const x of [-L / 2 + 0.15, L / 2 - 0.15]) {
      parts.push({ shape: 'box', pos: [x, 0.22, 0], size: [0.08, 0.44, 0.45], material: 'metal', collide: true });
      parts.push({ shape: 'box', pos: [x, 0.65, 0.2], size: [0.06, 0.45, 0.06], material: 'metal' });
    }
    for (let i = 0; i < 3; i++) parts.push({ shape: 'box', pos: [0, 0.46, -0.15 + i * 0.15], size: [L, 0.04, 0.12], material, collide: i === 1 });
    for (let i = 0; i < 2; i++) parts.push({ shape: 'box', pos: [0, 0.65 + i * 0.16, 0.22], rot: [-0.15, 0, 0], size: [L, 0.11, 0.035], material });
    return parts;
  },
});

registerAsset({
  assetId: 'street.phoneBooth',
  label: 'Telefonní budka',
  category: 'street',
  generatorVersion: 1,
  params: [],
  materials: ['paintedMetalBlue', 'paintedMetalRed', 'paintedMetal'],
  defaultMaterial: 'paintedMetalBlue',
  generate(_p, _seed, material) {
    return [
      { shape: 'box', pos: [0, 1.0, 0.2], size: [0.9, 2.0, 0.06], material, collide: true },
      { shape: 'box', pos: [-0.42, 1.0, 0], size: [0.06, 2.0, 0.45], material, collide: true },
      { shape: 'box', pos: [0.42, 1.0, 0], size: [0.06, 2.0, 0.45], material, collide: true },
      { shape: 'box', pos: [0, 2.05, 0], size: [1.0, 0.12, 0.6], material, collide: true },
      { shape: 'box', pos: [0, 1.3, 0.14], size: [0.3, 0.45, 0.1], material: 'metal' },
      { shape: 'box', pos: [0, 1.0, 0], size: [0.82, 1.2, 0.02], material: 'glass', render: false },
    ];
  },
});

registerAsset({
  assetId: 'street.bin',
  label: 'Odpadkový koš',
  category: 'street',
  generatorVersion: 1,
  params: [],
  materials: ['paintedMetal', 'paintedMetalBlue', 'concreteLight'],
  defaultMaterial: 'paintedMetal',
  generate(_p, _seed, material) {
    return [
      { shape: 'cylinder', pos: [0, 0.45, 0], size: [0.45, 0.9, 0.45], taper: 1.1, material, collide: true },
      { shape: 'cylinder', pos: [0, 0.92, 0], size: [0.52, 0.05, 0.52], material: 'metal' },
    ];
  },
});

registerAsset({
  assetId: 'small.terraceHouse',
  label: 'Dům s terasou a nádrží (2 patra)',
  category: 'buildings',
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'depth' },
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 6, max: 12, step: 0.5, unit: 'm', default: 8 },
    { key: 'depth', label: 'Hloubka', type: 'number', min: 6.5, max: 12, step: 0.5, unit: 'm', default: 8 },
    { key: 'stairs', label: 'Venkovní schodiště na terasu', type: 'bool', default: true },
    { key: 'tank', label: 'Nádrž na střeše', type: 'bool', default: true },
  ],
  materials: ['plasterWarm', 'plaster', 'plasterWhite', 'plasterOchre', 'sandstone', 'concreteLight'],
  defaultMaterial: 'plaster',
  describe: () => 'přízemí přístupné, schody na terasu, horní místnost s dveřmi na terasu',
  generate(p, seed, material) {
    const W = n(p, 'width'), D = n(p, 'depth'), H = 2.9, t = 0.25, roofT = 0.22;
    const parts: Part[] = [];
    const trim = 'sandstone';
    const win = (u: number) => ({ u, w: 1.0, bottom: 0.95, top: 2.05 });
    // Přízemí: dveře vpředu, okna všude.
    const ground: RoomSpec = {
      W, D, H, t, wall: material, trim,
      doors: ['front'],
      windows: { front: [win(-W / 2 + 1.4), win(W / 2 - 1.4)], back: [win(-W / 4), win(W / 4)], left: [win(0)], right: [win(-D / 4)] },
      doorW: 1.1, doorH: 2.2,
    };
    parts.push(...room(ground));
    const y1 = H + roofT;
    parts.push({ shape: 'box', pos: [0, H + roofT / 2, 0], size: [W + 0.3, roofT, D + 0.3], material: 'concreteLight', collide: true });
    // Horní místnost vzadu (60 % hloubky), terasa vpředu.
    const D2 = Math.round(D * 0.55 * 2) / 2, z2 = D / 2 - D2 / 2;
    const upper: Part[] = [];
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const f = facade(side, W, D2);
      const along = side === 'front' || side === 'back';
      const len = along ? W : D2 - 2 * t;
      const ops = side === 'front' ? [{ u: W / 4, width: 1.05, bottom: 0, top: 2.15 }, { u: -W / 4, width: 1.2, bottom: 0.95, top: 2.05 }] : side === 'back' ? [{ u: 0, width: 1.2, bottom: 0.95, top: 2.05 }] : [{ u: 0, width: 0.9, bottom: 1.0, top: 2.0 }];
      upper.push(...wallWithOpenings(f, len, H, t, ops, material));
      for (const o of ops) upper.push(...openingFrame(f, o, t, trim, o.bottom > 0.05));
    }
    for (const q of upper) parts.push({ ...q, pos: [q.pos[0], q.pos[1] + y1, q.pos[2] + z2] });
    parts.push({ shape: 'box', pos: [0, y1 + H + roofT / 2, z2], size: [W + 0.3, roofT, D2 + 0.3], material: 'concreteLight', collide: true });
    // Atika horní střechy.
    const yTop = y1 + H + roofT;
    for (const [x, z, sx, sz] of [
      [0, z2 - D2 / 2 - 0.05, W + 0.3, 0.2],
      [0, z2 + D2 / 2 + 0.05, W + 0.3, 0.2],
      [-W / 2 - 0.05, z2, 0.2, D2 + 0.1],
      [W / 2 + 0.05, z2, 0.2, D2 + 0.1],
    ] as const)
      parts.push({ shape: 'box', pos: [x, yTop + 0.25, z], size: [sx, 0.5, sz], material, collide: true });
    // Zábradlí terasy (zděné, 1 m) s mezerou pro schodiště vpravo.
    const zT0 = -D / 2 - 0.05, zT1 = z2 - D2 / 2;
    const stairs = !!p.stairs;
    const gap: [number, number] = [-D / 2 + 0.3, -D / 2 + 1.5];
    parts.push({ shape: 'box', pos: [0, y1 + 0.5, zT0], size: [W + 0.3, 1.0, 0.2], material, collide: true });
    parts.push({ shape: 'box', pos: [-W / 2 - 0.05, y1 + 0.5, (zT0 + zT1) / 2], size: [0.2, 1.0, zT1 - zT0], material, collide: true });
    if (stairs) {
      if (gap[0] > zT0) parts.push({ shape: 'box', pos: [W / 2 + 0.05, y1 + 0.5, (zT0 + gap[0]) / 2], size: [0.2, 1.0, gap[0] - zT0], material, collide: true });
      parts.push({ shape: 'box', pos: [W / 2 + 0.05, y1 + 0.5, (gap[1] + zT1) / 2], size: [0.2, 1.0, zT1 - gap[1]], material, collide: true });
    } else parts.push({ shape: 'box', pos: [W / 2 + 0.05, y1 + 0.5, (zT0 + zT1) / 2], size: [0.2, 1.0, zT1 - zT0], material, collide: true });
    for (const q of [[0, zT0], [-W / 2 - 0.05, (zT0 + zT1) / 2]] as const) parts.push({ shape: 'box', pos: [q[0], y1 + 1.03, q[1]], size: q[0] === 0 ? [W + 0.36, 0.06, 0.26] : [0.26, 0.06, zT1 - zT0], material: trim });
    // Stříška nad terasou (pergola) – jen část, ať je terasa vidět.
    for (let i = 0; i < 4; i++) parts.push({ shape: 'box', pos: [-W / 2 + 0.5 + i * 0.5, y1 + 2.5, (zT0 + zT1) / 2], size: [0.08, 0.1, zT1 - zT0], material: 'woodDark' });
    if (stairs) {
      // Venkovní schodiště podél pravé stěny: nahoru směrem dopředu, na konci podesta u mezery.
      const sw = 1.0, xs = W / 2 + 0.15 + sw / 2;
      const zTop = gap[1];
      const run = y1 / 0.62;
      const zLow = zTop + run;
      parts.push({ shape: 'box', pos: [xs, y1 / 2, (gap[0] + gap[1]) / 2], size: [sw, y1, gap[1] - gap[0]], material, collide: true });
      const steps = Math.round(y1 / 0.18);
      for (let i = 0; i < steps; i++) {
        const top = y1 - i * (y1 / steps);
        parts.push({ shape: 'box', pos: [xs, top / 2, zTop + (i + 0.5) * (run / steps)], size: [sw, top, run / steps], material });
      }
      parts.push({ shape: 'wedge', pos: [xs, y1 / 2, (zTop + zLow) / 2], size: [sw, y1, run], rot: [0, Math.PI, 0], material, collide: true, render: false });
      // Zábradlí schodiště (vnější strana).
      const len = Math.hypot(y1, run), ang = Math.atan2(y1, run);
      parts.push({ shape: 'box', pos: [xs + sw / 2 - 0.03, y1 / 2 + 0.95, (zTop + zLow) / 2], rot: [-ang, 0, 0], size: [0.05, 0.05, len], material: 'metal' });
      parts.push({ shape: 'box', pos: [xs + sw / 2 - 0.03, y1 / 2 + 0.5, (zTop + zLow) / 2], rot: [-ang, 0, 0], size: [0.06, 1.0, len], material: 'metal', collide: true, render: false, moveOnly: true });
      for (let i = 0; i <= 4; i++) {
        const z = zTop + (i / 4) * run, y = y1 * (1 - i / 4);
        parts.push({ shape: 'box', pos: [xs + sw / 2 - 0.03, y + 0.48, z], size: [0.04, 0.96, 0.04], material: 'metal' });
      }
    }
    // Střešní výbava: nádrž na nohách, klimatizace, anténa.
    if (p.tank) {
      const tx = -W / 2 + 1.2, tz = z2 + D2 / 2 - 1.1, L = 0.9;
      parts.push({ shape: 'cylinder', pos: [tx, yTop + L + 0.6, tz], size: [1.1, 1.2, 1.1], material: 'rubber', collide: true });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [tx + sx * 0.38, yTop + L / 2, tz + sz * 0.38], size: [0.06, L, 0.06], material: 'metal' });
      parts.push({ shape: 'box', pos: [tx, yTop + L - 0.03, tz], size: [0.9, 0.06, 0.9], material: 'metal', collide: true });
    }
    const r = rng(seed);
    parts.push({ shape: 'box', pos: [W / 2 - 1, yTop + 0.25, z2 + (r() - 0.5)], size: [0.8, 0.5, 0.35], material: 'acUnit', collide: true });
    parts.push(limb([W / 2 - 0.6, yTop, z2 + D2 / 2 - 0.5], [W / 2 - 0.6, yTop + 2.5, z2 + D2 / 2 - 0.5], 0.04, 0.03, 'metal'));
    // Klimatizace na fasádě a markýza nad vchodem.
    parts.push({ shape: 'box', pos: [W / 2 - 1.4, 2.3, -D / 2 - 0.25], size: [0.8, 0.5, 0.35], material: 'acUnit' });
    parts.push({ shape: 'box', pos: [0, 2.45, -D / 2 - 0.45], rot: [0.12, 0, 0], size: [1.8, 0.05, 0.9], material: 'metalSheet' });
    return parts;
  },
});
