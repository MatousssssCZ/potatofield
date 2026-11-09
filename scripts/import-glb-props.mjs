/**
 * Import modelů GLB (+ JSON metadat) do editoru.
 * Použití: node scripts/import-glb-props.mjs <složka s *.glb a *.json>
 * - GLB: ponechá jen LOD0 (bez kolizních sítí COL_*) → public/models/props/<id>.glb
 * - JSON: kolize, žebříky, přichycení → src/world/assets/glbProps.data.ts (čte i server)
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import * as THREE from 'three';

const src = process.argv[2];
if (!src) throw new Error('chybí složka');
const outGlb = 'public/models/props';
fs.mkdirSync(outGlb, { recursive: true });
const io = new NodeIO();
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const out = [];
for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8'));
  const doc = await io.read(path.join(src, j.id + '.glb'));
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  for (const n of root.listNodes()) if (n.getName() !== 'LOD0') n.dispose();
  for (const m of root.listMaterials()) if (m.getName() === 'collision') m.dispose();
  await doc.transform(prune({ keepAttributes: true, keepLeaves: false }));
  if (!scene.listChildren().length) throw new Error(j.id + ': chybí LOD0');
  await io.write(path.join(outGlb, j.id + '.glb'), doc);
  const colliders = j.collision.map((c) => {
    // Pořadí z JSON: R = Rz·Ry·Rx → Euler XYZ (náš formát dílů).
    const e = new THREE.Euler(c.rotX ?? 0, c.rotY ?? 0, c.rotZ ?? 0, 'ZYX');
    e.reorder('XYZ');
    return { c: c.center.map(r4), s: c.size.map(r4), r: [r4(e.x), r4(e.y), r4(e.z)], surface: c.surface };
  });
  out.push({
    id: j.id,
    label: j.label_cs,
    category: j.category,
    kind: j.asset_kind,
    bounds: [j.bounds_m.min.map(r4), j.bounds_m.max.map(r4)],
    tris: j.triangles.LOD0,
    materials: j.materials,
    mount: j.mount,
    colliders,
    ladders: j.ladders.map((l) => ({ base: l.base.map(r4), height: l.height, yawDeg: l.facing_deg })),
  });
}
const ts = `// Vygenerováno skriptem scripts/import-glb-props.mjs – needitovat ručně.\nimport type { GlbPropData } from './glbProps';\n\nexport const GLB_PROPS: GlbPropData[] = ${JSON.stringify(out, null, 1)};\n`;
fs.writeFileSync('src/world/assets/glbProps.data.ts', ts);
console.log('importováno', out.length);
