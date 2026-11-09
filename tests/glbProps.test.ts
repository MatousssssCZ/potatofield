import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapObject } from '../src/shared/map/schema';
import { generateObject, getAsset, laddersForMap, partsToColliders, resolveParams } from '../src/world';
import { GLB_PROPS } from '../src/world/assets/glbProps.data';
import { MATERIALS } from '../src/client/render/materials';

const obj = (assetId: string, rotY = 0): MapObject => ({
  id: 'g1',
  assetId,
  generatorVersion: 1,
  transform: { position: [10, 0, 20], rotation: [0, rotY, 0] },
  params: resolveParams(getAsset(assetId)!, {}),
  seed: 1,
});

describe('modely GLB v editoru', () => {
  it('každý model má soubor GLB, asset a známé materiály', () => {
    expect(GLB_PROPS.length).toBe(22);
    for (const d of GLB_PROPS) {
      expect(fs.existsSync(`public/models/props/${d.id}.glb`), d.id).toBe(true);
      expect(getAsset(`glb.${d.id}`), d.id).toBeDefined();
      for (const m of d.materials) expect(MATERIALS[m], `${d.id}: ${m}`).toBeDefined();
    }
  });

  it('kolize z JSON: neviditelné kvádry ve světě, vzhled bez kolize', () => {
    const g = generateObject(obj('glb.res_house_2f_a'));
    expect(g.missing).toBeUndefined();
    const model = g.parts.filter((p) => p.shape === 'model');
    expect(model).toHaveLength(1);
    const cols = partsToColliders(g.object, g.parts);
    expect(cols).toHaveLength(24);
    // Zadní stěna (z = 3,85 lokálně) leží ve světě u z ≈ 23,85.
    expect(cols.some((c) => Math.abs(c.center.z - 23.8475) < 1e-3 && c.surface === 'plaster')).toBe(true);
    // Schodiště je šikmé (rotX z JSON se přenese).
    expect(cols.some((c) => Math.abs(c.rotation.x) > 0.1)).toBe(true);
  });

  it('žebřík na zadní stěně domu: lezec stojí venku a dívá se ke zdi', () => {
    const g = generateObject(obj('glb.res_house_2f_a'));
    const [L] = laddersForMap([g]);
    expect(L.height).toBeCloseTo(6.3);
    expect(L.base.z).toBeCloseTo(24.1775);
    expect(L.facing.z).toBeCloseTo(-1);
  });

  it('klimatizace a nádrž se přilepují na budovu', () => {
    expect(getAsset('glb.wall_ac_a')!.mount).toEqual({ kind: 'wall', back: 0 });
    expect(getAsset('glb.roof_tank_a')!.mount).toEqual({ kind: 'top' });
  });
});
