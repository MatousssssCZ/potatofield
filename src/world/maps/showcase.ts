import type { MapDocument, MapObject } from '../../shared/map/schema';
import { allAssets, generateObject, resolveParams } from '../registry';
import { localFootprint, planTerrainFit } from '../groundFit';
import { writeRegion } from '../terrain';
import { buildEmptyMap } from './empty';

/**
 * Přehledová mapa sady 300: všechny modely vedle sebe po sekcích (A–K), každý s cedulí
 * s číslem položky, sekce oddělené velkou cedulí. Slouží ke kontrole v editoru i ve hře.
 * Sklepní vstupy dostanou snížený terén stejně jako po „Dorovnat terén“.
 */
const SECTIONS: Record<string, string> = {
  A: 'A obytné budovy', B: 'B stavební moduly', C: 'C vstupy a průchody', D: 'D obchody', E: 'E průmysl a vojenské',
  F: 'F zdi a ploty', G: 'G kryty', H: 'H vraky', I: 'I mobiliář', J: 'J rekvizity', K: 'K příroda',
};

export function buildShowcaseMap(): MapDocument {
  const SIZE = 640, ROW_W = 260, GAP = 4;
  const doc = buildEmptyMap('Přehled sady 300', SIZE, 1);
  doc.id = `showcase_${Date.now().toString(36)}`;
  const objects: MapObject[] = [];
  let n = 0;
  const add = (assetId: string, pos: [number, number, number], params: MapObject['params'] = {}, name?: string, scale?: number) => {
    const o: MapObject = {
      id: `obj_${String(++n).padStart(4, '0')}`,
      assetId,
      generatorVersion: 1,
      transform: { position: pos, rotation: [0, 0, 0], ...(scale ? { scale } : {}) },
      params,
      seed: (n * 2654435761) >>> 0,
      ...(name ? { editor: { name } } : {}),
    };
    objects.push(o);
    return o;
  };
  const sign = (text: string, x: number, z: number, scale?: number) => add('range.sign', [x, 0, z], { text }, `Cedule ${text}`, scale);

  const assets = allAssets().filter((a) => /^set[A-K]\./.test(a.assetId));
  const bySection = new Map<string, typeof assets>();
  for (const a of assets) {
    const s = a.assetId[3];
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s)!.push(a);
  }
  // Řady od −Z k +Z; v řadě zleva doprava (+X), zalomení po ROW_W metrech.
  let z = -SIZE / 2 + 20;
  const x0 = -ROW_W / 2;
  const cuts: MapObject[] = [];
  for (const s of Object.keys(SECTIONS)) {
    const list = (bySection.get(s) ?? []).sort((p, q) => p.label.localeCompare(q.label, 'cs', { numeric: true }));
    if (!list.length) continue;
    sign(SECTIONS[s], x0 - 8, z + 2, 3);
    let x = x0, rowDepth = 0;
    const row: { a: (typeof list)[number]; px: number; mnz: number }[] = [];
    const flush = () => {
      for (const it of row) {
        const o = add(it.a.assetId, [it.px, 0, z - it.mnz], resolveParams(it.a, {}), it.a.label);
        sign(it.a.label.split(' ')[0], o.transform.position[0], z - 1.5);
        if (it.a.terrainCut) cuts.push(o);
      }
      z += rowDepth + 10;
      row.length = 0;
      rowDepth = 0;
      x = x0;
    };
    for (const a of list) {
      const g = generateObject({ id: 'tmp', assetId: a.assetId, generatorVersion: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: resolveParams(a, {}), seed: 1 });
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (const p of g.parts) {
        const r = Math.max(p.size[0], p.size[2]) / 2;
        mnx = Math.min(mnx, p.pos[0] - r); mxx = Math.max(mxx, p.pos[0] + r);
        mnz = Math.min(mnz, p.pos[2] - r); mxz = Math.max(mxz, p.pos[2] + r);
      }
      if (!isFinite(mnx)) { mnx = -1; mxx = 1; mnz = -1; mxz = 1; }
      const w = Math.min(40, mxx - mnx), d = Math.min(40, mxz - mnz);
      if (x - x0 + w > ROW_W && row.length) flush();
      // Pivot tak, aby levá hrana obálky byla v x a přední (−Z) v z.
      row.push({ a, px: x - mnx, mnz });
      rowDepth = Math.max(rowDepth, d);
      x += w + GAP;
    }
    if (row.length) flush();
    z += 12;
  }
  doc.objects = objects;
  // Sklepní vstupy: prohlubeň v terénu.
  for (const o of cuts) {
    const def = assets.find((a) => a.assetId === o.assetId)!;
    const g = generateObject(o);
    const plan = planTerrainFit(doc.terrain, [{ object: o, fp: localFootprint(g.parts), base: 0, cut: def.terrainCut!(resolveParams(def, o.params)) }]);
    if (plan) writeRegion(doc.terrain, plan.region, plan.after);
  }
  doc.testSpawn = { position: [x0 - 4, 0, -SIZE / 2 + 12], rotation: [0, Math.PI, 0] };
  return doc;
}
