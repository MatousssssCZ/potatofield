import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mannequinSource } from '../soldier/mannequin';
import type { Hand } from './hands';

/**
 * Paže v první osobě z modelu Quaternius Mannequin (CC0) – stejné tělo jako vzdálení vojáci.
 * Kreslí se jen paže (rameno → prsty). Zápěstí, natočení dlaně a ohyb prstů přebírají
 * z procedurálního rigu rukou (ten zná úchopy rukojeti, předpažbí, zásobníku i páky);
 * rameno a loket dopočítá dvoukloubová IK s loktem dole a vně (mimo obraz).
 */
const ARM = /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/;
const HANDISH = /^(hand|index|middle|ring|pinky|thumb)_/;
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
const HAND_SCALE = 0.75;
/**
 * Palce v úchopu (lokální rotace článků 1–3) z klipu „Pistol_Idle_Loop“ knihovny UAL (CC0):
 * pravý obepíná rukojeť a míří podél rámu dopředu, levý (podpůrný) leží vpředu natažený.
 * Ohyb palce kolem jedné osy jako u prstů dával palec mířící dozadu.
 */
const THUMB_GRIP: Record<'l' | 'r', [number, number, number, number][]> = {
  r: [[-0.3862, 0.9156, 0.1121, 0.0019], [0.2349, -0.1373, 0.2252, 0.9355], [0.4778, 0.0002, 0.0005, 0.8785]],
  l: [[0.2474, 0.9458, 0.2034, 0.0536], [-0.0001, -0.0001, 0, 1], [0.0002, 0.0001, -0.0005, 1]],
};

interface Side {
  s: 'l' | 'r';
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
  /** Lokální směr prstů a hřbetu kosti ruky (klidová póza). */
  fLocal: THREE.Vector3;
  bLocal: THREE.Vector3;
  fingers: Array<{ bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3 }[]>;
  thumb: { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3 }[];
  lenUpper: number;
  lenLower: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

function basis(f: THREE.Vector3, b: THREE.Vector3): THREE.Quaternion {
  const x = f.clone().normalize();
  const y = b.clone().sub(x.clone().multiplyScalar(b.dot(x))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
}

/** Nastaví světovou rotaci (a volitelně polohu) kosti přes inverzi rodiče. */
function setWorld(bone: THREE.Bone, q: THREE.Quaternion, pos?: THREE.Vector3) {
  const parent = bone.parent!;
  parent.updateWorldMatrix(true, false);
  parent.getWorldQuaternion(_q);
  bone.quaternion.copy(_q.invert().multiply(q));
  if (pos) bone.position.copy(parent.worldToLocal(pos.clone()));
  bone.updateMatrixWorld(true);
}

export class FPArms {
  readonly root = new THREE.Group();
  private sides: Side[] = [];

  /** `sleeve` a `glove` = materiály rukávu a rukavice (stejné jako u procedurálních rukou). */
  constructor(sleeve: THREE.Material, glove: THREE.Material, gloveColor: THREE.ColorRepresentation) {
    const src = mannequinSource()!;
    const scene = cloneSkinned(src);
    this.root.add(scene);
    const bones = new Map<string, THREE.Bone>();
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    });
    // Geometrie: jen trojúhelníky paží; skupina 0 = rukáv, 1 = ruka (rukavice).
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.geometry = armsOnly(m.geometry, m.skeleton, new THREE.Color(gloveColor));
      m.material = [sleeve, glove];
      m.frustumCulled = false;
      m.castShadow = false;
    });
    scene.updateMatrixWorld(true);
    for (const s of ['l', 'r'] as const) {
      const B = (n: string) => bones.get(`${n}_${s}`)!;
      const hand = B('hand');
      const wq = hand.getWorldQuaternion(new THREE.Quaternion());
      const hp = hand.getWorldPosition(new THREE.Vector3());
      // T-póza: prsty vodorovně ven, dlaň dolů (hřbet +Y).
      const fWorld = B('middle_01').getWorldPosition(new THREE.Vector3()).sub(hp).normalize();
      const inv = wq.clone().invert();
      const mk = (name: string) => {
        const bone = bones.get(name)!;
        const child = bone.children.find((c) => (c as THREE.Bone).isBone);
        const p0 = bone.getWorldPosition(new THREE.Vector3());
        const dir = child ? child.getWorldPosition(new THREE.Vector3()).sub(p0).normalize() : fWorld.clone();
        // Osa ohybu: k dlani (−hřbet) → osa = hřbet × směr článku, v lokálním prostoru kosti.
        const axisW = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
        const bq = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
        return { bone, rest: bone.quaternion.clone(), axis: axisW.applyQuaternion(bq).normalize() };
      };
      // Ruka Mannequinu (dlaň 12 cm) je větší než rig úchopů (8,8 cm) – zmenšit, ať prsty obejmou rukojeť.
      hand.scale.setScalar(HAND_SCALE);
      this.sides.push({
        s,
        upper: B('upperarm'),
        lower: B('lowerarm'),
        hand,
        fLocal: fWorld.clone().applyQuaternion(inv),
        bLocal: new THREE.Vector3(0, 1, 0).applyQuaternion(inv),
        fingers: FINGERS.map((f) => [1, 2, 3].map((k) => mk(`${f}_0${k}_${s}`))),
        thumb: [1, 2, 3].map((k) => mk(`thumb_0${k}_${s}`)),
        lenUpper: B('lowerarm').position.length(),
        lenLower: hand.position.length(),
      });
    }
  }

  /**
   * Snímek: ruce (`right`, `left`) už stojí na úchopech; `space` = rodič paží (prezentace),
   * ramena a lokty jsou v jeho souřadnicích.
   */
  update(right: Hand, left: Hand, space: THREE.Object3D, shoulders: { r: THREE.Vector3; l: THREE.Vector3 }, elbows: { r: THREE.Vector3; l: THREE.Vector3 }) {
    space.updateWorldMatrix(true, false);
    for (const side of this.sides) {
      const h = side.s === 'r' ? right : left;
      const fr = h.frame();
      const shoulder = space.localToWorld((side.s === 'r' ? shoulders.r : shoulders.l).clone());
      const pole = space.localToWorld((side.s === 'r' ? elbows.r : elbows.l).clone());
      // Dvoukloubová IK: loket v rovině rameno–zápěstí–pól.
      const a = side.lenUpper, b = side.lenLower;
      const toW = fr.wrist.clone().sub(shoulder);
      const d = Math.min(toW.length(), (a + b) * 0.999);
      const dir = toW.clone().normalize();
      const cosA = (a * a + d * d - b * b) / (2 * a * d);
      const along = a * cosA, up = Math.sqrt(Math.max(0, a * a - along * along));
      const pv = pole.clone().sub(shoulder);
      const perp = pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
      const elbow = shoulder.clone().add(dir.clone().multiplyScalar(along)).add(perp.multiplyScalar(up));
      // Paže: osa kosti k dítěti → mířit na cíl (minimální rotace z klidu kosti).
      this.aim(side.upper, side.lower, elbow, shoulder);
      this.aim(side.lower, side.hand, fr.wrist);
      // Ruka: prsty a hřbet z rigu, poloha = zápěstí.
      const target = basis(fr.fingers, fr.back).multiply(basis(side.fLocal, side.bLocal).invert());
      setWorld(side.hand, target, fr.wrist);
      // Prsty a palec.
      const c = h.curls();
      side.fingers.forEach((chain, fi) => chain.forEach((j, k) => j.bone.quaternion.copy(j.rest).multiply(_q.setFromAxisAngle(j.axis, c.fingers[fi][k] ?? 0))));
      // Palec: úchop z klipu (viz THUMB_GRIP).
      side.thumb.forEach((j, k) => j.bone.quaternion.fromArray(THUMB_GRIP[side.s][k]));
    }
  }

  /** Natočí kost tak, aby mířila (ke svému dítěti) na bod `to`; `from` = nová poloha kořene. */
  private aim(bone: THREE.Bone, child: THREE.Object3D, to: THREE.Vector3, from?: THREE.Vector3) {
    if (from) {
      bone.parent!.updateWorldMatrix(true, false);
      bone.position.copy(bone.parent!.worldToLocal(from.clone()));
    }
    bone.updateMatrixWorld(true);
    const p0 = bone.getWorldPosition(new THREE.Vector3());
    const cur = child.getWorldPosition(new THREE.Vector3()).sub(p0).normalize();
    const want = to.clone().sub(p0).normalize();
    const wq = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromUnitVectors(cur, want));
    setWorld(bone, wq);
  }

  dispose() {
    this.root.removeFromParent();
  }
}

/** Geometrie jen s trojúhelníky paží (dominantní kost), rozdělená na rukáv a ruku. */
function armsOnly(src: THREE.BufferGeometry, sk: THREE.Skeleton, gloveColor: THREE.Color): THREE.BufferGeometry {
  const g0 = src.index ? src.toNonIndexed() : src;
  const si = g0.getAttribute('skinIndex'), sw = g0.getAttribute('skinWeight');
  const sleeve: number[] = [], hand: number[] = [];
  for (let i = 0; i < g0.getAttribute('position').count; i += 3) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) {
      bw = sw.getComponent(i, k);
      best = si.getComponent(i, k);
    }
    const name = sk.bones[best]?.name ?? '';
    if (!ARM.test(name)) continue;
    (HANDISH.test(name) ? hand : sleeve).push(i, i + 1, i + 2);
  }
  const order = [...sleeve, ...hand];
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g0.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const arr = new Float32Array(order.length * a.itemSize);
    // Kvantované atributy (meshopt) → přes getX/Y/Z/W, které hodnoty denormalizují.
    const get = [a.getX, a.getY, a.getZ, a.getW];
    order.forEach((v, j) => {
      for (let c = 0; c < a.itemSize; c++) arr[j * a.itemSize + c] = get[c].call(a, v);
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  // Barvy vrcholů: rukáv bílý (barvu dává kamufláž materiálu), ruka barvou rukavice / kůže.
  const col = new Float32Array(order.length * 3).fill(1);
  for (let j = sleeve.length; j < order.length; j++) col.set([gloveColor.r, gloveColor.g, gloveColor.b], j * 3);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(order.length * 2), 2));
  out.addGroup(0, sleeve.length, 0);
  out.addGroup(sleeve.length, hand.length, 1);
  out.computeBoundingSphere();
  return out;
}
