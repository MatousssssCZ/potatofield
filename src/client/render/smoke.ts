import * as THREE from 'three';

/**
 * Kouř (dýmovnice, kouř výbuchu) jako jeden instancovaný hranol billboardů: celý oblak = jedno
 * vykreslovací volání, obláčky seřazené odzadu dopředu. Obláčky těsně u kamery mizí – jinak by se
 * přes celou obrazovku vrstvily desítky průhledných ploch (nejdražší situace: hráč uvnitř clony).
 */
const MAX = 96;

interface Puff {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size0: number;
  size1: number;
  fadeIn: number;
  rot: number;
  spin: number;
  tex: number;
  color: [number, number, number];
  /** Odpor vzduchu (1/s). */
  drag: number;
  opacity: number;
}

export interface PuffOpts {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  size0: number;
  size1: number;
  fadeIn?: number;
  color: [number, number, number];
  drag?: number;
  opacity?: number;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData; // velikost, průhlednost, natočení, index textury
attribute vec3 iColor;
varying vec2 vUv;
varying vec2 vQuad;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.z), s = sin(iData.z);
  mvPosition.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iData.x;
  vUv = vec2((uv.x + iData.w) / 3.0, uv.y);
  vQuad = uv;
  vAlpha = iData.y;
  vColor = iColor;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec2 vQuad;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  // Kruhové doznění: žádná hrana čtverce ani přesah ze sousední varianty v atlasu.
  float r = length(vQuad - 0.5) * 2.0;
  float a = t.a * vAlpha * (1.0 - smoothstep(0.62, 0.98, r));
  if (a < 0.006) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class SmokeCloud {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aData: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private puffs: Puff[] = [];
  private order: Array<{ p: Puff; d: number }> = [];

  constructor(atlas: THREE.Texture) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iData', this.aData);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    mat.uniforms.map.value = atlas;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = 'smoke';
    this.mesh.frustumCulled = false;
    // Kouř se kreslí po ostatních průhledných věcech (jako dřív sprity).
    this.mesh.renderOrder = 2;
  }

  get count() {
    return this.puffs.length;
  }

  emit(o: PuffOpts) {
    let p: Puff;
    if (this.puffs.length >= MAX) {
      // Plno: nahradí se obláček s nejkratším zbytkem života.
      p = this.puffs.reduce((a, b) => (a.life < b.life ? a : b));
    } else {
      p = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size0: 1, size1: 1, fadeIn: 0, rot: 0, spin: 0, tex: 0, color: [1, 1, 1], drag: 1.4, opacity: 0.85 };
      this.puffs.push(p);
    }
    p.pos.copy(o.pos);
    p.vel.copy(o.vel);
    p.life = p.max = o.life;
    p.size0 = o.size0;
    p.size1 = o.size1;
    p.fadeIn = o.fadeIn ?? 0;
    p.rot = Math.random() * Math.PI * 2;
    p.spin = (Math.random() - 0.5) * 0.25;
    p.tex = (Math.random() * 3) | 0;
    p.color = o.color;
    p.drag = o.drag ?? 1.4;
    p.opacity = o.opacity ?? 0.85;
  }

  update(dt: number, cam: THREE.Vector3) {
    let w = 0;
    for (const p of this.puffs) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.multiplyScalar(Math.exp(-dt * p.drag));
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.spin * dt;
      this.puffs[w++] = p;
    }
    this.puffs.length = w;
    // Řazení odzadu dopředu (průhlednost) – desítky prvků, levné.
    const order = this.order;
    order.length = 0;
    for (const p of this.puffs) order.push({ p, d: p.pos.distanceToSquared(cam) });
    order.sort((a, b) => b.d - a.d);
    let n = 0;
    const P = this.aPos.array as Float32Array, D = this.aData.array as Float32Array, C = this.aColor.array as Float32Array;
    for (const { p, d } of order) {
      const k = 1 - p.life / p.max;
      const size = p.size0 + (p.size1 - p.size0) * (1 - Math.pow(1 - k, 2.2));
      const fadeIn = p.fadeIn > 0 ? Math.min(1, (p.max - p.life) / p.fadeIn) : 1;
      let a = fadeIn * Math.min(1, p.life / Math.min(p.max, 2.5)) * p.opacity;
      // U kamery obláček zprůhlední a zmizí: místo mnoha vrstev přes celou obrazovku jen opar.
      const dist = Math.sqrt(d), near = size * 0.55;
      if (dist < near) a *= Math.max(0, (dist - size * 0.18) / (near - size * 0.18));
      if (a < 0.01) continue;
      P[n * 3] = p.pos.x;
      P[n * 3 + 1] = p.pos.y;
      P[n * 3 + 2] = p.pos.z;
      D[n * 4] = size;
      D[n * 4 + 1] = a;
      D[n * 4 + 2] = p.rot;
      D[n * 4 + 3] = p.tex;
      C[n * 3] = p.color[0];
      C[n * 3 + 1] = p.color[1];
      C[n * 3 + 2] = p.color[2];
      n++;
    }
    this.geo.instanceCount = n;
    if (n) {
      this.aPos.addUpdateRange(0, n * 3);
      this.aData.addUpdateRange(0, n * 4);
      this.aColor.addUpdateRange(0, n * 3);
      this.aPos.needsUpdate = this.aData.needsUpdate = this.aColor.needsUpdate = true;
    }
  }

  /** Hustota kouře v bodě (0 = čisto, ~1 = uvnitř hustého oblaku) – pro zakalení pohledu. */
  densityAt(at: THREE.Vector3): number {
    let s = 0;
    for (const p of this.puffs) {
      const k = 1 - p.life / p.max;
      const size = p.size0 + (p.size1 - p.size0) * (1 - Math.pow(1 - k, 2.2));
      const r = size * 0.45;
      const d = p.pos.distanceTo(at);
      if (d < r) s += (1 - d / r) * p.opacity * Math.min(1, p.life / 2.5) * 0.35;
    }
    return Math.min(1, s);
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
