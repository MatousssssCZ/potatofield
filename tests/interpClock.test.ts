import { describe, expect, it } from 'vitest';
import { InterpClock } from '../src/client/runtime/interpClock';

/** Simulace: snímky po 1/30 s, příchod se zpožděním `lat(i)`; klient kreslí po 1/60 s. */
function run(lat: (i: number) => number, seconds = 20) {
  const c = new InterpClock(1 / 30);
  const arrivals = Array.from({ length: seconds * 30 }, (_, i) => ({ t: i / 30, at: 5 + i / 30 + lat(i) })).sort((a, b) => a.at - b.at);
  let j = 0, newest = -1, prev = -Infinity, worstStep = 0, starved = 0, frames = 0;
  for (let w = 5; w < 5 + seconds; w += 1 / 60) {
    while (j < arrivals.length && arrivals[j].at <= w) {
      newest = Math.max(newest, arrivals[j].t);
      c.onSnap(arrivals[j].t, arrivals[j].at);
      j++;
    }
    if (newest < 0) continue;
    const r = c.renderTime(w);
    if (w > 8) {
      frames++;
      expect(r).toBeGreaterThanOrEqual(prev);
      worstStep = Math.max(worstStep, Math.abs((r - prev) - 1 / 60));
      if (r > newest) starved++;
    }
    prev = r;
  }
  return { worstStep, starvedPct: (starved / frames) * 100, delay: c.delay };
}

describe('InterpClock', () => {
  it('klidná síť: malé zpoždění, plynulý čas', () => {
    const r = run(() => 0.04);
    expect(r.delay).toBeLessThan(0.1);
    expect(r.worstStep).toBeLessThan(0.005);
    expect(r.starvedPct).toBe(0);
  });

  it('kolísání ±40 ms: čas nikdy necouvá a skoro nikdy nepředběhne poslední snímek', () => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const r = run(() => 0.04 + rnd() * 0.08);
    expect(r.worstStep).toBeLessThan(0.005);
    expect(r.starvedPct).toBeLessThan(2);
  });

  it('přibrzděný server (snímky v dávkách po 100 ms): zpoždění se zvětší, pohyb zůstane plynulý', () => {
    // Snímky drží proces a pustí je najednou na začátku každého 100ms okna.
    const r = run((i) => {
      const t = i / 30;
      return Math.ceil(t / 0.1) * 0.1 - t + 0.04;
    });
    expect(r.delay).toBeGreaterThan(0.12);
    expect(r.worstStep).toBeLessThan(0.005);
    expect(r.starvedPct).toBeLessThan(3);
  });
});
