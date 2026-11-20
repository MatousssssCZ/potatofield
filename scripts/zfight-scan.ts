// Vývojová kontrola: hledá z-fighting – dvojice vykreslených ploch (kvádry, podstavy válců), které
// leží ve stejné rovině, míří stejným směrem a překrývají se. Takové plochy při pohybu kamery
// „přeskakují“. Počítá s oddělením ploch při vykreslení (zsep); --raw = bez něj.
// Použití: npx tsx scripts/zfight-scan.ts [filtr assetId] [--raw]
import * as THREE from 'three';
import { allAssets, generateObject } from '../src/world';
import { resolveParams } from '../src/world/registry';
import { makeFlatTerrain } from '../src/shared/map/schema';
import { separateCoplanar } from '../src/client/render/zsep';
const SEP = !process.argv.includes('--raw');

const filter = process.argv.slice(2).find((a) => !a.startsWith('--'));
const terrain = makeFlatTerrain(64, 64, 2);
interface Face { n: THREE.Vector3; d: number; c: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; hu: number; hv: number; part: number; mat: string }
const faces = (p: any, idx: number): Face[] => {
  if (p.render === false) return [];
  if (p.shape !== 'box' && p.shape !== 'cylinder') return [];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
  const c0 = new THREE.Vector3(...p.pos);
  const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyQuaternion(q));
  const h = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
  const out: Face[] = [];
  const axes = p.shape === 'cylinder' ? [1] : [0, 1, 2]; // válec: jen podstavy (osa Y), obvod je zaoblený
  for (const i of axes) for (const s of [-1, 1]) {
    const n = ax[i].clone().multiplyScalar(s);
    const c = c0.clone().addScaledVector(n, h[i]);
    const [j, k] = [0, 1, 2].filter((x) => x !== i);
    // Podstava válce ~ čtverec vepsaný kruhu (konzervativně).
    const shrink = p.shape === 'cylinder' ? 0.7 : 1;
    out.push({ n, d: n.dot(c), c, u: ax[j], v: ax[k], hu: h[j] * shrink, hv: h[k] * shrink, part: idx, mat: p.material });
  }
  return out;
};
const overlap = (a: Face, b: Face) => {
  // Průnik dvou obdélníků v téže rovině – vzorkováním mřížkou bodů plochy a.
  let hit = 0;
  for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
    const pt = a.c.clone().addScaledVector(a.u, (i / 6 * 2 - 1) * a.hu).addScaledVector(a.v, (j / 6 * 2 - 1) * a.hv);
    const r = pt.clone().sub(b.c);
    if (Math.abs(r.dot(b.u)) < b.hu - 1e-4 && Math.abs(r.dot(b.v)) < b.hv - 1e-4) hit++;
  }
  return hit;
};
let total = 0;
const report: string[] = [];
for (const def of allAssets()) {
  if (filter && !def.assetId.includes(filter)) continue;
  let parts: any[];
  try {
    const o = { id: 'x', assetId: def.assetId, generatorVersion: def.generatorVersion, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: resolveParams(def, {}), seed: 1, material: def.defaultMaterial } as any;
    parts = generateObject(o, terrain, []).parts as any[];
  } catch { continue; }
  const F = (SEP ? separateCoplanar(parts) : parts).flatMap((p, i) => faces(p, i));
  let n = 0;
  const ex: string[] = [];
  for (let a = 0; a < F.length; a++) for (let b = a + 1; b < F.length; b++) {
    const A = F[a], B = F[b];
    if (A.part === B.part) continue;
    if (A.n.dot(B.n) < 0.9999 || Math.abs(A.d - B.d) > 1e-4) continue;
    const o = overlap(A, B) + overlap(B, A);
    if (o >= 2) {
      n++;
      if (ex.length < 3) ex.push(`díly ${A.part}(${A.mat}) × ${B.part}(${B.mat}) @ ${A.c.toArray().map((x) => x.toFixed(2)).join(',')}`);
    }
  }
  if (n) {
    total += n;
    report.push(`${def.assetId} „${def.label}“: ${n} – ${ex.join(' | ')}`);
  }
}
console.log(report.join('\n'));
console.log(`\nCelkem dvojic: ${total} v ${report.length} předmětech`);
