import { describe, expect, it } from 'vitest';
import type { MapObject } from '../src/shared/map/schema';
import { generateObject, getAsset, partsToColliders, resolveParams } from '../src/world';
import { randomPalmSpec } from '../src/world/assets/nature';

const obj = (assetId: string, params: MapObject['params'] = {}, seed = 1): MapObject => ({
  id: `p${seed}`,
  assetId,
  generatorVersion: 1,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
  params: resolveParams(getAsset(assetId)!, params),
  seed,
});

describe('palmy', () => {
  it('datlovník i štíhlá palma: listy bez kolize, kmen koliduje', () => {
    for (const kind of ['date', 'slender']) {
      const g = generateObject(obj('nature.palm', { kind }));
      const fronds = g.parts.filter((p) => p.shape === 'frond');
      expect(fronds.length).toBeGreaterThanOrEqual(30);
      expect(fronds.every((p) => !p.collide)).toBe(true);
      expect(partsToColliders(g.object, g.parts).length).toBeGreaterThan(0);
    }
  });

  it('Random palma: každé semínko jiná, rozdíly v mezích „Míry rozdílů“', () => {
    const specs = Array.from({ length: 200 }, (_, i) => randomPalmSpec('date', 8, 0.4, i * 7919 + 3));
    const hs = specs.map((s) => s.height);
    expect(new Set(hs.map((h) => h.toFixed(3))).size).toBeGreaterThan(150);
    // ±25 % · 0,4 = ±10 % kolem 8 m.
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(7.2 - 1e-9);
    expect(Math.max(...hs)).toBeLessThanOrEqual(8.8 + 1e-9);
    expect(Math.max(...specs.map((s) => s.lean))).toBeLessThan((24 * Math.PI) / 180);
    // Míra rozdílů 0 → stejná výška, počet listů i převislost.
    const same = [1, 2, 3].map((k) => randomPalmSpec('slender', 9, 0, k));
    expect(same.every((s) => s.height === 9 && s.fronds === 22 && s.droop === 0.5)).toBe(true);
    // Stejné semínko → stejná palma (deterministické i na serveru).
    expect(randomPalmSpec('mix', 8, 0.4, 42)).toEqual(randomPalmSpec('mix', 8, 0.4, 42));
  });

  it('palma v záhonu: obruba koliduje, kmen začíná na zemině', () => {
    const g = generateObject(obj('nature.palmPlanter', { size: 2, rim: 0.5 }));
    const cols = partsToColliders(g.object, g.parts);
    expect(cols.filter((c) => Math.abs(c.center.y - 0.25) < 1e-6).length).toBe(4);
    const trunk = g.parts.find((p) => p.shape === 'cylinder' && p.material.startsWith('palmBark'))!;
    expect(trunk.pos[1]).toBeGreaterThan(0.4);
  });
});
