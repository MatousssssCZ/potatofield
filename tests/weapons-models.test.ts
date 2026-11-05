import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WEAPON_DEFS, readyWeapons } from '../src/client/render/weapons/catalog';
import { HAND_LOOKS, buildHandGeometry } from '../src/client/render/weapons/hands';
import type { WeaponModel } from '../src/client/render/weapons/types';

function staticMeshes(m: WeaponModel) {
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const list = [new THREE.Mesh(m.static.metal, mat), new THREE.Mesh(m.static.polymer, mat)];
  const mag = new THREE.Mesh(m.moving.magazine.geometry, mat);
  mag.position.copy(m.moving.magazine.pivot);
  list.push(mag);
  for (const o of list) o.updateMatrixWorld(true);
  return list;
}

function firstHit(m: WeaponModel, from: THREE.Vector3, to: THREE.Vector3) {
  const dir = to.clone().sub(from).normalize();
  const rc = new THREE.Raycaster(from, dir, 0, 2);
  const hits = rc.intersectObjects(staticMeshes(m), false);
  return hits[0] ?? null;
}

describe('arzenál – pevné sestavy', () => {
  const ready = readyWeapons();

  it('katalog má 12 zbraní, každá frakce 4 classy; kolimátor jen Assault', () => {
    expect(WEAPON_DEFS).toHaveLength(12);
    for (const f of ['usmc', 'mec', 'pla']) expect(new Set(WEAPON_DEFS.filter((w) => w.faction === f).map((w) => w.kit)).size).toBe(4);
    for (const d of ready) {
      const m = d.build!(1);
      expect(!!m.optic, d.id).toBe(d.kit === 'assault');
      expect(m.sight).toBe(d.kit === 'assault' ? 'optic' : 'iron');
      expect(HAND_LOOKS[d.hands], d.hands).toBeTruthy();
    }
  });

  it('rozpočet: zbraň + obě ruce ≤ 20 000 trojúhelníků', () => {
    for (const d of ready) {
      const m = d.build!(1);
      const hg = buildHandGeometry(HAND_LOOKS[d.hands], 1);
      let hands = 0;
      for (const g of Object.values(hg).filter((x): x is THREE.BufferGeometry => x instanceof THREE.BufferGeometry)) hands += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const total = m.triangles + 2 * hands;
      expect(total, `${d.id}: ${m.triangles} + ruce ${hands}`).toBeLessThanOrEqual(20000);
      for (const g of [m.static.metal, m.static.polymer]) {
        const p = g.getAttribute('position').array as Float32Array;
        expect(p.every((v) => Number.isFinite(v))).toBe(true);
      }
    }
  });

  it('mířidla: oko, hledí a muška leží v jedné ose; ústí je před muškou', () => {
    for (const d of ready) {
      const { points: P } = d.build!(1);
      expect(P.sightRear.x).toBeCloseTo(0, 6);
      expect(P.sightFront.x).toBeCloseTo(0, 6);
      expect(P.sightFront.y, d.id).toBeCloseTo(P.sightRear.y, 5);
      expect(P.opticEye.y).toBeCloseTo(P.sightRear.y, 5);
      expect(P.opticEye.z).toBeGreaterThan(P.sightRear.z + 0.05);
      expect(P.sightFront.z).toBeLessThan(P.sightRear.z);
      expect(P.muzzle.z).toBeLessThan(P.sightFront.z);
    }
  });

  it('mechanická mířidla: paprsek z oka projde skutečným otvorem/výřezem hledí a narazí až na mušku', () => {
    for (const d of ready.filter((w) => w.kit !== 'assault')) {
      const m = d.build!(1);
      const P = m.points;
      // Míří těsně pod vrchol mušky – musí projít hledím (v otvoru není neprůhledný disk).
      const target = P.sightFront.clone().add(new THREE.Vector3(0, -0.0012, 0));
      const hit = firstHit(m, P.opticEye, target);
      expect(hit, d.id).not.toBeNull();
      expect(Math.abs(hit!.point.z - P.sightFront.z), `${d.id}: první zásah z = ${hit!.point.z.toFixed(3)}`).toBeLessThan(0.006);
    }
  });

  it('kolimátor: osa průhledu je volná (tubus, montáž ani muška nezakrývají střed)', () => {
    for (const d of ready.filter((w) => w.kit === 'assault')) {
      const m = d.build!(1);
      const P = m.points;
      for (const [dx, dy] of [[0, 0], [0.006, 0], [-0.006, 0], [0, 0.006], [0, -0.006]]) {
        const from = P.opticEye.clone().add(new THREE.Vector3(dx, dy, 0));
        const hit = firstHit(m, from, from.clone().add(new THREE.Vector3(0, 0, -1)));
        expect(hit, `${d.id} posun ${dx},${dy}`).toBeNull();
      }
    }
  });

  it('near plane (0,03 m) v ADS neodřezává mířidla ani tělo před okem', () => {
    for (const d of ready) {
      const m = d.build!(1);
      const eye = m.points.opticEye;
      let close = 0;
      for (const g of [m.static.metal, m.static.polymer]) {
        const p = g.getAttribute('position').array as Float32Array;
        for (let i = 0; i < p.length; i += 3) {
          const ahead = eye.z - p[i + 2];
          if (ahead > 0 && ahead < 0.035 && Math.abs(p[i]) < 0.03 && Math.abs(p[i + 1] - eye.y) < 0.02) close++;
        }
      }
      expect(close, d.id).toBe(0);
    }
  });

  it('siluety: M16A2 je viditelně delší než M4A1, bullpup nejkratší', () => {
    const len = (id: string) => {
      const m = WEAPON_DEFS.find((w) => w.id === id)!.build!(1);
      const b = new THREE.Box3().setFromBufferAttribute(m.static.polymer.getAttribute('position') as THREE.BufferAttribute);
      b.union(new THREE.Box3().setFromBufferAttribute(m.static.metal.getAttribute('position') as THREE.BufferAttribute));
      return b.max.z - b.min.z;
    };
    expect(len('m16a2')).toBeGreaterThan(len('m4a1') + 0.08);
    for (const id of ['m4a1', 'ak101', 'akm', 't81', 'm16a2']) expect(len('qbz95')).toBeLessThan(len(id));
  });
});
