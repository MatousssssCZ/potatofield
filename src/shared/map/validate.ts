import {
  MAP_LIMITS,
  MAP_SCHEMA_VERSION,
  type MapDocument,
  type Team,
  type TeamOwner,
} from './schema';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  doc?: MapDocument;
}

type Obj = Record<string, unknown>;

class Checker {
  issues: ValidationIssue[] = [];
  err(path: string, message: string) {
    this.issues.push({ severity: 'error', path, message });
  }
  warn(path: string, message: string) {
    this.issues.push({ severity: 'warning', path, message });
  }
  obj(v: unknown, path: string): v is Obj {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.err(path, 'očekáván objekt');
      return false;
    }
    return true;
  }
  arr(v: unknown, path: string, max: number): v is unknown[] {
    if (!Array.isArray(v)) {
      this.err(path, 'očekáváno pole');
      return false;
    }
    if (v.length > max) {
      this.err(path, `příliš mnoho položek (${v.length} > ${max})`);
      return false;
    }
    return true;
  }
  num(v: unknown, path: string, min = -Infinity, max = Infinity): v is number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.err(path, 'očekáváno konečné číslo');
      return false;
    }
    if (v < min || v > max) {
      this.err(path, `hodnota ${v} mimo rozsah ${min}–${max}`);
      return false;
    }
    return true;
  }
  int(v: unknown, path: string, min: number, max: number): v is number {
    if (!this.num(v, path, min, max)) return false;
    if (!Number.isInteger(v)) {
      this.err(path, 'očekáváno celé číslo');
      return false;
    }
    return true;
  }
  str(v: unknown, path: string, allowEmpty = false): v is string {
    if (typeof v !== 'string') {
      this.err(path, 'očekáván text');
      return false;
    }
    if (!allowEmpty && v.length === 0) {
      this.err(path, 'prázdný text');
      return false;
    }
    if (v.length > MAP_LIMITS.maxStringLength) {
      this.err(path, 'text je příliš dlouhý');
      return false;
    }
    return true;
  }
  id(v: unknown, path: string): v is string {
    if (!this.str(v, path)) return false;
    if (!/^[A-Za-z0-9_.:-]+$/.test(v)) {
      this.err(path, 'ID smí obsahovat jen písmena bez diakritiky, čísla a _.:-');
      return false;
    }
    return true;
  }
  bool(v: unknown, path: string): v is boolean {
    if (typeof v !== 'boolean') {
      this.err(path, 'očekáváno ano/ne');
      return false;
    }
    return true;
  }
  vec3(v: unknown, path: string, lim: number = MAP_LIMITS.maxCoord): boolean {
    if (!Array.isArray(v) || v.length !== 3) {
      this.err(path, 'očekáván vektor [x, y, z]');
      return false;
    }
    return v.every((c, i) => this.num(c, `${path}[${i}]`, -lim, lim));
  }
  oneOf<T extends string>(v: unknown, path: string, opts: readonly T[]): v is T {
    if (typeof v !== 'string' || !opts.includes(v as T)) {
      this.err(path, `očekáváno jedno z: ${opts.join(', ')}`);
      return false;
    }
    return true;
  }
  color(v: unknown, path: string) {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) this.err(path, 'očekávána barva #rrggbb');
  }
}

const OWNERS: readonly TeamOwner[] = ['teamA', 'teamB', 'neutral'];
const TEAMS: readonly Team[] = ['teamA', 'teamB'];

/**
 * Validuje neznámý vstup (např. importovaný JSON) před sestavením světa.
 * Nespouští kód, nefetchuje URL. Novější verzi schématu odmítne.
 */
export function validateMap(input: unknown, opts: { fileBytes?: number } = {}): ValidationResult {
  const c = new Checker();
  if (opts.fileBytes !== undefined && opts.fileBytes > MAP_LIMITS.maxFileBytes) {
    c.err('', `soubor je příliš velký (${opts.fileBytes} B > ${MAP_LIMITS.maxFileBytes} B)`);
    return { ok: false, issues: c.issues };
  }
  if (!c.obj(input, '')) return { ok: false, issues: c.issues };
  const d = input;

  if (typeof d.schemaVersion !== 'number') {
    c.err('schemaVersion', 'chybí verze schématu');
    return { ok: false, issues: c.issues };
  }
  if (d.schemaVersion > MAP_SCHEMA_VERSION) {
    c.err(
      'schemaVersion',
      `mapa používá novější formát (verze ${d.schemaVersion}); tato verze aplikace podporuje nejvýše ${MAP_SCHEMA_VERSION}. Aktualizujte aplikaci.`,
    );
    return { ok: false, issues: c.issues };
  }
  if (d.schemaVersion < 1 || !Number.isInteger(d.schemaVersion)) {
    c.err('schemaVersion', 'neplatná verze schématu');
    return { ok: false, issues: c.issues };
  }

  c.id(d.id, 'id');
  c.str(d.name, 'name');
  if (d.author !== undefined) c.str(d.author, 'author', true);
  if (d.units !== 'meters') c.err('units', 'jediná podporovaná jednotka je "meters"');

  // Terén
  if (c.obj(d.terrain, 'terrain')) {
    const t = d.terrain;
    const okX = c.int(t.samplesX, 'terrain.samplesX', 2, 4097);
    const okZ = c.int(t.samplesZ, 'terrain.samplesZ', 2, 4097);
    const okS = c.num(t.spacing, 'terrain.spacing', MAP_LIMITS.minSpacing, MAP_LIMITS.maxSpacing);
    if (Array.isArray(t.origin) && t.origin.length === 2) {
      c.num(t.origin[0], 'terrain.origin[0]', -MAP_LIMITS.maxCoord, MAP_LIMITS.maxCoord);
      c.num(t.origin[1], 'terrain.origin[1]', -MAP_LIMITS.maxCoord, MAP_LIMITS.maxCoord);
    } else c.err('terrain.origin', 'očekáváno [x, z]');
    c.oneOf(t.baseMaterial, 'terrain.baseMaterial', ['sand', 'dirt', 'urban'] as const);
    if (okX && okZ && okS) {
      const n = (t.samplesX as number) * (t.samplesZ as number);
      if (n > MAP_LIMITS.maxTerrainSamples) c.err('terrain', `příliš mnoho vzorků terénu (${n})`);
      const ext = Math.max((t.samplesX as number) - 1, (t.samplesZ as number) - 1) * (t.spacing as number);
      if (ext > MAP_LIMITS.maxTerrainExtent) c.err('terrain', `terén je příliš velký (${ext} m)`);
      if (!Array.isArray(t.heights) || t.heights.length !== n) {
        c.err('terrain.heights', `očekáváno ${n} výšek`);
      } else {
        for (let i = 0; i < t.heights.length; i++) {
          const h = t.heights[i];
          if (typeof h !== 'number' || !Number.isFinite(h) || Math.abs(h) > MAP_LIMITS.maxHeight) {
            c.err(`terrain.heights[${i}]`, 'neplatná výška');
            break;
          }
        }
        for (const layer of ['dirt', 'urban'] as const) {
          const arr = t[layer];
          if (arr === undefined) continue;
          if (!Array.isArray(arr) || arr.length !== n) {
            c.err(`terrain.${layer}`, `očekáváno ${n} hodnot 0–1`);
            continue;
          }
          for (let i = 0; i < arr.length; i++) {
            const v = arr[i];
            if (typeof v !== 'number' || !(v >= 0 && v <= 1)) {
              c.err(`terrain.${layer}[${i}]`, 'hodnota mimo 0–1');
              break;
            }
          }
        }
      }
    }
  }

  // Prostředí
  if (c.obj(d.environment, 'environment')) {
    const e = d.environment;
    c.oneOf(e.preset, 'environment.preset', ['dustyNoon', 'clearSun', 'overcastRain'] as const);
    c.num(e.sunAzimuthDeg, 'environment.sunAzimuthDeg', -360, 360);
    c.num(e.sunElevationDeg, 'environment.sunElevationDeg', 5, 90);
    c.color(e.sunColor, 'environment.sunColor');
    c.num(e.sunIntensity, 'environment.sunIntensity', 0, 10);
    c.color(e.fogColor, 'environment.fogColor');
    c.num(e.fogHalfDistance, 'environment.fogHalfDistance', 30, 5000);
    if (e.fogEnabled !== undefined && typeof e.fogEnabled !== 'boolean') c.err('environment.fogEnabled', 'očekáváno ano/ne');
    if (e.skyHaze !== undefined) c.num(e.skyHaze, 'environment.skyHaze', 0, 1);
    c.num(e.ambientIntensity, 'environment.ambientIntensity', 0, 4);
  }

  // Objekty
  const objectIds = new Set<string>();
  if (c.arr(d.objects, 'objects', MAP_LIMITS.maxObjects)) {
    d.objects.forEach((o, i) => {
      const p = `objects[${i}]`;
      if (!c.obj(o, p)) return;
      if (c.id(o.id, `${p}.id`)) {
        if (objectIds.has(o.id)) c.err(`${p}.id`, `duplicitní ID "${o.id}"`);
        objectIds.add(o.id);
      }
      c.id(o.assetId, `${p}.assetId`);
      c.int(o.generatorVersion, `${p}.generatorVersion`, 1, 1000);
      c.int(o.seed, `${p}.seed`, 0, 0xffffffff);
      if (o.material !== undefined) c.id(o.material, `${p}.material`);
      if (o.texBlur !== undefined) c.num(o.texBlur, `${p}.texBlur`, 0, 4);
      if (c.obj(o.transform, `${p}.transform`)) {
        c.vec3(o.transform.position, `${p}.transform.position`);
        c.vec3(o.transform.rotation, `${p}.transform.rotation`, 100);
        if (o.transform.scale !== undefined) c.num(o.transform.scale, `${p}.transform.scale`, 0.1, 10);
      }
      if (c.obj(o.params, `${p}.params`)) {
        const keys = Object.keys(o.params);
        if (keys.length > MAP_LIMITS.maxParams) c.err(`${p}.params`, 'příliš mnoho parametrů');
        for (const k of keys) {
          const v = o.params[k];
          if (typeof v === 'number') c.num(v, `${p}.params.${k}`, -1e6, 1e6);
          else if (typeof v === 'string') {
            if (k === 'points') {
              if (v.length > MAP_LIMITS.maxPointsLength) c.err(`${p}.params.${k}`, 'příliš mnoho bodů');
              else if (!/^[-0-9.,;e]*$/.test(v)) c.err(`${p}.params.${k}`, 'neplatný seznam bodů');
            } else c.str(v, `${p}.params.${k}`, true);
          }
          else if (typeof v !== 'boolean') c.err(`${p}.params.${k}`, 'nepodporovaný typ parametru');
        }
      }
    });
  }

  // Herní body
  const cpIds = new Set<string>();
  if (c.arr(d.controlPoints, 'controlPoints', MAP_LIMITS.maxControlPoints)) {
    d.controlPoints.forEach((cp, i) => {
      const p = `controlPoints[${i}]`;
      if (!c.obj(cp, p)) return;
      if (c.id(cp.id, `${p}.id`)) {
        if (cpIds.has(cp.id)) c.err(`${p}.id`, `duplicitní ID "${cp.id}"`);
        cpIds.add(cp.id);
      }
      c.str(cp.name, `${p}.name`);
      c.vec3(cp.position, `${p}.position`);
      c.num(cp.radius, `${p}.radius`, 1, 100);
      c.num(cp.height, `${p}.height`, 1, 50);
      c.oneOf(cp.defaultOwner, `${p}.defaultOwner`, OWNERS);
      c.bool(cp.capturable, `${p}.capturable`);
      c.bool(cp.spawnEnabled, `${p}.spawnEnabled`);
      c.bool(cp.countsForBleed, `${p}.countsForBleed`);
    });
  }

  const spawnIds = new Set<string>();
  if (c.arr(d.spawnPoints, 'spawnPoints', MAP_LIMITS.maxSpawns)) {
    d.spawnPoints.forEach((s, i) => {
      const p = `spawnPoints[${i}]`;
      if (!c.obj(s, p)) return;
      if (c.id(s.id, `${p}.id`)) {
        if (spawnIds.has(s.id)) c.err(`${p}.id`, `duplicitní ID "${s.id}"`);
        spawnIds.add(s.id);
      }
      c.vec3(s.position, `${p}.position`);
      c.num(s.yaw, `${p}.yaw`, -100, 100);
      if (c.arr(s.teams, `${p}.teams`, 2)) s.teams.forEach((t, j) => c.oneOf(t, `${p}.teams[${j}]`, TEAMS));
      if (s.controlPointId !== undefined && c.id(s.controlPointId, `${p}.controlPointId`)) {
        if (!cpIds.has(s.controlPointId)) c.err(`${p}.controlPointId`, `neexistující bod "${s.controlPointId}"`);
      }
    });
  }

  const zoneIds = new Set<string>();
  if (c.arr(d.zones, 'zones', MAP_LIMITS.maxZones)) {
    d.zones.forEach((z, i) => {
      const p = `zones[${i}]`;
      if (!c.obj(z, p)) return;
      if (c.id(z.id, `${p}.id`)) {
        if (zoneIds.has(z.id)) c.err(`${p}.id`, `duplicitní ID "${z.id}"`);
        zoneIds.add(z.id);
      }
      c.oneOf(z.kind, `${p}.kind`, ['forbidden', 'boundary'] as const);
      c.vec3(z.center, `${p}.center`);
      if (c.vec3(z.halfExtents, `${p}.halfExtents`)) {
        if ((z.halfExtents as number[]).some((v) => v <= 0)) c.err(`${p}.halfExtents`, 'rozměry musí být kladné');
      }
      c.num(z.yaw, `${p}.yaw`, -100, 100);
      if (c.arr(z.appliesTo, `${p}.appliesTo`, 2)) z.appliesTo.forEach((t, j) => c.oneOf(t, `${p}.appliesTo[${j}]`, TEAMS));
      c.num(z.countdown, `${p}.countdown`, 1, 120);
    });
  }

  if (c.arr(d.scenarios, 'scenarios', MAP_LIMITS.maxScenarios)) {
    const scIds = new Set<string>();
    d.scenarios.forEach((s, i) => {
      const p = `scenarios[${i}]`;
      if (!c.obj(s, p)) return;
      if (c.id(s.id, `${p}.id`)) {
        if (scIds.has(s.id)) c.err(`${p}.id`, `duplicitní ID "${s.id}"`);
        scIds.add(s.id);
      }
      c.str(s.name, `${p}.name`);
      if (c.obj(s.tickets, `${p}.tickets`)) {
        c.int(s.tickets.teamA, `${p}.tickets.teamA`, 1, 10000);
        c.int(s.tickets.teamB, `${p}.tickets.teamB`, 1, 10000);
      }
      c.num(s.timeLimit, `${p}.timeLimit`, 30, 7200);
      c.num(s.respawnDelay, `${p}.respawnDelay`, 0, 120);
      c.num(s.captureTime, `${p}.captureTime`, 1, 600);
      c.num(s.neutralizeTime, `${p}.neutralizeTime`, 1, 600);
      c.num(s.bleedInterval, `${p}.bleedInterval`, 0.5, 600);
      if (c.arr(s.zoneIds, `${p}.zoneIds`, MAP_LIMITS.maxZones)) {
        s.zoneIds.forEach((z, j) => {
          if (c.id(z, `${p}.zoneIds[${j}]`) && !zoneIds.has(z)) c.err(`${p}.zoneIds[${j}]`, `neexistující zóna "${z}"`);
        });
      }
      if (c.arr(s.overrides, `${p}.overrides`, MAP_LIMITS.maxControlPoints)) {
        s.overrides.forEach((ov, j) => {
          const q = `${p}.overrides[${j}]`;
          if (!c.obj(ov, q)) return;
          if (c.id(ov.controlPointId, `${q}.controlPointId`) && !cpIds.has(ov.controlPointId)) {
            c.err(`${q}.controlPointId`, `neexistující bod "${ov.controlPointId}"`);
          }
          if (ov.defaultOwner !== undefined) c.oneOf(ov.defaultOwner, `${q}.defaultOwner`, OWNERS);
          for (const k of ['capturable', 'spawnEnabled', 'countsForBleed', 'disabled'] as const) {
            if (ov[k] !== undefined) c.bool(ov[k], `${q}.${k}`);
          }
        });
      }
    });
  }

  if (d.testSpawn !== undefined && c.obj(d.testSpawn, 'testSpawn')) {
    c.vec3(d.testSpawn.position, 'testSpawn.position');
    c.vec3(d.testSpawn.rotation, 'testSpawn.rotation', 100);
  }

  // Varování (neblokují)
  if (Array.isArray(d.spawnPoints) && Array.isArray(d.controlPoints) && d.controlPoints.length > 0) {
    for (const team of TEAMS) {
      const has = (d.spawnPoints as Obj[]).some((s) => Array.isArray(s.teams) && s.teams.includes(team));
      if (!has) c.warn('spawnPoints', `tým ${team === 'teamA' ? 'A' : 'B'} nemá žádný spawn`);
    }
  }

  const ok = !c.issues.some((i) => i.severity === 'error');
  return { ok, issues: c.issues, doc: ok ? (d as unknown as MapDocument) : undefined };
}

/** Parsování textu souboru s bezpečnou chybou (bez pádu). */
export function parseMapJson(text: string): ValidationResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAP_LIMITS.maxFileBytes) {
    return { ok: false, issues: [{ severity: 'error', path: '', message: 'soubor je příliš velký' }] };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, issues: [{ severity: 'error', path: '', message: `neplatný JSON: ${(e as Error).message}` }] };
  }
  return validateMap(data, { fileBytes: bytes });
}
