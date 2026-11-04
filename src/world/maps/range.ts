import { DEFAULT_ENVIRONMENT, MAP_SCHEMA_VERSION, type MapDocument, type MapObject, type TerrainData } from '../../shared/map/schema';
import { rng } from '../../shared/math';

/**
 * Technická střelnice (krok 1). Malá referenční scéna nad stejným mapovým
 * formátem jako editor. Není to Conquest mapa.
 *
 * Osa střelby: hráč na palebné čáře z = 0 míří k −Z. Pohybový okruh je vpravo (+X).
 */
export function buildRangeMap(): MapDocument {
  const objects: MapObject[] = [];
  let n = 0;
  const add = (
    assetId: string,
    pos: [number, number, number],
    params: MapObject['params'] = {},
    opts: { rotY?: number; material?: string; scale?: number; name?: string } = {},
  ) => {
    const id = `obj_${String(++n).padStart(3, '0')}`;
    objects.push({
      id,
      assetId,
      generatorVersion: 1,
      transform: { position: pos, rotation: [0, opts.rotY ?? 0, 0], ...(opts.scale ? { scale: opts.scale } : {}) },
      params,
      seed: (n * 2654435761) >>> 0,
      ...(opts.material ? { material: opts.material } : {}),
      ...(opts.name ? { editor: { name: opts.name } } : {}),
    });
    return id;
  };

  // --- Palebné stanoviště ---
  add('prim.box', [0, 0, 3.5], { width: 14, height: 0.12, depth: 7 }, { material: 'concrete', name: 'Plocha stanoviště' });
  add('prim.box', [0, 0, 0.15], { width: 14, height: 0.9, depth: 0.3 }, { material: 'concreteLight', name: 'Palebná zídka' });
  for (const x of [-4.5, -1.5, 1.5, 4.5]) add('prim.box', [x, 0.9, 0.15], { width: 0.12, height: 0.25, depth: 0.3 }, { material: 'paintedMetal' });
  add('prim.box', [-7.2, 0, 3.5], { width: 0.4, height: 2.6, depth: 7 }, { material: 'concrete' });
  add('prim.box', [7.2, 0, 3.5], { width: 0.4, height: 2.6, depth: 7 }, { material: 'concrete' });
  // Stříška nad stanovištěm (stín, hloubka scény)
  for (const x of [-6.8, 6.8]) for (const z of [0.6, 6.4]) add('prim.cylinder', [x, 0.12, z], { diameter: 0.2, height: 2.9 }, { material: 'paintedMetal' });
  add('prim.box', [0, 3.02, 3.5], { width: 14.6, height: 0.12, depth: 7.4 }, { material: 'paintedMetal', name: 'Stříška' });

  // --- Dráha: metrové čáry a cedule ---
  for (let d = 5; d <= 100; d += 5) {
    add('range.meterLine', [0, 0, -d], { width: 12, major: d % 25 === 0 });
  }
  for (const d of [10, 25, 50, 75, 100]) add('range.sign', [-6.8, 0, -d], { text: `${d} m` }, { rotY: 0 });

  // --- Terče ---
  add('range.target', [-3, 0, -10]);
  add('range.target', [0, 0, -25]);
  add('range.target', [3, 0, -50]);
  add('range.target', [0, 0, -100]);
  add('range.target', [0, 0, -35], { moving: true, amplitude: 4, speed: 2.5 });
  // Krytí terčů pytli s pískem.
  add('cover.sandbags', [-3, 0, -9.2], { length: 1.5, rows: 2 });
  add('cover.sandbags', [3, 0, -49.2], { length: 1.5, rows: 2 });

  // Boční zídky dráhy (s průchody).
  for (const side of [-1, 1]) {
    add('prim.box', [side * 8, 0, -22], { width: 0.3, height: 1.1, depth: 36 }, { material: 'concreteLight' });
    add('prim.box', [side * 8, 0, -72], { width: 0.3, height: 1.1, depth: 52 }, { material: 'concreteLight' });
  }

  // --- Pohybový okruh (+X) ---
  // Schody 0,15 / 0,30 / 0,45 m
  const steps: Array<[number, number]> = [
    [0.15, 16],
    [0.3, 20],
    [0.45, 24],
  ];
  for (const [h, x] of steps) {
    add('prim.box', [x, 0, -6], { width: 3, height: h, depth: 4 }, { material: 'concrete', name: `Schod ${h} m` });
    add('range.sign', [x - 1.9, 0, -3.6], { text: `${Math.round(h * 100)} cm` });
  }
  // Svahy 30 / 45 / 60° s plošinou nahoře
  const slopes: Array<[number, number]> = [
    [30, 32],
    [45, 38],
    [60, 44],
  ];
  for (const [a, x] of slopes) {
    const L = 4;
    const h = L * Math.tan((a * Math.PI) / 180);
    add('prim.ramp', [x, 0, -6], { width: 4, length: L, angleDeg: a }, { rotY: Math.PI, material: 'concrete', name: `Svah ${a}°` });
    add('prim.box', [x, 0, -9.5], { width: 4, height: h, depth: 3 }, { material: 'concrete' });
    add('range.sign', [x - 2.4, 0, -3.6], { text: `${a}°` });
  }
  // Nízké průchody: dřep (strop 1,45 m) a leh (0,75 m)
  const tunnel = (x: number, clear: number, label: string) => {
    for (const side of [-1, 1]) add('prim.box', [x + side * 1.15, 0, -7], { width: 0.3, height: clear + 0.3, depth: 6 }, { material: 'brick' });
    add('prim.box', [x, clear, -7], { width: 2.6, height: 0.3, depth: 6 }, { material: 'concrete', name: label });
    add('range.sign', [x - 1.9, 0, -3.6], { text: label });
  };
  tunnel(51, 1.45, 'dřep');
  tunnel(57, 0.75, 'leh');

  // Zdi a rohy, tenká zeď 5 cm
  add('prim.box', [20, 0, -20], { width: 8, height: 3, depth: 0.3 }, { material: 'plasterWarm' });
  add('prim.box', [16.15, 0, -23], { width: 0.3, height: 3, depth: 6 }, { material: 'plasterWarm' });
  add('prim.box', [24, 0, -26], { width: 0.3, height: 3, depth: 6 }, { material: 'plaster', rotY: Math.PI / 4 });
  add('prim.box', [30, 0, -22], { width: 4, height: 2.5, depth: 0.05 }, { material: 'paintedMetal', name: 'Tenká zeď 5 cm' });
  add('range.sign', [30, 0, -20.5], { text: '5 cm' });

  // Schodiště na plošinu se zábradlím (přístupná "střecha")
  const rise = 0.2, run = 0.3, count = 15;
  for (let i = 0; i < count; i++) {
    add('prim.box', [42, 0, -20 - i * run], { width: 1.6, height: rise * (i + 1), depth: run }, { material: 'concreteLight' });
  }
  const topH = rise * count;
  add('prim.box', [43.5, 0, -27.5], { width: 6, height: topH, depth: 6 }, { material: 'sandstone', name: 'Plošina' });
  add('prim.box', [43.5, topH, -30.35], { width: 6, height: 1, depth: 0.3 }, { material: 'sandstone' });
  add('prim.box', [46.35, topH, -27.5], { width: 0.3, height: 1, depth: 6 }, { material: 'sandstone' });

  // Kryty kolem stanoviště a okruhu
  add('cover.barrier', [-3, 0, -4], { length: 3 }, { rotY: 0.1 });
  add('cover.barrier', [3.5, 0, -15], { length: 3 }, { rotY: -0.2 });
  add('cover.crate', [12, 0, 2]);
  add('cover.crate', [13.1, 0, 2.2], {}, { rotY: 0.4 });
  add('cover.crate', [12.5, 1, 2.1], {}, { rotY: 0.15, scale: 0.8 });
  add('cover.barrel', [11, 0, 4]);
  add('cover.barrel', [11.7, 0, 4.4], {}, { material: 'paintedMetalBlue' });
  add('cover.barrel', [10.9, 0, 4.9], {}, { material: 'paintedMetalRed' });
  add('cover.sandbags', [26, 0, 4], { length: 4, rows: 3 });
  add('cover.barrier', [34, 0, 4], { length: 4 });

  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id: 'range_technical',
    name: 'Technická střelnice',
    author: 'Potatofield',
    units: 'meters',
    terrain: rangeTerrain(),
    environment: { ...DEFAULT_ENVIRONMENT },
    objects,
    controlPoints: [],
    spawnPoints: [],
    zones: [],
    scenarios: [],
    testSpawn: { position: [0, 0.15, 3.5], rotation: [0, 0, 0] },
  };
}

/** Rovná plocha střelnice, val za terči a mírné duny po okrajích. Deterministické. */
function rangeTerrain(): TerrainData {
  const size = 260, spacing = 2;
  const samples = size / spacing + 1;
  const origin: [number, number] = [-size / 2 + 30, -size / 2 - 40];
  const r = rng(1234);
  // Hrubá mřížka náhodných hodnot pro duny.
  const G = 12;
  const grid = Array.from({ length: G * G }, () => r());
  const dune = (x: number, z: number) => {
    const gx = ((x - origin[0]) / size) * (G - 1), gz = ((z - origin[1]) / size) * (G - 1);
    const xi = Math.min(G - 2, Math.floor(gx)), zi = Math.min(G - 2, Math.floor(gz));
    const fx = gx - xi, fz = gz - zi;
    const s = (t: number) => t * t * (3 - 2 * t);
    const a = grid[zi * G + xi], b = grid[zi * G + xi + 1], c = grid[(zi + 1) * G + xi], d = grid[(zi + 1) * G + xi + 1];
    return a + (b - a) * s(fx) + (c - a) * s(fz) + (a - b - c + d) * s(fx) * s(fz);
  };
  const heights: number[] = [];
  for (let iz = 0; iz < samples; iz++)
    for (let ix = 0; ix < samples; ix++) {
      const x = origin[0] + ix * spacing, z = origin[1] + iz * spacing;
      // Vzdálenost od hratelné plochy (obdélník x ∈ [−15, 65], z ∈ [−105, 15]).
      const dx = Math.max(-15 - x, 0, x - 65), dz = Math.max(-105 - z, 0, z - 15);
      const edge = Math.min(1, Math.hypot(dx, dz) / 40);
      let h = edge * edge * (2 + dune(x, z) * 9);
      // Val za terči (z ≈ −112), přes šířku dráhy.
      const berm = Math.exp(-((z + 113) ** 2) / 30) * (1 - Math.min(1, Math.max(0, Math.abs(x) - 14) / 20));
      h += berm * 6;
      heights.push(Math.round(h * 100) / 100);
    }
  return { samplesX: samples, samplesZ: samples, spacing, origin, heights, baseMaterial: 'sand' };
}
