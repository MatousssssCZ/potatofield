import type { MapObject } from '../src/shared/map/schema';
import { collidersForMap, generateObject, getAsset, laddersForMap, resolveParams } from '../src/world';
import { Sim, makeWorld } from './helpers';

export interface Waypoint {
  p: [number, number, number];
  ladder?: boolean;
  /** Přesun bez chůze (začátek další dílčí trasy). */
  teleport?: boolean;
  note?: string;
}

export interface WalkResult {
  ok: boolean;
  reached: number;
  total: number;
  failAt?: { index: number; note?: string; pos: [number, number, number]; reason: string };
  ticks: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Projde trasu hráčem v simulaci (stejné kolize jako server). */
export async function walkRoute(assetId: string, route: Waypoint[]): Promise<WalkResult> {
  const o: MapObject = { id: 'b', assetId, generatorVersion: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: resolveParams(getAsset(assetId)!, {}), seed: 7 };
  const g = generateObject(o);
  const phys = await makeWorld(collidersForMap([g]));
  const [x0, y0, z0] = route[0].p;
  const sim = new Sim(phys, { x: x0, y: y0 + 0.05, z: z0 }, 0);
  sim.ctrl.ladders = laddersForMap([g]);
  sim.settle();
  let ticks = 0;
  const pos = (): [number, number, number] => [+sim.s.pos.x.toFixed(2), +sim.s.pos.y.toFixed(2), +sim.s.pos.z.toFixed(2)];
  for (let i = 1; i < route.length; i++) {
    const w = route[i];
    if (w.teleport) {
      sim.ctrl.place(sim.s, { x: w.p[0], y: w.p[1] + 0.05, z: w.p[2] }, sim.s.yaw);
      sim.settle();
      continue;
    }
    const d0 = Math.hypot(w.p[0] - sim.s.pos.x, w.p[2] - sim.s.pos.z) + Math.abs(w.p[1] - sim.s.pos.y);
    const limit = Math.ceil(60 * (d0 / 1.0 + 4));
    let ok = false, best = Infinity, still = 0;
    for (let k = 0; k < limit; k++) {
      const dx = w.p[0] - sim.s.pos.x, dz = w.p[2] - sim.s.pos.z;
      const dist = Math.hypot(dx, dz);
      if (!sim.s.ladder && dist < 0.3 && Math.abs(sim.s.pos.y - w.p[1]) < 0.4 && sim.s.grounded) {
        ok = true;
        break;
      }
      if (sim.s.ladder) sim.run(1, { moveZ: 1 });
      else {
        const want = Math.atan2(-dx, -dz);
        sim.run(1, { moveZ: dist < 0.6 ? 0.5 : 1, lookDYaw: wrap(want - sim.s.yaw) });
      }
      ticks++;
      if (dist < best - 0.01) {
        best = dist;
        still = 0;
      } else if (!sim.s.ladder && ++still > 240) break;
    }
    if (!ok) {
      const dy = Math.abs(sim.s.pos.y - w.p[1]);
      return { ok: false, reached: i - 1, total: route.length - 1, ticks, failAt: { index: i, note: w.note, pos: pos(), reason: dy >= 0.4 && best < 0.5 ? `jiná výška (y ${sim.s.pos.y.toFixed(2)} místo ${w.p[1]})` : `nedošel (nejblíž ${best.toFixed(2)} m)` } };
    }
  }
  return { ok: true, reached: route.length - 1, total: route.length - 1, ticks };
}
