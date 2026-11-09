/**
 * Export sady 300 do GLB + JSON (schéma 1.1 jako pilotní balík), manifest a validační report.
 * Použití: npx tsx scripts/export-set.ts A   (písmeno sekce)
 * GLB: metry, Y nahoru, přední strana −Z, bez textur (názvy sdílených materiálů), UV v metrech.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { allAssets, generateObject, laddersForMap, resolveParams, SET_META, surfaceOf, type Part } from '../src/world';
import { buildObjectGeometry } from '../src/client/render/geometry';
import { MATERIALS, tileOf } from '../src/client/render/materials';
import { walkRoute } from '../tests/setWalk';
import { makeWorld } from '../tests/helpers';
import { collidersForMap } from '../src/world';

const section = process.argv[2] ?? 'A';
const outDir = `exports/sada300/${section}`;
fs.mkdirSync(outDir, { recursive: true });
const io = new NodeIO();
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const manifest: unknown[] = [];
const report: string[] = [];
const ids = allAssets().filter((a) => a.assetId.startsWith(`set${section}.`)).map((a) => a.assetId);

function collisionOf(p: Part) {
  const e = new THREE.Euler(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0, 'XYZ');
  if (p.shape === 'wedge') {
    // Rampa schodů: šikmá deska po horní ploše klínu.
    const [w, h, l] = p.size;
    const ang = Math.atan2(h, l), L = Math.hypot(h, l);
    const q = new THREE.Quaternion().setFromEuler(e).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ang));
    const off = new THREE.Vector3(0, -0.09, 0).applyQuaternion(q);
    const ez = new THREE.Euler().setFromQuaternion(q, 'ZYX');
    return { center: [r4(p.pos[0] + off.x), r4(p.pos[1] + off.y), r4(p.pos[2] + off.z)], size: [r4(w), 0.18, r4(L)], rotX: r4(ez.x), rotY: r4(ez.y), rotZ: r4(ez.z), kind: 'ramp' };
  }
  const ez = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromEuler(e), 'ZYX');
  return { center: p.pos.map(r4), size: p.size.map(r4), rotX: r4(ez.x), rotY: r4(ez.y), rotZ: r4(ez.z), kind: p.shape };
}

for (const id of ids) {
  const meta = SET_META[id];
  const def = allAssets().find((a) => a.assetId === id)!;
  const o = { id: 'b', assetId: id, generatorVersion: 1, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, params: resolveParams(def, {}), seed: 7, material: def.defaultMaterial };
  const g = generateObject(o);
  const geo = buildObjectGeometry(g.parts);
  // GLB: jeden uzel LOD0, primitiva podle materiálu.
  const doc = new Document();
  const buf = doc.createBuffer();
  const mesh = doc.createMesh('LOD0');
  let tris = 0;
  const box = new THREE.Box3();
  const mats = new Set<string>();
  for (const [key, { geometry }] of geo.byMaterial) {
    const mat = key.split('|')[0];
    mats.add(mat);
    const pos = geometry.getAttribute('position').array as Float32Array;
    const nrm = geometry.getAttribute('normal').array as Float32Array;
    const uv = Float32Array.from(geometry.getAttribute('uv').array as Float32Array, (v) => v * tileOf(mat));
    const idx = Uint32Array.from(geometry.index!.array as ArrayLike<number>);
    tris += idx.length / 3;
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox!);
    const m = doc.createMaterial(mat).setBaseColorFactor([0.7, 0.7, 0.7, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
    if (MATERIALS[mat]?.alphaTest) m.setAlphaMode('MASK');
    if (MATERIALS[mat]?.side === THREE.DoubleSide) m.setDoubleSided(true);
    mesh.addPrimitive(
      doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
        .setMaterial(m),
    );
  }
  doc.createScene().addChild(doc.createNode('LOD0').setMesh(mesh));
  const name = id.replace(/^set[A-Z]\./, '');
  const file = `${section}${String(meta.item).padStart(2, '0')}_${name}`;
  await io.write(path.join(outDir, `${file}.glb`), doc);
  const colParts = g.parts.filter((p) => p.collide);
  const ladders = laddersForMap([g]);
  const json = {
    schema_version: '1.1',
    id: file,
    asset_id: id,
    label_cs: def.label,
    category: `sada300_${section}`,
    asset_kind: 'building',
    footprint_m: [r4(box.max.x - box.min.x), r4(box.max.z - box.min.z)],
    height_m: r4(box.max.y),
    target_m: meta.target,
    bounds_m: { min: box.min.toArray().map(r4), max: box.max.toArray().map(r4) },
    triangles: { LOD0: tris },
    triangle_limits: { LOD0: 12000 },
    materials: [...mats].sort(),
    collision: colParts.map((p) => ({ ...collisionOf(p), surface: surfaceOf(p.material), ...(p.moveOnly ? { blocks: 'move' } : {}), ...(p.bulletOnly ? { blocks: 'bullets' } : {}) })),
    walkable_roof: meta.walkableRoof,
    ladders: ladders.map((l) => ({ base: [r4(l.base.x), r4(l.base.y), r4(l.base.z)], height: r4(l.height), facing_deg: r4((Math.atan2(l.facing.x, l.facing.z) * 180) / Math.PI) })),
    route: meta.route,
    doors_m: { width: 1.2, height: 2.25 },
    window_sill_m: 1.0,
    stairs: { riser_max_m: 0.185, tread_m: 0.3, collision: 'ramp' },
    units: 'meters',
    up: 'Y',
    front: '-Z',
    uv_units: 'meters',
    collision_rotation_order: 'Rz @ Ry @ Rx on column vectors; radians',
    notes: meta.notes,
    ...(meta.crawl ? { crawl_passages: meta.crawl } : {}),
    ...(def.terrainCut ? { terrain_cut: def.terrainCut(resolveParams(def, {})) } : {}),
    tested_in_game: false,
  };
  fs.writeFileSync(path.join(outDir, `${file}.json`), JSON.stringify(json, null, 1));
  const hasInterior = def.params.some((q) => q.key === 'interior');
  const walk = await walkRoute(id, meta.route, hasInterior ? { interior: true } : {});
  // Paprsky střel (kryt / průstřel) podle metadat.
  let rays = '–';
  if (meta.rays?.length) {
    const g = generateObject({ id: 'b', assetId: id, generatorVersion: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: resolveParams(def, {}), seed: 1 });
    const phys = await makeWorld(collidersForMap([g]));
    const ok = meta.rays.filter((r) => {
      const d = [r.to[0] - r.from[0], r.to[1] - r.from[1], r.to[2] - r.from[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      return !!phys.castRay({ x: r.from[0], y: r.from[1], z: r.from[2] }, { x: d[0] / l, y: d[1] / l, z: d[2] / l }, l) === r.hit;
    }).length;
    rays = `${ok === meta.rays.length ? '✔' : '✘'} ${ok}/${meta.rays.length}`;
    (json as Record<string, unknown>).bullet_checks = meta.rays.map((r) => ({ from: r.from, to: r.to, expect_hit: r.hit, note: r.note }));
    fs.writeFileSync(path.join(outDir, `${file}.json`), JSON.stringify(json, null, 1));
  }
  const closedKind = hasInterior ? 'uzavřená (interiér volitelně)' : /Uzavřen/.test(meta.notes.join(' ')) ? 'uzavřená' : 'přístupná';
  const dims = `${json.footprint_m[0].toFixed(2)} × ${json.footprint_m[1].toFixed(2)} × ${json.height_m.toFixed(2)}`;
  manifest.push({ item: meta.item, id: file, asset_id: id, label: def.label, glb: `${file}.glb`, json: `${file}.json`, render: `renders/${section}${String(meta.item).padStart(2, "0")}.jpg` });
  report.push(
    `| ${section}${String(meta.item).padStart(2, '0')} | ${def.label.replace(/^[A-Z]\d+ /, '')} | ${closedKind} | ${meta.target.join(' × ')} | ${dims} | ${tris} / 12000 | ${colParts.length}${colParts.length > 24 ? ' ⚠' : ''} | ${mats.size} | ${ladders.length} | ${walk.ok ? `✔ ${walk.reached}/${walk.total}` : `✘ bod ${walk.failAt!.index} (${walk.failAt!.reason})`} | ${rays} |`,
  );
  console.log('✓', file, tris, 'tris', colParts.length, 'kolizí', walk.ok ? 'trasa OK' : 'TRASA SELHALA');
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ section, generated: new Date().toISOString().slice(0, 10), models: manifest }, null, 1));
fs.writeFileSync(
  path.join(outDir, 'VALIDACE.md'),
  `# Sada 300 · ${section} – validační report\n\nAutomaticky z \`scripts/export-set.ts\`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.\n\n| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |\n|---|---|---|---|---|---|---|---|---|---|---|\n${report.join('\n')}\n\n**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.\n`,
);
console.log('hotovo', outDir);
