/** Spuštění lokálního serveru: npm run server -- --map maps/street_reference.json --port 8787 */
import { readFileSync } from 'node:fs';
import { parseMapJson } from '../src/shared/map/validate';
import { GameServer } from './gameServer';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const file = arg('map', 'maps/street_reference.json');
const r = parseMapJson(readFileSync(file, 'utf8'));
if (!r.ok || !r.doc) {
  console.error('Mapa neprošla validací:', r.issues);
  process.exit(1);
}
const conquest = !args.includes('--free') && r.doc.controlPoints.length > 0 && r.doc.scenarios.length > 0;
const server = await GameServer.create(r.doc, { conquest, scenarioId: arg('scenario', r.doc.scenarios[0]?.id ?? ''), log: (s) => console.log(s) });
await server.listen(Number(arg('port', '8787')));
console.log(`režim: ${conquest ? 'Conquest' : 'volný test'} · protokol v1 · tick 60 Hz · snapshot 30 Hz`);
setInterval(() => {
  const s = server.stats();
  if (s.clients) console.log(`hráči ${s.clients}  tick avg ${s.tickMsAvg.toFixed(2)} ms  p95 ${s.tickMsP95.toFixed(2)}  max ${s.tickMsMax.toFixed(2)}  out ${(s.bytesOutPerSec / 1024).toFixed(1)} KiB/s  fronta ${s.queueMax}`);
}, 10000);
