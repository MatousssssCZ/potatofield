import { describe, expect, it } from 'vitest';
import type { MapObject } from '../src/shared/map/schema';
import { makeFlatTerrain } from '../src/shared/map/schema';
import { generateObject, getAsset, resolveParams } from '../src/world';
import { footprintPoints, localFootprint, planTerrainFit } from '../src/world/groundFit';
import { heightAt, writeRegion } from '../src/world/terrain';

const obj = (assetId: string, pos: [number, number, number], rotY = 0): MapObject => ({
  id: 'o', assetId, generatorVersion: 1, transform: { position: pos, rotation: [0, rotY, 0] }, params: resolveParams(getAsset(assetId)!, {}), seed: 1,
});

function slope() {
  const t = makeFlatTerrain(128, 128, 2);
  for (let iz = 0; iz < t.samplesZ; iz++) for (let ix = 0; ix < t.samplesX; ix++) t.heights[iz * t.samplesX + ix] = 0.15 * (t.origin[0] + ix * t.spacing);
  return t;
}

describe('dorovnání terénu pod předměty', () => {
  it('půdorys z kolizí: dům 7 × 6 m (bez nádrže na střeše)', () => {
    const fp = localFootprint(generateObject(obj('setA.house1Stairs', [0, 0, 0])).parts);
    expect(fp[2] - fp[0]).toBeGreaterThan(7);
    expect(fp[3] - fp[1]).toBeGreaterThan(6);
  });

  it('dům na svahu (natočený): pod celým půdorysem terén = pata, daleko beze změny', () => {
    const t = slope();
    const o = obj('setA.houseRecess', [10, 1.5, 5], 0.6);
    const fp = localFootprint(generateObject(o, t).parts);
    const plan = planTerrainFit(t, [{ object: o, fp, base: 1.5 }])!;
    expect(plan).not.toBeNull();
    const far = heightAt(t, 50, 40)!;
    writeRegion(t, plan.region, plan.after);
    for (const [x, z] of footprintPoints(o, fp)) expect(heightAt(t, x, z)!).toBeCloseTo(1.5, 2);
    expect(heightAt(t, 50, 40)!).toBeCloseTo(far, 6);
    // Přechod je plynulý: sklon mezi sousedními vzorky ≤ ~1 : 1,5.
    const n = t.samplesX;
    let maxStep = 0;
    for (let iz = plan.region.z0; iz <= plan.region.z1; iz++)
      for (let ix = plan.region.x0; ix < plan.region.x1; ix++) maxStep = Math.max(maxStep, Math.abs(t.heights[iz * n + ix + 1] - t.heights[iz * n + ix]));
    expect(maxStep / t.spacing).toBeLessThan(0.7);
  });

  it('malá bedna mezi vzorky terénu dosedne celá', () => {
    const t = slope();
    const o = obj('cover.crate', [3.3, 0.2, 7.1]);
    const fp = localFootprint(generateObject(o, t).parts);
    const plan = planTerrainFit(t, [{ object: o, fp, base: 0.2 }])!;
    writeRegion(t, plan.region, plan.after);
    for (const [x, z] of footprintPoints(o, fp)) expect(heightAt(t, x, z)!).toBeCloseTo(0.2, 2);
  });
});

describe('prohlubeň pod sklepním vstupem', () => {
  it('terén v obdélníku prohlubně klesne na dno, dlážděné okolí zakryje přechod', async () => {
    const { makeFlatTerrain } = await import('../src/shared/map/schema');
    const { generateObject, getAsset, resolveParams } = await import('../src/world');
    const { localFootprint, planTerrainFit, cutApronNeeded, cutPending } = await import('../src/world/groundFit');
    const { heightAt, writeRegion } = await import('../src/world/terrain');
    for (const [spacing, yaw] of [[1, 0], [1, 0.6], [2, 0]] as const) {
      const t = makeFlatTerrain(80, 80, spacing);
      const def = getAsset('setC.cellarStraight')!;
      const apron = cutApronNeeded(t, yaw) + 0.05;
      const o = { id: 'c', assetId: def.assetId, generatorVersion: 1, transform: { position: [3, 0, -2] as [number, number, number], rotation: [0, yaw, 0] as [number, number, number] }, params: resolveParams(def, { apron }), seed: 1 };
      const cut = def.terrainCut!(o.params);
      expect(cutPending(t, o, cut)).toBe(true);
      const g = generateObject(o);
      const plan = planTerrainFit(t, [{ object: o, fp: localFootprint(g.parts), base: 0, cut }])!;
      writeRegion(t, plan.region, plan.after);
      expect(cutPending(t, o, cut)).toBe(false);
      // Každý bod obdélníku prohlubně je pod dnem schodů; terén za dlážděným okolím zůstal.
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const w = (x: number, z: number) => heightAt(t, 3 + c * x + s * z, -2 - s * x + c * z)!;
      for (let x = cut.rect[0]; x <= cut.rect[2]; x += 0.25) for (let z = cut.rect[1]; z <= cut.rect[3]; z += 0.25) expect(w(x, z)).toBeLessThan(-1.8);
      const fp = localFootprint(g.parts);
      for (const [x, z] of [[fp[0] - 0.05, 0], [fp[2] + 0.05, 0], [0, fp[1] - 0.05], [0, fp[3] + 0.05]]) expect(Math.abs(w(x, z))).toBeLessThan(1e-3);
    }
  });
});
