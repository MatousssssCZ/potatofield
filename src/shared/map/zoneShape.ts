import type { Zone } from './schema';

/** Bod půdorysu zóny v lokálních souřadnicích (vůči středu, natočeno o yaw), m. */
export type ZonePt = [number, number];

/** Nejméně / nejvíce vrcholů mnohoúhelníku zóny. */
export const ZONE_POINTS = { min: 3, max: 64 } as const;

/** Půdorys zóny: vlastní mnohoúhelník, nebo obdélník ±halfExtents (starší mapy). */
export function zoneOutline(z: Pick<Zone, 'halfExtents' | 'points'>): ZonePt[] {
  if (z.points && z.points.length >= ZONE_POINTS.min) return z.points;
  const [hx, , hz] = z.halfExtents;
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
}

/** Bod v mnohoúhelníku (sudo-liché pravidlo). */
export function pointInPolygon(x: number, z: number, pts: ZonePt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Plocha mnohoúhelníku se znaménkem (kladná = proti směru hodinových ručiček v rovině x–z). */
export function polygonArea(pts: ZonePt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

function segCross(a: ZonePt, b: ZonePt, c: ZonePt, d: ZonePt): boolean {
  const o = (p: ZonePt, q: ZonePt, r: ZonePt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Hrany se nekříží (jednoduchý mnohoúhelník). */
export function isSimplePolygon(pts: ZonePt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // sousední hrany sdílí vrchol
      if (segCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  return true;
}

/** Je bod (ve světě; y = chodidla) uvnitř zóny? Hráč se měří ve výšce trupu (+0,9 m). */
export function insideZone(z: Zone, p: { x: number; y: number; z: number }): boolean {
  if (Math.abs(p.y + 0.9 - z.center[1]) > z.halfExtents[1]) return false;
  const dx = p.x - z.center[0], dz = p.z - z.center[2];
  // Inverze otočení kolem Y, jak ho kreslí three.js (rotation.y = yaw): lokální = Ry(−yaw) · svět.
  const c = Math.cos(z.yaw), s = Math.sin(z.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (!z.points || z.points.length < ZONE_POINTS.min) return Math.abs(lx) <= z.halfExtents[0] && Math.abs(lz) <= z.halfExtents[2];
  return pointInPolygon(lx, lz, z.points);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Zóna s novým půdorysem (body lokálně vůči současnému středu a natočení). Střed se přesune doprostřed
 * obalu bodů (body se posunou opačně, ve světě zůstanou na místě) a halfExtents x/z obalí body.
 */
export function withPolygon<T extends Zone>(z: T, local: ZonePt[]): T {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, q] of local) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, q);
    z1 = Math.max(z1, q);
  }
  const bx = (x0 + x1) / 2, bz = (z0 + z1) / 2;
  const c = Math.cos(z.yaw), s = Math.sin(z.yaw);
  return {
    ...z,
    // Posun středu ve světě = otočený lokální posun (stejně jako three.js rotation.y).
    center: [r2(z.center[0] + bx * c + bz * s), z.center[1], r2(z.center[2] - bx * s + bz * c)],
    halfExtents: [Math.max(0.5, r2((x1 - x0) / 2)), z.halfExtents[1], Math.max(0.5, r2((z1 - z0) / 2))],
    points: local.map(([x, q]) => [r2(x - bx), r2(q - bz)] as ZonePt),
  };
}

/** Bod ve světě → lokální souřadnice zóny. */
export function zoneLocal(z: Pick<Zone, 'center' | 'yaw'>, wx: number, wz: number): ZonePt {
  const dx = wx - z.center[0], dz = wz - z.center[2];
  const c = Math.cos(z.yaw), s = Math.sin(z.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Lokální bod zóny → svět (x, z). */
export function zoneWorld(z: Pick<Zone, 'center' | 'yaw'>, p: ZonePt): ZonePt {
  const c = Math.cos(z.yaw), s = Math.sin(z.yaw);
  return [z.center[0] + p[0] * c + p[1] * s, z.center[2] - p[0] * s + p[1] * c];
}
