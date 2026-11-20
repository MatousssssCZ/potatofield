// Měření plynulosti vzdáleného hráče: skutečný klientský NetDriver v Node, vzorkování 60 Hz; porovná
// novou interpolaci (InterpClock) se starou. Server na 8799 + `npx tsx scripts/net-bot.ts 100`, pak
// `npx tsx scripts/net-smooth.ts [jitter ms]`. Přibrzdění hostingu lze napodobit kill -STOP / -CONT serveru.
import WebSocket from 'ws';
import { NetDriver } from '../src/client/runtime/netDriver';
import type { WsLike } from '../src/shared/net/client';
const jitter = Number(process.argv[2] ?? 0);
const ws = new WebSocket('ws://127.0.0.1:8799');
const d = new NetDriver(ws as unknown as WsLike, 'Obs', { latencyMs: jitter ? 50 : 0, jitterMs: jitter, lossPct: 0 });
await new Promise((r) => setTimeout(r, 1500));
d.net.send({ t: 'chat', ch: 'all', text: '/spectate' } as never);
await new Promise((r) => setTimeout(r, 4000));
const D = d as unknown as { buffer: Array<{ time: number; others: Array<{ alive: boolean; pos: number[] }> }>; serverTime: number; serverTimeAt: number };
function oldPos(): [number, number] | null {
  const b0 = D.buffer;
  if (!b0.length) return null;
  const now = D.serverTime + (performance.now() - D.serverTimeAt) / 1000 - 0.1;
  let a = b0[0], b = b0[b0.length - 1];
  for (let i = 0; i < b0.length - 1; i++) if (b0[i].time <= now && b0[i + 1].time >= now) { a = b0[i]; b = b0[i + 1]; break; }
  const k = b.time > a.time ? Math.min(1, Math.max(0, (now - a.time) / (b.time - a.time))) : 1;
  const o = b.others.find((x) => x.alive), p = a.others.find((x) => x.alive) ?? o;
  if (!o || !p) return null;
  return [p.pos[0] + (o.pos[0] - p.pos[0]) * k, p.pos[2] + (o.pos[2] - p.pos[2]) * k];
}
const rows: number[][] = [];
const t0 = performance.now();
await new Promise<void>((res) => {
  const id = setInterval(() => {
    const r = d.remotes().find((x) => x.alive);
    const o = oldPos();
    if (r && o) rows.push([performance.now(), r.state.pos.x, r.state.pos.z, o[0], o[1], Math.hypot(r.state.vel.x, r.state.vel.z)]);
    if (performance.now() - t0 > 20000) { clearInterval(id); res(); }
  }, 1000 / 60);
});
function stats(ix: number, iz: number) {
  const rel: number[] = [];
  let hitch = 0, freeze = 0;
  for (let i = 1; i < rows.length; i++) {
    const dt = (rows[i][0] - rows[i - 1][0]) / 1000;
    if (dt < 0.005 || rows[i][5] < 2) continue;
    const v = Math.hypot(rows[i][ix] - rows[i - 1][ix], rows[i][iz] - rows[i - 1][iz]) / dt / rows[i][5];
    rel.push(v);
    if (Math.abs(v - 1) > 0.5) hitch++;
    if (v < 0.05) freeze++;
  }
  rel.sort((a, b) => a - b);
  const q = (f: number) => rel[Math.floor(rel.length * f)]?.toFixed(2);
  return { n: rel.length, hitchPct: +((100 * hitch) / Math.max(1, rel.length)).toFixed(1), freezePct: +((100 * freeze) / Math.max(1, rel.length)).toFixed(1), p5: q(0.05), p50: q(0.5), p95: q(0.95) };
}
const C = (d as unknown as { clock: { delay: number; jitter: number } }).clock;
console.log(JSON.stringify({ jitterMs: jitter, nova: stats(1, 2), stara: stats(3, 4), delayMs: Math.round(C.delay * 1000), jitterEst: Math.round(C.jitter * 1000) }));
process.exit(0);
