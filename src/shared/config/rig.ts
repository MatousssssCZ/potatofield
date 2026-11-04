import type { ConfigMeta } from './movement';

/**
 * Sdílený profil 3D pušky PF-Rifle (klient i server). Herní ústí hlavně se odvozuje
 * odsud, ne z animace. Souřadnice v prostoru pohledu: +X vpravo, +Y nahoru, −Z vpřed (m).
 */
export interface RigProfile {
  meta: ConfigMeta;
  /** Poloha kořene pušky v hip a ADS (pohledový prostor). */
  hipRoot: [number, number, number];
  hipRot: [number, number, number];
  /** Attachment body v prostoru pušky (hlaveň míří k −Z). */
  muzzle: [number, number, number];
  rearSight: [number, number, number];
  frontSight: [number, number, number];
  rightGrip: [number, number, number];
  leftGrip: [number, number, number];
  magazineSocket: [number, number, number];
  ejectionPort: [number, number, number];
  /** Vzdálenost oka od hledí v ADS. */
  eyeRelief: number;
  /** Délka, na které se testuje blízká překážka (od očí). */
  obstacleReach: number;
  /** Pod touto vzdáleností překážky nelze střílet. */
  blockDistance: number;
}

export const PF_RIG: RigProfile = {
  meta: { id: 'rig.pf-rifle', version: 1, status: 'proposed' },
  // Geometrie odpovídá modelu M4A1 (kolimátor: zadní/přední čočka na optické ose y = 0,118).
  hipRoot: [0.15, -0.2, -0.36],
  hipRot: [0.02, 0.05, 0.0],
  muzzle: [0, 0.026, -0.576],
  rearSight: [0, 0.118, -0.005],
  frontSight: [0, 0.118, -0.11],
  rightGrip: [0, -0.075, 0.075],
  leftGrip: [0, 0.0, -0.27],
  magazineSocket: [0, -0.035, -0.04],
  ejectionPort: [0.014, 0.026, -0.038],
  eyeRelief: 0.095,
  obstacleReach: 1.15,
  blockDistance: 0.55,
};

/** Poloha kořene pušky v ADS: hledí a muška na optické ose (x = 0, y = 0) před okem. */
export function adsRoot(r: RigProfile): [number, number, number] {
  return [-r.rearSight[0], -r.rearSight[1], -(r.eyeRelief + r.rearSight[2])];
}

/** Herní poloha ústí v prostoru pohledu pro daný průběh ADS (bez kosmetiky). */
export function muzzleView(r: RigProfile, ads: number): [number, number, number] {
  const a = adsRoot(r);
  const root = [r.hipRoot[0] + (a[0] - r.hipRoot[0]) * ads, r.hipRoot[1] + (a[1] - r.hipRoot[1]) * ads, r.hipRoot[2] + (a[2] - r.hipRoot[2]) * ads];
  return [root[0] + r.muzzle[0], root[1] + r.muzzle[1], root[2] + r.muzzle[2]];
}
