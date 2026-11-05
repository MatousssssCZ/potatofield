import { describe, expect, it } from 'vitest';
import { qualityForGpu } from '../src/client/render/quality';
import { downsample } from '../src/client/render/materials';

describe('výchozí kvalita podle grafiky', () => {
  it('integrovaná grafika (i5-1335U = Iris Xe) dostane Standardní, ne Vysokou', () => {
    expect(qualityForGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A1) Direct3D11 vs_5_0 ps_5_0, D3D11)', 12)).toBe('standard');
    expect(qualityForGpu('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 16)).toBe('standard');
    expect(qualityForGpu('Apple M1', 8)).toBe('standard');
  });
  it('samostatná karta Vysoká, softwarový render a mobilní GPU Nízká', () => {
    expect(qualityForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 12)).toBe('high');
    expect(qualityForGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 8)).toBe('low');
    expect(qualityForGpu('Mali-G78', 8)).toBe('low');
    expect(qualityForGpu('', 8)).toBe('low');
  });
  it('slabý procesor (≤ 4 vlákna) nejvýš Standardní', () => {
    expect(qualityForGpu('NVIDIA GeForce GTX 1050', 4)).toBe('standard');
  });
});

describe('poloviční rozlišení normál a ORM', () => {
  it('zmenšení 2× zachová průměr a normály zůstanou jednotkové', () => {
    const size = 4;
    const src = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) src.set([200, 128, 255, 255], i * 4);
    const out = downsample(src, size, true);
    expect(out.length).toBe(2 * 2 * 4);
    const n = [out[0] / 127.5 - 1, out[1] / 127.5 - 1, out[2] / 127.5 - 1];
    expect(Math.hypot(...n)).toBeCloseTo(1, 1);
    const orm = downsample(src, size, false);
    expect(orm[0]).toBe(200);
  });
});
