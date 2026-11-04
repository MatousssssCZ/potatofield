import type { MapObject } from '../shared/map/schema';
import { add, quatFromEuler, quatMul, rotate, scale, type Q, type V3 } from '../shared/math';

/**
 * Díl objektu. Generátory vracejí seznam dílů; z něj se deterministicky
 * odvozuje render geometrie (klient) i kolize (klient + server).
 *
 * Souřadnice dílu jsou v lokálním prostoru objektu. `size` jsou plné rozměry.
 */
export type PartShape = 'box' | 'wedge' | 'cylinder' | 'label';

export interface Part {
  shape: PartShape;
  /** Střed dílu v lokálním prostoru objektu. */
  pos: [number, number, number];
  /** Euler XYZ v radiánech. */
  rot?: [number, number, number];
  /** Plné rozměry [x, y, z]. Klín: stoupá od −z (výška 0) k +z (výška y). Válec: [průměr, výška, průměr]. */
  size: [number, number, number];
  /** ID materiálu (viz client/render/materials). */
  material: string;
  /** Kolidovat s hráčem a střelami. */
  collide?: boolean;
  /** Vykreslovat. Výchozí ano. */
  render?: boolean;
  /** Text pro 'label' díl. */
  text?: string;
  /** Kolize dílu pouze pro střely (ne pro pohyb), např. tenké plachty. */
  bulletOnly?: boolean;
  /** Vrhá stín (výchozí ano). */
  castShadow?: boolean;
}

export type HitSurface = 'concrete' | 'plaster' | 'metal' | 'wood' | 'sand' | 'dirt' | 'asphalt' | 'brick' | 'flesh' | 'fabric';

/** Max. poloviční rozměr jednoho kolizního kvádru (m). */
export const MAX_COLLIDER_HALF = 12;

export interface ColliderDef {
  kind: 'box' | 'hull' | 'cylinder';
  center: V3;
  rotation: Q;
  /** Pro box: poloviční rozměry. Pro cylinder: x = poloměr, y = polovina výšky. */
  half: V3;
  /** Pro hull: body ve světovém prostoru. */
  points?: number[];
  surface: HitSurface;
  objectId: string;
  bulletOnly?: boolean;
}

export function objectFrame(o: MapObject) {
  const [rx, ry, rz] = o.transform.rotation;
  const q = quatFromEuler(rx, ry, rz);
  const p = o.transform.position;
  const s = o.transform.scale ?? 1;
  return { q, pos: { x: p[0], y: p[1], z: p[2] }, s };
}

export function surfaceOf(material: string): HitSurface {
  if (material.startsWith('metal') || material.startsWith('paintedMetal')) return 'metal';
  if (material.startsWith('wood')) return 'wood';
  if (material.startsWith('brick')) return 'brick';
  if (material.startsWith('plaster')) return 'plaster';
  if (material.startsWith('sand')) return 'sand';
  if (material.startsWith('asphalt')) return 'asphalt';
  if (material.startsWith('fabric') || material.startsWith('target')) return 'fabric';
  return 'concrete';
}

/** Převede díly objektu na kolizní definice ve světovém prostoru. */
export function partsToColliders(o: MapObject, parts: Part[]): ColliderDef[] {
  const { q, pos, s } = objectFrame(o);
  const out: ColliderDef[] = [];
  for (const part of parts) {
    if (!part.collide || part.shape === 'label') continue;
    const pq = part.rot ? quatFromEuler(part.rot[0], part.rot[1], part.rot[2]) : { x: 0, y: 0, z: 0, w: 1 };
    const wq = quatMul(q, pq);
    const center = add(pos, rotate(q, scale({ x: part.pos[0], y: part.pos[1], z: part.pos[2] }, s)));
    const half = { x: (part.size[0] / 2) * s, y: (part.size[1] / 2) * s, z: (part.size[2] / 2) * s };
    const surface = surfaceOf(part.material);
    if (part.shape === 'box') {
      // Velké kvádry dělit na menší kusy: Rapier je u obřích tvarů numericky nestabilní
      // (ověřeno: postava zapadá do 400m kvádru). Tvar kolize se tím nemění.
      const nx = Math.ceil(half.x / MAX_COLLIDER_HALF), ny = Math.ceil(half.y / MAX_COLLIDER_HALF), nz = Math.ceil(half.z / MAX_COLLIDER_HALF);
      const ch = { x: half.x / nx, y: half.y / ny, z: half.z / nz };
      for (let ix = 0; ix < nx; ix++)
        for (let iy = 0; iy < ny; iy++)
          for (let iz = 0; iz < nz; iz++) {
            const local = { x: -half.x + ch.x * (2 * ix + 1), y: -half.y + ch.y * (2 * iy + 1), z: -half.z + ch.z * (2 * iz + 1) };
            out.push({ kind: 'box', center: add(center, rotate(wq, local)), rotation: wq, half: ch, surface, objectId: o.id, bulletOnly: part.bulletOnly });
          }
    } else if (part.shape === 'cylinder') {
      out.push({
        kind: 'cylinder',
        center,
        rotation: wq,
        half: { x: half.x, y: half.y, z: half.x },
        surface,
        objectId: o.id,
        bulletOnly: part.bulletOnly,
      });
    } else if (part.shape === 'wedge') {
      const pts: number[] = [];
      for (const lp of wedgeLocalPoints(half)) {
        const w = add(center, rotate(wq, lp));
        pts.push(w.x, w.y, w.z);
      }
      out.push({ kind: 'hull', center, rotation: wq, half, points: pts, surface, objectId: o.id, bulletOnly: part.bulletOnly });
    }
  }
  return out;
}

/** Šest vrcholů klínu (vzhledem ke středu dílu). */
export function wedgeLocalPoints(h: V3): V3[] {
  return [
    { x: -h.x, y: -h.y, z: -h.z },
    { x: h.x, y: -h.y, z: -h.z },
    { x: -h.x, y: -h.y, z: h.z },
    { x: h.x, y: -h.y, z: h.z },
    { x: -h.x, y: h.y, z: h.z },
    { x: h.x, y: h.y, z: h.z },
  ];
}
