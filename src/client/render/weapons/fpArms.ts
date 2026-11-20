import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { isMenMesh, mannequinSource } from '../soldier/mannequin';
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
    // Tělo z „Animated Men“ se pro vlastní pohled nepoužívá (ruce bez prstů) – jen Mannequin.
    const men: THREE.Object3D[] = [];
    scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && isMenMesh(o as THREE.Mesh) && men.push(o));
    for (const o of men) o.removeFromParent();
    // Geometrie: jen trojúhelníky paží; skupina 0 = rukáv, 1 = ruka (rukavice).
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.geometry = armsOnly(m.geometry, m.skeleton, new THREE.Color(gloveColor));
      thickenArms(m.geometry, m.skeleton, m.bindMatrix);
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
      let shoulder = space.localToWorld((side.s === 'r' ? shoulders.r : shoulders.l).clone());
      const pole = space.localToWorld((side.s === 'r' ? elbows.r : elbows.l).clone());
      // Dvoukloubová IK: loket v rovině rameno–zápěstí–pól.
      const a = side.lenUpper, b = side.lenLower;
      let toW = fr.wrist.clone().sub(shoulder);
      // Úchop dál, než paže dosáhne (levá ruka na předpažbí dlouhé pušky): rameno (mimo záběr) se
      // posune za rukou. Jinak by ruka stála na úchopu a kůže mezi předloktím a dlaní se natáhla
      // do tenkého „krčku“.
      const reach = (a + b) * 0.97;
      if (toW.length() > reach) {
        shoulder = fr.wrist.clone().addScaledVector(toW.normalize(), -reach);
        toW = fr.wrist.clone().sub(shoulder);
      }
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

/**
 * Mannequin má štíhlé paže; v první osobě s rukávem a výstrojí působily nepřirozeně hubeně.
 * Vrcholy rukávu se odsunou od osy kosti (předloktí víc, k zápěstí méně, nadloktí méně),
 * ruka a prsty zůstanou. Počítá se v klidové póze (prostor po bindMatrix).
 */
const THICKEN = { lower: 0.28, upper: 0.15, wrist: 0.3 };
function thickenArms(g: THREE.BufferGeometry, sk: THREE.Skeleton, bind: THREE.Matrix4) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const at = (name: string) => {
    const i = sk.bones.findIndex((b) => b.name === name);
    return i < 0 ? null : { i, p: new THREE.Vector3().setFromMatrixPosition(sk.boneInverses[i].clone().invert()) };
  };
  const bindInv = bind.clone().invert();
  for (const s of ['l', 'r']) {
    const up = at(`upperarm_${s}`), lo = at(`lowerarm_${s}`), hd = at(`hand_${s}`), mid = at(`middle_01_${s}`);
    if (!up || !lo || !hd) continue;
    const segs: Array<{ bone: number; a: THREE.Vector3; b: THREE.Vector3; k: number; taper: number; only?: number }> = [
      { bone: lo.i, a: lo.p, b: hd.p, k: THICKEN.lower, taper: 0.3 },
      { bone: up.i, a: up.p, b: lo.p, k: THICKEN.upper, taper: 0 },
    ];
    // Zápěstí: část ruky před dlaní je navázaná na kost ruky, která se pro úchop zmenšuje
    // (HAND_SCALE) – bez rozšíření zůstal mezi rukávem a dlaní tenký „krček“. Dlaň a prsty beze změny.
    if (mid) {
      const dir = mid.p.clone().sub(hd.p);
      segs.push({ bone: hd.i, a: hd.p.clone().addScaledVector(dir, -0.6), b: hd.p.clone().addScaledVector(dir, 0.35), k: THICKEN.wrist, taper: 1, only: 0.35 });
    }
    const v = new THREE.Vector3(), ab = new THREE.Vector3(), c = new THREE.Vector3();
    for (let n = 0; n < pos.count; n++) {
      let dx = 0, dy = 0, dz = 0, moved = false;
      v.fromBufferAttribute(pos, n).applyMatrix4(bind);
      for (const sg of segs) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(n, k) === sg.bone) w += sw.getComponent(n, k);
        if (w <= 0) continue;
        ab.subVectors(sg.b, sg.a);
        const raw = c.subVectors(v, sg.a).dot(ab) / ab.lengthSq();
        // Segment zápěstí: jen vrcholy na úseku (dál k prstům = dlaň, ta zůstává).
        if (sg.only !== undefined && raw > 1) continue;
        const t = THREE.MathUtils.clamp(raw, 0, 1);
        c.copy(sg.a).addScaledVector(ab, t);
        const f = sg.k * (1 - sg.taper * t) * w;
        dx += (v.x - c.x) * f;
        dy += (v.y - c.y) * f;
        dz += (v.z - c.z) * f;
        moved = true;
      }
      if (!moved) continue;
      v.set(v.x + dx, v.y + dy, v.z + dz).applyMatrix4(bindInv);
      pos.setXYZ(n, v.x, v.y, v.z);
    }
  }
  // Normály se nepřepočítávají: radiální rozšíření jejich směr zachová (přepočet by dal hranaté plochy).
  pos.needsUpdate = true;
  g.computeBoundingSphere();
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
  // Váhy jen na kosti paží: klíční kost a trup v FP stojí v klidové póze vysoko nad kamerou –
  // vrcholy s částí váhy na nich se natahovaly přes obraz (míhající se kus rukávu při sprintu).
  const oi = out.getAttribute('skinIndex') as THREE.BufferAttribute, ow = out.getAttribute('skinWeight') as THREE.BufferAttribute;
  for (let v = 0; v < order.length; v++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      if (!ARM.test(sk.bones[oi.getComponent(v, k)]?.name ?? '')) ow.setComponent(v, k, 0);
      sum += ow.getComponent(v, k);
    }
    if (sum > 0) for (let k = 0; k < 4; k++) ow.setComponent(v, k, ow.getComponent(v, k) / sum);
  }
  out.addGroup(0, sleeve.length, 0);
  out.addGroup(sleeve.length, hand.length, 1);
  out.computeBoundingSphere();
  return out;
}
