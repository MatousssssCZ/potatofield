/**
 * Sdílená konfigurace pohybu pěšáka. Jediný zdroj rozměrů hráče pro hru,
 * editor (kontrola spawnů) i server.
 *
 * Všechny hodnoty jsou návrhy Potatofieldu (`proposed`), nikoli změřené
 * konstanty BF2. Jednotky: metry, sekundy, radiány (úhly v *Deg polích jsou
 * stupně a převádějí se v `deg()` při použití).
 */

export type ValueStatus = 'proposed' | 'measured' | 'verifiedSource';

export interface ConfigMeta {
  id: string;
  version: number;
  status: ValueStatus;
  /** Pro `measured`: metoda a verze reference. */
  note?: string;
}

export type Stance = 'stand' | 'crouch' | 'prone';

export interface StanceDims {
  /** Celková výška těla. */
  height: number;
  /** Výška očí od podlahy. */
  eyeHeight: number;
  /** Doba přechodu do tohoto postoje (s). */
  transition: number;
  /** Limit běžného pohybu v tomto postoji (m/s). */
  speed: number;
}

export interface MovementConfig {
  meta: ConfigMeta;
  /** Simulační frekvence (Hz). */
  tickRate: number;
  radius: number;
  /** Poloměr ležícího těla (nízký vodorovný objem). */
  proneRadius: number;
  /** Délka ležícího těla. */
  proneLength: number;
  /** Posun očí vpřed od středu ležícího těla. */
  proneEyeForward: number;
  stances: Record<Stance, StanceDims>;
  speedForward: number;
  speedBack: number;
  speedSprint: number;
  adsSpeedMultiplier: number;
  groundAccel: number;
  groundDecel: number;
  airControl: number;
  gravity: number;
  jumpHeight: number;
  jumpMinInterval: number;
  stepHeight: number;
  maxWalkSlopeDeg: number;
  /** Leh až po této době od dopadu (proti jump-prone). */
  proneAfterLanding: number;
  /** Rychlost otáčení ležícího těla za pohledem (rad/s). */
  proneTurnRate: number;
  stamina: {
    max: number;
    sprintDrainPerSec: number;
    jumpCost: number;
    regenDelayAfterSprint: number;
    regenDelayAfterJump: number;
    regenPerSec: number;
    sprintRestartThreshold: number;
  };
  /** Volitelný dvojstisk W pro sprint (výchozí vypnuto). */
  doubleTapSprint: boolean;
  /** Mezera, kterou si drží kinematický controller od geometrie. */
  skinWidth: number;
  /** Max. počet simulačních kroků dohnaných v jednom snímku. */
  maxCatchUpSteps: number;
}

export const MOVEMENT: MovementConfig = {
  meta: { id: 'movement.default', version: 1, status: 'proposed' },
  tickRate: 60,
  radius: 0.3,
  proneRadius: 0.25,
  proneLength: 1.8,
  proneEyeForward: 0.55,
  stances: {
    stand: { height: 1.8, eyeHeight: 1.65, transition: 0.18, speed: 4.0 },
    crouch: { height: 1.2, eyeHeight: 1.05, transition: 0.18, speed: 2.0 },
    prone: { height: 0.5, eyeHeight: 0.35, transition: 0.35, speed: 0.8 },
  },
  speedForward: 4.0,
  speedBack: 3.2,
  speedSprint: 6.0,
  adsSpeedMultiplier: 0.75,
  groundAccel: 30,
  groundDecel: 36,
  airControl: 0.15,
  gravity: 18,
  jumpHeight: 0.65,
  jumpMinInterval: 0.45,
  stepHeight: 0.3,
  maxWalkSlopeDeg: 45,
  proneAfterLanding: 0.3,
  proneTurnRate: Math.PI * 1.25,
  stamina: {
    max: 100,
    sprintDrainPerSec: 12.5,
    jumpCost: 20,
    regenDelayAfterSprint: 1,
    regenDelayAfterJump: 2,
    regenPerSec: 20,
    sprintRestartThreshold: 15,
  },
  doubleTapSprint: false,
  skinWidth: 0.02,
  maxCatchUpSteps: 6,
};

export const deg = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

export function jumpVelocity(cfg: MovementConfig): number {
  return Math.sqrt(2 * cfg.gravity * cfg.jumpHeight);
}
