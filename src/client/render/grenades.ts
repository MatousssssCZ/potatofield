import * as THREE from 'three';
import type { GrenadeView } from '../runtime/driver';
import { itemGeometry } from './weapons/items';
import { SmokeCloud } from './smoke';

/**
 * Granáty ve světě: letící / ležící granát (stejný model jako v ruce), výbuch (záblesk světla,
 * ohnivá koule, prach a úlomky, spálenina na zemi) a kouřová clona dýmovnice (měkké částice,
 * které se rozrůstají, stoupají a s koncem clony řídnou). Vše v poolech s limitem.
 */
interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size0: number;
  size1: number;
  fadeIn: number;
}

function softTexture(seed: number, puffy: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blobs = puffy ? 9 : 1;
  for (let i = 0; i < blobs; i++) {
    const x = puffy ? 34 + rnd() * 60 : 64, y = puffy ? 34 + rnd() * 60 : 64, r = puffy ? 22 + rnd() * 26 : 62;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${puffy ? 0.55 : 1})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tři varianty obláčku vedle sebe v jedné textuře (kouř = jeden materiál, jedno volání). */
function smokeAtlas(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 128;
  const g = c.getContext('2d')!;
  [11, 29, 47].forEach((seed, i) => g.drawImage(softTexture(seed, true).image as HTMLCanvasElement, i * 128, 0));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GrenadeRenderer {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
  private particles: Particle[] = [];
  private fireTex = softTexture(3, false);
  private smokeAtlas = smokeAtlas();
  /** Kouř dýmovnic a výbuchů: jedno instancované volání. */
  readonly smoke = new SmokeCloud(this.smokeAtlas);
  /** Závoj přes obraz, když je kamera uvnitř clony (náhrada za vrstvy obláčků u kamery). */
  private veil: THREE.Mesh | null = null;
  private veilA = 0;
  private veilWarm = 0;
  private lights: Array<{ light: THREE.PointLight; life: number }> = [];
  private scorchGeo = new THREE.CircleGeometry(1.4, 20);
  private scorchMat: THREE.MeshStandardMaterial;
  private scorches: THREE.Mesh[] = [];
  private smokeAcc = new Map<string, number>();
  /** Pohybový stav zobrazení granátu: rotace v letu, kutálení, uložení na bok v klidu. */
  private motion = new Map<string, { prev: THREE.Vector3; spin: number; axis: THREE.Vector3; still: number; lieYaw: number }>();
  /** Odlétající pojistné páčky (jen vizuál, pár desetin sekundy). */
  private spoons: Array<{ mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }> = [];
  private spoonGeo = new THREE.BoxGeometry(0.012, 0.003, 0.075);
  private spoonMat = new THREE.MeshStandardMaterial({ color: '#8d9194', metalness: 0.7, roughness: 0.4 });
  private time = 0;

  constructor(private maxParticles = 420) {
    this.root.name = 'grenades';
    this.root.add(this.smoke.mesh);
    const d = document.createElement('canvas');
    d.width = d.height = 128;
    const g = d.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, 'rgba(12,10,8,0.95)');
    r.addColorStop(0.5, 'rgba(25,22,18,0.6)');
    r.addColorStop(1, 'rgba(40,36,30,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(d);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scorchMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    // Světla výbuchu jsou trvale „zapnutá“ s nulovou intenzitou: změna počtu světel ve scéně by
    // donutila Three.js překompilovat shadery všech osvětlených materiálů (zaseknutí při 1. výbuchu).
    // Jedno světlo (stojí výkon v každém osvětleném pixelu i s nulovou intenzitou); další výbuch ho převezme.
    for (let i = 0; i < 1; i++) {
      const light = new THREE.PointLight('#ffb060', 0, 18, 2);
      light.position.set(0, -1000, 0);
      this.root.add(light);
      this.lights.push({ light, life: 0 });
    }
  }

  private particle(tex: THREE.Texture, additive: boolean): Particle {
    let p = this.particles.find((x) => x.life <= 0 && (x.sprite.material as THREE.SpriteMaterial).map === tex && ((x.sprite.material as THREE.SpriteMaterial).blending === THREE.AdditiveBlending) === additive);
    if (!p) {
      if (this.particles.length >= this.maxParticles) {
        p = this.particles.reduce((a, b) => (a.life < b.life ? a : b));
        (p.sprite.material as THREE.SpriteMaterial).map = tex;
        (p.sprite.material as THREE.SpriteMaterial).blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      } else {
        const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !additive, fog: true });
        const sprite = new THREE.Sprite(m);
        this.root.add(sprite);
        p = { sprite, vel: new THREE.Vector3(), life: 0, max: 1, size0: 1, size1: 1, fadeIn: 0 };
        this.particles.push(p);
      }
    }
    p.sprite.visible = true;
    return p;
  }

  /** Synchronizace granátů se stavem simulace (pozice ze serveru, jemné dorovnání). */
  sync(list: GrenadeView[], simTime: number, dt: number) {
    const seen = new Set<string>();
    for (const n of list) {
      seen.add(n.id);
      let m = this.meshes.get(n.id);
      if (!m) {
        m = new THREE.Mesh(itemGeometry(n.kind), this.mat);
        m.castShadow = true;
        m.position.set(n.pos.x, n.pos.y, n.pos.z);
        m.rotation.set(Math.random() * 6.3, Math.random() * 6.3, 0);
        this.root.add(m);
        this.meshes.set(n.id, m);
        this.motion.set(n.id, { prev: m.position.clone(), spin: 13 + Math.random() * 5, axis: new THREE.Vector3(1, 0, 0), still: 0, lieYaw: Math.random() * 6.3 });
        this.spawnSpoon(m.position);
      }
      m.position.lerp(new THREE.Vector3(n.pos.x, n.pos.y, n.pos.z), 1 - Math.exp(-dt * 25));
      this.animateMotion(n.id, m, dt);
      // Hořící dýmovnice: emise kouře (~4 větší obláčky/s), poslední 4 s řídne.
      if (n.kind === 'smoke' && n.smokeUntil > simTime) {
        const left = n.smokeUntil - simTime;
        const rate = 4 * Math.min(1, left / 4);
        const acc = (this.smokeAcc.get(n.id) ?? 0) + dt * rate;
        let k = Math.floor(acc);
        this.smokeAcc.set(n.id, acc - k);
        while (k-- > 0) this.smokePuff(m.position, left);
      }
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) {
      this.root.remove(m);
      this.meshes.delete(id);
      this.smokeAcc.delete(id);
      this.motion.delete(id);
    }
  }

  /**
   * Rotace podle skutečného pohybu zobrazení: v letu přemet kolem osy kolmé na směr (roztočení
   * z hodu pomalu slábne), po zemi kutálení podle ujeté dráhy, v klidu se granát položí na bok.
   */
  private animateMotion(id: string, m: THREE.Mesh, dt: number) {
    const st = this.motion.get(id);
    if (!st || dt <= 0) return;
    const v = m.position.clone().sub(st.prev).divideScalar(dt);
    st.prev.copy(m.position);
    const sp = v.length(), horiz = Math.hypot(v.x, v.z);
    if (sp < 0.08) st.still += dt;
    else st.still = 0;
    if (st.still > 0.15) {
      // Klid: na bok (osa granátu vodorovně), náhodné natočení.
      const lie = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, st.lieYaw, 'YXZ'));
      m.quaternion.slerp(lie, 1 - Math.exp(-dt * 6));
      return;
    }
    if (horiz > 0.05) st.axis.set(v.z, 0, -v.x).normalize();
    const rolling = Math.abs(v.y) < 0.35 && horiz > 0.05;
    // Kutálení: úhel = dráha / poloměr (granát ~3,5 cm); let: roztočení z hodu, pomalu slábne.
    const w = rolling ? horiz / 0.035 : st.spin;
    st.spin = Math.max(2, st.spin - dt * 1.5);
    m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(st.axis, w * dt));
  }

  /** Pojistná páčka odskočí při uvolnění granátu (krátký let a zmizení). */
  private spawnSpoon(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(this.spoonGeo, this.spoonMat);
    mesh.position.copy(at);
    mesh.castShadow = false;
    this.root.add(mesh);
    const a = Math.random() * Math.PI * 2;
    this.spoons.push({ mesh, vel: new THREE.Vector3(Math.cos(a) * 1.6, 2.6 + Math.random(), Math.sin(a) * 1.6), spin: new THREE.Vector3(14 + Math.random() * 8, 5, 9), life: 0.9 });
  }

  private smokePuff(at: THREE.Vector3, left: number) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.5 + Math.random() * 0.8;
    const g = 0.78 + Math.random() * 0.12;
    this.smoke.emit({
      pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4)),
      vel: new THREE.Vector3(Math.cos(a) * sp, 0.25 + Math.random() * 0.35, Math.sin(a) * sp),
      life: Math.min(left + 4, 10 + Math.random() * 4),
      size0: 0.8,
      size1: 7 + Math.random() * 3,
      fadeIn: 0.6,
      color: [g, g, g * 0.97],
      opacity: 0.9,
    });
  }

  /** Výbuch tříštivého granátu. */
  explode(pos: THREE.Vector3, groundNormal = new THREE.Vector3(0, 1, 0)) {
    const L = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    L.light.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
    L.life = 0.28;
    // Ohnivá koule (aditivní), pak tmavý kouř a prach, úlomky.
    for (let i = 0; i < 10; i++) {
      const p = this.particle(this.fireTex, true);
      p.life = p.max = 0.25 + Math.random() * 0.2;
      p.sprite.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6));
      p.vel.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3);
      p.size0 = 0.8;
      p.size1 = 2.8 + Math.random() * 1.4;
      p.fadeIn = 0;
      (p.sprite.material as THREE.SpriteMaterial).color.setRGB(1, 0.62 + Math.random() * 0.2, 0.3);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      // Tmavý kouř výbuchu (lineární barva – na obrazovce středně šedohnědý).
      const g = 0.07 + Math.random() * 0.05;
      this.smoke.emit({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8)),
        vel: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2.5), 1.2 + Math.random() * 1.8, Math.sin(a) * (1 + Math.random() * 2.5)),
        life: 1.8 + Math.random() * 1.6,
        size0: 1,
        size1: 3.8 + Math.random() * 2,
        fadeIn: 0.05,
        color: [g * 1.1, g, g * 0.85],
      });
    }
    for (let i = 0; i < 14; i++) {
      const p = this.particle(this.fireTex, false);
      p.life = p.max = 0.7 + Math.random() * 0.5;
      p.sprite.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));
      const a = Math.random() * Math.PI * 2;
      p.vel.set(Math.cos(a) * (4 + Math.random() * 6), 3 + Math.random() * 5, Math.sin(a) * (4 + Math.random() * 6));
      p.size0 = p.size1 = 0.08 + Math.random() * 0.06;
      p.fadeIn = 0;
      (p.sprite.material as THREE.SpriteMaterial).color.setRGB(0.25, 0.2, 0.15);
    }
    // Spálenina na zemi (pool max 12).
    let s = this.scorches.length >= 12 ? this.scorches.shift()! : new THREE.Mesh(this.scorchGeo, this.scorchMat);
    if (!s.parent) this.root.add(s);
    s.position.copy(pos).addScaledVector(groundNormal, 0.02);
    s.lookAt(s.position.clone().add(groundNormal));
    s.rotateZ(Math.random() * Math.PI * 2);
    this.scorches.push(s);
  }

  /**
   * Příprava před hrou: částice všech druhů a spálenina se vytvoří předem (viditelné, ale mimo
   * záběr), aby je `renderer.compile` přeložil hned a první výbuch nečekal na shadery.
   */
  warmup() {
    const far = new THREE.Vector3(0, -1000, 0);
    const kinds: Array<[THREE.Texture, boolean]> = [[this.fireTex, true], [this.fireTex, false]];
    // Kouř: jeden obláček mimo záběr, ať se shader přeloží předem.
    this.smoke.emit({ pos: far, vel: new THREE.Vector3(), life: 0.5, size0: 1, size1: 1, color: [1, 1, 1] });
    this.smoke.update(0, new THREE.Vector3(0, -1010, 0));
    // Mimo záběr a bez ořezu: přeloží se a jednou vykreslí (neviditelně pod mapou).
    const ps = kinds.map(([t, add]) => {
      const p = this.particle(t, add);
      p.sprite.position.copy(far);
      p.sprite.frustumCulled = false;
      return p;
    });
    const scorch = new THREE.Mesh(this.scorchGeo, this.scorchMat);
    scorch.position.copy(far);
    scorch.frustumCulled = false;
    this.root.add(scorch);
    const nade = new THREE.Mesh(itemGeometry('frag'), this.mat);
    nade.position.copy(far);
    nade.frustumCulled = false;
    this.root.add(nade);
    return () => {
      for (const p of ps) {
        p.life = 0;
        p.sprite.visible = false;
        p.sprite.frustumCulled = true;
      }
      scorch.removeFromParent();
      nade.removeFromParent();
    };
  }

  update(dt: number, camera?: THREE.Camera) {
    this.time += dt;
    for (let i = this.spoons.length - 1; i >= 0; i--) {
      const s = this.spoons[i];
      s.life -= dt;
      s.vel.y -= 9.81 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      if (s.life <= 0) {
        s.mesh.removeFromParent();
        this.spoons.splice(i, 1);
      }
    }
    if (camera) {
      this.smoke.update(dt, camera.position);
      this.updateVeil(dt, camera);
    }
    for (const L of this.lights) {
      if (L.life <= 0) continue;
      L.life -= dt;
      L.light.intensity = Math.max(0, L.life / 0.28) * 60;
      if (L.life <= 0) {
        L.light.intensity = 0;
        L.light.position.set(0, -1000, 0);
      }
    }
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const k = 1 - p.life / p.max;
      // Kouř zpomaluje (odpor vzduchu), úlomky padají.
      if (p.size0 === p.size1) p.vel.y -= 9.81 * dt;
      else p.vel.multiplyScalar(Math.exp(-dt * 1.4));
      p.sprite.position.addScaledVector(p.vel, dt);
      const s = p.size0 + (p.size1 - p.size0) * (1 - Math.pow(1 - k, 2.2));
      p.sprite.scale.setScalar(s);
      const fadeIn = p.fadeIn > 0 ? Math.min(1, (p.max - p.life) / p.fadeIn) : 1;
      (p.sprite.material as THREE.SpriteMaterial).opacity = fadeIn * Math.min(1, p.life / Math.min(p.max, 2.5)) * (p.size0 === p.size1 ? 1 : 0.85);
    }
  }

  /** Kamera uvnitř kouře: jedna šedá plocha přes obraz místo desítek obláčků u očí. */
  private updateVeil(dt: number, camera: THREE.Camera) {
    const target = this.smoke.count ? this.smoke.densityAt(camera.position) : 0;
    this.veilA += (target - this.veilA) * (1 - Math.exp(-dt * 6));
    if (!this.veil) {
      this.veil = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.62, 0.6), transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
      this.veil.position.set(0, 0, -0.2);
      this.veil.renderOrder = 999;
      this.veil.frustumCulled = false;
      this.veilWarm = 3;
    }
    if (this.veil.parent !== camera) camera.add(this.veil);
    (this.veil.material as THREE.MeshBasicMaterial).opacity = Math.min(0.94, this.veilA);
    // Prvních pár snímků viditelný s nulovou průhledností: shader se přeloží hned, ne až v kouři.
    if (this.veilWarm > 0) this.veilWarm--;
    this.veil.visible = this.veilWarm > 0 || this.veilA > 0.01;
  }

  dispose() {
    this.root.removeFromParent();
    this.smoke.dispose();
    this.smokeAtlas.dispose();
    if (this.veil) {
      this.veil.removeFromParent();
      this.veil.geometry.dispose();
      (this.veil.material as THREE.Material).dispose();
    }
    for (const p of this.particles) (p.sprite.material as THREE.Material).dispose();
    this.fireTex.dispose();
    this.mat.dispose();
    this.spoonGeo.dispose();
    this.spoonMat.dispose();
    this.scorchGeo.dispose();
    (this.scorchMat.map as THREE.Texture | null)?.dispose();
    this.scorchMat.dispose();
  }
}
