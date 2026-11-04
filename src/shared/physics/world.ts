import RAPIER from '@dimforge/rapier3d-compat';
import type { TerrainData } from '../map/schema';
import type { ColliderDef, HitSurface } from '../../world/parts';
import type { V3 } from '../math';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;

/** Jednorázová inicializace WASM (prohlížeč i Node). */
export function initRapier(): Promise<Rapier> {
  if (!rapierReady) {
    rapierReady = RAPIER.init().then(() => RAPIER);
  }
  return rapierReady;
}

/** Kolizní skupiny: (členství << 16) | filtr. */
export const GROUP = {
  WORLD: 0x0001,
  BULLET_ONLY: 0x0002,
  PLAYER: 0x0004,
  BULLET: 0x0008,
} as const;

const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const MOVE_QUERY_GROUPS = groups(GROUP.PLAYER, GROUP.WORLD);
export const BULLET_QUERY_GROUPS = groups(GROUP.BULLET, GROUP.WORLD | GROUP.BULLET_ONLY);

export interface RayHit {
  distance: number;
  point: V3;
  normal: V3;
  surface: HitSurface;
  objectId: string;
}

/**
 * Statický kolizní svět mapy. Odvozený výhradně z dat mapy (bez DOM/renderu),
 * takže ho server může sestavit stejně jako klient.
 */
export class PhysicsWorld {
  readonly R: Rapier;
  readonly world: RAPIER.World;
  private meta = new Map<number, { surface: HitSurface; objectId: string }>();
  private objectColliders = new Map<string, RAPIER.Collider[]>();
  private terrainCollider: RAPIER.Collider | null = null;
  private dirty = true;

  constructor(R: Rapier) {
    this.R = R;
    this.world = new R.World({ x: 0, y: 0, z: 0 });
  }

  static async create(): Promise<PhysicsWorld> {
    return new PhysicsWorld(await initRapier());
  }

  addColliders(defs: ColliderDef[]) {
    const R = this.R;
    for (const d of defs) {
      let desc: RAPIER.ColliderDesc | null;
      if (d.kind === 'box') {
        desc = R.ColliderDesc.cuboid(d.half.x, d.half.y, d.half.z).setTranslation(d.center.x, d.center.y, d.center.z).setRotation(d.rotation);
      } else if (d.kind === 'cylinder') {
        desc = R.ColliderDesc.cylinder(d.half.y, d.half.x).setTranslation(d.center.x, d.center.y, d.center.z).setRotation(d.rotation);
      } else {
        desc = R.ColliderDesc.convexHull(new Float32Array(d.points!));
      }
      if (!desc) continue;
      desc.setCollisionGroups(groups(d.bulletOnly ? GROUP.BULLET_ONLY : GROUP.WORLD, 0xffff));
      const c = this.world.createCollider(desc);
      this.meta.set(c.handle, { surface: d.surface, objectId: d.objectId });
      const list = this.objectColliders.get(d.objectId) ?? [];
      list.push(c);
      this.objectColliders.set(d.objectId, list);
    }
    this.dirty = true;
  }

  /** Odstraní kolize objektu (při přegenerování parametrů v editoru). */
  removeObject(objectId: string) {
    const list = this.objectColliders.get(objectId);
    if (!list) return;
    for (const c of list) {
      this.meta.delete(c.handle);
      this.world.removeCollider(c, false);
    }
    this.objectColliders.delete(objectId);
    this.dirty = true;
  }

  setTerrain(t: TerrainData) {
    const R = this.R;
    if (this.terrainCollider) {
      this.meta.delete(this.terrainCollider.handle);
      this.world.removeCollider(this.terrainCollider, false);
    }
    // Rapier: matice (nrows+1)×(ncols+1) uložená po sloupcích; řádky = osa Z, sloupce = osa X.
    const nrows = t.samplesZ - 1;
    const ncols = t.samplesX - 1;
    const heights = new Float32Array(t.samplesX * t.samplesZ);
    for (let x = 0; x < t.samplesX; x++) {
      for (let z = 0; z < t.samplesZ; z++) {
        heights[x * t.samplesZ + z] = t.heights[z * t.samplesX + x];
      }
    }
    const sizeX = ncols * t.spacing;
    const sizeZ = nrows * t.spacing;
    const desc = R.ColliderDesc.heightfield(nrows, ncols, heights, { x: sizeX, y: 1, z: sizeZ }, R.HeightFieldFlags.FIX_INTERNAL_EDGES)
      .setTranslation(t.origin[0] + sizeX / 2, 0, t.origin[1] + sizeZ / 2)
      .setCollisionGroups(groups(GROUP.WORLD, 0xffff));
    const c = this.world.createCollider(desc);
    this.terrainCollider = c;
    this.meta.set(c.handle, { surface: 'sand', objectId: '__terrain' });
    this.dirty = true;
  }

  /** Aktualizuje akcelerační struktury dotazů (nutné po změně kolizí). */
  sync() {
    if (this.dirty) {
      this.world.step();
      this.dirty = false;
    }
  }

  surfaceOf(c: RAPIER.Collider) {
    return this.meta.get(c.handle);
  }

  castRay(from: V3, dir: V3, maxDist: number, queryGroups = BULLET_QUERY_GROUPS, exclude?: RAPIER.Collider): RayHit | null {
    this.sync();
    const ray = new this.R.Ray(from, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, queryGroups, exclude);
    if (!hit) return null;
    const m = this.meta.get(hit.collider.handle);
    if (!m) return null;
    const t = hit.timeOfImpact;
    return {
      distance: t,
      point: { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      surface: m.surface,
      objectId: m.objectId,
    };
  }

  /** Překrývá svislá kapsle (pata v `feet`) nějakou statickou geometrii? */
  capsuleBlocked(feet: V3, height: number, radius: number, exclude?: RAPIER.Collider, margin = 0.005): boolean {
    this.sync();
    const half = Math.max(0, height / 2 - radius);
    const shape = new this.R.Capsule(half, radius - margin);
    let hit = false;
    this.world.intersectionsWithShape(
      { x: feet.x, y: feet.y + height / 2 + margin, z: feet.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      () => {
        hit = true;
        return false;
      },
      undefined,
      MOVE_QUERY_GROUPS,
      exclude,
    );
    return hit;
  }

  /** Překrývá libovolný tvar statickou geometrii? */
  shapeBlocked(shape: RAPIER.Shape, pos: V3, rot: { x: number; y: number; z: number; w: number }, exclude?: RAPIER.Collider) {
    this.sync();
    let hit = false;
    this.world.intersectionsWithShape(pos, rot, shape, () => {
      hit = true;
      return false;
    }, undefined, MOVE_QUERY_GROUPS, exclude);
    return hit;
  }

  free() {
    this.world.free();
  }
}
