import type { ConfigMeta } from './movement';

/**
 * Referenční fiktivní puška PF-Rifle. Návrhové hodnoty pro ověření systému,
 * nikoli replika reálné zbraně. Úhly ve stupních (převod v simulaci).
 */
export interface WeaponConfig {
  meta: ConfigMeta;
  name: string;
  modes: Array<'semi' | 'auto'>;
  fireInterval: number;
  magazine: number;
  reserve: number;
  reloadPartial: number;
  reloadEmpty: number;
  equipTime: number;
  sprintOutTime: number;
  /** Poškození jednoho projektilu (u brokovnic jednoho broku). */
  damage: { near: number; nearRange: number; far: number; farRange: number };
  /** Brokovnice: počet broků na výstřel a jejich kužel kolem směru výstřelu (stupně). */
  pellets?: number;
  pelletSpreadDeg?: number;
  /** Přebíjení: výměna zásobníku (výchozí), nebo po jednom náboji (trubicový zásobník). */
  reloadKind?: 'magazine' | 'single';
  /** Po jednom: příprava, vložení jednoho náboje, dopumpování po prázdné zbrani (s). */
  shellStart?: number;
  shellInsert?: number;
  chamberTime?: number;
  headMultiplier: number;
  limbMultiplier: number;
  projectileSpeed: number;
  projectileGravity: number;
  projectileLifetime: number;
  recoil: { pitchDeg: number; yawDeg: number; recoveryDelay: number; recoveryDegPerSec: number };
  spread: {
    standDeg: number;
    crouchDeg: number;
    proneDeg: number;
    adsMultiplier: number;
    movementDeg: number;
    perShotDeg: number;
    firingMaxDeg: number;
    firingRecoveryDelay: number;
    firingRecoveryDegPerSec: number;
    airborneDeg: number;
    proneStartDeg: number;
    proneStartDecay: number;
    landingDeg: number;
    landingDecay: number;
  };
}

export const PF_RIFLE: WeaponConfig = {
  meta: { id: 'weapon.pf-rifle', version: 1, status: 'proposed' },
  name: 'PF-Rifle',
  modes: ['semi', 'auto'],
  fireInterval: 0.1,
  magazine: 30,
  reserve: 120,
  reloadPartial: 2.4,
  reloadEmpty: 3.0,
  equipTime: 0.5,
  sprintOutTime: 0.25,
  damage: { near: 30, nearRange: 25, far: 20, farRange: 100 },
  headMultiplier: 2.0,
  limbMultiplier: 0.75,
  projectileSpeed: 650,
  projectileGravity: 9.81,
  projectileLifetime: 2,
  recoil: { pitchDeg: 0.65, yawDeg: 0.2, recoveryDelay: 0.15, recoveryDegPerSec: 5 },
  spread: {
    standDeg: 0.45,
    crouchDeg: 0.3,
    proneDeg: 0.2,
    adsMultiplier: 0.5,
    movementDeg: 0.8,
    perShotDeg: 0.12,
    firingMaxDeg: 1.5,
    firingRecoveryDelay: 0.12,
    firingRecoveryDegPerSec: 1.0,
    airborneDeg: 2.5,
    proneStartDeg: 1.0,
    proneStartDecay: 0.6,
    landingDeg: 1.0,
    landingDecay: 0.25,
  },
};

/** Fiktivní kulomet PF-MG (Support). Návrhové hodnoty (N), ne parametry reálných zbraní. */
export const PF_MG: WeaponConfig = {
  meta: { id: 'weapon.pf-mg', version: 1, status: 'proposed' },
  name: 'PF-MG',
  modes: ['auto'],
  fireInterval: 0.08,
  magazine: 100,
  reserve: 200,
  reloadPartial: 5.5,
  reloadEmpty: 6.0,
  equipTime: 0.9,
  sprintOutTime: 0.4,
  damage: { near: 28, nearRange: 30, far: 20, farRange: 120 },
  headMultiplier: 2.0,
  limbMultiplier: 0.75,
  projectileSpeed: 700,
  projectileGravity: 9.81,
  projectileLifetime: 2,
  recoil: { pitchDeg: 0.45, yawDeg: 0.3, recoveryDelay: 0.12, recoveryDegPerSec: 6 },
  spread: {
    standDeg: 1.1,
    crouchDeg: 0.7,
    proneDeg: 0.25,
    adsMultiplier: 0.6,
    movementDeg: 1.6,
    perShotDeg: 0.07,
    firingMaxDeg: 2.4,
    firingRecoveryDelay: 0.14,
    firingRecoveryDegPerSec: 1.2,
    airborneDeg: 3,
    proneStartDeg: 1.2,
    proneStartDecay: 0.8,
    landingDeg: 1.2,
    landingDecay: 0.3,
  },
};

const SHOTGUN_SPREAD: WeaponConfig['spread'] = {
  standDeg: 0.6,
  crouchDeg: 0.45,
  proneDeg: 0.35,
  adsMultiplier: 0.7,
  movementDeg: 0.9,
  perShotDeg: 0.5,
  firingMaxDeg: 1.2,
  firingRecoveryDelay: 0.3,
  firingRecoveryDegPerSec: 2,
  airborneDeg: 2.5,
  proneStartDeg: 1,
  proneStartDecay: 0.6,
  landingDeg: 1,
  landingDecay: 0.25,
};

/** Fiktivní pumpovací brokovnice PF-Pump (Engineer USMC/PLA). Návrhové hodnoty (N). */
export const PF_PUMP: WeaponConfig = {
  meta: { id: 'weapon.pf-pump', version: 1, status: 'proposed' },
  name: 'PF-Pump',
  modes: ['semi'],
  fireInterval: 0.9,
  magazine: 7,
  reserve: 28,
  reloadPartial: 0,
  reloadEmpty: 0,
  reloadKind: 'single',
  shellStart: 0.45,
  shellInsert: 0.5,
  chamberTime: 0.6,
  equipTime: 0.6,
  sprintOutTime: 0.3,
  damage: { near: 13, nearRange: 8, far: 3, farRange: 40 },
  headMultiplier: 1.5,
  limbMultiplier: 0.75,
  pellets: 9,
  pelletSpreadDeg: 2.4,
  projectileSpeed: 420,
  projectileGravity: 9.81,
  projectileLifetime: 0.4,
  recoil: { pitchDeg: 3.2, yawDeg: 0.8, recoveryDelay: 0.3, recoveryDegPerSec: 9 },
  spread: SHOTGUN_SPREAD,
};

/** Fiktivní samonabíjecí brokovnice PF-Auto12 (Engineer MEC). Návrhové hodnoty (N). */
export const PF_SEMISHOT: WeaponConfig = {
  meta: { id: 'weapon.pf-semishot', version: 1, status: 'proposed' },
  name: 'PF-Auto12',
  modes: ['semi'],
  fireInterval: 0.22,
  magazine: 8,
  reserve: 24,
  reloadPartial: 2.8,
  reloadEmpty: 3.4,
  equipTime: 0.6,
  sprintOutTime: 0.3,
  damage: { near: 12, nearRange: 8, far: 3, farRange: 35 },
  headMultiplier: 1.5,
  limbMultiplier: 0.75,
  pellets: 8,
  pelletSpreadDeg: 2.8,
  projectileSpeed: 400,
  projectileGravity: 9.81,
  projectileLifetime: 0.4,
  recoil: { pitchDeg: 2.4, yawDeg: 0.7, recoveryDelay: 0.2, recoveryDegPerSec: 9 },
  spread: SHOTGUN_SPREAD,
};

/** Délka přebití (u nabíjení po jednom podle počtu nábojů). */
export function reloadDuration(w: WeaponConfig, mag: number, reserve: number): { time: number; shells: number } {
  const empty = mag === 0;
  if (w.reloadKind === 'single') {
    const shells = Math.min(w.magazine - mag, reserve);
    return { time: (w.shellStart ?? 0) + shells * (w.shellInsert ?? 0.5) + (empty ? (w.chamberTime ?? 0) : 0), shells };
  }
  return { time: empty ? w.reloadEmpty : w.reloadPartial, shells: 0 };
}

/**
 * Fiktivní odstřelovací puška PF-Marksman (Sniper). Návrhové hodnoty (N). Zbraň zatím nemá
 * hotový model ani zvětšující optiku – v pilotu je classa vidět, ale nasazení s ní server odmítne.
 */
export const PF_SNIPER: WeaponConfig = {
  meta: { id: 'weapon.pf-sniper', version: 1, status: 'proposed' },
  name: 'PF-Marksman',
  modes: ['semi'],
  fireInterval: 1.3,
  magazine: 5,
  reserve: 25,
  reloadPartial: 3.2,
  reloadEmpty: 3.8,
  equipTime: 0.8,
  sprintOutTime: 0.35,
  damage: { near: 85, nearRange: 80, far: 70, farRange: 400 },
  headMultiplier: 2.0,
  limbMultiplier: 0.75,
  projectileSpeed: 800,
  projectileGravity: 9.81,
  projectileLifetime: 2.5,
  recoil: { pitchDeg: 2.6, yawDeg: 0.4, recoveryDelay: 0.35, recoveryDegPerSec: 6 },
  spread: { ...PF_MG.spread, standDeg: 2.0, crouchDeg: 1.4, proneDeg: 0.8, adsMultiplier: 0.04, movementDeg: 2.5, perShotDeg: 0.4, firingMaxDeg: 1.0 },
};
