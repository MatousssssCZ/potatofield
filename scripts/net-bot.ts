// Bot pro měření plynulosti (scripts/net-smooth.ts): běhá sprintem / úkrokem v kruhu.
// Použití: npx tsx scripts/net-bot.ts [sekundy]  (server na ws://127.0.0.1:8799)
import WebSocket from 'ws';
import { NetClient, type WsLike } from '../src/shared/net/client';
import { BTN, emptyInput } from '../src/shared/sim/input';
const ws = new WebSocket('ws://127.0.0.1:8799');
const c = new NetClient(ws as unknown as WsLike, 'Bot');
await new Promise((r) => setTimeout(r, 1500));

await new Promise((r) => setTimeout(r, 500));
let seq = 0, t = 0;
setInterval(() => {
  const s = c.lastSnap;
  if (s && !s.me.alive && t % 60 === 0) c.send({ t: 'spawn', id: (s.spawns ?? [])[0] ?? null } as never);
  t++;
  c.sendInput({ ...emptyInput(0, ++seq), moveZ: 1, moveX: Math.floor(t / 180) % 2 ? 1 : 0, lookDYaw: 0.02, held: Math.floor(t / 180) % 2 ? 0 : BTN.SPRINT });
}, 1000 / 60);
setTimeout(() => process.exit(0), Number(process.argv[2] ?? 60) * 1000);
