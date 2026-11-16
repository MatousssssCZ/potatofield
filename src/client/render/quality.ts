/**
 * Profily kvality mění jen kosmetiku a výkon: rozlišení renderu, stíny,
 * textury, počet efektů. Nemění kolize, herní mlhu ani kryty.
 */
export interface QualityProfile {
  id: 'low' | 'standard' | 'high';
  label: string;
  /** Násobek devicePixelRatio (s horním limitem maxDpr). */
  renderScale: number;
  maxDpr: number;
  shadowMapSize: number;
  shadowRange: number;
  textureSize: number;
  anisotropy: number;
  antialias: boolean;
  /** Ambientní zastínění v obrazovém prostoru (volitelný kosmetický efekt). */
  ao: boolean;
  /** Filmové vrstvy po vykreslení: barevné ladění, vinětace, zrnitost (levný jeden průchod). */
  grade: boolean;
  /** Bloom (záře slunce a odlesků) – jen na silnější grafice. */
  bloom: boolean;
  maxDecals: number;
  /** Trsy trávy: nejvýš instancí a dosah (m); 0 = vypnuto. */
  grass: number;
  grassRange: number;
}

export const QUALITY: Record<QualityProfile['id'], QualityProfile> = {
  low: {
    id: 'low',
    label: 'Nízká',
    renderScale: 0.75,
    maxDpr: 1,
    shadowMapSize: 1024,
    shadowRange: 30,
    textureSize: 256,
    anisotropy: 2,
    antialias: false,
    ao: false,
    grade: false,
    bloom: false,
    maxDecals: 64,
    grass: 0,
    grassRange: 0,
  },
  standard: {
    id: 'standard',
    label: 'Standardní',
    renderScale: 1,
    maxDpr: 1.5,
    shadowMapSize: 2048,
    shadowRange: 45,
    textureSize: 512,
    anisotropy: 8,
    antialias: true,
    ao: false,
    grade: true,
    bloom: false,
    maxDecals: 192,
    grass: 2600,
    grassRange: 26,
  },
  high: {
    id: 'high',
    label: 'Vysoká',
    renderScale: 1,
    maxDpr: 1.5,
    shadowMapSize: 4096,
    shadowRange: 60,
    textureSize: 1024,
    anisotropy: 16,
    antialias: true,
    ao: true,
    grade: true,
    bloom: true,
    maxDecals: 384,
    grass: 6000,
    grassRange: 40,
  },
};

/**
 * Doporučená kvalita pro toto zařízení podle grafiky (WEBGL_debug_renderer_info).
 * Softwarový render nebo mobilní GPU → Nízká, integrovaná grafika (Intel, AMD APU, Apple) →
 * Standardní, samostatná karta → Vysoká. Použije se jen při prvním spuštění (bez uložené volby).
 */
export function detectQuality(): { id: QualityProfile['id']; gpu: string } {
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* bez WebGL – rozhodne se níže */
  }
  return { id: qualityForGpu(gpu, navigator.hardwareConcurrency || 4), gpu };
}

export function isIntegratedGpu(gpu: string) {
  return /intel|iris|uhd|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|apple m\d/.test(gpu.toLowerCase());
}

export function qualityForGpu(gpu: string, cores: number): QualityProfile['id'] {
  const g = gpu.toLowerCase();
  if (!g || /swiftshader|llvmpipe|software|microsoft basic|mali|adreno|powervr|apple gpu/.test(g)) return 'low';
  if (isIntegratedGpu(g) || cores <= 4) return 'standard';
  return 'high';
}

/**
 * Úprava doporučené kvality pro integrovanou grafiku (notebooky): bez 4× MSAA ve vyrovnávací paměti
 * post-processingu (na sdílené paměti nejdražší); hrany pak vyhlazuje levné FXAA ve výstupním průchodu.
 * Jen když hráč kvalitu sám nezvolil.
 */
export function forDevice(q: QualityProfile, gpu: string, chosen: boolean): QualityProfile {
  if (chosen || q.id !== 'standard' || !isIntegratedGpu(gpu)) return q;
  return { ...q, antialias: false };
}

/**
 * Dynamické rozlišení: když snímky trvají déle než ~22 ms (pod ~45 FPS), sníží se rozlišení renderu
 * (až na 55 %), při rezervě se zase zvedá. Po snížení se 30 s nevrací nad úroveň, kde to nestačilo
 * (jinak by kmitalo kolem hranice). Rozhoduje medián za 1,5 s, takže ojedinělé záseky nic nezmění.
 */
export class DynamicResolution {
  scale: number;
  /** Medián posledního okna (ms). */
  median = 0;
  /** Jak dlouho (ms) je hra na minimu a pořád pomalá. */
  slowFor = 0;
  private win: number[] = [];
  private winMs = 0;
  private good = 0;
  private ceiling: number;
  private ceilingUntil = 0;
  private clock = 0;

  constructor(readonly max = 1, readonly min = 0.55) {
    this.scale = max;
    this.ceiling = max;
  }

  /** Doba snímku (ms); vrací true, když se měřítko změnilo. */
  push(ms: number): boolean {
    this.clock += ms;
    // Ojedinělý zásek medián nepohne; velmi pomalé zařízení se ale počítá (strop 100 ms na snímek).
    this.win.push(Math.min(ms, 100));
    this.winMs += ms;
    if (this.winMs < 1500) return false;
    const s = this.win.sort((a, b) => a - b);
    const med = s[s.length >> 1];
    this.median = med;
    this.win = [];
    this.winMs = 0;
    if (this.clock > this.ceilingUntil) this.ceiling = this.max;
    let n = this.scale;
    if (med > 22) {
      this.good = 0;
      n = Math.max(this.min, this.scale * (med > 33 ? 0.8 : 0.9));
      if (n < this.scale) {
        this.ceiling = this.scale - 0.05;
        this.ceilingUntil = this.clock + 30000;
      }
    } else if (med < 17.5) {
      if (++this.good >= 2) {
        this.good = 0;
        n = Math.min(this.max, this.ceiling, this.scale + 0.05);
      }
    } else this.good = 0;
    this.slowFor = n <= this.min + 1e-3 && med > 28 ? this.slowFor + 1500 : 0;
    if (Math.abs(n - this.scale) < 0.005) return false;
    this.scale = n;
    return true;
  }
}
