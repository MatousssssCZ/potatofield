import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/shared/config/movement';
import { PF_MG, PF_PUMP, PF_SEMISHOT, reloadDuration, type WeaponConfig } from '../src/shared/config/weapon';
import { deg } from '../src/shared/config/movement';
import { ARSENAL, rulesOf, weaponFor } from '../src/shared/config/arsenal';
import { stepProjectiles, type Projectile } from '../src/shared/sim/ballistics';
import { createWeaponState, stepWeapon, type WeaponState } from '../src/shared/sim/weapon';
import { emptyInput, type InputFrame } from '../src/shared/sim/input';
import { MatchSim } from '../src/shared/sim/match';
import { buildEmptyMap } from '../src/world/maps/empty';
import { PhysicsWorld } from '../src/shared/physics/world';
import { decodeRemote, encodeRemote, parseClientMsg, type RemoteState } from '../src/shared/net/protocol';
import type { ControlPoint, MapDocument, Scenario, SpawnPoint } from '../src/shared/map/schema';
import { BTN, Sim, makeWorld } from './helpers';
import type { PhysicsWorld as PW } from '../src/shared/physics/world';

class Shooter {
  sim: Sim;
  ws: WeaponState;
  shots: Projectile[] = [];
  prevHeld = 0;
  constructor(public phys: PW, public w: WeaponConfig, id = 'r870') {
    this.sim = new Sim(phys, { x: 0, y: 0, z: 0 }, 0);
    this.ws = createWeaponState(w, 0, id);
    this.sim.settle();
    this.tick(Math.ceil(w.equipTime * 60) + 2, {});
  }
  get t() {
    return this.sim.s.tick / 60;
  }
  tick(n: number, f: Partial<InputFrame>) {
    let fired = 0;
    for (let i = 0; i < n; i++) {
      const held = f.held ?? 0;
      const input: InputFrame = { ...emptyInput(this.sim.s.tick), ...f, held, pressed: (held & ~this.prevHeld) | (i === 0 ? (f.pressed ?? 0) : 0) };
      this.prevHeld = held;
      this.sim.ctrl.step(this.sim.s, input);
      const p = stepWeapon(this.w, MOVEMENT, this.sim.s, this.ws, input, { playerId: 'p1', lifeId: 1, seed: 99, phys: this.phys });
      this.shots.push(...p);
      fired += p.length;
    }
    return fired;
  }
  press(b: number) {
    this.tick(1, { held: b });
    this.tick(1, {});
  }
}

describe('brokovnice a kulomet (pravidla N)', () => {
  it('pumpa: jeden stisk = jeden náboj a 9 broků s různými klíči; kadence pumpy', async () => {
    const s = new Shooter(await makeWorld(), PF_PUMP);
    expect(s.ws.mode).toBe('semi');
    s.press(BTN.FIRE);
    expect(s.shots).toHaveLength(9);
    expect(new Set(s.shots.map((p) => p.key)).size).toBe(9);
    expect(s.ws.mag).toBe(6);
    expect(s.shots.every((p) => p.rules === PF_PUMP)).toBe(true);
    // Během pumpy (0,9 s) další stisk nevystřelí.
    s.tick(20, {});
    s.press(BTN.FIRE);
    expect(s.shots).toHaveLength(9);
    s.tick(40, {});
    s.press(BTN.FIRE);
    expect(s.shots).toHaveLength(18);
  });

  it('broky leží v kuželu rozptyl + kužel broků a jsou deterministické ze seedu', async () => {
    const a = new Shooter(await makeWorld(), PF_PUMP);
    const b = new Shooter(await makeWorld(), PF_PUMP);
    a.press(BTN.FIRE);
    b.press(BTN.FIRE);
    const dirs = (s: Shooter) => s.shots.map((p) => { const l = Math.hypot(p.vel.x, p.vel.y, p.vel.z); return [p.vel.x / l, p.vel.y / l, p.vel.z / l]; });
    expect(dirs(a)).toEqual(dirs(b));
    const maxAng = deg(PF_PUMP.pelletSpreadDeg! + 2.5);
    for (const [, , z] of dirs(a)) expect(Math.acos(-z)).toBeLessThan(maxAng);
    // Broky nejsou totožné (skutečný kužel).
    expect(new Set(dirs(a).map((d) => d.map((x) => x.toFixed(4)).join())).size).toBe(9);
  });

  it('nabíjení po jednom: každý náboj se připíše při vložení; spoušť nabíjení přeruší', async () => {
    const s = new Shooter(await makeWorld(), PF_PUMP);
    for (let i = 0; i < 3; i++) {
      s.press(BTN.FIRE);
      s.tick(60, {});
    }
    expect(s.ws.mag).toBe(4);
    s.press(BTN.RELOAD);
    expect(s.ws.action).toBe('reload');
    expect(s.ws.shellsPlanned).toBe(3);
    const start = s.ws.actionStart;
    // Po přípravě + 2 vloženích jsou v zásobníku 2 náboje navíc.
    while (s.t < start + PF_PUMP.shellStart! + 2 * PF_PUMP.shellInsert! + 0.02) s.tick(1, {});
    expect(s.ws.mag).toBe(6);
    expect(s.ws.reserve).toBe(28 - 2);
    s.press(BTN.FIRE);
    expect(s.ws.action).toBe('idle');
    expect(s.ws.mag).toBe(5);
    expect(s.shots.length).toBe(4 * 9);
  });

  it('prázdná pumpa: přebití delší o dopumpování; délka podle počtu nábojů', () => {
    expect(reloadDuration(PF_PUMP, 0, 28).time).toBeCloseTo(PF_PUMP.shellStart! + 7 * PF_PUMP.shellInsert! + PF_PUMP.chamberTime!, 6);
    expect(reloadDuration(PF_PUMP, 5, 28).shells).toBe(2);
    expect(reloadDuration(PF_PUMP, 5, 1).shells).toBe(1);
    expect(reloadDuration(PF_SEMISHOT, 0, 24).time).toBe(PF_SEMISHOT.reloadEmpty);
  });

  it('broky nesou pravidla: poškození podle profilu brokovnice, krátký dolet', async () => {
    const phys = await makeWorld();
    const s = new Shooter(phys, PF_PUMP);
    s.press(BTN.FIRE);
    const hb = [{ id: 'v', a: { x: 0, y: 0.6, z: -6 }, b: { x: 0, y: 1.6, z: -6 }, r: 0.4, kind: 'vertical' as const, feetY: 0, height: 1.8 }];
    const ev = [];
    for (let i = 0; i < 30; i++) ev.push(...stepProjectiles(s.shots, 1 / 60, PF_MG, phys, hb));
    const hits = ev.filter((e) => e.target === 'v');
    expect(hits.length).toBeGreaterThan(4);
    for (const h of hits) expect(h.damage).toBeLessThanOrEqual(PF_PUMP.damage.near * PF_PUMP.headMultiplier);
  });

  it('kulomet: 100 ran, jen automat', async () => {
    const s = new Shooter(await makeWorld(), PF_MG, 'm249');
    expect(s.ws.mag).toBe(100);
    expect(s.ws.mode).toBe('auto');
    expect(s.tick(60, { held: BTN.FIRE })).toBeGreaterThanOrEqual(12);
  });
});

function cqDoc(): MapDocument {
  const d = buildEmptyMap('c', 128, 2);
  const cp = (id: string, x: number, owner: ControlPoint['defaultOwner']): ControlPoint => ({ id, name: id, position: [x, 0, 0], radius: 10, height: 4, defaultOwner: owner, capturable: false, spawnEnabled: true, countsForBleed: false });
  d.controlPoints = [cp('baseA', -40, 'teamA'), cp('baseB', 40, 'teamB')];
  const sp = (id: string, x: number, team: 'teamA' | 'teamB', cpId: string): SpawnPoint => ({ id, position: [x, 0.02, 3], yaw: 0, teams: [team], controlPointId: cpId });
  d.spawnPoints = [sp('sa', -40, 'teamA', 'baseA'), sp('sb', 40, 'teamB', 'baseB')];
  const sc: Scenario = { id: 'sc', name: 'test', overrides: [], tickets: { teamA: 100, teamB: 100 }, timeLimit: 1200, respawnDelay: 5, captureTime: 10, neutralizeTime: 10, bleedInterval: 5, zoneIds: [] };
  d.scenarios = [sc];
  return d;
}

describe('výbava potvrzená autoritou', () => {
  it('Conquest: zbraň musí patřit frakci týmu; pravidla a munice podle zbraně', async () => {
    const d = cqDoc();
    const phys = await PhysicsWorld.create();
    phys.setTerrain(d.terrain);
    const m = new MatchSim(phys, d, { conquest: true, scenarioId: 'sc', factions: { teamA: 'usmc', teamB: 'pla' } });
    const a = m.addPlayer('a', 'teamA');
    const b = m.addPlayer('b', 'teamB');
    expect(a.weaponId).toBe('m4a1');
    expect(b.weaponId).toBe('qbz95');
    expect(m.requestSpawn('a', 'sa', 'ak101')).toMatch(/frakci/);
    expect(m.requestSpawn('a', 'sa', 'neexistuje')).toMatch(/neznámá/);
    expect(m.requestSpawn('a', 'sa', 'r870')).toBeNull();
    expect(a.weapon.weaponId).toBe('r870');
    expect(a.weapon.mag).toBe(PF_PUMP.magazine);
    expect(m.requestSpawn('b', 'sb', 'qbb95')).toBeNull();
    expect(b.weapon.mag).toBe(PF_MG.magazine);
  });

  it('volný test: libovolná zbraň arzenálu', async () => {
    const d = buildEmptyMap('f', 64, 2);
    const phys = await PhysicsWorld.create();
    phys.setTerrain(d.terrain);
    const m = new MatchSim(phys, d, { conquest: false });
    m.addPlayer('x', 'teamA');
    expect(m.requestSpawn('x', null, 'saiga')).toBeNull();
    expect(m.players.get('x')!.weapon.weaponId).toBe('saiga');
  });

  it('arzenál: 12 zbraní, každá frakce má 4 classy; pravidla podle classy', () => {
    expect(ARSENAL).toHaveLength(12);
    for (const f of ['usmc', 'mec', 'pla'] as const) for (const k of ['assault', 'medic', 'support', 'engineer'] as const) expect(weaponFor(f, k)).toBeTruthy();
    expect(rulesOf('pkm')).toBe(PF_MG);
    expect(rulesOf('saiga')).toBe(PF_SEMISHOT);
    expect(rulesOf('hawk97')).toBe(PF_PUMP);
  });

  it('protokol v2: spawn s neznámou zbraní se odmítne; zbraň vzdáleného hráče projde n-ticí', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'spawn', id: null, weapon: 'xyz' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'spawn', id: 'sa', weapon: 'pkm' }))).not.toBeNull();
    const r: RemoteState = { id: 'a', name: 'A', team: 'teamB', alive: true, pos: [1, 2, 3], vel: [0, 0, 0], yaw: 0, pitch: 0, bodyYaw: 0, height: 1.8, stance: 'stand', grounded: true, sprinting: false, ads: 0, action: 'reload', actionStart: 1, actionEnd: 2, shotSeq: 3, ladder: null, squad: null, weapon: 'saiga' };
    expect(decodeRemote(encodeRemote(r)).weapon).toBe('saiga');
  });
});
