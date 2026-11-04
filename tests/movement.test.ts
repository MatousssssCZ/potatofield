import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/shared/config/movement';
import { BTN, Sim, box, makeWorld } from './helpers';

const TICK = 60;

describe('základní pohyb', () => {
  it('10 s konstantního W po rozběhu = 40 m ±0,1 m', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.run(30, { moveZ: 1 }); // rozběh
    const z0 = sim.s.pos.z;
    sim.run(10 * TICK, { moveZ: 1 });
    expect(Math.abs(sim.s.pos.z - z0)).toBeGreaterThan(39.9);
    expect(Math.abs(sim.s.pos.z - z0)).toBeLessThan(40.1);
  });

  it('W+D není rychlejší než W (normalizovaná diagonála)', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.run(30, { moveZ: 1, moveX: 1 });
    const p0 = { ...sim.s.pos };
    sim.run(10 * TICK, { moveZ: 1, moveX: 1 });
    const d = Math.hypot(sim.s.pos.x - p0.x, sim.s.pos.z - p0.z);
    expect(d).toBeGreaterThan(39.9);
    expect(d).toBeLessThan(40.1);
  });

  it('vzad je pomalejší (3,2 m/s)', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.run(30, { moveZ: -1 });
    expect(Math.hypot(sim.s.vel.x, sim.s.vel.z)).toBeCloseTo(3.2, 3);
  });

  it('zdí nelze projít ani tenkou 0,05 m', async () => {
    const sim = new Sim(await makeWorld([box([0, 1.5, -3], [6, 3, 0.05])]));
    sim.settle();
    sim.run(5 * TICK, { moveZ: 1, held: BTN.SPRINT });
    expect(sim.s.pos.z).toBeGreaterThan(-3);
  });

  it('schod 0,30 m lze překonat, 0,45 m ne', async () => {
    const phys = await makeWorld([box([0, 0.15, -5], [3, 0.3, 6]), box([10, 0.225, -5], [3, 0.45, 6])]);
    const a = new Sim(phys, { x: 0, y: 0, z: 0 });
    a.settle();
    a.run(2 * TICK, { moveZ: 1 });
    expect(a.s.pos.y).toBeGreaterThan(0.28);
    a.ctrl.dispose();
    const b = new Sim(phys, { x: 10, y: 0, z: 0 });
    b.settle();
    b.run(2 * TICK, { moveZ: 1 });
    expect(b.s.pos.y).toBeLessThan(0.05);
    expect(b.s.pos.z).toBeGreaterThan(-2.1);
  });

  it('na 60° svahu nelze stoupat, na 30° ano', async () => {
    const steep = (60 * Math.PI) / 180;
    const easy = (30 * Math.PI) / 180;
    // Nakloněné desky: začátek u z = −2, stoupají směrem −Z.
    const L = 8;
    const plank = (x: number, ang: number) =>
      box([x, Math.sin(ang) * (L / 2) - 0.1 * Math.cos(ang), -2 - Math.cos(ang) * (L / 2)], [3, 0.2, L], 0, ang);
    const phys = await makeWorld([plank(0, steep), plank(10, easy)]);
    const a = new Sim(phys, { x: 0, y: 0, z: 0 });
    a.settle();
    a.run(4 * TICK, { moveZ: 1 });
    expect(a.s.pos.y).toBeLessThan(0.35);
    a.ctrl.dispose();
    const b = new Sim(phys, { x: 10, y: 0, z: 0 });
    b.settle();
    b.run(2 * TICK, { moveZ: 1 });
    expect(b.s.pos.y).toBeGreaterThan(1.5);
  });
});

describe('výdrž a skok', () => {
  it('plná výdrž = 8 s sprintu ±1 tick', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    let ticks = 0;
    for (let i = 0; i < 20 * TICK; i++) {
      sim.run(1, { moveZ: 1, held: BTN.SPRINT });
      if (sim.s.sprinting) ticks++;
      else if (ticks > 0) break;
    }
    expect(Math.abs(ticks - 8 * TICK)).toBeLessThanOrEqual(1);
  });

  it('diagonální sprint nepřekročí 6 m/s', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.run(TICK, { moveZ: 1, moveX: 1, held: BTN.SPRINT });
    expect(Math.hypot(sim.s.vel.x, sim.s.vel.z)).toBeLessThanOrEqual(6 + 1e-9);
  });

  it('Shift jen s A/D nebo S sprint neaktivuje', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.run(20, { moveX: 1, held: BTN.SPRINT });
    expect(sim.s.sprinting).toBe(false);
    sim.run(20, { moveZ: -1, held: BTN.SPRINT });
    expect(sim.s.sprinting).toBe(false);
  });

  it('výška skoku 0,65 m ±0,03 m a skok při nulové výdrži funguje', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.s.stamina = 0;
    sim.s.sprintLocked = true;
    let maxY = 0;
    sim.run(1, { held: BTN.JUMP });
    for (let i = 0; i < TICK; i++) {
      sim.run(1, {});
      maxY = Math.max(maxY, sim.s.pos.y);
    }
    expect(maxY).toBeGreaterThan(0.62);
    expect(maxY).toBeLessThan(0.68);
    expect(sim.s.grounded).toBe(true);
  });

  it('opakované skákání nezvyšuje horizontální rychlost', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.s.stamina = 100;
    sim.run(30, { moveZ: 1 });
    let maxH = 0;
    for (let j = 0; j < 8; j++) {
      sim.run(1, { moveZ: 1, moveX: j % 2 ? 1 : -1, held: BTN.JUMP });
      for (let i = 0; i < 40; i++) {
        sim.run(1, { moveZ: 1, moveX: j % 2 ? 1 : -1 });
        maxH = Math.max(maxH, Math.hypot(sim.s.vel.x, sim.s.vel.z));
      }
    }
    expect(maxH).toBeLessThanOrEqual(MOVEMENT.speedForward + 1e-6);
  });

  it('skok vyžaduje nový stisk (držený Space skáče jen jednou)', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    let jumps = 0;
    let prevVy = 0;
    for (let i = 0; i < 3 * TICK; i++) {
      sim.run(1, { held: BTN.JUMP });
      if (sim.s.vel.y > 1 && prevVy <= 0) jumps++;
      prevVy = sim.s.vel.y;
    }
    expect(jumps).toBe(1);
  });
});

describe('postoje', () => {
  it('pod nízkým stropem nelze vstát; po odchodu se stoj obnoví jen se záměrem', async () => {
    // Strop ve výšce 1,4 m nad oblastí z ∈ (−6, −2).
    const sim = new Sim(await makeWorld([box([0, 1.4 + 0.25, -4], [4, 0.5, 4])]));
    sim.settle();
    sim.run(30, { held: BTN.CROUCH });
    expect(sim.s.height).toBeCloseTo(1.2, 3);
    sim.run(90, { moveZ: 1, held: BTN.CROUCH });
    expect(sim.s.pos.z).toBeLessThan(-2.5);
    expect(sim.s.pos.z).toBeGreaterThan(-5.5);
    // Pustí Ctrl pod stropem → zůstane v dřepu.
    sim.run(30, {});
    expect(sim.s.stance).toBe('crouch');
    expect(sim.s.blocked.join()).toMatch(/stoj/);
    // Vyjde ven se záměrem stát → vstane.
    sim.run(120, { moveZ: 1 });
    expect(sim.s.pos.z).toBeLessThan(-6.3);
    expect(sim.s.stance).toBe('stand');
    expect(sim.s.height).toBeCloseTo(1.8, 3);
  });

  it('nízkou mezerou nelze projít ve stoje', async () => {
    const sim = new Sim(await makeWorld([box([0, 1.4 + 0.25, -4], [4, 0.5, 4])]));
    sim.settle();
    sim.run(3 * TICK, { moveZ: 1 });
    expect(sim.s.pos.z).toBeGreaterThan(-2.05);
  });

  it('leh je blokován 0,30 s po dopadu a hlásí důvod', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.run(1, { held: BTN.JUMP });
    // Čekat do dopadu.
    for (let i = 0; i < TICK && !(sim.s.grounded && sim.s.tick * (1 / 60) - sim.s.lastLandAt < 0.05); i++) sim.run(1, {});
    expect(sim.s.grounded).toBe(true);
    sim.run(1, { held: BTN.PRONE });
    expect(sim.s.stance).not.toBe('prone');
    expect(sim.s.blocked.join()).toMatch(/dopadu/);
    // Toggle zůstává; po uplynutí blokace zaleh.
    sim.run(30, {});
    expect(sim.s.stance).toBe('prone');
  });

  it('ležící tělo nelze otočit do zdi', async () => {
    // Zeď 0,8 m vlevo od hráče, rovnoběžná s osou Z.
    const sim = new Sim(await makeWorld([box([-0.8, 1, 0], [0.2, 2, 6])]));
    sim.settle();
    sim.run(1, { held: BTN.PRONE });
    sim.run(40, {});
    expect(sim.s.stance).toBe('prone');
    expect(sim.s.height).toBeCloseTo(0.5, 3);
    // Otočit pohled o 90° doleva → tělo by trčelo do zdi.
    sim.run(1, { lookDYaw: Math.PI / 2 });
    sim.run(60, {});
    expect(Math.abs(sim.s.bodyYaw)).toBeLessThan(Math.PI / 2 - 0.2);
    expect(sim.ctrl.fits(sim.s.height, sim.s.bodyYaw, sim.s.pos)).toBe(true);
  });

  it('do lehu nelze zalehnout těsně u zdi před sebou', async () => {
    const sim = new Sim(await makeWorld([box([0, 1, -0.6], [4, 2, 0.2])]));
    sim.settle();
    sim.run(1, { held: BTN.PRONE });
    sim.run(30, {});
    expect(sim.s.stance).not.toBe('prone');
  });

  it('Space v dřepu jen vstane, neskočí', async () => {
    const sim = new Sim(await makeWorld());
    sim.settle();
    sim.run(30, { held: BTN.CROUCH });
    sim.run(1, { held: BTN.CROUCH | BTN.JUMP });
    sim.run(30, { held: BTN.CROUCH });
    expect(sim.s.stance).toBe('stand');
    expect(sim.s.pos.y).toBeLessThan(0.05);
  });
});

describe('terén a hrany', () => {
  it('sestup z 30° svahu drží kontakt se zemí, ze srázu hráč spadne a dopadne', async () => {
    const ang = (30 * Math.PI) / 180;
    const L = 8;
    // Svah klesá směrem −Z z výšky 4 m na 0; nahoře plošina.
    const phys = await makeWorld([
      box([0, 4 - 0.5, 3], [3, 1, 6]),
      box([0, Math.sin(ang) * (L / 2) - 0.1 * Math.cos(ang), -Math.cos(ang) * (L / 2)], [3, 0.2, L], Math.PI, -ang),
      box([10, 1.5, 3], [3, 3, 6]),
    ]);
    const a = new Sim(phys, { x: 0, y: 4.05, z: 3 });
    a.settle();
    let airborne = 0;
    for (let i = 0; i < 200; i++) {
      a.run(1, { moveZ: 1 });
      if (a.s.pos.y > 0.1 && a.s.pos.y < 3.9 && !a.s.grounded) airborne++;
    }
    expect(a.s.pos.y).toBeLessThan(0.1);
    expect(airborne).toBeLessThan(4);
    a.ctrl.dispose();
    const b = new Sim(phys, { x: 10, y: 3.05, z: 3 });
    b.settle();
    b.run(90, { moveZ: 1 });
    expect(b.s.pos.y).toBeLessThan(0.05);
    expect(b.s.grounded).toBe(true);
    expect(b.s.lastLandSpeed).toBeGreaterThan(5);
  });

  it('velký kvádr se pro kolize dělí a nedá se jím propadnout', async () => {
    const { partsToColliders } = await import('../src/world/parts');
    const obj = { id: 'big', assetId: 'prim.box', generatorVersion: 1, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, params: {}, seed: 1 };
    const cols = partsToColliders(obj, [{ shape: 'box', pos: [0, 1, 0], size: [100, 2, 60], material: 'concrete', collide: true }]);
    expect(cols.length).toBeGreaterThan(1);
    for (const c of cols) expect(Math.max(c.half.x, c.half.y, c.half.z)).toBeLessThanOrEqual(12);
    const phys = await makeWorld(cols);
    const s = new Sim(phys, { x: 3, y: 2.05, z: 3 });
    s.run(5 * 60, { moveZ: 1, moveX: 1 });
    expect(s.s.pos.y).toBeGreaterThan(1.95);
  });
});
