import { describe, expect, it } from 'vitest';
import { ceilingGrid } from '../src/client/render/bakedLight';
import type { TerrainData } from '../src/shared/map/schema';
import type { GeneratedObject } from '../src/world/registry';

const terrain = { samplesX: 41, samplesZ: 41, spacing: 1, origin: [-20, -20], heights: new Float32Array(41 * 41) } as unknown as TerrainData;
const obj = (parts: Array<{ pos: [number, number, number]; size: [number, number, number] }>) =>
  ({ object: { transform: { position: [0, 0, 0], rotation: [0, 0, 0] } }, parts: parts.map((p) => ({ shape: 'box', material: 'concrete', ...p })) }) as unknown as GeneratedObject;
const at = (g: ReturnType<typeof ceilingGrid>, x: number, z: number) => g.ceil[Math.floor((z - g.z0) / g.cell) * g.nx + Math.floor((x - g.x0) / g.cell)];

describe('interiéry: mřížka stropů', () => {
  it('střešní deska nad místností je strop, okolí je pod širým nebem', () => {
    const g = ceilingGrid(terrain, [obj([{ pos: [0, 3.1, 0], size: [6, 0.2, 6] }])]);
    expect(at(g, 0, 0)).toBeCloseTo(3, 5);
    expect(at(g, 8, 0)).toBe(Infinity);
  });

  it('zdi a sloupy (úzké) ani nízké desky strop netvoří', () => {
    const g = ceilingGrid(terrain, [obj([{ pos: [0, 4, 0], size: [0.3, 2, 6] }, { pos: [5, 0.6, 5], size: [3, 0.2, 3] }])]);
    expect(at(g, 0, 0)).toBe(Infinity);
    expect(at(g, 5, 5)).toBe(Infinity);
  });
});

import { applyBrush } from '../src/world/terrain';

describe('tráva jako malovaný povrch', () => {
  it('štětec Tráva + přidává a Tráva − ubírá jen vrstvu trávy', () => {
    const t = { samplesX: 11, samplesZ: 11, spacing: 1, origin: [-5, -5], heights: new Array(121).fill(0), baseMaterial: 'sand' } as unknown as TerrainData;
    applyBrush(t, { kind: 'paintGrass', radius: 3, strength: 1 } as never, 0, 0, 0.5);
    const mid = 5 * 11 + 5;
    expect(t.grass![mid]).toBeCloseTo(0.5, 2);
    applyBrush(t, { kind: 'paintGrassLess', radius: 3, strength: 1 } as never, 0, 0, 0.2);
    expect(t.grass![mid]).toBeCloseTo(0.3, 2);
    expect(t.dirt).toBeUndefined();
  });
});
