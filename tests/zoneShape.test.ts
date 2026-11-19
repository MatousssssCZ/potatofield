import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { insideZone, isSimplePolygon, pointInPolygon, polygonArea, zoneOutline } from '../src/shared/map/zoneShape';
import type { Zone } from '../src/shared/map/schema';
import { validateMap } from '../src/shared/map/validate';
import { buildStreetMap } from '../src/world/maps/street';

const base: Zone = { id: 'z', kind: 'forbidden', center: [0, 5, 0], halfExtents: [10, 5, 10], yaw: 0, appliesTo: ['teamA'], countdown: 10 };
const L: [number, number][] = [[-10, -10], [10, -10], [10, 0], [0, 0], [0, 10], [-10, 10]];

describe('Zóna jako mnohoúhelník', () => {
  it('bez bodů je půdorys obdélník ±halfExtents', () => {
    expect(zoneOutline(base)).toEqual([[-10, -10], [10, -10], [10, 10], [-10, 10]]);
    expect(insideZone(base, { x: 9, y: 0, z: 9 })).toBe(true);
    expect(insideZone(base, { x: 11, y: 0, z: 0 })).toBe(false);
  });

  it('tvar L: výřez v rohu neplatí, zbytek ano; výška se kontroluje', () => {
    const z = { ...base, points: L };
    expect(insideZone(z, { x: -5, y: 0, z: 5 })).toBe(true);
    expect(insideZone(z, { x: 5, y: 0, z: -5 })).toBe(true);
    expect(insideZone(z, { x: 5, y: 0, z: 5 })).toBe(false);
    expect(insideZone(z, { x: -5, y: 20, z: 5 })).toBe(false);
    expect(pointInPolygon(-5, 5, L)).toBe(true);
    expect(Math.abs(polygonArea(L))).toBeCloseTo(300);
  });

  it('natočení odpovídá tomu, jak zónu kreslí editor (three.js rotation.y)', () => {
    const z = { ...base, yaw: 0.7, center: [3, 5, -4] as [number, number, number], points: L };
    const g = new THREE.Object3D();
    g.position.set(...z.center);
    g.rotation.y = z.yaw;
    g.updateMatrixWorld(true);
    for (const [lx, lz, expected] of [[-5, 5, true], [5, -5, true], [5, 5, false], [-9, -9, true], [12, 0, false]] as const) {
      const w = new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
      expect(insideZone(z, { x: w.x, y: 0, z: w.z })).toBe(expected);
    }
  });

  it('kontrola mapy: málo bodů, nulová plocha a křížící se hrany jsou chyba', () => {
    const errs = (points: [number, number][]) => {
      const d = buildStreetMap();
      d.zones[0] = { ...d.zones[0], points };
      return validateMap(d).issues.filter((e) => e.severity === 'error').map((e) => e.message).join(' | ');
    };
    expect(errs(L)).toBe('');
    expect(errs([[0, 0], [1, 1]])).toMatch(/aspoň 3/);
    expect(errs([[0, 0], [5, 0], [10, 0]])).toMatch(/nulovou plochu/);
    expect(errs([[0, 0], [10, 10], [10, 0], [0, 10]])).toMatch(/kříží/);
    expect(isSimplePolygon(L)).toBe(true);
  });
});

describe('withPolygon', () => {
  it('přecentruje zónu, body ve světě zůstanou na místě', async () => {
    const { withPolygon, zoneWorld } = await import('../src/shared/map/zoneShape');
    const z = { ...base, yaw: 0.9, center: [5, 5, 5] as [number, number, number] };
    const pts: [number, number][] = [[2, 2], [12, 2], [12, 8], [2, 8]];
    const n = withPolygon(z, pts);
    pts.forEach((p, i) => {
      const a = zoneWorld(z, p), b = zoneWorld(n, n.points![i]);
      expect(a[0]).toBeCloseTo(b[0], 1);
      expect(a[1]).toBeCloseTo(b[1], 1);
    });
    expect(n.halfExtents[0]).toBe(5);
    expect(n.halfExtents[2]).toBe(3);
  });
});
