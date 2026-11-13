import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { GameServer } from '../server/gameServer';
import { NetClient, type WsLike } from '../src/shared/net/client';
import { buildStreetMap } from '../src/world/maps/street';
import { buildEmptyMap } from '../src/world/maps/empty';
import { LAG_COMP_MAX, MatchSim } from '../src/shared/sim/match';
import { PhysicsWorld } from '../src/shared/physics/world';
import { BTN, emptyInput } from '../src/shared/sim/input';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let server: GameServer | null = null;
const clients: NetClient[] = [];
async function connect(port: number, name: string) {
  const c = new NetClient(new WebSocket(`ws://127.0.0.1:${port}`) as unknown as WsLike, name);
  clients.push(c);
  for (let i = 0; i < 200 && !c.welcome; i++) await wait(5);
  return c;
}
let seq = 5000;
async function run(ticks: number) {
  for (let i = 0; i < ticks; i++) {
    for (const c of clients) c.sendInput({ ...emptyInput(0, ++seq) });
    await wait(0);
    server!.tick();
    if (i % 4 === 0) await wait(1);
  }
  await wait(30);
}
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  server = null;
});

describe('kompenzace pingu', () => {
  /** Cíl běží do strany 5 m/s; střelec míří tam, kde ho viděl před `behind` sekundami. */
  async function shoot(lag: number, behind: number) {
    const d = buildEmptyMap('lag', 128, 2);
    const phys = await PhysicsWorld.create();
    phys.setTerrain(d.terrain);
    const m = new MatchSim(phys, d, { conquest: false });
    if (lag >= 0) m.lagOf = () => lag;
    const a = m.addPlayer('a', 'teamA'), b = m.addPlayer('b', 'teamB');
    m.requestSpawn('a', null, 'm4a1');
    m.requestSpawn('b', null, 'ak101');
    a.ctrl.place(a.state, { x: 0, y: 0.02, z: 0 }, 0);
    const SPEED = 5, Z = -20;
    let hits = 0;
    const step = (pressed = 0) => {
      const bx = -8 + SPEED * m.time;
      b.ctrl.place(b.state, { x: bx, y: 0.02, z: Z }, 0);
      // Míření na polohu cíle před `behind` sekundami.
      const tx = bx - SPEED * behind;
      a.state.yaw = Math.atan2(-tx, -Z);
      m.step(new Map([['a', { ...emptyInput(m.tick), pressed, held: pressed }], ['b', emptyInput(m.tick)]]));
      for (const e of m.events) if (e.type === 'hit' && e.target === 'b') hits++;
      m.events.length = 0;
    };
    for (let i = 0; i < 60; i++) step();
    step(BTN.FIRE);
    for (let i = 0; i < 20; i++) step();
    m.dispose();
    phys.free();
    return hits;
  }
  it('bez kompenzace střela na viděnou (starou) polohu běžícího cíle mine; s kompenzací zasáhne', async () => {
    expect(await shoot(-1, 0.2)).toBe(0);
    expect(await shoot(0.2, 0.2)).toBeGreaterThan(0);
  });
  it('kompenzace je omezená: zpoždění nad limit se nezvýhodní a míření na aktuální polohu při ní mine', async () => {
    expect(LAG_COMP_MAX).toBeLessThanOrEqual(0.25);
    expect(await shoot(2, 0.8)).toBe(0); // 0,8 s starou polohu server neuzná
    expect(await shoot(0.2, 0)).toBe(0); // férovost: platí to, co střelec viděl
  });
});

describe('server: kola a viditelnost nepřátel', () => {
  it('po konci kola začne nové s dalším scénářem; hráči se vrátí na nasazení a skóre se vynuluje', async () => {
    server = await GameServer.create(buildStreetMap(), { conquest: true, scenarioId: 'sc_bases', manualTick: true, roundBreak: 0.5 });
    const port = await server.listen(0);
    const a = await connect(port, 'Alfa');
    a.send({ t: 'spawn', id: a.welcome!.team === 'teamA' ? 'sa0' : 'sb0' });
    await run(30);
    const p = server.sim.players.get(a.id)!;
    expect(p.alive).toBe(true);
    p.kills = 3;
    server.sim.conquest!.tickets.teamB = 0;
    await run(10);
    expect(server.sim.conquest!.ended).toBe(true);
    expect(a.lastSnap!.ended).toBe(true);
    expect(a.lastSnap!.nextRound).toBeGreaterThan(0);
    await run(60);
    expect(server.sim.conquest!.ended).toBe(false);
    expect(server.sim.conquest!.scenarioId).toBe('sc_defense');
    expect(server.round).toBe(2);
    expect(a.lastSnap!.scenario).toBe('sc_defense');
    expect(a.lastSnap!.ended).toBe(false);
    expect(p.alive).toBe(false);
    expect(p.kills).toBe(0);
    // Nasazení v novém kole funguje.
    a.send({ t: 'spawn', id: a.welcome!.team === 'teamA' ? 'sa0' : 'sb0' });
    await run(30);
    expect(p.alive).toBe(true);
  });

  it('nepřítel za zdí se klientovi neposílá, ve výhledu a zblízka ano; spoluhráč vždy', async () => {
    server = await GameServer.create(buildStreetMap(), { conquest: true, scenarioId: 'sc_bases', manualTick: true });
    const port = await server.listen(0);
    const a = await connect(port, 'Alfa');
    const b = await connect(port, 'Bravo');
    const a2 = await connect(port, 'Alfa2');
    for (const c of [a, b, a2]) c.send({ t: 'spawn', id: c.welcome!.team === 'teamA' ? 'sa0' : 'sb0' });
    await run(30);
    const sim = server.sim;
    const pa = sim.players.get(a.id)!, pb = sim.players.get(b.id)!, pa2 = sim.players.get(a2.id)!;
    const ray = (x0: number, z0: number, x1: number, z1: number) => {
      const d = Math.hypot(x1 - x0, z1 - z0);
      return server!.phys.castRay({ x: x0, y: 1.6, z: z0 }, { x: (x1 - x0) / d, y: 0, z: (z1 - z0) / d }, d);
    };
    // Najdi dvojici míst na mapě s plnou zdí mezi nimi (dál než 12 m) – hledá se v uličkách kolem ulice.
    let blocked: [number, number, number, number] | null = null;
    search: for (let z = -60; z <= 0; z += 4)
      for (const x of [14, 18, 22, -14, -18, -22]) {
        const hit = ray(0, z, x, z);
        // Zeď mezi ulicí a místem, a místo samo je volné (paprsek shora dopadne na zem, ne na střechu).
        const down = server!.phys.castRay({ x, y: 30, z }, { x: 0, y: -1, z: 0 }, 40);
        if (hit && hit.distance < Math.abs(x) - 2 && down && down.point.y < 0.6) {
          blocked = [0, z, x, z];
          break search;
        }
      }
    expect(blocked, 'na mapě je místo za budovou').not.toBeNull();
    const [ax, az, bx, bz] = blocked!;
    const place = () => {
      pa.ctrl.place(pa.state, { x: ax, y: 0.1, z: az }, 0);
      pb.ctrl.place(pb.state, { x: bx, y: 0.1, z: bz }, 0);
      pa2.ctrl.place(pa2.state, { x: bx + 1, y: 0.1, z: bz }, 0);
    };
    const ids = (c: NetClient) => (c.lastSnap!.o ?? []).map((t) => t[0]).concat(c.lastSnap!.others.map((o) => o.id));
    place();
    await run(90); // > 1 s grace
    place();
    await run(6);
    expect(ids(a)).not.toContain(b.id);
    expect(ids(b)).not.toContain(a.id);
    expect(ids(a)).toContain(a2.id); // spoluhráč za zdí se posílá vždy
    // Na ulici ve výhledu (25 m) se vidí.
    pb.ctrl.place(pb.state, { x: ax, y: 0.1, z: az - 25 }, 0);
    await run(8);
    const los = ray(ax, az, ax, az - 25);
    if (!los) expect(ids(a)).toContain(b.id);
    // Zblízka (do 12 m) vždy – i přes roh (kroky).
    pb.ctrl.place(pb.state, { x: ax + 5, y: 0.1, z: az }, 0);
    await run(8);
    expect(ids(a)).toContain(b.id);
  });
});
