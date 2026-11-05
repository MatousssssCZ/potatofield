import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WEAPON_DEFS, buildFirstPerson, readyWeapons } from '../src/client/render/weapons/catalog';
import { HAND_LOOKS, buildHandGeometry } from '../src/client/render/weapons/hands';
import type { WeaponModel } from '../src/client/render/weapons/types';

function staticMeshes(m: WeaponModel) {
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const list = [new THREE.Mesh(m.static.metal, mat), new THREE.Mesh(m.static.polymer, mat)];
  const mag = new THREE.Mesh(m.moving.magazine.geometry, mat);
  mag.position.copy(m.moving.magazine.pivot);
  list.push(mag);
  // Zavřené víko a páka jsou v klidové poloze součástí obrysu (nesmí zakrýt mířidla).
  for (const part of [m.moving.feedCover, m.moving.chargingHandle]) {
    if (!part) continue;
    const o = new THREE.Mesh(part.geometry, mat);
    o.position.copy(part.pivot);
    list.push(o);
  }
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

  it('katalog: 12 hotových zbraní + 2 čekající (Sniper); kolimátor jen Assault', () => {
    expect(WEAPON_DEFS).toHaveLength(14);
    expect(ready).toHaveLength(12);
    expect(WEAPON_DEFS.filter((w) => !w.build).map((w) => w.id).sort()).toEqual(['m24', 'svd']);
    for (const d of ready) {
      const m = buildFirstPerson(d.id);
      expect(!!m.optic, d.id).toBe(d.kit === 'assault');
      expect(m.sight).toBe(d.kit === 'assault' ? 'optic' : 'iron');
      expect(HAND_LOOKS[d.hands], d.hands).toBeTruthy();
    }
  });

  it('rozpočet zbraně v první osobě: 3 000–3 500 trojúhelníků (bez rukou)', () => {
    for (const d of ready) {
      const t = buildFirstPerson(d.id).triangles;
      expect(t, d.id).toBeGreaterThanOrEqual(3000);
      expect(t, d.id).toBeLessThanOrEqual(3500);
    }
  });

  it('rozpočet: zbraň + obě ruce ≤ 20 000 trojúhelníků', () => {
    for (const d of ready) {
      const m = buildFirstPerson(d.id);
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
      const { points: P } = buildFirstPerson(d.id);
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
      const m = buildFirstPerson(d.id);
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
      const m = buildFirstPerson(d.id);
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
      const m = buildFirstPerson(d.id);
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

  it('pásové zbraně: víko na závěsu kryje lůžko s pásem, schránka je na straně podávání', () => {
    for (const id of ['m249', 'pkm']) {
      const m = buildFirstPerson(id);
      expect(m.reloadStyle).toBe('belt');
      const P = m.points;
      const fc = m.moving.feedCover!;
      // Vstup pásu leží pod zavřeným víkem (mezi závěsem a zadním koncem, pod jeho horní plochou).
      const b = new THREE.Box3().setFromBufferAttribute(fc.geometry.getAttribute('position') as THREE.BufferAttribute);
      b.translate(fc.pivot);
      expect(P.feedEntry!.z).toBeGreaterThan(b.min.z);
      expect(P.feedEntry!.z).toBeLessThan(b.max.z);
      expect(P.feedEntry!.y).toBeLessThan(b.max.y);
      expect(Math.sign(m.magSide)).toBe(id === 'm249' ? -1 : 1);
    }
    const qbb = buildFirstPerson('qbb95');
    expect(qbb.reloadStyle).toBe('magazine');
    expect(qbb.optic).toBeUndefined();
  });

  it('siluety: M16A2 je viditelně delší než M4A1, bullpup nejkratší', () => {
    const len = (id: string) => {
      const m = buildFirstPerson(id);
      const b = new THREE.Box3().setFromBufferAttribute(m.static.polymer.getAttribute('position') as THREE.BufferAttribute);
      b.union(new THREE.Box3().setFromBufferAttribute(m.static.metal.getAttribute('position') as THREE.BufferAttribute));
      return b.max.z - b.min.z;
    };
    expect(len('m16a2')).toBeGreaterThan(len('m4a1') + 0.08);
    for (const id of ['m4a1', 'ak101', 'akm', 't81', 'm16a2', 'qbb95']) expect(len('qbz95')).toBeLessThan(len(id));
    expect(len('pkm')).toBeGreaterThan(len('m249') + 0.08);
  });
});
