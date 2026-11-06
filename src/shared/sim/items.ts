import type { MovementConfig } from '../config/movement';
import type { InputFrame } from './input';
import type { PlayerState } from './player';
import type { WeaponState } from './weapon';

/**
 * Krok aktivní nestřelné položky (nůž, granáty, nástroje). Společné: tasení, sprint-out,
 * žádné míření a žádná střelba ze zbraňové simulace. Vlastní akce položek doplňuje simulace
 * zápasu přes `ItemHooks` (server rozhoduje o zásahu, hodu, léčení, oživení i zásobování).
 */
export interface ItemHooks {
  /** Akce položky (útok nožem, hod, použití nástroje); `held` = držená spoušť. */
  act(kind: string, ws: WeaponState, input: InputFrame, t: number): void;
}

export function stepItem(kind: string, mv: MovementConfig, ps: PlayerState, ws: WeaponState, input: InputFrame, hooks: ItemHooks | null) {
  const t = ps.tick / mv.tickRate;
  ws.blockReason = '';
  if (ws.action === 'equip' && t >= ws.actionEnd) ws.action = 'idle';
  if (ws.action === 'sprintOut' && t >= ws.actionEnd) ws.action = 'idle';
  // Bez míření: položky drží ruka u těla; sprint ukončí jen držená spoušť.
  ws.adsToggle = false;
  ws.adsProgress = Math.max(0, ws.adsProgress - 1 / (mv.tickRate * 0.12));
  ps.adsProgress = ws.adsProgress;
  ws.obstruction = 0;
  ps.weaponBlocksSprint = (input.held & (1 << 4)) !== 0 && (ws.action === 'use' || ws.action === 'throw');
  if (ps.sprinting) ws.wasSprinting = true;
  else if (ws.wasSprinting) {
    ws.wasSprinting = false;
    if (ws.action === 'idle') {
      ws.action = 'sprintOut';
      ws.actionStart = t;
      ws.actionEnd = t + 0.15;
    }
  }
  // Na žebříku žádné akce (nůž, hod, lékárna, defibrilátor) – ruce drží žebřík.
  if (ps.ladder) {
    ws.blockReason = 'na žebříku';
    return;
  }
  hooks?.act(kind, ws, input, t);
}
