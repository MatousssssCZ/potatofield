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

export type PalmKind = 'date' | 'slender';

export interface PalmSpec {
  kind: PalmKind;
  /** Výška kmene (m). */
  height: number;
  /** Náklon kmene (rad) a jeho směr (rad, kolem svislé osy). */
  lean: number;
  leanDir: number;
  /** Počet zelených listů. */
  fronds: number;
  /** Převislost listů 0 (tuhé, vzhůru) – 1 (silně převislé). */
  droop: number;
  /** Suché visící listy pod korunou. */
  dead: boolean;
  /** Výška paty kmene (záhon). */
  base?: number;
}

/**
 * Palma: kmen po oblouku (náklon roste nahoru), pod korunou zbytky řapíků, koruna z listů
 * ve fylotaxi (zlatý úhel): mladé listy vzhůru a kratší, starší delší a obloukem dolů,
 * nejstarší suché visí. Datlovník = silný kmen s kosočtverečnými bázemi, hustá kulovitá
 * koruna šedozelených tuhých listů; štíhlá palma = tenký prohnutý kmen, méně širších převislých listů.
 */
export function palmParts(sp: PalmSpec, seed: number): Part[] {
  const r = rng(seed);
  const date = sp.kind === 'date';
  const H = sp.height, y0 = sp.base ?? 0;
  const bark = date ? 'palmBarkDate' : 'palmBark';
  const parts: Part[] = [];
  const dx = Math.cos(sp.leanDir), dz = Math.sin(sp.leanDir);
  const seg = 8;
  const pts: [number, number, number][] = [];
  const wob = (r() - 0.5) * 0.5;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    // Štíhlá palma se prohýbá víc (esovitě), datlovník roste skoro rovně.
    const off = Math.sin(sp.lean) * H * Math.pow(t, date ? 1.8 : 1.5) * 0.9;
    const side = Math.sin(t * Math.PI) * wob * (date ? 0.1 : 0.35);
    pts.push([dx * off - dz * side, y0 + H * t, dz * off + dx * side]);
  }
  const d0 = date ? 0.72 : 0.4, d1 = date ? 0.56 : 0.26;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    // Báze kmene rozšířená, jinak plynulé zúžení.
    const w = (t: number) => d0 + (d1 - d0) * t + (t < 0.15 ? (0.15 - t) * (date ? 1.4 : 1.0) : 0);
    parts.push(limb(pts[i], pts[i + 1], w(t0) + 0.01, w(t1), bark, t0 < 0.6));
  }
  parts.push({ shape: 'cylinder', pos: [pts[0][0], y0 + 0.15, pts[0][2]], size: [d0 * 1.45, 0.3, d0 * 1.45], taper: 0.7, material: bark });
  const T = pts[seg];
  const P = pts[seg - 1];
  const up = [T[0] - P[0], T[1] - P[1], T[2] - P[2]];
  const ul = Math.hypot(up[0], up[1], up[2]);
  const at = (k: number): [number, number, number] => [T[0] + (up[0] / ul) * k, T[1] + (up[1] / ul) * k, T[2] + (up[2] / ul) * k];
  // Hlava: krček z bází listů (zužuje se nahoru) a pahýly starých řapíků.
  parts.push(limb(at(-0.7), at(0.35), d1 * 1.25, d1 * 0.55, bark));
  const stubs = date ? 16 : 8;
  for (let i = 0; i < stubs; i++) {
    const az = i * 2.39996 + r() * 0.3;
    const h = -0.15 - (i / stubs) * (date ? 0.9 : 0.5);
    const a = at(h);
    const L = (date ? 0.45 : 0.3) + r() * 0.15;
    const el = -0.2 - r() * 0.5;
    const b: [number, number, number] = [a[0] + Math.sin(az) * Math.cos(el) * L, a[1] + Math.sin(el) * L, a[2] + Math.cos(az) * Math.cos(el) * L];
    parts.push(limb(a, b, date ? 0.16 : 0.1, 0.05, bark));
  }
  // Listy.
  const F = Math.max(4, Math.round(sp.fronds));
  const Lf = (date ? 3.0 : 3.4) + H * (date ? 0.13 : 0.16);
  const droop = Math.max(0, Math.min(1, sp.droop));
  const greens = date ? ['palmFrondDate', 'palmFrondDate', 'palmFrondDate', 'palmFrond'] : ['palmFrond', 'palmFrond', 'palmFrond', 'palmFrondDate'];
  for (let i = 0; i < F; i++) {
    const age = (i + r() * 0.6) / F; // 0 nejmladší (střed koruny) → 1 nejstarší
    const az = i * 2.39996 + (r() - 0.5) * 0.35;
    const el = (date ? 1.2 : 1.0) - age * (date ? 1.75 : 1.35) + (r() - 0.5) * 0.3;
    const L = Lf * (0.6 + 0.4 * Math.min(1, age * 1.6)) * (0.9 + r() * 0.2);
    const sag = L * (0.08 + (0.2 + 0.6 * droop) * Math.pow(age, 0.7)) * (0.85 + r() * 0.3) * (date ? 1 : 1.35);
    const a = at(-0.05 - age * (date ? 0.45 : 0.3));
    const out = 0.08 + age * 0.12;
    parts.push({
      shape: 'frond',
      pos: [a[0] + Math.sin(az) * out, a[1], a[2] + Math.cos(az) * out],
      rot: eulerYXZ(az, Math.PI / 2 - el, 0),
      size: [(date ? 1.35 : 1.45) * (0.85 + r() * 0.3), L, 0],
      bend: sag,
      fold: (date ? 0.8 : 0.5) * (1 - age * 0.35),
      twist: (r() - 0.5) * 0.8,
      material: greens[Math.floor(r() * greens.length)],
    });
  }
  if (sp.dead) {
    const D = Math.round(F * (date ? 0.22 : 0.3));
    for (let i = 0; i < D; i++) {
      const az = r() * Math.PI * 2;
      const a = at(-0.5 - r() * 0.5);
      parts.push({
        shape: 'frond',
        pos: [a[0] + Math.sin(az) * 0.2, a[1], a[2] + Math.cos(az) * 0.2],
        rot: eulerYXZ(az, Math.PI / 2 + 1.15 + r() * 0.3, 0),
        size: [0.8, Lf * (0.6 + r() * 0.25), 0],
        bend: 0.15,
        fold: 0.25,
        twist: (r() - 0.5) * 1.2,
        material: 'palmFrondDry',
      });
    }
  }
  return parts;
}

const KIND_OPTIONS = [
  { value: 'date', label: 'Datlovník (silný kmen, hustá koruna)' },
  { value: 'slender', label: 'Štíhlá palma (prohnutý kmen, převislé listy)' },
];

registerAsset({
  assetId: 'nature.palm',
  label: 'Palma',
  category: 'nature',
  generatorVersion: 1,
  sizeParams: { y: 'height' },
  params: [
    { key: 'kind', label: 'Druh', type: 'enum', default: 'date', options: KIND_OPTIONS },
    { key: 'height', label: 'Výška kmene', type: 'number', min: 2, max: 16, step: 0.5, unit: 'm', default: 7 },
    { key: 'lean', label: 'Náklon', type: 'number', min: 0, max: 35, step: 1, unit: '°', default: 6 },
    { key: 'fronds', label: 'Počet listů', type: 'int', min: 8, max: 48, default: 30 },
    { key: 'droop', label: 'Převislost listů', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'dead', label: 'Suché visící listy', type: 'bool', default: true },
  ],
  materials: ['palmBarkDate'],
  defaultMaterial: 'palmBarkDate',
  describe: (p) => `kmen ${n(p, 'height').toFixed(1)} m, ${n(p, 'fronds')} listů`,
  generate(p, seed) {
    return palmParts({ kind: p.kind as PalmKind, height: n(p, 'height'), lean: (n(p, 'lean') * Math.PI) / 180, leanDir: 0, fronds: n(p, 'fronds'), droop: n(p, 'droop'), dead: !!p.dead }, seed);
  },
});

/**
 * Náhodná palma kolem zadaného průměru: každé vložení (nové semínko) dá trochu jinou výšku,
 * náklon a jeho směr, počet listů a převislost; rozptyl drží „Míra rozdílů“ (0 = stejné).
 */
export function randomPalmSpec(kind: string, height: number, variance: number, seed: number): PalmSpec {
  const r = rng(seed ^ 0x5bd1e995);
  const v = Math.max(0, Math.min(1, variance));
  const k: PalmKind = kind === 'mix' ? (r() < 0.5 ? 'date' : 'slender') : (kind as PalmKind);
  const sym = () => r() * 2 - 1;
  return {
    kind: k,
    height: Math.max(2, height * (1 + sym() * 0.25 * v)),
    lean: ((3 + r() * 6 + r() * 14 * v) * Math.PI) / 180,
    leanDir: r() * Math.PI * 2,
    fronds: (k === 'date' ? 30 : 22) * (1 + sym() * 0.25 * v),
    droop: 0.5 + sym() * 0.3 * v,
    dead: r() < 0.6,
  };
}

const RANDOM_PARAMS = [
  { key: 'kind', label: 'Druh', type: 'enum' as const, default: 'date', options: [...KIND_OPTIONS, { value: 'mix', label: 'Mix obou druhů' }] },
  { key: 'height', label: 'Průměrná výška', type: 'number' as const, min: 2, max: 16, step: 0.5, unit: 'm', default: 7 },
  { key: 'variance', label: 'Míra rozdílů', type: 'number' as const, min: 0, max: 1, step: 0.05, default: 0.4 },
];

registerAsset({
  assetId: 'nature.palmRandom',
  label: 'Random palma',
  category: 'nature',
  generatorVersion: 1,
  sizeParams: { y: 'height' },
  params: RANDOM_PARAMS,
  materials: ['palmBarkDate'],
  defaultMaterial: 'palmBarkDate',
  describe: () => 'každá vložená palma je trochu jiná (výška, náklon, listy)',
  generate(p, seed) {
    return palmParts(randomPalmSpec(String(p.kind), n(p, 'height'), n(p, 'variance'), seed), seed);
  },
});

registerAsset({
  assetId: 'nature.palmPlanter',
  label: 'Palma v záhonu',
  category: 'nature',
  generatorVersion: 1,
  sizeParams: { x: 'size', z: 'size' },
  params: [
    { key: 'shape', label: 'Tvar záhonu', type: 'enum', default: 'square', options: [{ value: 'square', label: 'Čtvercový' }, { value: 'round', label: 'Kruhový' }] },
    { key: 'size', label: 'Šířka záhonu', type: 'number', min: 1, max: 4, step: 0.1, unit: 'm', default: 1.8 },
    { key: 'rim', label: 'Výška obruby', type: 'number', min: 0.15, max: 1, step: 0.05, unit: 'm', default: 0.45 },
    ...RANDOM_PARAMS,
  ],
  materials: ['stoneWall', 'sandstone', 'concrete', 'concreteLight', 'plasterWarm', 'brick'],
  defaultMaterial: 'sandstone',
  describe: (p) => `záhon ${n(p, 'size').toFixed(1)} m, obruba ${n(p, 'rim').toFixed(2)} m`,
  generate(p, seed, material) {
    const S = n(p, 'size'), R = n(p, 'rim'), t = 0.2;
    const parts: Part[] = [];
    if (p.shape === 'round') {
      // Kruhová obruba z krátkých kvádrů po obvodu.
      const k = Math.max(10, Math.round(S * 7));
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        const rr = S / 2 - t / 2;
        parts.push({ shape: 'box', pos: [Math.sin(a) * rr, R / 2, Math.cos(a) * rr], rot: [0, a, 0], size: [(Math.PI * S) / k + 0.02, R, t], material, collide: true });
      }
      parts.push({ shape: 'cylinder', pos: [0, R - 0.12, 0], size: [S - t * 1.5, 0.1, S - t * 1.5], material: 'dirt' });
    } else {
      for (const sx of [-1, 1]) parts.push({ shape: 'box', pos: [(sx * (S - t)) / 2, R / 2, 0], size: [t, R, S], material, collide: true });
      for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [0, R / 2, (sz * (S - t)) / 2], size: [S - 2 * t, R, t], material, collide: true });
      // Krycí deska obruby (lehce přečnívá) a zemina uvnitř.
      for (const sx of [-1, 1]) parts.push({ shape: 'box', pos: [(sx * (S - t)) / 2, R + 0.03, 0], size: [t + 0.05, 0.06, S + 0.05], material });
      for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [0, R + 0.03, (sz * (S - t)) / 2], size: [S - 2 * t - 0.01, 0.06, t + 0.05], material });
      parts.push({ shape: 'box', pos: [0, R - 0.12, 0], size: [S - 2 * t, 0.1, S - 2 * t], material: 'dirt' });
    }
    const sp = randomPalmSpec(String(p.kind), n(p, 'height'), n(p, 'variance'), seed);
    sp.base = R - 0.08;
    sp.lean = Math.min(sp.lean, 0.12); // v záhonu rostou rovně
    parts.push(...palmParts(sp, seed));
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
