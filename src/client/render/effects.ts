import * as THREE from 'three';

/**
 * Dočasné efekty zásahů: prach podle materiálu a stopy po střelách. Vše v poolu s limitem
 * (podle profilu kvality), žádná destrukce. Stopy po čase mizí.
 */
interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
}

const DUST: Record<string, string> = {
  concrete: '#b8b1a3',
  plaster: '#d8c9a8',
  brick: '#b0784e',
  sand: '#c9ab7f',
  dirt: '#9a7c5a',
  asphalt: '#6b6862',
  wood: '#8a6a48',
  metal: '#ffd28a',
  fabric: '#b39e78',
  flesh: '#6a1a12',
};

export class Effects {
  readonly root = new THREE.Group();
  private puffs: Puff[] = [];
  private decals: THREE.Mesh[] = [];
  private decalIdx = 0;
  private puffMat: THREE.SpriteMaterial;
  private decalGeo = new THREE.CircleGeometry(0.035, 10);
  private decalMat: THREE.MeshStandardMaterial;
  private tracers: Array<{ line: THREE.Line; life: number }> = [];
  private tracerMat = new THREE.LineBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0.6, toneMapped: false });

  constructor(private maxDecals: number) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    this.puffMat = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
    const d = document.createElement('canvas');
    d.width = d.height = 64;
    const dg = d.getContext('2d')!;
    const r2 = dg.createRadialGradient(32, 32, 1, 32, 32, 30);
    r2.addColorStop(0, 'rgba(10,8,6,1)');
    r2.addColorStop(0.35, 'rgba(30,26,22,0.9)');
    r2.addColorStop(1, 'rgba(60,55,50,0)');
    dg.fillStyle = r2;
    dg.fillRect(0, 0, 64, 64);
    const dt = new THREE.CanvasTexture(d);
    dt.colorSpace = THREE.SRGBColorSpace;
    this.decalMat = new THREE.MeshStandardMaterial({ map: dt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    this.root.name = 'effects';
  }

  /** Volný obláček z poolu (nejvýš 120; při zaplnění se přepíše nejstarší). */
  private puff(): Puff {
    let p = this.puffs.find((x) => x.life <= 0);
    if (!p) {
      if (this.puffs.length >= 120) p = this.puffs[this.puffNext++ % this.puffs.length];
      else {
        const sprite = new THREE.Sprite(this.puffMat.clone());
        this.root.add(sprite);
        p = { sprite, vel: new THREE.Vector3(), life: 0, max: 1 };
        this.puffs.push(p);
      }
    }
    p.sprite.visible = true;
    p.sprite.scale.setScalar(0.08);
    return p;
  }
  private puffNext = 0;

  /** Prach od nohou (sprint, dopad): nízké obláčky barvy povrchu; `amount` 1 = krok, 3 = dopad. */
  dust(pos: { x: number; y: number; z: number }, surface: string, amount = 1) {
    if (surface === 'metal' || surface === 'wood' || surface === 'flesh') return;
    const col = new THREE.Color(DUST[surface] ?? DUST.sand);
    for (let i = 0; i < amount; i++) {
      const p = this.puff();
      (p.sprite.material as THREE.SpriteMaterial).color.copy(col);
      p.sprite.position.set(pos.x + (Math.random() - 0.5) * 0.3, pos.y + 0.06, pos.z + (Math.random() - 0.5) * 0.3);
      p.vel.set((Math.random() - 0.5) * 0.5, 0.25 + Math.random() * 0.25, (Math.random() - 0.5) * 0.5);
      p.max = p.life = 0.6 + Math.random() * 0.5;
    }
  }

  /** Kouř z hlavně po výstřelu (cizí vojáci): dva šedé obláčky ve směru hlavně. */
  muzzleSmoke(pos: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }) {
    for (let i = 0; i < 2; i++) {
      const p = this.puff();
      (p.sprite.material as THREE.SpriteMaterial).color.set('#b9b6ae');
      p.sprite.position.set(pos.x + dir.x * (0.5 + i * 0.25), pos.y + dir.y * (0.5 + i * 0.25), pos.z + dir.z * (0.5 + i * 0.25));
      p.vel.set(dir.x * (0.8 + i * 0.5), dir.y * 0.8 + 0.2, dir.z * (0.8 + i * 0.5));
      p.max = p.life = 0.35 + Math.random() * 0.25;
    }
  }

  private casings: Array<{ mesh: THREE.Mesh; vel: THREE.Vector3; spin: number; life: number }> = [];
  private casingGeo = new THREE.BoxGeometry(0.012, 0.012, 0.045);
  private casingMat = new THREE.MeshStandardMaterial({ color: '#c9a04a', metalness: 0.9, roughness: 0.35 });

  /** Vyhozená nábojnice (cizí vojáci): letí vpravo od zbraně, padá a po chvíli zmizí. Nejvýš 24 najednou. */
  casing(pos: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }) {
    let c = this.casings.find((x) => x.life <= 0);
    if (!c) {
      if (this.casings.length >= 24) return;
      const mesh = new THREE.Mesh(this.casingGeo, this.casingMat);
      this.root.add(mesh);
      c = { mesh, vel: new THREE.Vector3(), spin: 0, life: 0 };
      this.casings.push(c);
    }
    // Vpravo od směru střelby (vodorovně) a mírně nahoru.
    const l = Math.hypot(dir.x, dir.z) || 1;
    const rx = -dir.z / l, rz = dir.x / l;
    c.mesh.position.set(pos.x + dir.x * 0.25 + rx * 0.08, pos.y + 0.02, pos.z + dir.z * 0.25 + rz * 0.08);
    c.vel.set(rx * (1.6 + Math.random()), 1.2 + Math.random() * 0.8, rz * (1.6 + Math.random()));
    c.spin = 12 + Math.random() * 18;
    c.life = 0.9;
    c.mesh.visible = true;
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: string) {
    const col = new THREE.Color(DUST[surface] ?? DUST.concrete);
    const n = surface === 'flesh' ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const p = this.puff();
      (p.sprite.material as THREE.SpriteMaterial).color.copy(col);
      p.sprite.position.copy(point).addScaledVector(normal, 0.03);
      p.vel.copy(normal).multiplyScalar(0.6 + Math.random() * 1.2).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.6, (Math.random() - 0.5) * 0.8));
      p.max = p.life = 0.5 + Math.random() * 0.6;
    }
    if (surface !== 'flesh' && surface !== 'fabric' && this.maxDecals > 0) this.decal(point, normal);
  }

  private decal(point: THREE.Vector3, normal: THREE.Vector3) {
    let m: THREE.Mesh;
    if (this.decals.length < this.maxDecals) {
      m = new THREE.Mesh(this.decalGeo, this.decalMat);
      m.receiveShadow = true;
      this.root.add(m);
      this.decals.push(m);
    } else {
      m = this.decals[this.decalIdx];
      this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    }
    m.position.copy(point).addScaledVector(normal, 0.004);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI);
    m.scale.setScalar(0.7 + Math.random() * 0.6);
    m.visible = true;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(g, this.tracerMat);
    this.root.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  update(dt: number) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.multiplyScalar(1 - dt * 3);
      p.vel.y -= dt * 0.3;
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = 1 - p.life / p.max;
      p.sprite.scale.setScalar(0.08 + k * 0.45);
      (p.sprite.material as THREE.SpriteMaterial).opacity = (1 - k) * 0.55;
      if (p.life <= 0) p.sprite.visible = false;
    }
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin * dt;
      c.mesh.rotation.z += c.spin * 0.6 * dt;
      if (c.life <= 0) c.mesh.visible = false;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        t.line.geometry.dispose();
        t.line.removeFromParent();
        this.tracers.splice(i, 1);
      }
    }
  }

  /** Návrat do editoru: stopy zmizí (nemění autorská data). */
  clear() {
    for (const d of this.decals) d.visible = false;
    for (const p of this.puffs) {
      p.life = 0;
      p.sprite.visible = false;
    }
    for (const c of this.casings) {
      c.life = 0;
      c.mesh.visible = false;
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Sprite) (o.material as THREE.Material).dispose();
    });
    for (const t of this.tracers) t.line.geometry.dispose();
    this.casingGeo.dispose();
    this.casingMat.dispose();
    this.decalGeo.dispose();
    this.decalMat.map?.dispose();
    this.decalMat.dispose();
    this.puffMat.map?.dispose();
    this.puffMat.dispose();
    this.tracerMat.dispose();
    this.root.removeFromParent();
  }
}
