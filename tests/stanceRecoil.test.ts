import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/shared/config/movement';
import { stanceRecoil } from '../src/shared/sim/weapon';

describe('zpětný ráz podle postoje', () => {
  it('vstoje plný, v kleku menší, vleže nejmenší (plynule podle výšky těla)', () => {
    const st = MOVEMENT.stances;
    const stand = stanceRecoil(MOVEMENT, st.stand.height), crouch = stanceRecoil(MOVEMENT, st.crouch.height), prone = stanceRecoil(MOVEMENT, st.prone.height);
    expect(stand.pitch).toBeCloseTo(1);
    expect(crouch.pitch).toBeLessThan(0.8);
    expect(prone.pitch).toBeLessThan(crouch.pitch);
    expect(prone.yaw).toBeLessThan(crouch.yaw);
    expect(prone.penalty).toBeLessThan(crouch.penalty);
    const mid = stanceRecoil(MOVEMENT, (st.stand.height + st.crouch.height) / 2);
    expect(mid.pitch).toBeGreaterThan(crouch.pitch);
    expect(mid.pitch).toBeLessThan(stand.pitch);
  });
});
