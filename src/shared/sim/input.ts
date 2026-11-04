/** Vstup jednoho simulačního ticku. Stejná struktura půjde po síti. */

export const BTN = {
  SPRINT: 1 << 0,
  JUMP: 1 << 1,
  CROUCH: 1 << 2,
  PRONE: 1 << 3,
  FIRE: 1 << 4,
  ADS: 1 << 5,
  RELOAD: 1 << 6,
  SLOT3: 1 << 7,
  MODE: 1 << 8,
  USE: 1 << 9,
} as const;

export type ButtonName = keyof typeof BTN;

export interface InputFrame {
  seq: number;
  tick: number;
  /** −1..1, kladné = doprava. */
  moveX: number;
  /** −1..1, kladné = vpřed. */
  moveZ: number;
  /** Úhlový přírůstek (rad) za tento tick. */
  lookDYaw: number;
  lookDPitch: number;
  /** Držená tlačítka. */
  held: number;
  /** Nové stisky od minulého ticku (edge). */
  pressed: number;
}

export const emptyInput = (tick = 0, seq = 0): InputFrame => ({
  seq,
  tick,
  moveX: 0,
  moveZ: 0,
  lookDYaw: 0,
  lookDPitch: 0,
  held: 0,
  pressed: 0,
});

/** Ořízne vstup do platných mezí (server i klient používají stejnou funkci). */
export function sanitizeInput(i: InputFrame, maxLookPerTick = Math.PI): InputFrame {
  const c = (v: number, m: number) => (Number.isFinite(v) ? Math.max(-m, Math.min(m, v)) : 0);
  return {
    seq: i.seq | 0,
    tick: i.tick | 0,
    moveX: Math.round(c(i.moveX, 1)),
    moveZ: Math.round(c(i.moveZ, 1)),
    lookDYaw: c(i.lookDYaw, maxLookPerTick),
    lookDPitch: c(i.lookDPitch, maxLookPerTick),
    held: i.held & 0x3ff,
    pressed: i.pressed & 0x3ff,
  };
}
