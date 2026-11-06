import { describe, expect, it } from 'vitest';
import { createConquest, stepConquest, ticketForDeath } from '../src/shared/sim/conquest';
import { MatchSim } from '../src/shared/sim/match';
import { buildEmptyMap } from '../src/world/maps/empty';
import type { ControlPoint, MapDocument, Scenario, SpawnPoint, Zone } from '../src/shared/map/schema';
import { PhysicsWorld } from '../src/shared/physics/world';
import { emptyInput } from '../src/shared/sim/input';

function doc(): MapDocument {
  const d = buildEmptyMap('c', 128, 2);
  const cp = (id: string, x: number, owner: ControlPoint['defaultOwner'], extra: Partial<ControlPoint> = {}): ControlPoint => ({
    id, name: id, position: [x, 0, 0], radius: 10, height: 4, defaultOwner: owner, capturable: true, spawnEnabled: true, countsForBleed: true, ...extra,
  });
  d.controlPoints = [cp('baseA', -50, 'teamA', { capturable: false, countsForBleed: false }), cp('c1', -15, 'neutral'), cp('c2', 0, 'neutral'), cp('c3', 15, 'teamB'), cp('baseB', 50, 'teamB', { capturable: false, countsForBleed: false })];
  const sp = (id: string, x: number, team: 'teamA' | 'teamB', cpId?: string): SpawnPoint => ({ id, position: [x, 0.02, 3], yaw: 0, teams: [team], ...(cpId ? { controlPointId: cpId } : {}) });
  d.spawnPoints = [sp('sa', -50, 'teamA', 'baseA'), sp('sa2', -48, 'teamA', 'baseA'), sp('sb', 50, 'teamB', 'baseB'), sp('s1', -15, 'teamA', 'c1'), sp('s1b', -15, 'teamB', 'c1')];
  const z: Zone = { id: 'z1', kind: 'forbidden', center: [50, 2, 0], halfExtents: [8, 4, 8], yaw: 0, appliesTo: ['teamA'], countdown: 10 };
  d.zones = [z];
  const sc: Scenario = { id: 'sc', name: 'test', overrides: [], tickets: { teamA: 100, teamB: 100 }, timeLimit: 1200, respawnDelay: 10, captureTime: 10, neutralizeTime: 10, bleedInterval: 5, zoneIds: ['z1'] };
  d.scenarios = [sc];
  return d;
}

const pres = (a: number, b: number) => ({ teamA: a, teamB: b });
const run = (s: ReturnType<typeof createConquest>, cp: string, a: number, b: number, sec: number) => {
  const ev = [];
  for (let i = 0; i < Math.round(sec * 60); i++) ev.push(...stepConquest(s, new Map([[cp, pres(a, b)]]), 1 / 60));
  return ev;
};

describe('Conquest – stavový automat bodů', () => {
  it('neutrální bod: zabrání za 10 s; více hráčů nezrychluje', () => {
    const s = createConquest(doc());
    const c = s.cps.find((x) => x.id === 'c2')!;
    run(s, 'c2', 3, 0, 9.9);
    expect(c.owner).toBe('neutral');
    const ev = run(s, 'c2', 3, 0, 0.11);
    expect(c.owner).toBe('teamA');
    expect(ev.some((e) => e.type === 'captured')).toBe(true);
  });

  it('vlastněný bod: neutralizace 10 s, vlastník trvá do dokončení, pak zabrání dalších 10 s', () => {
    const s = createConquest(doc());
    const c = s.cps.find((x) => x.id === 'c3')!;
    run(s, 'c3', 1, 0, 5);
    expect(c.owner).toBe('teamB');
    run(s, 'c3', 1, 0, 5.05);
    expect(c.owner).toBe('neutral');
    run(s, 'c3', 1, 0, 10.05);
    expect(c.owner).toBe('teamA');
  });

  it('oba týmy = sporný stav, postup stojí; po opuštění se pomalu vrací do klidu; soupeř ho vrací rychleji', () => {
    const s = createConquest(doc());
    const c = s.cps.find((x) => x.id === 'c2')!;
    run(s, 'c2', 1, 0, 5);
    const p = c.p;
    run(s, 'c2', 1, 1, 3);
    expect(c.p).toBe(p);
    expect(c.activity).toBe('contested');
    run(s, 'c2', 0, 0, 3); // nikdo: návrat k neutrálu 1/20 za s
    expect(c.p).toBeCloseTo(p - 3 / s.returnTime, 3);
    expect(c.owner).toBe('neutral');
    run(s, 'c2', 0, 1, 3.5); // soupeř vrátí zbytek k neutrálu rychlostí zabrání
    expect(c.p).toBeCloseTo(0, 5);
    expect(c.owner).toBe('neutral');
    run(s, 'c2', 1, 0, 2); // stejný tým pokračuje od neutrálu
    expect(c.p).toBeGreaterThan(0.15);
  });

  it('bez hráčů: rozpracovaná neutralizace se vrátí k vlastníkovi, rozpracované zabrání k neutrálu', () => {
    const s = createConquest(doc());
    const c3 = s.cps.find((x) => x.id === 'c3')!; // vlastní B (p = −1)
    run(s, 'c3', 1, 0, 4); // A neutralizuje do −0,6
    expect(c3.p).toBeCloseTo(-0.6, 2);
    run(s, 'c3', 0, 0, 30);
    expect(c3.p).toBe(-1);
    expect(c3.owner).toBe('teamB');
    const c2 = s.cps.find((x) => x.id === 'c2')!; // neutrální
    run(s, 'c2', 0, 1, 6);
    expect(c2.p).toBeCloseTo(-0.6, 2);
    run(s, 'c2', 0, 0, 30);
    expect(c2.p).toBe(0);
    expect(c2.owner).toBe('neutral');
  });

  it('nezabíratelný bod se nemění; bleed jen z počítaných bodů; neutrální zůstávají ve jmenovateli', () => {
    const s = createConquest(doc());
    run(s, 'baseB', 5, 0, 30);
    expect(s.cps.find((x) => x.id === 'baseB')!.owner).toBe('teamB');
    // B drží 1 ze 3 počítaných (c3) → bez bleed.
    expect(s.tickets.teamA).toBe(100);
    run(s, 'c1', 0, 1, 10.05); // B zabere c1 → 2 ze 3
    const before = s.tickets.teamA;
    run(s, 'c1', 0, 0, 10.0);
    expect(before - s.tickets.teamA).toBe(2);
  });

  it('ticket za smrt jednou; nula = konec; současná nula = remíza; časový limit', () => {
    const s = createConquest(doc());
    s.tickets.teamA = 1;
    expect(ticketForDeath(s, 'teamA').some((e) => e.type === 'end')).toBe(true);
    expect(s.winner).toBe('teamB');
    expect(ticketForDeath(s, 'teamA')).toEqual([]);
    const d = createConquest(doc());
    d.tickets = { teamA: 0, teamB: 0 };
    stepConquest(d, new Map(), 1 / 60);
    expect(d.winner).toBe('draw');
    const t = createConquest(doc());
    t.timeLimit = 1;
    t.tickets.teamA = 80;
    run(t, 'c2', 0, 0, 1.05);
    expect(t.winner).toBe('teamB');
  });
});

describe('Conquest v simulaci zápasu', () => {
  async function sim() {
    const d = doc();
    const phys = await PhysicsWorld.create();
    phys.setTerrain(d.terrain);
    const m = new MatchSim(phys, d, { conquest: true, scenarioId: 'sc' });
    return m;
  }
  const idle = (m: MatchSim, sec: number) => {
    for (let i = 0; i < Math.round(sec * 60); i++) m.step(new Map([...m.players.keys()].map((k) => [k, emptyInput(m.tick)])));
  };

  it('spawn: jen vlastní základna / stabilní vlastní bod; cizí spawn server odmítne; obsazené místo → jiné', async () => {
    const m = await sim();
    const a = m.addPlayer('a', 'teamA');
    m.addPlayer('a2', 'teamA');
    expect(m.requestSpawn('a', 'sb')).toMatch(/není pro tým/);
    expect(m.requestSpawn('a', 's1')).toMatch(/není pro tým/); // c1 je neutrální
    expect(m.requestSpawn('a', 'sa')).toBeNull();
    expect(a.alive).toBe(true);
    expect(m.requestSpawn('a2', 'sa')).toBeNull();
    // Druhý hráč nesmí spawnout v prvním → dostal sousední místo.
    expect(Math.hypot(m.players.get('a2')!.state.pos.x - a.state.pos.x, 0)).toBeGreaterThan(0.79);
  });

  it('smrt odečte ticket jednou a hned; respawn po 10 s; mrtvý nemůže oddalovat prohru', async () => {
    const m = await sim();
    const a = m.addPlayer('a', 'teamA');
    m.requestSpawn('a', 'sa');
    idle(m, 0.1);
    a.hp = 1;
    // Zóna B? Ne – zabijeme pádem pod mapu.
    a.ctrl.place(a.state, { x: -50, y: -80, z: 3 }, 0);
    idle(m, 0.1);
    expect(a.alive).toBe(false);
    expect(m.conquest!.tickets.teamA).toBe(99);
    idle(m, 5);
    expect(m.conquest!.tickets.teamA).toBe(99);
    expect(m.requestSpawn('a', 'sa')).toMatch(/neuplynul/);
    idle(m, 5.1);
    expect(m.requestSpawn('a', 'sa')).toBeNull();
  });

  it('zakázaná zóna: odpočet jen během pobytu, návrat resetuje, po vypršení smrt; platí jen pro zvolený tým', async () => {
    const m = await sim();
    const a = m.addPlayer('a', 'teamA');
    const b = m.addPlayer('b', 'teamB');
    m.requestSpawn('a', 'sa');
    m.requestSpawn('b', 'sb');
    a.ctrl.place(a.state, { x: 50, y: 0.02, z: 4 }, 0);
    b.ctrl.place(b.state, { x: 52, y: 0.02, z: 4 }, 0);
    idle(m, 6);
    expect(a.zone!.t).toBeGreaterThan(5.9);
    a.ctrl.place(a.state, { x: 30, y: 0.02, z: 4 }, 0);
    idle(m, 0.1);
    expect(a.zone).toBeNull();
    a.ctrl.place(a.state, { x: 50, y: 0.02, z: 4 }, 0);
    idle(m, 10.1);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(true);
  });

  it('výškový limit: hráč nad objemem bodu nezabírá; odpojení odstraní hráče z objemu', async () => {
    const m = await sim();
    const a = m.addPlayer('a', 'teamA');
    m.requestSpawn('a', 'sa');
    // Teleport nad bod c2 do výšky 6 m (podpora krabicí ve vzduchu by zde byla střecha).
    const s = a.state;
    a.ctrl.place(s, { x: 0, y: 6, z: 0 }, 0);
    for (let i = 0; i < 10; i++) {
      a.ctrl.place(s, { x: 0, y: 6, z: 0 }, 0);
      m.step(new Map([['a', emptyInput(m.tick)]]));
    }
    expect(m.conquest!.cps.find((c) => c.id === 'c2')!.p).toBe(0);
    a.ctrl.place(s, { x: 0, y: 0.02, z: 0 }, 0);
    idle(m, 2);
    expect(m.conquest!.cps.find((c) => c.id === 'c2')!.p).toBeGreaterThan(0.15);
    m.removePlayer('a');
    const p = m.conquest!.cps.find((c) => c.id === 'c2')!.p;
    idle(m, 2);
    // Odpojený hráč už nezabírá: postup se jen pomalu vrací k neutrálu (nepokračuje).
    expect(m.conquest!.cps.find((c) => c.id === 'c2')!.p).toBeLessThan(p);
    expect(m.conquest!.cps.find((c) => c.id === 'c2')!.p).toBeGreaterThan(p - 0.2);
  });

  it('restart vrátí scénář, tickety a body; autorský dokument se nezmění', async () => {
    const m = await sim();
    const snapshot = JSON.stringify(m.doc);
    m.addPlayer('a', 'teamA');
    m.requestSpawn('a', 'sa');
    m.players.get('a')!.ctrl.place(m.players.get('a')!.state, { x: 0, y: 0.02, z: 0 }, 0);
    idle(m, 12);
    expect(m.conquest!.cps.find((c) => c.id === 'c2')!.owner).toBe('teamA');
    m.restart();
    expect(m.conquest!.cps.find((c) => c.id === 'c2')!.owner).toBe('neutral');
    expect(m.conquest!.tickets.teamA).toBe(100);
    expect(JSON.stringify(m.doc)).toBe(snapshot);
  });
});
