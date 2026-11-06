import { rng } from '../../shared/math';
import type { Part } from '../parts';
import { registerAsset, type Params } from '../registry';

/**
 * Příroda: palmy, listnaté stromy, keře, kameny. Vlastní procedurální tvary (deformované koule,
 * oboustranné karty s alfa výřezem) – žádné převzaté modely. Kolidují jen kmeny a kameny;
 * listí střely i hráče propouští (jako v BF2 – keř zakrývá výhled, ne kulky).
 */
const n = (p: Params, k: string) => p[k] as number;

/**
 * Euler XYZ pro natočení R = Ry(yaw) · Rx(pitch) · Rz(roll) (díly mají jen pořadí XYZ).
 */
export function eulerYXZ(yaw: number, pitch: number, roll = 0): [number, number, number] {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), cb = Math.cos(pitch), sb = Math.sin(pitch), cc = Math.cos(roll), sc = Math.sin(roll);
  const mul = (A: number[][], B: number[][]) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const Ry = [[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]];
  const Rx = [[1, 0, 0], [0, cb, -sb], [0, sb, cb]];
  const Rz = [[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]];
  const m = mul(mul(Ry, Rx), Rz);
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  if (Math.abs(m[0][2]) < 0.9999) return [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), y, 0];
}

/** Válcový segment z bodu a do bodu b (kmen, větev). */
export function limb(a: [number, number, number], b: [number, number, number], d0: number, d1: number, material: string, collide = false): Part {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  // Válec má osu +Y: natočit ji do směru (dx, dy, dz).
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
  return {
    shape: 'cylinder',
    pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rot: eulerYXZ(yaw, pitch),
    size: [d0, len, d0],
    taper: d1 / d0,
    material,
    collide,
  };
}

/** Koruna z koulí a listových karet kolem povrchu (rozbije obrys). */
export function foliage(center: [number, number, number], size: [number, number, number], seed: number, crownMat: string, leafMat: string, blobs: number, cards: number, cardSize: number): Part[] {
  const r = rng(seed);
  const out: Part[] = [];
  for (let i = 0; i < blobs; i++) {
    const k = i === 0 ? 0 : 1;
    const s: [number, number, number] = [size[0] * (0.36 + r() * 0.16), size[1] * (0.34 + r() * 0.12), size[2] * (0.36 + r() * 0.16)];
    out.push({
      shape: 'blob',
      pos: [center[0] + k * (r() - 0.5) * size[0] * 0.5, center[1] + k * (r() - 0.75) * size[1] * 0.3, center[2] + k * (r() - 0.5) * size[2] * 0.5],
      size: s,
      seed: Math.floor(r() * 1e6),
      rough: 0.7,
      material: crownMat,
    });
  }
  for (let i = 0; i < cards; i++) {
    // Bod na povrchu elipsoidu koruny; karta je tečná k povrchu (normála ven), část leží navrchu.
    const az = r() * Math.PI * 2;
    const top = i % 4 === 0;
    const el = top ? 0.9 + r() * 0.5 : (r() - 0.35) * 1.1;
    const dx = Math.cos(el) * Math.sin(az), dy = Math.sin(el), dz = Math.cos(el) * Math.cos(az);
    const s = cardSize * (0.8 + r() * 0.5);
    const tilt = top ? -1.2 - r() * 0.3 : -el * 0.6 + (r() - 0.5) * 0.4;
    const base: [number, number, number] = [center[0] + dx * size[0] * 0.4 * (0.75 + r() * 0.35), center[1] + dy * size[1] * 0.4 - s * 0.5 * Math.cos(tilt), center[2] + dz * size[2] * 0.4 * (0.75 + r() * 0.35)];
    out.push({ shape: 'card', pos: base, rot: eulerYXZ(az, tilt, (r() - 0.5) * 0.8), size: [s, s, 0], material: leafMat, castShadow: true });
  }
  return out;
}

registerAsset({
  assetId: 'nature.palm',
  label: 'Palma',
  category: 'nature',
  generatorVersion: 1,
  sizeParams: { y: 'height' },
  params: [
    { key: 'height', label: 'Výška', type: 'number', min: 4, max: 15, step: 0.5, unit: 'm', default: 9 },
    { key: 'lean', label: 'Náklon', type: 'number', min: 0, max: 30, step: 1, unit: '°', default: 8 },
    { key: 'fronds', label: 'Počet listů', type: 'int', min: 6, max: 18, default: 13 },
    { key: 'dead', label: 'Suché visící listy', type: 'bool', default: true },
  ],
  materials: ['palmBark'],
  defaultMaterial: 'palmBark',
  describe: (p) => `kmen ${n(p, 'height').toFixed(1)} m, koruna ⌀ ~${(n(p, 'height') * 0.55 + 2).toFixed(0)} m`,
  generate(p, seed, material) {
    const H = n(p, 'height'), lean = (n(p, 'lean') * Math.PI) / 180;
    const r = rng(seed);
    const parts: Part[] = [];
    // Kmen: oblouk v rovině XY (náklon k +X), ohyb sílí nahoru.
    const seg = 7;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      pts.push([Math.sin(lean) * H * t * t * 0.9, H * t, (r() - 0.5) * 0.06 * i]);
    }
    for (let i = 0; i < seg; i++) {
      const t = i / seg;
      const d0 = 0.44 - 0.14 * t, d1 = 0.44 - 0.14 * ((i + 1) / seg);
      parts.push(limb(pts[i], pts[i + 1], d0 + 0.01, d1, material, i < 4));
    }
    parts.push({ shape: 'cylinder', pos: [0, 0.18, 0], size: [0.62, 0.36, 0.62], taper: 0.75, material });
    const top = pts[seg];
    // Hlava: koule zbytků řapíků.
    parts.push({ shape: 'blob', pos: [top[0], top[1] - 0.15, top[2]], size: [0.75, 0.9, 0.75], seed: Math.floor(r() * 1e6), rough: 0.4, material: 'palmBark' });
    const F = n(p, 'fronds');
    const len = 2.6 + H * 0.17;
    for (let i = 0; i < F; i++) {
      const az = (i / F) * Math.PI * 2 + r() * 0.4;
      const up = i % 4 === 0 ? 0.55 + r() * 0.2 : 1.05 + r() * 0.35; // většina listů do stran, pár vzhůru
      parts.push({ shape: 'card', pos: [top[0], top[1], top[2]], rot: eulerYXZ(az, up, (r() - 0.5) * 0.3), size: [1.1 + r() * 0.3, len * (0.85 + r() * 0.3), 0], bend: -len * (0.45 + r() * 0.2), material: 'palmFrond' });
    }
    if (p.dead) {
      for (let i = 0; i < 5; i++) {
        const az = r() * Math.PI * 2;
        parts.push({ shape: 'card', pos: [top[0], top[1] - 0.3, top[2]], rot: eulerYXZ(az, 2.6 + r() * 0.3, 0), size: [0.8, len * 0.7, 0], bend: -0.2, material: 'leafDry' });
      }
    }
    return parts;
  },
});

registerAsset({
  assetId: 'nature.tree',
  label: 'Listnatý strom (oliva)',
  category: 'nature',
  generatorVersion: 1,
  sizeParams: { y: 'height', x: 'crown' },
  params: [
    { key: 'height', label: 'Výška', type: 'number', min: 3, max: 12, step: 0.5, unit: 'm', default: 6 },
    { key: 'crown', label: 'Šířka koruny', type: 'number', min: 2, max: 10, step: 0.5, unit: 'm', default: 5 },
    {
      key: 'kind',
      label: 'Druh listí',
      type: 'enum',
      default: 'olive',
      options: [
        { value: 'olive', label: 'Olivové (šedozelené)' },
        { value: 'green', label: 'Zelené' },
      ],
    },
  ],
  materials: ['bark'],
  defaultMaterial: 'bark',
  generate(p, seed, material) {
    const H = n(p, 'height'), C = n(p, 'crown');
    const r = rng(seed);
    const green = p.kind === 'green';
    const parts: Part[] = [];
    // Pokroucený kmen, který se ve 40 % výšky rozvětví do 2–3 větví.
    const fork = H * 0.4;
    const lean: [number, number, number] = [(r() - 0.5) * 0.6, fork, (r() - 0.5) * 0.6];
    parts.push(limb([0, 0, 0], [lean[0] * 0.4, fork * 0.5, lean[2] * 0.4], 0.42, 0.36, material, true));
    parts.push(limb([lean[0] * 0.4, fork * 0.5, lean[2] * 0.4], lean, 0.36, 0.3, material, true));
    const nb = 2 + Math.floor(r() * 2);
    const crownY = H - C * 0.28;
    for (let i = 0; i < nb; i++) {
      const az = (i / nb) * Math.PI * 2 + r();
      const end: [number, number, number] = [lean[0] + Math.sin(az) * C * 0.28, crownY, lean[2] + Math.cos(az) * C * 0.28];
      parts.push(limb(lean, end, 0.26, 0.12, material));
    }
    parts.push(...foliage([lean[0], crownY + C * 0.05, lean[2]], [C, C * 0.62, C], Math.floor(r() * 1e6), green ? 'crownGreen' : 'crownOlive', green ? 'leafGreen' : 'leafOlive', 5, 44, Math.max(1.2, C * 0.4)));
    return parts;
  },
});

registerAsset({
  assetId: 'nature.shrub',
  label: 'Keř',
  category: 'nature',
  generatorVersion: 1,
  uniformScale: { min: 0.5, max: 2.5 },
  params: [
    {
      key: 'kind',
      label: 'Druh',
      type: 'enum',
      default: 'green',
      options: [
        { value: 'green', label: 'Zelený' },
        { value: 'olive', label: 'Šedozelený' },
        { value: 'dry', label: 'Suchý' },
      ],
    },
    { key: 'size', label: 'Velikost', type: 'number', min: 0.5, max: 3, step: 0.1, unit: 'm', default: 1.3 },
  ],
  materials: ['leafGreen'],
  defaultMaterial: 'leafGreen',
  describe: () => 'zakrývá výhled, nezastaví střely ani pohyb',
  generate(p, seed) {
    const S = n(p, 'size');
    const k = p.kind as string;
    const crownMat = k === 'olive' ? 'crownOlive' : 'crownGreen';
    const leaf = k === 'olive' ? 'leafOlive' : k === 'dry' ? 'leafDry' : 'leafGreen';
    const parts = foliage([0, S * 0.4, 0], [S * 1.2, S * 0.85, S * 1.2], seed, crownMat, leaf, k === 'dry' ? 0 : 3, k === 'dry' ? 16 : 14, S * 0.8);
    return parts;
  },
});

registerAsset({
  assetId: 'nature.cycad',
  label: 'Nízká palma (cykas)',
  category: 'nature',
  generatorVersion: 1,
  uniformScale: { min: 0.5, max: 2 },
  params: [{ key: 'leaves', label: 'Počet listů', type: 'int', min: 6, max: 20, default: 12 }],
  materials: ['palmFrond'],
  defaultMaterial: 'palmFrond',
  generate(p, seed) {
    const r = rng(seed);
    const parts: Part[] = [{ shape: 'cylinder', pos: [0, 0.2, 0], size: [0.35, 0.4, 0.35], taper: 0.8, material: 'palmBark' }];
    const L = n(p, 'leaves');
    for (let i = 0; i < L; i++) {
      const az = (i / L) * Math.PI * 2 + r() * 0.3;
      parts.push({ shape: 'card', pos: [0, 0.35, 0], rot: eulerYXZ(az, 0.5 + r() * 0.5, 0), size: [0.7, 1.3 + r() * 0.4, 0], bend: -0.45, material: 'palmFrond' });
    }
    return parts;
  },
});

registerAsset({
  assetId: 'nature.boulder',
  label: 'Balvan',
  category: 'nature',
  generatorVersion: 1,
  sizeParams: { x: 'sx', y: 'sy', z: 'sz' },
  params: [
    { key: 'sx', label: 'Délka', type: 'number', min: 0.4, max: 12, step: 0.1, unit: 'm', default: 3.2 },
    { key: 'sy', label: 'Výška', type: 'number', min: 0.3, max: 6, step: 0.1, unit: 'm', default: 1.6 },
    { key: 'sz', label: 'Šířka', type: 'number', min: 0.4, max: 12, step: 0.1, unit: 'm', default: 2.2 },
    { key: 'rough', label: 'Hrbolatost', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  materials: ['rock', 'rockWarm', 'sandstone'],
  defaultMaterial: 'rock',
  describe: () => `kolize podle tvaru (konvexní obal), zapuštěn 25 % do terénu`,
  generate(p, seed, material) {
    const sx = n(p, 'sx'), sy = n(p, 'sy'), sz = n(p, 'sz');
    // Výška v parametrech = viditelná výška; čtvrtina koule je pod zemí.
    const full = sy / 0.75;
    return [{ shape: 'blob', pos: [0, full / 2 - full * 0.25, 0], size: [sx, full, sz], seed, rough: n(p, 'rough'), material, collide: true }];
  },
});

registerAsset({
  assetId: 'nature.rocks',
  label: 'Skupina kamenů',
  category: 'nature',
  generatorVersion: 1,
  params: [
    { key: 'count', label: 'Počet', type: 'int', min: 2, max: 12, default: 5 },
    { key: 'spread', label: 'Rozptyl', type: 'number', min: 0.5, max: 8, step: 0.1, unit: 'm', default: 2 },
    { key: 'size', label: 'Velikost', type: 'number', min: 0.15, max: 1.5, step: 0.05, unit: 'm', default: 0.5 },
  ],
  materials: ['rock', 'rockWarm', 'sandstone'],
  defaultMaterial: 'rockWarm',
  generate(p, seed, material) {
    const r = rng(seed);
    const parts: Part[] = [];
    const S = n(p, 'size'), R = n(p, 'spread');
    for (let i = 0; i < n(p, 'count'); i++) {
      const s = S * (0.5 + r());
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
      const sy = s * (0.5 + r() * 0.4);
      parts.push({ shape: 'blob', pos: [Math.cos(a) * d, sy * 0.3, Math.sin(a) * d], rot: [0, r() * 6, 0], size: [s * (1 + r() * 0.6), sy, s], seed: Math.floor(r() * 1e6), rough: 0.6, material, collide: s > 0.35 });
    }
    return parts;
  },
});

registerAsset({
  assetId: 'nature.log',
  label: 'Ležící kmen',
  category: 'nature',
  generatorVersion: 1,
  sizeParams: { x: 'length' },
  params: [
    { key: 'length', label: 'Délka', type: 'number', min: 1, max: 10, step: 0.1, unit: 'm', default: 3.5 },
    { key: 'diameter', label: 'Průměr', type: 'number', min: 0.2, max: 1, step: 0.05, unit: 'm', default: 0.45 },
  ],
  materials: ['bark', 'palmBark'],
  defaultMaterial: 'bark',
  generate(p, seed, material) {
    const L = n(p, 'length'), d = n(p, 'diameter');
    const r = rng(seed);
    const parts: Part[] = [{ shape: 'cylinder', pos: [0, d * 0.42, 0], rot: [0, 0, Math.PI / 2], size: [d, L, d], taper: 0.85, material, collide: true }];
    for (let i = 0; i < 2; i++) {
      const x = (r() - 0.5) * L * 0.7;
      parts.push(limb([x, d * 0.6, 0], [x + 0.25, d * 0.9 + 0.3, (r() - 0.5) * 0.5], d * 0.3, d * 0.15, material));
    }
    return parts;
  },
});
