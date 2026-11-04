import { describe, expect, it } from 'vitest';
import { EditorDoc, History } from '../src/client/editor/editorDoc';
import { buildEmptyMap } from '../src/world/maps/empty';
import { applyBrush, heightAt, readRegion, slopeDeg, unionRegion, type Region } from '../src/world/terrain';
import { PhysicsWorld } from '../src/shared/physics/world';
import { validateMap } from '../src/shared/map/validate';
import { Sim } from './helpers';

function stroke(ed: EditorDoc, h: History, brush: Parameters<typeof applyBrush>[1], x: number, z: number, frames: number, dt: number) {
  const t = ed.doc.terrain;
  const full = t.heights.slice();
  let reg: Region | null = null;
  for (let i = 0; i < frames; i++) reg = unionRegion(reg, applyBrush(t, brush, x, z, dt));
  const after = readRegion(t, reg!);
  const before = readRegion({ ...t, heights: full }, reg!);
  h.execute({ label: 'tah', changes: [{ kind: 'terrain', region: reg!, before, after }] });
}

describe('terén', () => {
  it('tah štětcem nezávisí na FPS (stejný čas = stejný výsledek)', () => {
    const a = buildEmptyMap('a', 64, 1).terrain, b = buildEmptyMap('b', 64, 1).terrain;
    for (let i = 0; i < 30; i++) applyBrush(a, { kind: 'raise', radius: 5, strength: 2 }, 0, 0, 1 / 30);
    for (let i = 0; i < 144; i++) applyBrush(b, { kind: 'raise', radius: 5, strength: 2 }, 0, 0, 1 / 144);
    expect(heightAt(a, 0, 0)!).toBeCloseTo(2, 2);
    expect(Math.abs(heightAt(a, 0, 0)! - heightAt(b, 0, 0)!)).toBeLessThan(0.01);
  });

  it('úprava terénu mění kontakt hráče i zásah střely; jeden tah = jedno undo, které vrací obojí', async () => {
    const ed = new EditorDoc(buildEmptyMap('t', 64, 1));
    const h = new History(ed);
    const phys = await PhysicsWorld.create();
    phys.setTerrain(ed.doc.terrain);
    ed.onChange((changes) => {
      if (changes.some((c) => c.kind === 'terrain')) phys.setTerrain(ed.doc.terrain);
    });
    stroke(ed, h, { kind: 'raise', radius: 6, strength: 1.5 }, 0, 0, 60, 1 / 60);
    const ray = () => phys.castRay({ x: 0, y: 20, z: 0 }, { x: 0, y: -1, z: 0 }, 50)!.point.y;
    expect(ray()).toBeCloseTo(1.5, 1);
    const s = new Sim(phys, { x: 0, y: 3, z: 0 });
    s.run(90, {});
    expect(s.s.grounded).toBe(true);
    expect(s.s.pos.y).toBeCloseTo(1.5, 1);
    s.ctrl.dispose();
    h.undo();
    expect(ray()).toBeCloseTo(0, 3);
    h.redo();
    expect(ray()).toBeCloseTo(1.5, 1);
  });

  it('srovnání, vyhlazení a malba; validní mapa po úpravách', () => {
    const t = buildEmptyMap('t', 64, 1).terrain;
    for (let i = 0; i < 60; i++) applyBrush(t, { kind: 'raise', radius: 4, strength: 5 }, 0, 0, 1 / 60);
    for (let i = 0; i < 120; i++) applyBrush(t, { kind: 'flatten', radius: 6, strength: 3, target: 1 }, 0, 0, 1 / 60);
    expect(heightAt(t, 0, 0)!).toBeCloseTo(1, 1);
    for (let i = 0; i < 60; i++) applyBrush(t, { kind: 'paintDirt', radius: 3, strength: 2 }, 5, 5, 1 / 60);
    expect(t.dirt!.some((v) => v > 0.9)).toBe(true);
    const doc = buildEmptyMap('t', 64, 1);
    doc.terrain = t;
    expect(validateMap(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  });

  it('svah se počítá pro debug zobrazení (nic se nevyrovnává)', () => {
    const t = buildEmptyMap('t', 16, 1).terrain;
    for (let iz = 0; iz < t.samplesZ; iz++) for (let ix = 0; ix < t.samplesX; ix++) t.heights[iz * t.samplesX + ix] = ix * 2;
    expect(slopeDeg(t, 5, 5)).toBeCloseTo(63.4, 0);
  });
});
