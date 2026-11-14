// Vývojový nástroj: půdorys kolizí mapy do JSON (kreslí se zvlášť). npx tsx scripts/map-plan.ts <out.json>
import { writeFileSync } from 'node:fs';
import { collidersForMap, generateMap } from '../src/world';
import { buildOsadaMap } from '../src/world/maps/osada';
const doc = buildOsadaMap();
const cols = collidersForMap(generateMap(doc));
const boxes = cols.filter((c) => c.kind === 'box' || c.kind === 'cylinder').map((c) => {
  const q = c.rotation;
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
  return { x: c.center.x, z: c.center.z, hx: c.half.x, hz: c.half.z, top: c.center.y + c.half.y, bot: c.center.y - c.half.y, yaw, move: !c.bulletOnly, kind: c.kind };
});
writeFileSync(process.argv[2], JSON.stringify({ boxes, cps: doc.controlPoints.map((c) => ({ n: c.name, p: c.position, r: c.radius })), spawns: doc.spawnPoints.map((s) => s.position) }));
console.log(boxes.length, 'kolizí');
