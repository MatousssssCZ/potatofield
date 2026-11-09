import { describe, expect, it } from 'vitest';
import { magnetSnap, type MagnetBody } from '../src/client/editor/magnet';

const body = (id: string, x: number, z: number, yaw = 0, fp: MagnetBody['fp'] = [-2, -0.15, 2, 0.15], scale = 1): MagnetBody => ({ id, pos: [x, z], yaw, scale, fp });

describe('magnet budov', () => {
  it('fasáda 4 m se přilepí koncem na konec a srovná líc', () => {
    const r = magnetSnap(body('m', 4.3, 0.2), [body('o', 0, 0)]);
    expect(r?.to).toBe('o');
    expect(r!.pos[0]).toBeCloseTo(4, 5);
    expect(r!.pos[1]).toBeCloseTo(0, 5);
  });
  it('funguje i u natočeného souseda a otočení o 180°', () => {
    const yaw = 0.7;
    const o = body('o', 10, 5, yaw);
    // Cílová poloha: 4 m podél lokální osy X souseda, mírně vedle.
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (u: number, v: number): [number, number] => [10 + c * u + s * v, 5 - s * u + c * v];
    const p = at(4.35, -0.2);
    const r = magnetSnap(body('m', p[0], p[1], yaw + Math.PI), [o]);
    const want = at(4, 0);
    expect(r!.pos[0]).toBeCloseTo(want[0], 5);
    expect(r!.pos[1]).toBeCloseTo(want[1], 5);
  });
  it('dům ke domu: líc na líc, zarovnání zadních hran', () => {
    const house = (id: string, x: number, z: number) => body(id, x, z, 0, [-3, -4, 3, 4]);
    const r = magnetSnap(house('m', 6.4, 0.3), [house('o', 0, 0)]);
    expect(r!.pos[0]).toBeCloseTo(6, 5);
    expect(r!.pos[1]).toBeCloseTo(0, 5);
  });
  it('daleko nebo jinak natočené = bez magnetu', () => {
    expect(magnetSnap(body('m', 6, 0), [body('o', 0, 0)])).toBeNull();
    expect(magnetSnap(body('m', 4.2, 0, 0.4), [body('o', 0, 0)])).toBeNull();
  });
});
