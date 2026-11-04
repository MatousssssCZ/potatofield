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
  damage: { near: number; nearRange: number; far: number; farRange: number };
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
