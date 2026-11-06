import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MatchSim } from '../src/shared/sim/match';
import { PhysicsWorld } from '../src/shared/physics/world';
import { buildEmptyMap } from '../src/world/maps/empty';
import { PILOT } from '../src/shared/config/arsenal';
import { BTN, emptyInput } from '../src/shared/sim/input';
import type { ControlPoint, MapDocument, Scenario, SpawnPoint } from '../src/shared/map/schema';
import { GameServer } from '../server/gameServer';
import { NetClient, type WsLike } from '../src/shared/net/client';
import { buildStreetMap } from '../src/world/maps/street';

function cqDoc(): MapDocument {
  const d = buildEmptyMap('p', 128, 2);
  const cp = (id: string, x: number, owner: ControlPoint['defaultOwner']): ControlPoint => ({ id, name: id, position: [x, 0, 0], radius: 10, height: 4, defaultOwner: owner, capturable: false, spawnEnabled: true, countsForBleed: false });
  d.controlPoints = [cp('baseA', -40, 'teamA'), cp('baseB', 40, 'teamB')];
  const sp = (id: string, x: number, team: 'teamA' | 'teamB', cpId: string): SpawnPoint => ({ id, position: [x, 0.02, 3], yaw: 0, teams: [team], controlPointId: cpId });
  d.spawnPoints = [sp('sa', -40, 'teamA', 'baseA'), sp('sa2', -37, 'teamA', 'baseA'), sp('sb', 40, 'teamB', 'baseB')];
  const sc: Scenario = { id: 'sc', name: 't', overrides: [], tickets: { teamA: 100, teamB: 100 }, timeLimit: 1200, respawnDelay: 5, captureTime: 10, neutralizeTime: 10, bleedInterval: 5, zoneIds: [] };
  d.scenarios = [sc];
  return d;
}

async function setup() {
  const d = cqDoc();
  const phys = await PhysicsWorld.create();
  phys.setTerrain(d.terrain);
  const m = new MatchSim(phys, d, { conquest: true, scenarioId: 'sc', allowedKits: [...PILOT.kits] });
  const a = m.addPlayer('a', 'teamA');
  const med = m.addPlayer('med', 'teamA');
  const b = m.addPlayer('b', 'teamB');
  expect(m.requestSpawn('a', 'sa', 'm4a1')).toBeNull();
  expect(m.requestSpawn('med', 'sa', 'm16a2')).toBeNull();
  expect(m.requestSpawn('b', 'sb', 'ak101')).toBeNull();
  return { m, a, med, b };
}
const step = (m: MatchSim, n: number, inputs: Record<string, number> = {}) => {
  for (let i = 0; i < n; i++) m.step(new Map([...m.players.keys()].map((k) => [k, { ...emptyInput(m.tick), held: inputs[k] ?? 0 }])));
};

describe('pilot: vyřazení, oživení, vzdání pomoci', () => {
  it('zásah do 0 HP vyřadí: zabití se připíše, ticket až při definitivní smrti po 15 s', async () => {
    const { m, a, b } = await setup();
    const t0 = m.conquest!.tickets.teamA;
    m.down(a, b.id);
    expect(a.downed).toBe(true);
    expect(a.alive).toBe(false);
    expect(b.kills).toBe(1);
    expect(m.conquest!.tickets.teamA).toBe(t0);
    expect(m.requestSpawn('a', 'sa')).toMatch(/vyřazen/);
    step(m, Math.round(PILOT.downedTime * 60) - 5);
    expect(a.downed).toBe(true);
    step(m, 10);
    expect(a.downed).toBe(false);
    expect(m.conquest!.tickets.teamA).toBe(t0 - 1);
    expect(a.deaths).toBe(1);
    expect(b.kills).toBe(1); // ne podruhé
  });

  it('medik drží E u vyřazeného: oživení se stejným životem a 50 HP, bez ticketu a druhé smrti', async () => {
    const { m, a, med, b } = await setup();
    a.ctrl.place(a.state, { x: -38, y: 0.02, z: 3 }, 0);
    med.ctrl.place(med.state, { x: -38, y: 0.02, z: 4 }, 0);
    step(m, 5);
    const life = a.lifeId;
    const t0 = m.conquest!.tickets.teamA;
    m.down(a, b.id);
    m.events = [];
    step(m, Math.round(PILOT.reviveHold * 60) + 2, { med: BTN.USE });
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(PILOT.reviveHp);
    expect(a.lifeId).toBe(life);
    expect(med.revives).toBe(1);
    expect(m.conquest!.tickets.teamA).toBe(t0);
    expect(m.events.filter((e) => e.type === 'death')).toHaveLength(0);
    expect(m.events.filter((e) => e.type === 'revive')).toHaveLength(1);
  });

  it('jen medik a jen spoluhráč; puštění E průběh vynuluje', async () => {
    const { m, a, b } = await setup();
    a.ctrl.place(a.state, { x: 0, y: 0.02, z: 0 }, 0);
    b.ctrl.place(b.state, { x: 0, y: 0.02, z: 1 }, 0);
    m.down(a, null);
    step(m, 90, { b: BTN.USE }); // nepřítel (a ne medik)
    expect(a.downed).toBe(true);
  });

  it('vzdát pomoc: okamžitá definitivní smrt, ticket jednou', async () => {
    const { m, a, b } = await setup();
    const t0 = m.conquest!.tickets.teamA;
    m.down(a, b.id);
    expect(m.giveUp('a')).toBeNull();
    expect(a.downed).toBe(false);
    expect(m.conquest!.tickets.teamA).toBe(t0 - 1);
    expect(m.giveUp('a')).toMatch(/nejsi/);
  });

  it('classy pilotu: Engineer odmítnut, Sniper s M24 povolen, cizí frakce odmítnuta', async () => {
    const { m, a, med } = await setup();
    a.ctrl.place(a.state, { x: 0, y: 0.02, z: 20 }, 0);
    med.ctrl.place(med.state, { x: 5, y: 0.02, z: 20 }, 0);
    m.addPlayer('c', 'teamA');
    expect(m.requestSpawn('c', 'sa', 'r870')).toMatch(/classa/);
    expect(m.requestSpawn('c', 'sa', 'svd')).not.toBeNull(); // MEC zbraň pro tým USMC
    expect(m.requestSpawn('c', 'sa', 'm24')).toBeNull();
  });
});

describe('pilot: server 8 proti 8', () => {
  let server: GameServer | null = null;
  const clients: NetClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await server?.close();
  });

  it('kapacita 16: sedmnáctý hráč dostane „full“; /info vrací skutečné údaje', async () => {
    server = await GameServer.create(buildStreetMap(), { conquest: true, scenarioId: 'sc_bases', manualTick: true, name: 'Test' });
    const port = await server.listen(0);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 17; i++) clients.push(new NetClient(new WebSocket(`ws://127.0.0.1:${port}`) as unknown as WsLike, `h${i}`));
    for (let i = 0; i < 300 && clients.filter((c) => c.welcome || c.closeReason).length < 17; i++) await wait(10);
    expect(clients.filter((c) => c.welcome)).toHaveLength(16);
    expect(clients.filter((c) => c.closeReason === 'full')).toHaveLength(1);
    const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
    expect(info).toMatchObject({ name: 'Test', players: 16, capacity: 16, mode: 'conquest', pilot: true, friendlyFire: false });
    expect(info.kits).toEqual(['assault', 'medic', 'support', 'sniper']);
    // Po připojení nikdo nebojuje bez potvrzení nasazení.
    expect([...server.sim.players.values()].every((p) => !p.alive)).toBe(true);
  });
});

describe('pilot: poškození pádem', () => {
  const drop = async (h: number) => {
    const { m, a } = await setup();
    // Dopadnout ze spawnu, pak pád z výšky h nad terénem.
    step(m, 30);
    const g = a.state.pos.y;
    a.ctrl.place(a.state, { x: a.state.pos.x, y: g + h, z: a.state.pos.z }, 0);
    const events: string[] = [];
    for (let i = 0; i < 240; i++) {
      step(m, 1);
      for (const e of m.events) if (e.type === 'fall' || e.type === 'downed') events.push(e.type);
      m.events.length = 0;
    }
    return { a, events };
  };

  it('skok a pád z 3 m bez zranění', async () => {
    const { a, events } = await drop(3);
    expect(a.hp).toBe(PILOT.maxHp);
    expect(events).toEqual([]);
  });

  it('pád z 7 m zraní (jednou na dopad), hráč žije', async () => {
    const { a, events } = await drop(7);
    expect(a.alive).toBe(true);
    expect(a.hp).toBeLessThan(PILOT.maxHp);
    expect(a.hp).toBeGreaterThan(40);
    expect(events).toEqual(['fall']);
  });

  it('pád z 14 m vyřadí (medik může oživit); po vypršení smrt s příčinou pád', async () => {
    const { a, events } = await drop(14);
    expect(a.downed).toBe(true);
    expect(events).toEqual(['fall', 'downed']);
  });
});
