// Vývojový nástroj: počty trojúhelníků, délky a geometrie mířidel hotových zbraní (npx tsx scripts/weapon-report.ts).
import * as THREE from 'three';
import { buildFirstPerson, readyWeapons } from '../src/client/render/weapons/catalog';
import { HAND_LOOKS, buildHandGeometry } from '../src/client/render/weapons/hands';
for (const d of readyWeapons()) {
  const m = buildFirstPerson(d.id);
  const hg = buildHandGeometry(HAND_LOOKS[d.hands], 1);
  let h = 0;
  for (const g of Object.values(hg)) if (g instanceof THREE.BufferGeometry) h += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const b = new THREE.Box3().setFromBufferAttribute(m.static.metal.getAttribute('position') as THREE.BufferAttribute).union(new THREE.Box3().setFromBufferAttribute(m.static.polymer.getAttribute('position') as THREE.BufferAttribute));
  console.log(d.id, 'zbraň', m.triangles, 'celkem s rukama', m.triangles + 2 * h, 'délka', (b.max.z - b.min.z).toFixed(3), 'oko→hledí', (m.points.opticEye.z - m.points.sightRear.z).toFixed(3), 'záměrná', (m.points.sightRear.z - m.points.sightFront.z).toFixed(3));
}
