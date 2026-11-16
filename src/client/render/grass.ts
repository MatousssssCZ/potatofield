import * as THREE from 'three';
import type { GeneratedObject } from '../../world/registry';
import { heightAt } from '../../world/terrain';
import type { TerrainData } from '../../shared/map/schema';

/**
 * Suchá tráva jako povrch: roste jen na malované vrstvě terénu „Tráva“ (editor → Terén → Tráva), hustota
 * podle síly malby. Jen vzhled (bez kolizí a bez vlivu na viditelnost):
 * instancované zkřížené karty kolem kamery. Rozmístění je deterministické z buňky mřížky, takže trsy při
 * pohybu nepřeskakují; nerostou na svazích, v budovách, na silnicích ani u zdí (maska pokrytí z generovaných dílů).
 */
let clumps: THREE.BufferGeometry[] | null = null;
let clumpTex: THREE.Texture | null = null;

/**
 * Trsy suché trávy z Poly Haven „Grass Medium 02“ (CC0, zjednodušené skriptem scripts/prepare-grass.mjs):
 * 5 variant, textura suchých stébel s alfou. Bez nich se použijí jednoduché náhradní karty.
 */
export async function preloadGrass(base = '/') {
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const [g, tex] = await Promise.all([loader.loadAsync(`${base}models/grass/grass_clumps.glb`), new THREE.TextureLoader().loadAsync(`${base}textures/grass/grass_dry.png`)]);
    const out: THREE.BufferGeometry[] = [];
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      out.push(prepClump(geo));
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    clumps = out.length ? out : null;
    clumpTex = tex;
  } catch (e) {
    console.warn('Tráva se nenačetla, použijí se náhradní karty.', e);
  }
}

/** Normály nahoru (tráva se svítí jako terén) a aTip = relativní výška vrcholu (špičky světlejší, víc se kývou). */
function prepClump(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const h = Math.max(1e-3, g.boundingBox!.max.y);
  const p = g.getAttribute('position');
  const tip = new Float32Array(p.count), n = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    tip[i] = Math.max(0, p.getY(i)) / h;
    n[i * 3 + 1] = 1;
  }
  g.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

/** Náhradní trs (bez načteného modelu, např. v testech): tři zkřížené karty. */
function fallbackCard() {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const W = 0.3, Hh = 0.4;
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a), b = pos.length / 3;
    pos.push(-W * c, 0, W * s, W * c, 0, -W * s, W * c, Hh, -W * s, -W * c, Hh, W * s);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return prepClump(g);
}

export class GrassField {
  private mask: Uint8Array | null = null;
  private mx0 = 0;
  private mz0 = 0;
  private mw = 0;
  private mh = 0;
  private terrain: TerrainData | null = null;
  private last = new THREE.Vector2(Number.NaN, Number.NaN);
  private static CELL = 0.5;

  /** Instancované trsy: jedna sada instancí na variantu trsu (5 variant z Poly Haven, sdílený materiál). */
  readonly mesh = new THREE.Group();
  private parts: THREE.InstancedMesh[] = [];
  private heights: number[] = [];

  constructor(private max: number, private radius: number) {
    const src = clumps ?? [fallbackCard()];
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: clumpTex ?? bladeTexture(), alphaTest: 0.4, roughness: 1, side: THREE.DoubleSide });
    // Zesvětlení špiček, plynulý náběh se vzdáleností a mírné kývání ve větru.
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      this.uTime = sh.uniforms.uTime;
      sh.uniforms.uFade = { value: new THREE.Vector2(radius * 0.5, radius * 0.95) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uFade;\nattribute float aTip;\nvarying float vTip;')
        .replace(
          '#include <begin_vertex>',
          // Trs roste z nuly mezi uFade.x a uFade.y (žádné náhlé objevení), špičky se kývají ve větru.
          '#include <begin_vertex>\nvTip = aTip;\n{ vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float gk = 1.0 - smoothstep(uFade.x, uFade.y, distance(ip.xz, cameraPosition.xz)); transformed *= gk * gk * (3.0 - 2.0 * gk); }\n{ vec3 w0 = (instanceMatrix * vec4(position, 1.0)).xyz; transformed.x += sin(uTime * 1.7 + w0.x * 0.8 + w0.z * 0.6) * 0.035 * vTip; transformed.z += cos(uTime * 1.3 + w0.z * 0.7) * 0.025 * vTip; }',
        );
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTip;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.78, 1.18, vTip);');
    };
    const per = Math.ceil(max / src.length);
    for (const g of src) {
      g.computeBoundingBox();
      this.heights.push(Math.max(0.05, g.boundingBox!.max.y));
      const im = new THREE.InstancedMesh(g, m, per);
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = true;
      // Barva trsů od začátku (jinak by se shader při prvním nastavení barvy překládal znovu).
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(per * 3).fill(1), 3);
      im.raycast = () => {};
      im.count = 0;
      im.name = '__grass';
      this.parts.push(im);
      this.mesh.add(im);
    }
    this.mesh.name = '__grass';
  }

  private uTime: { value: number } | null = null;

  /** Maska pokrytí z dílů objektů (budovy, zdi, silnice, předměty): 1 = tráva nesmí růst. */
  setWorld(terrain: TerrainData, gen: GeneratedObject[]) {
    this.terrain = terrain;
    const w = (terrain.samplesX - 1) * terrain.spacing, d = (terrain.samplesZ - 1) * terrain.spacing;
    const cell = 1;
    this.mx0 = terrain.origin[0];
    this.mz0 = terrain.origin[1];
    this.mw = Math.ceil(w / cell);
    this.mh = Math.ceil(d / cell);
    const mask = new Uint8Array(this.mw * this.mh);
    const mark = (x: number, z: number) => {
      const i = Math.floor(x - this.mx0), j = Math.floor(z - this.mz0);
      if (i >= 0 && j >= 0 && i < this.mw && j < this.mh) mask[j * this.mw + i] = 1;
    };
    for (const g of gen) {
      const o = g.object;
      if (o.gameHidden) continue;
      const [px, , pz] = o.transform.position;
      const yaw = o.transform.rotation[1], sc = o.transform.scale ?? 1;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const W = (lx: number, lz: number): [number, number] => [px + (c * lx + s * lz) * sc, pz + (-s * lx + c * lz) * sc];
      for (const p of g.parts) {
        if (p.render === false || p.shape === 'label' || p.shape === 'card' || p.shape === 'frond') continue;
        if (p.pos[1] - p.size[1] / 2 > 1.2) continue; // vysoko nad zemí (střechy) trávu nezakrývá
        if (p.shape === 'strip' && p.path) {
          const half = p.size[0] / 2 + 0.3;
          for (let i = 0; i + 1 < p.path.length; i++) {
            const a = W(p.path[i][0], p.path[i][2]), b = W(p.path[i + 1][0], p.path[i + 1][2]);
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 0.5));
            const nx = len > 0 ? -(b[1] - a[1]) / len : 0, nz = len > 0 ? (b[0] - a[0]) / len : 0;
            for (let k = 0; k <= n; k++) for (let q = -half; q <= half; q += 0.5) mark(a[0] + ((b[0] - a[0]) * k) / n + nx * q, a[1] + ((b[1] - a[1]) * k) / n + nz * q);
          }
          continue;
        }
        const hx = p.size[0] / 2 + 0.35, hz = p.size[2] / 2 + 0.35;
        const ry = p.rot?.[1] ?? 0, cr = Math.cos(ry), sr = Math.sin(ry);
        const step = 0.5;
        for (let u = -hx; u <= hx + 1e-6; u += step) for (let v = -hz; v <= hz + 1e-6; v += step) {
          const [wx, wz] = W(p.pos[0] + cr * u + sr * v, p.pos[2] - sr * u + cr * v);
          mark(wx, wz);
        }
      }
    }
    this.mask = mask;
    this.last.set(Number.NaN, Number.NaN);
  }

  private covered(x: number, z: number) {
    if (!this.mask) return false;
    const i = Math.floor(x - this.mx0), j = Math.floor(z - this.mz0);
    if (i < 0 || j < 0 || i >= this.mw || j >= this.mh) return true;
    return this.mask[j * this.mw + i] === 1;
  }

  /** Váha malované trávy (bilineárně mezi vzorky terénu). */
  private grassAt(x: number, z: number) {
    const t = this.terrain, gr = t?.grass;
    if (!t || !gr) return 0;
    const fx = (x - t.origin[0]) / t.spacing, fz = (z - t.origin[1]) / t.spacing;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= t.samplesX - 1 || j >= t.samplesZ - 1) return 0;
    const a = fx - i, b = fz - j, k = j * t.samplesX + i;
    return (gr[k] * (1 - a) + gr[k + 1] * a) * (1 - b) + (gr[k + t.samplesX] * (1 - a) + gr[k + t.samplesX + 1] * a) * b;
  }

  update(cam: THREE.Vector3, time: number) {
    if (this.uTime) this.uTime.value = time;
    const t = this.terrain;
    if (!t || !this.mask) return;
    // Přepočet jen po posunu kamery o > 6 m (tráva se mění na okraji, kde je už řídká).
    if (Math.hypot(cam.x - this.last.x, cam.z - this.last.y) < 6) return;
    this.last.set(cam.x, cam.z);
    const C = GrassField.CELL, R = this.radius;
    const i0 = Math.floor((cam.x - R) / C), i1 = Math.ceil((cam.x + R) / C);
    const j0 = Math.floor((cam.z - R) / C), j1 = Math.ceil((cam.z + R) / C);
    const col = new THREE.Color();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // Kandidáti se sbírají a při překročení rozpočtu zůstanou nejbližší (rovnoměrně kolem kamery).
    const cand: Array<[number, number, number, number, number, number, number]> = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        // Hash buňky → pozice, otočení, velikost a „hustota“ (shluky).
        let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        const r1 = ((h >>> 0) % 1000) / 1000, r2 = (((h >>> 10) >>> 0) % 1000) / 1000, r3 = (((h >>> 20) >>> 0) % 1000) / 1000;
        const x = (i + r1) * C, z = (j + r2) * C;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d > R) continue;
        // Tráva roste jen tam, kde je namalovaná vrstva „Tráva“ (hustota podle síly malby, lehce zvlněná šumem).
        const gw = this.grassAt(x, z);
        if (gw < 0.03) continue;
        const dens = Math.min(0.95, gw * (0.75 + 0.45 * patchNoise(x, z)));
        if (r3 > dens) continue;
        // Dál od kamery řidší (každý druhý až třetí trs), aby velký dosah nestál moc vrcholů; zbylé trsy jsou o kus větší.
        const far = Math.max(0, (d - R * 0.3) / (R * 0.7));
        if (far > 0 && r3 > dens * (1 - 0.75 * far)) continue;
        if (this.covered(x, z)) continue;
        const y = heightAt(t, x, z);
        if (y === null) continue;
        // Svah: rozdíl výšek na 1 m.
        const sl = Math.abs((heightAt(t, x + 1, z) ?? y) - y) + Math.abs((heightAt(t, x, z + 1) ?? y) - y);
        if (sl > 0.55) continue;
        cand.push([d, x, y, z, r1, (0.85 + r2 * 0.3) * (1 + 0.5 * far), h >>> 0]);
      }
    if (cand.length > this.max) cand.sort((a, b) => a[0] - b[0]);
    const per = this.parts[0].instanceMatrix.count;
    const counts = this.parts.map(() => 0);
    for (const [, x, y, z, r1, k, h] of cand) {
      const v = h % this.parts.length;
      if (counts[v] >= per) continue;
      // Cílová výška trsu 0,4–0,75 m (varianty jsou různě vysoké, srovnají se měřítkem).
      const target = (0.5 + ((h >>> 5) % 100) / 250) * k;
      const sc0 = target / this.heights[v];
      q.setFromAxisAngle(up, r1 * Math.PI * 2);
      pos.set(x, y - 0.02, z);
      sc.set(sc0 * (1.2 + ((h >>> 9) % 40) / 100), sc0, sc0 * (1.2 + ((h >>> 13) % 40) / 100));
      // Odstín trsu: sláma / béžová / lehce tmavší.
      const tone = ((h >>> 3) % 1000) / 1000;
      col.setRGB(1.08 + tone * 0.16, 1.02 + tone * 0.14, 0.9 + tone * 0.1);
      m.compose(pos, q, sc);
      this.parts[v].setMatrixAt(counts[v], m);
      this.parts[v].setColorAt(counts[v]++, col);
    }
    this.parts.forEach((p, i) => {
      p.count = counts[i];
      p.instanceMatrix.needsUpdate = true;
      if (p.instanceColor) p.instanceColor.needsUpdate = true;
    });
  }

  clear() {
    this.mask = null;
    this.terrain = null;
    for (const p of this.parts) p.count = 0;
  }

  dispose() {
    for (const p of this.parts) p.dispose();
    (this.parts[0]?.material as THREE.Material | undefined)?.dispose();
    this.mesh.removeFromParent();
  }
}
/**
 * Textura stébel: ~150 tenkých, mírně prohnutých stébel od kořene (dole) k hrotu, barvy suché trávy
 * – u země olivově hnědá, nahoře slámově žlutá až světle béžová. Alfa = stéblo / vzduch.
 */
function bladeTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 150; i++) {
    const x = 6 + rnd() * 244, h = 50 + rnd() * 76, lean = (rnd() - 0.5) * 34, w = 1.2 + rnd() * 1.6;
    const grad = g.createLinearGradient(0, 128, 0, 128 - h);
    const tone = rnd();
    grad.addColorStop(0, `rgb(${92 + tone * 20},${84 + tone * 16},${46 + tone * 10})`);
    grad.addColorStop(0.55, `rgb(${178 + tone * 30},${158 + tone * 26},${92 + tone * 20})`);
    grad.addColorStop(1, `rgb(${222 + tone * 25},${204 + tone * 25},${140 + tone * 30})`);
    g.strokeStyle = grad;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Hladký šum ostrůvků trávy (hodnotový, mřížka 7 m, bilineárně) – 0..1, deterministický. */
function patchNoise(x: number, z: number) {
  const S = 7;
  const fx = x / S, fz = z / S, i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
  const h = (ii: number, jj: number) => {
    let v = Math.imul(ii, 2246822519) ^ Math.imul(jj, 3266489917);
    v = Math.imul(v ^ (v >>> 15), 2654435761);
    return ((v >>> 0) % 1000) / 1000;
  };
  const sa = a * a * (3 - 2 * a), sb = b * b * (3 - 2 * b);
  return (h(i, j) * (1 - sa) + h(i + 1, j) * sa) * (1 - sb) + (h(i, j + 1) * (1 - sa) + h(i + 1, j + 1) * sa) * sb;
}
