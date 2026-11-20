import * as THREE from 'three';
import type { WeaponState } from '../../../shared/sim/weapon';
import type { PlayerState } from '../../../shared/sim/player';
import { HAND_LOOKS, Hand, POSES, buildHandGeometry, makeCamoTexture, type HandGeometry } from './hands';
import { buildItem, type ItemKindModel } from './items';
import type { WeaponModel } from './types';
import { ITEM_RULES } from '../../../shared/sim/matchItems';

/**
 * Nestřelná položka v první osobě (nůž, granáty, lékárna, defibrilátor, zásobování) s rukama.
 * Animace se řídí stavem simulace (akce + čas): tasení zdola, útok nožem (nápřah → sek →
 * návrat), hod (vytažení pojistky levou rukou → nápřah → hod, předmět opustí ruku v okamžiku
 * hodu), použití nástroje (natažení před sebe s pulzem). Kosmetika nikdy nemění výsledek –
 * zásah, hod i léčení rozhoduje server.
 */
interface Pose {
  pos: [number, number, number];
  rot: [number, number, number];
}

const BASE: Record<ItemKindModel, Pose> = {
  knife: { pos: [0.15, -0.165, -0.36], rot: [-0.95, 0.3, -0.4] },
  frag: { pos: [0.15, -0.15, -0.32], rot: [0.25, 0.4, 0.1] },
  smoke: { pos: [0.15, -0.15, -0.32], rot: [0.25, 0.4, 0.1] },
  medkit: { pos: [0.13, -0.15, -0.4], rot: [0.2, 0.45, 0.0] },
  ammo: { pos: [0.13, -0.14, -0.42], rot: [0.2, 0.45, 0.0] },
  defib: { pos: [0.12, -0.21, -0.38], rot: [-0.3, 0.05, 0.05] },
};

const sm = THREE.MathUtils.smoothstep;

export class FPItem {
  readonly root = new THREE.Group();
  private pres = new THREE.Group();
  private itemRoot = new THREE.Group();
  private itemMesh = new THREE.Group();
  private second = new THREE.Group();
  private rightHand: Hand;
  private leftHand: Hand;
  private handGeo: HandGeometry;
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private lastSeq = -1;
  private time = 0;
  private equipT = 0;
  /** Stejné rozhraní jako FPWeapon (hra čte optiku a zaneprázdnění). */
  readonly model: { optic?: WeaponModel['optic'] } = {};
  busy = false;
  showCasings = false;
  onShot: () => void = () => {};
  onMech: (kind: 'pump' | 'shell' | 'cover' | 'bolt' | 'pin' | 'spoon') => void = () => {};
  /** Pojistný kroužek granátu v levé ruce (po vytažení). */
  private pinRing: THREE.Mesh | null = null;
  private pinSeq = -1;
  private spoonSeq = -1;

  constructor(readonly kind: ItemKindModel, lookId: string, quality: 'low' | 'standard' | 'high' = 'standard') {
    const seg = quality === 'low' ? 0.6 : quality === 'high' ? 1.25 : 1;
    const metal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide });
    const soft = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.85, side: THREE.DoubleSide });
    const look = HAND_LOOKS[lookId] ?? HAND_LOOKS.usmcAssault;
    const camo = makeCamoTexture(look.sleeve);
    this.textures.push(camo);
    const glove = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.88, side: THREE.DoubleSide });
    const sleeve = new THREE.MeshStandardMaterial({ map: camo, vertexColors: true, metalness: 0, roughness: 0.92, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, metalness: 0, roughness: 0.7, side: THREE.DoubleSide });
    this.materials.push(metal, soft, glove, sleeve, skin);
    const m = buildItem(kind);
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      parent.add(mesh);
      this.geometries.push(g);
    };
    add(m.metal, metal, this.itemMesh);
    add(m.soft, soft, this.itemMesh);
    this.itemRoot.add(this.itemMesh);
    if (m.second) {
      add(m.second.metal, metal, this.second);
      add(m.second.soft, soft, this.second);
    }
    this.handGeo = buildHandGeometry(look, seg);
    this.rightHand = new Hand('right', { glove, sleeve, skin }, look, this.handGeo);
    this.leftHand = new Hand('left', { glove, sleeve, skin }, look, this.handGeo);
    // Pravá ruka svírá úchop položky (stejná báze jako pistolová rukojeť zbraní).
    const a = (20 * Math.PI) / 180;
    const rx = new THREE.Vector3(0, -Math.cos(a), Math.sin(a));
    const ry = new THREE.Vector3(1, 0, 0);
    const rz = new THREE.Vector3().crossVectors(rx, ry);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(rx, ry, rz));
    this.rightHand.root.quaternion.copy(q);
    this.rightHand.root.position.set(0.03, -0.005, 0.065);
    this.itemRoot.add(this.rightHand.root);
    this.rightHand.setPose(kind === 'knife' || kind === 'medkit' || kind === 'ammo' ? POSES.grip : POSES.magazine);
    // Levá ruka: druhá elektroda (defibrilátor), jinak volná (pojistka granátu, jinak mimo obraz).
    const lq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(rx.clone(), ry.clone().negate(), rz.clone().negate()));
    if (m.second) {
      this.leftHand.root.quaternion.copy(q);
      this.leftHand.root.position.set(-0.03, -0.005, 0.065);
      this.second.add(this.leftHand.root);
      this.leftHand.setPose(POSES.magazine);
    } else {
      this.leftHand.root.quaternion.copy(lq);
      this.pres.add(this.leftHand.root);
      this.leftHand.setPose(POSES.open);
    }
    for (const h of [this.rightHand, this.leftHand]) this.pres.add(h.forearm);
    this.pres.add(this.itemRoot, this.second);
    this.root.add(this.pres);
    this.root.name = 'fpItem';
    if (kind === 'frag' || kind === 'smoke') {
      // Kroužek pojistky: po vytažení zůstává v prstech levé ruky až do švihu.
      const ringGeo = new THREE.TorusGeometry(0.011, 0.0018, 6, 18);
      this.geometries.push(ringGeo);
      this.pinRing = new THREE.Mesh(ringGeo, metal);
      this.pinRing.position.set(0, -0.02, -0.075);
      this.pinRing.rotation.set(0.3, 0, 0);
      this.pinRing.visible = false;
      this.pinRing.frustumCulled = false;
      this.leftHand.root.add(this.pinRing);
    }
  }

  /** Znovu zobrazená položka z mezipaměti: znovu vytáhnout, zapomenout staré použití. */
  reactivate() {
    this.lastSeq = -1;
    this.pinSeq = this.spoonSeq = -1;
    this.equipT = 0;
  }

  update(dt: number, ps: PlayerState, ws: WeaponState | null, simTime: number, bobPhase: number, bobAmp: number, lookDYaw: number, lookDPitch: number) {
    this.time += dt;
    if (!ws) return;
    const span = Math.max(1e-3, ws.actionEnd - ws.actionStart);
    const u = THREE.MathUtils.clamp((simTime - ws.actionStart) / span, 0, 1);
    if (ws.action === 'equip') this.equipT = u;
    else this.equipT = Math.min(1, this.equipT + dt * 4);
    if (ws.shotSeq !== this.lastSeq) this.lastSeq = ws.shotSeq;
    const base = BASE[this.kind];
    const p = new THREE.Vector3(...base.pos), r = new THREE.Euler(...base.rot);
    const e = this.equipT * this.equipT * (3 - 2 * this.equipT);
    p.y -= (1 - e) * 0.32;
    r.x += (1 - e) * 0.7;
    let showItem = true;
    let leftTarget: THREE.Vector3 | null = null;
    this.busy = ws.action === 'attack' || ws.action === 'throw' || ws.action === 'windup' || ws.action === 'use';
    if (ws.action === 'attack' && this.kind === 'knife') {
      // Nápřah vpravo nahoru → sek šikmo doleva dolů → návrat.
      const wind = sm(u, 0, 0.28), strike = sm(u, 0.28, 0.5), back = sm(u, 0.62, 1);
      p.x += wind * 0.05 - strike * 0.17 + back * 0.12;
      p.y += wind * 0.06 - strike * 0.09 + back * 0.03;
      p.z += -strike * 0.12 + back * 0.12;
      r.x += -wind * 0.3 + strike * 0.55 - back * 0.25;
      r.y += wind * 0.4 - strike * 1.1 + back * 0.7;
      r.z += -wind * 0.6 + strike * 1.0 - back * 0.4;
    } else if (ws.action === 'windup' || ws.action === 'throw') {
      // Granát: levá ruka sáhne na pojistku a vytáhne ji (cvak, kroužek v prstech) → pravá ruka
      // nápřah za hlavu, levá míří vpřed; nápřah se drží, dokud hráč drží spoušť → švih,
      // granát opustí ruku (odskok páčky) → dokončení pohybu a prázdná ruka mizí dolů.
      const T = ITEM_RULES.throw;
      const raisePose = (k: number) => {
        p.x += k * 0.07;
        p.y += k * 0.2;
        p.z += k * 0.15;
        r.x -= k * 1.05;
        r.z += k * 0.25;
      };
      const point = new THREE.Vector3(-0.17, -0.1, -0.42);
      const rest = new THREE.Vector3(-0.22, -0.5, -0.2);
      if (ws.action === 'windup') {
        const w = THREE.MathUtils.clamp((simTime - ws.actionStart) / T.prep, 0, 1);
        const grab = sm(w, 0, 0.3), pull = sm(w, 0.3, 0.55), aim = sm(w, 0.6, 1);
        raisePose(sm(w, 0.45, 1));
        // Držený nápřah: drobné chvění ruky.
        if (w >= 1) p.y += Math.sin(this.time * 3.1) * 0.003;
        const atPin = p.clone().add(new THREE.Vector3(-0.035, 0.055, 0.0));
        const pulled = atPin.clone().add(new THREE.Vector3(-0.12, -0.03, 0.05));
        leftTarget = rest.clone().lerp(atPin, grab).lerp(pulled, pull).lerp(point, aim);
        if (this.pinRing) this.pinRing.visible = pull > 0.3;
        if (pull > 0.4 && this.pinSeq !== ws.shotSeq) {
          this.pinSeq = ws.shotSeq;
          this.onMech('pin');
        }
      } else {
        const sw = sm(u, 0, 0.26), follow = sm(u, 0.26, 0.6), lower = sm(u, 0.6, 1);
        raisePose(1 - sw);
        p.x += -sw * 0.08 - follow * 0.06;
        p.y += -sw * 0.12 - follow * 0.14 - lower * 0.22;
        p.z += -sw * 0.3 + follow * 0.08;
        r.x += sw * 1.1 + follow * 0.5;
        r.y += -follow * 0.4;
        const rel = T.releaseAt / T.swing;
        showItem = u < rel;
        leftTarget = point.clone().lerp(rest, sm(u, 0.05, 0.45));
        if (this.pinRing) this.pinRing.visible = u < 0.3;
        if (u >= rel && this.spoonSeq !== ws.shotSeq) {
          this.spoonSeq = ws.shotSeq;
          this.onMech('spoon');
        }
      }
    } else if (ws.action === 'use') {
      // Nástroj před sebe (léčení / zásobování / elektrody k tělu spolubojovníka).
      const reach = sm(u, 0, 0.2);
      const pulse = Math.sin(this.time * 9) * 0.008;
      p.z -= reach * 0.14;
      p.y += reach * (this.kind === 'defib' ? -0.03 : 0.02) + pulse;
      r.x += reach * (this.kind === 'defib' ? -0.6 : -0.2);
    }
    if ((this.kind === 'frag' || this.kind === 'smoke') && ws.mag <= 0 && ws.action !== 'throw' && ws.action !== 'windup') showItem = false;
    if (this.pinRing && ws.action !== 'windup' && ws.action !== 'throw') this.pinRing.visible = false;
    // Kosmetika: bob, sway (jako u zbraní, tlumeně).
    p.x += Math.cos(bobPhase) * Math.min(0.005, bobAmp * 0.45) + THREE.MathUtils.clamp(-lookDYaw * 0.3, -0.02, 0.02);
    p.y += Math.sin(bobPhase * 2) * Math.min(ps.sprinting ? 0.015 : 0.008, bobAmp * 0.7) + THREE.MathUtils.clamp(lookDPitch * 0.3, -0.02, 0.02);
    if (ps.sprinting) {
      p.y -= 0.05;
      r.x -= 0.25;
    }
    this.itemRoot.position.copy(p);
    this.itemRoot.rotation.copy(r);
    this.itemMesh.visible = showItem;
    if (this.second.children.length) {
      // Druhá elektroda zrcadlově vlevo.
      this.second.position.set(-p.x, p.y, p.z);
      this.second.rotation.set(r.x, -r.y, -r.z);
    } else {
      const rest = new THREE.Vector3(-0.22, -0.5, -0.2);
      this.leftHand.root.position.copy(leftTarget ?? rest);
      this.leftHand.root.visible = !!leftTarget;
      this.leftHand.forearm.visible = !!leftTarget;
    }
    this.placeForearms();
  }

  private placeForearms() {
    this.pres.updateMatrixWorld(true);
    for (const [h, elbowLocal] of [
      [this.rightHand, new THREE.Vector3(0.26, -0.5, 0.12)],
      [this.leftHand, new THREE.Vector3(-0.26, -0.5, -0.02)],
    ] as const) {
      const wrist = h.root.getWorldPosition(new THREE.Vector3());
      h.forearm.position.copy(this.pres.worldToLocal(wrist.clone()));
      h.forearm.lookAt(this.pres.localToWorld(elbowLocal.clone()));
    }
  }

  stats() {
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
    for (const g of this.geometries) g.dispose();
    this.handGeo.dispose();
    this.rightHand.mesh.skeleton.dispose();
    this.leftHand.mesh.skeleton.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
