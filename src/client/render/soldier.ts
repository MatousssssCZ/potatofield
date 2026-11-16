import * as THREE from 'three';
import type { PlayerView } from '../runtime/driver';
import { ITEM_EQUIP, SIDEARMS, WEAPON_IDS, arsenalEntry } from '../../shared/config/arsenal';
import { WORLD_LOD, worldWeapon } from './weapons/worldModel';
import { BONE_INDEX, createSkeleton, type BoneName } from './soldier/rig';
import { gearVersionOf, makeUniformAtlas, soldierGeometry, type SoldierFaction, type SoldierVariant } from './soldier/body';
import { MEDIC_BACK } from './soldier/gearV2';
import { SoldierAnimator, type AnimInput } from './soldier/animator';
import { MannequinBody, hasMannequin } from './soldier/mannequin';

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

/**
 * Pod modelem Mannequinu se kreslí jen výstroj z procedurálního těla (helma, vesta, sumky),
 * bez dílů na nohou (nohy modelu jdou podle klipů, výstroj by „plavala“).
 */
const gearCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
const LEG_BONES = new Set<number>((['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as BoneName[]).map((b) => BONE_INDEX[b]));
function gearOnly(src: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = gearCache.get(src);
  if (g) return g;
  const grp = src.groups.find((x) => x.materialIndex === 1);
  const si = src.getAttribute('skinIndex'), sw = src.getAttribute('skinWeight');
  const keep: number[] = [];
  if (grp)
    for (let i = grp.start; i < grp.start + grp.count; i += 3) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) {
        bw = sw.getComponent(i, k);
        best = si.getComponent(i, k);
      }
      if (!LEG_BONES.has(best)) keep.push(i, i + 1, i + 2);
    }
  g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const arr = new (a.array.constructor as Float32ArrayConstructor)(keep.length * a.itemSize);
    keep.forEach((v, j) => {
      for (let c = 0; c < a.itemSize; c++) arr[j * a.itemSize + c] = a.array[v * a.itemSize + c];
    });
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  g.addGroup(0, keep.length, 1);
  gearCache.set(src, g);
  return g;
}

export function soldierLook(weaponId: string, team: 'teamA' | 'teamB'): { faction: SoldierFaction; variant: SoldierVariant } {
  const e = arsenalEntry(weaponId);
  const faction: SoldierFaction = e?.faction === 'usmc' ? 'usmc' : e?.faction === 'mec' ? 'mec' : team === 'teamA' ? 'usmc' : 'mec';
  const variant: SoldierVariant = e?.kit ?? 'base';
  return { faction, variant };
}

interface Soldier {
  id: string;
  /** Měkký stín pod vojákem v interiéru (tam se slunce ani stínová mapa nepočítá). */
  blob: THREE.Mesh;
  patch: THREE.Mesh;
  medic: THREE.Mesh;
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
  /** Varianta pádu zvolená v okamžiku smrti. */
  death: 'clip' | 'clipFast' | 'front' | 'back';
  lastSpeed: number;
  lastFwd: number;
  /** Tělo z modelu (Mannequin), pokud je načtené; procedurální tělo pak kreslí jen výstroj. */
  body: MannequinBody | null;
}

export class SoldierPool {
  readonly root = new THREE.Group();
  private soldiers = new Map<string, Soldier>();
  private bodyMats: Record<SoldierFaction, THREE.MeshStandardMaterial>;
  private gearMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  /** Uniforma procedurálního těla se pod modelem Mannequinu nekreslí (výstroj ano). */
  private hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
  private rifleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  private flashMat = new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
  private flashGeo = new THREE.SphereGeometry(0.06, 6, 6);
  private atlases: THREE.Texture[] = [];
  private time = 0;
  private frustum = new THREE.Frustum();
  /** Statistika (počty podle LOD těla a viditelné postavy). */
  lodCounts = [0, 0, 0];
  visibleCount = 0;
  /** Je místo v interiéru (pod stropem)? Nastavuje aplikace z mřížky stropů. */
  indoor: ((x: number, y: number, z: number) => boolean) | null = null;
  private blobGeo = new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2);
  private blobMat = (() => {
    let map: THREE.Texture | null = null;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      r.addColorStop(0, 'rgba(0,0,0,0.62)');
      r.addColorStop(0.55, 'rgba(0,0,0,0.38)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
      map = new THREE.CanvasTexture(c);
    }
    return new THREE.MeshBasicMaterial({ color: '#000000', map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  })();
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

  /** Obtisky (CC0): nášivka frakce na levém rameni a symbol zdravotníka na batohu medika. */
  private decalGeo = new THREE.PlaneGeometry(1, 1);
  private decalMats = new Map<string, THREE.MeshStandardMaterial>();
  private decalMat(name: string) {
    let m = this.decalMats.get(name);
    if (!m) {
      // Mimo prohlížeč (testy) bez načítání obrázku.
      const t = typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/soldier/${name}.png`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.4, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
      this.decalMats.set(name, m);
    }
    return m;
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
    const body = hasMannequin() ? new MannequinBody(byName) : null;
    if (body) group.add(body.root);
    // Nášivka: vnější strana levého ramene (kost upperArmL, klid −0,19 / 1,39 / 0), čelem k −X.
    const patch = new THREE.Mesh(this.decalGeo, this.decalMat('fc_patch'));
    patch.scale.set(0.08, 0.05, 1);
    patch.position.set(-0.0235, -0.1, -0.012);
    patch.rotation.y = -Math.PI / 2;
    byName.upperArmL.add(patch);
    // Symbol zdravotníka: záda batohu (kost spine2, klid 0 / 1,24 / 0), čelem k +Z.
    const medic = new THREE.Mesh(this.decalGeo, this.decalMat('medic_symbol'));
    medic.scale.set(0.085, 0.085, 1);
    medic.visible = false;
    byName.spine2.add(medic);
    const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
    blob.visible = false;
    blob.renderOrder = 1;
    this.root.add(blob);
    const s: Soldier = { id, blob, patch, medic, group, mesh, bones: byName, anim: new SoldierAnimator(byName), weapon, weaponId: '', look: '', lod: -1, wlod: -1, acc: 1, flash, flashUntil: 0, lastAlive: new THREE.Vector3(), diedAt: -1, life: 'alive', seen: true, body, death: 'clip', lastSpeed: 0, lastFwd: 1 };
    this.soldiers.set(id, s);
    return s;
  }

  /** Vlastní hráč míří puškohledem: vzdálení vojáci se animují v plné frekvenci (jinak je pohyb v optice trhaný). */
  fullRate = false;

  /** Zásah vojáka: škubnutí trupu od střelce. */
  hit(id: string, from: { x: number; z: number } | null, power = 1) {
    const s = this.soldiers.get(id);
    if (s && s.life === 'alive') s.anim.hit(from, s.lastAlive, power);
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
      if (p.life === 'dead' && s.life !== 'dead') {
        s.diedAt = this.time;
        // Varianta pádu: v běhu vpřed přepadne dopředu, při couvání dozadu, jinak podle ID a pořadí smrti.
        const r = (hashId(p.id) + Math.floor(this.time * 7)) % 4;
        s.death = s.lastSpeed > 3 && s.lastFwd > 0.5 ? 'front' : s.lastSpeed > 1.5 && s.lastFwd < -0.5 ? 'back' : (['clip', 'clipFast', 'front', 'back'] as const)[r];
      }
      if (p.life !== 'dead') s.diedAt = -1;
      s.life = p.life;
      const corpse = p.life === 'dead' && s.diedAt >= 0 && this.time - s.diedAt < CORPSE_TIME && s.lastAlive.lengthSq() > 0;
      const show = p.life !== 'dead' || corpse;
      const pos = s.lastAlive;
      const sphere = new THREE.Sphere(pos.clone().add(new THREE.Vector3(0, 0.9, 0)), 1.3);
      const inView = !camera || this.frustum.intersectsSphere(sphere);
      s.group.visible = show && inView;
      s.weapon.visible = s.group.visible;
      s.blob.visible = s.group.visible && !!this.indoor?.(pos.x, pos.y, pos.z);
      if (s.blob.visible) {
        s.blob.position.set(pos.x, pos.y + 0.03, pos.z);
        s.blob.scale.set(p.life === 'dead' ? 1.5 : 1, 1, p.life === 'dead' ? 1.5 : 1);
      }
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
      if (key !== s.look || lod !== s.lod) this.applyLook(s, lk, lod);
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
      const hz = this.fullRate ? 0 : LOD_HZ[lod];
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
        ladder: !!ps.ladder,
        deathKind: s.death === 'front' ? 'front' : s.death === 'back' ? 'back' : undefined,
        seed: hashId(p.id),
      };
      s.anim.update(inp, simTime, step, s.group, s.weapon, ww);
      if (s.body && s.lod < 2) {
        const sp = Math.hypot(ps.vel.x, ps.vel.z);
        // Pohyb vůči pánvi (animátor ji natáčí do směru pohybu; couvání = −1).
        const py = s.anim.pelvisYaw;
        const fwd = sp > 0.01 ? (-Math.sin(py) * ps.vel.x - Math.cos(py) * ps.vel.z) / sp : 1;
        if (p.life === 'alive') {
          s.lastSpeed = sp;
          s.lastFwd = sp > 0.01 ? (-Math.sin(ps.yaw) * ps.vel.x - Math.cos(ps.yaw) * ps.vel.z) / sp : 1;
        }
        s.group.updateMatrixWorld(true);
        s.body.update(step, { group: s.group, speed: sp, forward: fwd, crouch: ps.height < 1.45 && ps.height > 0.8 ? 1 : 0, sprinting: ps.sprinting, grounded: ps.grounded, life: p.life, prone: ps.height <= 0.8, ladder: !!ps.ladder, deathClip: s.death === 'clip' ? 'normal' : s.death === 'clipFast' ? 'fast' : null });
      }
      s.flash.visible = this.time < s.flashUntil;
    }
    for (const [id, s] of this.soldiers) {
      if (!s.seen) {
        s.blob.removeFromParent();
        s.group.removeFromParent();
        s.weapon.removeFromParent();
        s.mesh.skeleton.dispose();
        s.body?.dispose();
        this.soldiers.delete(id);
      }
    }
  }

  /** Tělo a výstroj podle frakce, role a LOD (geometrie a materiály jsou sdílené a v cache). */
  private applyLook(s: Soldier, lk: { faction: SoldierFaction; variant: SoldierVariant }, lod: number) {
    // Model těla na blízko a střední vzdálenost; nejvzdálenější LOD zůstává procedurální (levný).
    const model = !!s.body && lod < 2;
    const full = soldierGeometry(lk.faction, lk.variant, lod);
    s.mesh.geometry = model ? gearOnly(full) : full;
    s.mesh.material = [model ? this.hiddenMat : this.bodyMats[lk.faction], this.gearMat];
    if (s.body) {
      s.body.visible = model;
      s.body.setFaction(lk.faction);
    }
    s.mesh.castShadow = lod < 2;
    s.patch.material = this.decalMat(lk.faction === 'usmc' ? 'fc_patch' : 'dl_patch');
    s.patch.visible = lod < 2;
    s.medic.visible = lod < 2 && lk.variant === 'medic' && gearVersionOf() === 2;
    s.medic.position.set(0, -0.02, MEDIC_BACK[lk.faction] + 0.0035);
    s.look = `${lk.faction}:${lk.variant}`;
    s.lod = lod;
  }

  /**
   * Příprava před hrou, aby se nic nestavělo uprostřed boje: geometrie těl všech frakcí, rolí a LOD,
   * world modely všech zbraní a předmětů a pár vojáků mimo záběr pro překlad shaderů
   * (`renderer.compile`). Bez toho se model stavěl, až když se voják poprvé objevil – typicky
   * přemožitel odhalený serverem v okamžiku smrti (zaseknutí ~0,2 s). Vrací úklid po překladu.
   */
  warmup(): () => void {
    const variants: SoldierVariant[] = ['base', 'assault', 'medic', 'support', 'engineer', 'sniper'];
    for (const f of ['usmc', 'mec'] as SoldierFaction[])
      for (const v of variants)
        for (let lod = 0; lod < 3; lod++) {
          const g = soldierGeometry(f, v, lod);
          if (lod < 2 && hasMannequin()) gearOnly(g);
        }
    for (const id of [...WEAPON_IDS, ...Object.keys(SIDEARMS), ...Object.keys(ITEM_EQUIP)]) {
      try {
        worldWeapon(id, this.quality);
      } catch {
        /* položka bez world modelu (např. lékárna jen v ruce) */
      }
    }
    const ids: string[] = [];
    for (const f of ['usmc', 'mec'] as SoldierFaction[])
      for (const lod of [0, 2]) {
        const id = `__warm_${f}_${lod}`;
        const s = this.create(id);
        this.applyLook(s, { faction: f, variant: f === 'usmc' ? 'medic' : 'assault' }, lod);
        s.group.position.set(0, -1000, 0);
        s.weapon.position.set(0, -1000, 0);
        s.weapon.geometry = worldWeapon(WEAPON_IDS[0], this.quality).lods[lod];
        s.flash.visible = true;
        // Bez ořezu, aby se jednou skutečně vykreslili (pod mapou, nikdo je nevidí).
        s.group.traverse((o) => (o.frustumCulled = false));
        s.weapon.traverse((o) => (o.frustumCulled = false));
        s.group.updateMatrixWorld(true);
        ids.push(id);
      }
    return () => {
      for (const id of ids) {
        const s = this.soldiers.get(id);
        if (!s) continue;
        s.blob.removeFromParent();
        s.group.removeFromParent();
        s.weapon.removeFromParent();
        s.mesh.skeleton.dispose();
        s.body?.dispose();
        this.soldiers.delete(id);
      }
    };
  }

  get count() {
    return this.soldiers.size;
  }

  dispose() {
    for (const s of this.soldiers.values()) s.mesh.skeleton.dispose();
    for (const m of [...Object.values(this.bodyMats), this.gearMat, this.rifleMat, this.flashMat]) m.dispose();
    for (const t of this.atlases) t.dispose();
    this.flashGeo.dispose();
    this.blobGeo.dispose();
    this.blobMat.map?.dispose();
    this.blobMat.dispose();
    this.decalGeo.dispose();
    for (const m of this.decalMats.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.root.removeFromParent();
    this.soldiers.clear();
  }
}

function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
