import type { Pt } from '../roads';

/**
 * Trasa cesty jako graf: uzly se stabilními ID (parametr `nodeIds`, souběžně s `points`), úseky
 * (hrany) mezi sousedními uzly identifikované ID počátečního uzlu. Úseky povrchu se odkazují na
 * {úsek, t} → po přidání/smazání uzlu se přemapují na stejné místo, po posunu uzlu jdou s ním.
 * Vše čisté funkce (editor, generátor i testy), bez Three.js.
 */

export type CurveMode = 'smooth' | 'polyline' | 'straight';

export interface RoadCurve {
  /** Vzorky osy (lokálně x, z). */
  pts: Pt[];
  /** Obloukové délky vzorků. */
  s: number[];
  /** Oblouková délka začátku každého úseku (délka = počet úseků + 1, poslední = celková délka). */
  segStart: number[];
  total: number;
  /** Nejmenší skutečný poloměr zaoblení rohu (lomený / přímý režim), Infinity u hladké. */
  minFillet: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Osa trasy. Hladká = Catmull-Rom přes uzly; lomená / přímá = úsečky se zaoblením rohů
 * obloukem o poloměru `radius` (zkrácen, když je úsek krátký). Hranice úseků leží v uzlech
 * (u zaobleného rohu ve středu oblouku).
 */
export function buildCurve(nodes: Pt[], mode: CurveMode, step = 1, radius = 8): RoadCurve {
  const pts: Pt[] = [];
  const segStartIdx: number[] = [];
  let minFillet = Infinity;
  if (nodes.length < 2) return { pts: nodes.slice(), s: nodes.map(() => 0), segStart: [0, 0], total: 0, minFillet };
  if (mode === 'smooth') {
    const P = [nodes[0], ...nodes, nodes[nodes.length - 1]];
    for (let i = 1; i < P.length - 2; i++) {
      segStartIdx.push(pts.length);
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      const k = Math.max(1, Math.ceil(dist(p1, p2) / step));
      for (let j = 0; j < k; j++) {
        const t = j / k, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    pts.push(nodes[nodes.length - 1]);
  } else {
    // Zaoblení v každém vnitřním uzlu: tečné body ve vzdálenosti d = r·tan(θ/2) od uzlu.
    const n = nodes.length;
    const cut: number[] = new Array(n).fill(0);
    const rad: number[] = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const a = nodes[i - 1], b = nodes[i], c = nodes[i + 1];
      const u: Pt = [(a[0] - b[0]) / (dist(a, b) || 1), (a[1] - b[1]) / (dist(a, b) || 1)];
      const v: Pt = [(c[0] - b[0]) / (dist(b, c) || 1), (c[1] - b[1]) / (dist(b, c) || 1)];
      const cos = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
      const ang = Math.acos(cos); // vnitřní úhel v uzlu (π = rovně)
      if (Math.PI - ang < 1e-3) continue;
      const tanHalf = Math.tan(ang / 2);
      let d = radius / tanHalf;
      d = Math.min(d, dist(a, b) / 2, dist(b, c) / 2);
      cut[i] = d;
      rad[i] = d * tanHalf;
      minFillet = Math.min(minFillet, rad[i]);
    }
    const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    // Oblouk v uzlu i jako kvadratická Bézierova křivka (tečná v obou bodech) – polovina k úseku i−1, polovina k i.
    const arc = (i: number, from: number, to: number) => {
      const a = nodes[i - 1], b = nodes[i], c = nodes[i + 1];
      const p0 = lerp(b, a, cut[i] / (dist(a, b) || 1)), p2 = lerp(b, c, cut[i] / (dist(b, c) || 1));
      const k = Math.max(2, Math.ceil((rad[i] * Math.PI) / 2 / step));
      for (let j = Math.round(from * k); j < Math.round(to * k); j++) {
        const t = j / k;
        pts.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * b[0] + t * t * p2[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * b[1] + t * t * p2[1]]);
      }
    };
    for (let i = 0; i < n - 1; i++) {
      segStartIdx.push(pts.length);
      const a = nodes[i], b = nodes[i + 1], L = dist(a, b);
      if (i > 0 && cut[i] > 0) arc(i, 0.5, 1);
      const s0 = i > 0 ? cut[i] : 0, s1 = L - (i + 1 < n - 1 ? cut[i + 1] : 0);
      const k = Math.max(1, Math.ceil((s1 - s0) / step));
      for (let j = 0; j < k; j++) pts.push(lerp(a, b, (s0 + ((s1 - s0) * j) / k) / (L || 1)));
      if (i + 1 < n - 1 && cut[i + 1] > 0) arc(i + 1, 0, 0.5);
    }
    pts.push(nodes[n - 1]);
  }
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  const segStart = segStartIdx.map((k) => s[k]);
  segStart.push(s[s.length - 1]);
  return { pts, s, segStart, total: s[s.length - 1], minFillet };
}

/** Bod osy v obloukové délce (lineárně mezi vzorky) a jednotková tečna. */
export function pointAt(c: RoadCurve, at: number): { p: Pt; dir: Pt } {
  const s = Math.max(0, Math.min(c.total, at));
  let i = 0;
  let lo = 0, hi = c.s.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (c.s[m] <= s) lo = m;
    else hi = m;
  }
  i = lo;
  const j = Math.min(c.pts.length - 1, i + 1);
  const l = c.s[j] - c.s[i];
  const t = l > 1e-9 ? (s - c.s[i]) / l : 0;
  const a = c.pts[i], b = c.pts[j];
  const dl = dist(a, b) || 1;
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl] };
}

/** Část osy mezi obloukovými délkami s0–s1 (včetně koncových bodů). */
export function sliceCurve(c: RoadCurve, s0: number, s1: number): Pt[] {
  const out: Pt[] = [pointAt(c, s0).p];
  for (let i = 0; i < c.pts.length; i++) if (c.s[i] > s0 + 1e-6 && c.s[i] < s1 - 1e-6) out.push(c.pts[i]);
  out.push(pointAt(c, s1).p);
  return out;
}

/** Nejbližší bod osy k bodu q; volitelně jen v daných úsecích. Vrací obloukovou délku a vzdálenost. */
export function project(c: RoadCurve, q: Pt, segs?: number[]): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < c.pts.length; i++) {
    const mid = (c.s[i] + c.s[i + 1]) / 2;
    if (segs && !segs.includes(segmentAt(c, mid))) continue;
    const a = c.pts[i], b = c.pts[i + 1];
    const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vz) / l2)) : 0;
    const px = a[0] + vx * t, pz = a[1] + vz * t;
    const d = Math.hypot(q[0] - px, q[1] - pz);
    if (d < best.d) best = { s: c.s[i] + t * (c.s[i + 1] - c.s[i]), d };
  }
  return best;
}

/** Index úseku obsahujícího obloukovou délku s. */
export function segmentAt(c: RoadCurve, s: number): number {
  const n = c.segStart.length - 1;
  for (let i = 0; i < n; i++) if (s < c.segStart[i + 1] - 1e-9) return i;
  return n - 1;
}

// ------------------------------------------------------------------ ID uzlů

export function parseIds(s: string): string[] {
  return String(s ?? '').split(';').map((x) => x.trim()).filter(Boolean);
}

/** Doplní / opraví ID uzlů (počet podle uzlů, unikátní). Stávající ID zachová. */
export function ensureIds(count: number, ids: string[]): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let id = ids[i];
    if (!id || used.has(id)) id = freshId([...used, ...ids]);
    used.add(id);
    out.push(id);
  }
  return out;
}

export function freshId(existing: Iterable<string>): string {
  const set = new Set(existing);
  let k = set.size + 1;
  while (set.has(`n${k}`)) k++;
  return `n${k}`;
}

// ------------------------------------------------------------------ úseky povrchu

export interface RangeRef {
  /** ID počátečního uzlu úseku. */
  seg: string;
  /** Poloha v úseku 0–1 (poměr obloukové délky). */
  t: number;
  /** Totéž v metrech od začátku úseku (režim „zachovat metry“). */
  d?: number;
}

export interface SurfaceRange {
  id: string;
  from: RangeRef;
  to: RangeRef;
  surface: string;
  /** Délka přechodu na obou hranicích (0–8 m). */
  transition: number;
}

export function parseRanges(s: string): SurfaceRange[] {
  try {
    const v = JSON.parse(String(s || '[]'));
    if (!Array.isArray(v)) return [];
    return v
      .filter((r) => r && r.from && r.to && typeof r.surface === 'string')
      .map((r, i) => ({
        id: String(r.id ?? `r${i + 1}`),
        from: { seg: String(r.from.seg), t: Number(r.from.t) || 0, ...(Number.isFinite(r.from.d) ? { d: Number(r.from.d) } : {}) },
        to: { seg: String(r.to.seg), t: Number(r.to.t) || 0, ...(Number.isFinite(r.to.d) ? { d: Number(r.to.d) } : {}) },
        surface: r.surface,
        transition: Number.isFinite(r.transition) ? Number(r.transition) : 2,
      }));
  } catch {
    return [];
  }
}

export function formatRanges(r: SurfaceRange[]): string {
  const q = (v: number) => Math.round(v * 10000) / 10000;
  return JSON.stringify(r.map((x) => ({ id: x.id, from: { seg: x.from.seg, t: q(x.from.t), ...(x.from.d !== undefined ? { d: q(x.from.d) } : {}) }, to: { seg: x.to.seg, t: q(x.to.t), ...(x.to.d !== undefined ? { d: q(x.to.d) } : {}) }, surface: x.surface, transition: q(x.transition) })));
}

/** Oblouková délka odkazu (null = úsek neexistuje). */
export function refToS(c: RoadCurve, ids: string[], ref: RangeRef, keepMeters = false): number | null {
  const i = ids.indexOf(ref.seg);
  if (i < 0 || i >= c.segStart.length - 1) return null;
  const a = c.segStart[i], len = c.segStart[i + 1] - a;
  const off = keepMeters && ref.d !== undefined ? Math.max(0, Math.min(len, ref.d)) : Math.max(0, Math.min(1, ref.t)) * len;
  return a + off;
}

/** Obloukové délky → odkaz {úsek, t, d}. */
export function sToRef(c: RoadCurve, ids: string[], s: number): RangeRef {
  const ss = Math.max(0, Math.min(c.total, s));
  const i = segmentAt(c, ss);
  const a = c.segStart[i], len = c.segStart[i + 1] - a;
  const d = ss - a;
  return { seg: ids[i], t: len > 1e-9 ? d / len : 0, d };
}

export interface Piece {
  s0: number;
  s1: number;
  surface: string;
}
export interface Boundary {
  s: number;
  from: string;
  to: string;
  /** Požadovaná a skutečná (po zkrácení) délka přechodu. */
  want: number;
  len: number;
}
export interface ResolvedSurfaces {
  pieces: Piece[];
  boundaries: Boundary[];
  warnings: string[];
}

export const MAX_TRANSITION = 8;

/**
 * Normalizace úseků a výpočet přechodů. Obrácený interval se otočí, prázdný a neplatný se vynechá
 * (s varováním), překryv se zkrátí (pozdější začne tam, kde předchozí končí). Přechod je centrovaný
 * na hranici; krátký úsek mezi dvěma přechody je zkrátí tak, aby se nepřekryly (žádné NaN ani
 * obrácené intervaly), a ukáže informaci.
 */
export function resolveSurfaces(c: RoadCurve, ids: string[], ranges: SurfaceRange[], base: string, keepMeters = false): ResolvedSurfaces {
  const warnings: string[] = [];
  const iv: { a: number; b: number; r: SurfaceRange }[] = [];
  for (const r of ranges) {
    let a = refToS(c, ids, r.from, keepMeters), b = refToS(c, ids, r.to, keepMeters);
    if (a === null || b === null) {
      warnings.push(`úsek ${r.id}: odkazuje na neexistující úsek trasy – vynechán (uprav nebo smaž)`);
      continue;
    }
    if (b < a) {
      [a, b] = [b, a];
      warnings.push(`úsek ${r.id}: obrácený interval otočen`);
    }
    if (b - a < 0.1) {
      warnings.push(`úsek ${r.id}: prázdný (< 0,1 m) – vynechán`);
      continue;
    }
    iv.push({ a, b, r });
  }
  iv.sort((x, y) => x.a - y.a);
  const pieces: (Piece & { T: number })[] = [];
  let cur = 0;
  for (const x of iv) {
    let a = x.a;
    if (a < cur - 1e-6) {
      warnings.push(`úsek ${x.r.id}: překrývá předchozí – začátek posunut na ${cur.toFixed(1)} m`);
      a = cur;
    }
    if (x.b - a < 0.1) continue;
    if (a > cur + 1e-6) pieces.push({ s0: cur, s1: a, surface: base, T: 0 });
    pieces.push({ s0: a, s1: x.b, surface: x.r.surface, T: Math.max(0, Math.min(MAX_TRANSITION, x.r.transition)) });
    cur = x.b;
  }
  if (cur < c.total - 1e-6 || !pieces.length) pieces.push({ s0: cur, s1: c.total, surface: base, T: 0 });
  // Sloučit sousední kusy stejného povrchu.
  const merged: (Piece & { T: number })[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.surface === p.surface) {
      last.s1 = p.s1;
      last.T = Math.max(last.T, p.T);
    } else merged.push({ ...p });
  }
  const boundaries: Boundary[] = [];
  for (let k = 1; k < merged.length; k++) {
    const A = merged[k - 1], B = merged[k];
    const want = B.surface === base ? A.T : A.surface === base ? B.T : Math.max(A.T, B.T);
    // Kapacita kusu: polovina délky, když má přechod na obou koncích, jinak celá délka.
    const cap = (p: Piece, idx: number) => {
      const two = idx > 0 && idx < merged.length - 1;
      return two ? (p.s1 - p.s0) : 2 * (p.s1 - p.s0);
    };
    const len = Math.max(0, Math.min(want, cap(A, k - 1), cap(B, k)));
    if (len < want - 1e-6) warnings.push(`přechod ${A.surface} → ${B.surface} v ${B.s0.toFixed(1)} m zkrácen z ${want.toFixed(1)} na ${len.toFixed(2)} m (krátký úsek)`);
    boundaries.push({ s: B.s0, from: A.surface, to: B.surface, want, len });
  }
  return { pieces: merged.map(({ s0, s1, surface }) => ({ s0, s1, surface })), boundaries, warnings };
}

// ------------------------------------------------------------------ úpravy uzlů

export type PointOp = { kind: 'insert'; index: number } | { kind: 'delete'; index: number } | { kind: 'move'; index: number } | { kind: 'create' };

/**
 * Přemapování úseků po úpravě uzlů: hranice se přenese na stejné místo ve světě (průmět na
 * odpovídající nové úseky – nikdy na jinou větev). Posun uzlu zachová {úsek, t}.
 */
export function remapRanges(before: RoadCurve, beforeIds: string[], after: RoadCurve, afterIds: string[], ranges: SurfaceRange[], op: PointOp): SurfaceRange[] {
  const last = beforeIds.length - 1;
  const fix = (ref: RangeRef): RangeRef => {
    const i = beforeIds.indexOf(ref.seg);
    let candidates: string[] | null = null;
    if (op.kind === 'insert' && i === op.index - 1) candidates = [ref.seg, afterIds[op.index]];
    else if (op.kind === 'delete') {
      const k = op.index;
      if (k === 0 && i === 0) candidates = [afterIds[0]];
      else if (k === last && i === k - 1) candidates = [afterIds[afterIds.length - 2]];
      else if (k > 0 && k < last && (i === k - 1 || i === k)) candidates = [afterIds[k - 1]];
    }
    // Nedotčený úsek: odkaz zůstává (posun uzlu ho nese s sebou).
    if (!candidates) return ref;
    const sOld = refToS(before, beforeIds, ref);
    if (sOld === null) return ref;
    const q = pointAt(before, sOld).p;
    const segIdx = candidates.map((id) => afterIds.indexOf(id)).filter((k) => k >= 0 && k < after.segStart.length - 1);
    const pr = project(after, q, segIdx.length ? segIdx : undefined);
    return sToRef(after, afterIds, pr.s);
  };
  return ranges.map((r) => ({ ...r, from: fix(r.from), to: fix(r.to) }));
}

// ------------------------------------------------------------------ pravidla přechodů

/**
 * Deterministické pravidlo přechodu dvojice materiálů (žádná AI služba):
 *  'ragged' – rozpad hrany s prachem a kamenivem (asfalt/beton → hlína, štěrk, písek),
 *  'seam'   – fyzická spára / lem (beton ↔ dlažba: vzor se nerozmazává),
 *  'smooth' – plynulá směs bez tvrdé linie (hlína ↔ štěrk ↔ písek).
 */
export function transitionRule(a: string, b: string): 'ragged' | 'seam' | 'smooth' {
  const pair = new Set([a, b]);
  const hard = (m: string) => m === 'asphalt' || m === 'concrete' || m === 'paving';
  if (pair.has('concrete') && pair.has('paving')) return 'seam';
  if (pair.has('paving') && pair.has('asphalt')) return 'seam';
  if (hard(a) !== hard(b)) return 'ragged';
  if (hard(a) && hard(b)) return 'ragged';
  return 'smooth';
}
