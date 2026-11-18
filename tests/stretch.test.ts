import { describe, expect, it } from 'vitest';
import { stretchParts, type Part } from '../src/world/parts';
import { generateObject, getAsset, stretchAxes } from '../src/world/registry';
import '../src/world/index';
import type { MapObject } from '../src/shared/map/schema';

describe('procedurální roztažení předmětu', () => {
  it('díl se prodlouží a posune po ose, otočený díl podle svých os', () => {
    const p: Part = { shape: 'box', pos: [1, 0.5, 0], size: [2, 1, 1], material: 'wood' };
    const q: Part = { shape: 'box', pos: [0, 0, 0], size: [2, 1, 1], rot: [0, Math.PI / 2, 0], material: 'wood' };
    const [a, b] = stretchParts([p, q], [2, 3, 1]);
    expect(a.pos).toEqual([2, 1.5, 0]);
    expect(a.size).toEqual([4, 3, 1]);
    // otočený o 90° kolem Y: jeho osa x leží ve světové ose z (roztažení 1), osa z ve světové x (2)
    expect(b.size[0]).toBeCloseTo(2);
    expect(b.size[2]).toBeCloseTo(2);
    expect(b.size[1]).toBeCloseTo(3);
  });

  it('sud: roztažení nahoru zvýší díly, osy s parametrem generátoru se neroztahují', () => {
    const def = getAsset('cover.barrel')!;
    expect(stretchAxes(def)).toEqual({ x: true, y: true, z: true });
    const o: MapObject = { id: 'a', assetId: 'cover.barrel', generatorVersion: def.generatorVersion, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: {}, seed: 1 };
    const h = (x: MapObject) => Math.max(...generateObject(x).parts.map((p) => p.pos[1] + p.size[1] / 2));
    const base = h(o);
    expect(h({ ...o, transform: { ...o.transform, stretch: [1, 2, 1] } })).toBeCloseTo(base * 2, 5);
    const house = getAsset('build.hotel')!;
    const ax = stretchAxes(house);
    for (const k of ['x', 'y', 'z'] as const) expect(ax[k]).toBe(!house.sizeParams?.[k]);
  });
});
