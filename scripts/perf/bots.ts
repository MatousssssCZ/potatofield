/**
 * Boti pro audit výkonu (scripts/perf/server.ts je spouští v samostatném procesu, aby nesdíleli CPU
 * se serverem). Chování převzaté z loadtest.ts:
 *   fight   – jdou na nejbližšího viditelného nepřítele, střílí dávky, přebíjí, respawnují (shluk),
 *   spread  – každý běží k vlastnímu náhodnému bodu mapy a nestřílí (rozptýlení, bez soubojů).
 * Použití: npx tsx scripts/perf/bots.ts <ws url> <počet> <fight|spread> <sekundy> [seed]
 */
import WebSocket from 'ws';
import { NetClient, type WsLike } from '../../src/shared/net/client';
import { BTN, emptyInput } from '../../src/shared/sim/input';
import { angleDiff } from '../../src/shared/math';

const [url, nStr = '16', mode = 'fight', secStr = '60', seedStr = '1'] = process.argv.slice(2);
const N = Number(nStr), SECONDS = Number(secStr);
let seed = Number(seedStr) * 7919;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

interface Bot { c: NetClient; ws: WebSocket; seq: number; strafe: number; burst: number; goal: [number, number] }
const bots: Bot[] = [];
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(url);
  const c = new NetClient(ws as unknown as WsLike, `bot${i}`);
  bots.push({ c, ws, seq: 0, strafe: 1, burst: 0, goal: [(rnd() - 0.5) * 160, (rnd() - 0.5) * 160] });
  await new Promise((r) => setTimeout(r, 30));
}
let ticker = 0;
const counters = { shots: 0 };
setInterval(() => {
  ticker++;
  for (const b of bots) {
    const s = b.c.lastSnap;
    if (!s) continue;
    if (!s.me.alive) {
      if (s.spawns.length && ticker % 30 === 0) b.c.send({ t: 'spawn', id: s.spawns[Math.floor(rnd() * s.spawns.length)] });
      continue;
    }
    const me = s.me.state;
    let tx = b.goal[0], tz = b.goal[1], ty = 1, enemy = false, bd = 1e9;
    if (mode === 'fight') {
      tx = 0; tz = -33.5;
      for (const o of s.others) {
        if (!o.alive || o.team === s.me.team) continue;
        const d = Math.hypot(o.pos[0] - me.pos.x, o.pos[2] - me.pos.z);
        if (d < bd) { bd = d; tx = o.pos[0]; ty = o.pos[1] + 1.3; tz = o.pos[2]; enemy = true; }
      }
    } else if (Math.hypot(tx - me.pos.x, tz - me.pos.z) < 4 || ticker % 900 === 0) b.goal = [(rnd() - 0.5) * 160, (rnd() - 0.5) * 160];
    const want = Math.atan2(-(tx - me.pos.x), -(tz - me.pos.z));
    const dyaw = Math.max(-0.08, Math.min(0.08, angleDiff(want, me.yaw)));
    const dist = Math.hypot(tx - me.pos.x, tz - me.pos.z);
    const dp = Math.max(-0.05, Math.min(0.05, Math.atan2(ty - (me.pos.y + 1.65), dist) - me.pitch));
    if (ticker % 90 === 0) b.strafe = rnd() < 0.5 ? -1 : 1;
    let held = 0, pressed = 0;
    if (mode === 'fight') {
      const fire = enemy && dist < 70 && Math.abs(angleDiff(want, me.yaw)) < 0.08;
      if (fire && b.burst <= 0 && rnd() < 0.05) b.burst = 10 + Math.floor(rnd() * 10);
      if (b.burst > 0) { held |= BTN.FIRE; b.burst--; counters.shots++; }
      if (s.me.weapon.mag === 0 && ticker % 20 === 0) pressed |= BTN.RELOAD;
    } else if (ticker % 120 < 80) held |= BTN.SPRINT;
    b.c.sendInput({ ...emptyInput(0, ++b.seq), moveZ: enemy && dist < 25 ? 0 : 1, moveX: enemy ? b.strafe : 0, lookDYaw: dyaw, lookDPitch: dp, held, pressed: pressed | (held & BTN.FIRE && b.burst === 9 ? BTN.FIRE : 0) });
  }
}, 1000 / 60);
const t0 = Date.now();
setTimeout(() => {
  const secs = (Date.now() - t0) / 1000;
  const app = bots.reduce((a, b) => a + b.c.bytesIn, 0);
  const wire = bots.reduce((a, b) => a + ((b.ws as unknown as { _socket?: { bytesRead: number } })._socket?.bytesRead ?? 0), 0);
  console.log(JSON.stringify({ bots: N, mode, seconds: +secs.toFixed(1), bytesInPerBotPerSec: Math.round(app / secs / N), wireInPerBotPerSec: Math.round(wire / secs / N), alive: bots.filter((b) => b.c.lastSnap?.me.alive).length }));
  for (const b of bots) b.c.close();
  process.exit(0);
}, SECONDS * 1000);
