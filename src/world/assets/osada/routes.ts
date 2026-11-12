import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import { registerAsset, type Params } from '../../registry';
import { slopeBox } from '../kit';
import { offsetCurve, parsePoints, sampleCurve, type Pt } from '../roads';
import { bool, num, osadaMeta, str } from './common';

/**
 * Trasové objekty Skladové osady – vertikální řez:
 *  R01/R03 cesta (asfalt / hlína, společný generátor s povrchem jako parametrem),
 *  F01/F04 plot a zeď (společný trasový generátor: pletivo / omítaná zeď).
 * Uzly trasy jsou body „x,z;…“ v lokálních souřadnicích (pivot = první uzel), editují se úchopy.
 */

export const SURFACES = [
  { value: 'asphalt', label: 'R01 Asfalt' },
  { value: 'gravel', label: 'R02 Štěrk' },
  { value: 'dirt', label: 'R03 Hlína' },
  { value: 'concrete', label: 'R04 Beton' },
  { value: 'paving', label: 'R05 Dlažba' },
];
const SURFACE_MAT: Record<string, string> = { asphalt: 'asphalt', gravel: 'gravel', dirt: 'dirt', concrete: 'concrete', paving: 'paving' };
/** Krajnice podle povrchu (rozpad okraje do okolního terénu). */
const SHOULDER_MAT: Record<string, string> = { asphalt: 'gravel', gravel: 'dirt', dirt: 'sand', concrete: 'gravel', paving: 'sand' };

function lengthOf(c: Pt[]) {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
  return s;
}

/** Nejmenší poloměr zatáčky vzorkované trasy (pro kontrolu samopřekryvu u široké cesty). */
export function minRadius(c: Pt[]): number {
  let r = Infinity;
  for (let i = 1; i + 1 < c.length; i++) {
    const a = c[i - 1], b = c[i], d = c[i + 1];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bd = Math.hypot(d[0] - b[0], d[1] - b[1]), ad = Math.hypot(d[0] - a[0], d[1] - a[1]);
    const cross = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]));
    if (cross < 1e-9) continue;
    r = Math.min(r, (ab * bd * ad) / (2 * cross));
  }
  return r;
}

registerAsset({
  assetId: 'osada.road',
  label: osadaMeta('osada.road', 'R01', 'Cesta (asfalt / štěrk / hlína)', 'B'),
  category: 'osada',
  generatorVersion: 1,
  params: [
    { key: 'points', label: 'Uzly trasy', type: 'points', default: '0,0;30,0' },
    { key: 'width', label: 'Šířka', type: 'number', min: 2.5, max: 12, step: 0.25, unit: 'm', default: 6 },
    { key: 'surface', label: 'Povrch', type: 'enum', default: 'asphalt', options: SURFACES },
    { key: 'shoulder', label: 'Šířka krajnice', type: 'number', min: 0, max: 2, step: 0.1, unit: 'm', default: 0.7 },
    { key: 'ragged', label: 'Nepravidelnost okraje', type: 'number', min: 0, max: 0.5, step: 0.05, unit: 'm', default: 0.2 },
    { key: 'follow', label: 'Kopírovat terén', type: 'bool', default: true },
  ],
  usesTerrain: (p) => bool(p, 'follow'),
  materials: ['asphalt'],
  defaultMaterial: 'asphalt',
  describe(p) {
    const pts = parsePoints(str(p, 'points'));
    return `${pts.length} uzlů, délka ${lengthOf(sampleCurve(pts, 1)).toFixed(1)} m · ${SURFACES.find((s) => s.value === p.surface)?.label} · táhni uzly, „+“ přidá uzel, Shift+klik smaže`;
  },
  validate(p) {
    const out: string[] = [];
    const c = sampleCurve(parsePoints(str(p, 'points')), 1);
    const r = minRadius(c);
    if (r < num(p, 'width') / 2 + num(p, 'shoulder')) out.push(`nejostřejší zatáčka má poloměr ${r.toFixed(1)} m, menší než polovina šířky – okraje se překryjí; uzly roztáhni`);
    return out;
  },
  generate(p, seed, _material, ctx) {
    const pts = parsePoints(str(p, 'points'));
    if (pts.length < 2) return [];
    const W = num(p, 'width'), sh = num(p, 'shoulder'), rag = num(p, 'ragged');
    const surf = str(p, 'surface');
    const c = sampleCurve(pts, 1.5);
    const follow = bool(p, 'follow');
    // Různé cesty o milimetry jinak vysoko → křížení neblikají.
    const lift = 0.035 + (seed % 7) * 0.003;
    const y = (q: Pt) => (follow ? ctx.ground(q[0], q[1]) : 0);
    const path = (curve: Pt[], dy: number): [number, number, number][] => curve.map((q) => [q[0], y(q) + dy, q[1]]);
    const parts: Part[] = [{ shape: 'strip', pos: [0, 0, 0], size: [W, 0.2, 0], path: path(c, lift), material: SURFACE_MAT[surf] ?? 'asphalt', castShadow: false }];
    if (sh > 0) {
      // Krajnice: dva pásy s deterministicky zvlněným vnějším okrajem (seed) – okraj není pravítko.
      const r = rng(seed ^ 0x5eed);
      for (const s of [-1, 1]) {
        const wob = c.map(() => (r() - 0.5) * 2 * rag);
        // Vyhlazení šumu, ať okraj nevypadá zubatě.
        const sm = wob.map((_, i) => (wob[Math.max(0, i - 1)] + wob[i] * 2 + wob[Math.min(wob.length - 1, i + 1)]) / 4);
        const base = offsetCurve(c, s * (W / 2 + sh / 2 - 0.05));
        const edge = base.map((q, i) => {
          const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
          const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
          return [q[0] - (tz / l) * s * sm[i], q[1] + (tx / l) * s * sm[i]] as Pt;
        });
        parts.push({ shape: 'strip', pos: [0, 0, 0], size: [sh, 0.2, 0], path: path(edge, lift - 0.012), material: SHOULDER_MAT[surf] ?? 'gravel', castShadow: false });
      }
    }
    return parts;
  },
});

// ---------------------------------------------------------------- F01 / F04 trasový plot a zeď

export const FENCE_KINDS = [
  { value: 'chainlink', label: 'F01 Pletivový plot' },
  { value: 'plaster', label: 'F04 Omítaná zeď' },
];

export interface FenceSegment {
  a: Pt;
  b: Pt;
  len: number;
  fields: number;
}
export interface FenceLayout {
  nodes: Pt[];
  segments: FenceSegment[];
  posts: Pt[];
  closed: boolean;
  spacing: number;
}

/** Rozteč sloupků podle typu (pletivo nejvýš 2,5 m dle zadání). */
export function fenceSpacing(p: Params): number {
  const s = num(p, 'spacing');
  return str(p, 'kind') === 'chainlink' ? Math.min(2.5, s) : s;
}

/**
 * Rozvržení trasy: každý úsek mezi uzly má ⌈délka / rozteč⌉ stejně dlouhých polí (krátké poslední
 * pole se nerobí – rozteč se rozloží rovnoměrně). Každý uzel má právě jeden sloupek, i sdílený.
 */
export function fenceLayout(p: Params): FenceLayout {
  const raw = parsePoints(str(p, 'points'));
  const nodes = raw.filter((q, i) => i === 0 || Math.hypot(q[0] - raw[i - 1][0], q[1] - raw[i - 1][1]) > 0.05);
  const closed = bool(p, 'closed') && nodes.length >= 3;
  const spacing = fenceSpacing(p);
  const segments: FenceSegment[] = [];
  const posts: Pt[] = [];
  const count = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const fields = Math.max(1, Math.ceil(len / spacing - 1e-9));
    segments.push({ a, b, len, fields });
    for (let k = 0; k < fields; k++) posts.push([a[0] + ((b[0] - a[0]) * k) / fields, a[1] + ((b[1] - a[1]) * k) / fields]);
  }
  if (!closed && nodes.length) posts.push(nodes[nodes.length - 1]);
  return { nodes, segments, posts, closed, spacing };
}

registerAsset({
  assetId: 'osada.fence',
  label: osadaMeta('osada.fence', 'F01', 'Plot / zeď po trase', 'C'),
  category: 'osada',
  generatorVersion: 1,
  params: [
    { key: 'points', label: 'Uzly trasy', type: 'points', default: '0,0;12,0' },
    { key: 'kind', label: 'Typ', type: 'enum', default: 'chainlink', options: FENCE_KINDS },
    { key: 'height', label: 'Výška', type: 'number', min: 0.6, max: 3.5, step: 0.05, unit: 'm', default: 2 },
    { key: 'thickness', label: 'Tloušťka zdi', type: 'number', min: 0.2, max: 0.5, step: 0.05, unit: 'm', default: 0.3 },
    { key: 'spacing', label: 'Max. rozteč sloupků / pilířů', type: 'number', min: 1, max: 6, step: 0.25, unit: 'm', default: 2.5 },
    {
      key: 'slope',
      label: 'Ve svahu',
      type: 'enum',
      default: 'copy',
      options: [
        { value: 'copy', label: 'Kopírovat sklon' },
        { value: 'step', label: 'Stupňovat (vodorovná pole)' },
      ],
    },
    { key: 'closed', label: 'Uzavřený okruh', type: 'bool', default: false },
    { key: 'follow', label: 'Kopírovat terén', type: 'bool', default: true },
  ],
  usesTerrain: (p) => bool(p, 'follow'),
  materials: ['plasterWarm', 'plaster', 'plasterWhite', 'plasterOchre', 'concrete'],
  defaultMaterial: 'plasterWarm',
  describe(p) {
    const l = fenceLayout(p);
    const total = l.segments.reduce((s, x) => s + x.len, 0);
    const fields = l.segments.reduce((s, x) => s + x.fields, 0);
    return `${FENCE_KINDS.find((k) => k.value === p.kind)?.label} · ${l.nodes.length} uzlů, ${total.toFixed(1)} m, ${fields} polí, ${l.posts.length} sloupků · rozteč ≤ ${l.spacing} m`;
  },
  validate(p) {
    const out: string[] = [];
    if (str(p, 'kind') === 'chainlink' && num(p, 'spacing') > 2.5) out.push('pletivo má rozteč sloupků nejvýš 2,5 m – použita 2,5 m');
    if (bool(p, 'closed') && fenceLayout(p).nodes.length < 3) out.push('uzavřený okruh potřebuje aspoň 3 uzly');
    return out;
  },
  generate(p, seed, material, ctx) {
    const l = fenceLayout(p);
    if (l.segments.length === 0) return [];
    const H = num(p, 'height');
    const wall = str(p, 'kind') === 'plaster';
    const T = wall ? num(p, 'thickness') : 0.06;
    const step = str(p, 'slope') === 'step';
    const g = (q: Pt) => (bool(p, 'follow') ? ctx.ground(q[0], q[1]) : 0);
    const parts: Part[] = [];
    const r = rng(seed);
    const postW = wall ? T + 0.1 : 0.07;
    // Sloupky / pilíře – jeden na uzel i mezilehlé pole.
    for (const q of l.posts) {
      const y0 = g(q);
      // Ve stupňovaném režimu musí sloupek dosáhnout k vyššímu sousednímu poli.
      const top = H + (step ? 0.25 : 0.06);
      parts.push({ shape: 'box', pos: [q[0], y0 + top / 2 - 0.15, q[1]], size: [postW, top + 0.3, postW], material: wall ? material : 'metal', collide: true });
      if (wall) parts.push({ shape: 'box', pos: [q[0], y0 + top + 0.05 - 0.0, q[1]], size: [postW + 0.06, 0.1, postW + 0.06], material: 'concreteLight', collide: true });
      else parts.push({ shape: 'cylinder', pos: [q[0], y0 + top + 0.02, q[1]], size: [0.09, 0.05, 0.09], material: 'metal' });
    }
    for (const s of l.segments) {
      const ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
      const ux = Math.cos(ang), uz = Math.sin(ang);
      // Pole v lokální ose segmentu: díly natočené kolem Y (−ang, protože Three otáčí +X k −Z).
      for (let k = 0; k < s.fields; k++) {
        const f0 = (k * s.len) / s.fields + postW / 2, f1 = ((k + 1) * s.len) / s.fields - postW / 2;
        const p0: Pt = [s.a[0] + ux * f0, s.a[1] + uz * f0], p1: Pt = [s.a[0] + ux * f1, s.a[1] + uz * f1];
        let g0 = g(p0), g1 = g(p1);
        let below = 0.15;
        if (step) {
          // Vodorovné pole na vyšším konci; spodek sahá pod nižší konec (žádná mezera k podlezení).
          const hi = Math.max(g0, g1), lo = Math.min(g0, g1);
          below = hi - lo + 0.15;
          g0 = g1 = hi;
        }
        const local = (x0: number, y0: number, x1: number, y1: number, bl: number, h: number, t: number, mat: string, extra: Partial<Part> = {}) => {
          const part = slopeBox(0, y0, x1 - x0, y1, bl, h, t, 0, mat, extra);
          // slopeBox staví podél X; přesun na střed pole a natočení podél segmentu.
          const mid = (x0 + x1) / 2;
          part.pos = [s.a[0] + ux * mid, part.pos[1], s.a[1] + uz * mid];
          const roll = part.rot ? part.rot[2] : 0;
          part.rot = [0, -ang, roll];
          return part;
        };
        if (wall) {
          parts.push(local(f0, g0, f1, g1, below, H, T, material, { collide: true }));
          // Krycí deska a sokl (opotřebení u paty přes tmavší pás).
          parts.push(local(f0, g0 + H, f1, g1 + H, 0, 0.07, T + 0.07, 'concreteLight', { collide: true }));
          parts.push(local(f0, g0, f1, g1, Math.min(below, 0.3), 0.3, T + 0.03, 'concreteDark'));
          // Občasná oprýskaná skvrna (deterministicky ze seedu).
          if (r() < 0.35) {
            const at = f0 + (f1 - f0) * (0.2 + r() * 0.6), w = 0.4 + r() * 0.6;
            const y = (g0 + g1) / 2 + 0.4 + r() * (H - 1);
            for (const side of [-1, 1]) {
              const nx = -uz * side * (T / 2 + 0.004), nz = ux * side * (T / 2 + 0.004);
              parts.push({ shape: 'box', pos: [s.a[0] + ux * at + nx, y, s.a[1] + uz * at + nz], rot: [0, -ang, 0], size: [w, w * 0.6, 0.005], material: 'brick', castShadow: false });
            }
          }
        } else {
          // Pletivo: horní napínací drát, spodní drát, výplň (pohyb blokuje, střely projdou).
          parts.push(local(f0, g0 + H - 0.02, f1, g1 + H - 0.02, 0, 0.03, 0.03, 'metal'));
          parts.push(local(f0, g0 + 0.06, f1, g1 + 0.06, 0, 0.02, 0.02, 'metal'));
          parts.push(local(f0, g0, f1, g1, below - 0.1, H - 0.04, 0.01, 'chainLink', { castShadow: false }));
          parts.push(local(f0, g0, f1, g1, below, H, 0.06, 'chainLink', { render: false, collide: true, moveOnly: true }));
        }
      }
    }
    return parts;
  },
});
