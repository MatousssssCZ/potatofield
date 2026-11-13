/**
 * Spuštění serveru: npm run server -- --map maps/street_reference.json --port 8787
 * Každý parametr lze zadat i proměnnou prostředí PF_<NÁZEV> (např. PF_NAME, PF_TEAM_SIZE,
 * PF_FF=1, PF_NO_PILOT=1); port bere i z PORT (hosting typu Render ho přiděluje sám).
 */
import { appendFile, readFileSync } from 'node:fs';
import { parseMapJson } from '../src/shared/map/validate';
import { GameServer } from './gameServer';
import { FACTION_LABEL, PILOT, type Faction } from '../src/shared/config/arsenal';
import { PROTOCOL_VERSION } from '../src/shared/net/protocol';

const args = process.argv.slice(2);
const envKey = (k: string) => `PF_${k.toUpperCase().replace(/-/g, '_')}`;
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : (process.env[envKey(k)] ?? d);
};
/** Přepínač: --ff nebo PF_FF=1 / true. */
const flag = (k: string) => args.includes(`--${k}`) || /^(1|true|yes)$/i.test(process.env[envKey(k)] ?? '');
const file = arg('map', 'maps/street_reference.json');
const r = parseMapJson(readFileSync(file, 'utf8'));
if (!r.ok || !r.doc) {
  console.error('Mapa neprošla validací:', r.issues);
  process.exit(1);
}
const conquest = !flag('free') && r.doc.controlPoints.length > 0 && r.doc.scenarios.length > 0;
// Frakce týmů: --factions usmc,mec (výchozí), např. usmc,pla nebo mec,pla.
const [fa, fb] = arg('factions', 'usmc,mec').split(',') as [Faction, Faction];
if (![fa, fb].every((f) => f in FACTION_LABEL)) {
  console.error('Neplatné frakce (usmc | mec | pla).');
  process.exit(1);
}
// Pilot (výchozí): USMC × MEC, 8 proti 8, classy Assault/Medic/Support/Sniper. --no-pilot zpřístupní celý arzenál.
const pilot = !flag('no-pilot');
if (pilot && [fa, fb].some((f) => !PILOT.factions.includes(f))) {
  console.error('Pilot hraje jen frakce usmc × mec (Falcon Corps × Dune League); pro jiné použijte --no-pilot.');
  process.exit(1);
}
const recordsFile = process.env.PF_RECORDS || '';
const server = await GameServer.create(r.doc, {
  conquest,
  scenarioId: arg('scenario', r.doc.scenarios[0]?.id ?? ''),
  factions: { teamA: fa, teamB: fb },
  name: arg('name', 'Potatofield'),
  pilot,
  teamSize: Number(arg('team-size', String(PILOT.teamSize))),
  friendlyFire: flag('ff'),
  log: (s) => console.log(s),
  // Heslo správce jen z prostředí (PF_ADMIN_PASSWORD) – ne z příkazové řádky, kde je vidět ve výpisu procesů.
  adminPassword: process.env.PF_ADMIN_PASSWORD || undefined,
  roundBreak: Number(arg('round-break', '20')),
  // Volitelný soubor záznamů (nahlášení, zákazy, chyby klientů): PF_RECORDS=cesta, řádek = JSON.
  onRecord: recordsFile ? (kind, data) => appendFile(recordsFile, JSON.stringify({ kind, ...data }) + '\n', () => {}) : undefined,
});
await server.listen(Number(process.env.PORT ?? arg('port', '8787')));
// Hosting při nasazení nové verze posílá SIGTERM: hráčům se vysvětlí, proč je server odpojil.
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.once(sig, () => {
    console.log(`${sig}: ukončuji server`);
    void server.shutdown('server se restartuje – připoj se znovu za chvíli').then(() => process.exit(0));
  });
console.log(`režim: ${conquest ? 'Conquest' : 'volný test'} · protokol v${PROTOCOL_VERSION} · frakce ${FACTION_LABEL[fa]} × ${FACTION_LABEL[fb]} · tick 60 Hz · snapshot 30 Hz`);
setInterval(() => {
  const s = server.stats();
  if (s.clients) console.log(`hráči ${s.clients}  tick avg ${s.tickMsAvg.toFixed(2)} ms  p95 ${s.tickMsP95.toFixed(2)}  max ${s.tickMsMax.toFixed(2)}  out ${(s.bytesOutPerSec / 1024).toFixed(1)} KiB/s  fronta ${s.queueMax}`);
}, 10000);
