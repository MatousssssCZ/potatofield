import * as THREE from 'three';
import type { GrenadeView } from '../runtime/driver';
import { itemGeometry } from './weapons/items';

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

export class GrenadeRenderer {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
  private particles: Particle[] = [];
  private fireTex = softTexture(3, false);
  private smokeTex = [softTexture(11, true), softTexture(29, true), softTexture(47, true)];
  private lights: Array<{ light: THREE.PointLight; life: number }> = [];
  private scorchGeo = new THREE.CircleGeometry(1.4, 20);
  private scorchMat: THREE.MeshStandardMaterial;
  private scorches: THREE.Mesh[] = [];
  private smokeAcc = new Map<string, number>();
  private time = 0;

  constructor(private maxParticles = 420) {
    this.root.name = 'grenades';
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
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight('#ffb060', 0, 18, 2);
      light.visible = false;
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
        this.root.add(m);
        this.meshes.set(n.id, m);
      }
      m.position.lerp(new THREE.Vector3(n.pos.x, n.pos.y, n.pos.z), 1 - Math.exp(-dt * 25));
      m.rotation.x += dt * 8;
      m.rotation.z += dt * 5;
      // Hořící dýmovnice: emise kouře (~9 obláčků/s), poslední 4 s řídne.
      if (n.kind === 'smoke' && n.smokeUntil > simTime) {
        const left = n.smokeUntil - simTime;
        const rate = 9 * Math.min(1, left / 4);
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
    }
  }

  private smokePuff(at: THREE.Vector3, left: number) {
    const p = this.particle(this.smokeTex[(Math.random() * 3) | 0], false);
    const life = Math.min(left + 4, 9 + Math.random() * 4);
    p.life = p.max = life;
    p.sprite.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4));
    const a = Math.random() * Math.PI * 2;
    const sp = 0.4 + Math.random() * 0.7;
    p.vel.set(Math.cos(a) * sp, 0.25 + Math.random() * 0.35, Math.sin(a) * sp);
    p.size0 = 0.6;
    p.size1 = 4.5 + Math.random() * 2.5;
    p.fadeIn = 0.6;
    const g = 0.78 + Math.random() * 0.12;
    (p.sprite.material as THREE.SpriteMaterial).color.setRGB(g, g, g * 0.97);
    (p.sprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
  }

  /** Výbuch tříštivého granátu. */
  explode(pos: THREE.Vector3, groundNormal = new THREE.Vector3(0, 1, 0)) {
    const L = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    L.light.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
    L.light.visible = true;
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
    for (let i = 0; i < 16; i++) {
      const p = this.particle(this.smokeTex[i % 3], false);
      p.life = p.max = 1.8 + Math.random() * 1.6;
      p.sprite.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8));
      const a = Math.random() * Math.PI * 2;
      p.vel.set(Math.cos(a) * (1 + Math.random() * 2.5), 1.2 + Math.random() * 1.8, Math.sin(a) * (1 + Math.random() * 2.5));
      p.size0 = 1;
      p.size1 = 3.5 + Math.random() * 2;
      p.fadeIn = 0.05;
      // Tmavý kouř výbuchu (lineární barva – na obrazovce středně šedohnědý).
      const g = 0.07 + Math.random() * 0.05;
      (p.sprite.material as THREE.SpriteMaterial).color.setRGB(g * 1.1, g, g * 0.85);
      (p.sprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
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

  update(dt: number) {
    this.time += dt;
    for (const L of this.lights) {
      if (L.life <= 0) continue;
      L.life -= dt;
      L.light.intensity = Math.max(0, L.life / 0.28) * 60;
      if (L.life <= 0) L.light.visible = false;
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

  dispose() {
    this.root.removeFromParent();
    for (const p of this.particles) (p.sprite.material as THREE.Material).dispose();
    for (const t of [this.fireTex, ...this.smokeTex]) t.dispose();
    this.mat.dispose();
    this.scorchGeo.dispose();
    (this.scorchMat.map as THREE.Texture | null)?.dispose();
    this.scorchMat.dispose();
  }
}
