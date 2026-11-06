import { eyePosition } from './player';
import { aimAngles, dirFromAngles, type WeaponState } from './weapon';
import { hitboxOf } from './ballistics';
import { BTN, type InputFrame } from './input';
import type { ItemHooks } from './items';
import type { MatchSim, SimPlayer } from './match';
import type { V3 } from '../math';

/**
 * Akce nestřelných položek na serveru (autorita): nůž (útok zblízka), granáty, nástroje.
 * Hodnoty jsou návrhy pro Potatofield (N), ne konstanty BF2.
 */
export const ITEM_RULES = {
  knife: { swing: 0.6, hitAt: 0.2, reach: 1.4, coneDeg: 40, damage: 100 },
} as const;

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
