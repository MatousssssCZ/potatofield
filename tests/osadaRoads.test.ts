import { describe, expect, it } from 'vitest';
import { generateObject, getAsset, resolveParams, terrainContext, type Part } from '../src/world';
import { roadEditPoints, roadModel, roadToWorld } from '../src/world/assets/osada/road';
import { buildCurve, formatRanges, parseIds, parseRanges, pointAt, project, refToS, resolveSurfaces, sToRef, transitionRule, type SurfaceRange } from '../src/world/assets/osada/roadGraph';
import { branchFrom, findCrossings, insertNodeAt, joinRoads, makeCrossing, snapEndToRoad, splitRoad } from '../src/world/assets/osada/roadOps';
import { buildOsadaSliceMap } from '../src/world/maps/osadaSlice';
import { validateMap } from '../src/shared/map/validate';
import { formatPoints, parsePoints, type Pt } from '../src/world/assets/roads';
import type { MapObject } from '../src/shared/map/schema';

const def = getAsset('osada.road')!;
const P = (params: MapObject['params']) => resolveParams(def, params);
const road = (id: string, pos: [number, number], params: MapObject['params']): MapObject => ({
  id, assetId: 'osada.road', generatorVersion: 1, transform: { position: [pos[0], 0, pos[1]], rotation: [0, 0, 0] }, params: P(params), seed: 11,
});
const rng = (from: [string, number], to: [string, number], surface = 'dirt', transition = 2, id = 'r1'): SurfaceRange => ({ id, from: { seg: from[0], t: from[1] }, to: { seg: to[0], t: to[1] }, surface, transition });
/** Hlavní pás vozovky (šířka = šířka cesty), seřazený podle polohy. */
const mainStrips = (parts: Part[], W: number) => parts.filter((p) => p.shape === 'strip' && Math.abs(p.size[0] - W) < 1e-6);
const sOf = (o: MapObject, q: [number, number, number]) => project(roadModel(resolveParams(def, o.params)).curve, [q[0], q[2]]).s;

describe('Silnice: souvislý povrch, uzly, šířka (§12)', () => {
  it('zatáčející cesta: pásy navazují bez děr; po posunu uzlu a změně šířky zase', () => {
    for (const params of [{ points: '0,0;20,5;35,25;30,50', nodeIds: 'a;b;c;d', width: 6 }, { points: '0,0;20,9;35,25;30,50', nodeIds: 'a;b;c;d', width: 9 }]) {
      const o = road('r', [0, 0], { ...params, ranges: formatRanges([rng(['b', 0.4], ['c', 0.5])]) });
      const W = Number(o.params.width);
      const strips = mainStrips(generateObject(o).parts, W);
      expect(strips.length).toBe(5); // asfalt, přechod, hlína, přechod, asfalt
      for (let i = 1; i < strips.length; i++) {
        const a = strips[i - 1].path!.at(-1)!, b = strips[i].path![0];
        expect(Math.hypot(a[0] - b[0], a[2] - b[2]), `mezera mezi pásy ${i}`).toBeLessThan(1e-6);
      }
      const total = roadModel(o.params).curve.total;
      expect(sOf(o, strips[0].path![0])).toBeCloseTo(0, 3);
      expect(sOf(o, strips.at(-1)!.path!.at(-1)!)).toBeCloseTo(total, 3);
    }
  });
  it('lomený a přímý režim: úsečky se zaoblením, žádný samopřekryv s výchozím poloměrem', () => {
    for (const mode of ['polyline', 'straight']) {
      const p = P({ points: '0,0;30,0;30,30;60,30', mode, width: 6 });
      const m = roadModel(p);
      expect(m.warnings).toEqual([]);
      expect(m.curve.minFillet).toBeGreaterThanOrEqual(3.7 - 1e-6);
      // Hranice úseku leží v uzlu (ve středu oblouku).
      expect(m.curve.segStart.length).toBe(4);
    }
    const tight = roadModel(P({ points: '0,0;30,0;30,30', mode: 'polyline', cornerRadius: 2, width: 8 }));
    expect(tight.warnings.some((w) => w.includes('zatáčka'))).toBe(true);
  });
});

describe('Silnice: úseky povrchu a přechody (§5, §12)', () => {
  const c = buildCurve(parsePoints('0,0;50,0;100,0'), 'polyline');
  const ids = ['a', 'b', 'c'];
  it('prostřední asfalt → hlína: zbytek asfaltu zůstane, přechody na obou hranicích', () => {
    const r = resolveSurfaces(c, ids, [rng(['a', 0.6], ['b', 0.4])], 'asphalt');
    expect(r.pieces.map((p) => p.surface)).toEqual(['asphalt', 'dirt', 'asphalt']);
    expect(r.pieces[1].s0).toBeCloseTo(30, 6);
    expect(r.pieces[1].s1).toBeCloseTo(70, 6);
    expect(r.boundaries.map((b) => [b.from, b.to, b.len])).toEqual([['asphalt', 'dirt', 2], ['dirt', 'asphalt', 2]]);
    expect(r.warnings).toEqual([]);
  });
  it('úsek kratší než oba přechody: přechody se zkrátí, žádný obrácený interval ani NaN', () => {
    const r = resolveSurfaces(c, ids, [rng(['a', 0.5], ['a', 0.53], 'dirt', 8)], 'asphalt');
    const piece = r.pieces[1];
    const L = piece.s1 - piece.s0;
    expect(L).toBeCloseTo(1.5, 6);
    const half = r.boundaries.map((b) => b.len / 2);
    expect(half[0] + half[1]).toBeLessThanOrEqual(L + 1e-9);
    for (const b of r.boundaries) expect(Number.isFinite(b.len) && b.len >= 0).toBe(true);
    expect(r.warnings.filter((w) => w.includes('zkrácen')).length).toBe(2);
    const parts = generateObject(road('r', [0, 0], { points: '0,0;50,0;100,0', mode: 'polyline', nodeIds: 'a;b;c', ranges: formatRanges([rng(['a', 0.5], ['a', 0.53], 'dirt', 8)]) })).parts;
    expect(parts.every((p) => (p.path ?? []).flat().every(Number.isFinite) && (p.blend?.w ?? []).every((w) => w >= 0 && w <= 1))).toBe(true);
  });
  it('obrácený, prázdný a překrývající se interval se normalizuje (s informací)', () => {
    const r = resolveSurfaces(c, ids, [rng(['b', 0.5], ['a', 0.5], 'dirt', 2, 'r1'), rng(['b', 0.2], ['b', 0.8], 'gravel', 2, 'r2'), rng(['a', 0.1], ['a', 0.1], 'paving', 2, 'r3'), rng(['zzz', 0.1], ['a', 0.3], 'paving', 2, 'r4')], 'asphalt');
    expect(r.warnings.join('\n')).toMatch(/obrácený/);
    expect(r.warnings.join('\n')).toMatch(/prázdný/);
    expect(r.warnings.join('\n')).toMatch(/překrývá/);
    expect(r.warnings.join('\n')).toMatch(/neexistující/);
    let cur = 0;
    for (const p of r.pieces) {
      expect(p.s0).toBeCloseTo(cur, 6);
      expect(p.s1).toBeGreaterThan(p.s0);
      cur = p.s1;
    }
    expect(cur).toBeCloseTo(c.total, 6);
  });
  it('pravidla přechodů: asfalt→hlína rozpad, beton→dlažba spára, hlína→štěrk plynule', () => {
    expect(transitionRule('asphalt', 'dirt')).toBe('ragged');
    expect(transitionRule('asphalt', 'gravel')).toBe('ragged');
    expect(transitionRule('concrete', 'paving')).toBe('seam');
    expect(transitionRule('dirt', 'gravel')).toBe('smooth');
  });
  it('přechod je jeden pás s váhou 0 → 1 (žádné koplanární překryvy) a stejnou krajnicí', () => {
    const parts = generateObject(road('r', [0, 0], { points: '0,0;50,0;100,0', mode: 'polyline', nodeIds: 'a;b;c', ranges: formatRanges([rng(['a', 0.6], ['b', 0.4])]) })).parts;
    const tr = mainStrips(parts, 6).filter((p) => p.blend);
    expect(tr.length).toBe(2);
    expect(tr[0].material).toBe('asphalt');
    expect(tr[0].blend!.to).toBe('dirt');
    expect(tr[0].blend!.w[0]).toBe(0);
    expect(tr[0].blend!.w.at(-1)).toBe(1);
    expect(Math.hypot(tr[0].path![0][0] - tr[0].path!.at(-1)![0], tr[0].path![0][2] - tr[0].path!.at(-1)![2])).toBeCloseTo(2, 3);
  });
  it('úseky se ukládají jako {úsek, t} – posun uzlu je nese poměrně, režim „metry“ drží vzdálenost', () => {
    const r = [{ ...rng(['b', 0.5], ['b', 0.6]), from: { seg: 'b', t: 0.5, d: 25 }, to: { seg: 'b', t: 0.6, d: 30 } }];
    const longer = buildCurve(parsePoints('0,0;50,0;150,0'), 'polyline');
    expect(refToS(longer, ids, r[0].from)).toBeCloseTo(100, 6);
    expect(refToS(longer, ids, r[0].from, true)).toBeCloseTo(75, 6);
  });
});

describe('Silnice: úpravy uzlů a přemapování (stabilní ID)', () => {
  const pts = '0,0;40,0;80,10';
  const base = P({ points: pts, mode: 'polyline', nodeIds: 'a;b;c', ranges: formatRanges([rng(['a', 0.5], ['b', 0.5])]) });
  const world = (p: typeof base, ref: { seg: string; t: number }) => {
    const m = roadModel(p);
    return pointAt(m.curve, refToS(m.curve, m.ids, ref)!).p;
  };
  it('vložení uzlu do úseku: nové ID, ostatní ID zůstanou, hranice zůstane na místě', () => {
    const before = world(base, parseRanges(String(base.ranges))[0].from);
    const after = '0,0;20,0;40,0;80,10';
    const extra = roadEditPoints(base, pts, after, { kind: 'insert', index: 1 });
    const ids = parseIds(String(extra.nodeIds));
    expect(ids[0]).toBe('a');
    expect(ids[2]).toBe('b');
    expect(ids[3]).toBe('c');
    expect(new Set(ids).size).toBe(4);
    const np: typeof base = { ...base, points: after, ...extra };
    const r = parseRanges(String(np.ranges))[0];
    const pos = world(np, r.from);
    expect(Math.hypot(pos[0] - before[0], pos[1] - before[1])).toBeLessThan(0.05);
  });
  it('smazání uzlu: hranice se přenese na sloučený úsek, žádný odkaz na smazaný uzel', () => {
    const after = '0,0;80,10';
    const extra = roadEditPoints(base, pts, after, { kind: 'delete', index: 1 });
    expect(extra.nodeIds).toBe('a;c');
    const r = parseRanges(String(extra.ranges))[0];
    expect(r.from.seg).toBe('a');
    expect(r.to.seg).toBe('a');
    expect(r.from.t).toBeLessThan(r.to.t);
  });
  it('nakreslení nové trasy přidělí ID všem uzlům', () => {
    const extra = roadEditPoints(P({}), '', '0,0;5,0;10,0', { kind: 'create' });
    expect(parseIds(String(extra.nodeIds)).length).toBe(3);
  });
});

describe('Silnice: graf – rozdělit, spojit, větvit, T/X křižovatky', () => {
  const A = road('os_A', [0, 0], { points: '0,0;30,0;60,0;90,0', mode: 'polyline', nodeIds: 'a1;a2;a3;a4', ranges: formatRanges([rng(['a2', 0.5], ['a3', 0.5])]) });
  it('rozdělení v uzlu: dva díly, úsek přes dělicí uzel se rozdělí; spojení vrátí jednu trasu', () => {
    const r = splitRoad(A, 2, 'os_B', [A]);
    if ('error' in r) throw new Error(r.error);
    expect(parsePoints(String(r.a.params.points)).length).toBe(3);
    expect(parsePoints(String(r.b.params.points)).length).toBe(2);
    expect(parseRanges(String(r.a.params.ranges)).length).toBe(1);
    expect(parseRanges(String(r.b.params.ranges)).length).toBe(1);
    const la = roadModel(r.a.params).curve.total, lb = roadModel(r.b.params).curve.total;
    expect(la + lb).toBeCloseTo(90, 6);
    const j = joinRoads(r.a, r.b, [r.a, r.b]);
    if ('error' in j) throw new Error(j.error);
    expect(parsePoints(String(j.a.params.points)).length).toBe(4);
    const m = roadModel(j.a.params);
    expect(m.surfaces.pieces.map((p) => p.surface)).toEqual(['asphalt', 'dirt', 'asphalt']);
    expect(m.surfaces.pieces[1].s0).toBeCloseTo(45, 3);
    expect(m.surfaces.pieces[1].s1).toBeCloseTo(75, 3);
  });
  it('spojení obráceně kreslené cesty a odmítnutí vzdálených konců', () => {
    const B = road('os_B', [120, 0], { points: '0,0;-30,0', mode: 'polyline', nodeIds: 'b1;b2' });
    const j = joinRoads(A, B, [A, B]);
    if ('error' in j) throw new Error(j.error);
    expect(roadModel(j.a.params).curve.total).toBeCloseTo(120, 3);
    const far = road('os_C', [200, 0], { points: '0,0;10,0' });
    expect('error' in joinRoads(A, far, [A, far])).toBe(true);
  });
  it('T: konec nové cesty u hlavní cesty vytvoří uzel v hlavní cestě a spoj; vedlejší končí na jejím okraji', () => {
    const B = road('os_B', [45, 30], { points: '0,0;0,-29.5', nodeIds: 'b1;b2' });
    const sn = snapEndToRoad(B, [A, B]);
    expect(sn).not.toBeNull();
    const ids = parseIds(String(sn!.other.params.nodeIds));
    expect(ids.length).toBe(5);
    const all = [sn!.other, sn!.road];
    const parts = generateObject(sn!.road, undefined, all).parts;
    const main = mainStrips(parts, 6);
    const end = main.at(-1)!;
    expect(end.endCut?.end).toBeDefined();
    // Rohy vedlejší cesty leží na bližším okraji vozovky hlavní cesty (svět z = +3 → lokálně −27).
    for (const c of [end.endCut!.end!.left, end.endCut!.end!.right]) expect(Math.abs(c[1] + 27)).toBeLessThan(0.05);
    // Úseky povrchu hlavní cesty po vložení uzlu zůstaly na místě.
    const mA = roadModel(sn!.other.params);
    expect(mA.surfaces.pieces[1].s0).toBeCloseTo(45, 2);
  });
  it('T: posun uzlu hlavní cesty posune napojený konec vedlejší; ostatní větve zůstanou', () => {
    const B = road('os_B', [45, 30], { points: '0,0;0,-29.5', nodeIds: 'b1;b2' });
    const sn = snapEndToRoad(B, [A, B])!;
    const main = structuredClone(sn.other);
    const pts = parsePoints(String(main.params.points));
    const k = parseIds(String(main.params.nodeIds)).indexOf(JSON.parse(String(sn.road.params.joins))[0].at);
    pts[k] = [pts[k][0] + 4, pts[k][1] + 2];
    main.params.points = formatPoints(pts);
    const ctx = terrainContext(sn.road, undefined, [main, sn.road]);
    const m = roadModel(resolveParams(def, sn.road.params), ctx);
    const endW = roadToWorld(sn.road, m.nodes.at(-1)!);
    expect(endW[0]).toBeCloseTo(49, 6);
    expect(endW[1]).toBeCloseTo(2, 6);
    expect(m.nodes[0]).toEqual([0, 0]);
  });
  it('X: křížení bez křižovatky se najde; potvrzení ho vyřeší (uzly v obou, spoj, vyříznutí)', () => {
    const B = road('os_B', [45, -30], { points: '0,0;0,60', nodeIds: 'b1;b2' });
    expect(findCrossings([A, B]).length).toBe(1);
    const x = findCrossings([A, B])[0];
    const r = makeCrossing(A, B, x.at);
    expect(findCrossings([r.main, r.side])).toEqual([]);
    const parts = generateObject(r.side, undefined, [r.main, r.side]).parts;
    const main = mainStrips(parts, 6);
    expect(main.length).toBe(2); // vedlejší cesta přerušená v ploše hlavní
    expect(main[0].endCut?.end && main[1].endCut?.start).toBeTruthy();
  });
  it('různé výšky se nespojují automaticky', () => {
    const B = road('os_B', [45, -30], { points: '0,0;0,60' });
    B.transform.position[1] = 6;
    expect(findCrossings([A, B])).toEqual([]);
  });
  it('větvení z uzlu: nová cesta začíná v uzlu a je s ním spojená', () => {
    const b = branchFrom(A, 2, 'os_N');
    const j = JSON.parse(String(b.params.joins));
    expect(j[0]).toEqual({ node: 'n1', road: 'os_A', at: 'a3' });
    expect(b.transform.position[0]).toBeCloseTo(60, 6);
    const ins = insertNodeAt(A, [60.2, 0.1]);
    expect(ins.nodeId).toBe('a3');
  });
});

describe('Silnice: mapa a formát', () => {
  it('scéna řezu (úseky, spoj T) projde validací formátu a uložení/načtení dá stejnou geometrii', () => {
    const doc = buildOsadaSliceMap();
    const v = validateMap(JSON.parse(JSON.stringify(doc)));
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const back = JSON.parse(JSON.stringify(doc));
    for (const o of doc.objects.filter((x) => x.assetId === 'osada.road')) {
      const a = generateObject(o, doc.terrain, doc.objects).parts;
      const b = generateObject(back.objects.find((x: MapObject) => x.id === o.id), back.terrain, back.objects).parts;
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    }
  });
  it('vadné úseky v souboru odmítne validace (JSON), neznámé ID uzlů ne', () => {
    const doc = buildOsadaSliceMap();
    doc.objects[0].params.ranges = '{nope';
    expect(validateMap(JSON.parse(JSON.stringify(doc))).issues.some((i) => i.severity === 'error' && i.path.includes('ranges'))).toBe(true);
  });
  it('100× změna šířky: stejný počet dílů, deterministický výsledek', () => {
    let o = road('r', [0, 0], { points: '0,0;20,5;35,25', ranges: formatRanges([rng(['n1', 0.3], ['n2', 0.5])]) });
    o.params.nodeIds = 'n1;n2;n3';
    const n0 = generateObject(o).parts.length;
    for (let i = 0; i < 100; i++) {
      o = { ...o, params: { ...o.params, width: 4 + (i % 8) } };
      expect(generateObject(o).parts.length).toBe(n0);
    }
    expect(JSON.stringify(generateObject(o).parts)).toEqual(JSON.stringify(generateObject(structuredClone(o)).parts));
  });
  it('sToRef/refToS jsou inverzní', () => {
    const c = buildCurve(parsePoints('0,0;10,0;10,10;30,10'), 'smooth');
    const ids = ['a', 'b', 'c', 'd'];
    for (const s of [0, 3.3, 10, 17.5, c.total]) expect(refToS(c, ids, sToRef(c, ids, s))).toBeCloseTo(s, 6);
  });
});
void ([] as Pt[]);
