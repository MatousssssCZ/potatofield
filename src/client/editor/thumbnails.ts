import * as THREE from 'three';
import type { MapObject } from '../../shared/map/schema';
import { generateObject, getAsset, resolveParams } from '../../world';
import { WorldView } from '../render/worldView';

/**
 * Náhledové obrázky katalogu: každý asset se jednou vykreslí stejnými materiály jako ve scéně
 * (šikmý pohled zepředu, neutrální pozadí) do obrázku 128 × 128 a uloží do paměti stránky.
 * Kreslí se hlavním rendererem do rohu plátna těsně před snímkem scény (který ho přepíše),
 * takže platí stejné tónování a barvy; po jednom až dvou náhledech na snímek (bez záseku).
 */
export const THUMB = 128;

export class Thumbnails {
  private cache = new Map<string, string>();
  private queue: string[] = [];
  private waiting = new Map<string, Array<(url: string) => void>>();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.05, 500);
  private canvas = document.createElement('canvas');

  constructor() {
    this.scene.background = new THREE.Color('#2c3230');
    this.scene.add(new THREE.HemisphereLight('#e8eef2', '#5a5248', 1.6));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);
    this.canvas.width = this.canvas.height = THUMB;
  }

  /** Obrázek assetu (z mezipaměti hned, jinak po vykreslení). */
  request(assetId: string, cb: (url: string) => void) {
    const hit = this.cache.get(assetId);
    if (hit) return cb(hit);
    const w = this.waiting.get(assetId);
    if (w) return void w.push(cb);
    this.waiting.set(assetId, [cb]);
    this.queue.push(assetId);
  }

  get pending() {
    return this.queue.length;
  }

  /** Vykreslí až `n` náhledů (volat ze smyčky před snímkem scény). */
  pump(renderer: THREE.WebGLRenderer, world: WorldView, n = 2) {
    for (let i = 0; i < n && this.queue.length; i++) this.renderOne(renderer, world, this.queue.shift()!);
  }

  private renderOne(renderer: THREE.WebGLRenderer, world: WorldView, assetId: string) {
    const def = getAsset(assetId);
    let url = '';
    if (def) {
      const obj: MapObject = {
        id: `thumb_${assetId}`,
        assetId,
        generatorVersion: def.generatorVersion,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        params: resolveParams(def, {}),
        seed: 12345,
        material: def.defaultMaterial,
      };
      const group = world.previewGroup(generateObject(obj));
      this.scene.add(group);
      // Kamera: celý objekt v záběru, šikmo zepředu shora (jako katalog nábytku).
      const box = new THREE.Box3().setFromObject(group);
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(0.3, box.getSize(new THREE.Vector3()).length() / 2);
      const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.02;
      this.camera.position.copy(c).add(new THREE.Vector3(0.75, 0.62, 1).normalize().multiplyScalar(dist));
      this.camera.near = dist / 50;
      this.camera.far = dist * 4;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(c);
      url = this.capture(renderer);
      this.scene.remove(group);
      WorldView.disposePreview(group);
    }
    this.cache.set(assetId, url);
    for (const cb of this.waiting.get(assetId) ?? []) cb(url);
    this.waiting.delete(assetId);
  }

  private capture(renderer: THREE.WebGLRenderer) {
    const pr = renderer.getPixelRatio();
    const size = THUMB / pr;
    const prevVp = renderer.getViewport(new THREE.Vector4());
    const prevSc = renderer.getScissor(new THREE.Vector4());
    const prevTest = renderer.getScissorTest();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, size, size);
    renderer.setScissor(0, 0, size, size);
    renderer.setScissorTest(true);
    renderer.shadowMap.autoUpdate = false;
    renderer.render(this.scene, this.camera);
    // Levý dolní roh plátna (WebGL počítá od spodu) → do 2D plátna náhledu, ve stejném úkolu.
    const g = this.canvas.getContext('2d')!;
    const src = renderer.domElement;
    g.clearRect(0, 0, THUMB, THUMB);
    g.drawImage(src, 0, src.height - THUMB, THUMB, THUMB, 0, 0, THUMB, THUMB);
    renderer.setViewport(prevVp);
    renderer.setScissor(prevSc);
    renderer.setScissorTest(prevTest);
    renderer.shadowMap.autoUpdate = prevShadow;
    return this.canvas.toDataURL('image/webp', 0.85);
  }
}

/** Jednoduché ikony herních markerů (vlajka, spawny, zóna) – kreslené, bez 3D. */
export function markerIcon(kind: 'flag' | 'spawnA' | 'spawnB' | 'zone'): string {
  const c = document.createElement('canvas');
  c.width = c.height = THUMB;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c3230';
  g.fillRect(0, 0, THUMB, THUMB);
  g.lineWidth = 5;
  if (kind === 'flag') {
    g.strokeStyle = '#b9bcbb';
    g.beginPath();
    g.moveTo(44, 108);
    g.lineTo(44, 20);
    g.stroke();
    g.fillStyle = '#d8d5c7';
    g.beginPath();
    g.moveTo(47, 22);
    g.quadraticCurveTo(70, 14, 96, 26);
    g.lineTo(96, 58);
    g.quadraticCurveTo(70, 46, 47, 54);
    g.closePath();
    g.fill();
    g.strokeStyle = '#8f9a8a';
    g.beginPath();
    g.ellipse(64, 108, 44, 10, 0, 0, Math.PI * 2);
    g.stroke();
  } else if (kind === 'zone') {
    g.fillStyle = 'rgba(200,60,40,0.35)';
    g.strokeStyle = '#d0574c';
    g.setLineDash([10, 7]);
    g.fillRect(22, 30, 84, 68);
    g.strokeRect(22, 30, 84, 68);
    g.setLineDash([]);
    g.fillStyle = '#f2b4ad';
    g.font = '700 40px sans-serif';
    g.textAlign = 'center';
    g.fillText('!', 64, 78);
  } else {
    const col = kind === 'spawnA' ? '#66bbee' : '#f06a62';
    g.fillStyle = col;
    g.beginPath();
    g.arc(64, 44, 16, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(40, 100);
    g.quadraticCurveTo(64, 56, 88, 100);
    g.closePath();
    g.fill();
    g.fillStyle = '#151b1b';
    g.font = '700 22px sans-serif';
    g.textAlign = 'center';
    g.fillText(kind === 'spawnA' ? 'A' : 'B', 64, 52);
  }
  return c.toDataURL('image/png');
}
