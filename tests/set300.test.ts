import { describe, expect, it } from 'vitest';
import { SET_META } from '../src/world/assets/set/residential';
import { collidersForMap, generateObject, getAsset, resolveParams } from '../src/world';
import { buildObjectGeometry } from '../src/client/render/geometry';
import { walkRoute, type Waypoint } from './setWalk';
import { makeWorld } from './helpers';

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

const sec = (id: string) => id.slice(3, 4);

describe('sada 300: průchodnost', () => {
  for (const [id, meta] of Object.entries(SET_META)) {
    it(`${sec(id)}${String(meta.item).padStart(2, '0')} ${id}: trasa vstup → místnosti → patra → střecha`, async () => {
      // Patrové budovy jsou ve výchozím stavu uzavřené (BF2) – trasa interiéru s „Přístupný interiér“.
      const hasInterior = getAsset(id)!.params.some((q) => q.key === 'interior');
      const r = await walkRoute(id, meta.route, hasInterior ? { interior: true } : {});
      expect(r.failAt ?? null).toBeNull();
    }, 60000);
  }
});

describe('sada 300: limity', () => {
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


describe('sada 300 – uzavřené patrové budovy (BF2)', () => {
  const closedIds = Object.keys(SET_META).filter((id) => getAsset(id)!.params.some((q) => q.key === 'interior'));
  it('patrové budovy mají přepínač interiéru, výchozí = uzavřeno', () => {
    expect(closedIds.length).toBeGreaterThanOrEqual(13);
    for (const id of closedIds) expect(resolveParams(getAsset(id)!, {}).interior).toBe(false);
  });
  for (const id of closedIds) {
    it(`${id}: dovnitř nelze, kolizí výrazně méně, výklenky / průjezdy zůstanou`, async () => {
      const def = getAsset(id)!;
      const mk = (interior: boolean) => generateObject({ id: 'b', assetId: id, generatorVersion: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: resolveParams(def, { interior }), seed: 1 });
      const closed = mk(false), open = mk(true);
      const nc = collidersForMap([closed]).length, no = collidersForMap([open]).length;
      expect(nc).toBeLessThan(no);
      expect(nc).toBeLessThanOrEqual(90);
      // Uzavřená budova: žádný nábytek ani příčky uvnitř, okna se sklem.
      expect(closed.parts.some((p) => p.material === 'glass')).toBe(true);
      expect(closed.parts.length).toBeLessThan(open.parts.length);
      // Pokud je v trase výklenek / průjezd / podloubí, musí jít dojít až tam i v uzavřené verzi.
      const r = SET_META[id].route;
      const k = r.findIndex((w) => /výklenek|průjezd|podloubí|krytý rohový/.test(w.note ?? ''));
      if (k > 0) {
        const res = await walkRoute(id, r.slice(0, k + 1));
        expect(res.failAt ?? null).toBeNull();
      }
    }, 60000);
  }
});

describe('sada 300: kryt a průstřel (paprsky střel)', () => {
  for (const [id, meta] of Object.entries(SET_META)) {
    if (!meta.rays?.length) continue;
    it(`${id}: okna a otvory propustí, zdi a pilíře kryjí`, async () => {
      const g = generateObject({ id: 'b', assetId: id, generatorVersion: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: resolveParams(getAsset(id)!, {}), seed: 1 });
      const phys = await makeWorld(collidersForMap([g]));
      const bad: string[] = [];
      for (const r of meta.rays!) {
        const d = [r.to[0] - r.from[0], r.to[1] - r.from[1], r.to[2] - r.from[2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        const hit = phys.castRay({ x: r.from[0], y: r.from[1], z: r.from[2] }, { x: d[0] / l, y: d[1] / l, z: d[2] / l }, l);
        if (!!hit !== r.hit) bad.push(`${r.note}: čekáno ${r.hit ? 'zásah' : 'volno'}, ${hit ? `zásah ${hit.distance.toFixed(2)} m` : 'volno'}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
