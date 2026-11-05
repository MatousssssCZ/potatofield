import type { WeaponConfig } from '../config/weapon';
import type { MovementConfig } from '../config/movement';
import type { V3 } from '../math';
import type { PhysicsWorld, RayHit } from '../physics/world';
import type { PlayerState } from './player';
import type { HitSurface } from '../../world/parts';

/**
 * Projektily s časem letu a gravitací. Každý tick se testuje celý úsek dráhy
 * (rychlá střela neproletí tenkou zdí). Jeden projektil = nejvýš jeden zásah.
 */

export type HitZone = 'head' | 'torso' | 'limb';

export interface Projectile {
  /** playerId:lifeId:shotSeq – deduplikace efektů a zásahů. */
  key: string;
  owner: string;
  team?: string;
  origin: V3;
  pos: V3;
  vel: V3;
  age: number;
  /** Pravidla zbraně, která projektil vystřelila (poškození, gravitace, životnost). */
  rules?: WeaponConfig;
  /** Index broku (brokovnice), jinak 0. */
  pellet?: number;
}

export interface Hitbox {
  id: string;
  team?: string;
  /** Kapsle A–B s poloměrem. */
  a: V3;
  b: V3;
  r: number;
  /** Jak zóny určit: 'vertical' podle výšky, 'prone' podle délky (hlava vpředu = b). */
  kind: 'vertical' | 'prone';
  feetY: number;
  height: number;
}

export interface ImpactEvent {
  key: string;
  owner: string;
  point: V3;
  normal: V3;
  surface: HitSurface;
  /** Zasažený hráč/figurína (jinak svět). */
  target?: string;
  zone?: HitZone;
  damage?: number;
  distance: number;
}

/** Hitbox odvozený ze stejného stavu (výška těla, natočení) jako collider. */
export function hitboxOf(id: string, s: PlayerState, cfg: MovementConfig, team?: string): Hitbox {
  if (s.height <= cfg.stances.prone.height + 1e-6) {
    const half = cfg.proneLength / 2 - cfg.proneRadius;
    const fx = -Math.sin(s.bodyYaw), fz = -Math.cos(s.bodyYaw);
    const y = s.pos.y + cfg.proneRadius;
    return {
      id,
      team,
      a: { x: s.pos.x - fx * half, y, z: s.pos.z - fz * half },
      b: { x: s.pos.x + fx * half, y, z: s.pos.z + fz * half },
      r: cfg.proneRadius,
      kind: 'prone',
      feetY: s.pos.y,
      height: s.height,
    };
  }
  const r = Math.min(cfg.radius * 0.9, s.height / 2);
  return {
    id,
    team,
    a: { x: s.pos.x, y: s.pos.y + r, z: s.pos.z },
    b: { x: s.pos.x, y: s.pos.y + s.height - r, z: s.pos.z },
    r,
    kind: 'vertical',
    feetY: s.pos.y,
    height: s.height,
  };
}

export function zoneOf(h: Hitbox, p: V3): HitZone {
  if (h.kind === 'vertical') {
    const rel = (p.y - h.feetY) / h.height;
    // Hlava: horních ~15 % výšky ve stoje/dřepu; nohy: spodních 45 %.
    if (rel > 0.84) return 'head';
    if (rel < 0.45) return 'limb';
    return 'torso';
  }
  const ax = h.b.x - h.a.x, az = h.b.z - h.a.z;
  const t = ((p.x - h.a.x) * ax + (p.z - h.a.z) * az) / (ax * ax + az * az);
  if (t > 0.82) return 'head';
  if (t < 0.4) return 'limb';
  return 'torso';
}

/** Průsečík paprsku (o + d·t, |d| = 1) s kapslí; vrací t nebo null. */
export function rayCapsule(o: V3, d: V3, maxT: number, a: V3, b: V3, r: number): number | null {
  const ba = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const oa = { x: o.x - a.x, y: o.y - a.y, z: o.z - a.z };
  const baba = ba.x * ba.x + ba.y * ba.y + ba.z * ba.z;
  const bard = ba.x * d.x + ba.y * d.y + ba.z * d.z;
  const baoa = ba.x * oa.x + ba.y * oa.y + ba.z * oa.z;
  const rdoa = d.x * oa.x + d.y * oa.y + d.z * oa.z;
  const oaoa = oa.x * oa.x + oa.y * oa.y + oa.z * oa.z;
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;
  let best: number | null = null;
  if (A > 1e-9) {
    const h = B * B - A * C;
    if (h >= 0) {
      const t = (-B - Math.sqrt(h)) / A;
      const y = baoa + t * bard;
      if (y > 0 && y < baba && t >= 0 && t <= maxT) best = t;
    }
  }
  // Polokoule na koncích.
  for (const c of [a, b]) {
    const oc = { x: o.x - c.x, y: o.y - c.y, z: o.z - c.z };
    const bb = oc.x * d.x + oc.y * d.y + oc.z * d.z;
    const cc = oc.x * oc.x + oc.y * oc.y + oc.z * oc.z - r * r;
    const h = bb * bb - cc;
    if (h < 0) continue;
    const t = -bb - Math.sqrt(h);
    if (t >= 0 && t <= maxT && (best === null || t < best)) best = t;
  }
  return best;
}

export function damageAt(w: WeaponConfig, distance: number, zone: HitZone): number {
  const d = w.damage;
  let base: number;
  if (distance <= d.nearRange) base = d.near;
  else if (distance >= d.farRange) base = d.far;
  else base = d.near + ((d.far - d.near) * (distance - d.nearRange)) / (d.farRange - d.nearRange);
  const mul = zone === 'head' ? w.headMultiplier : zone === 'limb' ? w.limbMultiplier : 1;
  return Math.round(base * mul * 100) / 100;
}

/**
 * Posune projektily o dt. Pro každý úsek dráhy najde první průsečík se světem
 * nebo hitboxem (kromě střelce a, při vypnutém friendly fire, spoluhráčů).
 */
export function stepProjectiles(
  list: Projectile[],
  dt: number,
  w: WeaponConfig,
  phys: PhysicsWorld,
  hitboxes: Hitbox[],
  friendlyFire = false,
): ImpactEvent[] {
  const events: ImpactEvent[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    const pw = p.rules ?? w;
    const g = pw.projectileGravity;
    const p0 = p.pos;
    const p1 = { x: p0.x + p.vel.x * dt, y: p0.y + p.vel.y * dt - 0.5 * g * dt * dt, z: p0.z + p.vel.z * dt };
    p.vel = { x: p.vel.x, y: p.vel.y - g * dt, z: p.vel.z };
    const seg = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
    const len = Math.hypot(seg.x, seg.y, seg.z);
    const dir = { x: seg.x / len, y: seg.y / len, z: seg.z / len };
    const world: RayHit | null = len > 1e-6 ? phys.castRay(p0, dir, len) : null;
    let best: { t: number; hb?: Hitbox } | null = world ? { t: world.distance } : null;
    for (const hb of hitboxes) {
      if (hb.id === p.owner) continue;
      if (!friendlyFire && p.team && hb.team === p.team) continue;
      const t = rayCapsule(p0, dir, len, hb.a, hb.b, hb.r);
      if (t !== null && (!best || t < best.t)) best = { t, hb };
    }
    p.age += dt;
    if (best) {
      const point = { x: p0.x + dir.x * best.t, y: p0.y + dir.y * best.t, z: p0.z + dir.z * best.t };
      const travelled = Math.hypot(point.x - p.origin.x, point.y - p.origin.y, point.z - p.origin.z);
      if (best.hb) {
        const zone = zoneOf(best.hb, point);
        events.push({ key: p.key, owner: p.owner, point, normal: { x: -dir.x, y: -dir.y, z: -dir.z }, surface: 'flesh', target: best.hb.id, zone, damage: damageAt(pw, travelled, zone), distance: travelled });
      } else {
        events.push({ key: p.key, owner: p.owner, point, normal: world!.normal, surface: world!.surface, distance: travelled });
      }
      list.splice(i, 1);
      continue;
    }
    p.pos = p1;
    if (p.age >= pw.projectileLifetime) list.splice(i, 1);
  }
  return events;
}
