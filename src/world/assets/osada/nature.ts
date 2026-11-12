import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import { registerAsset } from '../../registry';
import { num, osadaMeta } from './common';

/**
 * T05 balvan: nepravidelná oblá-hranatá hmota s plochami (nízká jemnost sítě = fasety),
 * zapuštěná do terénu. Kolize = konvexní obal hlavní hmoty (zjednodušená, pevná).
 * Vše deterministicky ze seedu.
 */
registerAsset({
  assetId: 'osada.boulder',
  label: osadaMeta('osada.boulder', 'T05', 'Balvan', 'D'),
  category: 'osada',
  generatorVersion: 1,
  sizeParams: { x: 'size', y: 'size', z: 'size' },
  params: [
    { key: 'size', label: 'Velikost', type: 'number', min: 1, max: 3, step: 0.05, unit: 'm', default: 1.6 },
    { key: 'flat', label: 'Plochost (výška / šířka)', type: 'number', min: 0.4, max: 0.95, step: 0.05, default: 0.65 },
    { key: 'sink', label: 'Zapuštění do terénu', type: 'number', min: 0, max: 0.5, step: 0.05, unit: 'm', default: 0.15 },
    { key: 'rough', label: 'Hranatost', type: 'number', min: 0.1, max: 0.8, step: 0.05, default: 0.45 },
  ],
  materials: ['rockWarm', 'rock'],
  defaultMaterial: 'rockWarm',
  describe: (p) => `Ø ${num(p, 'size').toFixed(2)} m, výška ${(num(p, 'size') * num(p, 'flat') - num(p, 'sink')).toFixed(2)} m nad terénem`,
  generate(p, seed, material) {
    const S = num(p, 'size'), F = num(p, 'flat'), sink = num(p, 'sink'), rough = num(p, 'rough');
    const r = rng(seed);
    const w = S * (0.85 + r() * 0.3), d = S * (0.75 + r() * 0.3), h = S * F;
    const parts: Part[] = [
      { shape: 'blob', pos: [0, h / 2 - sink, 0], rot: [0, r() * Math.PI * 2, 0], size: [w, h, d], material, seed: (seed % 997) + 1, rough, detail: 1, collide: true },
    ];
    // Druhá, menší hmota (rozbije symetrii siluety) – jen vzhled, leží uvnitř obálky kolize.
    const a = r() * Math.PI * 2;
    parts.push({ shape: 'blob', pos: [Math.cos(a) * w * 0.18, h * 0.42 - sink, Math.sin(a) * d * 0.18], rot: [0, r() * 6, 0], size: [w * 0.6, h * 0.62, d * 0.6], material, seed: (seed % 991) + 7, rough: rough * 1.2, detail: 1 });
    return parts;
  },
});
