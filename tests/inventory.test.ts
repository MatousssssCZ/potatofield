import { describe, expect, it } from 'vitest';
import { MatchSim } from '../src/shared/sim/match';
import { PhysicsWorld } from '../src/shared/physics/world';
import { buildEmptyMap } from '../src/world/maps/empty';
import { BTN, SLOT_NEXT, SLOT_PREV, emptyInput } from '../src/shared/sim/input';
import { kitItems } from '../src/shared/config/kits';
import { rulesOf } from '../src/shared/config/arsenal';
import { resolveRequest } from '../src/shared/sim/inventory';

async function setup(weapon = 'm4a1') {
  const d = buildEmptyMap('inv', 64, 2);
  const phys = await PhysicsWorld.create();
  phys.setTerrain(d.terrain);
  const m = new MatchSim(phys, d, { conquest: false });
  const p = m.addPlayer('a', 'teamA');
  expect(m.requestSpawn('a', null, weapon)).toBeNull();
  return { m, p };
}
const tick = (m: MatchSim, n: number, f: { held?: number; pressed?: number; slot?: number } = {}) => {
  for (let i = 0; i < n; i++) m.step(new Map([['a', { ...emptyInput(m.tick), held: f.held ?? 0, pressed: i === 0 ? (f.pressed ?? 0) : 0, slot: i === 0 ? (f.slot ?? 0) : 0 }]]));
};

describe('výbava: sloty a přepínání', () => {
  it('kit z dat: 1 nůž, 2 pistole, 3 primární, 4 granát; Assault má víc granátů než Medic', () => {
    const a = kitItems('usmc', 'assault'), md = kitItems('usmc', 'medic'), sp = kitItems('mec', 'support');
    expect(a.map((i) => [i.slot, i.kind])).toEqual([[1, 'knife'], [2, 'pistol'], [3, 'primary'], [4, 'frag'], [5, 'smoke']]);
    expect(md.map((i) => i.kind)).toEqual(['knife', 'pistol', 'primary', 'frag', 'medkit', 'defib']);
    expect(sp.find((i) => i.kind === 'primary')!.id).toBe('pkm');
    expect(sp.find((i) => i.kind === 'ammo')!.slot).toBe(5);
    expect(a.find((i) => i.kind === 'frag')!.count!).toBeGreaterThan(md.find((i) => i.kind === 'frag')!.count!);
  });

  it('číslo slotu přepne s tasením; střelba během tasení není možná', async () => {
    const { m, p } = await setup();
    tick(m, 60);
    expect(p.inv!.active).toBe(3);
    tick(m, 1, { slot: 2 });
    expect(p.inv!.active).toBe(2);
    expect(p.weapon.weaponId).toBe('m9');
    expect(p.weapon.action).toBe('equip');
    const mag = p.weapon.mag;
    tick(m, 2, { held: BTN.FIRE, pressed: BTN.FIRE });
    expect(p.weapon.mag).toBe(mag);
    tick(m, Math.ceil(rulesOf('m9').equipTime * 60) + 2);
    tick(m, 1, { held: BTN.FIRE, pressed: BTN.FIRE });
    expect(p.weapon.mag).toBe(mag - 1);
  });

  it('přepnutí během přebíjení přebíjení zruší a nepřipíše náboje (nezkracuje reload)', async () => {
    const { m, p } = await setup();
    tick(m, 60);
    for (let i = 0; i < 5; i++) tick(m, 8, { held: BTN.FIRE, pressed: BTN.FIRE });
    const prim = p.inv!.states[3];
    const before = { mag: prim.mag, reserve: prim.reserve };
    tick(m, 1, { pressed: BTN.RELOAD });
    expect(prim.action).toBe('reload');
    tick(m, 30);
    tick(m, 1, { slot: 2 });
    tick(m, 200);
    expect(prim.mag).toBe(before.mag);
    expect(prim.reserve).toBe(before.reserve);
    tick(m, 1, { slot: 3 });
    expect(p.weapon).toBe(prim);
    expect(prim.action).toBe('equip');
  });

  it('kolečko projde jen dostupné položky; spotřebovaný granát se přeskočí, prázdná zbraň ne', async () => {
    const { m, p } = await setup('svd'); // Sniper: 1 granát
    tick(m, 60);
    const inv = p.inv!;
    expect(resolveRequest(inv, SLOT_NEXT)).toBe(4);
    inv.states[4].mag = 0;
    expect(resolveRequest(inv, SLOT_NEXT)).toBe(1);
    expect(resolveRequest(inv, 4)).toBeNull();
    expect(resolveRequest(inv, SLOT_PREV)).toBe(2);
    inv.states[3].mag = 0;
    inv.states[3].reserve = 0;
    tick(m, 1, { slot: 1 });
    tick(m, 40);
    tick(m, 1, { slot: 3 });
    expect(inv.active).toBe(3);
    expect(p.weapon.mag).toBe(0);
  });

  it('nový život = nový kit s plnými počty (stav slotů se nepřenáší)', async () => {
    const { m, p } = await setup();
    tick(m, 60);
    p.inv!.states[4].mag = 0;
    m.kill(p, null, 'fall');
    tick(m, 60 * 4);
    expect(m.requestSpawn('a', null, 'm4a1')).toBeNull();
    expect(p.inv!.states[4].mag).toBe(4);
    expect(p.inv!.active).toBe(3);
  });
});

describe('nůž a pistole', () => {
  async function duel() {
    const d = buildEmptyMap('knife', 64, 2);
    const phys = await PhysicsWorld.create();
    phys.setTerrain(d.terrain);
    const m = new MatchSim(phys, d, { conquest: false });
    const a = m.addPlayer('a', 'teamA');
    const b = m.addPlayer('b', 'teamB');
    m.requestSpawn('a', null, 'm4a1');
    m.requestSpawn('b', null, 'ak101');
    a.ctrl.place(a.state, { x: 0, y: 0.02, z: 0 }, 0);
    b.ctrl.place(b.state, { x: 0, y: 0.02, z: -1.2 }, 0);
    const step = (n: number, f: { pressed?: number; slot?: number } = {}) => {
      for (let i = 0; i < n; i++) m.step(new Map([['a', { ...emptyInput(m.tick), pressed: i === 0 ? (f.pressed ?? 0) : 0, slot: i === 0 ? (f.slot ?? 0) : 0 }], ['b', emptyInput(m.tick)]]));
    };
    step(40);
    step(1, { slot: 1 });
    step(30);
    return { m, a, b, step };
  }

  it('nůž: soupeř těsně před hráčem je vyřazen jedním útokem', async () => {
    const { a, b, step } = await duel();
    expect(a.weapon.weaponId).toBe('knife');
    step(1, { pressed: BTN.FIRE });
    expect(a.weapon.action).toBe('attack');
    step(20);
    expect(b.downed).toBe(true);
    expect(a.kills).toBe(1);
  });

  it('nůž: soupeř za zády ani daleko zásah nedostane', async () => {
    const { a, b, step } = await duel();
    b.ctrl.place(b.state, { x: 0, y: 0.02, z: 1.2 }, 0); // za zády
    step(1, { pressed: BTN.FIRE });
    step(40);
    expect(b.alive).toBe(true);
    b.ctrl.place(b.state, { x: 0, y: 0.02, z: -4 }, 0); // daleko
    step(1, { pressed: BTN.FIRE });
    step(40);
    expect(b.hp).toBe(100);
    void a;
  });

  it('pistole má vlastní zásobník a rezervu; primární zbraň si stav drží', async () => {
    const { a, step } = await duel();
    step(1, { slot: 3 });
    step(40);
    const prim = a.weapon;
    for (let i = 0; i < 3; i++) step(8, { pressed: BTN.FIRE });
    const pm = prim.mag;
    step(1, { slot: 2 });
    step(40);
    expect(a.weapon.weaponId).toBe('m9');
    expect(a.weapon.mag).toBe(rulesOf('m9').magazine);
    step(8, { pressed: BTN.FIRE });
    expect(a.weapon.mag).toBe(rulesOf('m9').magazine - 1);
    step(1, { slot: 3 });
    expect(a.weapon).toBe(prim);
    expect(prim.mag).toBe(pm);
  });
});

describe('zásobování', () => {
  it('support doplní rezervu sobě (bez spoluhráče) jen do maxima kitu a granát po 2,5 s', async () => {
    const { m, p } = await setup('m249');
    tick(m, 60);
    const prim = p.inv!.states[3];
    prim.reserve = 0;
    p.inv!.states[4].mag = 0;
    tick(m, 1, { slot: 5 });
    tick(m, 40);
    expect(p.weapon.weaponId).toBe('ammo');
    tick(m, 60, { held: BTN.FIRE, pressed: BTN.FIRE });
    expect(prim.reserve).toBeGreaterThan(0);
    tick(m, 60 * 10, { held: BTN.FIRE });
    expect(prim.reserve).toBe(rulesOf('m249').reserve);
    expect(p.inv!.states[4].mag).toBe(2);
  });
});
