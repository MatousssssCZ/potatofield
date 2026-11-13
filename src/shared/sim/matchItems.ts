import { eyePosition } from './player';
import { aimAngles, dirFromAngles, type WeaponState } from './weapon';
import { hitboxOf } from './ballistics';
import { BTN, type InputFrame } from './input';
import type { ItemHooks } from './items';
import type { MatchSim, SimPlayer } from './match';
import type { V3 } from '../math';
import { switchTo } from './inventory';
import { rulesOf } from '../config/arsenal';

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
  /** Nástroje: dosah a výseč cíle před hráčem (jinak sám sebe). */
  tool: { reach: 2.0, coneDeg: 50 },
  /** Lékárna: HP/s; defibrilátor: zásah elektrodami, nabití po úspěchu / minutí. */
  medkit: { hpPerSec: 25 },
  defib: { zapAt: 0.35, miss: 0.8, recharge: 1.6 },
  /** Zásobování: náboje za sekundu (podíl zásobníku) a granát za 2,5 s. */
  ammo: { magsPerSec: 0.7, grenadeEvery: 2.5 },
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
      else if (kind === 'defib') defib(sim, p, ws, pressed, t);
      else if (kind === 'medkit' || kind === 'ammo') supply(sim, p, ws, (input.held & BTN.FIRE) !== 0, t, kind);
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
  sim.events.push({ type: 'hit', owner: p.id, target: v.id, damage: R.damage, zone: 'torso', hp: v.hp, from: [p.state.pos.x, p.state.pos.y, p.state.pos.z] });
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
    sim.events.push({ type: 'hit', owner: n.owner, target: v.id, damage: dmg, zone: 'torso', hp: v.hp, from: [n.pos.x, n.pos.y, n.pos.z] });
    if (v.hp <= 0) sim.down(v, n.owner);
  }
}

/** Spolubojovník před hráčem v dosahu nástroje (nejbližší ve výseči), volitelně filtr. */
export function toolTarget(sim: MatchSim, p: SimPlayer, ws: WeaponState, ok: (o: SimPlayer) => boolean): SimPlayer | null {
  const R = ITEM_RULES.tool;
  const eye = eyePosition(sim.cfg, p.state);
  const aim = aimAngles(p.state, ws);
  const dir = dirFromAngles(aim.yaw, 0);
  const cos = Math.cos((R.coneDeg * Math.PI) / 180);
  let best: { o: SimPlayer; d: number } | null = null;
  for (const o of sim.players.values()) {
    if (o === p || o.team !== p.team || !ok(o)) continue;
    const to = { x: o.state.pos.x - eye.x, y: 0, z: o.state.pos.z - eye.z };
    const dh = Math.hypot(to.x, to.z);
    if (dh > R.reach + 0.4 || Math.abs(o.state.pos.y - p.state.pos.y) > 1.5) continue;
    if (dh > 0.35 && (to.x * dir.x + to.z * dir.z) / dh < cos) continue;
    if (!best || dh < best.d) best = { o, d: dh };
  }
  return best?.o ?? null;
}

/** Defibrilátor: klik → elektrody k vyřazenému spolubojovníkovi před sebou → oživení. */
function defib(sim: MatchSim, p: SimPlayer, ws: WeaponState, pressed: boolean, t: number) {
  const R = ITEM_RULES.defib;
  if (ws.action === 'use') {
    if (ws.shellsLoaded === 0 && t >= ws.actionStart + R.zapAt - 1e-9) {
      ws.shellsLoaded = 1;
      const v = toolTarget(sim, p, ws, (o) => o.downed);
      if (v) {
        sim.revive(v, p);
        ws.actionEnd = ws.actionStart + R.recharge;
      }
      sim.events.push({ type: 'defib', id: p.id, target: v?.id ?? null });
    }
    if (t >= ws.actionEnd - 1e-9) ws.action = 'idle';
    return;
  }
  if (pressed && (ws.action === 'idle' || ws.action === 'sprintOut')) {
    ws.action = 'use';
    ws.actionStart = t;
    ws.actionEnd = t + R.miss;
    ws.shellsLoaded = 0;
    ws.shotSeq++;
  }
}

const acc = new WeakMap<SimPlayer, { heal: number; ammo: number; nade: number }>();

/**
 * Lékárna / zásobování: držet spoušť → spolubojovník před sebou (jinak sám sebe) průběžně
 * dostává zdraví / munici. Doplní jen do výchozího maxima kitu (nevytváří nic navíc).
 */
function supply(sim: MatchSim, p: SimPlayer, ws: WeaponState, held: boolean, t: number, kind: 'medkit' | 'ammo') {
  const dt = 1 / sim.cfg.tickRate;
  if (!held || ws.action === 'equip') {
    if (ws.action === 'use') ws.action = 'idle';
    return;
  }
  const needs = kind === 'medkit' ? (o: SimPlayer) => o.alive && o.hp < 100 : (o: SimPlayer) => o.alive && !!o.inv && needsAmmo(o);
  const target = toolTarget(sim, p, ws, needs) ?? (needs(p) ? p : null);
  if (!target) {
    if (ws.action === 'use') ws.action = 'idle';
    return;
  }
  if (ws.action !== 'use') {
    ws.action = 'use';
    ws.actionStart = t;
    ws.actionEnd = t + 1;
  }
  ws.actionEnd = t + 1; // trvá, dokud se drží
  const a = acc.get(p) ?? { heal: 0, ammo: 0, nade: 0 };
  acc.set(p, a);
  if (kind === 'medkit') {
    a.heal += ITEM_RULES.medkit.hpPerSec * dt;
    const n = Math.floor(a.heal);
    if (n > 0) {
      a.heal -= n;
      target.hp = Math.min(100, target.hp + n);
      sim.events.push({ type: 'heal', id: p.id, target: target.id, hp: target.hp });
    }
  } else {
    a.nade += dt;
    for (const it of target.inv!.items) {
      const st = target.inv!.states[it.slot];
      if (it.kind === 'primary' || it.kind === 'pistol') {
        const r = rulesOf(it.id);
        const per = r.magazine * ITEM_RULES.ammo.magsPerSec * dt;
        a.ammo += per;
        const n = Math.floor(a.ammo);
        if (n > 0 && st.reserve < r.reserve) {
          a.ammo -= n;
          st.reserve = Math.min(r.reserve, st.reserve + n);
        }
      } else if (it.max !== undefined && st.mag < it.max && a.nade >= ITEM_RULES.ammo.grenadeEvery) {
        a.nade = 0;
        st.mag++;
      }
    }
  }
}

function needsAmmo(o: SimPlayer) {
  for (const it of o.inv!.items) {
    const st = o.inv!.states[it.slot];
    if ((it.kind === 'primary' || it.kind === 'pistol') && st.reserve < rulesOf(it.id).reserve) return true;
    if (it.max !== undefined && st.mag < it.max) return true;
  }
  return false;
}
