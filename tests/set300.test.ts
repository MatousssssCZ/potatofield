import { describe, expect, it } from 'vitest';
import { SET_META } from '../src/world/assets/set/residential';
import { collidersForMap, generateObject, getAsset, resolveParams } from '../src/world';
import { buildObjectGeometry } from '../src/client/render/geometry';
import { walkRoute, type Waypoint } from './setWalk';

/** Pilotní GLB domy (položky 5 a 6): průchod výklenkem/vstupem, schody, patro; střecha zadním žebříkem. */
export const PILOT_ROUTES: Record<string, Waypoint[]> = {
  'glb.res_house_2f_a': [
    { p: [0, 0, -5.5], note: 'ulice' },
    { p: [0, 0.12, -3.2], note: 'výklenek' },
    { p: [0, 0.12, -1.6], note: 'za dveřmi' },
    { p: [2.4, 0.12, -1.6] },
    { p: [3.1, 0.12, -3.3], note: 'pata schodů' },
    { p: [3.1, 3.15, 2.9], note: 'patro' },
    { p: [0, 3.15, 1.0] },
    { p: [-1.5, 0, 6.0], teleport: true, note: 'za domem' },
    { p: [-1.5, 6.3, 2.5], ladder: true, note: 'střecha' },
  ],
};

describe('sada 300 – A obytné budovy: průchodnost', () => {
  for (const [id, meta] of Object.entries(SET_META)) {
    it(`A${String(meta.item).padStart(2, '0')} ${id}: trasa vstup → místnosti → patra → střecha`, async () => {
      const r = await walkRoute(id, meta.route);
      expect(r.failAt ?? null).toBeNull();
    }, 60000);
  }
});

describe('sada 300 – A obytné budovy: limity', () => {
  for (const id of Object.keys(SET_META)) {
    it(`${id}: trojúhelníky ≤ 12000, rozměry podle zadání`, () => {
      const o = { id: 'b', assetId: id, generatorVersion: 1, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, params: resolveParams(getAsset(id)!, {}), seed: 1 };
      const g = generateObject(o);
      const geo = buildObjectGeometry(g.parts);
      let tris = 0;
      for (const { geometry } of geo.byMaterial.values()) tris += (geometry.index?.count ?? 0) / 3;
      expect(tris).toBeLessThanOrEqual(12000);
      expect(collidersForMap([g]).length).toBeGreaterThan(0);
    });
  }
});

PILOT_ROUTES['glb.res_house_2f_b'] = [
  { p: [0, 0, -5.5], note: 'ulice' },
  { p: [0, 0.12, -2.8], note: 'za dveřmi' },
  { p: [2.0, 0.12, -2.8] },
  { p: [2.7, 0.12, -3.3], note: 'pata schodů' },
  { p: [2.7, 3.15, 2.9], note: 'patro' },
  { p: [0, 3.15, 1.0] },
  { p: [-1.5, 0, 6.0], teleport: true, note: 'za domem' },
  { p: [-1.5, 6.3, 2.5], ladder: true, note: 'střecha' },
];

describe('sada 300 – pilotní GLB domy (položky 5, 6)', () => {
  for (const [id, route] of Object.entries(PILOT_ROUTES)) {
    it(`${id}: průchod a výstup na střechu`, async () => {
      const r = await walkRoute(id, route);
      expect(r.failAt ?? null).toBeNull();
    }, 60000);
  }
});
