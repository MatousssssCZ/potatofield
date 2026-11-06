/**
 * Verzovaný autorský formát mapy. Ukládá autorská data (parametry objektů,
 * terén, herní markery), nikdy serializovaný strom Three.js.
 *
 * Jednotky: metry. Souřadnice Y-up. Rotace v dokumentu: radiány (UI zobrazuje stupně).
 */

export const MAP_SCHEMA_VERSION = 1;

export type Vec3 = [number, number, number];

export interface Transform {
  position: Vec3;
  /** Euler XYZ v radiánech. Pro většinu objektů se používá jen Y. */
  rotation: Vec3;
  /** Jednotné měřítko rigidní rekvizity (parametrické objekty mají 1). */
  scale?: number;
}

export interface TerrainData {
  /** Počet vzorků v ose X a Z (vrcholů). */
  samplesX: number;
  samplesZ: number;
  /** Rozteč vzorků v metrech. */
  spacing: number;
  /** Poloha rohu (minX, minZ) terénu ve světě. */
  origin: [number, number];
  /** Výšky v metrech, řádky po X, index = z * samplesX + x. */
  heights: number[];
  /** Základní povrch pro jednoduché výškové/svahové míchání. */
  baseMaterial: 'sand' | 'dirt' | 'urban';
  /** Volitelná malovaná vrstva: podíl hlíny 0–1 na vzorek (stejné indexování jako heights). */
  dirt?: number[];
  /** Volitelná malovaná vrstva: podíl hrubého městského povrchu 0–1 na vzorek. */
  urban?: number[];
}

export interface EnvironmentProfile {
  preset: 'dustyNoon' | 'clearSun' | 'overcastRain';
  /** Azimut slunce ve stupních (0 = sever/−Z, po směru hodinových ručiček). */
  sunAzimuthDeg: number;
  /** Výška slunce nad obzorem ve stupních. */
  sunElevationDeg: number;
  sunColor: string;
  sunIntensity: number;
  fogColor: string;
  /** Vzdálenost, na které mlha dosáhne zhruba 50 % (m). Herní, nemění se profilem kvality. */
  fogHalfDistance: number;
  /** Mlha zapnutá (chybí = zapnutá; starší mapy). */
  fogEnabled?: boolean;
  /** Opar přes oblohu barvou mlhy 0–1 (BF2 prašný opar zakryje i nebe). Chybí = 0,25. */
  skyHaze?: number;
  ambientIntensity: number;
}

export interface MapObject {
  id: string;
  /** Stabilní identifikátor typu (např. `prim.box`, `build.residential`). */
  assetId: string;
  generatorVersion: number;
  transform: Transform;
  params: Record<string, number | string | boolean>;
  seed: number;
  material?: string;
  /** Skryto ve hře (explicitní herní viditelnost; skrytí v editoru je zvlášť). */
  gameHidden?: boolean;
  /** Rozpití (rozmazání) textur objektu: 0 = ostré, 4 = velmi rozpité (mip bias). */
  texBlur?: number;
  /** Volná metadata editoru (skupina, zámek), hra je ignoruje. */
  editor?: { group?: string; locked?: boolean; hidden?: boolean; name?: string };
}

export type TeamOwner = 'teamA' | 'teamB' | 'neutral';
export type Team = 'teamA' | 'teamB';

export interface ControlPoint {
  id: string;
  name: string;
  position: Vec3;
  /** Objem zabírání: válec s podstavou u markeru. */
  radius: number;
  height: number;
  defaultOwner: TeamOwner;
  capturable: boolean;
  spawnEnabled: boolean;
  countsForBleed: boolean;
}

export interface SpawnPoint {
  id: string;
  position: Vec3;
  yaw: number;
  teams: Team[];
  /** Vazba na ControlPoint (ID), nebo samostatná základna. */
  controlPointId?: string;
}

export interface Zone {
  id: string;
  kind: 'forbidden' | 'boundary';
  /** Orientovaný box: střed, poloviční rozměry, natočení Y. */
  center: Vec3;
  halfExtents: Vec3;
  yaw: number;
  /** Týmy, pro které zóna platí. */
  appliesTo: Team[];
  countdown: number;
}

export interface ControlPointOverride {
  controlPointId: string;
  defaultOwner?: TeamOwner;
  capturable?: boolean;
  spawnEnabled?: boolean;
  countsForBleed?: boolean;
  disabled?: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  overrides: ControlPointOverride[];
  tickets: { teamA: number; teamB: number };
  timeLimit: number;
  respawnDelay: number;
  captureTime: number;
  neutralizeTime: number;
  bleedInterval: number;
  zoneIds: string[];
}

export interface MapDocument {
  schemaVersion: number;
  id: string;
  name: string;
  author?: string;
  units: 'meters';
  terrain: TerrainData;
  environment: EnvironmentProfile;
  objects: MapObject[];
  controlPoints: ControlPoint[];
  spawnPoints: SpawnPoint[];
  zones: Zone[];
  scenarios: Scenario[];
  testSpawn?: Transform;
}

/** Ochranné meze importu. Zdokumentováno v docs/MAP_FORMAT.md. */
export const MAP_LIMITS = {
  maxFileBytes: 32 * 1024 * 1024,
  maxObjects: 20000,
  maxTerrainSamples: 1025 * 1025,
  maxTerrainExtent: 2048,
  minSpacing: 0.25,
  maxSpacing: 8,
  maxCoord: 5000,
  maxHeight: 1000,
  maxControlPoints: 32,
  maxSpawns: 512,
  maxZones: 256,
  maxScenarios: 16,
  maxStringLength: 200,
  /** Parametr typu body (ulice): „x,z;x,z;…“ – až ~280 bodů. */
  maxPointsLength: 4000,
  maxParams: 64,
} as const;

export const DEFAULT_ENVIRONMENT: EnvironmentProfile = {
  preset: 'dustyNoon',
  sunAzimuthDeg: 215,
  sunElevationDeg: 58,
  sunColor: '#fff1d8',
  sunIntensity: 3.2,
  fogColor: '#cdbb9c',
  fogHalfDistance: 260,
  ambientIntensity: 1.0,
};

export function makeFlatTerrain(sizeX: number, sizeZ: number, spacing = 1, height = 0): TerrainData {
  const samplesX = Math.round(sizeX / spacing) + 1;
  const samplesZ = Math.round(sizeZ / spacing) + 1;
  return {
    samplesX,
    samplesZ,
    spacing,
    origin: [-sizeX / 2, -sizeZ / 2],
    heights: new Array(samplesX * samplesZ).fill(height),
    baseMaterial: 'sand',
  };
}
