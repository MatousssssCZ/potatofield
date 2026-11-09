import { describe, expect, it } from 'vitest';
import { quatFromEuler, rotate } from '../src/shared/math';
import { beam, pipe } from '../src/world/assets/set/industrial';

describe('nosník / trubka mezi dvěma body', () => {
  const cases: [number, number, number][][] = [[[0, 0, 0], [3, 4, 2]], [[-1, 0.5, 2], [2, 9, -3]], [[0, 0, 0], [0, 5, 0.001]], [[1, 1, 1], [-4, 1, 1]]];
  for (const [a, b] of cases) {
    it(`${JSON.stringify(a)} → ${JSON.stringify(b)}`, () => {
      for (const [p, axis] of [[beam(a, b, 0.1, 'metal'), 'z'], [pipe(a, b, 0.1, 'metal'), 'y']] as const) {
        const q = quatFromEuler(p.rot![0], p.rot![1], p.rot![2]);
        const half = axis === 'z' ? p.size[2] / 2 : p.size[1] / 2;
        const e = rotate(q, axis === 'z' ? { x: 0, y: 0, z: half } : { x: 0, y: half, z: 0 });
        expect(p.pos[0] + e.x).toBeCloseTo(b[0], 4);
        expect(p.pos[1] + e.y).toBeCloseTo(b[1], 4);
        expect(p.pos[2] + e.z).toBeCloseTo(b[2], 4);
      }
    });
  }
});
