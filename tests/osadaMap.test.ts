import { beforeAll, describe, expect, it } from 'vitest';
import { collidersForMap, generateMap, getAsset, laddersForMap, resolveParams } from '../src/world';
import { buildOsadaMap, OSADA_HALF, osadaHeight } from '../src/world/maps/osada';
import { validateMap } from '../src/shared/map/validate';
import { PhysicsWorld } from '../src/shared/physics/world';
import { MatchSim } from '../src/shared/sim/match';
import { localFootprint } from '../src/world/groundFit';
import type { MapDocument } from '../src/shared/map/schema';
import { Sim } from './helpers';

let doc: MapDocument;
let phys: PhysicsWorld;
let gen: ReturnType<typeof generateMap>;
beforeAll(async () => {
  doc = buildOsadaMap();
  gen = generateMap(doc);
  phys = await PhysicsWorld.create();
  phys.setTerrain(doc.terrain);
  phys.addColliders(collidersForMap(gen));
  phys.sync();
});

/** Světový obdélník půdorysu objektu (osa-zarovnaná obálka natočeného půdorysu). */
function aabb(i: number): [number, number, number, number] {
  const o = doc.objects[i];
  const [x0, z0, x1, z1] = localFootprint(gen[i].parts);
  const c = Math.cos(o.transform.rotation[1]), s = Math.sin(o.transform.rotation[1]);
  const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([lx, lz]) => [o.transform.position[0] + c * lx + s * lz, o.transform.position[2] - s * lx + c * lz]);
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Projde lomenou trasu skutečnou simulací hráče; vrátí index bodu, kde uvízl (−1 = prošel). */
function walk(route: Array<[number, number]>): { stuck: number; at: [number, number] } {
  const [x0, z0] = route[0];
  const sim = new Sim(phys, { x: x0, y: osadaHeight(x0, z0) + 0.2, z: z0 }, 0);
  sim.ctrl.ladders = laddersForMap(gen);
  sim.settle();
  for (let i = 1; i < route.length; i++) {
    const [tx, tz] = route[i];
    let best = Infinity, still = 0, ok = false;
    for (let k = 0; k < 60 * 90; k++) {
      const dx = tx - sim.s.pos.x, dz = tz - sim.s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8) {
        ok = true;
        break;
      }
      sim.run(1, { moveZ: 1, lookDYaw: wrap(Math.atan2(-dx, -dz) - sim.s.yaw) });
      if (d < best - 0.01) {
        best = d;
        still = 0;
      } else if (++still > 200) break;
    }
    if (!ok) return { stuck: i, at: [+sim.s.pos.x.toFixed(1), +sim.s.pos.z.toFixed(1)] };
  }
  return { stuck: -1, at: [0, 0] };
}

describe('mapa Skladová osada', () => {
  it('projde validací formátu a generátory nehlásí konflikty', () => {
    const v = validateMap(JSON.parse(JSON.stringify(doc)));
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    for (const o of doc.objects) {
      const def = getAsset(o.assetId)!;
      expect((def.validate?.(resolveParams(def, o.params)) ?? []).join('; '), o.editor?.name).toBe('');
    }
  });

  it('rozsah podle zadání: 4 obsaditelné body, dvě základny, 18–24 domů, haly, dílna, vodojem', () => {
    expect(doc.controlPoints.filter((c) => c.capturable).length).toBe(4);
    expect(doc.controlPoints.filter((c) => !c.capturable).map((c) => c.defaultOwner).sort()).toEqual(['teamA', 'teamB']);
    const named = (re: RegExp) => doc.objects.filter((o) => re.test(o.editor?.name ?? '')).length;
    expect(named(/^B01 Dům/)).toBeGreaterThanOrEqual(18);
    expect(named(/^B01 Dům/)).toBeLessThanOrEqual(24);
    expect(named(/^B06/)).toBeGreaterThanOrEqual(4);
    expect(named(/^B09 Centrální sklad/)).toBe(2);
    expect(named(/^B(08|10)/)).toBeGreaterThanOrEqual(3);
    expect(named(/Dílna|Vodojem/)).toBeGreaterThanOrEqual(2);
    // Polohy bodů podle konceptu: A západ, B severovýchod, C jihozápad, D jihovýchod; základny v rozích.
    const P = Object.fromEntries(doc.controlPoints.map((c) => [c.id, c.position]));
    expect(P.cp_a[0] < 0 && P.cp_a[2] < 0).toBe(true);
    expect(P.cp_b[0] > 0 && P.cp_b[2] < 0).toBe(true);
    expect(P.cp_c[0] < 0 && P.cp_c[2] > 0).toBe(true);
    expect(P.cp_d[0] > 0 && P.cp_d[2] > 0).toBe(true);
    expect(P.cp_blue[0] < -80 && P.cp_blue[2] > 50 && P.cp_red[0] > 80 && P.cp_red[2] < -50).toBe(true);
    // A a C blíž modrým, B a D červeným.
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    for (const id of ['cp_a', 'cp_c']) expect(d(P[id], P.cp_blue)).toBeLessThan(d(P[id], P.cp_red));
    for (const id of ['cp_b', 'cp_d']) expect(d(P[id], P.cp_red)).toBeLessThan(d(P[id], P.cp_blue));
  });

  it('budovy se nepřekrývají (kromě záměrně přiléhajících křídel centrálního skladu) a leží v hrací ploše', () => {
    const big = doc.objects.map((o, i) => [o, i] as const).filter(([o]) => /^(osada\.house|osada\.hall|setD\.|small\.|struct\.silo)/.test(o.assetId));
    const bad: string[] = [];
    for (let a = 0; a < big.length; a++) {
      const A = aabb(big[a][1]);
      if (A[0] < -OSADA_HALF.x || A[2] > OSADA_HALF.x || A[1] < -OSADA_HALF.z || A[3] > OSADA_HALF.z) bad.push(`${big[a][0].editor?.name} mimo plochu`);
      for (let b = a + 1; b < big.length; b++) {
        const B = aabb(big[b][1]);
        const ox = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), oz = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
        const central = /Centrální sklad|Přístavek skladu/;
        if (ox > 0.6 && oz > 0.6 && !(central.test(big[a][0].editor?.name ?? '') && central.test(big[b][0].editor?.name ?? ''))) bad.push(`${big[a][0].editor?.name} × ${big[b][0].editor?.name} (${ox.toFixed(1)} × ${oz.toFixed(1)} m)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('všechna místa nasazení jsou volná a na zemi; středy bodů jsou průchozí', () => {
    const sim = new MatchSim(phys, doc, { conquest: true, scenarioId: 'sc_conquest' });
    const p = sim.addPlayer('t', 'teamA');
    const bad: string[] = [];
    for (const s of doc.spawnPoints) if (!sim.spawnFree({ x: s.position[0], y: s.position[1], z: s.position[2] }, p)) bad.push(s.id);
    for (const c of doc.controlPoints) if (!sim.spawnFree({ x: c.position[0] + 1.5, y: c.position[1], z: c.position[2] }, p)) bad.push(c.id);
    expect(bad).toEqual([]);
    expect(doc.spawnPoints.filter((s) => s.teams.includes('teamA') && s.controlPointId === 'cp_blue').length).toBeGreaterThanOrEqual(8);
    sim.dispose();
  });

  it('žádný přímý průstřel mezi základnami ani z jedné základny na cizí polovinu bodů', () => {
    const eye = (id: string) => {
      const c = doc.controlPoints.find((x) => x.id === id)!.position;
      return { x: c[0], y: c[1] + 1.6, z: c[2] };
    };
    const los = (a: string, b: string) => {
      const A = eye(a), B = eye(b);
      const v = { x: B.x - A.x, y: B.y - A.y, z: B.z - A.z };
      const d = Math.hypot(v.x, v.y, v.z);
      return !phys.castRay(A, { x: v.x / d, y: v.y / d, z: v.z / d }, d - 1);
    };
    expect(los('cp_blue', 'cp_red')).toBe(false);
    for (const [a, b] of [['cp_blue', 'cp_b'], ['cp_blue', 'cp_d'], ['cp_red', 'cp_a'], ['cp_red', 'cp_c'], ['cp_a', 'cp_d'], ['cp_b', 'cp_c'], ['cp_a', 'cp_b'], ['cp_c', 'cp_d']]) expect(los(a, b), `${a} → ${b}`).toBe(false);
  });

  it('server mapu načte, hráč se nasadí na základně a tick se vejde do rozpočtu', async () => {
    const { GameServer } = await import('../server/gameServer');
    const srv = await GameServer.create(buildOsadaMap(), { conquest: true, scenarioId: 'sc_conquest', manualTick: true });
    const pl = srv.sim.addPlayer('x', 'teamA');
    expect(srv.sim.requestSpawn('x', 'blue0', 'm4a1')).toBeNull();
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) srv.tick();
    const ms = (performance.now() - t0) / 120;
    expect(pl.alive).toBe(true);
    expect(pl.state.grounded).toBe(true);
    expect(ms).toBeLessThan(8);
    await srv.close();
  });

  const routes: Record<string, Array<[number, number]>> = {
    'modrá základna → A (severní výstup)': [[-98, 62], [-96, 48], [-74, 40], [-66, 16], [-64, -8], [-64, -24]],
    'modrá základna → C (východní výstup)': [[-98, 62], [-84, 65], [-76, 60], [-72, 46], [-56, 36], [-44, 38]],
    'modrá základna → D (jižní obchvat)': [[-98, 80], [-84, 82], [-76, 84], [-62, 84], [-30, 88], [4, 88], [34, 84], [46, 72], [58, 68], [63, 67], [63, 56], [62, 50]],
    'A → B (severní cesta)': [[-64, -24], [-60, -30], [-44, -46], [-20, -60], [8, -58], [30, -52]],
    'A → C (krátká spojka)': [[-64, -24], [-64, -8], [-66, 16], [-66, 32], [-56, 42], [-44, 38]],
    'C → D (štěrková cesta)': [[-44, 38], [-40, 46], [-12, 44], [14, 40], [30, 35], [36, 41], [48, 42], [62, 48]],
    'A → C skrz průchozí dům a kolem skladu': [[-56, -28], [-50.5, -28], [-44, -28], [-37, -28], [-37, 0], [-38, 12], [-38.5, 32], [-44, 38]],
    'náves → dvůr skrz severní křídlo skladu': [[-30, -20], [-22, -20], [-12, -20], [-2, -20], [10, -30], [30, -52]],
    'dvůr → jih skrz východní křídlo skladu': [[16, -8], [16, -3], [16, 7], [16, 18], [14, 32], [30, 36]],
    'B → D východem (průjezd skladem)': [[30, -52], [48, -38], [60, -30], [78, -20], [78, -10], [78, 0], [86, 10], [90, 30], [88, 39], [76, 40], [62, 48]],
    'červená základna → B (západní výstup)': [[98, -62], [84, -65], [76, -60], [72, -38], [50, -38], [30, -52]],
    'červená základna → D (jižní výstup)': [[98, -62], [96, -48], [92, -30], [96, -4], [96, 20], [90, 38], [76, 40], [62, 48]],
    'červená základna → A (severní cesta)': [[98, -80], [84, -82], [76, -86], [56, -92], [28, -96], [-4, -96], [-12, -70], [-20, -60], [-44, -46], [-60, -30], [-64, -24]],
    'vodojem: všechny čtyři vstupy': [[62, 48], [62, 60], [63, 68], [62, 48], [78, 40], [90, 39], [62, 48], [64, 30], [62, 18], [62, 48], [46, 41], [34, 41]],
  };
  for (const [name, route] of Object.entries(routes))
    it(`průchodnost: ${name}`, () => {
      const r = walk(route);
      expect(r.stuck, `uvízl před bodem ${r.stuck} [${route[Math.max(0, r.stuck)]}] na ${r.at}`).toBe(-1);
    }, 60000);
});
