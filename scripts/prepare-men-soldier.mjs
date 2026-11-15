/**
 * Převázání těla z Quaternius „Animated Men Characters“ (CC0, FBX) na kostru UAL Mannequinu,
 * kterou hra animuje (klipy + procedurální retarget). Výsledek = původní ual_soldier.glb + nový
 * skinovaný mesh „MenBody“ (2 primitiva: látka uniformy, zbytek s barvou vrcholů).
 *
 * Postup: tělo se zmenší na výšku Mannequinu, paže UAL se natočí do klidové pózy postavy (A-póza),
 * každý vrchol se přenese po segmentech kostí (počátek, směr, délka) z kostry postavy na kostru UAL
 * a váhy se přemapují na kosti UAL. Proporce se tím přizpůsobí Mannequinu (delší nohy, kratší trup).
 *
 * Použití: node scripts/prepare-men-soldier.mjs <Male_LongSleeve.fbx> assets-src/soldier/ual_soldier.glb <výstup.glb>
 */
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// FBXLoader a GLTFLoader běží v Node s minimálními náhradami prohlížeče (bez textur).
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }) };
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder: ThreeMeshopt } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');

const [fbxPath, ualPath, outPath] = process.argv.slice(2);
const ab = (p) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

// --- Zdroje ---
const men = new FBXLoader().parse(ab(fbxPath), '');
men.updateMatrixWorld(true);
const menMesh = (() => {
  let m = null;
  men.traverse((o) => o.isSkinnedMesh && (m = o));
  return m;
})();
const gl = new GLTFLoader();
gl.setMeshoptDecoder(ThreeMeshopt);
const ual = await new Promise((res, rej) => gl.parse(ab(ualPath), '', res, rej));
ual.scene.updateMatrixWorld(true);
const U = (n) => {
  const b = ual.scene.getObjectByName(n);
  if (!b) throw new Error(`UAL kost ${n} chybí`);
  return b;
};
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

// --- Měřítko a posun postavy do prostoru UAL (metry, chodidla na y = 0, hledí k +Z) ---
const M = (n) => {
  const b = men.getObjectByName(n);
  if (!b) throw new Error(`Kost postavy ${n} chybí`);
  return b;
};
const s = wp(U('neck_01')).y / wp(M('Neck')).y;
const hipsM = wp(M('Hips')), pelvis = wp(U('pelvis'));
const off = new THREE.Vector3(pelvis.x - hipsM.x * s, 0, pelvis.z - hipsM.z * s);
const toU = (v) => v.clone().multiplyScalar(s).add(off);
const MP = (n) => toU(wp(M(n)));

// --- Póza UAL: paže do směru paží postavy (vazba se počítá v této póze) ---
const aim = (bone, child, dir) => {
  const b = U(bone);
  const cur = wp(U(child)).sub(wp(b)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
  const wq = b.getWorldQuaternion(new THREE.Quaternion());
  const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
  b.updateMatrixWorld(true);
};
for (const sd of ['L', 'R']) {
  const l = sd.toLowerCase();
  aim(`upperarm_${l}`, `lowerarm_${l}`, MP(`LowerArm${sd}`).sub(MP(`UpperArm${sd}`)));
  aim(`lowerarm_${l}`, `hand_${l}`, MP(`Palm${sd}`).sub(MP(`LowerArm${sd}`)));
  aim(`hand_${l}`, `middle_01_${l}`, MP(`Fingers${sd}_end`).sub(MP(`Palm${sd}`)));
}
ual.scene.updateMatrixWorld(true);
const UP = (n) => wp(U(n));

// --- Segmenty: kost postavy → kost UAL (váhy) a odpovídající úsečky (počátek, konec) ---
const seg = {};
const def = (menBones, ualBone, mo, mc, uo, uc, opts = {}) => {
  opts.girth ??= opts.scale ?? 1;
  for (const n of menBones) seg[n] = { ualBone, mo, mc, uo, uc, ...opts };
};
def(['Bone', 'Body', 'Hips', 'PoleTargetL', 'PoleTargetR'], 'pelvis', MP('Hips'), MP('Abdomen'), UP('pelvis'), UP('spine_01'));
def(['Abdomen'], 'spine_01', MP('Abdomen'), MP('Torso'), UP('spine_01'), UP('spine_03'));
def(['Torso'], 'spine_03', MP('Torso'), MP('Neck'), UP('spine_03'), UP('neck_01'));
def(['Neck'], 'neck_01', MP('Neck'), MP('Head'), UP('neck_01'), UP('Head'));
{
  const ho = MP('Head'), hc = MP('Head_end');
  // Hlava o něco menší (kreslené proporce), ať sedí pod helmou výstroje.
  def(['Head', 'Head_end'], 'Head', ho, hc, UP('Head'), UP('Head').add(hc.clone().sub(ho)), { scale: 0.86 });
}
for (const sd of ['L', 'R']) {
  const l = sd.toLowerCase();
  def([`Shoulder${sd}`], `clavicle_${l}`, MP(`Shoulder${sd}`), MP(`UpperArm${sd}`), UP(`clavicle_${l}`), UP(`upperarm_${l}`));
  def([`UpperArm${sd}`], `upperarm_${l}`, MP(`UpperArm${sd}`), MP(`LowerArm${sd}`), UP(`upperarm_${l}`), UP(`lowerarm_${l}`));
  def([`LowerArm${sd}`], `lowerarm_${l}`, MP(`LowerArm${sd}`), MP(`Palm${sd}`), UP(`lowerarm_${l}`), UP(`hand_${l}`));
  // Ruka: tuhý přenos (stejná velikost), směr už sladěn pózou.
  const po = MP(`Palm${sd}`), pc = MP(`Fingers${sd}_end`);
  // Ruka je u kreslené postavy velká (~21 cm) – zmenšit; obarví se jako rukavice.
  def([`Palm${sd}`, `MiddleHand${sd}`, `Fingers${sd}`, `Fingers${sd}_end`, `Thumb1${sd}`, `Thumb2${sd}`, `Thumb2${sd}_end`], `hand_${l}`, po, pc, UP(`hand_${l}`), UP(`hand_${l}`).add(pc.clone().sub(po)), { scale: 0.72, glove: true });
  // Nohy se natahují na delší kosti UAL – mírně zesílit, ať nepůsobí vychrtle.
  def([`UpperLeg${sd}`], `thigh_${l}`, MP(`UpperLeg${sd}`), MP(`LowerLeg${sd}`), UP(`thigh_${l}`), UP(`calf_${l}`), { girth: 1.18 });
  // Holeň postavy končí u země; na UAL se natáhne ke kotníku promítnutému na zem.
  const ank = UP(`foot_${l}`);
  def([`LowerLeg${sd}`, `LowerLeg${sd}_end`], `calf_${l}`, MP(`LowerLeg${sd}`), MP(`LowerLeg${sd}_end`), UP(`calf_${l}`), new THREE.Vector3(ank.x, MP(`LowerLeg${sd}_end`).y, ank.z), { girth: 1.12 });
  // Chodidlo: jen vodorovný posun (bota zůstává na zemi).
  def([`Foot${sd}`, `Foot${sd}_end`], `foot_${l}`, MP(`Foot${sd}`), null, new THREE.Vector3(ank.x, MP(`Foot${sd}`).y, ank.z), null, { shift: true });
}

/** Rám úsečky: osa Y podél kosti, X/Z doplněné podle stejného pravidla u obou koster. */
const frame = (o, c) => {
  const y = c.clone().sub(o).normalize();
  const ref = Math.abs(y.y) > 0.7 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(y, ref).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z);
};
for (const k of Object.keys(seg)) {
  const g = seg[k];
  if (g.shift) continue;
  const Rm = frame(g.mo, g.mc), Ru = frame(g.uo, g.uc);
  g.ratio = (g.uc.distanceTo(g.uo) / Math.max(1e-6, g.mc.distanceTo(g.mo))) * (g.scale ?? 1);
  g.RmT = Rm.clone().transpose();
  g.Ru = Ru;
}
const mapPoint = (g, v) => {
  if (g.shift) return v.clone().sub(g.mo).add(g.uo);
  const l = v.clone().sub(g.mo).applyMatrix4(g.RmT);
  l.y *= g.ratio;
  l.x *= g.girth;
  l.z *= g.girth;
  return l.applyMatrix4(g.Ru).add(g.uo);
};
const mapDir = (g, n) => (g.shift ? n.clone() : n.clone().applyMatrix4(g.RmT).applyMatrix4(g.Ru));

// --- Přenos vrcholů ---
const geo = menMesh.geometry;
const pos = geo.attributes.position, nor = geo.attributes.normal, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
const menBones = menMesh.skeleton.bones.map((b) => b.name);
const ualJoints = (() => {
  let m = null;
  ual.scene.traverse((o) => o.isSkinnedMesh && !m && (m = o));
  return m.skeleton.bones;
})();
const jIndex = new Map(ualJoints.map((b, i) => [b.name, i]));
const nmat = new THREE.Matrix3().getNormalMatrix(menMesh.matrixWorld);
const mats = [].concat(menMesh.material).map((m) => m.name);
const CLOTH = new Set(['Shirt', 'Pants']);
const GLOVE = '#4f4434';
const COLORS = { Skin: '#a8896f', Eyes: '#141414', Hair: '#2a211b', Socks: '#4a3f30', Shoes: '#3a3229', Shirt: '#ffffff', Pants: '#ffffff' };
const out = { cloth: { p: [], n: [], j: [], w: [], c: [] }, rest: { p: [], n: [], j: [], w: [], c: [] } };
const matOfVertex = new Array(pos.count).fill(0);
for (const gr of geo.groups) for (let i = gr.start; i < gr.start + gr.count; i++) matOfVertex[i] = gr.materialIndex;
const unknown = new Set();
const v = new THREE.Vector3(), n = new THREE.Vector3();
for (let i = 0; i < pos.count; i++) {
  menMesh.getVertexPosition(i, v);
  menMesh.localToWorld(v);
  const vw = toU(v);
  n.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize();
  const acc = new THREE.Vector3(), accN = new THREE.Vector3();
  const wts = new Map();
  let tot = 0;
  for (let k = 0; k < 4; k++) {
    const w = sw.getComponent(i, k);
    if (w <= 0) continue;
    const name = menBones[si.getComponent(i, k)];
    const g = seg[name];
    if (!g) {
      unknown.add(name);
      continue;
    }
    acc.addScaledVector(mapPoint(g, vw), w);
    accN.addScaledVector(mapDir(g, n), w);
    const j = jIndex.get(g.ualBone);
    wts.set(j, (wts.get(j) ?? 0) + w);
    tot += w;
  }
  acc.multiplyScalar(1 / tot);
  accN.normalize();
  const name = mats[matOfVertex[i]];
  // Ruka (převažující kost ruky) = rukavice.
  let top = 0, topName = '';
  for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > top) [top, topName] = [sw.getComponent(i, k), menBones[si.getComponent(i, k)]];
  const glove = name === 'Skin' && seg[topName]?.glove;
  const t = CLOTH.has(name) ? out.cloth : out.rest;
  t.p.push(acc.x, acc.y, acc.z);
  t.n.push(accN.x, accN.y, accN.z);
  const ws = [...wts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const ssum = ws.reduce((a, b) => a + b[1], 0);
  for (let k = 0; k < 4; k++) {
    t.j.push(ws[k] ? ws[k][0] : 0);
    t.w.push(ws[k] ? ws[k][1] / ssum : 0);
  }
  const col = new THREE.Color(glove ? GLOVE : (COLORS[name] ?? '#ff00ff')).convertSRGBToLinear();
  t.c.push(col.r, col.g, col.b);
}
if (unknown.size) console.log('kosti bez přiřazení (váha zahozena):', [...unknown].join(', '));

// Vazba: inverze světových matic kloubů UAL v póze výše.
const ibm = new Float32Array(ualJoints.length * 16);
ualJoints.forEach((b, i) => ibm.set(b.matrixWorld.clone().invert().elements, i * 16));

// --- Zápis do dokumentu UAL ---
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(ualPath);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const oldSkin = root.listSkins()[0];
const jointNodes = oldSkin.listJoints();
if (jointNodes.map((j) => j.getName()).join() !== ualJoints.map((b) => b.name).join()) throw new Error('pořadí kloubů se liší');
const skin = doc.createSkin('MenSkin').setSkeleton(oldSkin.getSkeleton());
for (const j of jointNodes) skin.addJoint(j);
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
const mesh = doc.createMesh('MenBody');
for (const [key, t] of Object.entries(out)) {
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(t.p)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(t.n)))
    .setAttribute('JOINTS_0', acc('VEC4', new Uint8Array(t.j)))
    .setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(t.w)));
  if (key === 'rest') prim.setAttribute('COLOR_0', acc('VEC3', new Float32Array(t.c)));
  // Rozdílná drsnost: jinak by dedup() oba materiály sloučil a hra by je nerozlišila.
  prim.setMaterial(doc.createMaterial(key === 'cloth' ? 'Men_Cloth' : 'Men_Rest').setRoughnessFactor(key === 'cloth' ? 0.9 : 0.85).setMetallicFactor(0));
  mesh.addPrimitive(prim);
  console.log(key, 'trojúhelníky', t.p.length / 9);
}
const node = doc.createNode('MenBody').setMesh(mesh).setSkin(skin);
const armature = root.listNodes().find((x) => x.getName() === 'Armature');
armature.addChild(node);
await doc.transform(prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(outPath, doc);
console.log('hotovo', outPath, 'měřítko', s.toFixed(5));
