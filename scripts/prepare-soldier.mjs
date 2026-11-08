/**
 * Připraví model vojáka z Quaternius „Universal Animation Library [Standard]“ (CC0):
 * ponechá jen klipy, které hra používá, odstraní nepoužitá data a zkvantuje geometrii.
 * Použití: node scripts/prepare-soldier.mjs <cesta/UAL1_Standard.glb> public/models/soldier/ual_soldier.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const KEEP = new Set([
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
  'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Death01', 'Hit_Chest',
]);
const [src, out] = process.argv.slice(2);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const FINGER = /^(index|middle|ring|pinky|thumb)_|_leaf_/;
for (const a of doc.getRoot().listAnimations()) {
  if (!KEEP.has(a.getName())) {
    a.dispose();
    continue;
  }
  // Prsty tvaruje hra podle úchopu zbraně; měřítko kostí se nemění → stopy pryč (menší soubor).
  for (const ch of a.listChannels()) {
    const node = ch.getTargetNode();
    if (ch.getTargetPath() === 'scale' || (node && FINGER.test(node.getName()))) {
      ch.getSampler()?.dispose();
      ch.dispose();
    }
  }
}
await doc.transform(resample({ tolerance: 0.002 }), prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
console.log('hotovo', out, doc.getRoot().listAnimations().map((a) => a.getName()).join(', '));
