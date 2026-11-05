import * as THREE from 'three';

/**
 * Společná kostra vojáka (USMC i MEC, všechny role): 20 deformujících kostí, metry, Y nahoru,
 * postava hledí k −Z. Klidová póza „I“ (paže podél těla) – končetiny míří k −Y, takže tělo lze
 * stavět ze svislých profilů. Výška ~1,80 m s pokrývkou hlavy.
 */
export const BONES = [
  'root', 'pelvis', 'spine1', 'spine2', 'neck', 'head',
  'clavL', 'upperArmL', 'lowerArmL', 'handL',
  'clavR', 'upperArmR', 'lowerArmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

/** Rodič a poloha vůči rodiči v klidové póze. */
const DEF: Record<BoneName, [BoneName | null, [number, number, number]]> = {
  root: [null, [0, 0, 0]],
  pelvis: ['root', [0, 0.96, 0]],
  spine1: ['pelvis', [0, 0.12, 0]],
  spine2: ['spine1', [0, 0.16, 0]],
  neck: ['spine2', [0, 0.2, 0]],
  head: ['neck', [0, 0.09, 0]],
  clavL: ['spine2', [-0.03, 0.15, 0]],
  upperArmL: ['clavL', [-0.16, 0, 0]],
  lowerArmL: ['upperArmL', [0, -0.28, 0]],
  handL: ['lowerArmL', [0, -0.25, 0]],
  clavR: ['spine2', [0.03, 0.15, 0]],
  upperArmR: ['clavR', [0.16, 0, 0]],
  lowerArmR: ['upperArmR', [0, -0.28, 0]],
  handR: ['lowerArmR', [0, -0.25, 0]],
  thighL: ['pelvis', [-0.095, -0.06, 0]],
  shinL: ['thighL', [0, -0.43, 0]],
  footL: ['shinL', [0, -0.4, 0]],
  thighR: ['pelvis', [0.095, -0.06, 0]],
  shinR: ['thighR', [0, -0.43, 0]],
  footR: ['shinR', [0, -0.4, 0]],
};

export const UPPER_ARM = 0.28;
export const LOWER_ARM = 0.25;
export const THIGH = 0.43;
export const SHIN = 0.4;

/** Absolutní klidová poloha kosti (pro stavbu geometrie). */
export function restPosition(b: BoneName): THREE.Vector3 {
  const v = new THREE.Vector3();
  let cur: BoneName | null = b;
  while (cur) {
    const [parent, off]: [BoneName | null, [number, number, number]] = DEF[cur];
    v.add(new THREE.Vector3(...off));
    cur = parent;
  }
  return v;
}

export function boneParent(b: BoneName): BoneName | null {
  return DEF[b][0];
}

/** Nová instance kostry (každý voják má vlastní; geometrie se sdílí). */
export function createSkeleton(): { bones: THREE.Bone[]; byName: Record<BoneName, THREE.Bone>; skeleton: THREE.Skeleton } {
  const bones = BONES.map((n) => {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(...DEF[n][1]);
    return b;
  });
  const byName = Object.fromEntries(BONES.map((n, i) => [n, bones[i]])) as Record<BoneName, THREE.Bone>;
  for (const n of BONES) {
    const p = DEF[n][0];
    if (p) byName[p].add(byName[n]);
  }
  bones[0].updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { bones, byName, skeleton };
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Natočí kost tak, aby její osa (klidově −Y) mířila ve světě směrem `dir`, s rolí kolem osy
 * podle `twistRef` (směr, kam má mířit lokální +Z/vpřed). Rodič musí mít aktuální matici.
 */
export function aimBone(bone: THREE.Bone, dir: THREE.Vector3, twistRef?: THREE.Vector3) {
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(_q2) : _q2.identity();
  const d = _v.copy(dir).normalize();
  const world = new THREE.Quaternion().setFromUnitVectors(DOWN, d);
  if (twistRef) {
    // Otočit kolem osy kosti tak, aby lokální −Z (vpřed) šlo co nejblíž k twistRef.
    const fwd = _v2.set(0, 0, -1).applyQuaternion(world);
    const ref = twistRef.clone().addScaledVector(d, -twistRef.dot(d));
    if (ref.lengthSq() > 1e-8) {
      ref.normalize();
      fwd.addScaledVector(d, -fwd.dot(d)).normalize();
      let ang = Math.acos(THREE.MathUtils.clamp(fwd.dot(ref), -1, 1));
      if (new THREE.Vector3().crossVectors(fwd, ref).dot(d) < 0) ang = -ang;
      world.premultiply(_q.setFromAxisAngle(d, ang));
    }
  }
  bone.quaternion.copy(parentQ.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

/**
 * Dvoukostní IK (paže / noha): kořen v poloze kosti `a`, cíl konce kosti `b` (= poloha dítěte),
 * ohyb ve směru `pole`. Délky segmentů l1, l2. Výsledek: natočené kosti a, b (svět).
 */
export function solveTwoBone(a: THREE.Bone, b: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, l1: number, l2: number, twistRef?: THREE.Vector3) {
  const root = a.getWorldPosition(new THREE.Vector3());
  const toT = target.clone().sub(root);
  let d = toT.length();
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) {
    toT.multiplyScalar(maxD / d);
    d = maxD;
  }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  const dir = toT.clone().normalize();
  // Úhel v kořeni podle kosinové věty; rovina ohybu daná pólem.
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, -1).addScaledVector(dir, -dir.z);
  bend.normalize();
  const elbow = root.clone().addScaledVector(dir, cosA * l1).addScaledVector(bend, sinA * l1);
  aimBone(a, elbow.clone().sub(root), twistRef ?? bend);
  const end = root.clone().addScaledVector(dir, d);
  aimBone(b, end.sub(elbow), twistRef ?? bend);
}
