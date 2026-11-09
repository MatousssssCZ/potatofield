/**
 * Magnet budov: při posunu se předmět přilepí k sousední budově / modulu líc na líc
 * a zarovná hrany (nebo středy). Funguje pro stejně natočené předměty (± násobky 90°).
 * Čistá funkce (bez Three.js) – testuje se zvlášť.
 */

export interface MagnetBody {
  id: string;
  /** Poloha pivotu ve světě [x, z]. */
  pos: [number, number];
  yaw: number;
  scale: number;
  /** Lokální půdorys [x0, z0, x1, z1] (neškálovaný). */
  fp: [number, number, number, number];
}

export interface MagnetResult {
  pos: [number, number];
  to: string;
  /** Posun proti vstupní poloze (m). */
  dist: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Půdorys pohybujícího se předmětu v rámci souseda (osy souseda), vzhledem k pivotu. */
function rectIn(m: MagnetBody, yawRel: number): [number, number, number, number] {
  const c = Math.cos(yawRel), s = Math.sin(yawRel);
  const [x0, z0, x1, z1] = m.fp.map((v) => v * m.scale);
  let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    // Stejná konvence jako toWorld (groundFit): x' = c·x + s·z, z' = −s·x + c·z.
    const u = c * x + s * z, v = -s * x + c * z;
    a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v);
  }
  return [a0, b0, a1, b1];
}

/**
 * Najde nejbližší přilepení: dotyk líců na jedné ose (mezera nebo překryv do `reach`) při
 * překryvu na druhé ose, a na druhé ose zarovnání hran / středu do `reach`.
 */
export function magnetSnap(m: MagnetBody, others: MagnetBody[], reach = 0.6): MagnetResult | null {
  let best: MagnetResult | null = null;
  for (const o of others) {
    if (o.id === m.id) continue;
    const rel = wrap(m.yaw - o.yaw);
    const q = Math.round(rel / (Math.PI / 2));
    if (Math.abs(rel - q * (Math.PI / 2)) > 0.035) continue;
    // Do lokálních os souseda.
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    const dx = m.pos[0] - o.pos[0], dz = m.pos[1] - o.pos[1];
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const r = rectIn(m, q * (Math.PI / 2));
    const M: [number, number, number, number] = [lx + r[0], lz + r[1], lx + r[2], lz + r[3]];
    const O = o.fp.map((v) => v * o.scale) as [number, number, number, number];
    const cands: [number, number][] = [];
    for (const axis of [0, 1] as const) {
      const o2 = 1 - axis;
      // Skutečný překryv na druhé ose (aspoň 5 cm), jinak se o dotyk líců nejedná.
      if (Math.min(M[o2 + 2], O[o2 + 2]) - Math.max(M[o2], O[o2]) < 0.05) continue;
      const touches = [O[axis + 2] - M[axis], O[axis] - M[axis + 2]].filter((d) => Math.abs(d) <= reach);
      if (!touches.length) continue;
      const t = touches.reduce((a, b) => (Math.abs(a) < Math.abs(b) ? a : b));
      const aligns = [O[o2] - M[o2], O[o2 + 2] - M[o2 + 2], (O[o2] + O[o2 + 2]) / 2 - (M[o2] + M[o2 + 2]) / 2].filter((d) => Math.abs(d) <= reach);
      const a = aligns.length ? aligns.reduce((p, n) => (Math.abs(p) < Math.abs(n) ? p : n)) : 0;
      cands.push(axis === 0 ? [t, a] : [a, t]);
    }
    for (const [ux, uz] of cands) {
      const dist = Math.hypot(ux, uz);
      if (best && dist >= best.dist) continue;
      // Zpět do světa (inverze rotace souseda).
      const wx = c * ux + s * uz, wz = -s * ux + c * uz;
      best = { pos: [m.pos[0] + wx, m.pos[1] + wz], to: o.id, dist };
    }
  }
  return best;
}
