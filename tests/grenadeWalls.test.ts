import { describe, expect, it } from 'vitest';
import { MatchSim } from '../src/shared/sim/match';
import { buildEmptyMap } from '../src/world/maps/empty';
import { stepGrenades, type Grenade } from '../src/shared/sim/matchItems';
import { box, makeWorld } from './helpers';

/** Granáty nesmí projít zdí, plotem (překážka jen pro pohyb) ani rohem. */
async function world() {
  const wall = box([0, 30, -5], [40, 60, 0.2]); // zeď budovy 20 cm (vysoká – nejde přehodit)
  const fence = { ...box([0, 30, 5], [40, 60, 0.06]), moveOnly: true, objectId: 'fence' }; // pletivo
  const cornerA = box([20, 30, -20], [0.2, 60, 10]);
  const cornerB = box([15, 30, -25], [10, 60, 0.2]);
  const phys = await makeWorld([wall, fence, cornerA, cornerB]);
  const d = buildEmptyMap('w', 96, 2);
  return new MatchSim(phys, d, { conquest: false });
}

function nade(id: number, pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }): Grenade {
  return { id: `t${id}`, owner: 'x', team: 'teamA', kind: 'smoke', pos, vel, fuseAt: 1e9, smokeUntil: 0, rest: false };
}

describe('granáty a překážky', () => {
  it('stovky hodů různou rychlostí a úhlem: žádný granát za zdí ani za plotem', async () => {
    const m = await world();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const toWall = i % 2 === 0;
      const sp = 4 + rnd() * 30;
      const yaw = (rnd() - 0.5) * 2.6, pitch = (rnd() - 0.3) * 1.4;
      const dz = Math.cos(pitch) * Math.cos(yaw) * (toWall ? -1 : 1);
      m.grenades.push(nade(i, { x: (rnd() - 0.5) * 16, y: 0.3 + rnd() * 2.5, z: toWall ? -4.7 + rnd() * 4 : 4.8 - rnd() * 4 }, { x: Math.cos(pitch) * Math.sin(yaw) * sp, y: Math.sin(pitch) * sp, z: dz * sp }));
    }
    for (let t = 0; t < 600; t++) {
      stepGrenades(m, 1 / 60);
    }
    const bad = m.grenades.filter((n) => (Number(n.id.slice(1)) % 2 === 0 ? n.pos.z < -5 : n.pos.z > 5) && n.pos.y > -1);
    expect(bad.map((n) => n.id)).toEqual([]);
  });

  it('roh dvou zdí: granát z vnitřku rohu zůstane uvnitř', async () => {
    const m = await world();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 0.5;
      m.grenades.push(nade(i, { x: 17, y: 1.2, z: -22 }, { x: Math.cos(a) * 25, y: 1 + (i % 5), z: -Math.sin(a) * 25 }));
    }
    for (let t = 0; t < 600; t++) {
      stepGrenades(m, 1 / 60);
    }
    // Průlet = skončit přímo za zdí (obletět konec zdi je v pořádku).
    const out = m.grenades.filter((n) => ((n.pos.x > 20.1 && n.pos.z > -25 && n.pos.z < -15) || (n.pos.z < -25.1 && n.pos.x > 10 && n.pos.x < 20)) && n.pos.y > -1);
    expect(out.map((n) => n.id)).toEqual([]);
  });
});
