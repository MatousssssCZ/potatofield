import { DEFAULT_ENVIRONMENT, MAP_SCHEMA_VERSION, makeFlatTerrain, type MapDocument, type MapObject } from '../../shared/map/schema';
import { resolveParams, getAsset } from '../registry';

/**
 * Skladová osada – testovací scéna vertikálního řezu (etapa 2): B01 dům (uzavřený i průchozí),
 * B08 hala s průjezdem, R01 asfalt a R03 hlína, F01 pletivo kolem dvora, F04 omítaná zeď ve svahu,
 * T05 balvany, G02 obsazovací bod A a G03 spawny obou týmů. Sever = −Z.
 * Rozměry jsou výchozí hodnoty blockoutu, ne měření reference.
 */
export const SLICE_SIZE = 128;

/** Terén: rovina vesnice, mírný svah k jihozápadu (test plotu ve svahu). */
export function sliceHeight(x: number, z: number): number {
  const south = Math.max(0, z - 8) * 0.1;
  const west = Math.max(0, -x - 20) * 0.04;
  return Math.round((south + west * Math.min(1, Math.max(0, z / 20))) * 100) / 100;
}

export function buildOsadaSliceMap(): MapDocument {
  const terrain = makeFlatTerrain(SLICE_SIZE, SLICE_SIZE, 1);
  for (let iz = 0; iz < terrain.samplesZ; iz++)
    for (let ix = 0; ix < terrain.samplesX; ix++) terrain.heights[iz * terrain.samplesX + ix] = sliceHeight(terrain.origin[0] + ix, terrain.origin[1] + iz);
  const objects: MapObject[] = [];
  let n = 0;
  const add = (assetId: string, pos: [number, number, number], yaw: number, params: MapObject['params'], name: string, material?: string) => {
    const def = getAsset(assetId)!;
    objects.push({
      id: `os_${String(++n).padStart(3, '0')}`,
      assetId,
      generatorVersion: 1,
      transform: { position: [pos[0], sliceHeight(pos[0], pos[2]) + pos[1], pos[2]], rotation: [0, yaw, 0] },
      params: resolveParams(def, params),
      seed: (n * 2654435761) >>> 0,
      ...(material ? { material } : {}),
      editor: { name },
    });
  };
  // Cesty: hlavní asfaltka západ–východ, hliněná odbočka na jih (budoucí obchvat).
  add('osada.road', [-58, 0, 0], 0, { points: '0,0;30,2;62,-1;116,0', width: 6, surface: 'asphalt' }, 'R01 Hlavní cesta');
  add('osada.road', [12, 0, 3], 0, { points: '0,0;4,18;-6,40;-20,56', width: 4.5, surface: 'dirt', shoulder: 0.5 }, 'R03 Hliněná cesta na jih');
  // Domy u návsi: uzavřený (dveře k cestě) a průchozí.
  add('osada.house', [-24, 0, -13], 0, { length: 8, depth: 7, doorWall: 'back', doorAt: 4 }, 'B01 Dům uzavřený');
  add('osada.house', [-12, 0, -14], 0, { length: 10, depth: 7, doorWall: 'back', doorAt: 5, interior: 'walk', windowFill: 'bars' }, 'B01 Dům průchozí', 'plasterOchre');
  add('osada.house', [-30, 0, 6], 0, { length: 14, depth: 7, doorWall: 'front', doorAt: 3.5, doorLock: true }, 'B01 Dlouhý dům (zamčené dveře)', 'plaster');
  // Hala s průjezdem (vrata k cestě i dozadu) a pletivo kolem dvora.
  add('osada.hall', [8, 0, -34], 0, { length: 24, width: 14, gateWall: 'back', gateAt: 15, through: true }, 'B08 Skladová hala');
  add('osada.fence', [4, 0, -38], 0, { points: '0,0;32,0;32,22;28,22', kind: 'chainlink', height: 2 }, 'F01 Pletivo kolem dvora');
  // Omítaná zeď zahrady ve svahu (stupňovaná) a kopírující pletivo vedle.
  add('osada.fence', [-40, 0, 16], 0, { points: '0,0;16,0;16,14', kind: 'plaster', height: 1.8, slope: 'step', spacing: 4 }, 'F04 Zahradní zeď (stupně)');
  add('osada.fence', [-22, 0, 16], 0, { points: '0,0;0,14;-6,20', kind: 'chainlink', height: 1.6, slope: 'copy' }, 'F01 Pletivo ve svahu (sklon)');
  // Balvany na svahu (kryt u hliněné cesty).
  for (const [i, [x, z, s]] of ([[2, 22, 1.4], [5, 30, 2.2], [-8, 34, 1.1], [14, 40, 2.8]] as const).entries())
    add('osada.boulder', [x, 0, z], i * 1.3, { size: s }, `T05 Balvan ${i + 1}`);
  const h = (x: number, z: number) => sliceHeight(x, z) + 0.1;
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id: `osada_slice_${Date.now().toString(36)}`,
    name: 'Skladová osada · vertikální řez',
    author: 'Potatofield',
    units: 'meters',
    terrain,
    environment: { ...DEFAULT_ENVIRONMENT, sunAzimuthDeg: 220, sunElevationDeg: 50 },
    objects,
    controlPoints: [
      { id: 'cp_baseA', name: 'Základna modrých', position: [-44, h(-44, 44), 44], radius: 8, height: 4, defaultOwner: 'teamA', capturable: false, spawnEnabled: true, countsForBleed: false },
      { id: 'cp_A', name: 'A Náves', position: [-12, h(-12, -3), -3], radius: 8, height: 4, defaultOwner: 'neutral', capturable: true, spawnEnabled: true, countsForBleed: true },
      { id: 'cp_baseB', name: 'Základna červených', position: [46, h(46, -48), -48], radius: 8, height: 4, defaultOwner: 'teamB', capturable: false, spawnEnabled: true, countsForBleed: false },
    ],
    spawnPoints: [
      ...[-2, 0, 2].map((dx, i) => ({ id: `sa${i}`, position: [-44 + dx, h(-44 + dx, 46), 46] as [number, number, number], yaw: Math.PI * 0.75, teams: ['teamA' as const], controlPointId: 'cp_baseA' })),
      ...[-2, 0, 2].map((dx, i) => ({ id: `sb${i}`, position: [46 + dx, h(46 + dx, -50), -50] as [number, number, number], yaw: -Math.PI * 0.25, teams: ['teamB' as const], controlPointId: 'cp_baseB' })),
      ...(['teamA', 'teamB'] as const).map((t, i) => ({ id: `sA_${t}`, position: [-19 + i * 2, h(-19, 3), 3] as [number, number, number], yaw: 0, teams: [t], controlPointId: 'cp_A' })),
    ],
    zones: [],
    scenarios: [
      { id: 'sc_slice', name: 'Vertikální řez', overrides: [], tickets: { teamA: 100, teamB: 100 }, timeLimit: 900, respawnDelay: 8, captureTime: 10, neutralizeTime: 10, bleedInterval: 5, zoneIds: [] },
    ],
    testSpawn: { position: [-12, h(-12, 3), 3], rotation: [0, Math.PI, 0] },
  };
}
