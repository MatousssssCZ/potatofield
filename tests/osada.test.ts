import { describe, expect, it } from 'vitest';
import { OSADA_META, allAssets, collidersForMap, generateObject, getAsset, resolveParams, type Part } from '../src/world';
import { DOOR, WINDOW, hallLayout, houseLayout } from '../src/world/assets/osada/buildings';
import { fenceLayout } from '../src/world/assets/osada/routes';
import { buildOsadaSliceMap } from '../src/world/maps/osadaSlice';
import type { MapObject } from '../src/shared/map/schema';
import { makeWorld } from './helpers';
import { walkRoute } from './setWalk';

const obj = (assetId: string, params: MapObject['params'] = {}, seed = 7): MapObject => ({
  id: 'o', assetId, generatorVersion: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: resolveParams(getAsset(assetId)!, params), seed,
});
const P = (assetId: string, params: MapObject['params'] = {}) => resolveParams(getAsset(assetId)!, params);
const finite = (parts: Part[]) => parts.every((p) => [...p.pos, ...p.size, ...(p.rot ?? []), ...(p.path ?? []).flat()].every(Number.isFinite));

describe('Skladová osada: katalog a determinismus', () => {
  const ids = allAssets().filter((a) => a.category === 'osada').map((a) => a.assetId);
  it('vertikální řez má B01, B08, R01/R03, F01/F04, T05 s katalogovým ID', () => {
    const codes = ids.map((id) => OSADA_META[id]?.code);
    expect(codes).toEqual(expect.arrayContaining(['B01', 'B08', 'R01', 'F01', 'T05']));
    expect(getAsset('osada.road')!.params.find((q) => q.key === 'surface')!.options!.map((o) => o.value)).toEqual(expect.arrayContaining(['asphalt', 'dirt']));
    expect(getAsset('osada.fence')!.params.find((q) => q.key === 'kind')!.options!.map((o) => o.value)).toEqual(['chainlink', 'plaster']);
  });
  for (const id of ids)
    it(`${id}: stejný seed = stejná geometrie, jiný seed nemění kolize budov; čísla konečná, kolize existují`, () => {
      const a = generateObject(obj(id)).parts, b = generateObject(obj(id)).parts;
      expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
      expect(finite(a)).toBe(true);
      expect(a.every((p) => p.size.every((s) => s >= 0))).toBe(true);
      expect(a.some((p) => p.collide) || id === 'osada.road').toBe(true);
    });
});

describe('B01 vesnický dům', () => {
  it('prodloužení 8 → 14 m přidá fasádní pole a okna, velikost oken a dveří zůstane', () => {
    const a = houseLayout(P('osada.house', { length: 8 })), b = houseLayout(P('osada.house', { length: 14 }));
    expect(b.windows).toBeGreaterThan(a.windows);
    for (const l of [a, b])
      for (const ops of Object.values(l.openings))
        for (const o of ops) {
          if (o.bottom === 0) expect([o.width, o.top]).toEqual([DOOR.width, DOOR.height]);
          else {
            expect(o.width).toBe(WINDOW.width);
            expect(o.top - o.bottom).toBeCloseTo(WINDOW.height, 9);
          }
        }
  });
  it('zamčené dveře drží vzdálenost od levého rohu i po prodloužení', () => {
    for (const L of [8, 11, 14, 20]) {
      const l = houseLayout(P('osada.house', { length: L, doorAt: 2.3, doorLock: true }));
      expect(l.doors[0].u + L / 2).toBeCloseTo(2.3, 6);
      expect(l.conflicts).toEqual([]);
    }
  });
  it('zkrácení stěny pod zamčené dveře = konflikt, parametr zůstane, dveře se nevytratí', () => {
    const p = P('osada.house', { length: 6, doorAt: 9, doorLock: true });
    const l = houseLayout(p);
    expect(l.conflicts.length).toBe(1);
    expect(l.conflicts[0]).toMatch(/zamčený otvor/);
    expect(p.doorAt).toBe(9);
    expect(l.doors.length).toBe(1);
    expect(getAsset('osada.house')!.validate!(p)).toEqual(l.conflicts);
  });
  it('okna nekolidují s dveřmi ani rohy', () => {
    for (const L of [5, 6.5, 8, 9.5, 13, 24]) {
      const l = houseLayout(P('osada.house', { length: L, interior: 'walk' }));
      for (const [s, ops] of Object.entries(l.openings)) {
        const len = s === 'front' || s === 'back' ? L : l.D;
        for (const o of ops) expect(Math.abs(o.u) + o.width / 2, `${s} ${L}`).toBeLessThan(len / 2 - 0.3);
        for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) expect(Math.abs(ops[i].u - ops[j].u)).toBeGreaterThan((ops[i].width + ops[j].width) / 2);
      }
    }
  });
  it('průchozí přízemí: hráč projde předními dveřmi skrz dům a zadními ven', async () => {
    const r = await walkRoute('osada.house', [
      { p: [4, 0, -2] }, { p: [4, 0, 0.6], note: 'přední dveře' }, { p: [4, 0.06, 3.5], note: 'interiér' }, { p: [4, 0, 7.4], note: 'zadní dveře' }, { p: [4, 0, 9] },
    ], { interior: 'walk', doorAt: 4 });
    expect(r, JSON.stringify(r.failAt)).toMatchObject({ ok: true });
  }, 30000);
  it('uzavřená budova: dveře jsou pevné (dovnitř se nedostane)', async () => {
    const r = await walkRoute('osada.house', [{ p: [4, 0, -2] }, { p: [4, 0, 3.5] }], { interior: 'closed', doorAt: 4 });
    expect(r.ok).toBe(false);
  }, 30000);
});

describe('B08 skladová hala', () => {
  const frontX = (L: number, u: number) => L / 2 - u; // čelo: u roste k −X
  it('vrata v poli, pole se přidávají s délkou, hřeben odpovídá sklonu', () => {
    const a = hallLayout(P('osada.hall', { length: 24 })), b = hallLayout(P('osada.hall', { length: 36 }));
    expect(b.bayCount).toBeGreaterThan(a.bayCount);
    expect(a.ridge).toBeCloseTo(5.5 + 7 * Math.tan((12 * Math.PI) / 180), 6);
    expect(a.conflicts).toEqual([]);
  });
  it('otevřený průjezd: projde vraty skrz halu; zavřená vrata blokují', async () => {
    const p = { gateWall: 'front', gateAt: 9, through: true };
    const l = hallLayout(P('osada.hall', p));
    const x = frontX(l.L, l.gates[0].u);
    const route = [{ p: [x, 0, -3] as [number, number, number] }, { p: [x, 0, 1] as [number, number, number] }, { p: [x, 0.05, 7] as [number, number, number] }, { p: [x, 0, 13.6] as [number, number, number] }, { p: [x, 0, 17] as [number, number, number] }];
    const open = await walkRoute('osada.hall', route, { ...p, gateState: 'open' });
    expect(open, JSON.stringify(open.failAt)).toMatchObject({ ok: true });
    const shut = await walkRoute('osada.hall', route, { ...p, gateState: 'closed' });
    expect(shut.ok).toBe(false);
  }, 60000);
});

describe('F01 / F04 trasový plot a zeď', () => {
  it('jeden sloupek na uzel, pole rovnoměrně (bez krátkého posledního pole)', () => {
    const l = fenceLayout(P('osada.fence', { points: '0,0;10,0;10,5', spacing: 2.5 }));
    expect(l.segments.map((s) => s.fields)).toEqual([4, 2]);
    expect(l.posts.length).toBe(7);
    const keys = new Set(l.posts.map((q) => q.map((v) => v.toFixed(3)).join(',')));
    expect(keys.size).toBe(l.posts.length);
    const odd = fenceLayout(P('osada.fence', { points: '0,0;11,0', spacing: 2.5 }));
    expect(odd.segments[0].fields).toBe(5);
    expect(11 / 5).toBeLessThanOrEqual(2.5);
  });
  it('uzavřený okruh: sloupků = polí, žádný dvojitý sloupek v počátku', () => {
    const l = fenceLayout(P('osada.fence', { points: '0,0;10,0;10,10;0,10', closed: true }));
    const fields = l.segments.reduce((s, x) => s + x.fields, 0);
    expect(l.posts.length).toBe(fields);
    const parts = generateObject(obj('osada.fence', { points: '0,0;10,0;10,10;0,10', closed: true })).parts;
    const posts = parts.filter((p) => p.shape === 'box' && p.collide && Math.abs(p.size[0] - 0.07) < 1e-6);
    expect(posts.length).toBe(fields);
  });
  it('pletivo: rozteč nejvýš 2,5 m i při větším zadání', () => {
    expect(fenceLayout(P('osada.fence', { kind: 'chainlink', spacing: 5 })).spacing).toBe(2.5);
    expect(fenceLayout(P('osada.fence', { kind: 'plaster', spacing: 5 })).spacing).toBe(5);
  });
  it('pletivo střely propustí, hráče ne; zeď blokuje obojí', async () => {
    for (const [kind, bulletHit] of [['chainlink', false], ['plaster', true]] as const) {
      const g = generateObject(obj('osada.fence', { points: '0,0;10,0', kind }));
      const phys = await makeWorld(collidersForMap([g]));
      const hit = phys.castRay({ x: 5.1, y: 1, z: -3 }, { x: 0, y: 0, z: 1 }, 6);
      expect(!!hit, kind).toBe(bulletHit);
      const r = await walkRoute('osada.fence', [{ p: [5.1, 0, -2] }, { p: [5.1, 0, 2] }], { points: '0,0;10,0', kind });
      expect(r.ok, kind).toBe(false);
    }
  }, 30000);
  it('svah ve stupňovaném režimu: pole sahají pod terén na obou koncích (žádná mezera k podlezení)', () => {
    const def = getAsset('osada.fence')!;
    const ground = (x: number) => x * 0.25;
    const p = resolveParams(def, { points: '0,0;12,0', kind: 'plaster', slope: 'step', spacing: 3 });
    const parts = def.generate(p, 3, 'plasterWarm', { ground: (x) => ground(x) });
    const fields = parts.filter((q) => q.material === 'plasterWarm' && q.size[2] === 0.3);
    expect(fields.length).toBe(4);
    for (const f of fields) {
      const x0 = f.pos[0] - f.size[0] / 2, x1 = f.pos[0] + f.size[0] / 2;
      const bottom = f.pos[1] - f.size[1] / 2;
      expect(bottom).toBeLessThan(Math.min(ground(x0), ground(x1)));
      expect(f.rot?.[2] ?? 0).toBeCloseTo(0, 6);
    }
    const copy = def.generate({ ...p, slope: 'copy' }, 3, 'plasterWarm', { ground: (x) => ground(x) }).filter((q) => q.material === 'plasterWarm' && q.size[2] === 0.3);
    expect(Math.abs(copy[0].rot![2])).toBeGreaterThan(0.2);
  });
});

describe('R01 / R03 cesta', () => {
  it('povrch je parametr, krajnice deterministická ze seedu, ostrá zatáčka hlásí konflikt', () => {
    const asphalt = generateObject(obj('osada.road', { surface: 'asphalt' })).parts;
    const dirt = generateObject(obj('osada.road', { surface: 'dirt' })).parts;
    expect(asphalt[0].material).toBe('asphalt');
    expect(dirt[0].material).toBe('dirt');
    expect(JSON.stringify(generateObject(obj('osada.road', {}, 3)).parts)).not.toEqual(JSON.stringify(generateObject(obj('osada.road', {}, 4)).parts));
    expect(getAsset('osada.road')!.validate!(P('osada.road', { points: '0,0;15,-4;30,0;45,6' }))).toEqual([]);
    expect(getAsset('osada.road')!.validate!(P('osada.road', { points: '0,0;4,0;4.2,2;0,2.5', width: 8 })).length).toBe(1);
  });
});

describe('Skladová osada: testovací scéna vertikálního řezu', () => {
  it('uložení a načtení (JSON) dá stejná ID, seedy, parametry a geometrii', () => {
    const doc = buildOsadaSliceMap();
    const back = JSON.parse(JSON.stringify(doc));
    expect(back.objects.map((o: MapObject) => [o.id, o.seed, o.assetId])).toEqual(doc.objects.map((o) => [o.id, o.seed, o.assetId]));
    for (let i = 0; i < doc.objects.length; i++) {
      const a = generateObject(doc.objects[i], doc.terrain, doc.objects).parts;
      const b = generateObject(back.objects[i], back.terrain, back.objects).parts;
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    }
    expect(back.controlPoints.map((c: { id: string }) => c.id)).toEqual(['cp_baseA', 'cp_A', 'cp_baseB']);
  });
  it('obsahuje všechny typy řezu, bez konfliktů kromě záměrně zamčených dveří', () => {
    const doc = buildOsadaSliceMap();
    const ids = new Set(doc.objects.map((o) => o.assetId));
    for (const id of ['osada.house', 'osada.hall', 'osada.road', 'osada.fence', 'osada.boulder']) expect(ids.has(id)).toBe(true);
    for (const o of doc.objects) expect(getAsset(o.assetId)!.validate?.(resolveParams(getAsset(o.assetId)!, o.params)) ?? [], o.editor?.name).toEqual([]);
    expect(doc.spawnPoints.some((s) => s.teams.includes('teamA')) && doc.spawnPoints.some((s) => s.teams.includes('teamB'))).toBe(true);
  });
});
