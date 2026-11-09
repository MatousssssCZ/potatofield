import type { MapObject, TerrainData } from '../shared/map/schema';
import { quatFromEuler, rotate } from '../shared/math';
import type { Part } from './parts';
import type { TerrainCut } from './registry';
import { heightAt, readRegion, type Region } from './terrain';

/**
 * Předměty vs. terén: půdorys předmětu (z kolizních dílů), body pro kontrolu „visí ve vzduchu“
 * a plán dorovnání terénu pod předměty (rovná plocha pod patou + plynulé zaoblení do okolí).
 */

/** Lokální půdorys [x0, z0, x1, z1] z kolizních dílů (u předmětů bez kolize malý čtverec kolem pivotu). */
export function localFootprint(parts: Part[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of parts) {
    if (!p.collide) continue;
    // Spodní část předmětu: díly, které začínají do 0,6 m nad patou (střecha, nádrž na ní se nepočítá).
    if (p.pos[1] - p.size[1] / 2 > 0.6) continue;
    const q = quatFromEuler(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
    const h = { x: p.size[0] / 2, y: p.size[1] / 2, z: p.size[2] / 2 };
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const c = rotate(q, { x: sx * h.x, y: sy * h.y, z: sz * h.z });
      x0 = Math.min(x0, p.pos[0] + c.x); x1 = Math.max(x1, p.pos[0] + c.x);
      z0 = Math.min(z0, p.pos[2] + c.z); z1 = Math.max(z1, p.pos[2] + c.z);
    }
  }
  if (!isFinite(x0)) return [-0.3, -0.3, 0.3, 0.3];
  return [x0, z0, x1, z1];
}

/** Body ve světě pro kontrolu podpory: rohy půdorysu (mírně dovnitř), středy hran a střed. */
export function footprintPoints(o: MapObject, fp: [number, number, number, number], cut?: TerrainCut): [number, number][] {
  const [x0, z0, x1, z1] = fp;
  const ix = Math.min(0.05, (x1 - x0) / 4), iz = Math.min(0.05, (z1 - z0) / 4);
  const xs = [x0 + ix, (x0 + x1) / 2, x1 - ix], zs = [z0 + iz, (z0 + z1) / 2, z1 - iz];
  const out: [number, number][] = [];
  // Body v prohlubni (sklepní schody) se nepočítají – terén tam je záměrně níž.
  const inCut = (x: number, z: number) => !!cut && x > cut.rect[0] - 0.3 && x < cut.rect[2] + 0.3 && z > cut.rect[1] - 0.3 && z < cut.rect[3] + 0.3;
  for (const x of xs) for (const z of zs) if (!inCut(x, z)) out.push(toWorld(o, x, z));
  return out;
}

/** Potřebuje předmět ještě snížit terén? (střed prohlubně je výš než dno − 0,1 m) */
export function cutPending(t: TerrainData, o: MapObject, cut: TerrainCut): boolean {
  const s = o.transform.scale ?? 1;
  const [wx, wz] = toWorld(o, (cut.rect[0] + cut.rect[2]) / 2, (cut.rect[1] + cut.rect[3]) / 2);
  const h = heightAt(t, wx, wz);
  return h !== null && h > o.transform.position[1] - cut.depth * s + 0.1;
}

/** Šířka plochy kolem prohlubně, kterou musí předmět zakrýt (přechod terénu o jednu buňku mřížky). */
export function cutApronNeeded(t: TerrainData, yaw: number): number {
  return t.spacing * (Math.abs(Math.cos(yaw)) + Math.abs(Math.sin(yaw))) + t.spacing;
}

export function toWorld(o: MapObject, x: number, z: number): [number, number] {
  const yaw = o.transform.rotation[1], s = o.transform.scale ?? 1;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  return [o.transform.position[0] + (c * x + sn * z) * s, o.transform.position[2] + (-sn * x + c * z) * s];
}

export interface Pad {
  object: MapObject;
  fp: [number, number, number, number];
  /** Cílová výška terénu pod předmětem (pata předmětu). */
  base: number;
  /** Prohlubeň pod předmětem (sklepní vstup). */
  cut?: TerrainCut;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Plán dorovnání terénu: vzorky uvnitř půdorysu (rozšířeného o rezervu, aby i malé předměty
 * mezi vzorky dosedly) dostanou výšku paty, za ní se výška plynule vrací k původní
 * (šířka přechodu roste s převýšením). Vzorek ovlivněný více předměty bere nejbližší.
 * Vrací oblast a nové hodnoty pro záznam do historie, nebo null, když se nic nemění.
 */
export function planTerrainFit(t: TerrainData, pads: Pad[]): { region: Region; before: ReturnType<typeof readRegion>; after: ReturnType<typeof readRegion>; changed: number } | null {
  if (!pads.length) return null;
  // Rezerva: bod uvnitř buňky je od jejích rohů nejvýš spacing·√2 → všechny 4 rohy dostanou patu.
  const margin = t.spacing * 1.45;
  const prepared = pads.map((p) => {
    const s = p.object.transform.scale ?? 1;
    const [x0, z0, x1, z1] = p.fp;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = ((x1 - x0) / 2) * s, hz = ((z1 - z0) / 2) * s;
    const [wx, wz] = toWorld(p.object, cx, cz);
    // Převýšení pod půdorysem → šířka přechodu (svah max. ~1 : 2,5).
    let diff = 0;
    for (const [x, z] of footprintPoints(p.object, p.fp, p.cut)) diff = Math.max(diff, Math.abs((heightAt(t, x, z) ?? p.base) - p.base));
    const blend = Math.min(14, Math.max(3, diff * 2.5));
    // Prohlubeň v osách předmětu vůči středu půdorysu; rezerva = buňka mřížky natočená s předmětem.
    const yaw = p.object.transform.rotation[1];
    const cm = t.spacing * (Math.abs(Math.cos(yaw)) + Math.abs(Math.sin(yaw))) * 1.02;
    const cut = p.cut ? { x0: (p.cut.rect[0] - cx) * s - cm, z0: (p.cut.rect[1] - cz) * s - cm, x1: (p.cut.rect[2] - cx) * s + cm, z1: (p.cut.rect[3] - cz) * s + cm, y: p.base - p.cut.depth * s - 0.15 } : null;
    return { ...p, wx, wz, hx, hz, yaw, blend, cutL: cut, reach: Math.hypot(hx, hz) + margin + blend };
  });
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  for (const p of prepared) {
    gx0 = Math.min(gx0, p.wx - p.reach); gx1 = Math.max(gx1, p.wx + p.reach);
    gz0 = Math.min(gz0, p.wz - p.reach); gz1 = Math.max(gz1, p.wz + p.reach);
  }
  const clampI = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
  const region: Region = {
    x0: clampI(Math.floor((gx0 - t.origin[0]) / t.spacing), t.samplesX),
    z0: clampI(Math.floor((gz0 - t.origin[1]) / t.spacing), t.samplesZ),
    x1: clampI(Math.ceil((gx1 - t.origin[0]) / t.spacing), t.samplesX),
    z1: clampI(Math.ceil((gz1 - t.origin[1]) / t.spacing), t.samplesZ),
  };
  if (region.x1 < region.x0 || region.z1 < region.z0) return null;
  const before = readRegion(t, region);
  const after = { ...before, heights: before.heights.slice() };
  let k = 0, changed = 0;
  for (let iz = region.z0; iz <= region.z1; iz++)
    for (let ix = region.x0; ix <= region.x1; ix++, k++) {
      const x = t.origin[0] + ix * t.spacing, z = t.origin[1] + iz * t.spacing;
      const h0 = before.heights[k];
      let best = 0, target = h0, bestD = Infinity;
      for (const p of prepared) {
        const dx0 = x - p.wx, dz0 = z - p.wz;
        if (Math.abs(dx0) > p.reach || Math.abs(dz0) > p.reach) continue;
        // Do lokálních os předmětu.
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        const lx = c * dx0 - s * dz0, lz = s * dx0 + c * dz0;
        // Prohlubeň má přednost (dno schodů), nic jiného ji nepřepíše.
        if (p.cutL && lx > p.cutL.x0 && lx < p.cutL.x1 && lz > p.cutL.z0 && lz < p.cutL.z1) {
          best = 2;
          bestD = -1;
          target = p.cutL.y;
          continue;
        }
        const d = Math.hypot(Math.max(0, Math.abs(lx) - p.hx), Math.max(0, Math.abs(lz) - p.hz));
        const w = d <= margin ? 1 : 1 - smooth((d - margin) / p.blend);
        if (w > best + 1e-9 || (Math.abs(w - best) < 1e-9 && w > 0 && d < bestD)) {
          best = w;
          bestD = d;
          target = p.base;
        }
      }
      if (best <= 0) continue;
      const h = best >= 2 ? Math.min(h0, target) : h0 + (target - h0) * best;
      if (Math.abs(h - h0) > 1e-4) {
        after.heights[k] = Math.round(h * 1000) / 1000;
        changed++;
      }
    }
  return changed ? { region, before, after, changed } : null;
}
