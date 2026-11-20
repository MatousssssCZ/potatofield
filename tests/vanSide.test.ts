import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { allAssets } from '../src/world';
import { quatFromEuler } from '../src/shared/math';

describe('H199 Převrácená dodávka', () => {
  it('leží bokem na zemi (žádné dveře pod karoserií, vůz nevisí)', () => {
    const def = allAssets().find((a) => a.assetId.endsWith('vanSide'))!;
    expect(def).toBeTruthy();
    const parts = def.generate(def.params ? Object.fromEntries(def.params.map((p) => [p.key, p.default])) : {}, 7, {} as never, {} as never) as Array<{ pos: number[]; rot?: number[]; size: number[]; collide?: boolean }>;
    const minY = (p: (typeof parts)[number]) => {
      const q = quatFromEuler(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
      let m = Infinity;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const v = new THREE.Vector3((sx * p.size[0]) / 2, (sy * p.size[1]) / 2, (sz * p.size[2]) / 2).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        m = Math.min(m, p.pos[1] + v.y);
      }
      return m;
    };
    // Největší kolizní díl (bok karoserie) se dotýká země.
    const big = parts.filter((p) => p.collide !== false).sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2]);
    const body = big.slice(0, 3).map(minY);
    expect(Math.min(...body)).toBeLessThan(0.06);
    expect(Math.min(...parts.map(minY))).toBeGreaterThan(-0.05);
  });
});
