import { describe, expect, it } from 'vitest';
import { separateCoplanar, ZSEP_STEP } from '../src/client/render/zsep';
import type { Part } from '../src/world/parts';

describe('z-fighting: plochy ve stejné rovině se oddělí', () => {
  it('obklad na zdi vystoupí o krok ven, zeď zůstane', () => {
    const wall: Part = { shape: 'box', pos: [0, 1, 0], size: [4, 2, 0.2], material: 'concrete' };
    const plate: Part = { shape: 'box', pos: [0, 1, 0.05], size: [1, 1, 0.1], material: 'wood' }; // přední plocha z = 0,1 = zeď
    const [w, p] = separateCoplanar([wall, plate]);
    expect(w).toEqual(wall);
    expect(p.pos[2] + p.size[2] / 2).toBeCloseTo(0.1 + ZSEP_STEP, 6);
    expect(p.pos[2] - p.size[2] / 2).toBeCloseTo(0.0, 6); // zadní plocha na místě
  });

  it('deska sevřená z obou stran se prodlouží na obě strany (posuny se nevyruší)', () => {
    const a: Part = { shape: 'box', pos: [0, 0, 0], size: [2, 2, 0.1], material: 'metal' };
    const mid: Part = { shape: 'box', pos: [0, 0, 0], size: [1, 1, 0.1], material: 'chainLink' };
    const [, m] = separateCoplanar([a, mid]);
    expect(m.size[2]).toBeCloseTo(0.1 + 2 * ZSEP_STEP, 6);
    expect(m.pos[2]).toBeCloseTo(0, 6);
  });

  it('díly bez překryvu nebo v jiné rovině se nemění', () => {
    const a: Part = { shape: 'box', pos: [0, 0, 0], size: [1, 1, 1], material: 'x' };
    const b: Part = { shape: 'box', pos: [3, 0, 0], size: [1, 1, 1], material: 'x' };
    expect(separateCoplanar([a, b])).toEqual([a, b]);
  });
});
