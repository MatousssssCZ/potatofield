import * as THREE from 'three';
import type { PhysicsWorld } from '../../shared/physics/world';

/**
 * Jména spoluhráčů přímo ve světě (jako v BF2): modrý text nad hlavou, členové čety zeleně, u vzdálenějších
 * vzdálenost v metrech. Jen spoluhráči (nepřátelé se neoznačují); skryté za překážkou, za zády a nad 90 m.
 * Výhled se ověřuje paprskem nejvýš 8× za sekundu.
 */
interface Tag {
  el: HTMLDivElement;
  los: boolean;
  losAt: number;
}

export class NameTags {
  private tags = new Map<string, Tag>();
  private v = new THREE.Vector3();
  private maxDist = 90;

  constructor(private root: HTMLElement, private phys: () => PhysicsWorld | null) {}

  update(
    list: Array<{ id: string; name: string; alive: boolean; x: number; y: number; z: number; height: number; squad: boolean }>,
    camera: THREE.Camera,
    now: number,
    enabled: boolean,
  ) {
    const seen = new Set<string>();
    if (enabled) {
      const w = this.root.clientWidth || innerWidth, h = this.root.clientHeight || innerHeight;
      const eye = camera.position;
      let n = 0;
      for (const p of list) {
        if (!p.alive || n >= 16) continue;
        const dx = p.x - eye.x, dz = p.z - eye.z;
        const d = Math.hypot(dx, p.y - eye.y, dz);
        if (d > this.maxDist || d < 0.5) continue;
        this.v.set(p.x, p.y + p.height + 0.35, p.z).project(camera);
        if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
        let t = this.tags.get(p.id);
        if (!t) {
          const el = document.createElement('div');
          el.className = 'h-nametag';
          this.root.appendChild(el);
          t = { el, los: true, losAt: -1 };
          this.tags.set(p.id, t);
        }
        if (now - t.losAt > 0.125) {
          t.losAt = now;
          const ph = this.phys();
          if (ph && d > 3) {
            const tx = p.x - eye.x, ty = p.y + p.height * 0.8 - eye.y, tz = p.z - eye.z;
            const l = Math.hypot(tx, ty, tz);
            t.los = !ph.castRay({ x: eye.x, y: eye.y, z: eye.z }, { x: tx / l, y: ty / l, z: tz / l }, l - 0.4);
          } else t.los = true;
        }
        if (!t.los) continue;
        seen.add(p.id);
        n++;
        const label = d > 20 ? `${p.name} [${Math.round(d)}m]` : p.name;
        if (t.el.textContent !== label) t.el.textContent = label;
        t.el.className = `h-nametag${p.squad ? ' squad' : ''}`;
        t.el.style.display = '';
        t.el.style.opacity = String(Math.max(0.35, 1 - d / this.maxDist));
        t.el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
      }
    }
    for (const [id, t] of this.tags) {
      if (seen.has(id)) continue;
      t.el.style.display = 'none';
      if (!enabled || !list.some((p) => p.id === id)) {
        t.el.remove();
        this.tags.delete(id);
      }
    }
  }

  dispose() {
    for (const t of this.tags.values()) t.el.remove();
    this.tags.clear();
  }
}
