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
  maxDecals: number;
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
    maxDecals: 64,
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
    maxDecals: 192,
  },
  high: {
    id: 'high',
    label: 'Vysoká',
    renderScale: 1,
    maxDpr: 2,
    shadowMapSize: 4096,
    shadowRange: 60,
    textureSize: 1024,
    anisotropy: 16,
    antialias: true,
    ao: true,
    maxDecals: 384,
  },
};
