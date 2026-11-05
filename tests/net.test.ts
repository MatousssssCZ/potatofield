import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { GameServer } from '../server/gameServer';
import { NetClient, type NetConditions, type WsLike } from '../src/shared/net/client';
import { buildStreetMap } from '../src/world/maps/street';
import { BTN, emptyInput } from '../src/shared/sim/input';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let server: GameServer | null = null;
const clients: NetClient[] = [];

async function start(conquest = true, scenarioId = 'sc_bases') {
  server = await GameServer.create(buildStreetMap(), { conquest, scenarioId, manualTick: true });
  return server.listen(0);
}
async function connect(port: number, name: string, cond?: NetConditions) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`) as unknown as WsLike;
  const c = new NetClient(ws, name, cond);
  clients.push(c);
  for (let i = 0; i < 200 && !c.welcome; i++) await wait(5);
  expect(c.welcome).not.toBeNull();
  return c;
}
/** Ruční krokování serveru s doručováním zpráv (vstupy klientů posílá `feed`). */
async function run(ticks: number, feed?: (tick: number) => void) {
  for (let i = 0; i < ticks; i++) {
    feed?.(i);
    await wait(0);
    server!.tick();
    if (i % 4 === 0) await wait(1);
  }
  await wait(30);
}
let seq = 1000;
const input = (held = 0, pressed = 0, moveZ = 0) => ({ ...emptyInput(0, ++seq), held, pressed, moveZ });

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  server = null;
});

describe('síť – autoritativní server a dva klienti', () => {
  it('handshake: welcome nese mapu, hash a verze generátorů; oba vidí stejné body a tickety', async () => {
    const port = await start();
    const a = await connect(port, 'Alfa');
    const b = await connect(port, 'Bravo');
    expect(a.welcome!.mapHash).toBe(server!.hash);
    expect(a.welcome!.generators['build.residential']).toBe(1);
    expect(a.welcome!.team).not.toBe(b.welcome!.team);
    await run(20);
    expect(JSON.stringify(a.lastSnap!.cps)).toBe(JSON.stringify(b.lastSnap!.cps));
    expect(a.lastSnap!.tickets).toEqual(b.lastSnap!.tickets);
  });

  it('server odmítne cizí spawn, neznámé zprávy (klientské „zasáhl jsem“ / přepsání bodu) a střelbu bez nasazení', async () => {
    const port = await start();
    const a = await connect(port, 'Alfa');
    const team = a.welcome!.team;
    const foreign = team === 'teamA' ? 'sb0' : 'sa0';
    a.send({ t: 'spawn', id: foreign });
    (a as unknown as { ws: WsLike }).ws.send(JSON.stringify({ t: 'damage', target: 'p2', amount: 100 }));
    (a as unknown as { ws: WsLike }).ws.send(JSON.stringify({ t: 'capture', cp: 'cp_market', owner: team }));
    await run(10);
    const rej = a.inbox.filter((m) => m.t === 'reject').map((m) => (m as { reason: string }).reason);
    expect(rej.some((r) => /není pro tým/.test(r))).toBe(true);
    expect(rej.filter((r) => /neplatná nebo nepodporovaná/.test(r)).length).toBe(2);
    expect(server!.sim.conquest!.cps.find((c) => c.id === 'cp_market')!.owner).toBe('neutral');
    // Mrtvý (nenasazený) hráč nemůže střílet.
    await run(20, () => a.sendInput(input(BTN.FIRE, BTN.FIRE)));
    expect(server!.sim.projectiles.length).toBe(0);
  });

  it('střelba: server odpočítá munici a dodrží kadenci; redundantní vstupy nezdvojí výstřely', async () => {
    const port = await start();
    const a = await connect(port, 'Alfa');
    a.send({ t: 'spawn', id: a.welcome!.team === 'teamA' ? 'sa1' : 'sb1' });
    await run(40, () => a.sendInput(input()));
    const p = server!.sim.players.get(a.id)!;
    expect(p.alive).toBe(true);
    await run(60, () => a.sendInput(input(BTN.FIRE, 0)));
    // ~1 s držení při 600 RPM → nejvýš 10 ran (a ne víc kvůli redundanci zpráv).
    const fired = 30 - p.weapon.mag;
    expect(fired).toBeGreaterThan(5);
    expect(fired).toBeLessThanOrEqual(10);
  });

  it('smrt odečte ticket jednou; připojení během zápasu dostane úplný stav; odpojení odstraní hráče z bodu', async () => {
    const port = await start();
    const a = await connect(port, 'Alfa');
    const sim = server!.sim;
    a.send({ t: 'spawn', id: a.welcome!.team === 'teamA' ? 'sa0' : 'sb0' });
    await run(20, () => a.sendInput(input()));
    const p = sim.players.get(a.id)!;
    const team = p.team;
    const before = sim.conquest!.tickets[team];
    p.ctrl.place(p.state, { x: 0, y: -80, z: 0 }, 0);
    await run(10, () => a.sendInput(input()));
    expect(p.alive).toBe(false);
    expect(sim.conquest!.tickets[team]).toBe(before - 1);
    await run(30, () => a.sendInput(input()));
    expect(sim.conquest!.tickets[team]).toBe(before - 1);
    // Druhý hráč se připojí uprostřed: dostane aktuální tickety.
    const b = await connect(port, 'Bravo');
    await run(5);
    expect(b.lastSnap!.tickets![team]).toBe(before - 1);
    // Hráč B stojí v bodě → po odpojení postup zabírání stojí.
    b.send({ t: 'spawn', id: b.welcome!.team === 'teamA' ? 'sa0' : 'sb0' });
    await run(20, () => b.sendInput(input()));
    const pb = sim.players.get(b.id)!;
    pb.ctrl.place(pb.state, { x: 0, y: 0.1, z: -33.5 }, 0);
    await run(60, () => b.sendInput(input()));
    const cp = sim.conquest!.cps.find((c) => c.id === 'cp_cross')!;
    expect(Math.abs(cp.p)).toBeGreaterThan(0.05);
    b.close();
    await wait(50);
    const frozen = cp.p;
    await run(60);
    expect(sim.players.has(b.id)).toBe(false);
    expect(cp.p).toBe(frozen);
  });

  it('týmová izolace: týmový chat, kontakty a čety nepřítel nedostane; squad chat jen četa', async () => {
    const port = await start();
    const a = await connect(port, 'Alfa');
    const b = await connect(port, 'Bravo');
    const a2 = await connect(port, 'Alfa2'); // 3. hráč → tým A (vyrovnání)
    expect(a2.welcome!.team).toBe(a.welcome!.team);
    a.send({ t: 'chat', ch: 'team', text: 'tajný plán <b>útoku</b>' });
    a.send({ t: 'squad', op: 'create' });
    await run(10);
    a.send({ t: 'chat', ch: 'squad', text: 'jen četa' });
    a.send({ t: 'chat', ch: 'all', text: 'ahoj všem' });
    await run(10);
    const texts = (c: NetClient) => c.inbox.filter((m) => m.t === 'chat' && m.ch !== 'system').map((m) => (m as { text: string }).text);
    expect(texts(a2)).toContain('tajný plán <b>útoku</b>'); // doručeno jako text (UI ho nevykresluje jako HTML)
    expect(texts(b)).not.toContain('tajný plán <b>útoku</b>');
    expect(texts(b)).toContain('ahoj všem');
    expect(texts(a2)).not.toContain('jen četa');
    expect(texts(a)).toContain('jen četa');
    expect(b.lastSnap!.squads.length).toBe(0);
    expect(a2.lastSnap!.squads.length).toBe(1);
    // Spam: max 3 zprávy za 5 s.
    for (let i = 0; i < 5; i++) a.send({ t: 'chat', ch: 'all', text: `spam ${i}` });
    await run(5);
    expect(a.inbox.some((m) => m.t === 'reject' && /příliš mnoho/.test((m as { reason: string }).reason))).toBe(true);
  });

  it('čety: kapacita 6 je atomická, odchod leadera nezanechá dva leadery', async () => {
    const port = await start(false);
    const cs: NetClient[] = [];
    for (let i = 0; i < 14; i++) cs.push(await connect(port, `H${i}`));
    const teamA = cs.filter((c) => c.welcome!.team === 'teamA');
    teamA[0].send({ t: 'squad', op: 'create' });
    await run(5);
    const sq = server!.team.squadsFor('teamA')[0];
    for (const c of teamA.slice(1)) c.send({ t: 'squad', op: 'join', squad: sq.id });
    await run(10);
    expect(server!.team.squads.get(sq.id)!.members.length).toBe(6);
    teamA[0].close();
    await wait(50);
    await run(3);
    const s2 = server!.team.squads.get(sq.id)!;
    expect(s2.members.length).toBe(5);
    expect(s2.members).toContain(s2.leader);
  });

  it('spot: zeď blokuje ruční kontakt; viditelný nepřítel dá kontakt jen vlastnímu týmu s expirací', async () => {
    const port = await start(false);
    const a = await connect(port, 'Alfa');
    const b = await connect(port, 'Bravo');
    // Po připojení server nenasazuje sám – nasazení potvrzuje hráč.
    a.send({ t: 'spawn', id: null });
    b.send({ t: 'spawn', id: null });
    await run(40, () => {
      a.sendInput(input());
      b.sendInput(input());
    });
    const sim = server!.sim;
    const pa = sim.players.get(a.id)!, pb = sim.players.get(b.id)!;
    // Volný výhled podél ulice.
    pa.ctrl.place(pa.state, { x: 0, y: 0.06, z: -20 }, 0);
    pb.ctrl.place(pb.state, { x: 0, y: 0.06, z: -40 }, 0);
    await run(2);
    a.send({ t: 'spot' });
    await run(3);
    expect(server!.team.contacts[pa.team].filter((c) => c.kind === 'confirmed').length).toBe(1);
    await run(5);
    expect(b.lastSnap!.contacts.length).toBe(0);
    expect(a.lastSnap!.contacts.length).toBeGreaterThan(0);
    // Cíl za domem: kontakt nevznikne (jen „podezřelá oblast“ na viditelném povrchu).
    pb.ctrl.place(pb.state, { x: -22, y: 0.06, z: -4 }, 0);
    pa.state.yaw = Math.atan2(22, -16) + Math.PI; // míří přibližně k cíli přes dům A
    await run(70);
    a.send({ t: 'spot' });
    await run(3);
    const conf = server!.team.contacts[pa.team].filter((c) => c.kind === 'confirmed' && c.expires > sim.time);
    expect(conf.every((c) => Math.abs(c.pos[0] + 22) > 1)).toBe(true);
    // Expirace: po 6 s zmizí.
    await run(6 * 60 + 10);
    expect(server!.team.contacts[pa.team].length).toBe(0);
  });

  it('podmínky sítě: 100 ms RTT, jitter ±20 ms a 1 % ztrát – výstřely ani munice se nezdvojí, pohyb se srovná', async () => {
    const port = await start(false);
    const cond = { latencyMs: 50, jitterMs: 20, lossPct: 1 };
    const a = await connect(port, 'Alfa', cond);
    await run(30, () => a.sendInput(input()));
    const p = server!.sim.players.get(a.id)!;
    await wait(200);
    let shots = 0;
    const seen = new Set<string>();
    a.onMessage = (m) => {
      if (m.t === 'events') for (const e of m.list) if (e.type === 'shot' && e.owner === a.id && !seen.has(e.key)) {
        seen.add(e.key);
        shots++;
      }
    };
    // Real-time krokování (zpoždění zpráv je v ms) – 2 s s pohybem a krátkými dávkami.
    for (let i = 0; i < 120; i++) {
      a.sendInput(input(i % 40 < 15 ? BTN.FIRE : 0, 0, 1));
      server!.tick();
      await wait(16);
    }
    for (let i = 0; i < 40; i++) {
      server!.tick();
      await wait(16);
    }
    await wait(300);
    expect(shots).toBe(30 - p.weapon.mag);
    expect(p.weapon.mag + p.weapon.reserve).toBe(150 - shots);
  }, 30000);
});
