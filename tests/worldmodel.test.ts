import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WEAPON_IDS } from '../src/shared/config/arsenal';
import { worldWeapon } from '../src/client/render/weapons/worldModel';
import { SoldierPool } from '../src/client/render/soldier';
import { createPlayerState } from '../src/shared/sim/player';
import { createWeaponState } from '../src/shared/sim/weapon';
import { MOVEMENT } from '../src/shared/config/movement';
import { rulesOf } from '../src/shared/config/arsenal';
import type { PlayerView } from '../src/client/runtime/driver';

describe('světové modely zbraní a LOD', () => {
  it('rozpočet: u ostatních hráčů 1 000–1 300, vzdálená varianta 200–300 trojúhelníků; LOD0 > LOD1 > LOD2', () => {
    const rows: string[] = [];
    for (const id of WEAPON_IDS) {
      const w = worldWeapon(id, 'standard');
      const [a, b, c] = w.triangles;
      rows.push(`${id}: ${a} / ${b} / ${c}`);
      expect(a).toBeGreaterThan(b);
      expect(b).toBeGreaterThan(c);
      expect(a, id).toBeGreaterThanOrEqual(1000);
      expect(a, id).toBeLessThanOrEqual(1300);
      expect(b, id).toBeGreaterThanOrEqual(200);
      expect(b, id).toBeLessThanOrEqual(300);
      // Siluety mají stejný obal jako LOD0 (žádné odtržené díly).
      const bb = (g: THREE.BufferGeometry) => (g.computeBoundingBox(), g.boundingBox!);
      expect(bb(w.lods[1]).max.z).toBeCloseTo(bb(w.lods[0]).max.z, 3);
      expect(bb(w.lods[2]).min.z).toBeCloseTo(bb(w.lods[0]).min.z, 3);
    }
    console.log('LOD0/1/2:\n' + rows.join('\n'));
  });

  it('63 vzdálených postav: zbraň podle výbavy, LOD podle vzdálenosti, sdílená geometrie', () => {
    const pool = new SoldierPool('standard');
    const list: PlayerView[] = [];
    for (let i = 0; i < 63; i++) {
      const id = WEAPON_IDS[i % WEAPON_IDS.length];
      const st = createPlayerState(MOVEMENT, { x: (i % 9) * 3, y: 0, z: -5 - Math.floor(i / 9) * 22 }, 0);
      list.push({ id: `p${i}`, name: `p${i}`, team: i % 2 ? 'teamA' : 'teamB', state: st, weapon: createWeaponState(rulesOf(id), 0, id), hp: 100, alive: true, respawnAt: 0, zone: null, kills: 0, deaths: 0, life: 'alive', downedLeft: 0, reviveProgress: 0, revives: 0 });
    }
    pool.update(list, 1 / 60, 0, new THREE.Vector3(12, 1.6, 0));
    expect(pool.count).toBe(63);
    expect(pool.lodCounts.reduce((a, b) => a + b, 0)).toBe(63);
    expect(pool.lodCounts[0]).toBeGreaterThan(0);
    expect(pool.lodCounts[2]).toBeGreaterThan(0);
    // Geometrie zbraní je sdílená: nejvýš 12 zbraní × 3 LOD různých geometrií.
    const geos = new Set<THREE.BufferGeometry>();
    let tris = 0;
    pool.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible) {
        const g = m.geometry as THREE.BufferGeometry;
        tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
        if (m.material && (m.geometry.getAttribute('color'))) geos.add(g);
      }
    });
    expect(geos.size).toBeLessThanOrEqual(36);
    console.log(`63 postav: LOD ${pool.lodCounts.join('/')}, viditelné trojúhelníky ${Math.round(tris)}`);
    pool.dispose();
  });
});
