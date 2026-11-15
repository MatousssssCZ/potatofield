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

export function qualityForGpu(gpu: string, cores: number): QualityProfile['id'] {
  const g = gpu.toLowerCase();
  if (!g || /swiftshader|llvmpipe|software|microsoft basic|mali|adreno|powervr|apple gpu/.test(g)) return 'low';
  const integrated = /intel|iris|uhd|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|apple m\d/.test(g);
  if (integrated || cores <= 4) return 'standard';
  return 'high';
}
