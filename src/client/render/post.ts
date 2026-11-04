import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';
import type { QualityProfile } from './quality';

/**
 * Volitelné post-processing: ambientní zastínění (N8AO, ISC licence) pro profil Vysoká.
 * Bez AO se renderuje přímo (nejlevnější cesta pro integrovanou grafiku).
 */
export class PostPipeline {
  private composer: EffectComposer | null = null;
  private ao: InstanceType<typeof N8AOPass> | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    q: QualityProfile,
  ) {
    if (!q.ao) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.antialias ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    const ao = new N8AOPass(scene, camera, size.x, size.y);
    ao.configuration.aoRadius = 1.6;
    ao.configuration.distanceFalloff = 1.2;
    ao.configuration.intensity = 2.2;
    ao.configuration.color = new THREE.Color(0x1a1208);
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.gammaCorrection = false;
    this.ao = ao;
    this.composer.addPass(ao);
    this.composer.addPass(new OutputPass());
  }

  get enabled() {
    return this.composer !== null;
  }

  setSize(w: number, h: number) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
    void this.ao;
  }
}
