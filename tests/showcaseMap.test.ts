import { describe, expect, it } from 'vitest';
import '../src/world';
import { generateObject, getAsset, resolveParams } from '../src/world';
import { buildShowcaseMap } from '../src/world/maps/showcase';
import { validateMap } from '../src/shared/map/validate';
import { cutPending, localFootprint, toWorld } from '../src/world/groundFit';

describe('přehledová mapa sady 300', () => {
  const doc = buildShowcaseMap();
  const set = doc.objects.filter((o) => /^set[A-K]\./.test(o.assetId));
  it('obsahuje všech 300 modelů a cedule', () => {
    expect(set.length).toBe(300);
    expect(new Set(set.map((o) => o.assetId)).size).toBe(300);
    expect(doc.objects.filter((o) => o.assetId === 'range.sign').length).toBe(300 + 11);
  });
  it('je platná a vše leží na terénu', () => {
    const v = validateMap(JSON.parse(JSON.stringify(doc)));
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const t = doc.terrain, x1 = t.origin[0] + (t.samplesX - 1) * t.spacing, z1 = t.origin[1] + (t.samplesZ - 1) * t.spacing;
    for (const o of doc.objects) {
      expect(o.transform.position[0]).toBeGreaterThan(t.origin[0] + 5);
      expect(o.transform.position[0]).toBeLessThan(x1 - 5);
      expect(o.transform.position[2]).toBeGreaterThan(t.origin[1] + 5);
      expect(o.transform.position[2]).toBeLessThan(z1 - 5);
    }
  });
  it('modely se nepřekrývají (půdorysy kolizí)', () => {
    const boxes = set.map((o) => {
      const fp = localFootprint(generateObject(o).parts);
      const a = toWorld(o, fp[0], fp[1]), b = toWorld(o, fp[2], fp[3]);
      return { id: o.assetId, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
    });
    const bad: string[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i], q = boxes[j];
      if (Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > 0.05 && Math.min(p.z1, q.z1) - Math.max(p.z0, q.z0) > 0.05) bad.push(`${p.id} × ${q.id}`);
    }
    expect(bad).toEqual([]);
  });
  it('sklepní vstupy mají snížený terén', () => {
    for (const o of set) {
      const def = getAsset(o.assetId)!;
      if (def.terrainCut) expect(cutPending(doc.terrain, o, def.terrainCut(resolveParams(def, o.params)))).toBe(false);
    }
  });
});
