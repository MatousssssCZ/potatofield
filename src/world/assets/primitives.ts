import { rng } from '../../shared/math';
import type { Part } from '../parts';
import { registerAsset, type Params } from '../registry';

const n = (p: Params, k: string) => p[k] as number;

const SURFACE_MATERIALS = ['concrete', 'plaster', 'plasterWarm', 'brick', 'paintedMetal', 'wood', 'asphalt', 'paving', 'sandstone'];

registerAsset({
  assetId: 'prim.box',
  label: 'Kvádr',
  category: 'primitives',
  generatorVersion: 1,
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 0.05, max: 200, step: 0.05, unit: 'm', default: 2 },
    { key: 'height', label: 'Výška', type: 'number', min: 0.05, max: 100, step: 0.05, unit: 'm', default: 2 },
    { key: 'depth', label: 'Hloubka', type: 'number', min: 0.05, max: 200, step: 0.05, unit: 'm', default: 2 },
  ],
  materials: SURFACE_MATERIALS,
  defaultMaterial: 'concrete',
  generate(p, _seed, material) {
    const w = n(p, 'width'), h = n(p, 'height'), d = n(p, 'depth');
    return [{ shape: 'box', pos: [0, h / 2, 0], size: [w, h, d], material, collide: true }];
  },
});

registerAsset({
  assetId: 'prim.ramp',
  label: 'Rampa / svah',
  category: 'primitives',
  generatorVersion: 1,
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 0.5, max: 50, step: 0.25, unit: 'm', default: 3 },
    { key: 'length', label: 'Délka (půdorys)', type: 'number', min: 0.5, max: 50, step: 0.25, unit: 'm', default: 4 },
    { key: 'angleDeg', label: 'Sklon', type: 'number', min: 1, max: 75, step: 1, unit: '°', default: 30 },
  ],
  materials: SURFACE_MATERIALS,
  defaultMaterial: 'concrete',
  generate(p, _seed, material) {
    const w = n(p, 'width'), l = n(p, 'length');
    const h = l * Math.tan((n(p, 'angleDeg') * Math.PI) / 180);
    return [{ shape: 'wedge', pos: [0, h / 2, 0], size: [w, h, l], material, collide: true }];
  },
});

registerAsset({
  assetId: 'prim.cylinder',
  label: 'Válec / sloup',
  category: 'primitives',
  generatorVersion: 1,
  params: [
    { key: 'diameter', label: 'Průměr', type: 'number', min: 0.05, max: 20, step: 0.05, unit: 'm', default: 0.6 },
    { key: 'height', label: 'Výška', type: 'number', min: 0.05, max: 50, step: 0.05, unit: 'm', default: 3 },
  ],
  materials: SURFACE_MATERIALS,
  defaultMaterial: 'concrete',
  generate(p, _seed, material) {
    const d = n(p, 'diameter'), h = n(p, 'height');
    return [{ shape: 'cylinder', pos: [0, h / 2, 0], size: [d, h, d], material, collide: true }];
  },
});

registerAsset({
  assetId: 'cover.crate',
  label: 'Dřevěná bedna',
  category: 'cover',
  generatorVersion: 1,
  params: [],
  materials: ['wood', 'woodDark'],
  defaultMaterial: 'wood',
  uniformScale: { min: 0.6, max: 1.6 },
  generate(_p, _seed, material) {
    const s = 1.0;
    const parts: Part[] = [{ shape: 'box', pos: [0, s / 2, 0], size: [s - 0.04, s - 0.04, s - 0.04], material, collide: false }];
    // Rám hran – dává bedně hloubku místo ploché krychle.
    const t = 0.08, e = s / 2 - t / 2;
    for (const y of [t / 2, s - t / 2]) {
      parts.push({ shape: 'box', pos: [0, y, e], size: [s, t, t], material: 'woodDark' });
      parts.push({ shape: 'box', pos: [0, y, -e], size: [s, t, t], material: 'woodDark' });
      parts.push({ shape: 'box', pos: [e, y, 0], size: [t, t, s - 2 * t], material: 'woodDark' });
      parts.push({ shape: 'box', pos: [-e, y, 0], size: [t, t, s - 2 * t], material: 'woodDark' });
    }
    for (const x of [-e, e]) for (const z of [-e, e]) parts.push({ shape: 'box', pos: [x, s / 2, z], size: [t, s - 2 * t, t], material: 'woodDark' });
    // Diagonální výztuha na dvou stranách.
    const diag = Math.hypot(s - 2 * t, s - 2 * t);
    parts.push({ shape: 'box', pos: [0, s / 2, e + 0.01], rot: [0, 0, Math.PI / 4], size: [diag, t * 0.9, 0.03], material: 'woodDark' });
    parts.push({ shape: 'box', pos: [0, s / 2, -e - 0.01], rot: [0, 0, -Math.PI / 4], size: [diag, t * 0.9, 0.03], material: 'woodDark' });
    parts.push({ shape: 'box', pos: [0, s / 2, 0], size: [s, s, s], material, collide: true, render: false });
    return parts;
  },
});

registerAsset({
  assetId: 'cover.barrel',
  label: 'Sud',
  category: 'cover',
  generatorVersion: 1,
  params: [],
  materials: ['paintedMetal', 'paintedMetalBlue', 'paintedMetalRed'],
  defaultMaterial: 'paintedMetal',
  uniformScale: { min: 0.8, max: 1.3 },
  generate(_p, _seed, material) {
    const d = 0.6, h = 0.88;
    return [
      { shape: 'cylinder', pos: [0, h / 2, 0], size: [d, h, d], material, collide: true },
      { shape: 'cylinder', pos: [0, h * 0.33, 0], size: [d + 0.025, 0.035, d + 0.025], material },
      { shape: 'cylinder', pos: [0, h * 0.67, 0], size: [d + 0.025, 0.035, d + 0.025], material },
      { shape: 'cylinder', pos: [0, h - 0.01, 0], size: [d + 0.02, 0.03, d + 0.02], material: 'metal' },
    ];
  },
});

registerAsset({
  assetId: 'cover.barrier',
  label: 'Betonová bariéra',
  category: 'cover',
  generatorVersion: 1,
  params: [{ key: 'length', label: 'Délka', type: 'number', min: 1, max: 6, step: 0.5, unit: 'm', default: 3 }],
  materials: ['concrete', 'concreteLight'],
  defaultMaterial: 'concreteLight',
  generate(p, _seed, material) {
    const l = n(p, 'length');
    // Profil typu "New Jersey": široká pata, zkosení, úzký hřbet.
    return [
      { shape: 'box', pos: [0, 0.04, 0], size: [l, 0.08, 0.6], material, collide: true },
      { shape: 'wedge', pos: [0, 0.08 + 0.14, -0.21], size: [l, 0.28, 0.18], material, collide: true },
      { shape: 'wedge', pos: [0, 0.08 + 0.14, 0.21], rot: [0, Math.PI, 0], size: [l, 0.28, 0.18], material, collide: true },
      { shape: 'box', pos: [0, 0.08 + 0.4, 0], size: [l, 0.8, 0.24], material, collide: true },
    ];
  },
});

registerAsset({
  assetId: 'range.target',
  label: 'Terč / figurína',
  category: 'range',
  generatorVersion: 1,
  params: [
    { key: 'moving', label: 'Pohyblivý', type: 'bool', default: false },
    { key: 'amplitude', label: 'Rozkmit', type: 'number', min: 0, max: 20, step: 0.5, unit: 'm', default: 4 },
    { key: 'speed', label: 'Rychlost', type: 'number', min: 0, max: 8, step: 0.1, unit: 'm/s', default: 2 },
  ],
  materials: ['target'],
  defaultMaterial: 'target',
  generate() {
    // Statický stojan; vlastní figurína je runtime entita (může se pohybovat).
    return [
      { shape: 'box', pos: [0, 0.05, 0], size: [0.9, 0.1, 0.5], material: 'paintedMetal', collide: true },
      { shape: 'box', pos: [-0.3, 0.3, 0], size: [0.05, 0.5, 0.05], material: 'metal' },
      { shape: 'box', pos: [0.3, 0.3, 0], size: [0.05, 0.5, 0.05], material: 'metal' },
    ];
  },
});

registerAsset({
  assetId: 'range.sign',
  label: 'Cedule se vzdáleností',
  category: 'range',
  generatorVersion: 1,
  params: [{ key: 'text', label: 'Text', type: 'string', default: '10 m' }],
  materials: ['paintedMetal'],
  defaultMaterial: 'paintedMetal',
  generate(p) {
    return [
      { shape: 'box', pos: [0, 0.45, 0], size: [0.06, 0.9, 0.06], material: 'metal', collide: false },
      { shape: 'box', pos: [0, 1.05, 0], size: [0.9, 0.4, 0.04], material: 'paintedMetal', collide: false },
      { shape: 'label', pos: [0, 1.05, 0.025], size: [0.82, 0.32, 0], material: 'label', text: String(p.text) },
      { shape: 'label', pos: [0, 1.05, -0.025], rot: [0, Math.PI, 0], size: [0.82, 0.32, 0], material: 'label', text: String(p.text) },
    ];
  },
});

registerAsset({
  assetId: 'range.meterLine',
  label: 'Metrová značka',
  category: 'range',
  generatorVersion: 1,
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 0.5, max: 50, step: 0.5, unit: 'm', default: 6 },
    { key: 'major', label: 'Hlavní', type: 'bool', default: false },
  ],
  materials: ['paint'],
  defaultMaterial: 'paint',
  generate(p) {
    const major = p.major as boolean;
    return [
      { shape: 'box', pos: [0, 0.004, 0], size: [n(p, 'width'), 0.008, major ? 0.12 : 0.04], material: major ? 'paint' : 'paintDim', castShadow: false },
    ];
  },
});

registerAsset({
  assetId: 'cover.sandbags',
  label: 'Pytle s pískem',
  category: 'cover',
  generatorVersion: 1,
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 1, max: 8, step: 0.5, unit: 'm', default: 2.5 },
    { key: 'rows', label: 'Řady', type: 'int', min: 1, max: 4, step: 1, default: 3 },
  ],
  materials: ['fabricSand'],
  defaultMaterial: 'fabricSand',
  generate(p, seed, material) {
    const l = n(p, 'length'), rows = n(p, 'rows');
    const r = rng(seed);
    const bagL = 0.55, bagH = 0.17, bagD = 0.34;
    const parts: Part[] = [];
    for (let row = 0; row < rows; row++) {
      const count = Math.max(1, Math.round(l / bagL));
      const step = l / count;
      const off = row % 2 ? step / 2 : 0;
      for (let i = 0; i < count - (row % 2 ? 1 : 0); i++) {
        const x = -l / 2 + step / 2 + i * step + off;
        parts.push({
          shape: 'box',
          pos: [x, bagH / 2 + row * (bagH * 0.92), (r() - 0.5) * 0.04],
          rot: [0, (r() - 0.5) * 0.12, (r() - 0.5) * 0.05],
          size: [step * 0.97, bagH, bagD],
          material,
        });
      }
    }
    parts.push({ shape: 'box', pos: [0, (rows * bagH * 0.92) / 2, 0], size: [l, rows * bagH * 0.92, bagD], material, collide: true, render: false });
    return parts;
  },
});
