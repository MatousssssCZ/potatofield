import { rng } from '../../shared/math';
import type { Part } from '../parts';
import { registerAsset, type Params } from '../registry';

/** Krycí prvky ve stylu starší vojenské FPS (vlastní modely, žádné převzaté assety). */
const n = (p: Params, k: string) => p[k] as number;

registerAsset({
  assetId: 'cover.hesco',
  label: 'HESCO bariéra (gabion)',
  category: 'cover',
  generatorVersion: 1,
  sizeParams: { x: 'cells' },
  params: [
    { key: 'cells', label: 'Počet buněk', type: 'int', min: 1, max: 20, step: 1, default: 4 },
    { key: 'tiers', label: 'Patra', type: 'int', min: 1, max: 2, step: 1, default: 1 },
    { key: 'cell', label: 'Velikost buňky', type: 'number', min: 0.6, max: 1.5, step: 0.1, unit: 'm', default: 1.0 },
  ],
  materials: ['hescoFill'],
  defaultMaterial: 'hescoFill',
  describe: (p) => `${n(p, 'cells') * n(p, 'cell')} m × ${(n(p, 'tiers') * n(p, 'cell') * 1.2).toFixed(1)} m`,
  generate(p, seed) {
    const c = n(p, 'cell'), cells = n(p, 'cells'), tiers = n(p, 'tiers');
    const h = c * 1.2;
    const L = c * cells;
    const r = rng(seed);
    const parts: Part[] = [];
    for (let t = 0; t < tiers; t++) {
      // Horní patro je posunuté dovnitř (pyramidová stavba), jako u skutečných valů.
      const cnt = t === 0 ? cells : Math.max(1, cells - 1);
      const off = t === 0 ? 0 : c / 2;
      for (let i = 0; i < cnt; i++) {
        const x = -L / 2 + off + (i + 0.5) * c, y = t * h + h / 2;
        const bulge = 0.03 + r() * 0.03;
        parts.push({ shape: 'box', pos: [x, y - 0.02, 0], size: [c - 0.03 + bulge, h - 0.06, c - 0.03 + bulge], material: 'hescoFill' });
        // Drátěný rám: svislé a vodorovné pruty na lících.
        for (const sz of [-1, 1]) {
          for (let k = 0; k <= 3; k++) parts.push({ shape: 'box', pos: [x - c / 2 + (k * c) / 3, y, (sz * (c + bulge)) / 2], size: [0.018, h, 0.018], material: 'metal', castShadow: false });
          for (let k = 0; k <= 3; k++) parts.push({ shape: 'box', pos: [x, t * h + (k * h) / 3 + 0.01, (sz * (c + bulge)) / 2], size: [c, 0.018, 0.018], material: 'metal', castShadow: false });
        }
        parts.push({ shape: 'box', pos: [x, (t + 1) * h - 0.01, 0], size: [c - 0.1, 0.04, c - 0.1], material: 'sand' });
      }
      parts.push({ shape: 'box', pos: [off / 2 * (t ? 1 : 0), t * h + h / 2, 0], size: [cnt * c, h, c], material: 'hescoFill', collide: true, render: false });
    }
    return parts;
  },
});

registerAsset({
  assetId: 'cover.hedgehog',
  label: 'Protitankový ježek',
  category: 'cover',
  generatorVersion: 1,
  params: [],
  materials: ['metal', 'burntMetal'],
  defaultMaterial: 'burntMetal',
  uniformScale: { min: 0.7, max: 1.4 },
  generate(_p, _seed, material) {
    const L = 2.0, w = 0.16;
    const c = 0.62; // střed nad zemí
    const t = Math.atan(Math.SQRT1_2);
    return [
      { shape: 'box', pos: [0, c, 0], rot: [0, 0, Math.PI / 4 + 0.2], size: [L, w, w], material, collide: true },
      { shape: 'box', pos: [0, c, 0], rot: [Math.PI / 4 + 0.2, 0, 0], size: [w, w, L], material, collide: true },
      { shape: 'box', pos: [0, c, 0], rot: [t, Math.PI / 4, -0.3], size: [w, L, w], material, collide: true },
      { shape: 'box', pos: [0, c, 0], size: [0.3, 0.3, 0.3], material: 'metal' },
    ];
  },
});

registerAsset({
  assetId: 'cover.block',
  label: 'Betonový blok',
  category: 'cover',
  generatorVersion: 1,
  params: [{ key: 'size', label: 'Velikost', type: 'enum', default: 'large', options: [
    { value: 'small', label: 'Malý 0,8 m' },
    { value: 'large', label: 'Velký 1,2 m' },
    { value: 'long', label: 'Podlouhlý 2,4 m' },
  ] }],
  materials: ['concrete', 'concreteLight', 'concreteDark'],
  defaultMaterial: 'concreteLight',
  generate(p, seed, material) {
    const k = p.size as string;
    const [w, h, d] = k === 'small' ? [0.8, 0.8, 0.8] : k === 'long' ? [2.4, 0.8, 0.8] : [1.2, 1.2, 1.2];
    const r = rng(seed);
    const parts: Part[] = [
      { shape: 'box', pos: [0, h / 2, 0], size: [w, h, d], material, collide: true },
      { shape: 'box', pos: [0, 0.03, 0], size: [w + 0.04, 0.06, d + 0.04], material: 'concreteDark' },
    ];
    // Závěsná oka na horní ploše a odštípnutá hrana.
    for (const sx of [-1, 1]) parts.push({ shape: 'box', pos: [(sx * w) / 4, h + 0.04, 0], size: [0.06, 0.08, 0.12], material: 'metal' });
    if (r() > 0.4) parts.push({ shape: 'wedge', pos: [w / 2 - 0.1, h - 0.06, d / 2 - 0.1], rot: [0, Math.PI / 4, 0], size: [0.3, 0.12, 0.3], material: 'concreteDark' });
    return parts;
  },
});

registerAsset({
  assetId: 'cover.pipe',
  label: 'Betonová roura (průlezná)',
  category: 'cover',
  generatorVersion: 1,
  sizeParams: { x: 'length' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 1, max: 8, step: 0.5, unit: 'm', default: 2.5 },
    { key: 'diameter', label: 'Vnitřní průměr', type: 'number', min: 0.8, max: 2.2, step: 0.1, unit: 'm', default: 1.4 },
  ],
  materials: ['concrete', 'concreteLight'],
  defaultMaterial: 'concrete',
  describe: (p) => (n(p, 'diameter') >= 1.3 ? 'průlezná v dřepu/lehu' : 'průlezná jen vleže'),
  generate(p, _seed, material) {
    const L = n(p, 'length'), ri = n(p, 'diameter') / 2, t = 0.14;
    const R = ri + t / 2;
    const segs = 14;
    const parts: Part[] = [];
    // Dutý válec z kvádrových segmentů → uvnitř lze projít/prolézt, kolize odpovídá.
    const sw = 2 * (ri + t) * Math.tan(Math.PI / segs) + 0.01;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      parts.push({ shape: 'box', pos: [0, ri + t + Math.sin(a) * R, Math.cos(a) * R], rot: [-a, 0, 0], size: [L, sw, t], material, collide: true });
    }
    for (const sx of [-1, 1]) {
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        parts.push({ shape: 'box', pos: [(sx * L) / 2, ri + t + Math.sin(a) * (R + 0.02), Math.cos(a) * (R + 0.02)], rot: [-a, 0, 0], size: [0.12, sw + 0.03, t + 0.06], material });
      }
    }
    return parts;
  },
});

registerAsset({
  assetId: 'cover.pallets',
  label: 'Stoh palet',
  category: 'cover',
  generatorVersion: 1,
  params: [{ key: 'count', label: 'Počet palet', type: 'int', min: 1, max: 12, step: 1, default: 6 }],
  materials: ['wood', 'woodDark'],
  defaultMaterial: 'wood',
  generate(p, seed, material) {
    const r = rng(seed);
    const parts: Part[] = [];
    const ph = 0.144;
    const cnt = n(p, 'count');
    for (let i = 0; i < cnt; i++) {
      const y = i * ph, rot = (r() - 0.5) * 0.12, dx = (r() - 0.5) * 0.06;
      for (let k = 0; k < 5; k++) parts.push({ shape: 'box', pos: [dx - 0.5 + 0.06 + k * 0.22, y + ph - 0.011, 0], rot: [0, rot, 0], size: [0.1, 0.022, 0.8], material });
      for (const z of [-0.34, 0, 0.34]) parts.push({ shape: 'box', pos: [dx, y + 0.06, z], rot: [0, rot, 0], size: [1.2, 0.1, 0.1], material: 'woodDark' });
    }
    parts.push({ shape: 'box', pos: [0, (cnt * ph) / 2, 0], size: [1.2, cnt * ph, 0.8], material, collide: true, render: false });
    return parts;
  },
});

registerAsset({
  assetId: 'cover.rubble',
  label: 'Hromada sutě',
  category: 'cover',
  generatorVersion: 1,
  sizeParams: { x: 'size', z: 'size' },
  params: [{ key: 'size', label: 'Velikost', type: 'number', min: 1.5, max: 8, step: 0.5, unit: 'm', default: 3 }],
  materials: ['concrete', 'brick', 'sandstone'],
  defaultMaterial: 'concrete',
  describe: () => 'statická suť (bez destrukce)',
  generate(p, seed, material) {
    const r = rng(seed);
    const S = n(p, 'size');
    const parts: Part[] = [];
    // Nízký val jako pochozí jádro + náhodné kusy (deterministicky ze seedu).
    parts.push({ shape: 'wedge', pos: [0, S * 0.12, -S * 0.2], size: [S * 0.9, S * 0.24, S * 0.5], material: 'dirt', collide: true });
    parts.push({ shape: 'wedge', pos: [0, S * 0.12, S * 0.2], rot: [0, Math.PI, 0], size: [S * 0.9, S * 0.24, S * 0.5], material: 'dirt', collide: true });
    const chunks = Math.round(S * 6);
    for (let i = 0; i < chunks; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.45;
      const sz = 0.15 + r() * S * 0.12;
      const mat = r() > 0.7 ? 'brick' : r() > 0.3 ? material : 'concreteDark';
      const y = Math.max(0, S * 0.24 * (1 - d / (S * 0.5))) + sz * 0.3;
      parts.push({ shape: 'box', pos: [Math.cos(a) * d, y, Math.sin(a) * d], rot: [r() * 0.8, r() * 3, r() * 0.8], size: [sz * (1 + r()), sz * 0.6, sz], material: mat, collide: sz > 0.35 });
    }
    for (let i = 0; i < 4; i++) {
      parts.push({ shape: 'box', pos: [(r() - 0.5) * S * 0.5, S * 0.2, (r() - 0.5) * S * 0.5], rot: [r() * 1.2, r() * 3, r() * 1.2], size: [0.02, 0.02, 0.8 + r()], material: 'burntMetal' });
    }
    return parts;
  },
});

registerAsset({
  assetId: 'cover.dumpster',
  label: 'Kontejner na odpad',
  category: 'cover',
  generatorVersion: 1,
  params: [],
  materials: ['paintedMetal', 'paintedMetalBlue', 'containerGreen', 'burntMetal'],
  defaultMaterial: 'containerGreen',
  generate(_p, _seed, material) {
    return [
      { shape: 'box', pos: [0, 0.75, 0], size: [1.9, 1.2, 1.1], material, collide: true },
      { shape: 'wedge', pos: [0, 1.42, 0], rot: [0, Math.PI, 0], size: [1.95, 0.14, 1.15], material: 'metal', collide: true },
      { shape: 'box', pos: [0, 1.1, -0.57], size: [2.0, 0.08, 0.06], material: 'metal' },
      ...[-0.8, 0.8].flatMap((x) => [-0.4, 0.4].map((z) => ({ shape: 'cylinder' as const, pos: [x, 0.08, z] as [number, number, number], rot: [Math.PI / 2, 0, 0] as [number, number, number], size: [0.16, 0.06, 0.16] as [number, number, number], material: 'rubber' }))),
    ];
  },
});

registerAsset({
  assetId: 'cover.tires',
  label: 'Stoh pneumatik',
  category: 'cover',
  generatorVersion: 1,
  params: [{ key: 'count', label: 'Počet', type: 'int', min: 1, max: 8, step: 1, default: 4 }],
  materials: ['rubber'],
  defaultMaterial: 'rubber',
  generate(p, seed) {
    const r = rng(seed);
    const cnt = n(p, 'count');
    const parts: Part[] = [];
    for (let i = 0; i < cnt; i++) {
      const dx = (r() - 0.5) * 0.08, dz = (r() - 0.5) * 0.08;
      parts.push({ shape: 'cylinder', pos: [dx, 0.11 + i * 0.22, dz], size: [0.75, 0.22, 0.75], material: 'rubber' });
      parts.push({ shape: 'cylinder', pos: [dx, 0.11 + i * 0.22 + 0.112, dz], size: [0.42, 0.005, 0.42], material: 'concreteDark', castShadow: false });
    }
    parts.push({ shape: 'cylinder', pos: [0, (cnt * 0.22) / 2, 0], size: [0.75, cnt * 0.22, 0.75], material: 'rubber', collide: true, render: false });
    return parts;
  },
});

registerAsset({
  assetId: 'cover.spool',
  label: 'Kabelový buben',
  category: 'cover',
  generatorVersion: 1,
  params: [{ key: 'lying', label: 'Na boku', type: 'bool', default: false }],
  materials: ['wood', 'woodDark'],
  defaultMaterial: 'wood',
  uniformScale: { min: 0.7, max: 1.6 },
  generate(p, _seed, material) {
    const D = 1.4, W = 1.0;
    if (p.lying)
      return [
        { shape: 'cylinder', pos: [0, 0.04, 0], size: [D, 0.08, D], material, collide: true },
        { shape: 'cylinder', pos: [0, W - 0.04, 0], size: [D, 0.08, D], material, collide: true },
        { shape: 'cylinder', pos: [0, W / 2, 0], size: [0.6, W, 0.6], material: 'woodDark', collide: true },
      ];
    return [
      { shape: 'cylinder', pos: [-W / 2 + 0.04, D / 2, 0], rot: [0, 0, Math.PI / 2], size: [D, 0.08, D], material, collide: true },
      { shape: 'cylinder', pos: [W / 2 - 0.04, D / 2, 0], rot: [0, 0, Math.PI / 2], size: [D, 0.08, D], material, collide: true },
      { shape: 'cylinder', pos: [0, D / 2, 0], rot: [0, 0, Math.PI / 2], size: [0.6, W, 0.6], material: 'woodDark', collide: true },
      { shape: 'cylinder', pos: [0, D / 2, 0], rot: [0, 0, Math.PI / 2], size: [1.0, W - 0.2, 1.0], material: 'rubber' },
    ];
  },
});

registerAsset({
  assetId: 'cover.sandbagNest',
  label: 'Pytlové stanoviště (U)',
  category: 'cover',
  generatorVersion: 1,
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 1.5, max: 5, step: 0.5, unit: 'm', default: 2.5 },
    { key: 'rows', label: 'Řady', type: 'int', min: 2, max: 6, step: 1, default: 4 },
  ],
  materials: ['fabricSand'],
  defaultMaterial: 'fabricSand',
  generate(p, seed, material) {
    const r = rng(seed);
    const W = n(p, 'width'), rows = n(p, 'rows');
    const bagL = 0.55, bagH = 0.16, bagD = 0.34;
    const parts: Part[] = [];
    const wall = (cx: number, cz: number, len: number, rotY: number) => {
      for (let row = 0; row < rows; row++) {
        const count = Math.max(1, Math.round(len / bagL));
        const step = len / count;
        for (let i = 0; i < count - (row % 2); i++) {
          const t = -len / 2 + step / 2 + i * step + (row % 2 ? step / 2 : 0);
          const x = cx + Math.cos(rotY) * t, z = cz - Math.sin(rotY) * t;
          parts.push({ shape: 'box', pos: [x, bagH / 2 + row * bagH * 0.92, z], rot: [0, rotY + (r() - 0.5) * 0.12, (r() - 0.5) * 0.05], size: [step * 0.97, bagH, bagD], material });
        }
      }
      parts.push({ shape: 'box', pos: [cx, (rows * bagH * 0.92) / 2, cz], rot: [0, rotY, 0], size: [len, rows * bagH * 0.92, bagD], material, collide: true, render: false });
    };
    // Čelní stěna k −Z, dvě boční stěny; vstup zezadu.
    wall(0, -W / 2, W + bagD, 0);
    wall(-W / 2, 0, W - bagD, Math.PI / 2);
    wall(W / 2, 0, W - bagD, Math.PI / 2);
    return parts;
  },
});

registerAsset({
  assetId: 'cover.wire',
  label: 'Ostnatý drát (konzertina)',
  category: 'cover',
  generatorVersion: 1,
  sizeParams: { x: 'length' },
  params: [{ key: 'length', label: 'Délka', type: 'number', min: 1, max: 30, step: 0.5, unit: 'm', default: 6 }],
  materials: ['metal'],
  defaultMaterial: 'metal',
  describe: () => 'zastaví pěšáka, střely projdou',
  generate(p, _seed, material) {
    const L = n(p, 'length'), R = 0.45;
    const parts: Part[] = [];
    const loops = Math.round(L / 0.25);
    for (let i = 0; i < loops; i++) {
      const x = -L / 2 + (i + 0.5) * (L / loops);
      parts.push({ shape: 'cylinder', pos: [x, R, 0], rot: [0, 0, Math.PI / 2 + 0.25], size: [R * 2, 0.01, R * 2], material, castShadow: false });
    }
    for (let k = 0; k * 3 <= L; k++) parts.push({ shape: 'box', pos: [-L / 2 + k * 3, 0.5, 0], size: [0.04, 1.0, 0.04], material: 'burntMetal' });
    parts.push({ shape: 'box', pos: [0, R, 0], size: [L, R * 2, R * 2], material, collide: true, render: false, moveOnly: true });
    return parts;
  },
});

registerAsset({
  assetId: 'cover.carWreck',
  label: 'Vrak auta (statický)',
  category: 'cover',
  generatorVersion: 1,
  params: [],
  materials: ['burntMetal', 'paintedMetalBlue', 'paintedMetalRed', 'paintedMetal'],
  defaultMaterial: 'burntMetal',
  describe: () => 'jen kryt – žádná vozidla v pilotu',
  generate(_p, _seed, material) {
    const parts: Part[] = [
      // Spodek, kabina (klíny pro skla), kapota, kufr; ráfky bez pneumatik.
      { shape: 'box', pos: [0, 0.55, 0], size: [1.75, 0.6, 4.3], material, collide: true },
      { shape: 'box', pos: [0, 1.1, 0.25], size: [1.55, 0.5, 1.9], material, collide: true },
      { shape: 'wedge', pos: [0, 1.1, -0.95], rot: [0, Math.PI, 0], size: [1.55, 0.5, 0.6], material: 'burntMetal', collide: true },
      { shape: 'wedge', pos: [0, 1.1, 1.45], size: [1.55, 0.5, 0.5], material: 'burntMetal', collide: true },
      { shape: 'box', pos: [0, 1.1, 0.25], size: [1.57, 0.36, 1.6], material: 'concreteDark' },
      { shape: 'box', pos: [0, 0.32, -2.17], size: [1.8, 0.2, 0.08], material: 'metal' },
      { shape: 'box', pos: [0, 0.32, 2.17], size: [1.8, 0.2, 0.08], material: 'metal' },
    ];
    for (const sx of [-1, 1]) for (const sz of [-1.35, 1.35]) parts.push({ shape: 'cylinder', pos: [sx * 0.78, 0.3, sz], rot: [0, 0, Math.PI / 2], size: [0.42, 0.18, 0.42], material: 'burntMetal' });
    return parts;
  },
});
