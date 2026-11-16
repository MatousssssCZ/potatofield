import * as THREE from 'three';
import type { GeneratedObject } from '../../world/registry';
import { heightAt } from '../../world/terrain';
import type { TerrainData } from '../../shared/map/schema';

/**
 * Trsy suché trávy a drobné keříky rozptýlené po terénu (jen vzhled, bez kolizí a bez vlivu na viditelnost):
 * instancované zkřížené karty kolem kamery. Rozmístění je deterministické z buňky mřížky, takže trsy při
 * pohybu nepřeskakují; nerostou na svazích, v budovách, na silnicích ani u zdí (maska pokrytí z generovaných dílů).
 */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  private mask: Uint8Array | null = null;
  private mx0 = 0;
  private mz0 = 0;
  private mw = 0;
  private mh = 0;
  private terrain: TerrainData | null = null;
  private last = new THREE.Vector2(Number.NaN, Number.NaN);
  private static CELL = 1.7;

  constructor(private max: number, private radius: number) {
    const g = new THREE.BufferGeometry();
    // Dvě zkřížené karty, 7 špiček (zubatá silueta trsu); výška 0,5 m, UV pro alfa-test.
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let k = 0; k < 2; k++) {
      const a = (k * Math.PI) / 2;
      const c = Math.cos(a), s = Math.sin(a);
      const base = pos.length / 3;
      const blades = 5;
      for (let i = 0; i < blades; i++) {
        const x = -0.28 + (0.56 * i) / (blades - 1), h = 0.3 + 0.28 * (((i * 37) % 5) / 4), w = 0.07;
        const b = pos.length / 3;
        pos.push((x - w) * c, 0, -(x - w) * s, (x + w) * c, 0, -(x + w) * s, (x + (i % 2 ? 0.06 : -0.06)) * c, h, -(x + (i % 2 ? 0.06 : -0.06)) * s);
        uv.push(0, 0, 1, 0, 0.5, 1);
        idx.push(b, b + 1, b + 2);
      }
      void base;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Normály dolů→nahoru: tráva se osvětluje jako terén (jinak by byla v protisvětle černá).
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const m = new THREE.MeshStandardMaterial({ color: '#8c8a4a', roughness: 1, side: THREE.DoubleSide });
    // Zesvětlení špiček a mírné kývání ve větru.
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      this.uTime = sh.uniforms.uTime;
      sh.uniforms.uFade = { value: new THREE.Vector2(radius * 0.5, radius * 0.95) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vTip;')
        .replace('#include <common>', '#include <common>\nuniform vec2 uFade;')
        .replace(
          '#include <begin_vertex>',
          // Plynulý náběh se vzdáleností: trs roste z nuly mezi uFade.y a uFade.x (žádné náhlé objevení).
          '#include <begin_vertex>\nvTip = position.y / 0.6;\n{ vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float gk = 1.0 - smoothstep(uFade.x, uFade.y, distance(ip.xz, cameraPosition.xz)); transformed *= gk * gk * (3.0 - 2.0 * gk); }\n{ vec3 w0 = (instanceMatrix * vec4(position, 1.0)).xyz; transformed.x += sin(uTime * 1.7 + w0.x * 0.8 + w0.z * 0.6) * 0.06 * vTip; transformed.z += cos(uTime * 1.3 + w0.z * 0.7) * 0.04 * vTip; }');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTip;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.62, 1.18, vTip);');
    };
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.raycast = () => {};
    this.mesh.count = 0;
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
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (let j = j0; j <= j1 && n < this.max; j++)
      for (let i = i0; i <= i1 && n < this.max; i++) {
        // Hash buňky → pozice, otočení, velikost a „hustota“ (shluky).
        let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        const r1 = ((h >>> 0) % 1000) / 1000, r2 = (((h >>> 10) >>> 0) % 1000) / 1000, r3 = (((h >>> 20) >>> 0) % 1000) / 1000;
        const x = (i + r1) * C, z = (j + r2) * C;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d > R) continue;
        // Shluky: nízká frekvence šumu z hashe větší buňky; hustší u hlíny.
        let hc = Math.imul(Math.floor(i / 5), 2246822519) ^ Math.imul(Math.floor(j / 5), 3266489917);
        hc = Math.imul(hc ^ (hc >>> 15), 2654435761);
        const cluster = ((hc >>> 0) % 1000) / 1000;
        if (r3 > 0.12 + cluster * 0.7) continue;
        // Dál od kamery řidší (každý druhý až třetí trs), aby velký dosah nestál moc vrcholů; zbylé trsy jsou o kus větší.
        const far = Math.max(0, (d - R * 0.35) / (R * 0.65));
        if (far > 0 && r3 > (0.12 + cluster * 0.7) * (1 - 0.6 * far)) continue;
        if (this.covered(x, z)) continue;
        const dirt = t.dirt ? t.dirt[Math.max(0, Math.min(t.samplesZ - 1, Math.round((z - t.origin[1]) / t.spacing))) * t.samplesX + Math.max(0, Math.min(t.samplesX - 1, Math.round((x - t.origin[0]) / t.spacing)))] ?? 0 : 0;
        void dirt;
        const y = heightAt(t, x, z);
        if (y === null) continue;
        // Svah: rozdíl výšek na 1 m.
        const sl = Math.abs((heightAt(t, x + 1, z) ?? y) - y) + Math.abs((heightAt(t, x, z + 1) ?? y) - y);
        if (sl > 0.55) continue;
        q.setFromAxisAngle(up, r1 * Math.PI * 2);
        const k = (0.65 + r2 * 0.9) * (1 + 0.35 * far);
        pos.set(x, y - 0.02, z);
        sc.set(k, k * (0.8 + r3 * 0.7), k);
        m.compose(pos, q, sc);
        this.mesh.setMatrixAt(n++, m);
      }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.mask = null;
    this.terrain = null;
    this.mesh.count = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
