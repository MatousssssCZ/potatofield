import { DEFAULT_ENVIRONMENT, MAP_SCHEMA_VERSION, type MapDocument, type MapObject, type TerrainData } from '../../shared/map/schema';
import { rng } from '../../shared/math';
import '../index';
import { getAsset, resolveParams } from '../registry';

/**
 * Referenční ulice (krok 6): ~70 m, ověření vzhledu a výkonu stavebnice.
 * Není to čtyřbodová Conquest mapa – tu si autor postaví v editoru.
 * Ulice vede podél osy Z (začátek u z = +5, konec u z = −65).
 */
export function buildStreetMap(): MapDocument {
  const objects: MapObject[] = [];
  let n = 0;
  const add = (assetId: string, pos: [number, number, number], rotY = 0, params: MapObject['params'] = {}, material?: string, name?: string) => {
    const def = getAsset(assetId)!;
    const id = `st_${String(++n).padStart(3, '0')}`;
    objects.push({
      id,
      assetId,
      generatorVersion: def.generatorVersion,
      transform: { position: pos, rotation: [0, rotY, 0] },
      params: resolveParams(def, params),
      seed: (n * 2246822519) >>> 0,
      ...(material ? { material } : {}),
      ...(name ? { editor: { name } } : {}),
    });
    return id;
  };
  const L = -Math.PI / 2; // levá strana: čelo k +X (k ulici)
  const R = Math.PI / 2; // pravá strana: čelo k −X

  // Vozovka s chodníky a křižovatka uprostřed.
  add('street.road', [0, 0, -12], 0, { kind: 'straight', length: 34, width: 7, sidewalk: 2.5 }, undefined, 'Hlavní ulice A');
  add('street.road', [0, 0, -33.5], 0, { kind: 'cross', width: 7, sidewalk: 2.5 }, undefined, 'Křižovatka');
  add('street.road', [0, 0, -51], 0, { kind: 'straight', length: 28, width: 7, sidewalk: 2.5 }, undefined, 'Hlavní ulice B');

  // Levá strana (x < 0).
  add('build.residential', [-10.7, 0, -4], L, { widthMod: 4, depthMod: 3, floors: 3, windows: 'shutters', blank: 'none', recess: 1.4, recessWidth: 2.2 }, 'plasterWarm', 'Dům A');
  add('build.commercial', [-10.7, 0, -21], L, { widthMod: 5, depthMod: 3, floors: 2, signText: 'BAZAR AL-NOOR', blank: 'none' }, 'sandstone', 'Obchody B');
  add('build.hotel', [-12.2, 0, -46.5], L, { widthMod: 6, depthMod: 4, floors: 6, hotelName: 'HOTEL MIRAGE', blank: 'none', recess: 2.2, recessWidth: 5 }, 'plasterWhite', 'Hotel');
  add('build.residential', [-10.7, 0, -62], L, { widthMod: 3, depthMod: 3, floors: 4, windows: 'balcony', blank: 'none' }, 'plasterOchre', 'Dům D');

  // Pravá strana (x > 0).
  add('build.industrial', [12.2, 0, -8], R, { widthMod: 6, depthMod: 4, floors: 1, floorHeight: 6, recess: 2.5, recessWidth: 5 }, 'metalSheet', 'Sklad E');
  add('build.residential', [10.7, 0, -28], R, { widthMod: 4, depthMod: 3, floors: 4, windows: 'shutters', recess: 1.2, recessWidth: 2 }, 'plasterWhite', 'Dům F');
  add('build.commercial', [10.7, 0, -42], R, { widthMod: 4, depthMod: 3, floors: 2, parapet: false, signText: 'CAFÉ NAZIR' }, 'plasterOchre', 'Kavárna G (přístupná střecha)');
  add('build.residential', [10.7, 0, -57], R, { widthMod: 5, depthMod: 3, floors: 3, windows: 'plain' }, 'brick', 'Dům H');

  // Schodiště na střechu kavárny G (střecha 7,0 m) v uličce mezi F a G.
  add('struct.stairs', [7.1, 0, -35.3], -Math.PI / 2, { width: 1.3, height: 7.0, length: 7.2, railing: 'none', solid: false }, 'metal', 'Schody na střechu G');
  // Žebřík na střechu skladu E (atika 6,7 m), z uličky mezi E a F.
  add('struct.ladder', [9.5, 0, -17.1], Math.PI, { height: 6.75, cage: true }, undefined, 'Žebřík na sklad E');

  // Boční ulička 1 (mezi A a B) s přístupným domkem na konci.
  add('small.house', [-19.5, 0, -11.9], L, { width: 4.5, depth: 4.5, entry: 'frontSide' }, 'plasterOchre', 'Domek v uličce');
  add('struct.fence', [-15.4, 0, -14.2], Math.PI / 2, { length: 4, height: 2.1, fill: 'sheet', maxSpacing: 2 });
  add('cover.barrel', [-14, 0, -10.6]);
  add('cover.barrel', [-13.4, 0, -10.2], 0, {}, 'paintedMetalBlue');
  // Ulička 2 (za křižovatkou vlevo) – kontejnery a zeď.
  add('cover.container', [-20, 0, -26], 0.15, {}, 'containerRed');
  add('cover.container', [-20.5, 0, -31.2], -0.05, { doorsOpen: true }, 'containerSand');
  add('struct.wall', [-16, 0, -40], Math.PI / 2, { length: 10, height: 2.6 });

  // Tržiště před obchody B a stánky.
  add('street.stall', [-7.6, 0, -16.5], L, { goods: 'fruit' }, 'awningRed');
  add('street.stall', [-7.6, 0, -20.5], L, { goods: 'cloth' }, 'awningBlue');
  add('street.stall', [-7.6, 0, -24.5], L, { goods: 'crates' }, 'awningSand');
  add('street.sign', [6.6, 0, -40.2], R, { text: 'CAFÉ NAZIR', width: 2, posts: true }, 'paintedMetalRed');
  add('street.sign', [-6.8, 0, -2], L, { text: 'PEKAŘ', width: 1.6, posts: true }, 'paintedMetalBlue');

  // Kryty v ulici (bariéry, pytle, bedny, sudy).
  add('cover.barrier', [-1.8, 0, -29.5], 0.2, { length: 3 });
  add('cover.barrier', [2.2, 0, -31], -0.15, { length: 3 });
  add('cover.sandbags', [0.5, 0, -37.8], 0, { length: 3, rows: 3 });
  add('cover.sandbags', [-4.6, 0.15, -43], Math.PI / 2, { length: 2.5, rows: 2 });
  add('cover.crate', [5.2, 0.15, -14]);
  add('cover.crate', [5.6, 0.15, -15.1], 0.5);
  add('cover.crate', [5.4, 1.15, -14.5], 0.2, {}, 'woodDark');
  add('cover.barrel', [-5.3, 0.15, -52]);
  add('cover.barrel', [-4.8, 0.15, -52.6], 0, {}, 'paintedMetalRed');
  add('struct.lowWall', [4.9, 0.15, -54], Math.PI / 2, { length: 4, height: 0.9 });
  // Kryty ve stylu BF2.
  add('cover.hesco', [-2.5, 0, -60], 0.1, { cells: 4, tiers: 1 });
  add('cover.hedgehog', [2.4, 0, -63]);
  add('cover.hedgehog', [-0.6, 0, -65], 0.7);
  add('cover.carWreck', [2.2, 0.06, -22], 0.25, {});
  add('cover.block', [-2.6, 0.06, -9], 0.3, { size: 'large' });
  add('cover.pipe', [-24, 0, -30], 0.2, { length: 3, diameter: 1.4 });
  add('cover.pallets', [-17.6, 0, -21.5], 0.4, { count: 6 });
  add('cover.rubble', [-13.4, 0, -36], 0, { size: 3 }, 'brick');
  add('cover.dumpster', [-16.4, 0, -9.4], Math.PI / 2);
  add('cover.tires', [-15.6, 0, -14.2], 0, { count: 4 });
  add('cover.spool', [14, 0, -19.5], 0, { lying: true });
  add('cover.sandbagNest', [0, 0.06, -45], Math.PI, { width: 2.5, rows: 4 });
  add('cover.wire', [0, 0, -67], 0, { length: 8 });
  add('small.booth', [8.4, 0.15, 3.2], R, { entry: 'back' }, 'plasterWhite', 'Budka');
  add('struct.fence', [-6.4, 0, 3], -Math.PI / 2 + Math.PI, { length: 6, height: 1.2, fill: 'bars' }, 'paintedMetal');

  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id: 'street_reference',
    name: 'Referenční ulice',
    author: 'Potatofield',
    units: 'meters',
    terrain: streetTerrain(),
    environment: { ...DEFAULT_ENVIRONMENT, sunAzimuthDeg: 235, sunElevationDeg: 52 },
    objects,
    controlPoints: [],
    spawnPoints: [],
    zones: [],
    scenarios: [],
    testSpawn: { position: [1.5, 0.08, 6], rotation: [0, 0, 0] },
  };
}

/** Rovná ulice, mírné nerovnosti v uličkách a kopce za okrajem. Deterministické. */
function streetTerrain(): TerrainData {
  const size = 200, spacing = 2;
  const samples = size / spacing + 1;
  const origin: [number, number] = [-size / 2, -size / 2 - 30];
  const r = rng(99);
  const G = 10;
  const grid = Array.from({ length: G * G }, () => r());
  const noise = (x: number, z: number) => {
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
      const dx = Math.max(Math.abs(x) - 26, 0), dz = Math.max(z - 12, -72 - z, 0);
      const edge = Math.min(1, Math.hypot(dx, dz) / 35);
      let h = edge * edge * (2.5 + noise(x, z) * 8);
      // Test nerovnosti terénu u okraje: mírný val za uličkou 1.
      if (x < -22 && x > -30 && z < -2 && z > -22) h += Math.sin(((z + 2) / 20) * Math.PI) * 0.9 * Math.min(1, (-22 - x) / 3);
      heights.push(Math.round(h * 100) / 100);
    }
  return { samplesX: samples, samplesZ: samples, spacing, origin, heights, baseMaterial: 'sand' };
}
