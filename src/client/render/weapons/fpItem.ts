import * as THREE from 'three';
import type { WeaponState } from '../../../shared/sim/weapon';
import type { PlayerState } from '../../../shared/sim/player';
import { HAND_LOOKS, Hand, POSES, buildHandGeometry, makeCamoTexture, type HandGeometry } from './hands';
import { buildItem, type ItemKindModel } from './items';
import type { WeaponModel } from './types';

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
  private swingAt = -10;
  private time = 0;
  private equipT = 0;
  /** Stejné rozhraní jako FPWeapon (hra čte optiku a zaneprázdnění). */
  readonly model: { optic?: WeaponModel['optic'] } = {};
  busy = false;
  showCasings = false;
  onShot: () => void = () => {};
  onMech: (kind: 'pump' | 'shell' | 'cover' | 'bolt') => void = () => {};

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
  }

  update(dt: number, ps: PlayerState, ws: WeaponState | null, simTime: number, bobPhase: number, bobAmp: number, lookDYaw: number, lookDPitch: number) {
    this.time += dt;
    if (!ws) return;
    const span = Math.max(1e-3, ws.actionEnd - ws.actionStart);
    const u = THREE.MathUtils.clamp((simTime - ws.actionStart) / span, 0, 1);
    if (ws.action === 'equip') this.equipT = u;
    else this.equipT = Math.min(1, this.equipT + dt * 4);
    if (ws.shotSeq !== this.lastSeq) {
      if (this.lastSeq >= 0) this.swingAt = this.time;
      this.lastSeq = ws.shotSeq;
    }
    const base = BASE[this.kind];
    const p = new THREE.Vector3(...base.pos), r = new THREE.Euler(...base.rot);
    const e = this.equipT * this.equipT * (3 - 2 * this.equipT);
    p.y -= (1 - e) * 0.32;
    r.x += (1 - e) * 0.7;
    let showItem = true;
    let leftTarget: THREE.Vector3 | null = null;
    this.busy = ws.action === 'attack' || ws.action === 'throw' || ws.action === 'use';
    if (ws.action === 'attack' && this.kind === 'knife') {
      // Nápřah vpravo nahoru → sek šikmo doleva dolů → návrat.
      const wind = sm(u, 0, 0.28), strike = sm(u, 0.28, 0.5), back = sm(u, 0.62, 1);
      p.x += wind * 0.05 - strike * 0.17 + back * 0.12;
      p.y += wind * 0.06 - strike * 0.09 + back * 0.03;
      p.z += -strike * 0.12 + back * 0.12;
      r.x += -wind * 0.3 + strike * 0.55 - back * 0.25;
      r.y += wind * 0.4 - strike * 1.1 + back * 0.7;
      r.z += -wind * 0.6 + strike * 1.0 - back * 0.4;
    } else if (ws.action === 'throw') {
      // Pojistka (levá ruka) → nápřah za hlavu → hod; po uvolnění je ruka prázdná.
      const pin = sm(u, 0.02, 0.15) * (1 - sm(u, 0.2, 0.3));
      const wind = sm(u, 0.2, 0.45), thr = sm(u, 0.45, 0.58), rec = sm(u, 0.62, 1);
      leftTarget = p.clone().add(new THREE.Vector3(-0.05, 0.06, 0.02)).lerp(new THREE.Vector3(-0.2, -0.45, -0.2), 1 - pin);
      p.x += wind * 0.06 - thr * 0.1 + rec * 0.04;
      p.y += wind * 0.22 - thr * 0.18 - rec * 0.1;
      p.z += wind * 0.12 - thr * 0.32 + rec * 0.2;
      r.x += -wind * 1.0 + thr * 1.6 - rec * 0.6;
      showItem = u < 0.52;
      if (Math.abs(u - 0.5) < 0.02 && this.time - this.swingAt < 2) this.onMech('cover');
    } else if (ws.action === 'use') {
      // Nástroj před sebe (léčení / zásobování / elektrody k tělu spolubojovníka).
      const reach = sm(u, 0, 0.2);
      const pulse = Math.sin(this.time * 9) * 0.008;
      p.z -= reach * 0.14;
      p.y += reach * (this.kind === 'defib' ? -0.03 : 0.02) + pulse;
      r.x += reach * (this.kind === 'defib' ? -0.6 : -0.2);
    }
    if ((this.kind === 'frag' || this.kind === 'smoke') && ws.mag <= 0 && ws.action !== 'throw') showItem = false;
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
