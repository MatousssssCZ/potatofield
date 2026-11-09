import type { MapDocument, MapObject, TerrainData } from '../shared/map/schema';
import { heightAt } from './terrain';
import { laddersToWorld, partsToColliders, type ColliderDef, type LadderDef, type LadderLocal, type Part } from './parts';

export interface ParamSpec {
  key: string;
  /** Český popisek pro UI. Interní klíč nezávisí na překladu. */
  label: string;
  /** 'points' = seznam bodů „x,z;x,z;…“ (lokálně, metry) – edituje se úchopy ve viewportu, ne polem. */
  type: 'number' | 'int' | 'enum' | 'bool' | 'string' | 'points';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: number | string | boolean;
  options?: Array<{ value: string; label: string }>;
}

export type Params = Record<string, number | string | boolean>;

/**
 * Kontext generátoru: výška terénu pod bodem v lokálních souřadnicích objektu (relativně k jeho
 * počátku, v jeho měřítku). Bez terénu (náhledy, testy) vrací 0. Stejná funkce na serveru i u
 * klienta → kolize sedí.
 */
export interface GenContext {
  ground(x: number, z: number): number;
  /** ID generovaného objektu (např. pořadí silnic na křižovatce). */
  selfId?: string;
  /** Ostatní objekty mapy (silnice hledají křížení). */
  neighbors?: MapObject[];
  /** Světové (x, z) → lokální souřadnice tohoto objektu. */
  toLocal?(x: number, z: number): [number, number];
}

export const FLAT: GenContext = { ground: () => 0 };

/** Kam se doplněk přichytí při tažení: na stěnu (záda k ní) nebo na vodorovnou plochu (střechu). */
export interface MountSpec {
  kind: 'wall' | 'top';
  /** Vzdálenost zadní plochy od počátku podél lokální +Z (strana ke zdi). */
  back?: number;
}

export interface AssetDef {
  assetId: string;
  label: string;
  category: 'primitives' | 'cover' | 'range' | 'markers' | 'structures' | 'buildings' | 'street' | 'nature' | 'glb';
  generatorVersion: number;
  params: ParamSpec[];
  materials: string[];
  defaultMaterial: string;
  /** Povolit jednotné zvětšení rigidní rekvizity (parametrické typy ne). */
  uniformScale?: { min: number; max: number };
  /** Rozměrové handly: osa gizma → parametr generátoru (mění parametry, ne mesh.scale). */
  sizeParams?: { x?: string; y?: string; z?: string };
  generate(p: Params, seed: number, material: string, ctx: GenContext): Part[];
  /** Generátor čte terén (např. plot kopíruje svah) – po změně terénu se přegeneruje. */
  usesTerrain?(p: Params): boolean;
  /** Doplněk se tažením přilepí na budovu (viz MountSpec). */
  mount?: MountSpec;
  /** Žebříky objektu (pro simulaci lezení). */
  ladders?(p: Params): LadderLocal[];
  /** Popis výsledného rozměru pro UI (např. „5 polí, 6 sloupků“). */
  describe?(p: Params): string;
}

const registry = new Map<string, AssetDef>();

export function registerAsset(def: AssetDef) {
  if (registry.has(def.assetId)) throw new Error(`duplicitní asset ${def.assetId}`);
  registry.set(def.assetId, def);
}

export function getAsset(assetId: string): AssetDef | undefined {
  return registry.get(assetId);
}

export function allAssets(): AssetDef[] {
  return [...registry.values()];
}

/** Doplní chybějící parametry výchozími hodnotami a ořízne číselné do mezí. */
export function resolveParams(def: AssetDef, raw: Params): Params {
  const out: Params = {};
  for (const spec of def.params) {
    let v = raw[spec.key];
    if (v === undefined || typeof v !== typeof spec.default) v = spec.default;
    if (typeof v === 'number') {
      if (spec.min !== undefined) v = Math.max(spec.min, v);
      if (spec.max !== undefined) v = Math.min(spec.max, v);
      if (spec.type === 'int') v = Math.round(v);
    }
    if (spec.type === 'enum' && spec.options && !spec.options.some((o) => o.value === v)) v = spec.default;
    out[spec.key] = v;
  }
  return out;
}

export interface GeneratedObject {
  object: MapObject;
  parts: Part[];
  ladders: LadderDef[];
  /** Asset neexistuje nebo má novější verzi generátoru – zobrazí se jako placeholder. */
  missing?: string;
}

/** Placeholder pro chybějící asset: zvýrazněná krychle; původní data objektu zůstávají nedotčena. */
function placeholderParts(): Part[] {
  return [{ shape: 'box', pos: [0, 0.5, 0], size: [1, 1, 1], material: 'debugMissing', collide: true }];
}

/** Kontext terénu pro objekt: lokální (x, z) → světové → výška terénu → lokální y. */
export function terrainContext(o: MapObject, terrain?: TerrainData, neighbors?: MapObject[]): GenContext {
  const [px, py, pz] = o.transform.position;
  const yaw = o.transform.rotation[1];
  const s = o.transform.scale ?? 1;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const base = {
    selfId: o.id,
    neighbors: neighbors?.filter((x) => x.id !== o.id && !x.gameHidden),
    toLocal(x: number, z: number): [number, number] {
      const dx = (x - px) / s, dz = (z - pz) / s;
      return [c * dx - sn * dz, sn * dx + c * dz];
    },
  };
  if (!terrain) return { ...base, ground: () => 0 };
  return {
    ...base,
    ground(x, z) {
      const lx = x * s, lz = z * s;
      const wx = px + c * lx + sn * lz, wz = pz - sn * lx + c * lz;
      const h = heightAt(terrain, wx, wz);
      return h === null ? 0 : (h - py) / s;
    },
  };
}

export function generateObject(o: MapObject, terrain?: TerrainData, neighbors?: MapObject[]): GeneratedObject {
  const def = registry.get(o.assetId);
  if (!def) return { object: o, parts: placeholderParts(), ladders: [], missing: `neznámý asset "${o.assetId}"` };
  if (o.generatorVersion > def.generatorVersion) {
    return {
      object: o,
      parts: placeholderParts(),
      ladders: [],
      missing: `asset "${o.assetId}" vyžaduje generátor v${o.generatorVersion}, aplikace má v${def.generatorVersion}`,
    };
  }
  const material = o.material && def.materials.includes(o.material) ? o.material : def.defaultMaterial;
  const p = resolveParams(def, o.params);
  return { object: o, parts: def.generate(p, o.seed, material, terrainContext(o, terrain, neighbors)), ladders: def.ladders ? laddersToWorld(o, def.ladders(p)) : [] };
}

export function generateMap(doc: MapDocument): GeneratedObject[] {
  return doc.objects.map((o) => generateObject(o, doc.terrain, doc.objects));
}

export function collidersForMap(gen: GeneratedObject[]): ColliderDef[] {
  const out: ColliderDef[] = [];
  for (const g of gen) out.push(...partsToColliders(g.object, g.parts));
  return out;
}

export function laddersForMap(gen: GeneratedObject[]): LadderDef[] {
  return gen.filter((g) => !g.object.gameHidden).flatMap((g) => g.ladders);
}
