import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/shared/config/movement';
import { PF_RIFLE } from '../src/shared/config/weapon';
import { PF_RIG, adsRoot } from '../src/shared/config/rig';
import { hitboxOf, rayCapsule, stepProjectiles, damageAt, type Projectile } from '../src/shared/sim/ballistics';
import { createWeaponState, sampleCone, shotRandom, spreadOf, stepWeapon, type WeaponState } from '../src/shared/sim/weapon';
import { emptyInput, type InputFrame } from '../src/shared/sim/input';
import type { PhysicsWorld } from '../src/shared/physics/world';
import { BTN, Sim, box, makeWorld } from './helpers';

class Shooter {
  sim: Sim;
  ws: WeaponState;
  shots: Projectile[] = [];
  prevHeld = 0;
  constructor(public phys: PhysicsWorld, pos = { x: 0, y: 0, z: 0 }, yaw = 0) {
    this.sim = new Sim(phys, pos, yaw);
    this.ws = createWeaponState(PF_RIFLE, 0);
    this.sim.settle();
    this.tick(40, {}); // equip 0,5 s
  }
  tick(n: number, f: Partial<InputFrame>) {
    let fired = 0;
    for (let i = 0; i < n; i++) {
      const held = f.held ?? 0;
      const input: InputFrame = { ...emptyInput(this.sim.s.tick), ...f, held, pressed: (held & ~this.prevHeld) | (i === 0 ? (f.pressed ?? 0) : 0) };
      this.prevHeld = held;
      this.sim.ctrl.step(this.sim.s, input);
      const p = stepWeapon(PF_RIFLE, MOVEMENT, this.sim.s, this.ws, input, { playerId: 'p1', lifeId: 1, seed: 1234, phys: this.phys });
      this.shots.push(...p);
      fired += p.length;
    }
    return fired;
  }
}

describe('logika zbraně', () => {
  it('600 RPM: v intervalu [0, 1) s vznikne přesně 10 výstřelů (časová osa simulace)', async () => {
    const s = new Shooter(await makeWorld());
    expect(s.tick(60, { held: BTN.FIRE })).toBe(10);
  });

  it('semi při držení vystřelí jednou, nový stisk znovu', async () => {
    const s = new Shooter(await makeWorld());
    s.tick(1, { held: BTN.MODE });
    s.tick(1, {});
    expect(s.ws.mode).toBe('semi');
    expect(s.tick(60, { held: BTN.FIRE })).toBe(1);
    s.tick(1, {});
    expect(s.tick(10, { held: BTN.FIRE })).toBe(1);
  });

  it('reload: jediný commit na konci; R spam neduplikuje munici ani nezrychlí kadenci', async () => {
    const s = new Shooter(await makeWorld());
    s.tick(60, { held: BTN.FIRE }); // 10 ran → 20/120
    expect(s.ws.mag).toBe(20);
    for (let i = 0; i < 20; i++) {
      s.tick(1, { held: BTN.RELOAD });
      s.tick(1, {});
    }
    expect(s.ws.mag).toBe(20); // ještě neskončil (2,4 s)
    s.tick(Math.ceil(2.4 * 60), {});
    expect(s.ws.mag).toBe(30);
    expect(s.ws.reserve).toBe(110);
    expect(s.ws.mag + s.ws.reserve).toBe(140);
  });

  it('prázdné přebití trvá 3,0 s; doplní min(kapacita − aktuální, rezerva)', async () => {
    const s = new Shooter(await makeWorld());
    s.ws.reserve = 12;
    s.tick(6 * 60, { held: BTN.FIRE });
    expect(s.ws.mag).toBe(0);
    s.tick(1, { held: BTN.RELOAD });
    expect(s.ws.reloadEmpty).toBe(true);
    s.tick(Math.round(2.9 * 60), {});
    expect(s.ws.mag).toBe(0);
    s.tick(10, {});
    expect(s.ws.mag).toBe(12);
    expect(s.ws.reserve).toBe(0);
  });

  it('reload pokračuje během sprintu a při změně postoje; munice se připíše jednou', async () => {
    for (const frac of [0.25, 0.6, 0.9]) {
      const s = new Shooter(await makeWorld());
      s.tick(30, { held: BTN.FIRE });
      const total = s.ws.mag + s.ws.reserve;
      s.tick(1, { held: BTN.RELOAD });
      s.tick(Math.round(2.4 * 60 * frac), {});
      s.tick(20, { moveZ: 1, held: BTN.SPRINT });
      expect(s.sim.s.sprinting).toBe(true);
      expect(s.ws.action === 'reload' || s.ws.mag === 30).toBe(true);
      s.tick(200, { held: BTN.CROUCH });
      expect(s.ws.mag).toBe(30);
      expect(s.ws.mag + s.ws.reserve).toBe(total);
    }
  });

  it('R během sprintu zahájí reload a hráč dál sprintuje; během reloadu se nestřílí', async () => {
    const s = new Shooter(await makeWorld());
    s.tick(10, { held: BTN.FIRE });
    s.tick(20, { moveZ: 1, held: BTN.SPRINT });
    s.tick(1, { moveZ: 1, held: BTN.SPRINT | BTN.RELOAD });
    expect(s.ws.action).toBe('reload');
    s.tick(30, { moveZ: 1, held: BTN.SPRINT });
    expect(s.sim.s.sprinting).toBe(true);
    expect(s.tick(30, { held: BTN.FIRE })).toBe(0);
  });

  it('během sprintu nelze střílet; po sprintu nejdřív sprint-out 0,25 s', async () => {
    const s = new Shooter(await makeWorld());
    s.tick(30, { moveZ: 1, held: BTN.SPRINT });
    expect(s.sim.s.sprinting).toBe(true);
    // LMB požádá o konec sprintu, ale nevystřelí před dokončením sprint-out.
    let first = -1;
    for (let i = 0; i < 40; i++) {
      if (s.tick(1, { moveZ: 1, held: BTN.SPRINT | BTN.FIRE }) && first < 0) first = i;
    }
    expect(first).toBeGreaterThanOrEqual(Math.round(0.25 * 60) - 1);
  });

  it('stejný vstup, seed a konfigurace → stejné výstřely', async () => {
    const a = new Shooter(await makeWorld());
    const b = new Shooter(await makeWorld());
    a.tick(60, { held: BTN.FIRE, lookDYaw: 0.001 });
    b.tick(60, { held: BTN.FIRE, lookDYaw: 0.001 });
    expect(JSON.stringify(a.shots.map((p) => p.vel))).toBe(JSON.stringify(b.shots.map((p) => p.vel)));
  });
});

describe('rozptyl a recoil', () => {
  it('10 000 vzorků zůstane v kuželu; cos(θ) i azimut rovnoměrné', () => {
    const dir = { x: 0.3, y: 0.2, z: -0.93 };
    const l = Math.hypot(dir.x, dir.y, dir.z);
    const d = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    const alpha = (2 * Math.PI) / 180;
    const cosA = Math.cos(alpha);
    const binsC = new Array(10).fill(0), binsP = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) {
      const v = sampleCone(d, alpha, shotRandom(7, i, 0), shotRandom(7, i, 1));
      const c = v.x * d.x + v.y * d.y + v.z * d.z;
      expect(c).toBeGreaterThanOrEqual(cosA - 1e-12);
      binsC[Math.min(9, Math.floor(((1 - c) / (1 - cosA)) * 10))]++;
      binsP[Math.min(9, Math.floor(shotRandom(7, i, 1) * 10))]++;
    }
    for (const b of [...binsC, ...binsP]) expect(Math.abs(b - 1000)).toBeLessThan(120);
  });

  it('krátká dávka zvětší rozptyl, pauza ho obnoví; nehybný ADS leh < nehybný ADS stoj', async () => {
    const s = new Shooter(await makeWorld());
    const t = () => s.sim.s.tick / 60;
    const s0 = spreadOf(PF_RIFLE, MOVEMENT, s.sim.s, s.ws, t()).total;
    s.tick(30, { held: BTN.FIRE });
    const s1 = spreadOf(PF_RIFLE, MOVEMENT, s.sim.s, s.ws, t()).total;
    expect(s1).toBeGreaterThan(s0);
    s.tick(120, {});
    expect(spreadOf(PF_RIFLE, MOVEMENT, s.sim.s, s.ws, t()).total).toBeCloseTo(s0, 6);
    s.tick(1, { held: BTN.ADS });
    s.tick(60, {});
    const standAds = spreadOf(PF_RIFLE, MOVEMENT, s.sim.s, s.ws, t()).total;
    s.tick(1, { held: BTN.PRONE });
    s.tick(120, {});
    expect(s.sim.s.stance).toBe('prone');
    expect(s.ws.adsProgress).toBe(1);
    expect(spreadOf(PF_RIFLE, MOVEMENT, s.sim.s, s.ws, t()).total).toBeLessThan(standAds);
  });

  it('recoil zvedne zamíření; návrat odstraní jen recoil offset (ne vstup myši)', async () => {
    const s = new Shooter(await makeWorld());
    s.tick(30, { held: BTN.FIRE });
    expect(s.ws.recoilPitch).toBeGreaterThan(0);
    const pitch = s.sim.s.pitch;
    s.tick(5 * 60, {});
    expect(s.ws.recoilPitch).toBe(0);
    expect(s.sim.s.pitch).toBe(pitch);
  });
});

describe('projektily', () => {
  it('tenká zeď 0,05 m zastaví střelu i při 650 m/s', async () => {
    const phys = await makeWorld([box([0, 1.5, -30], [6, 3, 0.05])]);
    const list: Projectile[] = [{ key: 'k', owner: 'x', origin: { x: 0, y: 1.5, z: 0 }, pos: { x: 0, y: 1.5, z: 0 }, vel: { x: 0, y: 0, z: -650 }, age: 0 }];
    let ev: ReturnType<typeof stepProjectiles> = [];
    for (let i = 0; i < 20 && list.length; i++) ev = ev.concat(stepProjectiles(list, 1 / 60, PF_RIFLE, phys, []));
    expect(ev.length).toBe(1);
    expect(ev[0].point.z).toBeCloseTo(-29.975, 2);
  });

  it('zásah hitboxu: hlava 2×, končetiny 0,75×, pokles poškození se vzdáleností', async () => {
    expect(damageAt(PF_RIFLE, 10, 'torso')).toBe(30);
    expect(damageAt(PF_RIFLE, 62.5, 'torso')).toBe(25);
    expect(damageAt(PF_RIFLE, 300, 'torso')).toBe(20);
    expect(damageAt(PF_RIFLE, 10, 'head')).toBe(60);
    expect(damageAt(PF_RIFLE, 10, 'limb')).toBe(22.5);
    const t = rayCapsule({ x: 0, y: 1, z: 5 }, { x: 0, y: 0, z: -1 }, 20, { x: 0, y: 0.3, z: 0 }, { x: 0, y: 1.5, z: 0 }, 0.3);
    expect(t).toBeCloseTo(4.7, 6);
  });

  it('zakrytá hlaveň nezasáhne cíl za zdí, i když oči nad zdí vidí', async () => {
    // Zídka 1,5 m těsně před hráčem: oči (1,65) jsou nad ní, ústí v hip (≈1,45) ne.
    const phys = await makeWorld([box([0, 0.75, -0.75], [4, 1.5, 0.3])]);
    const s = new Shooter(phys);
    const fired = s.tick(30, { held: BTN.FIRE });
    expect(fired).toBe(0);
    expect(s.ws.blockReason).toMatch(/hlaveň|překážk/);
  });

  it('ADS: hledí a muška na optické ose (záměrná přímka středem pohledu)', () => {
    const a = adsRoot(PF_RIG);
    const rear = [a[0] + PF_RIG.rearSight[0], a[1] + PF_RIG.rearSight[1]];
    const front = [a[0] + PF_RIG.frontSight[0], a[1] + PF_RIG.frontSight[1]];
    expect(Math.hypot(...rear)).toBeLessThan(1e-9);
    expect(Math.hypot(...front)).toBeLessThan(1e-9);
  });
});

describe('hitbox', () => {
  it('ležící hitbox je vodorovný, stojící svislý', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    const st = hitboxOf('p', sim.s, MOVEMENT);
    expect(st.kind).toBe('vertical');
    sim.run(1, { held: BTN.PRONE });
    sim.run(40, {});
    const pr = hitboxOf('p', sim.s, MOVEMENT);
    expect(pr.kind).toBe('prone');
    expect(Math.abs(pr.a.y - pr.b.y)).toBeLessThan(1e-9);
  });
});
