import * as THREE from 'three';
import type { TerrainData } from '../../shared/map/schema';
import type { GeneratedObject } from '../../world/registry';

/**
 * Zapečené osvětlení terénu pro celou mapu (jako lightmapy BF2, ale spočtené při startu hry):
 * R = sluneční stín budov a zdí (1 = na slunci), G = ambientní zastínění u paty zdí (1 = volno).
 * Dynamická stínová mapa pokrývá jen okolí kamery; za jejím dosahem terén přebírá zapečený stín,
 * takže vzdálené ulice nejsou ploše nasvícené. Jen vzhled – na hru (kryty, viditelnost) nemá vliv.
 */
export const CELL = 0.75;

/** Výšková mřížka překážek (absolutní Y vršku, −Infinity = nic) z vygenerovaných dílů. */
export function obstacleGrid(terrain: TerrainData, gen: GeneratedObject[], cell = CELL) {
  const w = (terrain.samplesX - 1) * terrain.spacing, d = (terrain.samplesZ - 1) * terrain.spacing;
  const nx = Math.ceil(w / cell), nz = Math.ceil(d / cell);
  const top = new Float32Array(nx * nz).fill(-Infinity);
  const [x0, z0] = terrain.origin;
  const put = (x: number, z: number, y: number) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    if (i >= 0 && j >= 0 && i < nx && j < nz && y > top[j * nx + i]) top[j * nx + i] = y;
  };
  for (const g of gen) {
    const o = g.object;
    if (o.gameHidden) continue;
    const [px, py, pz] = o.transform.position;
    const yaw = o.transform.rotation[1], sc = o.transform.scale ?? 1;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const p of g.parts) {
      if (p.render === false || p.castShadow === false) continue;
      if (p.shape !== 'box' && p.shape !== 'cylinder' && p.shape !== 'wedge' && p.shape !== 'blob') continue;
      if (p.size[1] * sc < 0.35) continue; // nízké díly (obrubníky, desky) stín na dálku nedělají
      const yTop = py + (p.pos[1] + p.size[1] / 2) * sc;
      const hx = p.size[0] / 2, hz = p.size[2] / 2;
      const ry = p.rot?.[1] ?? 0, cr = Math.cos(ry), sr = Math.sin(ry);
      const step = cell * 0.5 / Math.max(sc, 1e-3);
      for (let u = -hx; u <= hx + 1e-6; u += step)
        for (let v = -hz; v <= hz + 1e-6; v += step) {
          if (p.shape === 'cylinder' && (u * u) / (hx * hx + 1e-6) + (v * v) / (hz * hz + 1e-6) > 1) continue;
          const lx = p.pos[0] + cr * u + sr * v, lz = p.pos[2] - sr * u + cr * v;
          put(px + (c * lx + s * lz) * sc, pz + (-s * lx + c * lz) * sc, yTop);
        }
    }
  }
  return { top, nx, nz, x0, z0, cell };
}

function terrainSampler(t: TerrainData) {
  return (x: number, z: number) => {
    const fx = Math.min(t.samplesX - 1.001, Math.max(0, (x - t.origin[0]) / t.spacing));
    const fz = Math.min(t.samplesZ - 1.001, Math.max(0, (z - t.origin[1]) / t.spacing));
    const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
    const h = (ii: number, jj: number) => t.heights[jj * t.samplesX + ii];
    return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b;
  };
}

/** Výpočet stínu a AO (čistá funkce, testovatelná). `sun` míří ke slunci. */
export function bakeLight(terrain: TerrainData, gen: GeneratedObject[], sun: THREE.Vector3, cell = CELL) {
  const G = obstacleGrid(terrain, gen, cell);
  const { top, nx, nz, x0, z0 } = G;
  const ground = terrainSampler(terrain);
  const gh = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) gh[j * nx + i] = ground(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);

  // Stín: pochod ke slunci po mřížce; zastíní překážka vyšší než paprsek.
  const shadow = new Float32Array(nx * nz).fill(1);
  const horiz = Math.hypot(sun.x, sun.z);
  if (sun.y > 0.02 && horiz > 1e-4) {
    const dx = sun.x / horiz, dz = sun.z / horiz, rise = (sun.y / horiz) * cell;
    let maxTop = -Infinity;
    for (let k = 0; k < top.length; k++) if (top[k] > maxTop) maxTop = top[k];
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (top[k] > gh[k] + 0.3) continue; // uvnitř budovy (střecha se stíní dynamicky)
        let y = gh[k] + 0.15, fx = i + 0.5, fz = j + 0.5;
        for (let st = 0; st < 160 && y < maxTop; st++) {
          fx += dx;
          fz += dz;
          y += rise;
          const ii = Math.floor(fx), jj = Math.floor(fz);
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) break;
          if (top[jj * nx + ii] > y) {
            shadow[k] = 0;
            break;
          }
        }
      }
  }

  // AO: podíl blízkých překážek vyšších než 0,6 m (dvě velikosti okolí), měkký náběh u paty zdi.
  const solid = new Float32Array(nx * nz);
  for (let k = 0; k < top.length; k++) solid[k] = top[k] > gh[k] + 0.6 ? 1 : 0;
  const near = boxBlur(solid, nx, nz, Math.max(1, Math.round(1.2 / cell)));
  const wide = boxBlur(solid, nx, nz, Math.max(2, Math.round(3.5 / cell)));
  const ao = new Float32Array(nx * nz);
  for (let k = 0; k < ao.length; k++) ao[k] = solid[k] ? 1 : Math.max(0, 1 - near[k] * 0.9 - wide[k] * 0.45);

  const soft = boxBlur(shadow, nx, nz, 1);
  return { nx, nz, x0, z0, cell, shadow: soft, ao };
}

function boxBlur(src: Float32Array, nx: number, nz: number, r: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < nz; j++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[j * nx + Math.min(nx - 1, Math.max(0, i))];
    for (let i = 0; i < nx; i++) {
      tmp[j * nx + i] = acc / (2 * r + 1);
      acc += src[j * nx + Math.min(nx - 1, i + r + 1)] - src[j * nx + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(nz - 1, Math.max(0, j)) * nx + i];
    for (let j = 0; j < nz; j++) {
      out[j * nx + i] = acc / (2 * r + 1);
      acc += tmp[Math.min(nz - 1, j + r + 1) * nx + i] - tmp[Math.max(0, j - r) * nx + i];
    }
  }
  return out;
}

/** Uniformy čtené shaderem terénu (sdílené, aby šly zapnout/vypnout bez rekompilace). */
export const bakeUniforms = {
  uBake: { value: null as THREE.Texture | null },
  /** x0, z0, 1/šířka, 1/hloubka (m). */
  uBakeRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uBakeOn: { value: 0 },
  /** Od–do (m od kamery): náběh zapečeného stínu za dosahem dynamické stínové mapy. */
  uShadowFar: { value: new THREE.Vector2(35, 43) },
};

/** Spočte a nahraje texturu; vrací dobu výpočtu (ms) pro dev výpis. */
export function applyBakedLight(terrain: TerrainData, gen: GeneratedObject[], sun: THREE.Vector3, shadowRange: number) {
  const t0 = performance.now();
  const b = bakeLight(terrain, gen, sun);
  const data = new Uint8Array(b.nx * b.nz * 4);
  for (let k = 0; k < b.nx * b.nz; k++) {
    data[k * 4] = Math.round(b.shadow[k] * 255);
    data[k * 4 + 1] = Math.round(b.ao[k] * 255);
    data[k * 4 + 3] = 255;
  }
  bakeUniforms.uBake.value?.dispose();
  const tex = new THREE.DataTexture(data, b.nx, b.nz);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  bakeUniforms.uBake.value = tex;
  bakeUniforms.uBakeRect.value.set(b.x0, b.z0, 1 / (b.nx * b.cell), 1 / (b.nz * b.cell));
  bakeUniforms.uShadowFar.value.set(shadowRange * 0.7, shadowRange * 0.92);
  bakeUniforms.uBakeOn.value = 1;
  return performance.now() - t0;
}

export function disableBakedLight() {
  bakeUniforms.uBakeOn.value = 0;
}

/**
 * Vraky, ze kterých stoupá kouř: objekty, jejichž viditelné díly jsou převážně z ohořelého kovu.
 * Vrací bod nad nejvyšším takovým dílem (ve světě).
 */
export function smokeSources(gen: GeneratedObject[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const g of gen) {
    const o = g.object;
    if (o.gameHidden) continue;
    const vis = g.parts.filter((p) => p.render !== false && p.shape !== 'label');
    const burnt = vis.filter((p) => p.material === 'burntMetal');
    if (vis.length < 5 || burnt.length / vis.length < 0.4) continue;
    const top = burnt.reduce((a, b) => (b.pos[1] + b.size[1] / 2 > a.pos[1] + a.size[1] / 2 ? b : a));
    const [px, py, pz] = o.transform.position;
    const yaw = o.transform.rotation[1], sc = o.transform.scale ?? 1;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.push(new THREE.Vector3(px + (c * top.pos[0] + s * top.pos[2]) * sc, py + (top.pos[1] + top.size[1] / 2) * sc, pz + (-s * top.pos[0] + c * top.pos[2]) * sc));
  }
  return out.slice(0, 12);
}
