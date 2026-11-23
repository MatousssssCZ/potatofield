/**
 * Audit výkonu serveru: server s měřením fází (opts.profile) v tomto procesu, boti v samostatném
 * procesu (scripts/perf/bots.ts). Po zahřátí se měří okno; výsledek se přidá do JSON souboru.
 *
 * npx tsx scripts/perf/server.ts --bots 16 --mode fight --warmup 15 --seconds 60 --out docs/perf-audit/data/server.json
 * Volby: --cull 0 (bez skrývání nepřátel), --seed N, --label text, --map maps/…json
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { GameServer } from '../../server/gameServer';
import { parseMapJson } from '../../src/shared/map/validate';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const BOTS = Number(arg('bots', '16')), MODE = arg('mode', 'fight');
const WARM = Number(arg('warmup', '15')), SECS = Number(arg('seconds', '60'));
const OUT = arg('out', 'docs/perf-audit/data/server.json');
const doc = parseMapJson(readFileSync(arg('map', 'maps/street_reference.json'), 'utf8')).doc!;
const server = await GameServer.create(doc, { conquest: true, scenarioId: doc.scenarios[0]?.id, teamSize: Math.max(8, Math.ceil(BOTS / 2)), profile: true, cullEnemies: arg('cull', '1') !== '0', roundBreak: 5 });
const port = await server.listen(0);
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/perf/bots.ts', `ws://127.0.0.1:${port}`, String(BOTS), MODE, String(WARM + SECS + 3), arg('seed', '1')], { stdio: ['ignore', 'pipe', 'inherit'] });
let botOut = '';
child.stdout.on('data', (d) => (botOut += d));

let shots = 0, hits = 0, impacts = 0;
const origStep = server.sim.step.bind(server.sim);
server.sim.step = (inputs) => {
  origStep(inputs);
  for (const e of server.sim.events) {
    if (e.type === 'shot') shots++;
    else if (e.type === 'hit') hits++;
    else if (e.type === 'impact') impacts++;
  }
};

await new Promise((r) => setTimeout(r, WARM * 1000));
server.profile(true);
shots = hits = impacts = 0;
const eld = monitorEventLoopDelay({ resolution: 5 });
eld.enable();
const cpu0 = process.cpuUsage(), wall0 = performance.now();
const mem: number[] = [];
const memT = setInterval(() => mem.push(process.memoryUsage().rss), 1000);
let aliveSamples = 0, aliveSum = 0;
const aliveT = setInterval(() => {
  aliveSamples++;
  aliveSum += [...server.sim.players.values()].filter((p) => p.alive).length;
}, 1000);
await new Promise((r) => setTimeout(r, SECS * 1000));
clearInterval(memT);
clearInterval(aliveT);
const cpu = process.cpuUsage(cpu0), wall = (performance.now() - wall0) / 1000;
eld.disable();
const prof = server.profile()!;
const st = server.stats();
await new Promise<void>((r) => child.on('exit', () => r()));
const bot = (() => { try { return JSON.parse(botOut.trim().split('\n').pop()!); } catch { return null; } })();
const rec = {
  label: arg('label', `${BOTS} botů, ${MODE}`),
  date: new Date().toISOString(),
  machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version },
  config: { bots: BOTS, mode: MODE, warmupS: WARM, measuredS: SECS, tickHz: 60, snapshotHz: 30, cullEnemies: arg('cull', '1') !== '0', map: doc.name },
  players: server.sim.players.size,
  aliveAvg: +(aliveSum / Math.max(1, aliveSamples)).toFixed(1),
  cpuCorePct: +(((cpu.user + cpu.system) / 1e6 / wall) * 100).toFixed(1),
  eventLoopDelayMs: { p50: +(eld.percentile(50) / 1e6).toFixed(2), p99: +(eld.percentile(99) / 1e6).toFixed(2), max: +(eld.max / 1e6).toFixed(2) },
  rssMB: { start: Math.round((mem[0] ?? 0) / 1e6), end: Math.round((mem[mem.length - 1] ?? 0) / 1e6) },
  ...prof,
  outKiBps: +(st.bytesOutPerSec / 1024).toFixed(1),
  outKiBpsPerClient: +(st.bytesOutPerSec / 1024 / Math.max(1, st.clients)).toFixed(2),
  game: { shotsPerSec: +(shots / SECS).toFixed(1), hitsPerSec: +(hits / SECS).toFixed(2), impactsPerSec: +(impacts / SECS).toFixed(1) },
  botSide: bot,
};
console.log(JSON.stringify(rec, null, 2));
mkdirSync(dirname(OUT), { recursive: true });
const all = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
all.push(rec);
writeFileSync(OUT, JSON.stringify(all, null, 2));
await server.close();
process.exit(0);
