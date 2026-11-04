import { describe, expect, it } from 'vitest';
import { MAP_SCHEMA_VERSION } from '../src/shared/map/schema';
import { parseMapJson, validateMap } from '../src/shared/map/validate';
import { collidersForMap, generateMap, generateObject } from '../src/world';
import { buildRangeMap } from '../src/world/maps/range';
import { LookAccumulator } from '../src/client/runtime/input';

describe('mapový formát', () => {
  it('střelnice projde validací a roundtrip JSON zachová data', () => {
    const doc = buildRangeMap();
    const text = JSON.stringify(doc);
    const r = parseMapJson(text);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.doc)).toBe(text);
  });

  it('novější verzi schématu odmítne s vysvětlením (bez pádu)', () => {
    const doc = { ...buildRangeMap(), schemaVersion: MAP_SCHEMA_VERSION + 1 };
    const r = validateMap(doc);
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/novější/);
  });

  it('poškozený JSON a nečíselné hodnoty vrací chybu, ne výjimku', () => {
    expect(parseMapJson('{ "schemaVersion": 1, ').ok).toBe(false);
    const doc = buildRangeMap() as unknown as Record<string, unknown>;
    const bad = JSON.parse(JSON.stringify(doc));
    bad.objects[0].transform.position[0] = 'x';
    bad.objects[1].id = bad.objects[2].id;
    bad.terrain.heights[5] = null;
    const r = validateMap(bad);
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => i.path + ': ' + i.message).join('\n');
    expect(msgs).toMatch(/position\[0\]/);
    expect(msgs).toMatch(/duplicitní ID/);
    expect(msgs).toMatch(/heights\[5\]/);
  });

  it('odkaz spawnu na neexistující bod je chyba', () => {
    const doc = JSON.parse(JSON.stringify(buildRangeMap()));
    doc.spawnPoints.push({ id: 's1', position: [0, 0, 0], yaw: 0, teams: ['teamA'], controlPointId: 'nope' });
    const r = validateMap(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /neexistující bod/.test(i.message))).toBe(true);
  });
});

describe('generátory', () => {
  it('stejné vstupy a seed → stejné díly (determinismus)', () => {
    const doc = buildRangeMap();
    const a = JSON.stringify(generateMap(doc).map((g) => g.parts));
    const b = JSON.stringify(generateMap(JSON.parse(JSON.stringify(doc))).map((g) => g.parts));
    expect(a).toBe(b);
  });

  it('neznámý asset → placeholder, původní data objektu zůstanou', () => {
    const obj = { id: 'x1', assetId: 'future.thing', generatorVersion: 1, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, params: { secret: 42 }, seed: 7 };
    const g = generateObject(obj);
    expect(g.missing).toMatch(/neznámý/);
    expect(g.object.params.secret).toBe(42);
    expect(g.parts.length).toBeGreaterThan(0);
  });

  it('novější verze generátoru než aplikace → placeholder (žádná tichá změna vzhledu)', () => {
    const obj = { id: 'x2', assetId: 'prim.box', generatorVersion: 99, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, params: {}, seed: 7 };
    expect(generateObject(obj).missing).toMatch(/v99/);
  });

  it('kolize střelnice vznikají ze stejných dílů jako render', () => {
    const gen = generateMap(buildRangeMap());
    const cols = collidersForMap(gen);
    expect(cols.length).toBeGreaterThan(50);
    for (const c of cols) {
      for (const v of [c.center.x, c.center.y, c.center.z, c.half.x, c.half.y, c.half.z]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('pohled myší', () => {
  it('stejný záznam pohybu myši dává stejný úhel při 30/60/144 FPS (chyba < 0,1°)', () => {
    const rec = Array.from({ length: 2000 }, (_, i) => [Math.round(Math.sin(i * 0.37) * 25), Math.round(Math.cos(i * 0.11) * 9)]);
    const k = 0.000384;
    const run = (fps: number) => {
      // Události myši přicházejí nezávisle na snímcích; simulace odebírá součet po 60 Hz ticích.
      const acc = new LookAccumulator();
      let yaw = 0, pitch = 0, e = 0;
      const perFrame = Math.ceil(rec.length / (fps * 4));
      while (e < rec.length) {
        for (let j = 0; j < perFrame && e < rec.length; j++, e++) acc.add(rec[e][0], rec[e][1], k, false);
        const [dy, dp] = acc.take();
        yaw += dy;
        pitch += dp;
      }
      return [yaw, pitch];
    };
    const [y30, p30] = run(30), [y60, p60] = run(60), [y144, p144] = run(144);
    const d = (a: number, b: number) => Math.abs(a - b) * (180 / Math.PI);
    expect(d(y30, y60)).toBeLessThan(0.1);
    expect(d(y30, y144)).toBeLessThan(0.1);
    expect(d(p30, p60)).toBeLessThan(0.1);
    expect(d(p30, p144)).toBeLessThan(0.1);
  });
});
