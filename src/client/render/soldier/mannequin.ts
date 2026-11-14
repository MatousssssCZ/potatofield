import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BoneName } from './rig';
import type { SoldierFaction } from './body';

/**
 * Tělo vojáka z Quaternius „Universal Animation Library“ (CC0, Mannequin, 65 kostí).
 *
 * Pohyb řídí náš procedurální animátor (20 kostí: míření, přebití, leh, žebřík, vyřazení);
 * každý snímek se přenese na kostru Mannequinu (retarget po světových rotacích vůči kalibrované
 * klidové póze). Nohy při chůzi a běhu vpřed a ve stoji berou klipy knihovny (Walk, Jog, Sprint,
 * Crouch, Idle), smrt klip Death01. Horní polovina těla je vždy z animátoru (zbraň v rukou).
 * Hitboxy určuje server – vzhled je nemění.
 */

/** Naše kost → kost Mannequinu. */
const MAP: Array<[BoneName, string]> = [
  ['pelvis', 'pelvis'],
  ['spine1', 'spine_01'],
  ['spine2', 'spine_03'],
  ['neck', 'neck_01'],
  ['head', 'Head'],
  ['clavL', 'clavicle_l'],
  ['upperArmL', 'upperarm_l'],
  ['lowerArmL', 'lowerarm_l'],
  ['handL', 'hand_l'],
  ['clavR', 'clavicle_r'],
  ['upperArmR', 'upperarm_r'],
  ['lowerArmR', 'lowerarm_r'],
  ['handR', 'hand_r'],
  ['thighL', 'thigh_l'],
  ['shinL', 'calf_l'],
  ['footL', 'foot_l'],
  ['thighR', 'thigh_r'],
  ['shinR', 'calf_r'],
  ['footR', 'foot_r'],
];
const LEGS = new Set(['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r']);
/** Kalibrace klidové pózy: segment kosti (kost → dítě) má mířit stejně jako u naší kostry. */
const AIM: Array<[string, string, THREE.Vector3]> = [
  ['upperarm_l', 'lowerarm_l', new THREE.Vector3(0, -1, 0)],
  ['lowerarm_l', 'hand_l', new THREE.Vector3(0, -1, 0)],
  ['hand_l', 'middle_01_l', new THREE.Vector3(0, -1, 0)],
  ['upperarm_r', 'lowerarm_r', new THREE.Vector3(0, -1, 0)],
  ['lowerarm_r', 'hand_r', new THREE.Vector3(0, -1, 0)],
  ['hand_r', 'middle_01_r', new THREE.Vector3(0, -1, 0)],
  ['thigh_l', 'calf_l', new THREE.Vector3(0, -1, 0)],
  ['calf_l', 'foot_l', new THREE.Vector3(0, -1, 0)],
  ['thigh_r', 'calf_r', new THREE.Vector3(0, -1, 0)],
  ['calf_r', 'foot_r', new THREE.Vector3(0, -1, 0)],
];
/** Klip podle stavu nohou. */
type LegClip = 'Idle_Loop' | 'Walk_Loop' | 'Jog_Fwd_Loop' | 'Sprint_Loop' | 'Crouch_Idle_Loop' | 'Crouch_Fwd_Loop' | 'Jump_Loop' | 'Jump_Land';
/** Rychlost (m/s), při které klip běží rychlostí 1. */
const CLIP_SPEED: Record<LegClip, number> = { Idle_Loop: 1, Walk_Loop: 1.4, Jog_Fwd_Loop: 3.4, Sprint_Loop: 5.6, Crouch_Idle_Loop: 1, Crouch_Fwd_Loop: 1.3, Jump_Loop: 1, Jump_Land: 1 };

let source: { scene: THREE.Object3D; clips: THREE.AnimationClip[] } | null = null;

export async function preloadSoldierModel(base = '/'): Promise<void> {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const g = await loader.loadAsync(`${base}models/soldier/ual_soldier.glb`);
    source = { scene: g.scene, clips: g.animations };
  } catch (e) {
    console.warn('Model vojáka se nenačetl, zůstává procedurální tělo.', e);
  }
}

/** Zdrojová scéna Mannequinu (pro paže v první osobě). */
export function mannequinSource() {
  return source?.scene ?? null;
}

export function hasMannequin() {
  return source !== null;
}

/** Barvy uniformy podle frakce (tělo, klouby). */
const LOOK: Record<SoldierFaction, [string, string]> = {
  usmc: ['#a08a64', '#4f4535'],
  mec: ['#6b6a4c', '#34352a'],
};
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function factionMat(f: SoldierFaction, joint: boolean) {
  const k = `${f}:${joint ? 1 : 0}`;
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = new THREE.MeshStandardMaterial({ color: LOOK[f][joint ? 1 : 0], roughness: 0.9, metalness: 0 })));
  return m;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class MannequinBody {
  /** Kořen v prostoru vojáka (skupina vojáka), otočený o 180° (Mannequin hledí k +Z). */
  readonly root = new THREE.Group();
  private bones = new Map<string, THREE.Bone>();
  private calib = new Map<string, THREE.Quaternion>();
  private ourRestPelvis = new THREE.Vector3(0, 0.96, 0);
  private ualRestPelvis = new THREE.Vector3();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private legClip: LegClip | null = null;
  /** Váha klipu na nohou 0–1 (plynulý přechod klip ↔ procedurální nohy). */
  private legW = 0;
  private dead = false;
  private airborne = false;
  private landT = 0;
  private meshes: THREE.SkinnedMesh[] = [];
  private faction: SoldierFaction | null = null;

  constructor(private our: Record<BoneName, THREE.Bone>) {
    const scene = cloneSkinned(source!.scene);
    scene.rotation.y = Math.PI;
    this.root.add(scene);
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
        this.meshes.push(m);
      }
    });
    this.mixer = new THREE.AnimationMixer(scene);
    for (const c of source!.clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.calibrate();
  }

  setFaction(f: SoldierFaction) {
    if (f === this.faction) return;
    this.faction = f;
    for (const m of this.meshes) {
      const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
      m.material = factionMat(f, /Joint/i.test(name));
    }
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  /** Světová rotace kosti v prostoru vojáka (skupiny `space`). */
  private groupQ(o: THREE.Object3D, space: THREE.Object3D, out: THREE.Quaternion) {
    o.getWorldQuaternion(out);
    space.getWorldQuaternion(_q2);
    return out.premultiply(_q2.invert());
  }

  /** Klidová póza Mannequinu sladěná s naší („I“: paže a nohy svisle dolů). */
  private calibrate() {
    const space = this.root;
    space.updateMatrixWorld(true);
    for (const [b, child, dir] of AIM) {
      const bone = this.bones.get(b), c = this.bones.get(child);
      if (!bone || !c) continue;
      space.updateMatrixWorld(true);
      const p0 = space.worldToLocal(bone.getWorldPosition(_v.clone()));
      const p1 = space.worldToLocal(c.getWorldPosition(_v2.clone()));
      const cur = p1.sub(p0).normalize();
      const rot = new THREE.Quaternion().setFromUnitVectors(cur, dir);
      // Světová rotace kosti → otočit o `rot` → zpět do lokální.
      const wq = this.groupQ(bone, space, new THREE.Quaternion()).premultiply(rot);
      const pq = this.groupQ(bone.parent!, space, new THREE.Quaternion());
      bone.quaternion.copy(pq.invert().multiply(wq));
    }
    space.updateMatrixWorld(true);
    for (const [, b] of MAP) {
      const bone = this.bones.get(b);
      if (bone) this.calib.set(b, this.groupQ(bone, space, new THREE.Quaternion()));
    }
    this.ualRestPelvis.copy(space.worldToLocal(this.bones.get('pelvis')!.getWorldPosition(new THREE.Vector3())));
    // Klidová póza kalibrace = výchozí stav pro procedurální přenos.
    for (const b of this.bones.values()) b.userData.calibQ = b.quaternion.clone();
  }

  /**
   * Snímek: `group` = skupina vojáka (naše kostra už nastavená animátorem).
   * `moveSpeed` vodorovná rychlost, `forward` = podíl pohybu vpřed (−1…1), `crouch` 0–1.
   */
  update(dt: number, s: { group: THREE.Object3D; speed: number; forward: number; crouch: number; sprinting: boolean; grounded: boolean; life: 'alive' | 'downed' | 'dead'; prone: boolean; ladder?: boolean; deathClip?: 'normal' | 'fast' | null }) {
    // --- Smrt: klip Death01 (jednou, poslední snímek drží); varianta „fast“ padá rychleji.
    //     Bez klipu (deathClip null) pád řídí procedurální póza animátoru (pád vpřed / vzad). ---
    if (s.life === 'dead' && s.deathClip !== null) {
      if (!this.dead) {
        this.dead = true;
        this.mixer.stopAllAction();
        const a = this.actions.get('Death01');
        if (a) {
          a.reset();
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          a.timeScale = s.deathClip === 'fast' ? 1.5 : 1;
          a.play();
        }
      }
      this.mixer.update(dt);
      return;
    }
    if (this.dead) {
      this.dead = false;
      this.mixer.stopAllAction();
      this.legClip = null;
    }

    // --- Nohy: klip, když jde (nebo stojí) vpřed po zemi; jinak procedurální (úkroky, leh, žebřík). ---
    // Skok: ve vzduchu klip letu, po dopadu krátce klip doskoku.
    const air = s.life === 'alive' && !s.grounded && !s.ladder && !s.prone;
    if (this.airborne && !air && s.grounded) this.landT = 0.28;
    this.airborne = air;
    this.landT = Math.max(0, this.landT - dt);
    // Vpřed i vzad (chůze pozpátku); úkroky řeší natočení pánve v animátoru, takže pohyb je vůči pánvi skoro vždy podélný.
    const useClip = s.life === 'alive' && !s.prone && !s.ladder && (air || (s.grounded && (s.speed < 0.3 || Math.abs(s.forward) > 0.7)));
    let want: LegClip;
    if (air) want = 'Jump_Loop';
    else if (this.landT > 0 && s.speed < 4) want = 'Jump_Land';
    else if (s.crouch > 0.5) want = s.speed < 0.3 ? 'Crouch_Idle_Loop' : 'Crouch_Fwd_Loop';
    else if (s.speed < 0.3) want = 'Idle_Loop';
    else if (s.sprinting) want = 'Sprint_Loop';
    else want = s.speed > 2.4 ? 'Jog_Fwd_Loop' : 'Walk_Loop';
    if (want !== this.legClip) {
      const next = this.actions.get(want);
      const prev = this.legClip ? this.actions.get(this.legClip) : undefined;
      if (next) {
        next.reset().setEffectiveWeight(1).play();
        if (prev) prev.crossFadeTo(next, want === 'Jump_Loop' || want === 'Jump_Land' ? 0.1 : 0.2, false);
      }
      this.legClip = want;
    }
    const act = this.actions.get(want);
    if (act) act.timeScale = want === 'Jump_Loop' || want === 'Jump_Land' || s.speed < 0.3 ? 1 : THREE.MathUtils.clamp(s.speed / CLIP_SPEED[want], 0.5, 1.8) * (s.forward < 0 ? -1 : 1);
    this.legW = THREE.MathUtils.damp(this.legW, useClip ? 1 : 0, 10, dt);

    // Klip nastaví celou kostru; nohy si z něj vezmeme (s vahou), zbytek přepíše přenos.
    this.mixer.update(dt);
    const clipLegs = new Map<string, THREE.Quaternion>();
    if (this.legW > 0.01) for (const b of LEGS) clipLegs.set(b, this.bones.get(b)!.quaternion.clone());

    // --- Přenos z naší kostry (prostor skupiny vojáka). ---
    const space = this.root;
    for (const b of this.bones.values()) b.quaternion.copy(b.userData.calibQ as THREE.Quaternion);
    space.updateMatrixWorld(true);
    for (const [ours, ual] of MAP) {
      const ob = this.our[ours], ub = this.bones.get(ual);
      if (!ob || !ub) continue;
      // Náš klid = jednotková rotace → delta = současná rotace kosti v prostoru vojáka.
      const delta = this.groupQ(ob, s.group, _q);
      const target = delta.multiply(this.calib.get(ual)!);
      const pq = this.groupQ(ub.parent!, space, new THREE.Quaternion());
      ub.quaternion.copy(pq.invert().multiply(target));
      if (clipLegs.size && LEGS.has(ual)) ub.quaternion.slerp(clipLegs.get(ual)!, this.legW);
      ub.updateMatrixWorld(true);
    }
    // Pánev: výška a poloha podle naší kostry (dřep, leh).
    const pelvis = this.bones.get('pelvis')!;
    const ourP = s.group.worldToLocal(this.our.pelvis.getWorldPosition(_v));
    const goal = ourP.add(this.ualRestPelvis).sub(this.ourRestPelvis);
    space.localToWorld(goal);
    pelvis.parent!.worldToLocal(goal);
    pelvis.position.copy(goal);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
