import * as THREE from 'three';
import type { TexOutput } from './texgen';

/**
 * Knihovna materiálů. Textury jsou procedurální (texgen) a sdílené; měřítko
 * v metrech je zapečené do UV geometrie (`tile` = kolik metrů pokryje jedna dlaždice).
 */
export interface MatDef {
  tex?: string;
  /** Metrů na jedno opakování textury. */
  tile: number;
  tint?: string;
  roughness?: number;
  metalness?: number;
  /** Sílа prachu u paty objektu (0–1). */
  dust?: number;
  /** Velkoplošná barevná variace (0–1). */
  macro?: number;
  emissive?: string;
  side?: THREE.Side;
  alphaTest?: number;
  transparent?: boolean;
  opacity?: number;
  envMapIntensity?: number;
}

export const MATERIALS: Record<string, MatDef> = {
  concrete: { tex: 'concrete', tile: 3, dust: 0.6, macro: 0.6 },
  concreteLight: { tex: 'concreteLight', tile: 2.5, dust: 0.6, macro: 0.5 },
  plaster: { tex: 'plaster', tile: 3, dust: 0.7, macro: 0.6 },
  plasterWarm: { tex: 'plasterWarm', tile: 3, dust: 0.7, macro: 0.6 },
  plasterWhite: { tex: 'plasterWhite', tile: 3, dust: 0.7, macro: 0.6 },
  brick: { tex: 'brick', tile: 1.6, dust: 0.5, macro: 0.4 },
  sandstone: { tex: 'sandstone', tile: 3, dust: 0.5, macro: 0.5 },
  paving: { tex: 'paving', tile: 2, dust: 0.0, macro: 0.5 },
  asphalt: { tex: 'asphalt', tile: 5, dust: 0.0, macro: 0.6 },
  sand: { tex: 'sand', tile: 6, macro: 0.5 },
  dirt: { tex: 'dirt', tile: 6, macro: 0.5 },
  wood: { tex: 'wood', tile: 1.0, dust: 0.4, macro: 0.3 },
  woodDark: { tex: 'woodDark', tile: 1.0, dust: 0.4, macro: 0.3 },
  metal: { tex: 'metal', tile: 1.5, dust: 0.3, macro: 0.2 },
  paintedMetal: { tex: 'paintedMetal', tile: 1.5, dust: 0.5, macro: 0.3 },
  paintedMetalBlue: { tex: 'paintedMetalBlue', tile: 1.5, dust: 0.5, macro: 0.3 },
  paintedMetalRed: { tex: 'paintedMetalRed', tile: 1.5, dust: 0.5, macro: 0.3 },
  fabricSand: { tex: 'fabricSand', tile: 0.8, dust: 0.3, macro: 0.3 },
  paint: { tex: 'paint', tile: 2 },
  paintDim: { tex: 'paintDim', tile: 2 },
  target: { tex: 'target', tile: 1 },
  plasterOchre: { tex: 'plasterOchre', tile: 3, dust: 0.7, macro: 0.6 },
  concreteDark: { tex: 'concreteDark', tile: 2.5, dust: 0.3, macro: 0.5 },
  metalSheet: { tex: 'metalSheet', tile: 2.4, dust: 0.5, macro: 0.4 },
  metalSheetRust: { tex: 'metalSheetRust', tile: 2.4, dust: 0.5, macro: 0.4 },
  containerRed: { tex: 'containerRed', tile: 2.5, dust: 0.5, macro: 0.3 },
  containerBlue: { tex: 'containerBlue', tile: 2.5, dust: 0.5, macro: 0.3 },
  containerGreen: { tex: 'containerGreen', tile: 2.5, dust: 0.5, macro: 0.3 },
  containerSand: { tex: 'containerSand', tile: 2.5, dust: 0.5, macro: 0.3 },
  chainLink: { tex: 'chainLink', tile: 1, alphaTest: 0.5, side: THREE.DoubleSide },
  roof: { tex: 'roof', tile: 3, macro: 0.4 },
  shutter: { tex: 'shutter', tile: 2.5, dust: 0.5, macro: 0.4 },
  shutterBox: { tex: 'paintedMetal', tile: 1.5, tint: '#c8c4b8' },
  awningRed: { tex: 'awningRed', tile: 2.5, side: THREE.DoubleSide },
  awningBlue: { tex: 'awningBlue', tile: 2.5, side: THREE.DoubleSide },
  awningGreen: { tex: 'awningGreen', tile: 2.5, side: THREE.DoubleSide },
  awningSand: { tex: 'awningSand', tile: 2.5, side: THREE.DoubleSide },
  acUnit: { tex: 'acUnit', tile: 0.8 },
  crateFruitA: { tex: 'crateFruitA', tile: 0.5 },
  crateFruitB: { tex: 'crateFruitB', tile: 0.5 },
  crateFruitC: { tex: 'crateFruitC', tile: 0.5 },
  glass: { tile: 1, tint: '#1d2933', roughness: 0.12, metalness: 0.0, envMapIntensity: 2.2 },
  glassShop: { tile: 1, tint: '#2a3a40', roughness: 0.18, metalness: 0.0, envMapIntensity: 1.8 },
  lamp: { tile: 1, tint: '#efe6c8', emissive: '#4a4030', roughness: 0.4 },
  gunMetal: { tex: 'metal', tile: 0.35, tint: '#9a9ca0', metalness: 0.55, roughness: 0.9 },
  gunPolymer: { tex: 'paintedMetal', tile: 0.4, tint: '#8f927a' },
  debugMissing: { tile: 1, tint: '#ff00ff', emissive: '#550055', roughness: 0.5 },
};

export const TEXTURE_IDS = [...new Set(Object.values(MATERIALS).map((m) => m.tex).filter(Boolean))] as string[];

export function tileOf(material: string): number {
  return MATERIALS[material]?.tile ?? 2;
}

export interface TexSet {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  orm: THREE.DataTexture;
}

function dataTex(data: Uint8Array, size: number, srgb: boolean, anisotropy: number) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Generuje textury paralelně ve Web Workerech. */
export async function generateTextures(
  ids: string[],
  size: number,
  anisotropy: number,
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, TexSet>> {
  const out = new Map<string, TexSet>();
  const workers = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8, ids.length));
  const queue = [...ids];
  let done = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      const w = new Worker(new URL('./texWorker.ts', import.meta.url), { type: 'module' });
      try {
        while (queue.length) {
          const id = queue.shift()!;
          const tex = await new Promise<TexOutput>((resolve, reject) => {
            w.onmessage = (e) => resolve(e.data.tex as TexOutput);
            w.onerror = (e) => reject(e);
            w.postMessage({ id, size, job: 0 });
          });
          out.set(id, {
            map: dataTex(tex.albedo, size, true, anisotropy),
            normalMap: dataTex(tex.normal, size, false, anisotropy),
            orm: dataTex(tex.orm, size, false, anisotropy),
          });
          onProgress(++done, ids.length);
        }
      } finally {
        w.terminate();
      }
    }),
  );
  return out;
}

/** Dlaždicový šum pro velkoplošnou variaci (anti-tiling), generovaný jednou. */
export function makeMacroNoise(): THREE.DataTexture {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  const h = (x: number, y: number) => {
    let v = (x * 374761393 + y * 668265263) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
  };
  const vn = (x: number, y: number, p: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const m = (a: number) => ((a % p) + p) % p;
    const a = h(m(xi), m(yi)), b = h(m(xi + 1), m(yi)), c = h(m(xi), m(yi + 1)), d = h(m(xi + 1), m(yi + 1));
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n;
      let s = 0, amp = 0.5, norm = 0;
      for (let o = 0, p = 4; o < 5; o++, p *= 2) {
        s += vn(u * p, v * p, p) * amp;
        norm += amp;
        amp *= 0.5;
      }
      const g = Math.round((s / norm) * 255);
      const i = (y * n + x) * 4;
      data[i] = g;
      data[i + 1] = Math.round(vn(u * 16 + 3, v * 16 + 7, 16) * 255);
      data[i + 2] = Math.round(vn(u * 64 + 5, v * 64 + 1, 64) * 255);
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export const sharedUniforms = {
  uMacro: { value: null as THREE.Texture | null },
  uDustColor: { value: new THREE.Color('#b59b77') },
};

/**
 * Úprava standardního shaderu: velkoplošná variace barvy (proti viditelnému opakování)
 * a prach u paty objektu podle atributu `aBaseH` (výška nad podstavou objektu).
 */
export function patchWeathering(mat: THREE.MeshStandardMaterial, dust: number, macro: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = sharedUniforms.uMacro;
    sh.uniforms.uDustColor = sharedUniforms.uDustColor;
    sh.uniforms.uDust = { value: dust };
    sh.uniforms.uMacroAmt = { value: macro };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBaseH;\nvarying float vBaseH;\nvarying vec3 vWPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvBaseH = aBaseH;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uMacro;\nuniform vec3 uDustColor;\nuniform float uDust;\nuniform float uMacroAmt;\nvarying float vBaseH;\nvarying vec3 vWPos;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 wp = vWPos.xz + vWPos.y * 0.37;
          float m1 = texture2D(uMacro, wp * 0.013).r;
          float m2 = texture2D(uMacro, wp * 0.071).g;
          float macroV = mix(1.0, (0.8 + 0.4 * m1) * (0.92 + 0.16 * m2), uMacroAmt);
          diffuseColor.rgb *= macroV;
          float dn = texture2D(uMacro, wp * 0.23).b;
          float dustT = (1.0 - smoothstep(0.0, 0.7 + dn * 0.6, vBaseH)) * uDust * (0.55 + 0.45 * dn);
          diffuseColor.rgb = mix(diffuseColor.rgb, uDustColor, dustT * 0.6);
        }`,
      );
  };
  mat.customProgramCacheKey = () => `weather-${dust.toFixed(2)}-${macro.toFixed(2)}`;
}

const LABEL_STYLES: Record<string, { bg: string; fg: string; font: string; border: boolean; glow?: number }> = {
  label: { bg: '#e9e1cc', fg: '#2c2a24', font: '"Arial Narrow", Arial, sans-serif', border: true },
  labelHotel: { bg: '#8a2a20', fg: '#f6e7b8', font: 'Georgia, "Times New Roman", serif', border: false, glow: 0.25 },
  labelSign: { bg: '#24456a', fg: '#f1ead6', font: '"Trebuchet MS", Arial, sans-serif', border: true },
};

export class MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  constructor(private textures: Map<string, TexSet>) {}

  get(id: string): THREE.Material {
    let m = this.cache.get(id);
    if (m) return m;
    const def = MATERIALS[id] ?? MATERIALS.debugMissing;
    const tex = def.tex ? this.textures.get(def.tex) : undefined;
    const sm = new THREE.MeshStandardMaterial({
      color: def.tint ?? '#ffffff',
      roughness: def.roughness ?? 1,
      metalness: def.metalness ?? (tex ? 1 : 0),
      side: def.side ?? THREE.FrontSide,
      alphaTest: def.alphaTest ?? 0,
    });
    if (def.envMapIntensity !== undefined) sm.envMapIntensity = def.envMapIntensity;
    if (tex) {
      sm.map = tex.map;
      sm.normalMap = tex.normalMap;
      sm.roughnessMap = tex.orm;
      sm.metalnessMap = tex.orm;
      sm.aoMap = tex.orm;
      sm.aoMapIntensity = 1;
    }
    if (def.emissive) sm.emissive = new THREE.Color(def.emissive);
    patchWeathering(sm, def.dust ?? 0, def.macro ?? 0);
    sm.name = id;
    this.cache.set(id, sm);
    return sm;
  }

  private labels = new Map<string, THREE.Material>();
  /** Materiál pro textový štítek (text renderovaný jako text, nikdy jako HTML). */
  label(text: string, style = 'label'): THREE.Material {
    const key = `${style}|${text}`;
    let m = this.labels.get(key);
    if (m) return m;
    const st = LABEL_STYLES[style] ?? LABEL_STYLES.label;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 200;
    const g = c.getContext('2d')!;
    const txt = text.slice(0, 32);
    c.width = Math.min(2048, Math.max(512, txt.length * 110));
    g.fillStyle = st.bg;
    g.fillRect(0, 0, c.width, c.height);
    if (st.border) {
      g.strokeStyle = st.fg;
      g.lineWidth = 10;
      g.strokeRect(10, 10, c.width - 20, c.height - 20);
    }
    g.fillStyle = st.fg;
    g.font = `bold 120px ${st.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Text se vykresluje jako text (nikdy jako HTML); šířka se přizpůsobí.
    const w = g.measureText(txt).width;
    const sx = Math.min(1, (c.width - 60) / Math.max(1, w));
    g.save();
    g.translate(c.width / 2, c.height / 2 + 6);
    g.scale(sx, 1);
    g.fillText(txt, 0, 0);
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, emissive: st.glow ? '#ffffff' : '#000000', emissiveMap: st.glow ? t : null, emissiveIntensity: st.glow ?? 0 });
    this.labels.set(key, m);
    return m;
  }
}
