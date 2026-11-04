import type { ConfigMeta } from './movement';

/**
 * Konfigurace pohledu. FOV se zadává jako horizontální úhel při poměru 16:9;
 * z něj se odvodí vertikální FOV, který se při jiném poměru stran zachová.
 */
export interface CameraConfig {
  meta: ConfigMeta;
  hFovDeg16x9: number;
  hFovMinDeg: number;
  hFovMaxDeg: number;
  pitchLimitDeg: number;
  /** Radiány na jeden pixel pohybu myši při citlivosti 1. */
  radiansPerCount: number;
  adsZoom: number;
  adsSensitivity: number;
  adsInTime: number;
  adsOutTime: number;
  bob: {
    walkAmp: number;
    sprintAmp: number;
    walkFreq: number;
    sprintFreq: number;
    adsScale: number;
  };
  landingKick: { maxOffset: number; duration: number };
  near: number;
  far: number;
}

export const CAMERA: CameraConfig = {
  meta: { id: 'camera.default', version: 1, status: 'proposed' },
  hFovDeg16x9: 90,
  hFovMinDeg: 80,
  hFovMaxDeg: 110,
  pitchLimitDeg: 89,
  radiansPerCount: 0.0022 * (Math.PI / 180) * 10,
  adsZoom: 1.35,
  adsSensitivity: 0.75,
  adsInTime: 0.2,
  adsOutTime: 0.15,
  bob: { walkAmp: 0.012, sprintAmp: 0.02, walkFreq: 1.8, sprintFreq: 2.4, adsScale: 0.25 },
  landingKick: { maxOffset: 0.025, duration: 0.12 },
  near: 0.03,
  far: 1500,
};

/** Vertikální FOV (rad) z horizontálního FOV definovaného pro 16:9. */
export function vFovFromH16x9(hFovDeg: number): number {
  const h = (hFovDeg * Math.PI) / 180;
  return 2 * Math.atan(Math.tan(h / 2) * (9 / 16));
}

/** Vertikální FOV pro ADS: optické přiblížení, ne odečtení úhlu. */
export function adsVFov(vFovHip: number, zoom: number): number {
  return 2 * Math.atan(Math.tan(vFovHip / 2) / zoom);
}
