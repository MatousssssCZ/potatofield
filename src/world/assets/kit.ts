import type { Part } from '../parts';

export type Side = 'front' | 'back' | 'left' | 'right';

/**
 * Rámec fasády obdélníkové budovy (střed v počátku, čelo k −Z).
 * Souřadnice fasády: u = vodorovně po fasádě (zleva doprava při pohledu zvenku),
 * v = výška, w = ven od zdi. Díly kladené v rámci mají osu X podél fasády a Z ven.
 */
export function facade(side: Side, W: number, D: number) {
  const n = side === 'front' ? [0, -1] : side === 'back' ? [0, 1] : side === 'left' ? [-1, 0] : [1, 0];
  const theta = Math.atan2(n[0], n[1]);
  const ux = Math.cos(theta), uz = -Math.sin(theta);
  const half = side === 'front' || side === 'back' ? D / 2 : W / 2;
  const len = side === 'front' || side === 'back' ? W : D;
  return {
    len,
    rot: [0, theta, 0] as [number, number, number],
    pos(u: number, v: number, w: number): [number, number, number] {
      return [n[0] * (half + w) + ux * u, v, n[1] * (half + w) + uz * u];
    },
  };
}

export type Facade = ReturnType<typeof facade>;

export function fbox(f: Facade, u: number, v: number, w: number, size: [number, number, number], material: string, extra: Partial<Part> = {}): Part {
  return { shape: 'box', pos: f.pos(u, v, w), rot: f.rot, size, material, ...extra };
}

export interface Opening {
  /** Střed otvoru podél stěny (u). */
  u: number;
  width: number;
  bottom: number;
  top: number;
}

/**
 * Stěna délky `len` se skutečnými otvory (dveře, okna): sestaví se z kvádrů
 * kolem otvorů. Otvor je průchozí pro hráče i střely.
 */
export function wallWithOpenings(f: Facade, len: number, height: number, thick: number, openings: Opening[], material: string, wOffset = -thick / 2): Part[] {
  const parts: Part[] = [];
  const ops = [...openings].sort((a, b) => a.u - b.u);
  let cursor = -len / 2;
  const seg = (u0: number, u1: number, v0: number, v1: number) => {
    if (u1 - u0 < 1e-3 || v1 - v0 < 1e-3) return;
    parts.push(fbox(f, (u0 + u1) / 2, (v0 + v1) / 2, wOffset, [u1 - u0, v1 - v0, thick], material, { collide: true }));
  };
  for (const o of ops) {
    const a = o.u - o.width / 2, b = o.u + o.width / 2;
    seg(cursor, a, 0, height);
    seg(a, b, 0, o.bottom);
    seg(a, b, o.top, height);
    cursor = b;
  }
  seg(cursor, len / 2, 0, height);
  return parts;
}

/** Rám kolem otvoru (ostění, nadpraží, parapet) – hloubka fasády. */
export function openingFrame(f: Facade, o: Opening, wallThick: number, trim: string, sill = true): Part[] {
  const parts: Part[] = [];
  const h = o.top - o.bottom, t = 0.09;
  parts.push(fbox(f, o.u, o.top + 0.08, 0.04, [o.width + 0.24, 0.16, 0.1], trim));
  if (sill && o.bottom > 0.05) parts.push(fbox(f, o.u, o.bottom - 0.04, 0.06, [o.width + 0.24, 0.08, 0.14], trim));
  for (const s of [-1, 1]) parts.push(fbox(f, o.u + (s * (o.width + t)) / 2, o.bottom + h / 2, 0.02, [t, h, 0.06], trim));
  // Ostění uvnitř otvoru (ať je vidět tloušťka zdi).
  parts.push(fbox(f, o.u, o.top - 0.01, -wallThick / 2, [o.width, 0.02, wallThick], trim));
  return parts;
}

/** Parametr „kopírovat terén“ pro liniové stavby (plot, zdi). */
export const FOLLOW_PARAM = { key: 'follow', label: 'Kopírovat terén', type: 'bool' as const, default: true };

/**
 * Šikmý kvádr mezi body podél osy X: od (x0, y0) do (x1, y1), spodní hrana `below` pod linií,
 * výška `h` nad ní, tloušťka `t`, střed v z. Na rovině je to obyčejný kvádr (rot 0).
 */
export function slopeBox(x0: number, y0: number, x1: number, y1: number, below: number, h: number, t: number, z: number, material: string, extra: Partial<Part> = {}): Part {
  const dx = x1 - x0, dy = y1 - y0;
  const ang = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy);
  const mid = (y0 + y1) / 2 + (h - below) / 2;
  const part: Part = { shape: 'box', pos: [(x0 + x1) / 2, mid, z], size: [len, h + below, t], material, ...extra };
  if (Math.abs(ang) > 1e-6) part.rot = [0, 0, ang];
  return part;
}
