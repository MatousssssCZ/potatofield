import type { MapObject } from '../../../shared/map/schema';
import type { Part } from '../../parts';
import { registerAsset, resolveParams, getAsset, type GenContext, type Params } from '../../registry';
import { parsePoints, type Pt } from '../roads';
import { bool, num, osadaMeta, str } from './common';
import {
  buildCurve,
  ensureIds,
  formatRanges,
  freshId,
  parseIds,
  parseRanges,
  pointAt,
  project,
  remapRanges,
  resolveSurfaces,
  type CurveMode,
  type PointOp,
  type ResolvedSurfaces,
  type RoadCurve,
} from './roadGraph';

/**
 * R01–R03 (a R04/R05 jako povrch trasy) – cesta jako graf uzlů se stabilními ID.
 *  - úseky povrchu (`ranges`) přes {úsek, t}, přechody na obou hranicích (výchozí 2 m, 0–8 m),
 *    míchané v jedné vrstvě (díl `strip` s `blend`), žádné koplanární překryvy;
 *  - režim osy hladký / lomený (oblouky o zadaném poloměru) / přímý (nejmenší bezpečné zaoblení);
 *  - spoje (`joins`): uzel této cesty leží v uzlu jiné cesty (T nebo X křižovatka). Vedlejší cesta
 *    sleduje polohu uzlu hlavní cesty a končí přesně na jejím okraji (rohy `endCut`) – bez děr.
 */

export const SURFACES = [
  { value: 'asphalt', label: 'R01 Asfalt' },
  { value: 'gravel', label: 'R02 Štěrk' },
  { value: 'dirt', label: 'R03 Hlína' },
  { value: 'concrete', label: 'R04 Beton' },
  { value: 'paving', label: 'R05 Dlažba' },
];
export const SURFACE_MAT: Record<string, string> = { asphalt: 'asphalt', gravel: 'gravel', dirt: 'dirt', concrete: 'concrete', paving: 'paving' };
/** Krajnice podle povrchu (rozpad okraje do okolního terénu). */
export const SHOULDER_MAT: Record<string, string> = { asphalt: 'gravel', gravel: 'dirt', dirt: 'sand', concrete: 'gravel', paving: 'sand' };

/** Nejmenší poloměr zatáčky vzorkované osy (kontrola samopřekryvu u široké cesty). */
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

export interface Join {
  /** Uzel této cesty… */
  node: string;
  /** …leží v uzlu `at` cesty `road` (ID objektu). */
  road: string;
  at: string;
}

export function parseJoins(s: string): Join[] {
  try {
    const v = JSON.parse(String(s || '[]'));
    return Array.isArray(v) ? v.filter((j) => j && j.node && j.road && j.at).map((j) => ({ node: String(j.node), road: String(j.road), at: String(j.at) })) : [];
  } catch {
    return [];
  }
}

export function roadToWorld(o: MapObject, p: Pt): Pt {
  const [px, , pz] = o.transform.position;
  const yaw = o.transform.rotation[1], s = o.transform.scale ?? 1;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  return [px + (c * p[0] + sn * p[1]) * s, pz + (-sn * p[0] + c * p[1]) * s];
}

const curveOf = (p: Params, nodes: Pt[]) => buildCurve(nodes, str(p, 'mode') as CurveMode, 1, cornerRadiusOf(p));

/** Poloměr zaoblení rohů: lomený = zadaný, přímý = nejmenší bezpečný (polovina šířky + krajnice). */
export function cornerRadiusOf(p: Params): number {
  const safe = num(p, 'width') / 2 + num(p, 'shoulder') + 0.3;
  return str(p, 'mode') === 'straight' ? safe : Math.max(0.5, num(p, 'cornerRadius'));
}

export interface OtherRoad {
  id: string;
  curve: RoadCurve;
  W: number;
  sh: number;
}

export interface RoadModel {
  nodes: Pt[];
  ids: string[];
  curve: RoadCurve;
  surfaces: ResolvedSurfaces;
  joins: { join: Join; index: number; other?: OtherRoad }[];
  warnings: string[];
}

/** Ostatní cesta převedená do lokálních souřadnic této cesty (bez jejích vlastních spojů). */
function otherRoad(o: MapObject, ctx: GenContext): OtherRoad {
  const q = resolveParams(getAsset(o.assetId)!, o.params);
  const nodes = parsePoints(str(q, 'points')).map((pt) => ctx.toLocal!(...roadToWorld(o, pt)));
  return { id: o.id, curve: curveOf(q, nodes), W: num(q, 'width'), sh: num(q, 'shoulder') };
}

export function roadModel(p: Params, ctx?: GenContext): RoadModel {
  const nodes = parsePoints(str(p, 'points'));
  const ids = ensureIds(nodes.length, parseIds(str(p, 'nodeIds')));
  const warnings: string[] = [];
  const joins: RoadModel['joins'] = [];
  for (const join of parseJoins(str(p, 'joins'))) {
    const index = ids.indexOf(join.node);
    if (index < 0) continue;
    const o = ctx?.neighbors?.find((x) => x.id === join.road && x.assetId === 'osada.road');
    if (!o || !ctx?.toLocal) {
      if (ctx?.neighbors) warnings.push(`spoj uzlu ${join.node}: cesta ${join.road} na mapě není – uzel zůstává na poslední známé poloze`);
      joins.push({ join, index });
      continue;
    }
    const q = resolveParams(getAsset(o.assetId)!, o.params);
    const oIds = ensureIds(parsePoints(str(q, 'points')).length, parseIds(str(q, 'nodeIds')));
    const k = oIds.indexOf(join.at);
    if (k < 0) {
      warnings.push(`spoj uzlu ${join.node}: uzel ${join.at} na cestě ${join.road} už neexistuje`);
      joins.push({ join, index });
      continue;
    }
    nodes[index] = ctx.toLocal(...roadToWorld(o, parsePoints(str(q, 'points'))[k]));
    joins.push({ join, index, other: otherRoad(o, ctx) });
  }
  const curve = curveOf(p, nodes);
  const surfaces = resolveSurfaces(curve, ids, parseRanges(str(p, 'ranges')), str(p, 'surface'), str(p, 'rangeLength') === 'meters');
  warnings.push(...surfaces.warnings);
  const need = num(p, 'width') / 2 + num(p, 'shoulder');
  // Zakřivení z bodů po ≥ 0,8 m (blízké vzorky by dávaly šum místo poloměru).
  const coarse = curve.pts.filter((q, i, a) => i === 0 || i === a.length - 1 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) >= 0.8);
  const r = str(p, 'mode') === 'smooth' ? minRadius(coarse) : curve.minFillet;
  if (r < need - 0.05) warnings.push(`nejostřejší zatáčka má poloměr ${r.toFixed(1)} m, menší než polovina šířky s krajnicí (${need.toFixed(1)} m) – okraje se překryjí; roztáhni uzly nebo zvětši poloměr`);
  return { nodes, ids, curve, surfaces, joins, warnings };
}

// ------------------------------------------------------------------ geometrie

const left = (dir: Pt): Pt => [-dir[1], dir[0]];
const distToCurve = (c: RoadCurve, q: Pt) => project(c, q).d;
const edgePt = (c: RoadCurve, s: number, off: number): Pt => {
  const { p, dir } = pointAt(c, s);
  const n = left(dir);
  return [p[0] + n[0] * off, p[1] + n[1] * off];
};

/** První s (od `from` směrem `dir`), kde bod na odsazení `off` vyjde z pásu poloměru R kolem jiné osy. */
function exitAt(c: RoadCurve, from: number, dir: 1 | -1, off: number, other: RoadCurve, R: number): number {
  const lim = dir > 0 ? c.total : 0;
  let s = from;
  if (distToCurve(other, edgePt(c, s, off)) >= R) return s;
  for (let k = 0; k < 4000; k++) {
    const n = s + dir * 0.1;
    if ((dir > 0 && n >= lim) || (dir < 0 && n <= lim)) return lim;
    if (distToCurve(other, edgePt(c, n, off)) >= R) {
      // Dorovnání bisekcí.
      let a = s, b = n;
      for (let i = 0; i < 20; i++) {
        const m = (a + b) / 2;
        if (distToCurve(other, edgePt(c, m, off)) >= R) b = m;
        else a = m;
      }
      return b;
    }
    s = n;
  }
  return s;
}

interface Cut {
  a: number;
  b: number;
  endAtA?: { left: Pt; right: Pt };
  startAtB?: { left: Pt; right: Pt };
}

/** Vyřezaný interval vrstvy kolem spoje: rohy přesně na okraji druhé cesty (poloměr R). */
function cutFor(c: RoadCurve, sJoin: number, offL: number, offR: number, other: RoadCurve, R: number): Cut {
  const cut: Cut = { a: 0, b: c.total };
  if (sJoin < c.total - 1e-6) {
    const sl = exitAt(c, sJoin, 1, offL, other, R), sr = exitAt(c, sJoin, 1, offR, other, R), sc = exitAt(c, sJoin, 1, (offL + offR) / 2, other, R);
    cut.b = Math.max(sl, sr, sc);
    if (cut.b < c.total - 1e-6) cut.startAtB = { left: edgePt(c, sl, offL), right: edgePt(c, sr, offR) };
  }
  if (sJoin > 1e-6) {
    const sl = exitAt(c, sJoin, -1, offL, other, R), sr = exitAt(c, sJoin, -1, offR, other, R), sc = exitAt(c, sJoin, -1, (offL + offR) / 2, other, R);
    cut.a = Math.min(sl, sr, sc);
    if (cut.a > 1e-6) cut.endAtA = { left: edgePt(c, sl, offL), right: edgePt(c, sr, offR) };
  }
  return cut;
}

interface Chunk {
  s0: number;
  s1: number;
  from: string;
  to?: string;
  /** Přechod: váha `to` lineárně od t0 do t1. */
  t0?: number;
  t1?: number;
  start?: { left: Pt; right: Pt };
  end?: { left: Pt; right: Pt };
}

/** Rozdělení osy na plné kusy a přechody (navazující, bez překryvů). */
function chunksOf(model: RoadModel, mat: (surface: string) => string): Chunk[] {
  const { pieces, boundaries } = model.surfaces;
  const out: Chunk[] = [];
  const half = boundaries.map((b) => (b.len > 0.05 ? b.len / 2 : 0));
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const a = p.s0 + (i > 0 ? half[i - 1] : 0), b = p.s1 - (i < boundaries.length ? half[i] : 0);
    if (b - a > 1e-4) out.push({ s0: a, s1: b, from: mat(p.surface) });
    if (i < boundaries.length && half[i] > 0) {
      const B = boundaries[i];
      const f = mat(B.from), t = mat(B.to);
      const c: Chunk = { s0: B.s - half[i], s1: B.s + half[i], from: f };
      if (f !== t) Object.assign(c, { to: t, t0: c.s0, t1: c.s1 });
      out.push(c);
    }
  }
  // Sloučit navazující plné kusy stejného materiálu (krajnice mívá stejný materiál přes přechod).
  const merged: Chunk[] = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && !last.to && !c.to && last.from === c.from && Math.abs(last.s1 - c.s0) < 1e-4) last.s1 = c.s1;
    else merged.push({ ...c });
  }
  return merged;
}

function subtractCuts(chunks: Chunk[], cuts: Cut[]): Chunk[] {
  let cur = chunks;
  for (const k of cuts) {
    const next: Chunk[] = [];
    for (const c of cur) {
      if (c.s1 <= k.a + 1e-6 || c.s0 >= k.b - 1e-6) {
        next.push(c);
        continue;
      }
      if (c.s0 < k.a - 1e-3) next.push({ ...c, s1: k.a, end: k.endAtA });
      if (c.s1 > k.b + 1e-3) next.push({ ...c, s0: k.b, start: k.startAtB });
    }
    cur = next;
  }
  return cur;
}

function hashNoise(seed: number) {
  const h = (i: number) => {
    const x = Math.sin(i * 12.9898 + seed * 0.000123) * 43758.5453;
    return x - Math.floor(x);
  };
  return (s: number) => {
    const i = Math.floor(s / 1.5), f = s / 1.5 - i, t = f * f * (3 - 2 * f);
    return h(i) * (1 - t) + h(i + 1) * t - 0.5;
  };
}

/** Lokální vzorky obloukové délky v intervalu (koncové body + vzorky osy uvnitř). */
function sSamples(c: RoadCurve, s0: number, s1: number): number[] {
  const out = [s0];
  for (const s of c.s) if (s > s0 + 0.05 && s < s1 - 0.05) out.push(s);
  out.push(s1);
  return out;
}

export function generateRoad(p: Params, seed: number, ctx: GenContext): Part[] {
  const model = roadModel(p, ctx);
  const c = model.curve;
  if (model.nodes.length < 2 || c.total < 0.1) return [];
  const W = num(p, 'width'), sh = num(p, 'shoulder'), rag = num(p, 'ragged');
  const follow = bool(p, 'follow');
  const joined = model.joins.some((j) => j.other);
  // Různé cesty o milimetry jinak vysoko; vedlejší cesta spoje níž (případný zbytek překryvu zakryje hlavní).
  const lift = 0.035 + (seed % 7) * 0.003 - (joined ? 0.006 : 0);
  const y = (q: Pt) => (follow ? ctx.ground(q[0], q[1]) : 0);
  const parts: Part[] = [];
  const noise = hashNoise(seed);
  const layer = (offL: number, offR: number, mat: (s: string) => string, dy: number, wobble: number, cutR: (o: OtherRoad) => number) => {
    const cuts = model.joins.filter((j) => j.other).map((j) => cutFor(c, c.segStart[Math.min(j.index, c.segStart.length - 1)], offL, offR, j.other!.curve, cutR(j.other!)));
    const width = Math.abs(offL - offR), mid = (offL + offR) / 2;
    for (const ch of subtractCuts(chunksOf(model, mat), cuts)) {
      if (ch.s1 - ch.s0 < 0.02) continue;
      const ss = sSamples(c, ch.s0, ch.s1);
      const path: [number, number, number][] = ss.map((s) => {
        const off = mid + (wobble ? noise(s) * wobble * Math.sign(mid) : 0);
        const q = edgePt(c, s, off);
        return [q[0], y(q) + dy, q[1]];
      });
      const part: Part = { shape: 'strip', pos: [0, 0, 0], size: [width, 0.2, 0], path, material: ch.from, castShadow: false };
      if (ch.to) part.blend = { to: ch.to, w: ss.map((s) => Math.max(0, Math.min(1, (s - ch.t0!) / Math.max(1e-6, ch.t1! - ch.t0!)))) };
      if (ch.start || ch.end) part.endCut = { ...(ch.start ? { start: ch.start } : {}), ...(ch.end ? { end: ch.end } : {}) };
      parts.push(part);
    }
  };
  // Vozovka končí na okraji vozovky hlavní cesty, krajnice na vnějším okraji její krajnice.
  layer(W / 2, -W / 2, (s) => SURFACE_MAT[s] ?? 'asphalt', lift, 0, (o) => o.W / 2);
  if (sh > 0)
    for (const sg of [1, -1]) layer(sg * (W / 2 - 0.05), sg * (W / 2 + sh - 0.05), (s) => SHOULDER_MAT[s] ?? 'gravel', lift - 0.012, rag, (o) => o.W / 2 + o.sh);
  return parts;
}

// ------------------------------------------------------------------ úpravy uzlů v editoru

export function roadEditPoints(p: Params, before: string, after: string, op: PointOp): Params {
  const nb = parsePoints(before), na = parsePoints(after);
  const idsB = ensureIds(nb.length, parseIds(str(p, 'nodeIds')));
  let idsA: string[];
  if (op.kind === 'insert') idsA = [...idsB.slice(0, op.index), freshId(idsB), ...idsB.slice(op.index)];
  else if (op.kind === 'delete') idsA = idsB.filter((_, i) => i !== op.index);
  else if (op.kind === 'create') idsA = ensureIds(na.length, []);
  else idsA = idsB;
  idsA = ensureIds(na.length, idsA);
  const ranges = parseRanges(str(p, 'ranges'));
  const cb = curveOf(p, nb), ca = curveOf(p, na);
  const out: Params = { nodeIds: idsA.join(';') };
  if (ranges.length && op.kind !== 'create') out.ranges = formatRanges(remapRanges(cb, idsB, ca, idsA, ranges, op));
  // Spoj uzlu, který uživatel odtáhl nebo smazal, se ruší (jinak by uzel „skákal“ zpět).
  const joins = parseJoins(str(p, 'joins'));
  if (joins.length && (op.kind === 'move' || op.kind === 'delete')) {
    const gone = idsB[op.index];
    out.joins = JSON.stringify(joins.filter((j) => j.node !== gone));
  }
  return out;
}

registerAsset({
  assetId: 'osada.road',
  label: osadaMeta('osada.road', 'R01', 'Cesta (asfalt / štěrk / hlína)', 'B'),
  category: 'osada',
  generatorVersion: 1,
  params: [
    { key: 'points', label: 'Uzly trasy', type: 'points', default: '0,0;30,0' },
    { key: 'nodeIds', label: 'ID uzlů', type: 'string', default: '', hidden: true },
    {
      key: 'mode',
      label: 'Tvar trasy',
      type: 'enum',
      default: 'smooth',
      options: [
        { value: 'smooth', label: 'Hladký (křivka přes uzly)' },
        { value: 'polyline', label: 'Lomený (úsečky + oblouky)' },
        { value: 'straight', label: 'Přímý (úsečky, nejmenší zaoblení)' },
      ],
    },
    { key: 'cornerRadius', label: 'Poloměr rohů (lomený)', type: 'number', min: 2, max: 60, step: 0.5, unit: 'm', default: 10 },
    { key: 'width', label: 'Šířka', type: 'number', min: 2.5, max: 12, step: 0.25, unit: 'm', default: 6 },
    { key: 'surface', label: 'Povrch (celá trasa)', type: 'enum', default: 'asphalt', options: SURFACES },
    { key: 'ranges', label: 'Úseky povrchu', type: 'string', default: '[]', hidden: true },
    {
      key: 'rangeLength',
      label: 'Úseky při změně délky',
      type: 'enum',
      default: 'ratio',
      options: [
        { value: 'ratio', label: 'Poměrně k délce úseku' },
        { value: 'meters', label: 'Zachovat metry od uzlu' },
      ],
    },
    { key: 'shoulder', label: 'Šířka krajnice', type: 'number', min: 0, max: 2, step: 0.1, unit: 'm', default: 0.7 },
    { key: 'ragged', label: 'Nepravidelnost okraje', type: 'number', min: 0, max: 0.5, step: 0.05, unit: 'm', default: 0.2 },
    { key: 'joins', label: 'Spoje', type: 'string', default: '[]', hidden: true },
    { key: 'follow', label: 'Kopírovat terén', type: 'bool', default: true },
  ],
  usesTerrain: (p) => bool(p, 'follow'),
  materials: ['asphalt'],
  defaultMaterial: 'asphalt',
  describe(p) {
    const m = roadModel(p);
    const pieces = m.surfaces.pieces.length;
    return `${m.nodes.length} uzlů, délka ${m.curve.total.toFixed(1)} m · ${pieces} ${pieces === 1 ? 'povrch' : 'úseků povrchu'}, ${m.surfaces.boundaries.length} přechodů · táhni uzly, „+“ přidá uzel, Shift+klik smaže`;
  },
  validate: (p) => roadModel(p).warnings,
  editPoints: roadEditPoints,
  generate: (p, seed, _material, ctx) => generateRoad(p, seed, ctx),
});
