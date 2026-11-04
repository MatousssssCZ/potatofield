/**
 * Zátěžový test: N aktivních botů (pohyb, míření na nepřítele, dávky, respawn) proti serveru
 * v témže procesu (přímý přístup ke statistikám ticku). Boti jsou automatizovaní klienti –
 * nejsou důkazem zábavnosti hry ani náhradou lidského playtestu.
 *
 * npm run loadtest -- --bots 16 --seconds 60
 */
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import WebSocket from 'ws';
import { GameServer } from '../server/gameServer';
import { NetClient, type WsLike } from '../src/shared/net/client';
import { parseMapJson } from '../src/shared/map/validate';
import { BTN, emptyInput } from '../src/shared/sim/input';
import { angleDiff } from '../src/shared/math';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const BOTS = Number(arg('bots', '16'));
const SECONDS = Number(arg('seconds', '60'));
const doc = parseMapJson(readFileSync(arg('map', 'maps/street_reference.json'), 'utf8')).doc!;

const server = await GameServer.create(doc, { conquest: true, scenarioId: doc.scenarios[0]?.id });
const port = await server.listen(0);

interface Bot {
  c: NetClient;
  seq: number;
  yaw: number;
  pitch: number;
  strafe: number;
  burst: number;
  wander: number;
}
const bots: Bot[] = [];
for (let i = 0; i < BOTS; i++) {
  const c = new NetClient(new WebSocket(`ws://127.0.0.1:${port}`) as unknown as WsLike, `bot${i}`);
  bots.push({ c, seq: 0, yaw: 0, pitch: 0, strafe: 1, burst: 0, wander: Math.random() * 6 });
}
await new Promise((r) => setTimeout(r, 800));

const t0 = Date.now();
let shots = 0, kills = 0, hits = 0;
const tickSamples: number[] = [];
let ticker = 0;
// Klientská smyčka 60 Hz: každý bot posílá vstup každý tick (jako skutečný prohlížeč).
const loop = setInterval(() => {
  ticker++;
  for (const b of bots) {
    const s = b.c.lastSnap;
    if (!s) continue;
    if (!s.me.alive) {
      if (s.spawns.length && ticker % 30 === 0) b.c.send({ t: 'spawn', id: s.spawns[Math.floor(Math.random() * s.spawns.length)] });
      continue;
    }
    const me = s.me.state;
    // Cíl: nejbližší živý nepřítel; jinak bod k zabrání.
    let tx = 0, tz = -33.5, ty = 1, enemy = false, bd = 1e9;
    for (const o of s.others) {
      if (!o.alive || o.team === s.me.team) continue;
      const d = Math.hypot(o.pos[0] - me.pos.x, o.pos[2] - me.pos.z);
      if (d < bd) {
        bd = d;
        tx = o.pos[0];
        ty = o.pos[1] + 1.3;
        tz = o.pos[2];
        enemy = true;
      }
    }
    const want = Math.atan2(-(tx - me.pos.x), -(tz - me.pos.z));
    const dyaw = Math.max(-0.08, Math.min(0.08, angleDiff(want, me.yaw)));
    const dist = Math.hypot(tx - me.pos.x, tz - me.pos.z);
    const wantPitch = Math.atan2(ty - (me.pos.y + 1.65), dist);
    const dp = Math.max(-0.05, Math.min(0.05, wantPitch - me.pitch));
    if (ticker % 90 === 0) b.strafe = Math.random() < 0.5 ? -1 : 1;
    let held = 0, pressed = 0;
    const fire = enemy && dist < 70 && Math.abs(angleDiff(want, me.yaw)) < 0.08;
    if (fire && b.burst <= 0 && Math.random() < 0.05) b.burst = 10 + Math.floor(Math.random() * 10);
    if (b.burst > 0) {
      held |= BTN.FIRE;
      b.burst--;
    }
    if (s.me.weapon.mag === 0 && ticker % 20 === 0) pressed |= BTN.RELOAD;
    if (!enemy && ticker % 120 === 0 && Math.random() < 0.3) held |= BTN.SPRINT;
    b.c.sendInput({ ...emptyInput(0, ++b.seq), moveZ: enemy && dist < 25 ? 0 : 1, moveX: enemy ? b.strafe : 0, lookDYaw: dyaw, lookDPitch: dp, held, pressed: pressed | (held & BTN.FIRE && b.burst === 9 ? BTN.FIRE : 0) });
  }
}, 1000 / 60);

const statT = setInterval(() => {
  const st = server.stats();
  tickSamples.push(st.tickMsP95);
  process.stdout.write(`\r${((Date.now() - t0) / 1000).toFixed(0)} s  klienti ${st.clients}  tick avg ${st.tickMsAvg.toFixed(2)} ms  p95 ${st.tickMsP95.toFixed(2)}  max ${st.tickMsMax.toFixed(2)}  out ${(st.bytesOutPerSec / 1024).toFixed(0)} KiB/s  in ${st.msgsInPerSec.toFixed(0)} msg/s  fronta ${st.queueMax}   `);
}, 2000);

const origStep = server.sim.step.bind(server.sim);
server.sim.step = (inputs) => {
  origStep(inputs);
  for (const e of server.sim.events) {
    if (e.type === 'shot') shots++;
    if (e.type === 'death') kills++;
    if (e.type === 'hit') hits++;
  }
};

await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(loop);
clearInterval(statT);
const st = server.stats();
const cq = server.sim.conquest!;
const bytesIn = bots.reduce((a, b) => a + b.c.bytesIn, 0);
const report = {
  datum: new Date().toISOString(),
  stroj: { cpu: os.cpus()[0]?.model, jader: os.cpus().length, node: process.version, platforma: `${os.platform()} ${os.release()}` },
  mapa: doc.name,
  boti: BOTS,
  delka_s: SECONDS,
  server: {
    tick_hz: 60,
    snapshot_hz: 30,
    tick_ms_prumer: +st.tickMsAvg.toFixed(3),
    tick_ms_p95: +st.tickMsP95.toFixed(3),
    tick_ms_max: +st.tickMsMax.toFixed(3),
    rozpocet_ms: 16.667,
    vystup_kib_s: +(st.bytesOutPerSec / 1024).toFixed(1),
    vstup_zprav_s: +st.msgsInPerSec.toFixed(0),
    fronta_vstupu_max: st.queueMax,
    tiku_celkem: st.ticks,
  },
  klient_prijato_kib_s_na_bota: +(bytesIn / 1024 / SECONDS / BOTS).toFixed(1),
  hra: { vystrelu: shots, zasahu: hits, umrti: kills, tickety: cq.tickets, body: cq.cps.map((c) => `${c.name}:${c.owner}`) },
  poznamka: 'Automatizovaní klienti ve stejném stroji jako server. Nejde o lidský playtest ani o test 64 hráčů; klientský render výkon se zde neměří.',
};
console.log('\n' + JSON.stringify(report, null, 2));
writeFileSync(arg('out', 'docs/loadtest-report.json'), JSON.stringify(report, null, 2));
for (const b of bots) b.c.close();
await server.close();
process.exit(0);
