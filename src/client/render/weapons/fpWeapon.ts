import * as THREE from 'three';
import type { WeaponState } from '../../../shared/sim/weapon';
import type { PlayerState } from '../../../shared/sim/player';
import type { WeaponConfig } from '../../../shared/config/weapon';
import { rulesOf } from '../../../shared/config/arsenal';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponModel } from './types';
import { buildFirstPerson, weaponDef } from './catalog';
import { HAND_LOOKS, Hand, POSES, buildHandGeometry, makeCamoTexture, type HandGeometry } from './hands';

/**
 * Zbraň a ruce v první osobě (libovolný hotový model z katalogu). Hierarchie:
 * camera → presentation (sway, bob, kopnutí, stažení u zdi) → weaponRoot (hip↔ADS) → díly.
 * Hip póza a poloha oka v ADS jsou vlastností modelu (vlastní mířidla každé zbraně).
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

/** Zdvih páky závěru opakovačky (rad). */
const BOLT_LIFT = 1.05;

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
  private handle: THREE.Mesh | null = null;
  private cover: THREE.Mesh | null = null;
  private pump: THREE.Mesh | null = null;
  /** Pumpa: 0 = vpředu, 1 = stažená vzad (prostor zbraně podél travel). */
  private pumpPos = 0;
  private pumpStart = -1;
  private pumpSounded = true;
  private rules: WeaponConfig;
  /** Nabíjení po jednom: cíl levé ruky a stav volného náboje. */
  private singleTarget: THREE.Vector3 | null = null;
  private shellCount = -1;
  /** Mechanické zvuky (pumpa, náboj, víko) – napojí Game na audio. */
  onMech: (kind: 'pump' | 'shell' | 'cover' | 'bolt') => void = () => {};
  /** Opakovačka: cyklus závěru po výstřelu, nabíjení po jednom do otevřeného závěru. */
  private boltStart = -1;
  private boltSound = 0;
  private boltReloadKey = -1;
  private boltRounds = 1;
  private rightTarget = new THREE.Vector3();
  private rightBlend = 0;
  /** Závěr / přebíjení právě zaměstnává ruku → puškohled se nepoužívá (hra ukáže zbraň). */
  busy = false;
  private busyBlend = 0;
  private slideAt = -10;
  /** Pásové přebití: úhel víka a posun schránky (prostor zbraně). */
  private coverAngle = 0;
  private boxOffset = new THREE.Vector3();
  private reticle: THREE.Mesh | null = null;
  private reticleMat: THREE.ShaderMaterial | null = null;
  private geometries: THREE.BufferGeometry[] = [];
  private flash: THREE.Group;
  private flashUntil = 0;
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private casings: Array<{ m: THREE.Mesh; v: THREE.Vector3; life: number }> = [];
  private casingGeo: THREE.BufferGeometry;
  private casingMat: THREE.MeshStandardMaterial;
  private lastSeq = -1;
  private maxSeq = -1;
  /** Vlastní výstřel (jednou na shotSeq – korekce/predikce efekt nezopakuje). */
  onShot: () => void = () => {};
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
  private handlePull = 0;
  showCasings = true;

  constructor(weaponId = 'm4a1', lookId: string | null = null, quality: 'low' | 'standard' | 'high' = 'standard') {
    const seg = quality === 'low' ? 0.6 : quality === 'high' ? 1.25 : 1;
    const def = weaponDef(weaponId);
    // Rozpočet zbraně v první osobě (3 000–3 500 trojúhelníků) platí pro všechny kvality.
    this.model = buildFirstPerson(def.id);
    this.rules = rulesOf(def.id);
    lookId = lookId ?? def.hands;
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
    this.mag = add(magDef.geometry, magDef.material === 'metal' ? metal : polymer, this.weaponRoot);
    this.mag.position.copy(magDef.pivot);
    const ch = this.model.moving.chargingHandle;
    if (ch) {
      this.handle = add(ch.geometry, metal, this.weaponRoot);
      this.handle.position.copy(ch.pivot);
    }
    const pm = this.model.moving.pump;
    if (pm) {
      this.pump = add(pm.geometry, pm.material === 'metal' ? metal : polymer, this.weaponRoot);
      this.pump.position.copy(pm.pivot);
      this.geometries.push(pm.geometry);
    }
    // Nabíjení po jednom: volný náboj je vidět jen ve fázi vkládání.
    if (this.model.reloadStyle === 'single' || this.model.reloadStyle === 'bolt') this.mag.visible = false;
    const fc = this.model.moving.feedCover;
    if (fc) {
      this.cover = add(fc.geometry, fc.material === 'metal' ? metal : polymer, this.weaponRoot);
      this.cover.position.copy(fc.pivot);
      this.geometries.push(fc.geometry);
    }
    this.geometries.push(this.model.static.metal, this.model.static.polymer, magDef.geometry);
    if (ch) this.geometries.push(ch.geometry);
    // Sklo + tečka kolimátoru (jediný dodatečný materiál optiky) – jen u zbraní s kolimátorem.
    if (this.model.optic?.kind === 'scope') {
      // Puškohled: okulár = tmavé sklo s odleskem; zaměřovací obraz kreslí hra přes celou obrazovku.
      const lens = new THREE.MeshStandardMaterial({ color: '#0b1519', metalness: 0.3, roughness: 0.06, emissive: '#06222c', emissiveIntensity: 0.35, side: THREE.DoubleSide });
      this.materials.push(lens);
      const g = new THREE.Mesh(this.model.optic.glass, lens);
      g.frustumCulled = false;
      this.weaponRoot.add(g);
      this.geometries.push(this.model.optic.glass);
    } else if (this.model.optic) {
      this.reticleMat = reticleMaterial(0.11);
      this.materials.push(this.reticleMat);
      this.reticle = new THREE.Mesh(this.model.optic.glass, this.reticleMat);
      this.reticle.renderOrder = 5;
      this.reticle.frustumCulled = false;
      this.weaponRoot.add(this.reticle);
      this.geometries.push(this.model.optic.glass);
    }

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
    if (this.rightBlend > 0) rh.position.lerp(this.rightTarget, this.rightBlend);
    this.rightHand.setPose(this.rightBlend > 0.5 ? POSES.magazine : POSES.grip, 0.3);
    // Levá ruka (rámec před zrcadlením): hřbet dolů-vlevo, prsty obepínají předpažbí zprava.
    const ly = new THREE.Vector3(-0.4, -0.9, 0.1).normalize();
    let lz = new THREE.Vector3(-0.9, -0.35, 0.25).normalize();
    const lx = new THREE.Vector3().crossVectors(ly, lz).normalize();
    lz = new THREE.Vector3().crossVectors(lx, ly).normalize();
    const lh = this.leftHand.root;
    lh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(lx, ly, lz));
    const pumpTravel = this.model.moving.pump?.travel?.z ?? 0;
    // Pistole: podpůrná ruka obepíná pravou zleva zespodu (držení oběma rukama), ne předpažbí.
    const base = this.model.slideCycle
      ? new THREE.Vector3(-0.022, P.gripRight.y - 0.03, P.gripRight.z + 0.05)
      : new THREE.Vector3(-0.05, P.gripLeft.y - 0.032, P.gripLeft.z + 0.012 + this.pumpPos * pumpTravel);
    const magPos = new THREE.Vector3(-0.05, P.magazineSocket.y - 0.11, P.magazineSocket.z + 0.01);
    const below = new THREE.Vector3(-0.08, -0.36, 0.02);
    // Prázdné přebití: záchyt závěru vlevo (AR), nebo natažení páky závěru (AK/bullpup – levá ruka přes zbraň).
    const bolt = this.model.emptyAction === 'boltCatch'
      ? new THREE.Vector3(-0.055, P.boltCatch.y - 0.01, P.boltCatch.z + 0.03)
      : new THREE.Vector3(P.chargingHandle.x + 0.02, P.chargingHandle.y + 0.035, P.chargingHandle.z + 0.04 + this.handlePull * (this.model.moving.chargingHandle?.travel?.z ?? 0));
    const k = reloadT;
    let target = base;
    const seg = (x: number, y: number) => THREE.MathUtils.smoothstep(k, x, y);
    if (k > 0 && this.singleTarget) {
      target = this.singleTarget;
      this.leftHand.setPose(this.mag.visible ? POSES.magazine : POSES.handguard, 0.25);
    } else if (k > 0 && this.model.reloadStyle === 'belt' && this.model.moving.feedCover && P.feedCover && P.feedEntry) {
      // Pás: víko → schránka → nová schránka → pás na lůžko → zavřít víko → (prázdné) páka → zpět.
      const piv = this.model.moving.feedCover.pivot;
      const tip = P.feedCover.clone().sub(piv).applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.coverAngle).add(piv);
      const coverHand = tip.clone().add(new THREE.Vector3(-0.03, 0.02, 0.0));
      const boxHand = P.magazineSocket.clone().add(this.boxOffset).add(new THREE.Vector3(this.model.magSide * 0.02 - 0.05, -0.06, 0.0));
      const beltHand = P.feedEntry.clone().add(new THREE.Vector3(-0.035, 0.03, 0.0));
      const steps: Array<[number, number, THREE.Vector3]> = [
        [0.0, 0.06, coverHand],
        [0.19, 0.25, boxHand],
        [0.6, 0.66, beltHand],
        [0.68, 0.73, coverHand],
      ];
      target = base.clone();
      for (const [a0, a1, p] of steps) target.lerp(p, seg(a0, a1));
      if (emptyBolt) target.lerp(bolt, seg(0.85, 0.89) * (1 - seg(0.93, 0.95)));
      target.lerp(base, seg(0.86 + emptyBolt * 0.08, 0.97));
      const onPart = k < 0.84 + emptyBolt * 0.08;
      this.leftHand.setPose(onPart ? (k > 0.6 && k < 0.68 ? POSES.open : POSES.magazine) : POSES.handguard, 0.25);
    } else if (k > 0 && this.model.reloadStyle !== 'bolt') {
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
    } else this.leftHand.setPose(this.model.slideCycle ? POSES.grip : POSES.handguard, 0.3);
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
    // Opakovačka: během cyklu závěru / přebití zbraň klesne od oka (ruka na páce je vidět).
    this.busyBlend = THREE.MathUtils.lerp(this.busyBlend, this.busy ? 1 : 0, 1 - Math.exp(-dt * 14));
    const ads = (ws?.adsProgress ?? 0) * (1 - 0.65 * this.busyBlend);
    // Hip ↔ ADS: ADS kořen klade oko (opticEye – kolimátor nebo hledí + odstup) do středu pohledu.
    const hip = this.model.hipRoot;
    const adsV = this.model.points.opticEye.clone().negate();
    const e = ads * ads * (3 - 2 * ads);
    this.weaponRoot.position.lerpVectors(hip, adsV, e);
    const hr = this.model.hipRot;
    this.weaponRoot.rotation.set(hr.x * (1 - e), hr.y * (1 - e), hr.z * (1 - e));

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
      if (this.lastSeq >= 0 && ws.shotSeq > this.maxSeq) {
        this.maxSeq = ws.shotSeq;
        this.onShot();
        this.kickV += 9 * (1 - 0.3 * e);
        this.flashUntil = this.time + 0.045;
        this.flash.rotation.z = Math.random() * Math.PI;
        this.flash.scale.setScalar(0.85 + Math.random() * 0.4);
        if (this.showCasings && this.model.cycle === 'none') this.ejectCasing();
        if (this.model.slideCycle) this.slideAt = this.time;
        if (this.model.cycle === 'bolt') {
          this.boltStart = this.time + 0.12;
          this.boltSound = 0;
        }
        if (this.model.cycle === 'pump') {
          this.pumpStart = this.time + 0.12;
          this.pumpSounded = false;
        }
      }
      if (this.lastSeq < 0) this.maxSeq = ws.shotSeq;
      if (ws.shotSeq < this.lastSeq) this.maxSeq = Math.max(this.maxSeq, this.lastSeq);
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
    const belt = this.model.reloadStyle === 'belt';
    this.updatePumpAndShells(ws, simTime, empty);
    this.updateBolt(ws, reloadT);
    // Pásové zbraně: menší naklopení (víko a schránka musí zůstat v obraze).
    const tilt = Math.sin(Math.min(1, reloadT * 1.15) * Math.PI) * (belt ? 0.45 : this.model.reloadStyle === 'single' ? 0 : this.model.reloadStyle === 'bolt' ? 0.35 : 1);
    const magOut = THREE.MathUtils.smoothstep(reloadT, 0.27, 0.42) * (1 - THREE.MathUtils.smoothstep(reloadT, 0.5, 0.68));
    this.reloadVisual = reloadT > 0 ? magOut : 0;
    const P2 = this.model.points;
    if (belt) {
      const sm = THREE.MathUtils.smoothstep;
      const open = reloadT > 0 ? sm(reloadT, 0.06, 0.18) * (1 - sm(reloadT, 0.74, 0.84)) : 0;
      this.coverAngle = open * 1.05;
      if (this.cover) this.cover.rotation.x = -this.coverAngle;
      const out = reloadT > 0 ? sm(reloadT, 0.24, 0.4) * (1 - sm(reloadT, 0.46, 0.6)) : 0;
      this.boxOffset.set(this.model.magSide * 0.07 * out, -0.26 * out, 0.02 * out);
      this.mag.position.copy(P2.magazineSocket).add(this.boxOffset);
      this.mag.rotation.set(this.model.magRock * out, 0, this.model.magSide * 0.35 * out);
    } else if (this.model.reloadStyle !== 'single' && this.model.reloadStyle !== 'bolt') {
      this.mag.position.set(P2.magazineSocket.x - 0.03 * this.reloadVisual, P2.magazineSocket.y - 0.3 * this.reloadVisual, P2.magazineSocket.z + 0.02 * this.reloadVisual);
      this.mag.rotation.x = this.model.magRock * this.reloadVisual;
    }
    // Natažení páky závěru při prázdném přebití (AK, bullpup); AR uvolní záchyt bez pohybu páky.
    const [p0, p1, p2, p3] = belt ? [0.88, 0.91, 0.92, 0.95] : [0.72, 0.78, 0.8, 0.83];
    const pull = empty && this.model.emptyAction === 'chargingHandle' ? THREE.MathUtils.smoothstep(reloadT, p0, p1) * (1 - THREE.MathUtils.smoothstep(reloadT, p2, p3)) : 0;
    this.handlePull = pull;
    let slide = pull;
    if (this.model.slideCycle) {
      // Pistole: závěr cykluje při výstřelu; po posledním náboji zůstane vzadu (záchyt) do přebití.
      const u = (this.time - this.slideAt) / 0.07;
      const pulse = u >= 0 && u <= 1 ? Math.sin(Math.PI * u) : 0;
      const locked = ws && ws.mag === 0 && (ws.action !== 'reload' || reloadT < 0.75) ? 1 : 0;
      slide = Math.max(pulse, locked);
    }
    if (this.handle && this.model.moving.chargingHandle && this.model.cycle !== 'bolt') this.handle.position.copy(this.model.moving.chargingHandle.pivot).addScaledVector(this.model.moving.chargingHandle.travel ?? new THREE.Vector3(), slide);
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
    // Pásové přebití: zbraň níž, blíž a horní stranou k hráči (lůžko a víko v obraze).
    const bt = belt && reloadT > 0 ? Math.sin(Math.min(1, reloadT * 1.08) * Math.PI) : 0;
    // Nabíjení po jednom: zbraň zvednutá a přetočená spodkem k hráči (nabíjecí otvor v obraze).
    const sgl = this.model.reloadStyle === 'single' && reloadT > 0 ? Math.min(1, reloadT * 8, (1 - reloadT) * 8) : 0;
    pr.position.set(
      this.swayX * 0.1 + Math.cos(bobPhase) * bobH - sprintPose * 0.02 + tilt * 0.02 - bt * 0.015 - sgl * 0.06,
      this.swayY * 0.1 + Math.sin(bobPhase * 2) * bobV - sprintPose * 0.08 - this.lower * 0.07 - (1 - this.equipT) * 0.35 - tilt * 0.03 - bt * 0.035 + sgl * 0.07,
      kickBack + sprintPose * 0.02 + this.lower * 0.12 + bt * 0.03 + sgl * 0.04,
    );
    pr.rotation.set(
      -sprintPose * THREE.MathUtils.degToRad(20) + this.swayY * 0.6 + kickPitch - this.lower * 0.55 + (1 - this.equipT) * 0.6 + tilt * 0.18 - bt * 0.12 + sgl * 0.15,
      sprintPose * THREE.MathUtils.degToRad(10) + this.swayX * 0.6 + tilt * 0.12,
      sprintPose * THREE.MathUtils.degToRad(8) - tilt * 0.42 + bt * 0.22 - sgl * 0.75,
    );
    this.placeForearms();

    // Osa kolimátoru ve světě (pro výpočet tečky v nekonečnu).
    if (this.reticle && this.reticleMat) {
      this.reticle.updateWorldMatrix(true, false);
      const q = new THREE.Quaternion();
      this.reticle.getWorldQuaternion(q);
      (this.reticleMat.uniforms.uAxis.value as THREE.Vector3).set(0, 0, -1).applyQuaternion(q);
    }

    this.updateCasings(dt);
  }

  /** Poloha hlavice páky závěru (prostor zbraně) pro zdvih `lift` a zátah `back` (0–1). */
  private boltHandleAt(lift: number, back: number) {
    const ch = this.model.moving.chargingHandle!;
    const rel = this.model.points.chargingHandle.clone().sub(ch.pivot).applyAxisAngle(new THREE.Vector3(0, 0, 1), lift * BOLT_LIFT);
    return rel.add(ch.pivot).addScaledVector(ch.travel ?? new THREE.Vector3(), back);
  }

  /**
   * Opakovačka. Po výstřelu: ruka z rukojeti na páku → zvednout → vzad (vyhození nábojnice) →
   * vpřed → dolů → zpět na rukojeť. Přebití: otevřít závěr, náboje po jednom do okna, zavřít.
   * Časy přebití ze simulace (normalizované), cyklus podle kadence pravidel.
   */
  private updateBolt(ws: WeaponState | null, reloadT: number) {
    if (this.model.cycle !== 'bolt' || !this.handle) return;
    const sm = THREE.MathUtils.smoothstep;
    const P = this.model.points;
    let lift = 0, back = 0, blend = 0;
    let target: THREE.Vector3 | null = null;
    const onHandle = (l: number, b: number) => this.boltHandleAt(l, b).add(new THREE.Vector3(0.018, -0.012, 0.06));
    this.busy = false;
    this.mag.visible = false;
    if (ws?.action === 'reload') {
      this.busy = true;
      this.boltStart = -1;
      if (ws.actionStart !== this.boltReloadKey) {
        this.boltReloadKey = ws.actionStart;
        this.boltRounds = THREE.MathUtils.clamp(this.rules.magazine - ws.mag, 1, this.rules.magazine);
        this.boltSound = 0;
      }
      const k = reloadT;
      lift = sm(k, 0.05, 0.09) * (1 - sm(k, 0.93, 0.96));
      back = sm(k, 0.09, 0.15) * (1 - sm(k, 0.88, 0.93));
      blend = sm(k, 0, 0.05) * (1 - sm(k, 0.96, 1));
      target = onHandle(lift, back);
      if (this.boltSound === 0 && k > 0.12) {
        this.boltSound = 1;
        this.onMech('bolt');
      }
      const r0 = 0.18, r1 = 0.82, n = this.boltRounds;
      if (k > 0.15 && k < 0.84) {
        // Náboje po jednom: páka → sumka → okno pouzdra (náboj v prstech, zatlačení do schránky).
        const port = P.loadingPort ?? P.magazineSocket;
        const pouch = new THREE.Vector3(0.16, -0.32, 0.18);
        const ready = port.clone().add(new THREE.Vector3(0.05, 0.04, 0.09));
        const u0 = THREE.MathUtils.clamp((k - r0) / (r1 - r0), 0, 0.9999) * n;
        const i = Math.floor(u0), u = u0 - i;
        const from = i === 0 ? onHandle(lift, back) : ready;
        target = u < 0.35 ? from.clone().lerp(pouch, sm(u, 0, 0.35)) : u < 0.7 ? pouch.clone().lerp(ready, sm(u, 0.35, 0.7)) : ready.clone().lerp(port.clone().add(new THREE.Vector3(0.02, 0.012, 0.06)), sm(u, 0.7, 0.88));
        if (k > r1) target = ready.clone().lerp(onHandle(lift, back), sm(k, r1, 0.84));
        const show = k < r1 && u > 0.3 && u < 0.9;
        this.mag.visible = show;
        if (show) {
          this.mag.position.copy(target).add(new THREE.Vector3(-0.022, 0.012, -0.05)).lerp(port, sm(u, 0.72, 0.9));
          this.mag.rotation.set(0, 0, 0);
        }
        if (this.boltSound <= i + 1 && u > 0.86) {
          this.boltSound = i + 2;
          this.onMech('shell');
        }
      }
      if (this.boltSound < 100 && k > 0.92) {
        this.boltSound = 100;
        this.onMech('bolt');
      }
    } else if (this.boltStart >= 0) {
      this.busy = true;
      const D = Math.min(1.0, this.rules.fireInterval * 0.75);
      const u = (this.time - this.boltStart) / D;
      if (u > 1) {
        this.boltStart = -1;
        this.busy = false;
      } else if (u >= 0) {
        lift = sm(u, 0.15, 0.28) * (1 - sm(u, 0.66, 0.76));
        back = sm(u, 0.28, 0.45) * (1 - sm(u, 0.5, 0.66));
        blend = sm(u, 0, 0.15) * (1 - sm(u, 0.8, 1));
        target = onHandle(lift, back);
        if (this.boltSound === 0 && u > 0.3) {
          this.boltSound = 1;
          this.onMech('bolt');
        }
        if (this.boltSound === 1 && u > 0.42) {
          this.boltSound = 2;
          if (this.showCasings) this.ejectCasing();
        }
      }
    }
    this.handle.position.copy(this.model.moving.chargingHandle!.pivot).addScaledVector(this.model.moving.chargingHandle!.travel ?? new THREE.Vector3(), back);
    this.handle.rotation.set(0, 0, lift * BOLT_LIFT);
    this.rightBlend = blend;
    if (target) this.rightTarget.copy(target);
  }

  /**
   * Pumpa po výstřelu (vzad → vpřed během kadence) a nabíjení po jednom podle časů pravidel:
   * příprava → pro každý náboj ruka k sumce, s nábojem k otvoru, zatlačení → dopumpování po prázdné zbrani.
   */
  private updatePumpAndShells(ws: WeaponState | null, simTime: number, empty: number) {
    const sm = THREE.MathUtils.smoothstep;
    const R = this.rules;
    let pumpPos = 0;
    if (this.model.cycle === 'pump' && this.pumpStart >= 0) {
      const dur = Math.min(0.55, R.fireInterval * 0.6);
      const u = (this.time - this.pumpStart) / dur;
      if (u >= 0 && u <= 1) {
        pumpPos = u < 0.5 ? sm(u, 0, 0.5) : 1 - sm(u, 0.5, 1);
        if (!this.pumpSounded) {
          this.pumpSounded = true;
          this.onMech('pump');
          if (this.showCasings) this.ejectCasing();
        }
      }
    }
    this.singleTarget = null;
    const single = this.model.reloadStyle === 'single' && ws?.action === 'reload';
    if (!single) {
      if (this.model.reloadStyle === 'single') this.mag.visible = false;
      this.shellCount = -1;
    } else {
      const P = this.model.points;
      const port = P.loadingPort ?? P.magazineSocket;
      const rel = simTime - ws!.actionStart;
      const st = R.shellStart ?? 0.4, ins = R.shellInsert ?? 0.5;
      const n = ws!.shellsPlanned;
      const ready = port.clone().add(new THREE.Vector3(-0.05, -0.05, 0.035));
      const pouch = new THREE.Vector3(-0.1, -0.3, 0.12);
      const pumpHand = new THREE.Vector3(-0.05, P.gripLeft.y - 0.032, P.gripLeft.z + 0.012);
      let showShell = false;
      const shellPos = new THREE.Vector3();
      if (rel < st) {
        this.singleTarget = pumpHand.clone().lerp(ready, sm(rel / st, 0.1, 1));
      } else if (rel < st + n * ins) {
        const i = Math.floor((rel - st) / ins);
        const u = (rel - st) / ins - i;
        const t = ready.clone();
        if (u < 0.35) t.lerp(pouch, sm(u, 0, 0.35));
        else if (u < 0.7) t.copy(pouch).lerp(ready, sm(u, 0.35, 0.7));
        else t.lerpVectors(ready, port.clone().add(new THREE.Vector3(-0.035, -0.035, 0.02)), sm(u, 0.7, 0.86));
        this.singleTarget = t;
        showShell = u > 0.28 && u < 0.88;
        const inHand = t.clone().add(new THREE.Vector3(0.03, 0.012, -0.035));
        shellPos.copy(inHand).lerp(port.clone().add(new THREE.Vector3(0, 0.012, -0.02)), sm(u, 0.72, 0.88));
        if (i !== this.shellCount && u > 0.85) {
          this.shellCount = i;
          this.onMech('shell');
        }
      } else {
        // Dopumpování po prázdné zbrani (ruka zpět na pumpě).
        const ch = R.chamberTime ?? 0.6;
        const c = empty ? (rel - st - n * ins) / ch : 1;
        this.singleTarget = ready.clone().lerp(pumpHand, sm(c, 0, 0.3));
        if (empty && c > 0.3 && c < 1) {
          const v = (c - 0.3) / 0.7;
          pumpPos = v < 0.5 ? sm(v, 0, 0.5) : 1 - sm(v, 0.5, 1);
          if (this.shellCount !== -2) {
            this.shellCount = -2;
            this.onMech('pump');
          }
        }
      }
      this.mag.visible = showShell;
      if (showShell) {
        this.mag.position.copy(shellPos);
        this.mag.rotation.set(0, 0, 0);
      }
      // Ruka na pumpě sleduje její polohu i během dopumpování.
      if (this.singleTarget && pumpPos > 0) this.singleTarget.z += pumpPos * (this.model.moving.pump?.travel?.z ?? 0);
    }
    this.pumpPos = pumpPos;
    if (this.pump && this.model.moving.pump) this.pump.position.copy(this.model.moving.pump.pivot).addScaledVector(this.model.moving.pump.travel ?? new THREE.Vector3(), pumpPos);
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
    for (const g of [...this.geometries, this.casingGeo]) g.dispose();
    this.handGeo.dispose();
    // Kostra skinned rukou drží vlastní texturu kostí – bez uvolnění by každé spuštění hry ponechalo 2 textury.
    this.rightHand.mesh.skeleton.dispose();
    this.leftHand.mesh.skeleton.dispose();
    this.flash.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
