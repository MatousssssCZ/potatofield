import * as THREE from 'three';
import { patchIndoor } from './bakedLight';
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
  /** Jas oblohy (shader oblohy je HDR a po tone mappingu by vybělel; <1 ztmaví a zsytí modř). */
  skyGain?: number;
}

/** Interní předvolba vzhledu (mapa ji neukládá): sytá modrá obloha a teplé světlo jako v BF2. */
type LookKey = EnvironmentProfile['preset'] | 'bf2Desert';

const LOOKS: Record<LookKey, SkyLook> = {
  bf2Desert: {
    turbidity: 2,
    rayleigh: 1.0,
    mie: 0.004,
    mieG: 0.8,
    clouds: 0.22,
    cloudDensity: 0.4,
    // Okolní světlo jen mírně chladné: sytě modrá hemisféra + IBL dohromady barvily stíny do modra
    // (na skutečných monitorech výrazně „přepálené“). Modrá zůstává na obloze, ne ve stínech.
    hemiSky: '#bcc6cf',
    hemiGround: '#c2a476',
    hemiIntensity: 0.56,
    envIntensity: 0.55,
    envZenith: '#6f87a0',
    envHorizon: '#c6c5bd',
    envSunGlow: '#5a4a2a',
    exposure: 0.96,
    skyGain: 0.56,
  },
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
  /** Opar na obloze: kopule barvy mlhy přes oblohu (u obzoru plná, k zenitu řidší). */
  private haze = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#cdbb9c') }, uHaze: { value: 0.25 } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 uColor; uniform float uHaze; varying vec3 vDir;' +
        'void main() { float up = vDir.y; float a = uHaze * mix(1.0, 0.45 + 0.55 * uHaze, smoothstep(0.0, 0.6, up)); if (up < 0.0) a = max(a, uHaze); gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
      side: THREE.BackSide,
      transparent: false,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  private sunDir = new THREE.Vector3(0, 1, 0);
  /** Směr ke slunci (jednotkový). */
  get sunDirection() {
    return this.sunDir.clone();
  }
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTex: THREE.Texture | null = null;
  private envScale = 1;
  private reflSeen = new WeakSet<THREE.Material>();

  /**
   * Okolní světlo jen z hemisféry. Dřív k ní přispívalo i IBL (PMREM odraz oblohy) na všech
   * materiálech – to bylo jedno z nejdražších míst v shaderu každého pixelu (~30 % snímku), a přitom
   * matný písek a omítka z něj mají jen rozptýlenou složku. Ta se teď přičte k hemisféře
   * (π × barva prostředí × intenzita, stejně jako ji počítá Three.js), takže jas zůstává.
   */
  private setAmbient(look: SkyLook, ambient: number) {
    const lin = (hex: string) => new THREE.Color(hex);
    const zen = lin(look.envZenith), hor = lin(look.envHorizon), gnd = lin(look.hemiGround).multiplyScalar(0.6);
    const envSky = hor.clone().lerp(zen, 0.6), envGround = hor.clone().multiplyScalar(0.8).lerp(gnd, 0.6);
    const k = Math.PI * look.envIntensity;
    const sky = lin(look.hemiSky).multiplyScalar(look.hemiIntensity * ambient).add(envSky.multiplyScalar(k));
    const ground = lin(look.hemiGround).multiplyScalar(look.hemiIntensity * ambient).add(envGround.multiplyScalar(k));
    const m = Math.max(sky.r, sky.g, sky.b, 1e-4);
    this.hemi.intensity = m;
    this.hemi.color.copy(sky.multiplyScalar(1 / m));
    this.hemi.groundColor.copy(ground.multiplyScalar(1 / m));
  }

  /** Lesklý materiál (kov, sklo, voda, kovové díly zbraní) – jen ten dostane odraz oblohy. */
  static reflective(m: THREE.MeshStandardMaterial) {
    return /metal|Metal|glass|water/.test(m.name) || (!m.metalnessMap && m.metalness >= 0.3) || m.roughness < 0.25;
  }

  /**
   * Připraví materiály ve scéně: odraz oblohy jen lesklým a úprava interiérů (bez slunce) všem.
   * Přiřadí odraz oblohy lesklým materiálům ve scéně (nové materiály před prvním vykreslením,
   * každý jen jednou – průchod scénou je levný). Volá se každý snímek z `update`.
   */
  assignReflections() {
    const tex = this.envTex;
    if (!tex) return;
    this.scene.traverse((o) => {
      const mm = (o as THREE.Mesh).material;
      if (!mm) return;
      for (const m of Array.isArray(mm) ? mm : [mm]) {
        if (this.reflSeen.has(m)) continue;
        this.reflSeen.add(m);
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm.isMeshStandardMaterial) continue;
        // Interiéry bez slunce (patchIndoor) – připojí se k vlastní úpravě shaderu materiálu.
        if (!sm.userData.indoorPatched) {
          sm.userData.indoorPatched = true;
          const key = sm.customProgramCacheKey();
          const prev = sm.onBeforeCompile;
          sm.onBeforeCompile = (sh, r) => {
            prev.call(sm, sh, r);
            patchIndoor(sh);
          };
          sm.customProgramCacheKey = () => `${key}|in1`;
          sm.needsUpdate = true;
        }
        if (sm.userData.envBase === undefined) sm.userData.envBase = sm.envMapIntensity;
        const want = EnvironmentRig.reflective(sm) ? tex : null;
        if (sm.envMap !== want) {
          sm.envMap = want;
          sm.needsUpdate = true;
        }
        sm.envMapIntensity = sm.userData.envBase * this.envScale;
      }
    });
  }
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
    // Násobič jasu oblohy (uniform uSkyGain) – bez něj by sytá modrá po tone mappingu vybledla do bílé.
    const skyMat = this.sky.material as THREE.ShaderMaterial;
    skyMat.uniforms.uSkyGain = { value: 1 };
    skyMat.fragmentShader = skyMat.fragmentShader.replace('uniform float cloudCoverage;', 'uniform float cloudCoverage;\nuniform float uSkyGain;').replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * uSkyGain, 1.0 );');
    skyMat.needsUpdate = true;
    this.sky.scale.setScalar(4000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -2;
    scene.add(this.sky);
    // Opar se kreslí hned po obloze a před vším ostatním (bez zápisu hloubky).
    this.haze.renderOrder = -1;
    this.haze.frustumCulled = false;
    // Kopule vždy kolem kamery (v editoru se kamera vzdaluje od „focus“ bodu).
    this.haze.onBeforeRender = (_r, _s, cam) => {
      this.haze.position.copy(cam.position);
      this.haze.updateMatrixWorld();
    };
    (this.haze.material as THREE.ShaderMaterial).transparent = false;
    scene.add(this.haze);
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.add(this.hemi);
    scene.fog = this.fog;
    this.sun.castShadow = true;
  }

  /**
   * Vzhled „BF2“ (nastavení): u výchozí předvolby prašného poledne se obloha zmodří, opar a mlha zeslábnou
   * a světlo se oteplí. Opar přes oblohu se vypne (jinak by nebe bylo plně barvy mlhy). Mapa se nemění (herní mlha i viditelnost zůstávají podle autora, jen jemněji
   * kreslené – poloviční vzdálenost mlhy se prodlouží o třetinu).
   */
  apply(env: EnvironmentProfile, q: QualityProfile, bf2 = false) {
    const useBf2 = bf2 && env.preset === 'dustyNoon';
    const look = LOOKS[useBf2 ? 'bf2Desert' : env.preset];
    if (useBf2) env = { ...env, fogColor: '#c9d0cf', fogHalfDistance: env.fogHalfDistance * 1.35, skyHaze: 0, sunColor: '#fff3da', sunIntensity: env.sunIntensity * 1.12 };
    this.sunDir = sunDirection(env.sunAzimuthDeg, env.sunElevationDeg);
    const u = this.sky.material.uniforms;
    u.turbidity.value = look.turbidity;
    u.rayleigh.value = look.rayleigh;
    u.mieCoefficient.value = look.mie;
    u.mieDirectionalG.value = look.mieG;
    u.cloudCoverage.value = look.clouds;
    u.cloudDensity.value = look.cloudDensity;
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000);
    u.uSkyGain.value = look.skyGain ?? 1;

    this.sun.color.set(env.sunColor);
    this.sun.intensity = env.sunIntensity * (env.preset === 'overcastRain' ? 0.35 : 1);
    this.setAmbient(look, env.ambientIntensity);
    this.fog.color.set(env.fogColor);
    // FogExp2: f = exp(−(d·density)²) → 50 % při d = √ln2 / density. Vypnutá mlha = hustota 0.
    const fogOn = env.fogEnabled !== false;
    this.fog.density = fogOn ? Math.sqrt(Math.LN2) / env.fogHalfDistance : 0;
    const hz = this.haze.material as THREE.ShaderMaterial;
    hz.uniforms.uColor.value.set(env.fogColor);
    hz.uniforms.uHaze.value = fogOn ? (env.skyHaze ?? 0.25) : 0;
    this.haze.visible = fogOn && (env.skyHaze ?? 0.25) > 0.001;
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
    // Odraz oblohy jen u lesklých materiálů (kov, sklo, voda); viz assignReflections.
    this.scene.environment = null;
    this.envTex = this.envRT.texture;
    this.envScale = look.envIntensity;
    this.reflSeen = new WeakSet();
    pm.dispose();
    dome.geometry.dispose();
    mat.dispose();
  }

  /** Stínová kamera sleduje pohled, přichycená na texely (bez mihotání). */
  update(focus: THREE.Vector3, dt: number) {
    this.time += dt;
    this.assignReflections();
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
