import type { Part } from '../parts';
import type { MapObject } from '../../shared/map/schema';
import { getAsset, registerAsset, resolveParams, type GenContext, type Params } from '../registry';

/**
 * Kreslená ulice: body (lokálně x,z) → hladká křivka (Catmull-Rom) → asfaltový pás, obrubníky,
 * chodníky a vodorovné značení. Ulice kopíruje terén (volitelně). Body se edituje úchopy
 * ve viewportu (rovinky = dva body daleko od sebe, zatáčka = víc bodů do oblouku).
 */
const n = (p: Params, k: string) => p[k] as number;

export type Pt = [number, number];

export function parsePoints(s: string): Pt[] {
  const out: Pt[] = [];
  for (const chunk of String(s).split(';')) {
    const [x, z] = chunk.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) out.push([x, z]);
  }
  return out;
}

export function formatPoints(pts: Pt[]): string {
  return pts.map(([x, z]) => `${Math.round(x * 100) / 100},${Math.round(z * 100) / 100}`).join(';');
}

/** Vzorkování Catmull-Rom (centripetální) křivky po zhruba `step` metrech; prochází všemi body. */
export function sampleCurve(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(1, Math.ceil(seg / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Posun křivky do strany o `d` (kladně doleva po směru jízdy). */
export function offsetCurve(c: Pt[], d: number): Pt[] {
  return c.map((p, i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    return [p[0] - (tz / l) * d, p[1] + (tx / l) * d];
  });
}

/** Úseky křivky mezi vzdálenostmi [s0, s1] (pro přerušované čáry). */
function slice(c: Pt[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [];
  let acc = 0;
  for (let i = 0; i + 1 < c.length; i++) {
    const a = c[i], b = c[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lerp = (s: number): Pt => {
      const t = Math.max(0, Math.min(1, (s - acc) / (l || 1)));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    if (acc + l >= s0 && acc <= s1) {
      if (!out.length) out.push(lerp(Math.max(s0, acc)));
      out.push(lerp(Math.min(s1, acc + l)));
    }
    acc += l;
  }
  return out;
}

function lengthOf(c: Pt[]) {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
  return s;
}


/** Rozměry silnice pro křížení: šířka vozovky a vnější polovina včetně chodníku. */
interface RoadInfo {
  id: string;
  curve: Pt[];
  W: number;
  outer: number;
}

function infoFor(p: Params, id: string, curve: Pt[]): RoadInfo {
  const W = n(p, 'width');
  return { id, curve, W, outer: W / 2 + (p.sidewalk ? 0.2 + n(p, 'sidewalkWidth') : 0) };
}

/** Ostatní kreslené silnice mapy převedené do lokálních souřadnic této silnice. */
function neighborRoads(ctx: GenContext): RoadInfo[] {
  const out: RoadInfo[] = [];
  for (const o of ctx.neighbors ?? []) {
    if (o.assetId !== 'street.roadPath' || !ctx.toLocal) continue;
    const def = getAsset(o.assetId)!;
    const q = resolveParams(def, o.params);
    const local = sampleCurve(parsePoints(String(q.points)), 1.5);
    out.push(infoFor(q, o.id, local.map((pt) => ctx.toLocal!(...toWorld(o, pt)))));
  }
  return out;
}

function toWorld(o: MapObject, p: Pt): Pt {
  const [px, , pz] = o.transform.position;
  const yaw = o.transform.rotation[1], s = o.transform.scale ?? 1;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  return [px + (c * p[0] + sn * p[1]) * s, pz + (-sn * p[0] + c * p[1]) * s];
}

interface Junction {
  /** Vzdálenost podél této silnice. */
  s: number;
  /** |sin| úhlu křížení (min. 0,25 – ostré úhly se neprodlužují donekonečna). */
  sin: number;
  other: RoadInfo;
  /** Hlavní silnice (nižší ID) drží asfalt i chodníky přes křižovatku. */
  primary: boolean;
}

export function findJunctions(own: Pt[], selfId: string, others: RoadInfo[]): Junction[] {
  const out: Junction[] = [];
  for (const o of others) {
    let acc = 0;
    for (let i = 0; i + 1 < own.length; i++) {
      const a = own[i], b = own[i + 1];
      const rx = b[0] - a[0], rz = b[1] - a[1];
      const len = Math.hypot(rx, rz);
      for (let j = 0; j + 1 < o.curve.length; j++) {
        const c = o.curve[j], d = o.curve[j + 1];
        const sx = d[0] - c[0], sz = d[1] - c[1];
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
        const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const sin = Math.max(0.25, Math.abs(den) / (len * Math.hypot(sx, sz)));
        const sAt = acc + t * len;
        // Jeden průsečík na křížení (sousední úseky ho mohou najít dvakrát).
        if (!out.some((q) => q.other === o && Math.abs(q.s - sAt) < 1)) out.push({ s: sAt, sin, other: o, primary: selfId < o.id });
      }
      acc += len;
    }
  }
  return out;
}

/** Části křivky mimo vyřezané úseky [s0, s1]. */
function keep(c: Pt[], cuts: Array<[number, number]>): Pt[][] {
  const total = lengthOf(c);
  const merged = cuts.map(([a, b]) => [Math.max(0, a), Math.min(total, b)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Pt[][] = [];
  let cur = 0;
  for (const [a, b] of merged) {
    if (a - cur > 0.05) out.push(slice(c, cur, a));
    cur = Math.max(cur, b);
  }
  if (total - cur > 0.05) out.push(slice(c, cur, total));
  return out.filter((x) => x.length >= 2);
}

registerAsset({
  assetId: 'street.roadPath',
  label: 'Ulice (kreslená body)',
  category: 'street',
  generatorVersion: 1,
  params: [
    { key: 'points', label: 'Body', type: 'points', default: '0,0;24,0' },
    { key: 'width', label: 'Šířka vozovky', type: 'number', min: 3, max: 24, step: 0.5, unit: 'm', default: 7 },
    { key: 'sidewalk', label: 'Chodníky', type: 'bool', default: true },
    { key: 'sidewalkWidth', label: 'Šířka chodníku', type: 'number', min: 0.8, max: 6, step: 0.1, unit: 'm', default: 2.2 },
    {
      key: 'lines',
      label: 'Značení',
      type: 'enum',
      default: 'dashed',
      options: [
        { value: 'none', label: 'Bez čar' },
        { value: 'dashed', label: 'Přerušovaná osa' },
        { value: 'solid', label: 'Plná osa' },
        { value: 'edges', label: 'Osa + okraje' },
      ],
    },
    { key: 'follow', label: 'Kopírovat terén', type: 'bool', default: true },
  ],
  usesTerrain: (p) => !!p.follow,
  materials: ['asphalt', 'dirt', 'sand', 'paving'],
  defaultMaterial: 'asphalt',
  describe(p) {
    const pts = parsePoints(String(p.points));
    return `${pts.length} bodů, délka ${lengthOf(sampleCurve(pts, 1)).toFixed(0)} m · táhni body, klik na „+“ přidá bod, Shift+klik bod smaže`;
  },
  generate(p, seed, material, ctx) {
    const pts = parsePoints(String(p.points));
    if (pts.length < 2) return [];
    const W = n(p, 'width');
    const c = sampleCurve(pts, 1.5);
    const follow = !!p.follow;
    // Různé ulice o pár milimetrů jinak vysoko → překryvy neblikají (z-fighting).
    const lift = 0.04 + (seed % 7) * 0.003;
    const y = (q: Pt) => (follow ? ctx.ground(q[0], q[1]) : 0);
    const path = (curve: Pt[], dy: number): [number, number, number][] => curve.map((q) => [q[0], y(q) + dy, q[1]]);
    // Křižovatky s ostatními kreslenými silnicemi: hlavní silnice (nižší ID) jde vcelku,
    // vedlejší přeruší asfalt v ploše hlavní vozovky a chodníky až za chodníky hlavní.
    const self = infoFor(p, ctx.selfId ?? '', c);
    const junctions = findJunctions(c, self.id, neighborRoads(ctx));
    const asphaltCuts: Array<[number, number]> = [], walkCuts: Array<[number, number]> = [], lineCuts: Array<[number, number]> = [];
    for (const j of junctions) {
      const h = (d: number) => [j.s - d / j.sin, j.s + d / j.sin] as [number, number];
      if (!j.primary) asphaltCuts.push(h(j.other.W / 2 - 0.05));
      walkCuts.push(h(j.primary ? j.other.W / 2 : j.other.outer));
      lineCuts.push(h(j.other.outer + 1));
    }
    const parts: Part[] = [];
    for (const piece of keep(c, asphaltCuts)) parts.push({ shape: 'strip', pos: [0, 0, 0], size: [W, 0.25, 0], path: path(piece, lift + (junctions.some((j) => j.primary) ? 0.004 : 0)), material, castShadow: false });
    if (p.sidewalk) {
      const sw = n(p, 'sidewalkWidth'), curb = 0.15;
      for (const piece of keep(c, walkCuts))
        for (const s of [-1, 1]) {
          parts.push({ shape: 'strip', pos: [0, 0, 0], size: [0.2, curb + 0.3, 0], path: path(offsetCurve(piece, s * (W / 2 + 0.1)), lift + curb), material: 'concreteLight', collide: true, castShadow: false });
          parts.push({ shape: 'strip', pos: [0, 0, 0], size: [sw, curb + 0.3, 0], path: path(offsetCurve(piece, s * (W / 2 + 0.2 + sw / 2)), lift + curb - 0.01), material: 'paving', collide: true, castShadow: false });
        }
    }
    const lines = p.lines as string;
    if (lines !== 'none' && material === 'asphalt') {
      const line = (curve: Pt[], w = 0.14) => curve.length >= 2 && parts.push({ shape: 'strip', pos: [0, 0, 0], size: [w, 0, 0], path: path(curve, lift + 0.012), material: 'paint', castShadow: false });
      for (const piece of keep(c, lineCuts)) {
        const total = lengthOf(piece);
        if (lines === 'dashed') for (let s = 1; s < total - 1; s += 6) line(slice(piece, s, Math.min(total - 1, s + 3)));
        else line(piece);
        if (lines === 'edges') for (const s of [-1, 1]) line(offsetCurve(piece, s * (W / 2 - 0.35)));
      }
      // Přechody pro chodce na ramenech křižovatky (pruhy podél silnice, napříč vozovkou).
      const total = lengthOf(c);
      for (const j of junctions) {
        const d = (j.primary ? j.other.W / 2 : j.other.outer) / j.sin + 0.6;
        for (const [s0, s1] of [[j.s + d, j.s + d + 3], [j.s - d - 3, j.s - d]] as const) {
          if (s0 < 0.5 || s1 > total - 0.5) continue;
          const seg = slice(c, s0, s1);
          for (let k = -W / 2 + 0.6; k <= W / 2 - 0.5; k += 1.0) line(offsetCurve(seg, k), 0.5);
        }
      }
    }
    return parts;
  },
});
