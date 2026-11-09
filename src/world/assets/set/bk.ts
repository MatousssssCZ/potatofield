import type { LadderLocal, Part } from '../../parts';
import { MODE } from './close';

/**
 * Stavebnice budov sady 300. Lokální souřadnice budovy: počátek = střed půdorysu u země,
 * přední strana (ulice) = −Z, nahoru +Y. Při pohledu z ulice je PRAVÁ strana budovy −X
 * a LEVÁ +X (konstanty RIGHT / LEFT).
 *
 * Všechny stěny jsou osově zarovnané kvádry → kolize = tytéž kvádry. Otvory jsou skutečné
 * (průchozí pro hráče i střely); ostění = tloušťka zdi. Lišty, parapety a rámy jsou jen vzhled.
 */
export const RIGHT = -1;
export const LEFT = 1;

/** Výchozí míry (N, ze zadání sady 300). */
export const M = {
  /** Tloušťka obvodové zdi. */
  wall: 0.3,
  /** Tloušťka příčky. */
  inner: 0.15,
  /** Tloušťka stropní desky. */
  slab: 0.2,
  /** Konstrukční výška podlaží (podlaha → podlaha). */
  storey: 3.2,
  /** Dveře (světlost). */
  doorW: 1.2,
  doorH: 2.25,
  /** Okno: šířka, parapet, nadpraží. */
  winW: 1.2,
  sill: 1.0,
  winTop: 2.2,
  /** Atika. */
  parapet: 1.0,
  parapetT: 0.25,
  /** Schody: max. výška stupně, hloubka stupně. */
  riser: 0.185,
  tread: 0.3,
};

export type P2 = [number, number];

export interface Op {
  /** Střed otvoru měřený od počátku segmentu (m). */
  c: number;
  w: number;
  /** Spodní a horní hrana otvoru nad patou zdi. */
  b: number;
  t: number;
  kind?: 'door' | 'window' | 'pass';
  /** Bez rámu a parapetu (průchod, proražení). */
  bare?: boolean;
  /** Dveřní křídlo otevřené dovnitř (vzhled). */
  leaf?: boolean;
}

export const door = (c: number, extra: Partial<Op> = {}): Op => ({ c, w: M.doorW, b: 0, t: M.doorH, kind: 'door', leaf: true, ...extra });
export const win = (c: number, extra: Partial<Op> = {}): Op => ({ c, w: M.winW, b: M.sill, t: M.winTop, kind: 'window', ...extra });
export const pass = (c: number, w: number, t: number): Op => ({ c, w, b: 0, t, kind: 'pass', bare: true });

export interface WallOpts {
  /** Normála vnější strany (pro parapety, rámy); [nx, nz]. */
  out?: P2;
  /** Materiál lišt a rámů. */
  trim?: string;
  /** Bez kolize (dekorace). */
  noCollide?: boolean;
  /** Bez vnějších lišt (příčka). */
  plain?: boolean;
}

/**
 * Stěna z bodu a do bodu b (osově zarovnaná), pata v y0, výška h, tloušťka t (osa = střed zdi).
 * Otvory se z ní vyříznou; kolem otvorů se přidá rám, nadpraží a venkovní parapet.
 */
export function wall(a: P2, b: P2, y0: number, h: number, t: number, ops: Op[], mat: string, o: WallOpts = {}): Part[] {
  const parts: Part[] = [];
  const alongX = Math.abs(b[1] - a[1]) < 1e-6;
  const len = alongX ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]);
  const dir = alongX ? Math.sign(b[0] - a[0]) || 1 : Math.sign(b[1] - a[1]) || 1;
  const at = (u: number, v: number, w = 0): [number, number, number] => {
    const n = o.out ?? [0, 0];
    return alongX ? [a[0] + dir * u + n[0] * w, y0 + v, a[1] + n[1] * w] : [a[0] + n[0] * w, y0 + v, a[1] + dir * u + n[1] * w];
  };
  const size = (du: number, dv: number, dt: number): [number, number, number] => (alongX ? [du, dv, dt] : [dt, dv, du]);
  const seg = (u0: number, u1: number, v0: number, v1: number) => {
    if (u1 - u0 < 1e-3 || v1 - v0 < 1e-3) return;
    parts.push({ shape: 'box', pos: at((u0 + u1) / 2, (v0 + v1) / 2), size: size(u1 - u0, v1 - v0, t), material: mat, collide: !o.noCollide });
  };
  const sorted = [...ops].sort((p, q) => p.c - q.c);
  let cur = 0;
  for (const op of sorted) {
    const u0 = Math.max(cur, op.c - op.w / 2), u1 = Math.min(len, op.c + op.w / 2);
    seg(cur, u0, 0, h);
    seg(u0, u1, 0, op.b);
    seg(u0, u1, op.t, h);
    cur = u1;
  }
  seg(cur, len, 0, h);
  if (o.plain || !o.out) return parts;
  // Rámy a lišty (vzhled).
  const trim = o.trim ?? 'sandstone';
  for (const op of sorted) {
    if (op.bare) continue;
    const ow = op.w, oh = op.t - op.b;
    // Uzavřená budova (BF2): okno = tmavé sklo, dveře = zavřené křídlo (zapuštěné v ostění).
    if (MODE.closed) {
      if (op.kind === 'window') parts.push({ shape: 'box', pos: at(op.c, op.b + oh / 2, -0.02), size: size(ow - 0.02, oh - 0.02, 0.03), material: 'glass' });
      else parts.push({ shape: 'box', pos: at(op.c, op.b + (oh - 0.02) / 2, -0.06), size: size(ow - 0.02, oh - 0.02, 0.06), material: 'woodDark' });
    }
    // Nadpraží (vystupuje o 4 cm) a venkovní parapet.
    parts.push({ shape: 'box', pos: at(op.c, op.t + 0.08, t / 2 + 0.02), size: size(ow + 0.26, 0.16, 0.06), material: trim });
    if (op.kind === 'window') {
      parts.push({ shape: 'box', pos: at(op.c, op.b - 0.04, t / 2 + 0.05), size: size(ow + 0.2, 0.08, 0.12), material: trim });
      // Rám okna (boční rámy) uprostřed tloušťky zdi + svislý sloupek; vodorovně stačí nadpraží a parapet.
      for (const s of [-1, 1]) parts.push({ shape: 'box', pos: at(op.c + (s * (ow - 0.05)) / 2, op.b + oh / 2, 0), size: size(0.05, oh, 0.06), material: 'woodDark' });
      parts.push({ shape: 'box', pos: at(op.c, op.b + oh / 2, 0), size: size(0.04, oh, 0.05), material: 'woodDark' });
    } else {
      // Dveřní zárubeň.
      for (const s of [-1, 1]) parts.push({ shape: 'box', pos: at(op.c + (s * (ow + 0.06)) / 2, op.b + oh / 2, t / 2 + 0.01), size: size(0.06, oh, 0.05), material: trim });
    }
    if (op.leaf && !MODE.closed) {
      // Křídlo otevřené o ~180° a přiklopené k vnitřnímu líci vedle otvoru (vzhled, bez kolize).
      const lw = ow - 0.08;
      const before = op.c - ow / 2 - lw / 2 - 0.03, after = op.c + ow / 2 + lw / 2 + 0.03;
      const free = (u: number) => u - lw / 2 > 0.05 && u + lw / 2 < len - 0.05 && !sorted.some((q) => q !== op && Math.abs(q.c - u) < (q.w + lw) / 2 + 0.05);
      const u = free(before) ? before : free(after) ? after : null;
      if (u !== null) parts.push({ shape: 'box', pos: at(u, (oh - 0.05) / 2 + 0.02, -(t / 2 + 0.035)), size: size(lw, oh - 0.05, 0.045), material: 'woodDark' });
    }
  }
  return parts;
}

/** Obdélník [x0, z0, x1, z1]. */
export type Rect = [number, number, number, number];

/**
 * Deska (podlaha, strop, střecha) s obdélníkovými otvory: rozdělí se na pásy kolem otvorů.
 * `top` = horní plocha desky.
 */
export function slab(r: Rect, top: number, th: number, holes: Rect[], mat: string, collide = true): Part[] {
  const xs = [...new Set([r[0], r[2], ...holes.flatMap((h) => [Math.max(r[0], Math.min(r[2], h[0])), Math.max(r[0], Math.min(r[2], h[2]))])])].sort((p, q) => p - q);
  const out: Part[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    if (x1 - x0 < 1e-3) continue;
    const mx = (x0 + x1) / 2;
    // Intervaly z pokryté otvory v tomto pásu.
    const cut = holes.filter((h) => h[0] < mx && h[2] > mx).map((h) => [Math.max(r[1], h[1]), Math.min(r[3], h[3])] as P2).sort((p, q) => p[0] - q[0]);
    let z = r[1];
    const emit = (z0: number, z1: number) => {
      if (z1 - z0 < 1e-3) return;
      out.push({ shape: 'box', pos: [mx, top - th / 2, (z0 + z1) / 2], size: [x1 - x0, th, z1 - z0], material: mat, collide });
    };
    for (const [c0, c1] of cut) {
      emit(z, c0);
      z = Math.max(z, c1);
    }
    emit(z, r[3]);
  }
  // Sloučit sousední pásy se stejným rozsahem z (méně kvádrů).
  const merged: Part[] = [];
  for (const p of out) {
    const q = merged.find((m) => Math.abs(m.pos[2] - p.pos[2]) < 1e-6 && Math.abs(m.size[2] - p.size[2]) < 1e-6 && Math.abs(m.pos[0] + m.size[0] / 2 - (p.pos[0] - p.size[0] / 2)) < 1e-6);
    if (q) {
      const x0 = q.pos[0] - q.size[0] / 2, x1 = p.pos[0] + p.size[0] / 2;
      q.pos = [(x0 + x1) / 2, q.pos[1], q.pos[2]];
      q.size = [x1 - x0, q.size[1], q.size[2]];
    } else merged.push({ ...p });
  }
  return merged;
}

/**
 * Atika kolem obdélníku střechy (vnější líc = hrana obdélníku), pata v y, výška h.
 * `gaps`: průchody { side, from, to } v souřadnici podél strany (x pro přední/zadní, z pro boky).
 * `sides` vynechá strany (napojení na jinou hmotu).
 */
export function parapet(r: Rect, y: number, h: number, mat: string, cap: string, opts: { gaps?: { side: 'front' | 'back' | 'left' | 'right'; from: number; to: number }[]; skip?: ('front' | 'back' | 'left' | 'right')[]; t?: number } = {}): Part[] {
  const t = opts.t ?? M.parapetT;
  const parts: Part[] = [];
  const [x0, z0, x1, z1] = r;
  const run = (side: 'front' | 'back' | 'left' | 'right', a: number, b: number, fixed: number, alongX: boolean) => {
    if (opts.skip?.includes(side)) return;
    const gaps = (opts.gaps ?? []).filter((g) => g.side === side).sort((p, q) => p.from - q.from);
    let cur = a;
    const emit = (u0: number, u1: number) => {
      if (u1 - u0 < 1e-3) return;
      const c = (u0 + u1) / 2, l = u1 - u0;
      parts.push({ shape: 'box', pos: alongX ? [c, y + h / 2, fixed] : [fixed, y + h / 2, c], size: alongX ? [l, h, t] : [t, h, l], material: mat, collide: true });
      parts.push({ shape: 'box', pos: alongX ? [c, y + h + 0.03, fixed] : [fixed, y + h + 0.03, c], size: alongX ? [l + 0.02, 0.06, t + 0.08] : [t + 0.08, 0.06, l + 0.02], material: cap });
    };
    for (const g of gaps) {
      emit(cur, Math.max(cur, g.from));
      cur = Math.max(cur, g.to);
    }
    emit(cur, b);
  };
  run('front', x0, x1, z0 + t / 2, true);
  run('back', x0, x1, z1 - t / 2, true);
  run('left', z0 + t, z1 - t, x1 - t / 2, false);
  run('right', z0 + t, z1 - t, x0 + t / 2, false);
  return parts;
}

export type Dir = 'x+' | 'x-' | 'z+' | 'z-';
const DV: Record<Dir, P2> = { 'x+': [1, 0], 'x-': [-1, 0], 'z+': [0, 1], 'z-': [0, -1] };

export interface StairOpts {
  /** Plná podstava pod stupni (venkovní betonové schody), jinak deska. */
  solid?: boolean;
  /** Plné zábradlí (zídka 1 m) po straně: 'left' / 'right' vzhledem ke směru výstupu. */
  wallSide?: ('left' | 'right')[];
  /** Kovové zábradlí (průstřelné, blokuje pohyb). */
  railSide?: ('left' | 'right')[];
  trim?: string;
}

/**
 * Přímé schodiště: pata prvního stupně uprostřed šířky v (x, z), stoupá ve směru `dir`
 * z výšky y0 do y1. Stupně ≤ 0,185 m, hloubka 0,3 m. Kolize = šikmá rampa (klín).
 * Vrací díly a délku ramene.
 */
export function stairs(x: number, z: number, dir: Dir, width: number, y0: number, y1: number, mat: string, o: StairOpts = {}): { parts: Part[]; run: number; steps: number; rise: number } {
  const H = y1 - y0;
  const steps = Math.max(1, Math.ceil(H / M.riser - 1e-6));
  const rise = H / steps, tread = M.tread, run = steps * tread;
  const [dx, dz] = DV[dir];
  const yaw = Math.atan2(dx, dz);
  const parts: Part[] = [];
  const along = (s: number, side = 0): P2 => [x + dx * s - dz * side, z + dz * s + dx * side];
  const sz = (l: number, w: number, h: number): [number, number, number] => (dx !== 0 ? [l, h, w] : [w, h, l]);
  for (let i = 0; i < steps; i++) {
    const top = y0 + rise * (i + 1);
    const bottom = o.solid ? y0 : top - rise - 0.12;
    const c = along((i + 0.5) * tread);
    parts.push({ shape: 'box', pos: [c[0], (top + bottom) / 2, c[1]], size: sz(tread, width, top - bottom), material: mat });
    // Hrana stupně (tmavší linka, čitelnost) – jen u venkovních plných schodů (šetří trojúhelníky).
    if (o.solid) {
      const e = along(i * tread + 0.02);
      parts.push({ shape: 'box', pos: [e[0], top - 0.012, e[1]], size: sz(0.04, width, 0.025), material: 'concreteDark' });
    }
  }
  const mid = along(run / 2);
  const ang = Math.atan2(H, run), slopeL = Math.hypot(H, run);
  if (o.solid) parts.push({ shape: 'wedge', pos: [mid[0], y0 + H / 2, mid[1]], rot: [0, yaw, 0], size: [width, H, run], material: mat, collide: true, render: false });
  else {
    // Vnitřní rameno: tenká šikmá deska (pod ní zůstane výška pro rameno o patro níž).
    const th = 0.25;
    const rot: [number, number, number] = dx !== 0 ? [0, 0, dx * ang] : [-dz * ang, 0, 0];
    const nOff = th / 2 / Math.cos(ang);
    parts.push({ shape: 'box', pos: [mid[0], y0 + H / 2 - nOff, mid[1]], rot, size: dx !== 0 ? [slopeL, th, width] : [width, th, slopeL], material: mat, collide: true, render: false });
  }
  for (const side of ['left', 'right'] as const) {
    // Levá strana při výstupu = směr (−dz, dx) otočený… pro výstup k +z je levá strana +x.
    const sgn = side === 'left' ? 1 : -1;
    const off = (sgn * width) / 2;
    const sideVec: P2 = [dz * sgn, -dx * sgn];
    void sideVec;
    const pc = along(run / 2, -off);
    if (o.wallSide?.includes(side)) {
      // Zídka: šikmý kvádr nad stupni (výška 1 m nad hranou stupňů) + plná podstava.
      const lx = pc[0], lz = pc[1];
      parts.push({ shape: 'box', pos: [lx, y0 + H / 2 + 0.5, lz], rot: dx !== 0 ? [0, 0, dx * ang] : [-dz * ang, 0, 0], size: dx !== 0 ? [slopeL + 0.1, 1.0, 0.18] : [0.18, 1.0, slopeL + 0.1], material: mat, collide: true });
      if (o.solid) parts.push({ shape: 'wedge', pos: [lx, y0 + H / 2, lz], rot: [0, yaw, 0], size: [0.18, H, run], material: mat });
      parts.push({ shape: 'box', pos: [lx, y0 + H / 2 + 1.02, lz], rot: dx !== 0 ? [0, 0, dx * ang] : [-dz * ang, 0, 0], size: dx !== 0 ? [slopeL + 0.12, 0.05, 0.24] : [0.24, 0.05, slopeL + 0.12], material: o.trim ?? 'sandstone' });
    }
    if (o.railSide?.includes(side)) {
      const rot: [number, number, number] = dx !== 0 ? [0, 0, dx * ang] : [-dz * ang, 0, 0];
      parts.push({ shape: 'box', pos: [pc[0], y0 + H / 2 + 0.95, pc[1]], rot, size: dx !== 0 ? [slopeL, 0.05, 0.05] : [0.05, 0.05, slopeL], material: 'paintedMetal' });
      const n = Math.max(2, Math.round(run / 1.2));
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * run;
        const q = along(s, -off);
        const yb = y0 + (s / run) * H;
        parts.push({ shape: 'box', pos: [q[0], yb + 0.475, q[1]], size: [0.04, 0.95, 0.04], material: 'paintedMetal' });
      }
      parts.push({ shape: 'box', pos: [pc[0], y0 + H / 2 + 0.5, pc[1]], rot, size: dx !== 0 ? [slopeL, 1.0, 0.06] : [0.06, 1.0, slopeL], material: 'paintedMetal', collide: true, render: false, moveOnly: true });
    }
  }
  return { parts, run, steps, rise };
}

/** Rovná podesta (deska s kolizí) [x0, z0, x1, z1] s horní plochou v y; volitelně plná podstava. */
export function landing(r: Rect, y: number, mat: string, solid = true): Part[] {
  const h = solid ? y : 0.2;
  return [{ shape: 'box', pos: [(r[0] + r[2]) / 2, y - h / 2, (r[1] + r[3]) / 2], size: [r[2] - r[0], h, r[3] - r[1]], material: mat, collide: true }];
}

/** Kovové zábradlí po přímce (průstřelné, blokuje pohyb). */
export function rail(a: P2, b: P2, y: number, h = 1.0): Part[] {
  const parts: Part[] = [];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const alongX = Math.abs(b[1] - a[1]) < 1e-6;
  const c: [number, number, number] = [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2];
  parts.push({ shape: 'box', pos: [c[0], y + h, c[2]], size: alongX ? [len, 0.05, 0.05] : [0.05, 0.05, len], material: 'paintedMetal' });
  parts.push({ shape: 'box', pos: [c[0], y + h * 0.5, c[2]], size: alongX ? [len, 0.04, 0.03] : [0.03, 0.04, len], material: 'paintedMetal' });
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    parts.push({ shape: 'box', pos: [a[0] + (b[0] - a[0]) * t, y + h / 2, a[1] + (b[1] - a[1]) * t], size: [0.05, h, 0.05], material: 'paintedMetal' });
  }
  parts.push({ shape: 'box', pos: [c[0], y + h / 2, c[2]], size: alongX ? [len, h, 0.06] : [0.06, h, len], material: 'paintedMetal', collide: true, render: false, moveOnly: true });
  return parts;
}

/** Sokl (pás u země) a římsa kolem obdélníku – vzhled. */
export function bands(r: Rect, plinthH: number, corniceY: number | null, plinthMat: string, corniceMat: string): Part[] {
  const [x0, z0, x1, z1] = r;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const parts: Part[] = [];
  const ring = (y: number, h: number, out: number, mat: string) => {
    parts.push({ shape: 'box', pos: [cx, y, z0 - out / 2], size: [W + 2 * out, h, out], material: mat });
    parts.push({ shape: 'box', pos: [cx, y, z1 + out / 2], size: [W + 2 * out, h, out], material: mat });
    parts.push({ shape: 'box', pos: [x0 - out / 2, y, cz], size: [out, h, D], material: mat });
    parts.push({ shape: 'box', pos: [x1 + out / 2, y, cz], size: [out, h, D], material: mat });
  };
  if (plinthH > 0) ring(plinthH / 2, plinthH, 0.04, plinthMat);
  if (corniceY !== null) ring(corniceY, 0.14, 0.07, corniceMat);
  return parts;
}

/** Nádrž na vodu na ocelovém stojanu (pata v y). */
export function tank(x: number, z: number, y: number, standH = 0.9, d = 1.2, h = 1.3): Part[] {
  const parts: Part[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [x + sx * d * 0.36, y + standH / 2, z + sz * d * 0.36], size: [0.07, standH, 0.07], material: 'paintedMetal' });
  parts.push({ shape: 'box', pos: [x, y + standH - 0.03, z], size: [d * 0.85, 0.06, d * 0.85], material: 'paintedMetal' });
  parts.push({ shape: 'cylinder', pos: [x, y + standH + h / 2, z], size: [d, h, d], material: 'paintedMetalBlue', collide: true });
  parts.push({ shape: 'cylinder', pos: [x, y + standH + h + 0.05, z], size: [d * 0.6, 0.1, d * 0.6], material: 'metal' });
  parts.push({ shape: 'cylinder', pos: [x + d * 0.4, y + standH * 0.5, z], size: [0.06, standH, 0.06], material: 'metal' });
  // Kolize stojanu jako jeden kvádr (nohy by jinak chytaly hráče).
  parts.push({ shape: 'box', pos: [x, y + standH / 2, z], size: [d * 0.78, standH, d * 0.78], material: 'metal', collide: true, render: false });
  return parts;
}

/** Žebřík (vzhled); kolizi a lezení dodá `ladders` assetu. Pata (x, z), stěna ve směru `face`. */
export function ladderParts(x: number, z: number, y0: number, h: number, face: Dir): Part[] {
  const [dx, dz] = DV[face];
  const parts: Part[] = [];
  const W = 0.5;
  for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [x - dz * s * W / 2, y0 + (h + 1) / 2, z + dx * s * W / 2], size: [0.05, h + 1, 0.06], material: 'metal' });
  for (let y = 0.3; y < h + 0.9; y += 0.3) parts.push({ shape: 'box', pos: [x, y0 + y, z], size: dx !== 0 ? [0.04, 0.035, W] : [W, 0.035, 0.04], material: 'metal' });
  return parts;
}

/** Žebřík pro simulaci: pata (x, z), lezec stojí na straně −face a dívá se ve směru `face`. */
export function ladderDef(x: number, z: number, y0: number, h: number, face: Dir): LadderLocal {
  const [dx, dz] = DV[face];
  return { base: [x, y0, z], height: h, width: 0.5, yaw: Math.atan2(dx, dz) };
}

// ---------------- vybavení ----------------

export function table(x: number, z: number, y: number, w = 1.4, d = 0.8, rot = 0): Part[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
  const parts: Part[] = [{ shape: 'box', pos: [x, y + 0.73, z], rot: [0, rot, 0], size: [w, 0.05, d], material: 'wood', collide: true }];
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const p = P(su * (w / 2 - 0.06), sv * (d / 2 - 0.06));
    parts.push({ shape: 'box', pos: [p[0], y + 0.355, p[1]], size: [0.06, 0.71, 0.06], material: 'woodDark' });
  }
  return parts;
}

export function chair(x: number, z: number, y: number, rot = 0): Part[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  const back: [number, number] = [x + 0.2 * s, z + 0.2 * c];
  return [
    { shape: 'box', pos: [x, y + 0.45, z], rot: [0, rot, 0], size: [0.42, 0.04, 0.42], material: 'wood' },
    { shape: 'box', pos: [back[0], y + 0.7, back[1]], rot: [0, rot, 0], size: [0.42, 0.45, 0.04], material: 'wood' },
    { shape: 'box', pos: [x, y + 0.22, z], rot: [0, rot, 0], size: [0.38, 0.44, 0.38], material: 'woodDark' },
  ];
}

export function mattress(x: number, z: number, y: number, rot = 0): Part[] {
  return [
    { shape: 'box', pos: [x, y + 0.08, z], rot: [0, rot, 0], size: [0.9, 0.16, 1.9], material: 'fabricSand' },
    { shape: 'box', pos: [x + Math.sin(rot) * 0.75, y + 0.2, z + Math.cos(rot) * 0.75], rot: [0, rot, 0], size: [0.55, 0.1, 0.3], material: 'awningSand' },
  ];
}

export function shelf(x: number, z: number, y: number, rot = 0, w = 1.2): Part[] {
  const parts: Part[] = [{ shape: 'box', pos: [x, y + 0.95, z], rot: [0, rot, 0], size: [w, 1.9, 0.4], material: 'woodDark', collide: true, render: false }];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const su of [-1, 1]) parts.push({ shape: 'box', pos: [x + su * (w / 2 - 0.02) * c, y + 0.95, z - su * (w / 2 - 0.02) * s], rot: [0, rot, 0], size: [0.04, 1.9, 0.4], material: 'woodDark' });
  for (let i = 0; i < 4; i++) parts.push({ shape: 'box', pos: [x, y + 0.1 + i * 0.58, z], rot: [0, rot, 0], size: [w, 0.04, 0.4], material: 'wood' });
  return parts;
}

export function crate(x: number, z: number, y: number, s = 0.6, rot = 0): Part[] {
  return [{ shape: 'box', pos: [x, y + s / 2, z], rot: [0, rot, 0], size: [s, s, s], material: 'wood', collide: true }];
}

/** Rug: plochý koberec (bez kolize). */
export function rug(x: number, z: number, y: number, w: number, d: number, rot = 0): Part[] {
  return [{ shape: 'box', pos: [x, y + 0.012, z], rot: [0, rot, 0], size: [w, 0.02, d], material: 'fabricSand' }];
}

/** Okapový chrlič (vzhled) ve výšce y na vnější straně zdi. */
export function spout(x: number, z: number, y: number, out: P2): Part[] {
  return [{ shape: 'box', pos: [x + out[0] * 0.25, y, z + out[1] * 0.25], size: out[0] !== 0 ? [0.5, 0.1, 0.12] : [0.12, 0.1, 0.5], material: 'metal' }];
}

/** Nástěnná klimatizace (vzhled + malá kolize) na vnější straně zdi. */
export function acBox(x: number, z: number, y: number, out: P2): Part[] {
  const rot = Math.atan2(out[0], out[1]);
  return [
    { shape: 'box', pos: [x + out[0] * 0.22, y, z + out[1] * 0.22], rot: [0, rot, 0], size: [0.85, 0.6, 0.42], material: 'acUnit', collide: true },
    { shape: 'box', pos: [x + out[0] * 0.16, y - 0.36, z + out[1] * 0.16], rot: [0, rot, 0], size: [0.8, 0.04, 0.3], material: 'metal' },
  ];
}

// ---------------- dvouramenné schodiště (činžáky) ----------------

export interface Core {
  /** Půdorys schodišťového prostoru [x0, z0, x1, z1] (otvor ve stropech). */
  rect: Rect;
  /** Hrana nástupu/výstupu (z0): rameno A začíná, rameno B končí. */
  zStart: number;
  /** x ramene A (stoupá od z0 dozadu) a ramene B (vrací se dopředu). */
  xa: number;
  xb: number;
  run: number;
}

/** Geometrie schodišťového jádra: ramena šířky w, dělicí zeď g, mezipodesta L (hloubka). */
export function coreLayout(cx: number, zStart: number, w = 1.1, storey = M.storey, g = 0.15, L = 1.2, flip = false): Core {
  const steps = Math.ceil(storey / 2 / M.riser - 1e-6);
  const run = steps * M.tread;
  const off = (w + g) / 2;
  const xa = flip ? cx + off : cx - off, xb = flip ? cx - off : cx + off;
  return { rect: [cx - w - g / 2, zStart, cx + w + g / 2, zStart + run + L], zStart, xa, xb, run };
}

/**
 * Jedno podlaží dvouramenného schodiště od podlahy y0 o výšku `storey`: rameno A dozadu
 * na mezipodestu, rameno B zpět dopředu na hranu zStart o patro výš. Mezi rameny plná
 * dělicí zeď (kryje). Kolize ramen = rampy.
 */
export function coreFlights(c: Core, y0: number, storey: number, w: number, mat: string, wallMat: string): Part[] {
  const parts: Part[] = [];
  const yMid = y0 + storey / 2, yTop = y0 + storey;
  parts.push(...stairs(c.xa, c.zStart, 'z+', w, y0, yMid, mat).parts);
  parts.push(...stairs(c.xb, c.zStart + c.run, 'z-', w, yMid, yTop, mat).parts);
  const [x0, , x1, z1] = c.rect;
  parts.push(...landing([x0, c.zStart + c.run, x1, z1], yMid, mat, false));
  // Dělicí zeď mezi rameny (po délku ramen).
  parts.push({ shape: 'box', pos: [(c.xa + c.xb) / 2, y0 + storey / 2, c.zStart + c.run / 2], size: [Math.abs(c.xb - c.xa) - w, storey, c.run], material: wallMat, collide: true });
  return parts;
}

/**
 * Střešní nástavba nad schodištěm: obvodové stěny kolem jádra + vstupní předsíň hloubky `vest`
 * před hranou nástupu, dveře v čele (ke střeše), stropní deska. Pata v y (úroveň střechy).
 */
export function stairHouse(c: Core, y: number, mat: string, trim: string, vest = 1.4, h = 2.7): Part[] {
  const [x0, z0, x1, z1] = c.rect;
  const t = 0.2;
  const X0 = x0 - t, X1 = x1 + t, Z0 = z0 - vest, Z1 = z1 + t;
  const parts: Part[] = [];
  const cx = (X0 + X1) / 2;
  parts.push(...wall([X0, Z0 + t / 2], [X1, Z0 + t / 2], y, h, t, [door(cx - X0, { leaf: false })], mat, { out: [0, -1], trim }));
  parts.push(...wall([X0, Z1 - t / 2], [X1, Z1 - t / 2], y, h, t, [], mat, { plain: true }));
  for (const [xx, out] of [[X0 + t / 2, -1], [X1 - t / 2, 1]] as const) parts.push(...wall([xx, Z0 + t], [xx, Z1 - t], y, h, t, [win(1.0, { w: 0.6, b: 1.4, t: 2.0 })], mat, { out: [out, 0], trim }));
  parts.push(...slab([X0 - 0.05, Z0 - 0.05, X1 + 0.05, Z1 + 0.05], y + h + 0.2, 0.2, [], 'concreteLight'));
  parts.push({ shape: 'box', pos: [cx, y + h + 0.33, (Z0 + Z1) / 2], size: [X1 - X0 + 0.1, 0.06, Z1 - Z0 + 0.1], material: trim });
  return parts;
}

/**
 * Stěna v libovolném směru (zkosené nároží, vychýlené hliněné zdi): natočené kvádry kolem otvorů.
 * `out` = +1 / −1 vnější strana vlevo / vpravo od směru a→b (pro lišty a parapet).
 * `ext` prodlouží stěnu na obou koncích (překryv rohů u nepravoúhlých půdorysů).
 */
export function wallLine(a: P2, b: P2, y0: number, h: number, t: number, ops: Op[], mat: string, out: 1 | -1, o: { trim?: string; ext?: number; collideInfill?: boolean } = {}): Part[] {
  const ext = o.ext ?? 0;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L0 = Math.hypot(dx, dz);
  const ux = dx / L0, uz = dz / L0;
  const A: P2 = [a[0] - ux * ext, a[1] - uz * ext];
  const L = L0 + 2 * ext;
  const yaw = Math.atan2(ux, uz);
  // Normála (lokální +X boxu) = (cos yaw, −sin yaw); vnější strana podle `out`.
  const nx = Math.cos(yaw) * out, nz = -Math.sin(yaw) * out;
  const at = (u: number, v: number, w = 0): [number, number, number] => [A[0] + ux * u + nx * w, y0 + v, A[1] + uz * u + nz * w];
  const rot: [number, number, number] = [0, yaw, 0];
  const parts: Part[] = [];
  const seg = (u0: number, u1: number, v0: number, v1: number) => {
    if (u1 - u0 < 1e-3 || v1 - v0 < 1e-3) return;
    parts.push({ shape: 'box', pos: at((u0 + u1) / 2, (v0 + v1) / 2), rot, size: [t, v1 - v0, u1 - u0], material: mat, collide: true });
  };
  const sorted = [...ops].map((q) => ({ ...q, c: q.c + ext })).sort((p, q) => p.c - q.c);
  let cur = 0;
  for (const op of sorted) {
    const u0 = Math.max(cur, op.c - op.w / 2), u1 = Math.min(L, op.c + op.w / 2);
    seg(cur, u0, 0, h);
    seg(u0, u1, 0, op.b);
    seg(u0, u1, op.t, h);
    cur = u1;
  }
  seg(cur, L, 0, h);
  const trim = o.trim ?? 'sandstone';
  for (const op of sorted) {
    if (op.bare) continue;
    const ow = op.w, oh = op.t - op.b;
    parts.push({ shape: 'box', pos: at(op.c, op.t + 0.08, t / 2 + 0.02), rot, size: [0.06, 0.16, ow + 0.26], material: trim });
    if (op.kind === 'window') parts.push({ shape: 'box', pos: at(op.c, op.b - 0.04, t / 2 + 0.05), rot, size: [0.12, 0.08, ow + 0.2], material: trim });
    if (MODE.closed) {
      const glass = op.kind === 'window';
      parts.push({ shape: 'box', pos: at(op.c, op.b + oh / 2, glass ? -0.02 : -0.06), rot, size: [glass ? 0.03 : 0.06, oh - 0.02, ow - 0.02], material: glass ? 'glass' : 'woodDark', collide: !!o.collideInfill });
    }
  }
  return parts;
}
