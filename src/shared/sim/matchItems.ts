import { eyePosition } from './player';
import { aimAngles, dirFromAngles, type WeaponState } from './weapon';
import { hitboxOf } from './ballistics';
import { BTN, type InputFrame } from './input';
import type { ItemHooks } from './items';
import type { MatchSim, SimPlayer } from './match';
import type { V3 } from '../math';
import { switchTo } from './inventory';

/**
 * Akce nestřelných položek na serveru (autorita): nůž (útok zblízka), granáty, nástroje.
 * Hodnoty jsou návrhy pro Potatofield (N), ne konstanty BF2.
 */
export const ITEM_RULES = {
  knife: { swing: 0.6, hitAt: 0.2, reach: 1.4, coneDeg: 40, damage: 100 },
  /** Hod: celkový čas, okamžik uvolnění, rychlost, tasení dalšího kusu. */
  throw: { time: 0.9, releaseAt: 0.5, speed: 15, upBoost: 2.5, nextEquip: 0.45 },
  /** Tříštivý granát: zpoždění od hodu, dosah a maximum poškození (kryt mezi = bez zásahu). */
  frag: { fuse: 3.2, radius: 9, damage: 150, falloff: 1.6 },
  /** Dýmovnice: zážeh po dopadu, trvání a poloměr clony. */
  smoke: { fuse: 1.5, duration: 25, radius: 5.5 },
  /** Odraz granátu (koeficient restituce a tření). */
  bounce: { restitution: 0.35, friction: 0.7, radius: 0.05 },
} as const;

export interface Grenade {
  id: string;
  owner: string;
  team: string;
  kind: 'frag' | 'smoke';
  pos: V3;
  vel: V3;
  /** Čas výbuchu (frag) / začátku kouře (smoke). */
  fuseAt: number;
  /** Kouř: konec clony (s); 0 = ještě nehoří. */
  smokeUntil: number;
  rest: boolean;
}

const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);

/** Nejbližší bod úsečky a–b k bodu p. */
function closestOnSegment(a: V3, b: V3, p: V3): V3 {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab))));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
}

export function itemHooksFor(sim: MatchSim, p: SimPlayer): ItemHooks {
  return {
    act(kind: string, ws: WeaponState, input: InputFrame, t: number) {
      const pressed = (input.pressed & BTN.FIRE) !== 0;
      if (kind === 'knife') knife(sim, p, ws, pressed, t);
      else if (kind === 'frag' || kind === 'smoke') throwItem(sim, p, ws, pressed, t, kind);
    },
  };
}

function knife(sim: MatchSim, p: SimPlayer, ws: WeaponState, pressed: boolean, t: number) {
  const R = ITEM_RULES.knife;
  if (ws.action === 'attack') {
    if (ws.shellsLoaded === 0 && t >= ws.actionStart + R.hitAt - 1e-9) {
      ws.shellsLoaded = 1;
      melee(sim, p, ws);
    }
    if (t >= ws.actionEnd - 1e-9) ws.action = 'idle';
    return;
  }
  if (pressed && (ws.action === 'idle' || ws.action === 'sprintOut') && !p.state.ladder) {
    ws.action = 'attack';
    ws.actionStart = t;
    ws.actionEnd = t + R.swing;
    ws.shellsLoaded = 0;
    ws.shotSeq++;
  }
}

/** Útok nožem: nejbližší soupeř v dosahu a výseči před hráčem, ne přes zeď. */
function melee(sim: MatchSim, p: SimPlayer, ws: WeaponState) {
  const R = ITEM_RULES.knife;
  const eye = eyePosition(sim.cfg, p.state);
  const aim = aimAngles(p.state, ws);
  const dir = dirFromAngles(aim.yaw, aim.pitch);
  const cosCone = Math.cos((R.coneDeg * Math.PI) / 180);
  let best: { v: SimPlayer; d: number } | null = null;
  for (const v of sim.players.values()) {
    if (v === p || !v.alive) continue;
    if (v.team === p.team && !sim.opts.friendlyFire) continue;
    const hb = hitboxOf(v.id, v.state, sim.cfg, v.team);
    const c = closestOnSegment(hb.a, hb.b, eye);
    const to = sub(c, eye);
    const d = Math.max(0, len(to) - hb.r);
    if (d > R.reach) continue;
    const l = Math.max(1e-6, len(to));
    if (dot(to, dir) / l < cosCone) continue;
    const wall = sim.phys.castRay(eye, { x: to.x / l, y: to.y / l, z: to.z / l }, Math.max(0, l - hb.r));
    if (wall) continue;
    if (!best || d < best.d) best = { v, d };
  }
  if (!best) return;
  const v = best.v;
  v.hp = Math.max(0, v.hp - R.damage);
  sim.events.push({ type: 'hit', owner: p.id, target: v.id, damage: R.damage, zone: 'torso', hp: v.hp });
  if (v.hp <= 0) sim.down(v, p.id);
}

/**
 * Hod granátu: nápřah → uvolnění (granát vznikne, počet −1) → další kus se tasí, nebo po
 * posledním návrat na poslední střelnou zbraň. Hod nelze přerušit přepnutím.
 */
function throwItem(sim: MatchSim, p: SimPlayer, ws: WeaponState, pressed: boolean, t: number, kind: 'frag' | 'smoke') {
  const R = ITEM_RULES.throw;
  if (ws.action === 'throw') {
    if (ws.shellsLoaded === 0 && t >= ws.actionStart + R.releaseAt - 1e-9) {
      ws.shellsLoaded = 1;
      ws.mag = Math.max(0, ws.mag - 1);
      release(sim, p, ws, t, kind);
    }
    if (t >= ws.actionEnd - 1e-9) {
      if (ws.mag > 0) {
        ws.action = 'equip';
        ws.actionStart = t;
        ws.actionEnd = t + R.nextEquip;
      } else {
        ws.action = 'idle';
        const inv = p.inv;
        if (inv && switchTo(inv, inv.lastGun, t)) p.weapon = inv.states[inv.lastGun];
      }
    }
    return;
  }
  if (pressed && ws.mag > 0 && (ws.action === 'idle' || ws.action === 'sprintOut') && !p.state.ladder) {
    ws.action = 'throw';
    ws.actionStart = t;
    ws.actionEnd = t + R.time;
    ws.shellsLoaded = 0;
    ws.shotSeq++;
  }
}

function release(sim: MatchSim, p: SimPlayer, ws: WeaponState, t: number, kind: 'frag' | 'smoke') {
  const R = ITEM_RULES.throw;
  const eye = eyePosition(sim.cfg, p.state);
  const aim = aimAngles(p.state, ws);
  const dir = dirFromAngles(aim.yaw, aim.pitch);
  const right = { x: Math.cos(aim.yaw), y: 0, z: -Math.sin(aim.yaw) };
  let start = { x: eye.x + dir.x * 0.45 + right.x * 0.12, y: eye.y + dir.y * 0.45 + 0.05, z: eye.z + dir.z * 0.45 + right.z * 0.12 };
  // Nevyhodit skrz zeď těsně před hráčem.
  const toStart = sub(start, eye);
  const l = len(toStart);
  const wall = sim.phys.castRay(eye, { x: toStart.x / l, y: toStart.y / l, z: toStart.z / l }, l);
  if (wall) start = { x: eye.x + (toStart.x / l) * Math.max(0, wall.distance - 0.08), y: eye.y + (toStart.y / l) * Math.max(0, wall.distance - 0.08), z: eye.z + (toStart.z / l) * Math.max(0, wall.distance - 0.08) };
  const v = p.state.vel;
  sim.grenades.push({
    id: `${p.id}:${p.lifeId}:${ws.shotSeq}`,
    owner: p.id,
    team: p.team,
    kind,
    pos: start,
    vel: { x: dir.x * R.speed + v.x * 0.5, y: dir.y * R.speed + R.upBoost + v.y * 0.3, z: dir.z * R.speed + v.z * 0.5 },
    fuseAt: t + (kind === 'frag' ? ITEM_RULES.frag.fuse : ITEM_RULES.smoke.fuse),
    smokeUntil: 0,
    rest: false,
  });
  sim.events.push({ type: 'throw', id: p.id, kind });
}

/** Krok granátů: let s gravitací a odrazy od světa, výbuch / kouř po zpoždění. */
export function stepGrenades(sim: MatchSim, dt: number) {
  const t = sim.time;
  const B = ITEM_RULES.bounce;
  const g = 9.81;
  sim.grenades = sim.grenades.filter((n) => {
    if (n.kind === 'smoke' && n.smokeUntil > 0) return t < n.smokeUntil;
    if (!n.rest) {
      n.vel.y -= g * dt;
      const step = { x: n.vel.x * dt, y: n.vel.y * dt, z: n.vel.z * dt };
      const l = len(step);
      if (l > 1e-6) {
        const d = { x: step.x / l, y: step.y / l, z: step.z / l };
        const hit = sim.phys.castRay(n.pos, d, l + B.radius);
        if (hit) {
          const nn = hit.normal;
          const vn = dot(n.vel, nn);
          // Odraz: normálová složka × restituce, tečná × tření.
          const vt = { x: n.vel.x - nn.x * vn, y: n.vel.y - nn.y * vn, z: n.vel.z - nn.z * vn };
          n.vel = { x: vt.x * B.friction - nn.x * vn * B.restitution, y: vt.y * B.friction - nn.y * vn * B.restitution, z: vt.z * B.friction - nn.z * vn * B.restitution };
          n.pos = { x: hit.point.x + nn.x * B.radius, y: hit.point.y + nn.y * B.radius, z: hit.point.z + nn.z * B.radius };
          if (len(n.vel) < 0.6 && nn.y > 0.6) {
            n.rest = true;
            n.vel = { x: 0, y: 0, z: 0 };
          }
        } else n.pos = { x: n.pos.x + step.x, y: n.pos.y + step.y, z: n.pos.z + step.z };
      }
      if (n.pos.y < -60) return false;
    }
    if (t >= n.fuseAt - 1e-9) {
      if (n.kind === 'frag') {
        explode(sim, n);
        return false;
      }
      n.smokeUntil = t + ITEM_RULES.smoke.duration;
      sim.events.push({ type: 'smoke', key: n.id, pos: { ...n.pos }, until: n.smokeUntil, radius: ITEM_RULES.smoke.radius });
    }
    return true;
  });
}

/** Výbuch: poškození klesá se vzdáleností, překážka mezi výbuchem a tělem chrání. */
function explode(sim: MatchSim, n: Grenade) {
  const F = ITEM_RULES.frag;
  sim.events.push({ type: 'explosion', key: n.id, pos: { ...n.pos }, owner: n.owner });
  const o = { x: n.pos.x, y: n.pos.y + 0.15, z: n.pos.z };
  for (const v of sim.players.values()) {
    if (!v.alive) continue;
    if (v.id !== n.owner && v.team === n.team && !sim.opts.friendlyFire) continue;
    const c = { x: v.state.pos.x, y: v.state.pos.y + v.state.height * 0.5, z: v.state.pos.z };
    const to = sub(c, o);
    const d = len(to);
    if (d >= F.radius) continue;
    if (d > 0.3 && sim.phys.castRay(o, { x: to.x / d, y: to.y / d, z: to.z / d }, d - 0.3)) continue;
    const dmg = Math.round(F.damage * Math.pow(1 - d / F.radius, F.falloff));
    if (dmg <= 0) continue;
    v.hp = Math.max(0, v.hp - dmg);
    sim.events.push({ type: 'hit', owner: n.owner, target: v.id, damage: dmg, zone: 'torso', hp: v.hp });
    if (v.hp <= 0) sim.down(v, n.owner);
  }
}
