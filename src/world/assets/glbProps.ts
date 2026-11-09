import { registerAsset, type AssetDef } from '../registry';
import type { HitSurface, Part } from '../parts';
import { GLB_PROPS } from './glbProps.data';

/**
 * Modely GLB z balíku ChatGPT (FPS_Reference, schéma 1.1). Vzhled = síť LOD0 z GLB
 * (díl 'model', jen klient), kolize = neviditelné kvádry z JSON metadat (klient i server),
 * žebříky z JSON. Materiály v GLB nesou názvy našich materiálů a UV v metrech.
 */
export interface GlbPropData {
  id: string;
  label: string;
  category: string;
  kind: string;
  bounds: [[number, number, number], [number, number, number]];
  tris: number;
  materials: string[];
  mount: 'wall' | 'top' | null;
  colliders: { c: [number, number, number]; s: [number, number, number]; r: [number, number, number]; surface: string }[];
  ladders: { base: [number, number, number]; height: number; yawDeg: number }[];
}

/** Povrch zásahu z JSON → materiál, ze kterého `surfaceOf` odvodí stejný povrch. */
const SURFACE_MAT: Record<string, string> = { plaster: 'plaster', concrete: 'concrete', metal: 'metal', wood: 'wood', sand: 'sand', dirt: 'dirt', brick: 'brick', fabric: 'fabricSand', asphalt: 'asphalt' };

const KIND_LABEL: Record<string, string> = { building: 'budova', module: 'modul', prop: 'rekvizita', tree: 'strom', wreck: 'vrak' };

export function glbPropParts(d: GlbPropData): Part[] {
  const [min, max] = d.bounds;
  const parts: Part[] = [
    {
      shape: 'model',
      model: d.id,
      pos: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
      material: d.materials[0] ?? 'concrete',
    },
  ];
  for (const c of d.colliders)
    parts.push({ shape: 'box', pos: c.c, size: c.s, rot: c.r, material: SURFACE_MAT[c.surface as HitSurface] ?? 'concrete', collide: true, render: false });
  return parts;
}

for (const d of GLB_PROPS) {
  const rigid = d.kind !== 'building' && d.kind !== 'module';
  const def: AssetDef = {
    assetId: `glb.${d.id}`,
    label: `${d.label} (GLB)`,
    category: 'glb',
    generatorVersion: 1,
    params: [],
    materials: [d.materials[0] ?? 'concrete'],
    defaultMaterial: d.materials[0] ?? 'concrete',
    uniformScale: rigid ? { min: 0.5, max: 2 } : undefined,
    generate: () => glbPropParts(d),
    describe: () => `${KIND_LABEL[d.kind] ?? d.kind}, ${(d.bounds[1][0] - d.bounds[0][0]).toFixed(1)} × ${(d.bounds[1][2] - d.bounds[0][2]).toFixed(1)} × ${(d.bounds[1][1] - d.bounds[0][1]).toFixed(1)} m, ${d.tris} trojúhelníků`,
  };
  // Přední strana modelů je −Z, zadní (ke zdi) v z = bounds.max.z.
  if (d.mount === 'wall') def.mount = { kind: 'wall', back: d.bounds[1][2] };
  else if (d.mount === 'top') def.mount = { kind: 'top' };
  if (d.ladders.length)
    def.ladders = () => d.ladders.map((l) => ({ base: l.base, height: l.height, width: 0.5, yaw: (l.yawDeg * Math.PI) / 180 }));
  registerAsset(def);
}
