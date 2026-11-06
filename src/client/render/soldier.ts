import * as THREE from 'three';
import type { PlayerView } from '../runtime/driver';
import { arsenalEntry } from '../../shared/config/arsenal';
import { WORLD_LOD, worldWeapon } from './weapons/worldModel';
import { createSkeleton, type BoneName } from './soldier/rig';
import { makeUniformAtlas, soldierGeometry, type SoldierFaction, type SoldierVariant } from './soldier/body';
import { SoldierAnimator, type AnimInput } from './soldier/animator';

/**
 * Vzdálení vojáci (world model): skinned tělo podle frakce a role (factionId + classId z výbavy),
 * vlastní kostra a animační stav každého vojáka, sdílená geometrie, atlas a materiály.
 * Draw calls na vojáka: tělo 2 (uniforma + výstroj) + zbraň 1. Lokální ruce se na cizí
 * postavě nikdy nezobrazují; herní hitboxy určuje server, LOD je nemění.
 */
const LOD_DIST = [18, 55] as const;
const LOD_HZ = [0, 20, 10];
/** Jak dlouho zůstane tělo padlého na místě (s) – konfigurovatelné podle výkonu. */
export const CORPSE_TIME = 10;

export function soldierLook(weaponId: string, team: 'teamA' | 'teamB'): { faction: SoldierFaction; variant: SoldierVariant } {
  const e = arsenalEntry(weaponId);
  const faction: SoldierFaction = e?.faction === 'usmc' ? 'usmc' : e?.faction === 'mec' ? 'mec' : team === 'teamA' ? 'usmc' : 'mec';
  const variant: SoldierVariant = e?.kit === 'assault' || e?.kit === 'medic' || e?.kit === 'sniper' ? e.kit : 'base';
  return { faction, variant };
}

interface Soldier {
  id: string;
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  anim: SoldierAnimator;
  weapon: THREE.Mesh;
  weaponId: string;
  look: string;
  lod: number;
  wlod: number;
  acc: number;
  flash: THREE.Mesh;
  flashUntil: number;
  lastAlive: THREE.Vector3;
  diedAt: number;
  life: PlayerView['life'];
  seen: boolean;
}

export class SoldierPool {
  readonly root = new THREE.Group();
  private soldiers = new Map<string, Soldier>();
  private bodyMats: Record<SoldierFaction, THREE.MeshStandardMaterial>;
  private gearMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  private rifleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  private flashMat = new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
  private flashGeo = new THREE.SphereGeometry(0.06, 6, 6);
  private atlases: THREE.Texture[] = [];
  private time = 0;
  private frustum = new THREE.Frustum();
  /** Statistika (počty podle LOD těla a viditelné postavy). */
  lodCounts = [0, 0, 0];
  visibleCount = 0;
  /** Náhledová scéna: vynucený LOD těla (−1 = podle vzdálenosti). */
  forceLod = -1;

  constructor(private quality: 'low' | 'standard' | 'high') {
    const mk = (f: SoldierFaction) => {
      const t = makeUniformAtlas(f);
      this.atlases.push(t);
      return new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.92, metalness: 0 });
    };
    this.bodyMats = { usmc: mk('usmc'), mec: mk('mec') };
    this.root.name = 'soldiers';
  }

  private create(id: string): Soldier {
    const { bones, byName, skeleton } = createSkeleton();
    const group = new THREE.Group();
    const mesh = new THREE.SkinnedMesh(soldierGeometry('usmc', 'base', 0), [this.bodyMats.usmc, this.gearMat]);
    mesh.frustumCulled = false; // ořez řeší pool podle polohy vojáka (skinned obal se nepočítá)
    mesh.castShadow = true;
    mesh.add(bones[0]);
    mesh.bind(skeleton, new THREE.Matrix4());
    group.add(mesh);
    const ww = worldWeapon('m4a1', this.quality);
    const weapon = new THREE.Mesh(ww.lods[0], this.rifleMat);
    weapon.castShadow = true;
    weapon.frustumCulled = false;
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat);
    flash.position.copy(ww.muzzle);
    flash.visible = false;
    weapon.add(flash);
    this.root.add(group, weapon);
    const s: Soldier = { id, group, mesh, bones: byName, anim: new SoldierAnimator(byName), weapon, weaponId: '', look: '', lod: -1, wlod: -1, acc: 1, flash, flashUntil: 0, lastAlive: new THREE.Vector3(), diedAt: -1, life: 'alive', seen: true };
    this.soldiers.set(id, s);
    return s;
  }

  flash(id: string) {
    const s = this.soldiers.get(id);
    if (s) s.flashUntil = this.time + 0.05;
  }

  /**
   * Snímek: výběr vzhledu a LOD (hystereze), ořez, animace (vzdálené LOD v nižší frekvenci).
   * `simTime` = čas simulace (časy akcí ze serveru), `camera` = ořez a vzdálenost.
   */
  update(list: PlayerView[], dt: number, simTime: number, eye?: THREE.Vector3, camera?: THREE.Camera) {
    this.time += dt;
    this.lodCounts = [0, 0, 0];
    this.visibleCount = 0;
    for (const s of this.soldiers.values()) s.seen = false;
    if (camera) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    for (const p of list) {
      let s = this.soldiers.get(p.id);
      if (!s) s = this.create(p.id);
      s.seen = true;
      // Životní stav a tělo padlého (server přesune mrtvého pod mapu – tělo zůstane na místě smrti).
      if (p.life === 'alive' || p.life === 'downed') s.lastAlive.set(p.state.pos.x, p.state.pos.y, p.state.pos.z);
      if (p.life === 'dead' && s.life !== 'dead') s.diedAt = this.time;
      if (p.life !== 'dead') s.diedAt = -1;
      s.life = p.life;
      const corpse = p.life === 'dead' && s.diedAt >= 0 && this.time - s.diedAt < CORPSE_TIME && s.lastAlive.lengthSq() > 0;
      const show = p.life !== 'dead' || corpse;
      const pos = s.lastAlive;
      const sphere = new THREE.Sphere(pos.clone().add(new THREE.Vector3(0, 0.9, 0)), 1.3);
      const inView = !camera || this.frustum.intersectsSphere(sphere);
      s.group.visible = show && inView;
      s.weapon.visible = s.group.visible;
      if (!s.group.visible) continue;
      this.visibleCount++;
      const d = eye ? pos.distanceTo(eye) : 0;
      // LOD těla s hysterezí 2 m.
      let lod = s.lod < 0 ? (d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2) : s.lod;
      if (d < LOD_DIST[0] - 2) lod = 0;
      else if (d > LOD_DIST[1] + 2) lod = 2;
      else if (d > LOD_DIST[0] + 2 && d < LOD_DIST[1] - 2) lod = 1;
      if (this.forceLod >= 0) lod = this.forceLod;
      const wid = p.weapon.weaponId || 'm4a1';
      const lk = soldierLook(p.primary ?? wid, p.team);
      const key = `${lk.faction}:${lk.variant}`;
      if (key !== s.look || lod !== s.lod) {
        s.mesh.geometry = soldierGeometry(lk.faction, lk.variant, lod);
        s.mesh.material = [this.bodyMats[lk.faction], this.gearMat];
        s.mesh.castShadow = lod < 2;
        s.look = key;
        s.lod = lod;
      }
      let wl = s.wlod;
      if (d < WORLD_LOD[0] - 2) wl = 0;
      else if (d > WORLD_LOD[1] + 2) wl = 2;
      else if (wl < 0 || (d > WORLD_LOD[0] + 2 && d < WORLD_LOD[1] - 2)) wl = 1;
      const ww = worldWeapon(wid, this.quality);
      if (wid !== s.weaponId || wl !== s.wlod) {
        s.weapon.geometry = ww.lods[wl];
        s.flash.position.copy(ww.muzzle);
        s.weaponId = wid;
        s.wlod = wl;
      }
      s.weapon.castShadow = wl < 2;
      this.lodCounts[lod]++;
      // Vzdálené LOD: kostra 20 / 10 Hz (stav akcí se dál odvozuje z hodin simulace).
      s.acc += dt;
      const hz = LOD_HZ[lod];
      if (hz && s.acc < 1 / hz) continue;
      const step = s.acc;
      s.acc = 0;
      s.group.position.copy(pos);
      const ps = p.state;
      const inp: AnimInput = {
        pos,
        vel: new THREE.Vector3(ps.vel.x, ps.vel.y, ps.vel.z),
        yaw: ps.yaw,
        pitch: ps.pitch,
        bodyYaw: ps.bodyYaw,
        height: ps.height,
        grounded: ps.grounded,
        sprinting: ps.sprinting,
        ads: p.weapon.adsProgress,
        action: p.weapon.action,
        actionStart: p.weapon.actionStart,
        actionEnd: p.weapon.actionEnd,
        shotSeq: p.weapon.shotSeq,
        life: p.life,
        lastLandAt: ps.lastLandAt,
        seed: hashId(p.id),
      };
      s.anim.update(inp, simTime, step, s.group, s.weapon, ww);
      s.flash.visible = this.time < s.flashUntil;
    }
    for (const [id, s] of this.soldiers) {
      if (!s.seen) {
        s.group.removeFromParent();
        s.weapon.removeFromParent();
        s.mesh.skeleton.dispose();
        this.soldiers.delete(id);
      }
    }
  }

  get count() {
    return this.soldiers.size;
  }

  dispose() {
    for (const s of this.soldiers.values()) s.mesh.skeleton.dispose();
    for (const m of [...Object.values(this.bodyMats), this.gearMat, this.rifleMat, this.flashMat]) m.dispose();
    for (const t of this.atlases) t.dispose();
    this.flashGeo.dispose();
    this.root.removeFromParent();
    this.soldiers.clear();
  }
}

function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
