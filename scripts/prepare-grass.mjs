// Připraví trávu z Poly Haven „Grass Medium 02“ (CC0): 5 trsů (karty s alfa texturou stébel),
// převod Z-up → Y-up, zjednodušení geometrie (meshoptimizer) a jedna GLB + textura suchých stébel.
// Vstup: JSON z scripts/blend/blend-mesh-dump.py (čte .blend bez Blenderu) a složka textur z balíku.
// Použití: node scripts/prepare-grass.mjs <grass-mesh.json> <textures dir> <ratio=0.12>
import { readFileSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';

const [json, texDir, ratioArg] = process.argv.slice(2);
const ratio = Number(ratioArg ?? 0.12);
const src = JSON.parse(readFileSync(json, 'utf8'));
const doc = new Document();
const buf = doc.createBuffer();
const scene = doc.createScene('grass');
const mat = doc.createMaterial('grass_dry').setAlphaMode('MASK').setAlphaCutoff(0.4).setDoubleSided(true).setRoughnessFactor(1).setMetallicFactor(0);
for (const [i, key] of Object.keys(src).sort().entries()) {
  const m = src[key];
  const P = [], U = [], I = [];
  // Rohy polygonů → samostatné vrcholy (pozice + UV), polygony na trojúhelníky (vějíř).
  for (let f = 0; f + 1 < m.po.length; f++) {
    const a = m.po[f], b = m.po[f + 1], base = P.length / 3;
    for (let c = a; c < b; c++) {
      const v = m.cv[c];
      P.push(m.pos[v * 3], m.pos[v * 3 + 2], -m.pos[v * 3 + 1]); // Blender Z-up → Y-up
      U.push(m.uv[c * 2], 1 - m.uv[c * 2 + 1]);
    }
    for (let k = 1; k + 1 < b - a; k++) I.push(base, base + k, base + k + 1);
  }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(U)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(I)).setBuffer(buf))
    .setMaterial(mat);
  const mesh = doc.createMesh(`clump_${'abcde'[i]}`).addPrimitive(prim);
  scene.addChild(doc.createNode(`clump_${'abcde'[i]}`).setMesh(mesh));
  console.log(key, 'trojúhelníků', I.length / 3);
}
await MeshoptSimplifier.ready;
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: Number(process.env.ERR ?? 0.03), lockBorder: false }));
for (const mesh of doc.getRoot().listMeshes()) {
  const p = mesh.listPrimitives()[0];
  console.log(mesh.getName(), 'po zjednodušení', p.getIndices().getCount() / 3);
}
await MeshoptEncoder.ready;
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
writeFileSync('public/models/grass/grass_clumps.glb', await io.writeBinary(doc));
// Textura: barva suchých stébel + alfa z masky, 512 px (stébla jsou tenká, víc není na dálku vidět).
execFileSync('python3', ['-I', '-c', `
from PIL import Image
d=Image.open('${texDir}/grass_medium_02_dry_diff_1k.png').convert('RGB')
a=Image.open('${texDir}/grass_medium_02_alpha_1k.png').convert('I').point(lambda v: v * (1 / 257)).convert('L')
d.putalpha(a); d=d.resize((512,512), Image.LANCZOS); d.save('public/textures/grass/grass_dry.png', optimize=True)
`]);
console.log('hotovo: public/models/grass/grass_clumps.glb, public/textures/grass/grass_dry.png');
