import { describe, expect, it } from 'vitest';
import type { MapObject } from '../src/shared/map/schema';
import { makeFlatTerrain } from '../src/shared/map/schema';
import { collidersForMap, generateObject, getAsset, resolveParams, terrainContext } from '../src/world';
import { formatPoints, parsePoints, sampleCurve } from '../src/world/assets/roads';
import { buildEmptyMap } from '../src/world/maps/empty';
import { validateMap } from '../src/shared/map/validate';

const obj = (assetId: string, params: MapObject['params'] = {}, pos: [number, number, number] = [0, 0, 0], rotY = 0): MapObject => ({
  id: `t_${assetId.replace('.', '_')}`,
  assetId,
  generatorVersion: 1,
  transform: { position: pos, rotation: [0, rotY, 0] },
  params: resolveParams(getAsset(assetId)!, params),
  seed: 3,
});

/** Svah: výška = 0,2 · x (stoupá ve směru +X). */
function slope() {
  const t = makeFlatTerrain(128, 128, 2);
  for (let j = 0; j < t.samplesZ; j++) for (let i = 0; i < t.samplesX; i++) t.heights[j * t.samplesX + i] = 0.2 * (t.origin[0] + i * t.spacing);
  return t;
}

describe('kreslená ulice', () => {
  it('body se uloží a načtou beze ztráty, křivka prochází všemi body', () => {
    const pts: [number, number][] = [[0, 0], [20, 0], [34, -6], [40, -20]];
    expect(parsePoints(formatPoints(pts))).toEqual(pts);
    const c = sampleCurve(pts, 1.5);
    for (const p of pts) expect(c.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)).toBe(true);
  });

  it('vozovka a chodníky: chodníky kolidují, vozovka ne (leží na terénu)', () => {
    const g = generateObject(obj('street.roadPath', { points: '0,0;30,0', sidewalk: true }));
    const strips = g.parts.filter((p) => p.shape === 'strip');
    expect(strips.find((p) => p.material === 'asphalt')!.collide).toBeFalsy();
    expect(strips.filter((p) => p.material === 'paving' && p.collide)).toHaveLength(2);
    const cols = collidersForMap([g]);
    expect(cols.length).toBeGreaterThan(10);
    // Chodník 2,2 m široký, horní hrana 0,15 m nad vozovkou.
    const top = Math.max(...cols.map((c) => c.center.y + c.half.y));
    expect(top).toBeGreaterThan(0.15);
    expect(top).toBeLessThan(0.3);
  });

  it('ulice kopíruje terén (svah), bez kopírování zůstane rovná', () => {
    const t = slope();
    const o = obj('street.roadPath', { points: '0,0;20,0' });
    const road = generateObject(o, t).parts.find((p) => p.material === 'asphalt')!;
    const last = road.path![road.path!.length - 1];
    expect(last[1]).toBeCloseTo(0.2 * 20 + (road.path![0][1] - 0), 1);
    const flat = generateObject(obj('street.roadPath', { points: '0,0;20,0', follow: false }), t).parts.find((p) => p.material === 'asphalt')!;
    expect(flat.path![flat.path!.length - 1][1]).toBeCloseTo(flat.path![0][1], 6);
  });

  it('mapa s dlouhou ulicí a rozpitím textury projde kontrolou', () => {
    const d = buildEmptyMap('t', 64, 2);
    const pts = Array.from({ length: 60 }, (_, i) => [i * 3, Math.sin(i) * 4] as [number, number]);
    d.objects.push({ ...obj('street.roadPath', { points: formatPoints(pts) }), texBlur: 2.5 });
    expect(validateMap(JSON.parse(JSON.stringify(d))).issues.filter((i) => i.severity === 'error')).toEqual([]);
    d.objects[0].texBlur = 9;
    expect(validateMap(JSON.parse(JSON.stringify(d))).issues.some((i) => i.path.includes('texBlur'))).toBe(true);
  });
});

describe('křižovatky kreslených silnic', () => {
  it('dvě křížící se silnice: hlavní jde vcelku, vedlejší přeruší asfalt a chodníky, přibudou přechody', () => {
    const a = { ...obj('street.roadPath', { points: '-30,0;30,0' }), id: 'a' };
    const b = { ...obj('street.roadPath', { points: '0,-30;0,30' }), id: 'b' };
    const all = [a, b];
    const ga = generateObject(a, undefined, all), gb = generateObject(b, undefined, all);
    const count = (g: ReturnType<typeof generateObject>, m: string) => g.parts.filter((p) => p.material === m).length;
    expect(count(ga, 'asphalt')).toBe(1);
    expect(count(gb, 'asphalt')).toBe(2);
    // Chodníky: bez křížení 2 pásy, s křížením 4 (každá strana rozdělena).
    expect(count(ga, 'paving')).toBe(4);
    expect(count(gb, 'paving')).toBe(4);
    // Vedlejší chodník končí až za chodníkem hlavní silnice (žádný překryv).
    const walkB = gb.parts.filter((p) => p.material === 'paving');
    for (const w of walkB) for (const q of w.path!) expect(Math.abs(q[2])).toBeGreaterThanOrEqual(3.5 + 0.2 + 2.2 - 0.01);
    // Přechody (široké pásy barvy) na obou silnicích.
    expect(ga.parts.filter((p) => p.material === 'paint' && p.size[0] === 0.5).length).toBeGreaterThan(0);
    expect(gb.parts.filter((p) => p.material === 'paint' && p.size[0] === 0.5).length).toBeGreaterThan(0);
    // Bez sousedů žádná křižovatka.
    expect(count(generateObject(b), 'asphalt')).toBe(1);
  });
});

describe('ploty a zdi po terénu', () => {
  it('kontext terénu respektuje polohu a natočení objektu', () => {
    const t = slope();
    const ctx = terrainContext(obj('struct.fence', {}, [10, 2, 0], Math.PI / 2), t);
    // Natočeno o 90°: lokální +X míří do světového −Z, výška se nemění; lokální +Z = světové +X.
    expect(ctx.ground(5, 0)).toBeCloseTo(0.2 * 10 - 2, 5);
    expect(ctx.ground(0, 5)).toBeCloseTo(0.2 * 15 - 2, 5);
  });

  it('sloupky plotu stojí na svahu; vypnuté kopírování = rovný plot', () => {
    const t = slope();
    const posts = (follow: boolean) =>
      generateObject(obj('struct.fence', { length: 10, maxSpacing: 2, follow }), t)
        .parts.filter((p) => p.size[0] === 0.08 && p.collide)
        .map((p) => p.pos[1] - p.size[1] / 2);
    const f = posts(true);
    expect(f[5] - f[0]).toBeCloseTo(0.2 * 10, 2);
    const flat = posts(false);
    expect(flat[5] - flat[0]).toBeCloseTo(0, 6);
  });

  it('zeď ve svahu nemá mezeru pod sebou (pata pod terénem)', () => {
    const t = slope();
    const g = generateObject(obj('struct.wall', { length: 8 }), t);
    const body = g.parts.filter((p) => p.collide && p.rot && p.material === 'concrete');
    expect(body.length).toBeGreaterThan(0);
    for (const p of body) expect(p.size[1]).toBeGreaterThan(2.4);
  });
});

describe('přilepovací doplňky', () => {
  it('klimatizace, markýza, cedule a žebřík se lepí na stěnu, nádrž na střechu', () => {
    for (const id of ['street.acUnit', 'street.awning', 'street.sign', 'struct.ladder']) expect(getAsset(id)!.mount?.kind).toBe('wall');
    expect(getAsset('street.roofTank')!.mount?.kind).toBe('top');
  });
});
