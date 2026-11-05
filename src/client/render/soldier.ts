import * as THREE from 'three';
import { MOVEMENT } from '../../shared/config/movement';
import type { PlayerView } from '../runtime/driver';
import { WORLD_LOD, worldWeapon } from './weapons/worldModel';

/**
 * Vzdálený voják (world model): jednoduchá postava se dvěma týmovými variantami
 * a světovým modelem pušky. Póza z výšky těla (stejný průběh jako hitbox), nohy podle rychlosti.
 * Lokální ruce se na cizí postavě nikdy nezobrazují.
 */
const UNIFORM = { teamA: { cloth: '#b59e7a', vest: '#8c7b5c', helmet: '#a08b67' }, teamB: { cloth: '#5d6446', vest: '#4a5038', helmet: '#525a3e' } };

interface Soldier {
  id: string;
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  rifle: THREE.Mesh;
  weaponId: string;
  lod: number;
  flash: THREE.Mesh;
  flashUntil: number;
  phase: number;
  seen: boolean;
}

export class SoldierPool {
  readonly root = new THREE.Group();
  private soldiers = new Map<string, Soldier>();
  private mats: Record<'teamA' | 'teamB', { cloth: THREE.Material; vest: THREE.Material; helmet: THREE.Material }>;
  private skin = new THREE.MeshStandardMaterial({ color: '#b78a6a', roughness: 0.7 });
  private gear = new THREE.MeshStandardMaterial({ color: '#2b2a27', roughness: 0.8 });
  private quality: 'low' | 'standard' | 'high';
  /** Statistika posledního snímku (počet postav podle LOD zbraně). */
  lodCounts = [0, 0, 0];
  private rifleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  private flashMat = new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
  private geo: Record<string, THREE.BufferGeometry> = {};
  private time = 0;

  constructor(quality: 'low' | 'standard' | 'high') {
    const mk = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
    this.mats = {
      teamA: { cloth: mk(UNIFORM.teamA.cloth), vest: mk(UNIFORM.teamA.vest), helmet: mk(UNIFORM.teamA.helmet) },
      teamB: { cloth: mk(UNIFORM.teamB.cloth), vest: mk(UNIFORM.teamB.vest), helmet: mk(UNIFORM.teamB.helmet) },
    };
    // Světové modely zbraní: sdílená mezipaměť podle zbraně a kvality (LOD0–2), jeden mesh na postavu.
    this.quality = quality;
    const seg = quality === 'low' ? 6 : 10;
    this.geo = {
      torso: new THREE.BoxGeometry(0.42, 0.55, 0.24),
      vest: new THREE.BoxGeometry(0.46, 0.4, 0.3),
      head: new THREE.SphereGeometry(0.11, seg, seg),
      helmet: new THREE.SphereGeometry(0.135, seg, seg, 0, Math.PI * 2, 0, Math.PI / 1.8),
      limb: new THREE.CapsuleGeometry(0.065, 0.36, 2, seg).translate(0, -0.24, 0),
      leg: new THREE.CapsuleGeometry(0.08, 0.66, 2, seg).translate(0, -0.42, 0),
      boot: new THREE.BoxGeometry(0.12, 0.1, 0.26).translate(0, -0.84, -0.04),
      flash: new THREE.SphereGeometry(0.06, 6, 6),
    };
    this.root.name = 'soldiers';
  }

  private create(id: string, team: 'teamA' | 'teamB'): Soldier {
    const m = this.mats[team];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number]) => {
      const x = new THREE.Mesh(g, mat);
      x.position.set(...pos);
      x.castShadow = true;
      return x;
    };
    // Kostra v klidu: pánev v 0,95 m, trup nad ní (body = pánev).
    body.position.y = 0.95;
    body.add(mesh(this.geo.torso, m.cloth, [0, 0.3, 0]), mesh(this.geo.vest, m.vest, [0, 0.33, 0]), mesh(this.geo.head, this.skin, [0, 0.72, -0.01]), mesh(this.geo.helmet, m.helmet, [0, 0.75, 0]));
    const legL = new THREE.Object3D(), legR = new THREE.Object3D();
    legL.position.set(-0.11, 0, 0);
    legR.position.set(0.11, 0, 0);
    for (const l of [legL, legR]) {
      l.add(mesh(this.geo.leg, m.cloth, [0, 0, 0]), mesh(this.geo.boot, this.gear, [0, 0, 0]));
      body.add(l);
    }
    const armL = new THREE.Object3D(), armR = new THREE.Object3D();
    armL.position.set(-0.25, 0.52, 0);
    armR.position.set(0.25, 0.52, 0);
    armL.add(mesh(this.geo.limb, m.cloth, [0, 0, 0]));
    armR.add(mesh(this.geo.limb, m.cloth, [0, 0, 0]));
    armL.rotation.set(-1.2, 0, 0.5);
    armR.rotation.set(-0.9, 0, -0.2);
    body.add(armL, armR);
    const ww = worldWeapon('m4a1', this.quality);
    const rifle = new THREE.Mesh(ww.lods[0], this.rifleMat);
    rifle.castShadow = true;
    rifle.position.set(0.14, 0.42, -0.25);
    body.add(rifle);
    const flash = new THREE.Mesh(this.geo.flash, this.flashMat);
    flash.position.copy(ww.muzzle);
    flash.visible = false;
    rifle.add(flash);
    this.root.add(root);
    const s: Soldier = { id, root, body, legL, legR, armL, armR, rifle, weaponId: 'm4a1', lod: 0, flash, flashUntil: 0, phase: 0, seen: true };
    this.soldiers.set(id, s);
    return s;
  }

  flash(id: string) {
    const s = this.soldiers.get(id);
    if (s) s.flashUntil = this.time + 0.05;
  }

  update(list: PlayerView[], dt: number, _simTime: number, eye?: THREE.Vector3) {
    this.time += dt;
    this.lodCounts = [0, 0, 0];
    for (const s of this.soldiers.values()) s.seen = false;
    const st = MOVEMENT.stances;
    for (const p of list) {
      let s = this.soldiers.get(p.id);
      if (!s) s = this.create(p.id, p.team);
      s.seen = true;
      s.root.visible = p.alive;
      if (!p.alive) continue;
      const ps = p.state;
      s.root.position.set(ps.pos.x, ps.pos.y, ps.pos.z);
      // Postoj: stejná výška těla jako collider a hitbox.
      const prone = ps.height <= st.prone.height + 0.05;
      const crouchK = THREE.MathUtils.clamp((st.stand.height - ps.height) / (st.stand.height - st.crouch.height), 0, 1);
      s.root.rotation.set(0, prone ? ps.bodyYaw : ps.yaw, 0);
      if (prone) {
        s.body.position.set(0, 0.25, 0);
        s.body.rotation.set(-Math.PI / 2 + 0.05, 0, 0);
      } else {
        s.body.position.set(0, 0.95 - crouchK * 0.45, 0);
        s.body.rotation.set(-crouchK * 0.25 + ps.pitch * 0.25, 0, 0);
      }
      const speed = Math.hypot(ps.vel.x, ps.vel.z);
      s.phase += dt * speed * 2.6;
      const swing = Math.min(1, speed / 4) * 0.55 * Math.sin(s.phase);
      s.legL.rotation.x = swing + crouchK * 1.0;
      s.legR.rotation.x = -swing + crouchK * 1.0;
      s.rifle.rotation.x = ps.pitch * 0.8;
      s.flash.visible = this.time < s.flashUntil;
      // Zbraň podle výbavy a LOD podle vzdálenosti od kamery (bez nápadného přeskakování: hystereze 2 m).
      const d = eye ? s.root.position.distanceTo(eye) : 0;
      let lod = s.lod;
      if (d < WORLD_LOD[0] - 2) lod = 0;
      else if (d > WORLD_LOD[1] + 2) lod = 2;
      else if (d > WORLD_LOD[0] + 2 && d < WORLD_LOD[1] - 2) lod = 1;
      const wid = p.weapon.weaponId || 'm4a1';
      if (wid !== s.weaponId || lod !== s.lod) {
        const ww = worldWeapon(wid, this.quality);
        s.rifle.geometry = ww.lods[lod];
        s.flash.position.copy(ww.muzzle);
        s.weaponId = wid;
        s.lod = lod;
      }
      s.rifle.castShadow = lod < 2;
      this.lodCounts[lod]++;
    }
    for (const [id, s] of this.soldiers) {
      if (!s.seen) {
        s.root.removeFromParent();
        this.soldiers.delete(id);
      }
    }
  }

  get count() {
    return this.soldiers.size;
  }

  dispose() {
    for (const g of Object.values(this.geo)) g.dispose();
    for (const t of Object.values(this.mats)) for (const m of Object.values(t)) m.dispose();
    this.skin.dispose();
    this.gear.dispose();
    this.rifleMat.dispose();
    this.flashMat.dispose();
    this.root.removeFromParent();
    this.soldiers.clear();
  }
}
