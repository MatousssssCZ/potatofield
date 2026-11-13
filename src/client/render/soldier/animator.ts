import { MOVEMENT } from '../../../shared/config/movement';
import { stanceRecoil } from '../../../shared/sim/weapon';
import * as THREE from 'three';
import { BONES, LOWER_ARM, SHIN, THIGH, UPPER_ARM, aimBone, solveTwoBone, type BoneName } from './rig';
import type { WeaponAction } from '../../../shared/sim/weapon';

/**
 * Procedurální animace vzdáleného vojáka ve vrstvách (žádný root motion – polohu určuje controller):
 * 1. nohy: kroky z cílů chodidel (směr a rychlost z rychlosti, fáze se drží při změně směru),
 *    dřep a leh z výšky těla (stejný průběh jako collider), skok/dopad, přetočení na místě;
 * 2. trup: zamíření (yaw/pitch rozdělené mezi páteř, krk a hlavu), náklon ve sprintu;
 * 3. zbraň a paže: puška opřená o rameno ve směru zamíření, dvoukostní IK obou paží na úchopy,
 *    kopnutí při výstřelu (skládané impulzy), přebití (náklon pušky, levá ruka k šachtě);
 * 4. životní stavy: pád do vyřazené / mrtvé pózy, oživení do dřepu.
 * Všechny časy akcí jdou ze stavu simulace, takže pozdě připojený klient vidí správnou fázi.
 */
export interface AnimInput {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  bodyYaw: number;
  height: number;
  grounded: boolean;
  sprinting: boolean;
  ads: number;
  action: WeaponAction;
  actionStart: number;
  actionEnd: number;
  shotSeq: number;
  life: 'alive' | 'downed' | 'dead';
  lastLandAt?: number;
  /** Variace pádu (hash ID a života). */
  seed: number;
}

export interface WeaponFrame {
  gripRight: THREE.Vector3;
  gripLeft: THREE.Vector3;
  magazineSocket: THREE.Vector3;
  stockZ: number;
  /** Držení: puška u ramene (výchozí), pistole v natažených rukou, předmět v ruce před tělem. */
  hold?: 'rifle' | 'pistol' | 'item';
  /** Styl dlouhé zbraně: kulomet (u boku, záklon), odstřelovačka (hlaveň dolů mimo míření). */
  style?: 'rifle' | 'heavy' | 'sniper' | 'shotgun';
}

/** Návrhové parametry (N). */
export const ANIM = {
  turnStartDeg: 45,
  turnStopDeg: 5,
  turnRate: 5,
  freeTwistDeg: 35,
  blendStance: 0.15,
  lieTime: 0.6,
  reviveTime: 0.5,
  stepHeight: 0.11,
};

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const ss = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

export class SoldierAnimator {
  pelvisYaw = 0;
  private turning = false;
  private phase = 0;
  private stride = 0;
  private moveDir = new THREE.Vector2(0, 1);
  private kick = 0;
  private kickV = 0;
  /** Odstřelovačka: po výstřelu chvíli zvednutá (1 → 0). */
  private readyT = 0;
  private lastShot = -1;
  private lie = 0;
  private lieKind: 'downed' | 'deadFront' | 'deadBack' = 'downed';
  private lastLife: AnimInput['life'] | null = null;
  private land = 0;
  private lastLand = -1;
  private inited = false;
  /** Diagnostika pro náhledovou scénu. */
  readonly layers = { locomotion: '', upper: '', life: '' };
  /** Čerstvý výstřel (záblesk ve světě řeší pool). */
  fired = false;

  constructor(readonly bones: Record<BoneName, THREE.Bone>) {}

  update(inp: AnimInput, simTime: number, dt: number, root: THREE.Object3D, weapon: THREE.Object3D, wf: WeaponFrame) {
    const B = this.bones;
    dt = Math.min(dt, 0.1);
    if (!this.inited) {
      this.pelvisYaw = inp.yaw;
      this.lastShot = inp.shotSeq;
      this.lastLife = inp.life;
      this.lie = inp.life === 'alive' ? 0 : 1;
      this.inited = true;
    }
    // --- Životní stav: přechody s pevnou délkou (ne podle délky klipu) ---
    if (inp.life !== this.lastLife) {
      if (inp.life === 'downed') this.lieKind = 'downed';
      else if (inp.life === 'dead' && this.lastLife === 'alive') this.lieKind = inp.seed % 2 ? 'deadFront' : 'deadBack';
      this.lastLife = inp.life;
    }
    const lieTarget = inp.life === 'alive' ? 0 : 1;
    this.lie = lieTarget > this.lie ? Math.min(1, this.lie + dt / ANIM.lieTime) : Math.max(0, this.lie - dt / ANIM.reviveTime);
    this.layers.life = inp.life === 'alive' ? (this.lie > 0 ? 'oživení' : 'živý') : inp.life === 'downed' ? 'vyřazen' : 'mrtev';

    // --- Postoj z výšky těla ---
    const crouch = clamp((1.8 - inp.height) / 0.6, 0, 1);
    const prone = clamp((1.2 - inp.height) / 0.7, 0, 1);

    // --- Natočení pánve: v pohybu za zamířením, na místě s hysterezí (35° volně, od 45° přešlap) ---
    const speed = Math.hypot(inp.vel.x, inp.vel.z);
    const aimYaw = prone > 0.5 ? inp.bodyYaw : inp.yaw;
    const diff = angleDiff(aimYaw, this.pelvisYaw);
    let turnStep = 0;
    if (speed > 0.3 || prone > 0.5) {
      const k = Math.min(1, dt * 8);
      this.pelvisYaw += diff * k;
      this.turning = false;
    } else {
      if (Math.abs(diff) > THREE.MathUtils.degToRad(ANIM.turnStartDeg)) this.turning = true;
      if (this.turning) {
        const st = Math.sign(diff) * Math.min(Math.abs(diff), ANIM.turnRate * dt);
        this.pelvisYaw += st;
        turnStep = Math.abs(st);
        if (Math.abs(diff) < THREE.MathUtils.degToRad(ANIM.turnStopDeg)) this.turning = false;
      }
    }
    this.pelvisYaw = Math.atan2(Math.sin(this.pelvisYaw), Math.cos(this.pelvisYaw)); // přes ±180° nejkratší cestou
    root.rotation.set(0, this.pelvisYaw, 0);

    // --- Locomotion: fáze a směr v prostoru pánve ---
    const cy = Math.cos(this.pelvisYaw), sy = Math.sin(this.pelvisYaw);
    // Lokální: x vpravo, y vpřed (prostor pánve).
    const lx = inp.vel.x * cy - inp.vel.z * sy;
    const lf = -(inp.vel.x * sy + inp.vel.z * cy);
    const moving = speed > 0.15 && inp.grounded;
    const targetStride = moving ? (prone > 0.5 ? 0.25 : (0.5 + 0.12 * speed) * (1 - 0.3 * crouch)) : 0;
    this.stride += (targetStride - this.stride) * Math.min(1, dt / ANIM.blendStance);
    if (moving) this.moveDir.lerp(new THREE.Vector2(lx, lf).normalize(), Math.min(1, dt * 10)).normalize();
    if (this.stride > 0.02) this.phase += (Math.PI * Math.max(speed, 0.5)) / Math.max(0.2, this.stride) * dt * (moving ? 1 : 0.4);
    if (turnStep > 0) this.phase += turnStep * 4;
    this.layers.locomotion = !inp.grounded ? 'vzduch' : prone > 0.5 ? (moving ? 'plazení' : 'leh') : crouch > 0.5 ? (moving ? 'dřep – krok' : 'dřep') : moving ? (inp.sprinting ? 'sprint' : 'chůze') : this.turning ? 'přešlap' : 'stoj';
    if (inp.lastLandAt !== undefined && inp.lastLandAt !== this.lastLand) {
      if (this.lastLand >= 0) this.land = 1;
      this.lastLand = inp.lastLandAt;
    }
    this.land = Math.max(0, this.land - dt * 5);

    // --- Pánev a trup ---
    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.025 * (1 - prone) : 0;
    const sprint = inp.sprinting ? 1 : 0;
    const pelvisY = THREE.MathUtils.lerp(0.96 - crouch * 0.4 - bob - this.land * 0.06, 0.17, prone);
    B.pelvis.position.set(0, pelvisY, THREE.MathUtils.lerp(0, 0.42, prone));
    B.pelvis.rotation.set(-crouch * 0.2 * (1 - prone) - sprint * 0.12 - prone * (Math.PI / 2 - 0.02), 0, moving ? Math.sin(this.phase) * 0.04 * (1 - prone) : 0);
    const twist = clamp(angleDiff(inp.yaw, this.pelvisYaw), -1.2, 1.2) * (1 - prone);
    const pitch = clamp(inp.pitch, -1.2, 1.2);
    // Pitch: páteř nese menší díl (bez přehnaného záklonu), zbytek krk, hlava a paže se zbraní.
    // Styl držení (N): kulomet nese u boku s trupem v záklonu (váha), při míření k rameni;
    // odstřelovačka mimo míření hlavní dolů („low ready“), po výstřelu chvíli zvednutá.
    const longGun = !wf.hold || wf.hold === 'rifle';
    const style = longGun ? (wf.style ?? 'rifle') : 'rifle';
    const sprint0 = inp.sprinting ? 1 : 0;
    const heavyHip = style === 'heavy' ? (1 - inp.ads) * (1 - sprint0) * (1 - prone) : 0;
    const heavyLean = style === 'heavy' ? (1 - prone) * (0.6 + 0.4 * (1 - inp.ads)) : 0;
    this.readyT = Math.max(0, this.readyT - dt * 0.6);
    const lowReady = style === 'sniper' ? (1 - inp.ads) * (1 - sprint0) * (1 - prone) * (1 - Math.min(1, this.readyT * 1.5)) : 0;
    B.spine1.rotation.set(pitch * 0.12 + crouch * 0.12 + prone * 0.06 - heavyLean * 0.1, twist * 0.3, 0);
    B.spine2.rotation.set(pitch * 0.18 + prone * 0.05 - heavyLean * 0.06, twist * 0.4 + heavyHip * 0.12, 0);
    B.neck.rotation.set(pitch * 0.25 + prone * 0.42, twist * 0.3, 0);
    B.head.rotation.set(pitch * 0.35 + prone * 0.3, 0, 0);
    for (const b of ['clavL', 'clavR'] as const) B[b].rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);

    // --- Zbraň: o rameno, ve směru zamíření; sprint nízko, přebití náklon, kopnutí ---
    if (inp.shotSeq !== this.lastShot) {
      if (inp.shotSeq > this.lastShot) {
        // Kopnutí slábne v kleku a vleže (jako recoil v simulaci).
        this.kickV += (style === 'heavy' ? 4 : 6) * stanceRecoil(MOVEMENT, inp.height).visual;
        this.fired = true;
        this.readyT = 1;
      }
      this.lastShot = inp.shotSeq;
    }
    this.kickV += (-this.kick * 300 - this.kickV * 24) * dt;
    this.kick += this.kickV * dt;
    let reloadT = 0;
    if (inp.action === 'reload' && inp.actionEnd > inp.actionStart) reloadT = clamp((simTime - inp.actionStart) / (inp.actionEnd - inp.actionStart), 0, 1);
    const rl = Math.sin(Math.min(1, reloadT * 1.1) * Math.PI);
    this.layers.upper = inp.life !== 'alive' ? '–' : reloadT > 0 ? `přebití ${(reloadT * 100).toFixed(0)} %` : sprint ? 'sprint – puška dole' : inp.ads > 0.5 ? 'ADS' : 'míření';
    const shoulderPt = new THREE.Vector3(0.13 - inp.ads * 0.07, 0.13 + inp.ads * 0.03, -0.07).applyMatrix4(B.spine2.matrixWorld);
    // Kulomet u boku: pažba u pravého boku nad pánví (opřená o předloktí), ne u ramene.
    const hipPt = new THREE.Vector3(0.19, 0.26, -0.12).applyMatrix4(B.pelvis.matrixWorld);
    const shoulder = shoulderPt.lerp(hipPt, heavyHip);
    if (lowReady > 0) shoulder.add(new THREE.Vector3(-0.03, -0.04, -0.02).applyQuaternion(B.spine2.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(lowReady));
    const aimPitch = clamp(inp.pitch, -1.25, 1.25) * (1 - heavyHip * 0.5) + heavyHip * 0.1 - lowReady * 0.5;
    const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(aimPitch * (1 - sprint) - sprint * (style === 'heavy' ? 0.45 : 0.75) - rl * 0.35 + this.kick * 0.06, inp.yaw + sprint * 0.55 + rl * 0.15 + heavyHip * 0.06 + lowReady * 0.18, -rl * 0.5 - heavyHip * 0.05, 'YXZ'));
    weapon.quaternion.copy(wq);
    if (!wf.hold || wf.hold === 'rifle') {
      const back = new THREE.Vector3(0, 0, wf.stockZ - 0.03 + this.kick * 0.04 + sprint * 0.12).applyQuaternion(wq);
      const low = new THREE.Vector3(-0.02 * sprint, -0.03 * (1 - inp.ads) - 0.06 * sprint - rl * 0.04, 0).applyQuaternion(wq);
      weapon.position.copy(shoulder).sub(back).add(low);
    } else {
      // Pistole v natažených pažích před obličejem / předmět v pravé ruce před hrudníkem.
      const pistol = wf.hold === 'pistol';
      const reach = (pistol ? 0.4 + inp.ads * 0.08 : 0.28) * (1 - sprint * 0.4) - this.kick * 0.03;
      const off = new THREE.Vector3(pistol ? -0.1 : 0.0, pistol ? -0.05 : -0.2, -reach);
      // Akce s předmětem (časy ze simulace): hod = nápřah vzad a švih vpřed, nůž = bodnutí,
      // lékárna / munice / defibrilátor = sehnutí ruky dolů před tělo s drobnou prací.
      if (!pistol && inp.life === 'alive' && inp.actionEnd > inp.actionStart && (inp.action === 'throw' || inp.action === 'attack' || inp.action === 'use')) {
        const k = clamp((simTime - inp.actionStart) / (inp.actionEnd - inp.actionStart), 0, 1);
        if (inp.action === 'throw') {
          const wind = ss(k, 0, 0.35) * (1 - ss(k, 0.4, 0.55));
          const swing = ss(k, 0.4, 0.6) * (1 - ss(k, 0.75, 1));
          off.add(new THREE.Vector3(0.12 * wind, 0.42 * wind + 0.25 * swing, 0.3 * wind - 0.38 * swing));
        } else if (inp.action === 'attack') {
          const jab = Math.sin(ss(k, 0, 0.6) * Math.PI);
          off.add(new THREE.Vector3(-0.08 * jab, 0.1 * jab, -0.34 * jab));
        } else {
          const work = Math.sin(k * Math.PI);
          off.add(new THREE.Vector3(-0.06 * work, -0.22 * work + Math.sin(k * 22) * 0.015 * work, -0.12 * work));
        }
        this.layers.upper = inp.action === 'throw' ? 'hod' : inp.action === 'attack' ? 'nůž' : 'použití předmětu';
      }
      weapon.position.copy(shoulder).add(off.applyQuaternion(wq));
    }
    weapon.updateMatrixWorld(true);
    weapon.visible = this.lie < 0.3;

    // --- Paže: IK na úchopy ---
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(wq);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(wq);
    const gR = wf.gripRight.clone().applyMatrix4(weapon.matrixWorld);
    const wristR = gR.clone().addScaledVector(up, 0.06).addScaledVector(fwd, -0.01);
    let gL = wf.gripLeft.clone().applyMatrix4(weapon.matrixWorld);
    if (reloadT > 0) {
      // Levá ruka opustí předpažbí, k šachtě a pod ni, chvíli pracuje, vrátí se.
      const mag = wf.magazineSocket.clone().applyMatrix4(weapon.matrixWorld).addScaledVector(up, -0.08);
      const k = ss(reloadT, 0.1, 0.28) * (1 - ss(reloadT, 0.78, 0.95));
      const work = Math.sin(reloadT * 18) * 0.03 * k;
      gL = gL.lerp(mag, k).addScaledVector(up, -0.12 * ss(reloadT, 0.3, 0.45) * (1 - ss(reloadT, 0.5, 0.65)) + work);
    }
    const wristL = gL.clone().addScaledVector(up, 0.05);
    const pelvisRight = new THREE.Vector3(cy, 0, -sy);
    const down = new THREE.Vector3(0, -1, 0);
    solveTwoBone(B.upperArmR, B.lowerArmR, wristR, pelvisRight.clone().multiplyScalar(0.8).add(down), UPPER_ARM, LOWER_ARM);
    aimBone(B.handR, gR.clone().sub(wristR), right.clone().negate());
    solveTwoBone(B.upperArmL, B.lowerArmL, wristL, pelvisRight.clone().multiplyScalar(-0.6).add(down), UPPER_ARM, LOWER_ARM);
    aimBone(B.handL, gL.clone().sub(wristL), right);

    // --- Nohy: cíle chodidel (v prostoru pánve), IK s kolenem vpřed ---
    const fwdW = new THREE.Vector3(-sy, 0, -cy);
    if (prone < 0.5) {
      for (const [side, sx, ph] of [['L', -1, 0], ['R', 1, Math.PI]] as const) {
        const p = this.phase + ph;
        const swing = Math.cos(p) * this.stride * 0.5;
        const lift = Math.max(0, -Math.sin(p)) * ANIM.stepHeight * Math.min(1, this.stride * 3) + (inp.grounded ? 0 : 0.18);
        const local = new THREE.Vector3(sx * (0.11 + crouch * 0.04) + this.moveDir.x * swing, 0.08 + lift, -(this.moveDir.y * swing) - crouch * 0.12);
        const target = local.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.pelvisYaw).add(root.position);
        const thigh = side === 'L' ? B.thighL : B.thighR;
        const shin = side === 'L' ? B.shinL : B.shinR;
        solveTwoBone(thigh, shin, target, fwdW.clone().add(new THREE.Vector3(0, 0.2, 0)), THIGH, SHIN, fwdW);
        const foot = side === 'L' ? B.footL : B.footR;
        // Chodidlo rovně k zemi, ve směru pánve.
        const shinQ = shin.getWorldQuaternion(new THREE.Quaternion());
        foot.quaternion.copy(shinQ.invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.pelvisYaw)));
      }
    } else {
      // Leh: nohy natažené dozadu, při plazení střídavě pokrčené.
      const crawl = moving ? Math.sin(this.phase) : 0;
      B.thighL.rotation.set(0, 0, -0.12 + Math.max(0, crawl) * 0.3);
      B.thighR.rotation.set(0, 0, 0.12 - Math.max(0, -crawl) * 0.3);
      B.shinL.rotation.set(-Math.max(0, crawl) * 0.6, 0, 0);
      B.shinR.rotation.set(-Math.max(0, -crawl) * 0.6, 0, 0);
      B.footL.rotation.set(1.2, 0, 0);
      B.footR.rotation.set(1.2, 0, 0);
    }

    // --- Vyřazení / smrt: pevná póza ležícího těla, prolnutí z aktuální pózy ---
    if (this.lie > 0) this.blendLying(ss(this.lie, 0, 1));
    root.updateMatrixWorld(true);
  }

  private lyingQuat = new Map<BoneName, THREE.Quaternion>();

  private blendLying(f: number) {
    const B = this.bones;
    const front = this.lieKind === 'deadFront';
    const E = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    const pose: Partial<Record<BoneName, THREE.Quaternion>> = {
      pelvis: E(front ? -Math.PI / 2 + 0.05 : Math.PI / 2 - 0.08, 0, front ? 0.1 : -0.15),
      spine1: E(front ? 0.05 : -0.05, 0, 0.05),
      spine2: E(0, 0.1, 0),
      neck: E(front ? -0.1 : 0.1, 0.3, 0),
      head: E(0, 0.4, 0),
      clavL: E(0, 0, 0),
      clavR: E(0, 0, 0),
      upperArmL: E(0.2, 0, -0.9),
      lowerArmL: E(-0.6, 0, 0),
      handL: E(0, 0, 0),
      upperArmR: E(-0.3, 0, 1.1),
      lowerArmR: E(-0.4, 0, 0),
      handR: E(0, 0, 0),
      thighL: E(this.lieKind === 'downed' ? 0.35 : 0.05, 0, -0.18),
      shinL: E(this.lieKind === 'downed' ? -0.7 : -0.1, 0, 0),
      footL: E(0.2, 0, 0),
      thighR: E(0, 0, 0.12),
      shinR: E(-0.15, 0, 0),
      footR: E(0.2, 0, 0),
    };
    for (const n of BONES) {
      const q = pose[n];
      if (!q) continue;
      B[n].quaternion.slerp(q, f);
    }
    B.pelvis.position.lerp(new THREE.Vector3(0, 0.12, 0.35), f);
    void this.lyingQuat;
  }
}
