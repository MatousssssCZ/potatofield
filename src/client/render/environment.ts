import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { EnvironmentProfile } from '../../shared/map/schema';
import type { QualityProfile } from './quality';

/** Směr ke slunci z azimutu (0 = sever/−Z, po směru hodin) a výšky ve stupních. */
export function sunDirection(azDeg: number, elDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

interface SkyLook {
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  clouds: number;
  cloudDensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  envIntensity: number;
  envZenith: string;
  envHorizon: string;
  envSunGlow: string;
  exposure: number;
}

const LOOKS: Record<EnvironmentProfile['preset'], SkyLook> = {
  dustyNoon: {
    turbidity: 9,
    rayleigh: 1.4,
    mie: 0.012,
    mieG: 0.82,
    clouds: 0.18,
    cloudDensity: 0.35,
    hemiSky: '#cfd8df',
    hemiGround: '#9c8460',
    hemiIntensity: 0.55,
    envIntensity: 0.6,
    envZenith: '#6f8fae',
    envHorizon: '#c9bfae',
    envSunGlow: '#4a3e2a',
    exposure: 0.92,
  },
  clearSun: {
    turbidity: 3,
    rayleigh: 1.2,
    mie: 0.004,
    mieG: 0.8,
    clouds: 0.25,
    cloudDensity: 0.4,
    hemiSky: '#bcd2ec',
    hemiGround: '#8f7a5c',
    hemiIntensity: 0.5,
    envIntensity: 0.6,
    envZenith: '#5d86b8',
    envHorizon: '#b9c6d2',
    envSunGlow: '#3d3626',
    exposure: 0.9,
  },
  overcastRain: {
    turbidity: 18,
    rayleigh: 0.6,
    mie: 0.03,
    mieG: 0.6,
    clouds: 0.85,
    cloudDensity: 0.8,
    hemiSky: '#a9adb0',
    hemiGround: '#6f6556',
    hemiIntensity: 0.9,
    envIntensity: 0.9,
    envZenith: '#8e9499',
    envHorizon: '#a5a7a6',
    envSunGlow: '#151413',
    exposure: 1.05,
  },
};

/**
 * Prostředí scény: obloha s mraky, slunce se stíny sledujícími hráče,
 * okolní světlo (hemisféra + IBL z oblohy) a herní mlha.
 * Profil prostředí je oddělený od geometrie mapy.
 */
export class EnvironmentRig {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#886644', 0.5);
  readonly fog = new THREE.FogExp2('#cdbb9c', 0.003);
  private sunDir = new THREE.Vector3(0, 1, 0);
  private envRT: THREE.WebGLRenderTarget | null = null;
  private shadowRange = 45;
  private time = 0;
  /**
   * Překreslování stínů: 0 = každý snímek (editor – objekty se mění), jinak Hz (hra).
   * Ve hře se stínová kamera přesouvá po 2 m a mapa se překreslí při přesunu nebo
   * s touto frekvencí kvůli pohyblivým postavám.
   */
  shadowRate = 0;
  private lastSnap = new THREE.Vector3(Number.NaN, 0, 0);
  private shadowT = 0;
  /** Déšť: kosmetický efekt jen kolem kamery (Low ho vypíná; herní viditelnost nemění). */
  private rain: THREE.LineSegments | null = null;
  private rainPos: Float32Array | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
  ) {
    this.sky.scale.setScalar(4000);
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.add(this.hemi);
    scene.fog = this.fog;
    this.sun.castShadow = true;
  }

  apply(env: EnvironmentProfile, q: QualityProfile) {
    const look = LOOKS[env.preset];
    this.sunDir = sunDirection(env.sunAzimuthDeg, env.sunElevationDeg);
    const u = this.sky.material.uniforms;
    u.turbidity.value = look.turbidity;
    u.rayleigh.value = look.rayleigh;
    u.mieCoefficient.value = look.mie;
    u.mieDirectionalG.value = look.mieG;
    u.cloudCoverage.value = look.clouds;
    u.cloudDensity.value = look.cloudDensity;
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000);

    this.sun.color.set(env.sunColor);
    this.sun.intensity = env.sunIntensity * (env.preset === 'overcastRain' ? 0.35 : 1);
    this.hemi.color.set(look.hemiSky);
    this.hemi.groundColor.set(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity * env.ambientIntensity;
    this.fog.color.set(env.fogColor);
    // FogExp2: f = exp(−(d·density)²) → 50 % při d = √ln2 / density.
    this.fog.density = Math.sqrt(Math.LN2) / env.fogHalfDistance;
    this.renderer.toneMappingExposure = look.exposure;

    // Stíny dle profilu kvality (nemění herní viditelnost ani kryty).
    this.shadowRange = q.shadowRange;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== q.shadowMapSize) {
      sh.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      sh.map?.dispose();
      sh.map = null;
    }
    this.sun.castShadow = q.shadowMapSize > 0;
    const cam = sh.camera as THREE.OrthographicCamera;
    cam.left = cam.bottom = -q.shadowRange;
    cam.right = cam.top = q.shadowRange;
    cam.near = 1;
    cam.far = 400;
    cam.updateProjectionMatrix();
    sh.bias = -0.0004;
    sh.normalBias = 0.035 * (q.shadowRange / 45);
    sh.radius = 3;

    this.rebuildEnvMap(look);
    this.setRain(env.preset === 'overcastRain' && q.id !== 'low' ? (q.id === 'high' ? 4000 : 2200) : 0);
  }

  private setRain(count: number) {
    if (this.rain) {
      this.rain.geometry.dispose();
      (this.rain.material as THREE.Material).dispose();
      this.rain.removeFromParent();
      this.rain = null;
      this.rainPos = null;
    }
    if (!count) return;
    const pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 40, y = Math.random() * 20, z = (Math.random() - 0.5) * 40;
      pos.set([x, y, z, x + 0.02, y - 0.45, z + 0.01], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({ color: '#b9c2c8', transparent: true, opacity: 0.35, depthWrite: false });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.rain.raycast = () => {};
    this.rainPos = pos;
    this.scene.add(this.rain);
  }

  /**
   * IBL z kontrolovaného gradientu (zenit / horizont / zem + slabá záře u slunce).
   * Shader oblohy má vysoký dynamický rozsah a přehlušil by slunce i stíny.
   */
  private rebuildEnvMap(look: SkyLook) {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(look.envZenith) },
        horizon: { value: new THREE.Color(look.envHorizon) },
        ground: { value: new THREE.Color(look.hemiGround).multiplyScalar(0.6) },
        sunDir: { value: this.sunDir.clone() },
        sunGlow: { value: new THREE.Color(look.envSunGlow) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 zenith, horizon, ground, sunDir, sunGlow; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float up = d.y;
          vec3 sky = mix(horizon, zenith, pow(clamp(up,0.0,1.0), 0.55));
          vec3 col = up >= 0.0 ? sky : mix(horizon * 0.8, ground, smoothstep(0.0, 0.25, -up));
          float g = pow(max(dot(d, sunDir), 0.0), 8.0);
          col += sunGlow * g;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), mat);
    envScene.add(dome);
    this.envRT?.dispose();
    this.envRT = pm.fromScene(envScene, 0, 0.1, 100);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = look.envIntensity;
    pm.dispose();
    dome.geometry.dispose();
    mat.dispose();
  }

  /** Stínová kamera sleduje pohled, přichycená na texely (bez mihotání). */
  update(focus: THREE.Vector3, dt: number) {
    this.time += dt;
    this.sky.material.uniforms.time.value = this.time;
    const sh = this.sun.shadow;
    const texel = (this.shadowRange * 2) / Math.max(1, sh.mapSize.x);
    // Přichycení v prostoru světla.
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const p = focus.clone().applyMatrix4(inv);
    const step = this.shadowRate ? texel * Math.max(1, Math.round(2 / texel)) : texel;
    p.x = Math.round(p.x / step) * step;
    p.y = Math.round(p.y / step) * step;
    const snapped = p.applyMatrix4(lightRot);
    const sm = this.renderer.shadowMap;
    if (!this.shadowRate) sm.autoUpdate = true;
    else {
      sm.autoUpdate = false;
      this.shadowT += dt;
      if (!snapped.equals(this.lastSnap) || this.shadowT >= 1 / this.shadowRate) {
        sm.needsUpdate = true;
        this.shadowT = 0;
        this.lastSnap.copy(snapped);
      }
    }
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(focus);
    if (this.rain && this.rainPos) {
      const p = this.rainPos;
      const fall = 14 * dt;
      for (let i = 0; i < p.length; i += 6) {
        p[i + 1] -= fall;
        p[i + 4] -= fall;
        if (p[i + 4] < -2) {
          p[i + 1] += 20;
          p[i + 4] += 20;
        }
      }
      this.rain.geometry.getAttribute('position').needsUpdate = true;
      this.rain.position.set(Math.round(focus.x / 4) * 4, focus.y - 4, Math.round(focus.z / 4) * 4);
    }
  }

  dispose() {
    this.envRT?.dispose();
    this.setRain(0);
  }
}
