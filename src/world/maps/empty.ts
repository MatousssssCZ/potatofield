import { DEFAULT_ENVIRONMENT, MAP_SCHEMA_VERSION, makeFlatTerrain, type MapDocument } from '../../shared/map/schema';

/** Prázdná mapa: výchozí plátno editoru 256×256 m s roztečí 1 m (lze změnit před tvorbou). */
export function buildEmptyMap(name = 'Nová mapa', size = 256, spacing = 1): MapDocument {
  const id = `map_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id,
    name,
    units: 'meters',
    terrain: makeFlatTerrain(size, size, spacing),
    environment: { ...DEFAULT_ENVIRONMENT },
    objects: [],
    controlPoints: [],
    spawnPoints: [],
    zones: [],
    scenarios: [],
    testSpawn: { position: [0, 0, 0], rotation: [0, 0, 0] },
  };
}
