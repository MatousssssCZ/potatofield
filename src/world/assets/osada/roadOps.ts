import type { MapObject } from '../../../shared/map/schema';
import { getAsset, resolveParams, type Params } from '../../registry';
import { formatPoints, parsePoints, type Pt } from '../roads';
import { cornerRadiusOf, parseJoins, roadEditPoints, roadToWorld, type Join } from './road';
import { buildCurve, ensureIds, formatRanges, freshId, parseIds, parseRanges, pointAt, project, segmentAt, type CurveMode, type RangeRef, type SurfaceRange } from './roadGraph';

/**
 * Operace nad grafem cest (čisté funkce nad MapObject, vrací nové kopie – editor je zabalí do
 * jednoho kroku historie): vložit uzel, rozdělit, spojit konce, větvit z uzlu, T/X křižovatka,
 * hledání křížení bez křižovatky.
 */

const ROAD = 'osada.road';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const P = (o: MapObject): Params => resolveParams(getAsset(o.assetId)!, o.params);
const ptsOf = (o: MapObject) => parsePoints(String(P(o).points));
const idsOf = (o: MapObject) => ensureIds(ptsOf(o).length, parseIds(String(P(o).nodeIds)));

export function toLocal(o: MapObject, w: Pt): Pt {
  const [px, , pz] = o.transform.position;
  const yaw = o.transform.rotation[1], s = o.transform.scale ?? 1;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const dx = (w[0] - px) / s, dz = (w[1] - pz) / s;
  return [c * dx - sn * dz, sn * dx + c * dz];
}

export function roadCurveWorld(o: MapObject) {
  const p = P(o);
  const nodes = ptsOf(o).map((q) => roadToWorld(o, q));
  return { curve: buildCurve(nodes, String(p.mode) as CurveMode, 1, cornerRadiusOf(p)), nodes, ids: idsOf(o), W: Number(p.width), sh: Number(p.shoulder) };
}

/** Vloží uzel do trasy v místě nejbližším světovému bodu w (úseky povrchu se přemapují). */
export function insertNodeAt(o: MapObject, w: Pt): { road: MapObject; nodeId: string; index: number } {
  const wc = roadCurveWorld(o);
  const pr = project(wc.curve, w);
  const seg = segmentAt(wc.curve, pr.s);
  const at = pointAt(wc.curve, pr.s).p;
  // Bod blízko existujícího uzlu = ten uzel.
  for (let i = 0; i < wc.nodes.length; i++) if (Math.hypot(wc.nodes[i][0] - at[0], wc.nodes[i][1] - at[1]) < 0.75) return { road: clone(o), nodeId: wc.ids[i], index: i };
  const pts = ptsOf(o);
  const before = formatPoints(pts);
  pts.splice(seg + 1, 0, toLocal(o, at));
  const after = formatPoints(pts);
  const road = clone(o);
  Object.assign(road.params, { points: after }, roadEditPoints(P(o), before, after, { kind: 'insert', index: seg + 1 }));
  return { road, nodeId: idsOf(road)[seg + 1], index: seg + 1 };
}

/** Ostatní cesty, jejichž spoje míří na uzly `nodeIds` cesty `from` → přesměrovat na `to`. */
function retarget(all: MapObject[], from: string, to: string, nodeIds: Set<string>): MapObject[] {
  const out: MapObject[] = [];
  for (const o of all) {
    if (o.assetId !== ROAD || o.id === from || o.id === to) continue;
    const js = parseJoins(String(P(o).joins));
    if (!js.some((j) => j.road === from && nodeIds.has(j.at))) continue;
    const c = clone(o);
    c.params.joins = JSON.stringify(js.map((j) => (j.road === from && nodeIds.has(j.at) ? { ...j, road: to } : j)));
    out.push(c);
  }
  return out;
}

/** Rozdělí cestu v uzlu `index` na dvě (oba díly sdílí polohu uzlu). Úseky přes dělicí uzel se rozdělí. */
export function splitRoad(o: MapObject, index: number, newId: string, all: MapObject[]): { a: MapObject; b: MapObject; others: MapObject[] } | { error: string } {
  const pts = ptsOf(o), ids = idsOf(o);
  if (index <= 0 || index >= pts.length - 1) return { error: 'rozdělit lze jen ve vnitřním uzlu' };
  const p = P(o);
  const ranges = parseRanges(String(p.ranges));
  const segIdx = (r: RangeRef) => ids.indexOf(r.seg);
  const ra: SurfaceRange[] = [], rb: SurfaceRange[] = [];
  for (const r of ranges) {
    const f = segIdx(r.from), t = segIdx(r.to);
    const lo = Math.min(f, t), hi = Math.max(f, t);
    if (hi < index) ra.push(r);
    else if (lo >= index) rb.push(r);
    else {
      const [first, last] = f <= t ? [r.from, r.to] : [r.to, r.from];
      ra.push({ ...r, from: first, to: { seg: ids[index - 1], t: 1 } });
      rb.push({ ...r, id: `${r.id}b`, from: { seg: ids[index], t: 0 }, to: last });
    }
  }
  const joins = parseJoins(String(p.joins));
  const a = clone(o), b = clone(o);
  b.id = newId;
  a.params.points = formatPoints(pts.slice(0, index + 1));
  a.params.nodeIds = ids.slice(0, index + 1).join(';');
  a.params.ranges = formatRanges(ra);
  a.params.joins = JSON.stringify(joins.filter((j) => ids.indexOf(j.node) <= index));
  b.params.points = formatPoints(pts.slice(index));
  b.params.nodeIds = ids.slice(index).join(';');
  b.params.ranges = formatRanges(rb);
  b.params.joins = JSON.stringify(joins.filter((j) => ids.indexOf(j.node) > index));
  if (b.editor?.name) b.editor = { ...b.editor, name: `${b.editor.name} (2)` };
  const others = retarget(all, o.id, newId, new Set(ids.slice(index + 1)));
  return { a, b, others };
}

/** Obrácení směru trasy (uzly, ID, úseky: {úsek i, t} → {úsek začínající uzlem i+1, 1 − t}). */
function reversed(o: MapObject): MapObject {
  const pts = ptsOf(o).reverse(), ids = idsOf(o);
  const rid = [...ids].reverse();
  const flip = (r: RangeRef): RangeRef => {
    const i = ids.indexOf(r.seg);
    return { seg: ids[Math.min(ids.length - 1, i + 1)], t: 1 - r.t };
  };
  const c = clone(o);
  c.params.points = formatPoints(pts);
  c.params.nodeIds = rid.join(';');
  c.params.ranges = formatRanges(parseRanges(String(P(o).ranges)).map((r) => ({ ...r, from: flip(r.to), to: flip(r.from) })));
  return c;
}

/** Spojí dvě cesty, jejichž konce leží u sebe (≤ tol m). Výsledek nese ID a parametry cesty `a`. */
export function joinRoads(a0: MapObject, b0: MapObject, all: MapObject[], tol = 1.5): { a: MapObject; removed: string; others: MapObject[] } | { error: string } {
  const end = (o: MapObject, last: boolean) => {
    const pts = ptsOf(o);
    return roadToWorld(o, pts[last ? pts.length - 1 : 0]);
  };
  const d = (x: Pt, y: Pt) => Math.hypot(x[0] - y[0], x[1] - y[1]);
  let a = a0, b = b0;
  if (d(end(a, true), end(b, false)) <= tol) {
    /* a.konec → b.začátek */
  } else if (d(end(a, true), end(b, true)) <= tol) b = reversed(b);
  else if (d(end(a, false), end(b, false)) <= tol) a = reversed(a);
  else if (d(end(a, false), end(b, true)) <= tol) {
    a = reversed(a);
    b = reversed(b);
  } else return { error: `konce cest jsou dál než ${tol} m – přitáhni je k sobě` };
  const pa = ptsOf(a), ia = idsOf(a), pb = ptsOf(b), ib = idsOf(b);
  // ID uzlů b bez kolizí s a; první uzel b splývá s posledním uzlem a.
  const rename = new Map<string, string>();
  const used = new Set(ia);
  rename.set(ib[0], ia[ia.length - 1]);
  for (const id of ib.slice(1)) {
    const n = used.has(id) ? freshId([...used, ...ib]) : id;
    used.add(n);
    rename.set(id, n);
  }
  const ptsB = pb.slice(1).map((q) => toLocal(a, roadToWorld(b, q)));
  const out = clone(a);
  out.params.points = formatPoints([...pa, ...ptsB]);
  out.params.nodeIds = [...ia, ...ib.slice(1).map((id) => rename.get(id)!)].join(';');
  const rb = parseRanges(String(P(b).ranges)).map((r) => ({ ...r, id: `${r.id}j`, from: { ...r.from, seg: rename.get(r.from.seg) ?? r.from.seg }, to: { ...r.to, seg: rename.get(r.to.seg) ?? r.to.seg } }));
  // Úsek b na prvním úseku odkazuje na uzel, který je teď poslední uzel a – ten začíná úsek do b.
  out.params.ranges = formatRanges([...parseRanges(String(P(a).ranges)), ...rb]);
  const jb = parseJoins(String(P(b).joins)).map((j) => ({ ...j, node: rename.get(j.node) ?? j.node }));
  out.params.joins = JSON.stringify([...parseJoins(String(P(a).joins)), ...jb].filter((j) => j.road !== a.id && j.road !== b.id));
  // Spoje ostatních cest na uzly b → na odpovídající uzly a.
  const others: MapObject[] = [];
  for (const o of all) {
    if (o.assetId !== ROAD || o.id === a0.id || o.id === b0.id) continue;
    const js = parseJoins(String(P(o).joins));
    if (!js.some((j) => j.road === b0.id)) continue;
    const c = clone(o);
    c.params.joins = JSON.stringify(js.map((j) => (j.road === b0.id ? { ...j, road: a0.id, at: rename.get(j.at) ?? j.at } : j)));
    others.push(c);
  }
  return { a: out, removed: b0.id, others };
}

/** Nová odbočka z uzlu `index` cesty o: 20 m kolmo, první uzel spojený s uzlem cesty. */
export function branchFrom(o: MapObject, index: number, newId: string, length = 20): MapObject {
  const wc = roadCurveWorld(o);
  const s = wc.curve.segStart[Math.min(index, wc.curve.segStart.length - 1)];
  const { p, dir } = pointAt(wc.curve, s);
  const n: Pt = [-dir[1], dir[0]];
  const def = getAsset(ROAD)!;
  const q = P(o);
  return {
    id: newId,
    assetId: ROAD,
    generatorVersion: def.generatorVersion,
    transform: { position: [p[0], o.transform.position[1], p[1]], rotation: [0, 0, 0] },
    params: {
      ...resolveParams(def, {}),
      points: formatPoints([[0, 0], [n[0] * length * 0.5, n[1] * length * 0.5], [n[0] * length, n[1] * length]]),
      nodeIds: 'n1;n2;n3',
      width: Math.max(2.5, Number(q.width) - 1.5),
      surface: String(q.surface),
      joins: JSON.stringify([{ node: 'n1', road: o.id, at: wc.ids[index] }] satisfies Join[]),
    },
    seed: (o.seed * 2654435761 + 1) >>> 0,
    material: o.material,
  };
}

/** Konec trasy `o` (první / poslední uzel) blízko jiné cesty → T křižovatka (uzel v hlavní cestě + spoj). */
export function snapEndToRoad(o: MapObject, all: MapObject[]): { road: MapObject; other: MapObject } | null {
  const pts = ptsOf(o), ids = idsOf(o);
  const joins = parseJoins(String(P(o).joins));
  for (const last of [false, true]) {
    const k = last ? pts.length - 1 : 0;
    if (joins.some((j) => j.node === ids[k])) continue;
    const w = roadToWorld(o, pts[k]);
    for (const other of all) {
      if (other.id === o.id || other.assetId !== ROAD) continue;
      const wc = roadCurveWorld(other);
      const pr = project(wc.curve, w);
      if (pr.d > wc.W / 2 + 0.5) continue;
      const ins = insertNodeAt(other, w);
      const road = clone(o);
      // Konec leží přesně v uzlu hlavní cesty (generátor ho tam drží i po posunu hlavní cesty).
      const nodeW = roadToWorld(ins.road, ptsOf(ins.road)[ins.index]);
      const np = [...pts];
      np[k] = toLocal(o, nodeW);
      road.params.points = formatPoints(np);
      road.params.nodeIds = ids.join(';');
      road.params.joins = JSON.stringify([...joins, { node: ids[k], road: other.id, at: ins.nodeId }]);
      return { road, other: ins.road };
    }
  }
  return null;
}

export interface Crossing {
  a: string;
  b: string;
  at: Pt;
}

/** Křížení cest ve stejné výšce bez křižovatky (žádný spoj mezi nimi). */
export function findCrossings(all: MapObject[]): Crossing[] {
  const roads = all.filter((o) => o.assetId === ROAD && !o.gameHidden);
  const out: Crossing[] = [];
  const linked = (x: MapObject, y: MapObject) => parseJoins(String(P(x).joins)).some((j) => j.road === y.id) || parseJoins(String(P(y).joins)).some((j) => j.road === x.id);
  for (let i = 0; i < roads.length; i++)
    for (let j = i + 1; j < roads.length; j++) {
      const A = roads[i], B = roads[j];
      if (Math.abs(A.transform.position[1] - B.transform.position[1]) > 1.5) continue; // různé výšky se nespojují
      if (linked(A, B)) continue;
      const ca = roadCurveWorld(A).curve.pts, cb = roadCurveWorld(B).curve.pts;
      for (let p = 0; p + 1 < ca.length; p++)
        for (let q = 0; q + 1 < cb.length; q++) {
          const a = ca[p], b = ca[p + 1], c = cb[q], d = cb[q + 1];
          const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const at: Pt = [a[0] + rx * t, a[1] + rz * t];
          if (!out.some((x) => x.a === A.id && x.b === B.id && Math.hypot(x.at[0] - at[0], x.at[1] - at[1]) < 2)) out.push({ a: A.id, b: B.id, at });
        }
    }
  return out;
}

/** Potvrzení X křižovatky: uzel do obou cest; vedlejší (vyšší ID) se napojí na hlavní. */
export function makeCrossing(a: MapObject, b: MapObject, at: Pt): { main: MapObject; side: MapObject } {
  const [mainO, sideO] = a.id < b.id ? [a, b] : [b, a];
  const im = insertNodeAt(mainO, at);
  const is = insertNodeAt(sideO, at);
  const side = is.road;
  const nodeW = roadToWorld(im.road, ptsOf(im.road)[im.index]);
  const pts = ptsOf(side);
  pts[is.index] = toLocal(side, nodeW);
  side.params.points = formatPoints(pts);
  side.params.joins = JSON.stringify([...parseJoins(String(P(side).joins)), { node: is.nodeId, road: mainO.id, at: im.nodeId }]);
  return { main: im.road, side };
}
