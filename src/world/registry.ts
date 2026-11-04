import type { MapDocument, MapObject } from '../shared/map/schema';
import { laddersToWorld, partsToColliders, type ColliderDef, type LadderDef, type LadderLocal, type Part } from './parts';

export interface ParamSpec {
  key: string;
  /** Český popisek pro UI. Interní klíč nezávisí na překladu. */
  label: string;
  type: 'number' | 'int' | 'enum' | 'bool' | 'string';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: number | string | boolean;
  options?: Array<{ value: string; label: string }>;
}

export type Params = Record<string, number | string | boolean>;

export interface AssetDef {
  assetId: string;
  label: string;
  category: 'primitives' | 'cover' | 'range' | 'markers' | 'structures' | 'buildings' | 'street';
  generatorVersion: number;
  params: ParamSpec[];
  materials: string[];
  defaultMaterial: string;
  /** Povolit jednotné zvětšení rigidní rekvizity (parametrické typy ne). */
  uniformScale?: { min: number; max: number };
  /** Rozměrové handly: osa gizma → parametr generátoru (mění parametry, ne mesh.scale). */
  sizeParams?: { x?: string; y?: string; z?: string };
  generate(p: Params, seed: number, material: string): Part[];
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

export function generateObject(o: MapObject): GeneratedObject {
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
  return { object: o, parts: def.generate(p, o.seed, material), ladders: def.ladders ? laddersToWorld(o, def.ladders(p)) : [] };
}

export function generateMap(doc: MapDocument): GeneratedObject[] {
  return doc.objects.map(generateObject);
}

export function collidersForMap(gen: GeneratedObject[]): ColliderDef[] {
  const out: ColliderDef[] = [];
  for (const g of gen) out.push(...partsToColliders(g.object, g.parts));
  return out;
}

export function laddersForMap(gen: GeneratedObject[]): LadderDef[] {
  return gen.filter((g) => !g.object.gameHidden).flatMap((g) => g.ladders);
}
