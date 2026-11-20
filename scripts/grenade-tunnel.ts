// Vývojová kontrola: průlet granátů geometrií na Referenční ulici. Hází tisíce granátů z mřížky
// míst do všech směrů a v každém kroku ověří, že mezi starou a novou polohou neleží žádná překážka
// (paprsek všech skupin kolizí). Použití: npx tsx scripts/grenade-tunnel.ts
import { PhysicsWorld, GRENADE_QUERY_GROUPS } from '../src/shared/physics/world';
import { MatchSim } from '../src/shared/sim/match';
import { stepGrenades } from '../src/shared/sim/matchItems';
import { buildStreetMap } from '../src/world/maps/street';
import { collidersForMap, generateMap } from '../src/world';

const doc = buildStreetMap();
const phys = await PhysicsWorld.create();
phys.setTerrain(doc.terrain);
phys.addColliders(collidersForMap(generateMap(doc).filter((g) => !g.object.gameHidden)));
phys.sync();
const m = new MatchSim(phys, doc, { conquest: false });
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let thrown = 0, tunnels = 0, steps = 0;
const examples: string[] = [];
for (let batch = 0; batch < 40; batch++) {
  for (let i = 0; i < 100; i++) {
    const x = (rnd() - 0.5) * 60, z = -80 + rnd() * 110, y = 0.5 + rnd() * 8;
    const yaw = rnd() * Math.PI * 2, pitch = (rnd() - 0.35) * 1.3, sp = 6 + rnd() * 22;
    m.grenades.push({ id: `g${thrown++}`, owner: 'x', team: 'teamA', kind: 'smoke', pos: { x, y, z }, vel: { x: Math.cos(pitch) * Math.sin(yaw) * sp, y: Math.sin(pitch) * sp, z: Math.cos(pitch) * Math.cos(yaw) * sp }, fuseAt: 1e9, smokeUntil: 0, rest: false });
  }
  for (let t = 0; t < 300; t++) {
    const before = new Map(m.grenades.map((n) => [n.id, { ...n.pos }]));
    stepGrenades(m, 1 / 60);
    for (const n of m.grenades) {
      const a = before.get(n.id);
      if (!a) continue;
      const d = { x: n.pos.x - a.x, y: n.pos.y - a.y, z: n.pos.z - a.z };
      const l = Math.hypot(d.x, d.y, d.z);
      if (l < 1e-4) continue;
      steps++;
      const hit = phys.castRay(a, { x: d.x / l, y: d.y / l, z: d.z / l }, l, GRENADE_QUERY_GROUPS);
      // Start uvnitř překážky (toi 0) i zásah před koncem kroku = granát prošel geometrií.
      if (hit && hit.distance < l - 1e-3) {
        tunnels++;
        if (examples.length < 8) examples.push(`${n.id} ${hit.objectId} ${hit.surface} d=${hit.distance.toFixed(3)} l=${l.toFixed(3)} od (${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)})`);
      }
    }
  }
  m.grenades.length = 0;
}
console.log(JSON.stringify({ hozeno: thrown, kroku: steps, pruletu: tunnels, priklady: examples }, null, 1));
