import { describe, expect, it } from 'vitest';
import { MatchSim } from '../src/shared/sim/match';
import { PhysicsWorld } from '../src/shared/physics/world';
import { buildEmptyMap } from '../src/world/maps/empty';
import { BTN, emptyInput } from '../src/shared/sim/input';
import { ITEM_RULES } from '../src/shared/sim/matchItems';

async function setup(weapon = 'svd', enemyAt = -9) {
  const d = buildEmptyMap('nade', 96, 2);
  const phys = await PhysicsWorld.create();
  phys.setTerrain(d.terrain);
  const m = new MatchSim(phys, d, { conquest: false });
  const a = m.addPlayer('a', 'teamA');
  const b = m.addPlayer('b', 'teamB');
  m.requestSpawn('a', null, weapon);
  m.requestSpawn('b', null, 'ak101');
  a.ctrl.place(a.state, { x: 0, y: 0.02, z: 0 }, 0);
  b.ctrl.place(b.state, { x: 0, y: 0.02, z: enemyAt }, 0);
  const events: string[] = [];
  const step = (n: number, f: { pressed?: number; slot?: number } = {}) => {
    for (let i = 0; i < n; i++) {
      m.step(new Map([['a', { ...emptyInput(m.tick), pressed: i === 0 ? (f.pressed ?? 0) : 0, slot: i === 0 ? (f.slot ?? 0) : 0 }], ['b', emptyInput(m.tick)]]));
      for (const e of m.events) events.push(e.type);
      m.events.length = 0;
    }
  };
  step(40);
  return { m, a, b, step, events };
}

describe('granáty', () => {
  it('hod: granát vznikne v okamžiku uvolnění, počet klesne; po posledním kusu zpět na primární zbraň', async () => {
    const { m, a, step } = await setup('svd');
    step(1, { slot: 4 });
    step(40);
    expect(a.weapon.weaponId).toBe('frag');
    expect(a.weapon.mag).toBe(1);
    step(1, { pressed: BTN.FIRE });
    expect(a.weapon.action).toBe('throw');
    step(Math.ceil(ITEM_RULES.throw.releaseAt * 60) + 1);
    expect(m.grenades.length).toBe(1);
    expect(a.inv!.states[4].mag).toBe(0);
    step(40);
    expect(a.weapon.weaponId).toBe('svd'); // poslední granát → návrat na primární
  });

  it('výbuch po zpoždění zraní nepřítele v dosahu; granát se odráží a zastaví na zemi', async () => {
    const { m, a, b, step, events } = await setup('svd', -5);
    a.state.pitch = -0.75; // hod šikmo dolů – granát dopadne pár metrů před hráčem
    step(1, { slot: 4 });
    step(40);
    step(1, { pressed: BTN.FIRE });
    step(60);
    const n = m.grenades[0];
    expect(n).toBeTruthy();
    expect(Math.abs(n.pos.z)).toBeLessThan(12);
    step(Math.ceil(ITEM_RULES.frag.fuse * 60));
    expect(events).toContain('explosion');
    expect(m.grenades.length).toBe(0);
    expect(b.hp).toBeLessThan(100);
    void a;
  });

  it('kryt mezi výbuchem a tělem chrání; mimo dosah bez poškození', async () => {
    const { m, b, step } = await setup('svd', -30);
    m.grenades.push({ id: 'x', owner: 'a', team: 'teamA', kind: 'frag', pos: { x: 0, y: 0.05, z: -29 }, vel: { x: 0, y: 0, z: 0 }, fuseAt: m.time, smokeUntil: 0, rest: true });
    step(2);
    expect(b.hp).toBeLessThan(100); // 1 m od výbuchu
    const hp = b.hp;
    m.grenades.push({ id: 'y', owner: 'a', team: 'teamA', kind: 'frag', pos: { x: 0, y: 0.05, z: -50 }, vel: { x: 0, y: 0, z: 0 }, fuseAt: m.time, smokeUntil: 0, rest: true });
    step(2);
    expect(b.hp).toBe(hp); // 20 m – mimo dosah
  });

  it('dýmovnice po zážehu hoří po dobu clony a pak zmizí', async () => {
    const { m, step, events } = await setup('m4a1');
    step(1, { slot: 5 });
    step(40);
    expect(m.players.get('a')!.weapon.weaponId).toBe('smoke');
    step(1, { pressed: BTN.FIRE });
    step(60 * 3);
    expect(events).toContain('smoke');
    expect(m.grenades[0].smokeUntil).toBeGreaterThan(m.time);
    step(Math.ceil(ITEM_RULES.smoke.duration * 60) + 10);
    expect(m.grenades.length).toBe(0);
  });
});
