import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { N8AOPass } from 'n8ao';
import type { QualityProfile } from './quality';

/**
 * Volitelné post-processing: ambientní zastínění (N8AO, ISC licence) pro profil Vysoká.
 * Bez AO se renderuje přímo (nejlevnější cesta pro integrovanou grafiku).
 */
/**
 * Barevné ladění po tone mappingu (display-referred): jemná S‑křivka kontrastu, teplé světlo / chladné
 * stíny (split toning), mírná sytost, vinětace a téměř neviditelná zrnitost proti pruhování oblohy.
 * Jeden průchod přes celou obrazovku – levné i na integrované grafice.
 */
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uAmount: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmount; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // Kontrast: S‑křivka kolem středu šedé.
      vec3 s = col * col * (3.0 - 2.0 * col);
      col = mix(col, s, 0.45 * uAmount);
      // Teplé světlo, chladné stíny.
      vec3 warm = vec3(1.06, 1.015, 0.93), cool = vec3(0.975, 0.99, 1.025);
      col *= mix(cool, warm, smoothstep(0.12, 0.7, l));
      // Sytost (písek a modrá obloha).
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(g), col, 1.0 + 0.16 * uAmount);
      // Vinětace.
      vec2 d = vUv - 0.5;
      col *= 1.0 - 0.34 * uAmount * smoothstep(0.35, 0.95, length(d * vec2(1.0, 0.85)) * 1.25);
      col += (hash(vUv * 1500.0) - 0.5) * 0.018 * uAmount;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class PostPipeline {
  private composer: EffectComposer | null = null;
  private ao: InstanceType<typeof N8AOPass> | null = null;
  private grade: ShaderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private t = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    q: QualityProfile,
    film = true,
  ) {
    const useGrade = film && q.grade, useBloom = film && q.bloom;
    if (!q.ao && !useGrade && !useBloom) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.antialias ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      const ao = new N8AOPass(scene, camera, size.x, size.y);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 2.2;
      ao.configuration.color = new THREE.Color(0x1a1208);
      ao.configuration.halfRes = true;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.gammaCorrection = false;
      this.ao = ao;
      // N8AO kreslí scénu sám – RenderPass se pak nepoužije.
      this.composer.removePass(this.composer.passes[0]);
      this.composer.addPass(ao);
    }
    if (useBloom) {
      // Práh vysoko: září jen slunce, odlesky kovu a záblesky (ne celá scéna). Poloviční rozlišení.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.6, 1.05);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    if (useGrade) {
      this.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.grade);
    }
  }

  get enabled() {
    return this.composer !== null;
  }

  get features() {
    return [this.ao ? 'AO' : '', this.bloom ? 'bloom' : '', this.grade ? 'grade' : ''].filter(Boolean).join('+');
  }

  setSize(w: number, h: number) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    if (this.grade) {
      this.t = (this.t + dt) % 100;
      this.grade.uniforms.uTime.value = this.t;
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Překlad shaderů scény dopředu. Se zapnutým post-processingem se scéna kreslí do textury
   * (lineární barvy, bez tone mappingu), takže se musí překládat s tímtéž cílem – jinak by
   * `compile` připravil varianty pro obrazovku a skutečné kreslení by stejně překládalo znovu.
   */
  compile() {
    const R = this.renderer;
    const prev = R.getRenderTarget();
    if (this.composer) R.setRenderTarget(this.composer.readBuffer);
    R.compile(this.scene, this.camera);
    // Jedno skutečné vykreslení: ovladače GPU často dokončí překlad až při prvním kreslení
    // a Three.js při něm ověřuje stav programu (synchronní čekání). Ať se to stane teď.
    R.render(this.scene, this.camera);
    R.setRenderTarget(prev);
  }

  dispose() {
    this.composer?.dispose();
    void this.ao;
  }
}
