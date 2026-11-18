import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bakeLight } from '../src/client/render/bakedLight';
import type { TerrainData } from '../src/shared/map/schema';
import type { GeneratedObject } from '../src/world/registry';

const flat: TerrainData = { samplesX: 41, samplesZ: 41, spacing: 1, origin: [-20, -20], heights: new Array(41 * 41).fill(0), baseMaterial: 'sand' } as TerrainData;
const wall = (x: number, z: number, h: number): GeneratedObject =>
  ({
    object: { id: 'w', assetId: 'x', transform: { position: [x, 0, z], rotation: [0, 0, 0], scale: 1 }, params: {} },
    parts: [{ shape: 'box', pos: [0, h / 2, 0], size: [2, h, 2], material: 'concrete' }],
    ladders: [],
  }) as unknown as GeneratedObject;

const at = (b: ReturnType<typeof bakeLight>, arr: Float32Array, x: number, z: number) => arr[Math.floor((z - b.z0) / b.cell) * b.nx + Math.floor((x - b.x0) / b.cell)];

describe('zapečené světlo', () => {
  it('budova vrhá stín na stranu odvrácenou od slunce a AO ztmaví patu zdi', () => {
    // Slunce z +X pod úhlem 45°: 6 m vysoký blok stíní ~6 m směrem k −X.
    const b = bakeLight(flat, [wall(0, 0, 6)], new THREE.Vector3(1, 1, 0).normalize());
    expect(at(b, b.shadow, -4, 0)).toBeLessThan(0.4);
    expect(at(b, b.shadow, 5, 0)).toBeGreaterThan(0.9);
    expect(at(b, b.shadow, -12, 0)).toBeGreaterThan(0.9);
    expect(at(b, b.ao, -1.6, 0)).toBeLessThan(0.8);
    expect(at(b, b.ao, 12, 12)).toBeGreaterThan(0.99);
  });
  it('bez překážek je vše na slunci a bez zastínění', () => {
    const b = bakeLight(flat, [], new THREE.Vector3(0.3, 0.8, 0.2).normalize());
    expect(Math.min(...b.shadow)).toBeGreaterThan(0.99);
    expect(Math.min(...b.ao)).toBeGreaterThan(0.99);
  });
});

import { generateMap } from '../src/world';
import { buildStreetMap as buildOsadaMap } from '../src/world/maps/street';
import { smokeSources } from '../src/client/render/bakedLight';

describe('zapečené světlo na mapě Skladová osada', () => {
  it('výpočet doběhne a najde kouřící vraky', () => {
    const doc = buildOsadaMap();
    const gen = generateMap(doc);
    const t0 = performance.now();
    const b = bakeLight(doc.terrain, gen, new THREE.Vector3(0.5, 0.7, 0.3).normalize());
    const ms = performance.now() - t0;
    const shaded = b.shadow.filter((v) => v < 0.5).length / b.shadow.length;
    expect(shaded).toBeGreaterThan(0.01);
    expect(shaded).toBeLessThan(0.5);
    expect(ms).toBeLessThan(5000);
    const smoke = smokeSources(gen);
    console.log('osada bake', Math.round(ms), 'ms, stín', (shaded * 100).toFixed(1), '%, kouř', smoke.length);
  });
});
