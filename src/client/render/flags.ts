import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Team } from '../../shared/map/schema';
import type { Faction } from '../../shared/config/arsenal';

/**
 * Fyzické vlajky kontrolních bodů (jako v BF2): stožár ve středu bodu, vlajka frakce, která bod
 * drží nebo zabírá. Výška vlajky = |postup| bodu: vlastněný bod = nahoře, neutralizace = vlajka
 * klesá, neutrální bod = bílá vlajka dole, zabírání = vlajka nového týmu stoupá. Výšku určuje
 * stav autority (p ∈ [−1, 1]); klient ji jen plynule dorovnává. Vlnění látky je vertex shader.
 * Stožár je jen vizuální (bez kolize) – nemění herní prostor mapy.
 */
export const FLAG = { poleHeight: 7.5, flagW: 1.5, flagH: 0.95, bottom: 0.9 } as const;

type Look = Faction | 'neutral';

function flagTexture(look: Look): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  const star = (cx: number, cy: number, r: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.42 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };
  // Vlastní stylizované vlajky (ne převzaté znaky): barvy a jednoduché symboly frakcí.
  if (look === 'usmc') {
    g.fillStyle = '#7d1a1a';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = '#c9a43a';
    g.lineWidth = 10;
    g.strokeRect(8, 8, 240, 144);
    star(128, 80, 46, '#d6b24a');
  } else if (look === 'mec') {
    g.fillStyle = '#2d553a';
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#e6e2d4';
    g.fillRect(0, 58, 256, 44);
    for (const x of [88, 128, 168]) star(x, 80, 16, '#2d553a');
  } else if (look === 'pla') {
    g.fillStyle = '#a81f1c';
    g.fillRect(0, 0, 256, 160);
    star(58, 52, 30, '#e9c33c');
  } else {
    g.fillStyle = '#d8d5c7';
    g.fillRect(0, 0, 256, 160);
  }
  // Látka: jemná zrnitost a ztmavení u lemu (bez ostrých detailů – vzdálený objekt).
  const img = g.getImageData(0, 0, 256, 160);
  let s = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const n = ((s / 2147483647) - 0.5) * 14;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] + n));
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 6, 160);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

/** Stožár: patka, tyč, kladka nahoře, kulová hlavice (sloučeno do jedné geometrie). */
function poleGeometry() {
  const H = FLAG.poleHeight;
  const parts = [
    new THREE.CylinderGeometry(0.22, 0.26, 0.25, 12).translate(0, 0.125, 0),
    new THREE.CylinderGeometry(0.035, 0.05, H, 10).translate(0, H / 2 + 0.2, 0),
    new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10).translate(0, H + 0.12, 0),
    new THREE.SphereGeometry(0.075, 10, 8).translate(0, H + 0.24, 0),
  ];
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  parts.forEach((p) => p.dispose());
  return g;
}

interface Item {
  id: string;
  group: THREE.Group;
  flag: THREE.Mesh;
  y: number;
  look: Look;
}

export class FlagSystem {
  readonly root = new THREE.Group();
  private items: Item[] = [];
  private poleGeo = poleGeometry();
  private flagGeo: THREE.PlaneGeometry;
  private poleMat = new THREE.MeshStandardMaterial({ color: '#8c8f8e', metalness: 0.7, roughness: 0.45 });
  private mats = new Map<Look, THREE.MeshStandardMaterial>();
  private uTime = { value: 0 };

  constructor() {
    this.root.name = 'flags';
    // Vlajka: levá hrana u stožáru (x = 0), horní hrana y = 0; segmenty pro vlnění.
    this.flagGeo = new THREE.PlaneGeometry(FLAG.flagW, FLAG.flagH, 14, 6);
    this.flagGeo.translate(FLAG.flagW / 2 + 0.05, -FLAG.flagH / 2, 0);
  }

  private material(look: Look) {
    let m = this.mats.get(look);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ map: flagTexture(look), side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    const uTime = this.uTime;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // Vlnění: amplituda roste od stožáru k volnému konci, postupná vlna + mírný průvěs.
          float u = clamp(position.x / ${FLAG.flagW.toFixed(3)}, 0.0, 1.0);
          float w = sin(u * 7.0 - uTime * 4.2 + position.y * 1.3) * 0.11 + sin(u * 13.0 - uTime * 6.7) * 0.03;
          transformed.z += w * u;
          transformed.y -= u * u * 0.08;
          transformed.x -= abs(w) * u * 0.12;`,
        );
    };
    this.mats.set(look, m);
    return m;
  }

  /** Stožáry podle bodů mapy (pozice podstavy = marker bodu). */
  rebuild(points: Array<{ id: string; position: [number, number, number] }>) {
    for (const it of this.items) this.root.remove(it.group);
    this.items = [];
    for (const cp of points) {
      const group = new THREE.Group();
      group.position.set(cp.position[0], cp.position[1], cp.position[2]);
      const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
      pole.castShadow = true;
      pole.receiveShadow = true;
      group.add(pole);
      const flag = new THREE.Mesh(this.flagGeo, this.material('neutral'));
      flag.position.set(0.02, FLAG.bottom + FLAG.flagH, 0);
      group.add(flag);
      this.root.add(group);
      this.items.push({ id: cp.id, group, flag, y: -1, look: 'neutral' });
    }
  }

  /**
   * Výška a frakce vlajek ze stavu bodů. `instant` = bez dorovnávání (editor, start hry).
   * Vlajka se natáčí po větru (jednotný směr), ne za kamerou.
   */
  update(dt: number, states: Array<{ id: string; p: number }>, factions: Record<Team, Faction>, instant = false) {
    this.uTime.value += dt;
    const top = FLAG.poleHeight + 0.05, bottom = FLAG.bottom + FLAG.flagH;
    for (const it of this.items) {
      const st = states.find((s) => s.id === it.id);
      const p = st?.p ?? 0;
      const look: Look = Math.abs(p) < 1e-4 ? 'neutral' : factions[p > 0 ? 'teamA' : 'teamB'];
      if (look !== it.look) {
        it.look = look;
        it.flag.material = this.material(look);
      }
      const target = bottom + (top - bottom) * Math.min(1, Math.abs(p));
      it.y = instant || it.y < 0 ? target : THREE.MathUtils.lerp(it.y, target, 1 - Math.exp(-dt * 6));
      it.flag.position.y = it.y;
      it.flag.rotation.y = 0.6 + Math.sin(this.uTime.value * 0.13 + it.group.position.x) * 0.15;
    }
  }

  dispose() {
    this.poleGeo.dispose();
    this.flagGeo.dispose();
    this.poleMat.dispose();
    for (const m of this.mats.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.root.removeFromParent();
  }
}
