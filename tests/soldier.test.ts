import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSkeleton } from '../src/client/render/soldier/rig';
import { SoldierAnimator, type AnimInput } from '../src/client/render/soldier/animator';
import { buildSoldierGeometry, SOLDIER_LODS } from '../src/client/render/soldier/body';
import { soldierLook } from '../src/client/render/soldier';

const wf = { gripRight: new THREE.Vector3(0, -0.075, 0.075), gripLeft: new THREE.Vector3(0, 0, -0.27), magazineSocket: new THREE.Vector3(0, -0.035, -0.04), stockZ: 0.36 };
function rig() {
  const { bones, byName } = createSkeleton();
  const root = new THREE.Group();
  root.add(bones[0]);
  const weapon = new THREE.Object3D();
  return { root, weapon, anim: new SoldierAnimator(byName), byName };
}
const base = (o: Partial<AnimInput> = {}): AnimInput => ({
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, bodyYaw: 0, height: 1.8, grounded: true, sprinting: false, ads: 0,
  action: 'idle', actionStart: 0, actionEnd: 0, shotSeq: 0, life: 'alive', seed: 1, ...o,
});
const run = (r: ReturnType<typeof rig>, inp: AnimInput, sec: number, t0 = 0) => {
  for (let t = 0; t < sec; t += 1 / 60) r.anim.update(inp, t0 + t, 1 / 60, r.root, r.weapon, wf);
};
const deg = (d: number) => (d * Math.PI) / 180;

describe('voják – animační pravidla', () => {
  it('na místě: pohled do 35° pánev nepřetočí, od 45° přešlap za pohledem', () => {
    const r = rig();
    run(r, base({ yaw: 0 }), 0.2);
    run(r, base({ yaw: deg(30) }), 1);
    expect(Math.abs(r.anim.pelvisYaw)).toBeLessThan(1e-6);
    run(r, base({ yaw: deg(60) }), 2);
    expect(Math.abs(r.anim.pelvisYaw - deg(60))).toBeLessThan(deg(6));
  });

  it('přetočení přes ±180° jde nejkratší cestou', () => {
    const r = rig();
    run(r, base({ yaw: deg(170) }), 3);
    const before = r.anim.pelvisYaw;
    let maxStep = 0, prev = before;
    for (let i = 0; i < 120; i++) {
      r.anim.update(base({ yaw: deg(-170) }), i / 60, 1 / 60, r.root, r.weapon, wf);
      const d = Math.abs(Math.atan2(Math.sin(r.anim.pelvisYaw - prev), Math.cos(r.anim.pelvisYaw - prev)));
      maxStep = Math.max(maxStep, d);
      prev = r.anim.pelvisYaw;
    }
    // Rozdíl 20° (ne 340°) – pod prahem přešlapu se pánev vůbec nemusí otočit; nikdy ne dlouhou cestou.
    expect(maxStep).toBeLessThan(deg(10));
  });

  it('přebití: fáze z času simulace (pozdě připojený klient vidí správnou fázi, ne začátek)', () => {
    const r = rig();
    run(r, base(), 0.2);
    r.anim.update(base({ action: 'reload', actionStart: 10, actionEnd: 12.4 }), 11.2, 1 / 60, r.root, r.weapon, wf);
    expect(r.anim.layers.upper).toMatch(/přebití 50 %/);
  });

  it('výstřel: impulz jen při zvýšení shotSeq (duplicitní snapshot nic nepřehraje)', () => {
    const r = rig();
    run(r, base({ shotSeq: 5 }), 0.1);
    r.anim.fired = false;
    run(r, base({ shotSeq: 5 }), 0.2);
    expect(r.anim.fired).toBe(false);
    run(r, base({ shotSeq: 6 }), 0.02);
    expect(r.anim.fired).toBe(true);
  });

  it('vyřazení → oživení: tělo leží, po oživení se vrátí bez nového životního cyklu; zbraň skrytá jen při ležení', () => {
    const r = rig();
    run(r, base(), 0.2);
    run(r, base({ life: 'downed' }), 1);
    expect(r.byName.pelvis.position.y).toBeLessThan(0.3);
    expect(r.weapon.visible).toBe(false);
    run(r, base({ life: 'alive' }), 1);
    expect(r.byName.pelvis.position.y).toBeGreaterThan(0.8);
    expect(r.weapon.visible).toBe(true);
  });

  it('dřep sníží pánev ohnutím nohou, ne zmenšením modelu', () => {
    const r = rig();
    run(r, base({ height: 1.2 }), 0.5);
    expect(r.byName.pelvis.position.y).toBeLessThan(0.7);
    r.root.updateMatrixWorld(true);
    const s = new THREE.Vector3();
    r.byName.pelvis.getWorldScale(s);
    expect(s.x).toBeCloseTo(1, 6);
    // Chodidla zůstávají u země.
    const foot = r.byName.footL.getWorldPosition(new THREE.Vector3());
    expect(foot.y).toBeLessThan(0.15);
  });
});

describe('voják – modely a rozpočty', () => {
  it('všech 8 vzhledů: LOD0 ≤ 8 000, LOD1 ≤ 4 000, LOD2 ≤ 1 500 trojúhelníků, 2 materiály, ≤ 4 vlivy na vertex', () => {
    for (const f of ['usmc', 'mec'] as const)
      for (const v of ['base', 'assault', 'medic', 'sniper'] as const) {
        const t = SOLDIER_LODS.map((l) => buildSoldierGeometry(f, v, l));
        const n = t.map((g) => g.getAttribute('position').count / 3);
        expect(n[0], `${f}/${v}`).toBeLessThanOrEqual(8000);
        expect(n[1]).toBeLessThanOrEqual(4000);
        expect(n[2]).toBeLessThanOrEqual(1500);
        expect(t[0].groups).toHaveLength(2);
        expect(t[0].getAttribute('skinIndex').itemSize).toBe(4);
      }
  });

  it('vzhled podle frakce + classy (ne jen classy): USMC Medic nedostane MEC uniformu, Assault nedostane kapuci', () => {
    expect(soldierLook('m16a2', 'teamA')).toEqual({ faction: 'usmc', variant: 'medic' });
    expect(soldierLook('akm', 'teamB')).toEqual({ faction: 'mec', variant: 'medic' });
    expect(soldierLook('m4a1', 'teamA')).toEqual({ faction: 'usmc', variant: 'assault' });
    expect(soldierLook('pkm', 'teamB')).toEqual({ faction: 'mec', variant: 'base' }); // Support = frakční základ
    expect(soldierLook('svd', 'teamB')).toEqual({ faction: 'mec', variant: 'sniper' });
  });
});
