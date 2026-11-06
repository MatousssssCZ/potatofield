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
