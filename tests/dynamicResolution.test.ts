import { describe, expect, it } from 'vitest';
import { DynamicResolution, forDevice, QUALITY } from '../src/client/render/quality';

const run = (d: DynamicResolution, ms: number, seconds: number) => {
  let changed = 0;
  for (let t = 0; t < seconds * 1000; t += ms) if (d.push(ms)) changed++;
  return changed;
};

describe('dynamické rozlišení', () => {
  it('při pomalých snímcích sníží rozlišení až na minimum', () => {
    const d = new DynamicResolution(1, 0.55);
    run(d, 40, 20);
    expect(d.scale).toBeCloseTo(0.55, 5);
    expect(d.slowFor).toBeGreaterThan(0);
  });

  it('při rychlých snímcích zůstane plné rozlišení a po zlepšení se vrátí', () => {
    const d = new DynamicResolution(1, 0.55);
    expect(run(d, 16.7, 10)).toBe(0);
    expect(d.scale).toBe(1);
    run(d, 26, 3);
    expect(d.scale).toBeLessThan(1);
    const low = d.scale;
    run(d, 12, 10);
    expect(d.scale).toBeLessThanOrEqual(1 - 0.05 + 1e-9); // 30 s strop pod úrovní, kde to nestačilo
    expect(d.scale).toBeGreaterThan(low);
    run(d, 12, 40);
    expect(d.scale).toBe(1);
  });

  it('ojedinělé záseky rozlišení nemění', () => {
    const d = new DynamicResolution(1, 0.55);
    for (let i = 0; i < 600; i++) d.push(i % 60 === 0 ? 400 : 16);
    expect(d.scale).toBe(1);
  });

  it('integrovaná grafika: standard bez MSAA (rozlišení beze změny), jen bez vlastní volby', () => {
    const q = forDevice(QUALITY.standard, 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', false);
    expect(q.maxDpr).toBe(QUALITY.standard.maxDpr);
    expect(q.antialias).toBe(false);
    expect(forDevice(QUALITY.standard, 'ANGLE (Intel, Intel(R) UHD Graphics 620)', true)).toBe(QUALITY.standard);
    expect(forDevice(QUALITY.standard, 'NVIDIA GeForce RTX 3060', false)).toBe(QUALITY.standard);
  });
});
