import * as THREE from 'three';
import type { WeaponState } from '../../../shared/sim/weapon';
import type { PlayerState } from '../../../shared/sim/player';
import { PF_RIG, adsRoot } from '../../../shared/config/rig';
import { PF_RIFLE } from '../../../shared/config/weapon';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildM4A1, type WeaponModel } from './m4a1';
import { HAND_LOOKS, Hand, POSES, buildHandGeometry, makeCamoTexture, type HandGeometry } from './hands';

/**
 * Zbraň a ruce v první osobě (M4A1, USMC Assault). Hierarchie:
 * camera → presentation (sway, bob, kopnutí, stažení u zdi) → weaponRoot (hip↔ADS) → díly.
 * Kosmetika nikdy nemění herní ústí ani směr střely (ty počítá simulace z PF_RIG).
 */

function grainTexture(): THREE.DataTexture {
  const n = 128;
  const d = new Uint8Array(n * n * 4);
  let s = 99;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n * n; i++) {
    const v = 128 + (r() - 0.5) * 14;
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = 255;
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(30, 30);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Kolimátor: tečka v nekonečnu – vykreslí se jen tam, kde paprsek oka míří podél osy optiky. */
function reticleMaterial(dotDeg: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uAxis: { value: new THREE.Vector3(0, 0, -1) },
      uDot: { value: Math.cos((dotDeg * Math.PI) / 180) },
      uGlow: { value: Math.cos((dotDeg * 2.2 * Math.PI) / 180) },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uAxis; uniform float uDot; uniform float uGlow; varying vec3 vW;
      void main(){
        vec3 d = normalize(vW - cameraPosition);
        float c = dot(d, normalize(uAxis));
        float core = smoothstep(uDot - 0.0000025, uDot + 0.0000025, c);
        float halo = smoothstep(uGlow, 1.0, c) * 0.35;
        vec3 tint = vec3(0.55, 0.62, 0.6);
        float a = 0.07 + max(core, halo * 0.5);
        vec3 col = mix(tint, vec3(1.0, 0.16, 0.1) * 1.4, max(core, halo));
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
  });
}

export interface FpStats {
  triangles: number;
  meshes: number;
}

export class FPWeapon {
  readonly root = new THREE.Group();
  private presentation = new THREE.Group();
  private weaponRoot = new THREE.Group();
  readonly model: WeaponModel;
  private handGeo: HandGeometry;
  private rightHand: Hand;
  private leftHand: Hand;
  private mag: THREE.Mesh;
  private reticle: THREE.Mesh;
  private reticleMat: THREE.ShaderMaterial;
  private flash: THREE.Group;
  private flashUntil = 0;
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private casings: Array<{ m: THREE.Mesh; v: THREE.Vector3; life: number }> = [];
  private casingGeo: THREE.BufferGeometry;
  private casingMat: THREE.MeshStandardMaterial;
  private lastSeq = -1;
  // stav prezentace
  private kick = 0;
  private kickV = 0;
  private swayX = 0;
  private swayY = 0;
  private sprint = 0;
  private lower = 0;
  private equipT = 1;
  private time = 0;
  private reloadVisual = 0; // 0 = zásobník v šachtě
  showCasings = true;

  constructor(lookId = 'usmcAssault', quality: 'low' | 'standard' | 'high' = 'standard') {
    const seg = quality === 'low' ? 0.6 : quality === 'high' ? 1.25 : 1;
    this.model = buildM4A1(seg);
    const grain = grainTexture();
    this.textures.push(grain);
    const metal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.52, normalMap: grain, normalScale: new THREE.Vector2(0.25, 0.25), side: THREE.DoubleSide });
    const polymer = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.74, normalMap: grain, normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide });
    const look = HAND_LOOKS[lookId] ?? HAND_LOOKS.usmcAssault;
    const camo = makeCamoTexture(look.sleeve);
    this.textures.push(camo);
    const glove = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.88, side: THREE.DoubleSide });
    const sleeve = new THREE.MeshStandardMaterial({ map: camo, vertexColors: true, metalness: 0, roughness: 0.92, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, metalness: 0, roughness: 0.7, side: THREE.DoubleSide });
    this.materials.push(metal, polymer, glove, sleeve, skin);

    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    add(this.model.static.metal, metal, this.weaponRoot);
    add(this.model.static.polymer, polymer, this.weaponRoot);
    const magDef = this.model.moving.magazine;
    this.mag = add(magDef.geometry, polymer, this.weaponRoot);
    this.mag.position.copy(magDef.pivot);
    const ch = this.model.moving.chargingHandle;
    add(ch.geometry, metal, this.weaponRoot).position.copy(ch.pivot);
    // Sklo + tečka kolimátoru (jediný dodatečný materiál optiky).
    this.reticleMat = reticleMaterial(0.11);
    this.materials.push(this.reticleMat);
    this.reticle = new THREE.Mesh(this.model.optic!.glass, this.reticleMat);
    this.reticle.renderOrder = 5;
    this.reticle.frustumCulled = false;
    this.weaponRoot.add(this.reticle);

    this.handGeo = buildHandGeometry(look, seg);
    this.rightHand = new Hand('right', { glove, sleeve, skin }, look, this.handGeo);
    this.leftHand = new Hand('left', { glove, sleeve, skin }, look, this.handGeo);
    for (const h of [this.rightHand, this.leftHand]) {
      this.weaponRoot.add(h.root);
      this.presentation.add(h.forearm);
    }
    this.rightHand.setPose(POSES.grip);
    this.leftHand.setPose(POSES.handguard);

    // Záblesk z ústí: zkřížené plochy s aditivní hvězdou (pool = 1 instance, náhodná rotace).
    this.flash = this.makeFlash();
    this.flash.position.copy(this.model.points.muzzle);
    this.weaponRoot.add(this.flash);

    this.casingGeo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 10);
    this.casingGeo.rotateZ(Math.PI / 2);
    this.casingMat = new THREE.MeshStandardMaterial({ color: '#b08d45', metalness: 0.9, roughness: 0.35 });
    this.materials.push(this.casingMat);

    this.presentation.add(this.weaponRoot);
    this.root.add(this.presentation);
    this.root.name = 'fpWeapon';
    this.placeHands(0, 0);
  }

  private makeFlash() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 2, 64, 64, 60);
    grd.addColorStop(0, 'rgba(255,245,210,1)');
    grd.addColorStop(0.25, 'rgba(255,190,90,0.85)');
    grd.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grd;
    g.translate(64, 64);
    for (let k = 0; k < 5; k++) {
      g.rotate((Math.PI * 2) / 5);
      g.beginPath();
      g.moveTo(-6, 0);
      g.lineTo(0, -60);
      g.lineTo(6, 0);
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, 22, 0, Math.PI * 2);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(t);
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.materials.push(m);
    // Tři zkřížené plochy sloučené do jedné geometrie (1 draw call).
    const front = new THREE.PlaneGeometry(0.09, 0.09);
    const s1 = new THREE.PlaneGeometry(0.06, 0.16).rotateX(Math.PI / 2).translate(0, 0, -0.06);
    const s2 = new THREE.PlaneGeometry(0.06, 0.16).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0, -0.06);
    const fg = mergeGeometries([front, s1, s2])!;
    [front, s1, s2].forEach((x) => x.dispose());
    const grp = new THREE.Group();
    const mesh = new THREE.Mesh(fg, m);
    mesh.frustumCulled = false;
    grp.add(mesh);
    grp.visible = false;
    return grp;
  }

  /** Ruce na úchopech; levá ruka se během přebití pohybuje po vlastní dráze. */
  private placeHands(reloadT: number, emptyBolt: number) {
    const P = this.model.points;
    // Pravá ruka: hřbet ven (+X), řada prstů podél osy rukojeti (sklon ~20°), prsty kolem čela rukojeti.
    const a = (20 * Math.PI) / 180;
    const rx = new THREE.Vector3(0, -Math.cos(a), Math.sin(a));
    const ry = new THREE.Vector3(1, 0, 0);
    const rz = new THREE.Vector3().crossVectors(rx, ry);
    const rh = this.rightHand.root;
    rh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(rx, ry, rz));
    rh.position.set(0.03, P.gripRight.y - 0.005, P.gripRight.z + 0.065);
    // Levá ruka (rámec před zrcadlením): hřbet dolů-vlevo, prsty obepínají předpažbí zprava.
    const ly = new THREE.Vector3(-0.4, -0.9, 0.1).normalize();
    let lz = new THREE.Vector3(-0.9, -0.35, 0.25).normalize();
    const lx = new THREE.Vector3().crossVectors(ly, lz).normalize();
    lz = new THREE.Vector3().crossVectors(lx, ly).normalize();
    const lh = this.leftHand.root;
    lh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(lx, ly, lz));
    const base = new THREE.Vector3(-0.05, P.gripLeft.y - 0.032, P.gripLeft.z + 0.012);
    const magPos = new THREE.Vector3(-0.05, P.magazineSocket.y - 0.11, P.magazineSocket.z + 0.01);
    const below = new THREE.Vector3(-0.08, -0.36, 0.02);
    const bolt = new THREE.Vector3(-0.055, P.boltCatch.y - 0.01, P.boltCatch.z + 0.03);
    const k = reloadT;
    let target = base;
    const seg = (x: number, y: number) => THREE.MathUtils.smoothstep(k, x, y);
    if (k > 0) {
      const toMag = seg(0.1, 0.24);
      const down = seg(0.3, 0.42);
      const back = seg(0.46, 0.6);
      const boltT = seg(0.72, 0.8) * emptyBolt;
      const home = seg(0.84, 0.97);
      target = base.clone().lerp(magPos, toMag);
      target.lerp(below, down * (1 - back));
      if (emptyBolt) target.lerp(bolt, boltT);
      target.lerp(base, home);
      this.leftHand.setPose(toMag > 0.5 && home < 0.5 && boltT < 0.5 ? POSES.magazine : POSES.handguard, 0.25);
    } else this.leftHand.setPose(POSES.handguard, 0.3);
    lh.position.copy(target);
  }

  /** Orientace předloktí od zápěstí k loktu mimo obraz (lokty v prostoru prezentace → svět). */
  private placeForearms() {
    this.presentation.updateMatrixWorld(true);
    for (const [h, elbowLocal] of [
      [this.rightHand, new THREE.Vector3(0.26, -0.5, 0.12)],
      [this.leftHand, new THREE.Vector3(-0.26, -0.5, -0.02)],
    ] as const) {
      const wristLocal = h.root.position.clone().applyMatrix4(this.weaponRoot.matrix);
      h.forearm.position.copy(wristLocal);
      h.forearm.lookAt(this.presentation.localToWorld(elbowLocal.clone()));
    }
  }

  /**
   * Snímek prezentace podle stavu simulace. `simTime` je čas simulace (s).
   */
  update(dt: number, ps: PlayerState, ws: WeaponState | null, simTime: number, bobPhase: number, bobAmp: number, lookDYaw: number, lookDPitch: number) {
    this.time += dt;
    const ads = ws?.adsProgress ?? 0;
    // Hip ↔ ADS: ADS kořen klade oko optiky do středu pohledu (opticEye).
    const P = this.model.points;
    const hip = new THREE.Vector3(...PF_RIG.hipRoot);
    const adsV = new THREE.Vector3(...adsRoot(PF_RIG));
    void P;
    const e = ads * ads * (3 - 2 * ads);
    this.weaponRoot.position.lerpVectors(hip, adsV, e);
    this.weaponRoot.rotation.set(PF_RIG.hipRot[0] * (1 - e), PF_RIG.hipRot[1] * (1 - e), PF_RIG.hipRot[2] * (1 - e));

    // Sway jen kosmetický; v ADS výrazně tlumený (zarovnání mířidel).
    const k = 1 - Math.exp(-dt * 12);
    this.swayX = THREE.MathUtils.lerp(this.swayX, THREE.MathUtils.clamp(lookDYaw * 3, -0.026, 0.026) * (1 - e), k);
    this.swayY = THREE.MathUtils.lerp(this.swayY, THREE.MathUtils.clamp(lookDPitch * 3, -0.026, 0.026) * (1 - e), k);
    this.sprint = THREE.MathUtils.lerp(this.sprint, ps.sprinting ? 1 : 0, 1 - Math.exp(-dt * 9));
    // Stažení u zdi podle herní překážky (stejné pravidlo jako blokace hlavně).
    this.lower = THREE.MathUtils.lerp(this.lower, ws?.obstruction ?? 0, 1 - Math.exp(-dt * 10));
    // Tasení při spawnu.
    if (ws && ws.action === 'equip') this.equipT = THREE.MathUtils.clamp((simTime - ws.actionStart) / (ws.actionEnd - ws.actionStart), 0, 1);
    else this.equipT = Math.min(1, this.equipT + dt * 3);

    // Kopnutí při výstřelu: pružina (impulsy se skládají, nerestartují animaci).
    if (ws && ws.shotSeq !== this.lastSeq) {
      if (this.lastSeq >= 0 && ws.shotSeq > this.lastSeq) {
        this.kickV += 9 * (1 - 0.3 * e);
        this.flashUntil = this.time + 0.045;
        this.flash.rotation.z = Math.random() * Math.PI;
        this.flash.scale.setScalar(0.85 + Math.random() * 0.4);
        if (this.showCasings) this.ejectCasing();
      }
      this.lastSeq = ws.shotSeq;
    }
    this.kickV += (-this.kick * 420 - this.kickV * 28) * dt;
    this.kick += this.kickV * dt;
    this.flash.visible = this.time < this.flashUntil;

    // Přebití: normalizovaný čas akce ze simulace; zrušení vrátí díly okamžitě (bez osiřelých zásobníků).
    let reloadT = 0;
    let empty = 0;
    if (ws && ws.action === 'reload') {
      reloadT = THREE.MathUtils.clamp((simTime - ws.actionStart) / (ws.actionEnd - ws.actionStart), 0, 1);
      empty = ws.reloadEmpty ? 1 : 0;
    }
    const tilt = Math.sin(Math.min(1, reloadT * 1.15) * Math.PI);
    const magOut = THREE.MathUtils.smoothstep(reloadT, 0.27, 0.42) * (1 - THREE.MathUtils.smoothstep(reloadT, 0.5, 0.68));
    this.reloadVisual = reloadT > 0 ? magOut : 0;
    const P2 = this.model.points;
    this.mag.position.set(P2.magazineSocket.x - 0.03 * this.reloadVisual, P2.magazineSocket.y - 0.3 * this.reloadVisual, P2.magazineSocket.z + 0.02 * this.reloadVisual);
    this.mag.rotation.x = 0.4 * this.reloadVisual;
    this.placeHands(reloadT, empty);

    // Prezentace (meze N ze zadání „Pohyb vojáků“, kap. 11): bob hip ≤ 8 mm svisle / 5 mm bokem,
    // sprint ≤ 15 / 10 mm; sprintová póza ~8 cm níž, hlaveň dolů ~20°, rotace ≤ 10°;
    // kopnutí 8–15 mm dozadu, pitch ≤ 1,5°. Akční póza přebití nahrazuje sprintovou.
    const pr = this.presentation;
    const sprintPose = this.sprint * (1 - Math.min(1, tilt * 1.5));
    const bobScale = 1 - 0.9 * e;
    const bobV = Math.min(ps.sprinting ? 0.015 : 0.008, bobAmp * 0.7) * bobScale;
    const bobH = Math.min(ps.sprinting ? 0.01 : 0.005, bobAmp * 0.45) * bobScale;
    const kickBack = THREE.MathUtils.clamp(this.kick, -0.2, 1) * 0.013;
    const kickPitch = THREE.MathUtils.clamp(this.kick, -0.2, 1) * THREE.MathUtils.degToRad(1.4);
    pr.position.set(
      this.swayX * 0.1 + Math.cos(bobPhase) * bobH - sprintPose * 0.02 + tilt * 0.02,
      this.swayY * 0.1 + Math.sin(bobPhase * 2) * bobV - sprintPose * 0.08 - this.lower * 0.07 - (1 - this.equipT) * 0.35 - tilt * 0.03,
      kickBack + sprintPose * 0.02 + this.lower * 0.12,
    );
    pr.rotation.set(
      -sprintPose * THREE.MathUtils.degToRad(20) + this.swayY * 0.6 + kickPitch - this.lower * 0.55 + (1 - this.equipT) * 0.6 + tilt * 0.18,
      sprintPose * THREE.MathUtils.degToRad(10) + this.swayX * 0.6 + tilt * 0.12,
      sprintPose * THREE.MathUtils.degToRad(8) - tilt * 0.42,
    );
    this.placeForearms();

    // Osa kolimátoru ve světě (pro výpočet tečky v nekonečnu).
    this.reticle.updateWorldMatrix(true, false);
    const q = new THREE.Quaternion();
    this.reticle.getWorldQuaternion(q);
    (this.reticleMat.uniforms.uAxis.value as THREE.Vector3).set(0, 0, -1).applyQuaternion(q);

    this.updateCasings(dt);
    void PF_RIFLE;
  }

  private ejectCasing() {
    let c = this.casings.find((x) => x.life <= 0);
    if (!c) {
      if (this.casings.length >= 16) c = this.casings[0];
      else {
        const m = new THREE.Mesh(this.casingGeo, this.casingMat);
        m.frustumCulled = false;
        this.presentation.add(m);
        c = { m, v: new THREE.Vector3(), life: 0 };
        this.casings.push(c);
      }
    }
    const p = this.model.points.ejectionPort.clone().applyMatrix4(this.weaponRoot.matrix);
    c.m.position.copy(p);
    c.m.visible = true;
    c.v.set(1.6 + Math.random() * 0.6, 1.2 + Math.random() * 0.5, 0.4 + Math.random() * 0.3);
    c.life = 0.7;
  }

  private updateCasings(dt: number) {
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += dt * 20;
      c.m.rotation.y += dt * 13;
      if (c.life <= 0) c.m.visible = false;
    }
  }

  stats(): FpStats {
    let triangles = 0, meshes = 0;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible) {
        meshes++;
        const g = m.geometry as THREE.BufferGeometry;
        triangles += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      }
    });
    return { triangles: Math.round(triangles), meshes };
  }

  dispose() {
    this.root.removeFromParent();
    for (const g of [this.model.static.metal, this.model.static.polymer, this.model.moving.magazine.geometry, this.model.moving.chargingHandle.geometry, this.model.optic!.glass, this.casingGeo]) g.dispose();
    this.handGeo.dispose();
    this.flash.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
