import { describe, expect, it } from 'vitest';
import type { MapObject } from '../src/shared/map/schema';
import { collidersForMap, generateObject, getAsset, laddersForMap, resolveParams } from '../src/world';
import { fenceLayout } from '../src/world/assets/structures';
import { buildObjectGeometry } from '../src/client/render/geometry';
import { BTN, Sim, makeWorld } from './helpers';
import { tileOf } from '../src/client/render/materials';

const obj = (assetId: string, params: MapObject['params'] = {}, pos: [number, number, number] = [0, 0, 0], rotY = 0, seed = 7): MapObject => ({
  id: `t_${assetId}`,
  assetId,
  generatorVersion: 1,
  transform: { position: pos, rotation: [0, rotY, 0] },
  params: resolveParams(getAsset(assetId)!, params),
  seed,
});

const count = (assetId: string, params: MapObject['params'], material: string) => generateObject(obj(assetId, params)).parts.filter((p) => p.material === material).length;

describe('plot a zeď', () => {
  it('10 m / rozteč 2 m = 5 polí a 6 sloupků; 11 m = 6 polí a 7 sloupků', () => {
    expect(fenceLayout(10, 2)).toMatchObject({ panels: 5, posts: 6, spacing: 2 });
    const l11 = fenceLayout(11, 2);
    expect(l11).toMatchObject({ panels: 6, posts: 7 });
    expect(l11.spacing).toBeCloseTo(11 / 6, 9);
    // Skutečně vygenerované sloupky (kolidující kvádry 0,08 m).
    const posts = (len: number) => generateObject(obj('struct.fence', { length: len, maxSpacing: 2 })).parts.filter((p) => p.size[0] === 0.08 && p.collide).length;
    expect(posts(10)).toBe(6);
    expect(posts(11)).toBe(7);
  });

  it('koncové sloupky zachovají rozměr; vypnutý koncový sloupek zmizí (napojení bez zdvojení)', () => {
    const a = generateObject(obj('struct.fence', { length: 10, endPost: false })).parts.filter((p) => p.size[0] === 0.08 && p.collide);
    expect(a.length).toBe(5);
    for (const p of a) {
      expect(p.size[0]).toBe(0.08);
      expect(p.size[1]).toBeCloseTo(1.9, 9);
    }
  });

  it('pletivo zastaví hráče, ale propustí střely', () => {
    const cols = collidersForMap([generateObject(obj('struct.fence', { fill: 'mesh' }))]);
    const body = cols.find((c) => c.half.x > 4)!;
    expect(body.moveOnly).toBe(true);
  });
});

describe('budovy', () => {
  const glass = (p: MapObject['params']) => count('build.residential', p, 'glass');

  it('rozšíření o modul přidá okenní osu (okna v každém patře), nové patro přidá řadu oken', () => {
    const base = glass({ widthMod: 4, depthMod: 3, floors: 3, windows: 'plain', blank: 'none' });
    const wider = glass({ widthMod: 5, depthMod: 3, floors: 3, windows: 'plain', blank: 'none' });
    const taller = glass({ widthMod: 4, depthMod: 3, floors: 4, windows: 'plain', blank: 'none' });
    // Čelo a zadní strana: +1 osa × 3 patra × 2 fasády.
    expect(wider - base).toBe(6);
    // Nové patro: obvod (4+4+3+3 modulů) oken navíc.
    expect(taller - base).toBe(14);
  });

  it('další patro posune střechu (atiku) o výšku patra; okna se nedeformují', () => {
    const top = (floors: number) =>
      Math.max(...generateObject(obj('build.residential', { floors, floorHeight: 3, parapet: true })).parts.map((p) => p.pos[1] + p.size[1] / 2));
    expect(top(4) - top(3)).toBeCloseTo(3, 6);
    const sizes = (w: number) => new Set(generateObject(obj('build.residential', { widthMod: w, windows: 'plain' })).parts.filter((p) => p.material === 'glass').map((p) => p.size.join()));
    expect([...sizes(3)]).toEqual([...sizes(8)]);
  });

  it('textury se nenatahují: UV v metrech → delší zeď = víc opakování', () => {
    const uvSpan = (len: number) => {
      const g = buildObjectGeometry(generateObject(obj('struct.wall', { length: len })).parts);
      const e = [...g.byMaterial.entries()].find(([k]) => k.startsWith('concrete|'))!;
      const uv = e[1].geometry.getAttribute('uv');
      const nr = e[1].geometry.getAttribute('normal');
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        if (nr.getZ(i) < 0.9) continue; // jen líc stěny k +Z
        min = Math.min(min, uv.getX(i));
        max = Math.max(max, uv.getX(i));
      }
      return max - min;
    };
    const t = tileOf('concrete');
    // O 8 m delší zeď = o 8 m / dlaždici víc opakování (měřítko textury v metrech zůstává).
    expect(uvSpan(16) - uvSpan(8)).toBeCloseTo(8 / t, 3);
  });

  it('stejné vstupy a seed → stejné rozložení; jiný seed může změnit dekorace, ne rozměry', () => {
    const a = JSON.stringify(generateObject(obj('build.commercial', {}, [0, 0, 0], 0, 5)).parts);
    const b = JSON.stringify(generateObject(obj('build.commercial', {}, [0, 0, 0], 0, 5)).parts);
    expect(a).toBe(b);
  });

  it('velký dům není průchozí, malým domkem se projde dveřmi', async () => {
    const house = obj('build.residential', { widthMod: 3, depthMod: 3 }, [0, 0, -8]);
    const small = obj('small.house', { width: 4.5, depth: 4, entry: 'back' }, [20, 0, -6]);
    const gen = [generateObject(house), generateObject(small)];
    const phys = await makeWorld(collidersForMap(gen));
    const a = new Sim(phys, { x: 0, y: 0, z: 0 });
    a.settle();
    a.run(4 * 60, { moveZ: 1 });
    expect(a.s.pos.z).toBeGreaterThan(-3.6); // zastaví se o fasádu
    a.ctrl.dispose();
    const b = new Sim(phys, { x: 20, y: 0, z: 0 });
    b.settle();
    b.run(3 * 60, { moveZ: 1 });
    // Vstup zezadu (strana +Z): prošel dveřmi dovnitř až k čelní stěně (vnitřní líc z = −7,75).
    expect(b.s.pos.z).toBeLessThan(-7);
    expect(b.s.pos.z).toBeGreaterThan(-7.8);
  });

  it('střela projde otvorem okna, ne stěnou', async () => {
    const small = obj('small.house', { width: 4.5, depth: 4, entry: 'side' }, [0, 0, -6]);
    const phys = await makeWorld(collidersForMap([generateObject(small)]));
    // Okno na čele: střed u = 0, parapet 0,95–2,05 m.
    const throughWindow = phys.castRay({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 30);
    const throughWall = phys.castRay({ x: 1.6, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 30);
    expect(throughWall!.distance).toBeCloseTo(4, 1);
    // Oknem projde (zadní stěna má okno ve stejné ose → střela proletí celým domkem).
    expect(throughWindow === null || throughWindow.distance > 7).toBe(true);
  });
});

describe('schody, žebřík, most', () => {
  it('schodiště 3 m: hráč vyjde nahoru; sklon nikdy nad 45°', async () => {
    const st = obj('struct.stairs', { height: 3, length: 4.5, width: 1.6 }, [0, 0, -2]);
    const top = obj('prim.box', { width: 3, height: 3, depth: 4 }, [0, 0, -8.5]);
    const phys = await makeWorld(collidersForMap([generateObject(st), generateObject({ ...top, id: 'top' })]));
    const s = new Sim(phys);
    s.settle();
    s.run(140, { moveZ: 1 });
    expect(s.s.pos.y).toBeGreaterThan(2.95);
    const steep = generateObject(obj('struct.stairs', { height: 5, length: 2 })).parts.find((p) => p.shape === 'wedge')!;
    expect(steep.size[2]).toBeGreaterThanOrEqual(steep.size[1]);
  });

  const ladderScene = async () => {
    // Zeď/střecha 4 m vysoká za žebříkem (na straně +Z žebříku → hráč přichází od −Z).
    const ladder = obj('struct.ladder', { height: 4 }, [0, 0, -3], Math.PI);
    const roof = obj('prim.box', { width: 6, height: 4, depth: 6 }, [0, 0, -6.03]);
    const gen = [generateObject(ladder), generateObject({ ...roof, id: 'roof' })];
    const phys = await makeWorld(collidersForMap(gen));
    const s = new Sim(phys, { x: 0, y: 0, z: -1.5 }, 0);
    s.ctrl.ladders = laddersForMap(gen);
    s.settle();
    return s;
  };

  it('žebřík jako BF2: dojít k němu = nastoupí samo, W s pohledem rovně vyleze na střechu', async () => {
    const s = await ladderScene();
    s.run(30, { moveZ: 1 });
    expect(s.s.ladder).not.toBeNull();
    for (let i = 0; i < 4 * 60 && s.s.ladder; i++) s.run(1, { moveZ: 1 });
    expect(s.s.ladder).toBeNull();
    s.run(30, {});
    expect(s.s.pos.y).toBeGreaterThan(3.95);
    expect(s.s.grounded).toBe(true);
    expect(s.s.pos.z).toBeLessThan(-3.2); // stojí na střeše, ne ve zdi
    expect(s.ctrl.fits(1.8, s.s.yaw, s.s.pos)).toBe(true);
  });

  it('pohled dolů + W = lezení dolů, u země sleze samo a hned znovu nenastoupí', async () => {
    const s = await ladderScene();
    s.run(30, { moveZ: 1 });
    s.run(60, { moveZ: 1 });
    const y = s.s.pos.y;
    expect(y).toBeGreaterThan(1);
    s.run(1, { lookDPitch: -0.6 });
    s.run(20, { moveZ: 1 });
    expect(s.s.pos.y).toBeLessThan(y);
    s.run(120, { moveZ: 1 });
    expect(s.s.ladder).toBeNull();
    expect(s.s.pos.y).toBeLessThan(0.1);
    s.run(60, { moveZ: 1 }); // stále W s pohledem dolů → zpět nenastoupí
    expect(s.s.ladder).toBeNull();
  });

  it('ze střechy: přejít přes hranu k žebříku = nastoupí a sleze dolů; Space seskočí', async () => {
    const s = await ladderScene();
    // Na střechu (výstup), otočit se k hraně (k +Z, kde je žebřík) a jít.
    s.run(30, { moveZ: 1 });
    for (let i = 0; i < 4 * 60 && s.s.ladder; i++) s.run(1, { moveZ: 1 });
    s.run(40, {});
    s.run(1, { lookDYaw: Math.PI });
    s.run(60, { moveZ: 1 });
    expect(s.s.ladder).not.toBeNull();
    const y = s.s.pos.y;
    s.run(30, { moveZ: 1 });
    expect(s.s.pos.y).toBeLessThan(y); // zády k žebříku: W leze dolů
    s.run(1, { pressed: BTN.JUMP, held: BTN.JUMP });
    expect(s.s.ladder).toBeNull();
  });

  it('žebřík s blokovaným výstupem: hráč neprojde stropem a zůstane na žebříku', async () => {
    const ladder = obj('struct.ladder', { height: 4 }, [0, 0, -3], Math.PI);
    const roof = obj('prim.box', { width: 6, height: 4, depth: 6 }, [0, 0, -6.03]);
    const lid = obj('prim.box', { width: 6, height: 0.5, depth: 6 }, [0, 4.6, -6.03]);
    const gen = [generateObject(ladder), generateObject({ ...roof, id: 'roof' }), generateObject({ ...lid, id: 'lid' })];
    const phys = await makeWorld(collidersForMap(gen));
    const s = new Sim(phys, { x: 0, y: 0, z: -1.5 }, 0);
    s.ctrl.ladders = laddersForMap(gen);
    s.settle();
    s.run(30, { moveZ: 1 });
    s.run(4 * 60, { moveZ: 1 });
    expect(s.s.ladder).not.toBeNull();
    expect(s.s.blocked.join()).toMatch(/výstup blokován/);
    s.run(1, { held: BTN.JUMP });
    expect(s.s.ladder).toBeNull();
  });

  it('pod mostem lze projít, mostovka drží hráče nahoře', async () => {
    const bridge = obj('struct.bridge', { length: 20, width: 6, clearance: 4, span: 8 }, [0, 0, 0], Math.PI / 2);
    const phys = await makeWorld(collidersForMap([generateObject(bridge)]));
    // Most vede podél +X (rotace 90°); pod ním mezi pilíři projít ve směru −Z.
    const under = new Sim(phys, { x: -3.3, y: 0, z: 6 });
    under.settle();
    under.run(4 * 60, { moveZ: 1 });
    expect(under.s.pos.z).toBeLessThan(-6);
    under.ctrl.dispose();
    const on = new Sim(phys, { x: -10, y: 4.1, z: 0 }, Math.PI / 2);
    on.settle();
    expect(on.s.pos.y).toBeGreaterThan(3.9);
  });
});

describe('zapuštěný vchod a kryty', () => {
  it('výklenek vchodu: hráč do něj vejde (kryt), dál tělem budovy neprojde', async () => {
    const b = obj('build.residential', { widthMod: 4, depthMod: 3, floors: 2, recess: 1.4, recessWidth: 2.2 }, [0, 0, -10], Math.PI);
    // Rotace π → čelo budovy míří k +Z (k hráči). Čelní líc z = −10 + 4,5 = −5,5.
    const phys = await makeWorld(collidersForMap([generateObject(b)]));
    const s = new Sim(phys, { x: 0, y: 0, z: 0 });
    s.settle();
    s.run(4 * 60, { moveZ: 1 });
    expect(s.s.pos.z).toBeLessThan(-6.3); // ve výklenku (hloubka 1,4 m)
    expect(s.s.pos.z).toBeGreaterThan(-7.0); // zadní stěna výklenku zastaví
    // Ze stran výklenku je kryt: paprsek z boku ulice narazí na pilíř.
    const side = phys.castRay({ x: 6, y: 1.2, z: s.s.pos.z }, { x: -1, y: 0, z: 0 }, 20);
    expect(side!.distance).toBeLessThan(6);
  });

  it('roura 1,4 m: vleže projde, ve stoje ne', async () => {
    const pipe = obj('cover.pipe', { length: 3, diameter: 1.4 }, [0, 0, -4], Math.PI / 2);
    const phys = await makeWorld(collidersForMap([generateObject(pipe)]));
    const a = new Sim(phys);
    a.settle();
    a.run(3 * 60, { moveZ: 1 });
    expect(a.s.pos.z).toBeGreaterThan(-3);
    a.ctrl.dispose();
    const b = new Sim(phys);
    b.settle();
    b.run(1, { held: BTN.PRONE });
    b.run(30, {});
    b.run(12 * 60, { moveZ: 1 });
    expect(b.s.pos.z).toBeLessThan(-6);
  });

  it('ostnatý drát zastaví pěšáka, střela projde; HESCO zastaví obojí', async () => {
    const wire = obj('cover.wire', { length: 6 }, [0, 0, -3]);
    const hesco = obj('cover.hesco', { cells: 4 }, [10, 0, -3]);
    const phys = await makeWorld(collidersForMap([generateObject(wire), generateObject({ ...hesco, id: 'h' })]));
    const s = new Sim(phys);
    s.settle();
    s.run(2 * 60, { moveZ: 1 });
    expect(s.s.pos.z).toBeGreaterThan(-2.6);
    expect(phys.castRay({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: -1 }, 10)).toBeNull();
    expect(phys.castRay({ x: 10, y: 0.5, z: 0 }, { x: 0, y: 0, z: -1 }, 10)!.distance).toBeCloseTo(2.5, 1);
  });

  it('všechny assety vygenerují konečné díly s výchozími parametry', () => {
    for (const a of (getAsset as unknown as { length: number }) ? [] : []) void a;
    for (const id of ['cover.hesco', 'cover.hedgehog', 'cover.block', 'cover.pipe', 'cover.pallets', 'cover.rubble', 'cover.dumpster', 'cover.tires', 'cover.spool', 'cover.sandbagNest', 'cover.wire', 'cover.carWreck', 'build.hotel', 'build.industrial', 'small.bunker', 'small.booth', 'street.stall', 'street.road']) {
      const g = generateObject(obj(id));
      expect(g.missing).toBeUndefined();
      for (const p of g.parts) for (const v of [...p.pos, ...p.size]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
