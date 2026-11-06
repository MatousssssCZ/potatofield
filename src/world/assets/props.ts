import { rng } from '../../shared/math';
import type { Part } from '../parts';
import { registerAsset, type Params } from '../registry';

const n = (p: Params, k: string) => p[k] as number;

registerAsset({
  assetId: 'cover.container',
  label: 'Kontejner',
  category: 'cover',
  generatorVersion: 1,
  params: [{ key: 'doorsOpen', label: 'Pootevřené dveře', type: 'bool', default: false }],
  materials: ['containerRed', 'containerBlue', 'containerGreen', 'containerSand'],
  defaultMaterial: 'containerBlue',
  generate(p, _seed, material) {
    const L = 6.06, H = 2.59, W = 2.44;
    const parts: Part[] = [{ shape: 'box', pos: [0, H / 2, 0], size: [L, H, W], material, collide: true }];
    // Rohové sloupky, rámy a dveře s uzávěry – hloubka místo plochého kvádru.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [(sx * (L - 0.16)) / 2, H / 2, (sz * (W - 0.16)) / 2], size: [0.18, H + 0.02, 0.18], material: 'metal' });
      parts.push({ shape: 'box', pos: [(sx * (L - 0.16)) / 2, H - 0.07, 0], size: [0.18, 0.16, W], material: 'metal' });
      parts.push({ shape: 'box', pos: [(sx * (L - 0.16)) / 2, 0.07, 0], size: [0.18, 0.16, W], material: 'metal' });
    }
    for (const sz of [-1, 1]) {
      parts.push({ shape: 'box', pos: [0, H - 0.07, (sz * (W - 0.1)) / 2], size: [L, 0.14, 0.12], material });
      parts.push({ shape: 'box', pos: [0, 0.08, (sz * (W - 0.1)) / 2], size: [L, 0.16, 0.12], material });
    }
    for (const sz of [-1, 1]) {
      for (const k of [0.3, 0.75]) {
        parts.push({ shape: 'box', pos: [L / 2 + 0.03, H / 2, sz * k * (W / 2)], size: [0.04, H - 0.4, 0.05], material: 'metal' });
      }
    }
    parts.push({ shape: 'box', pos: [L / 2 + 0.015, H / 2, 0], size: [0.02, H - 0.3, 0.03], material: 'concreteDark' });
    if (p.doorsOpen) parts.push({ shape: 'box', pos: [L / 2 + 0.55, H / 2, W / 2 + 0.1], rot: [0, -0.9, 0], size: [W / 2, H - 0.3, 0.05], material, collide: true });
    return parts;
  },
});

registerAsset({
  assetId: 'street.acUnit',
  label: 'Klimatizace',
  category: 'street',
  mount: { kind: 'wall', back: 0.175 },
  generatorVersion: 1,
  params: [],
  materials: ['acUnit'],
  defaultMaterial: 'acUnit',
  uniformScale: { min: 0.7, max: 1.6 },
  generate() {
    return [
      { shape: 'box', pos: [0, 0.25, 0], size: [0.8, 0.5, 0.35], material: 'acUnit', collide: true },
      { shape: 'cylinder', pos: [0.15, 0.25, -0.18], rot: [Math.PI / 2, 0, 0], size: [0.36, 0.02, 0.36], material: 'concreteDark' },
      { shape: 'box', pos: [0, 0.52, 0], size: [0.84, 0.04, 0.4], material: 'metal' },
      { shape: 'box', pos: [-0.25, -0.1, 0.1], size: [0.05, 0.2, 0.05], material: 'metal' },
      { shape: 'box', pos: [0.25, -0.1, 0.1], size: [0.05, 0.2, 0.05], material: 'metal' },
    ];
  },
});

registerAsset({
  assetId: 'street.sign',
  label: 'Nápis / cedule',
  category: 'street',
  mount: { kind: 'wall', back: 0.03 },
  generatorVersion: 1,
  sizeParams: { x: 'width' },
  params: [
    { key: 'text', label: 'Text', type: 'string', default: 'CAFÉ NAZIR' },
    { key: 'width', label: 'Šířka', type: 'number', min: 0.6, max: 8, step: 0.1, unit: 'm', default: 2.4 },
    { key: 'posts', label: 'Na sloupcích', type: 'bool', default: false },
  ],
  materials: ['paintedMetal', 'paintedMetalBlue', 'paintedMetalRed', 'wood'],
  defaultMaterial: 'paintedMetalBlue',
  generate(p, _seed, material) {
    const w = n(p, 'width'), h = Math.min(1.0, w * 0.3);
    const y = p.posts ? 2.4 : h / 2;
    const parts: Part[] = [
      { shape: 'box', pos: [0, y, 0], size: [w, h, 0.06], material, collide: true },
      { shape: 'label', pos: [0, y, -0.035], rot: [0, Math.PI, 0], size: [w - 0.12, h - 0.1, 0], material: 'labelSign', text: String(p.text) },
    ];
    if (p.posts) for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [(s * w) / 2.6, (y - h / 2) / 2, 0.06], size: [0.08, y - h / 2, 0.08], material: 'metal', collide: true });
    return parts;
  },
});

registerAsset({
  assetId: 'street.awning',
  label: 'Markýza',
  category: 'street',
  mount: { kind: 'wall', back: 0 },
  generatorVersion: 1,
  sizeParams: { x: 'width', z: 'depth' },
  params: [
    { key: 'width', label: 'Šířka', type: 'number', min: 1, max: 12, step: 0.25, unit: 'm', default: 3 },
    { key: 'depth', label: 'Vyložení', type: 'number', min: 0.6, max: 3, step: 0.1, unit: 'm', default: 1.4 },
  ],
  materials: ['awningRed', 'awningBlue', 'awningGreen', 'awningSand'],
  defaultMaterial: 'awningRed',
  generate(p, _seed, material) {
    const w = n(p, 'width'), d = n(p, 'depth');
    // Montáž na zeď v z = 0, vyložení k −Z. Plachta jen pro střely (pohyb pod ní volný).
    return [
      { shape: 'wedge', pos: [0, -0.25, -d / 2], size: [w, 0.5, d], material, bulletOnly: true, collide: true },
      { shape: 'box', pos: [0, -0.52, -d], size: [w, 0.12, 0.02], material },
      { shape: 'box', pos: [0, 0.02, -0.03], size: [w + 0.1, 0.06, 0.06], material: 'metal' },
    ];
  },
});

registerAsset({
  assetId: 'street.stall',
  label: 'Tržní stánek',
  category: 'street',
  generatorVersion: 1,
  params: [{ key: 'goods', label: 'Zboží', type: 'enum', default: 'fruit', options: [
    { value: 'fruit', label: 'Ovoce' },
    { value: 'cloth', label: 'Látky' },
    { value: 'crates', label: 'Bedny' },
  ] }],
  materials: ['awningRed', 'awningBlue', 'awningGreen', 'awningSand'],
  defaultMaterial: 'awningSand',
  generate(p, seed, material) {
    const r = rng(seed);
    const W = 2.4, D = 1.4;
    const parts: Part[] = [
      { shape: 'box', pos: [0, 0.85, 0], size: [W, 0.06, D], material: 'wood', collide: true },
      { shape: 'box', pos: [0, 0.45, 0.55], size: [W, 0.8, 0.04], material: 'woodDark', collide: true },
      { shape: 'wedge', pos: [0, 2.35, 0], rot: [0, Math.PI, 0], size: [W + 0.4, 0.3, D + 0.6], material, bulletOnly: true, collide: true },
    ];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [(sx * (W - 0.1)) / 2, 1.1, (sz * (D - 0.1)) / 2], size: [0.06, 2.2 + (sz < 0 ? 0.3 : 0), 0.06], material: 'woodDark' });
    const goods = p.goods as string;
    const cols = ['crateFruitA', 'crateFruitB', 'crateFruitC'];
    for (let i = 0; i < 6; i++) {
      const x = -W / 2 + 0.25 + (i % 3) * 0.75 + r() * 0.1, z = i < 3 ? -0.3 : 0.15;
      if (goods === 'cloth') parts.push({ shape: 'box', pos: [x, 0.93, z], rot: [0, r() * 0.3, 0], size: [0.6, 0.1 + r() * 0.08, 0.4], material: ['awningRed', 'awningBlue', 'awningGreen'][i % 3] });
      else {
        parts.push({ shape: 'box', pos: [x, 0.98, z], size: [0.5, 0.2, 0.35], material: 'wood' });
        if (goods === 'fruit') parts.push({ shape: 'box', pos: [x, 1.09, z], size: [0.44, 0.04, 0.3], material: cols[i % 3] });
      }
    }
    return parts;
  },
});
