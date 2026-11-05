import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapDocument, TerrainData } from '../../shared/map/schema';
import type { GeneratedObject } from '../../world/registry';
import { buildObjectGeometry } from './geometry';
import { MATERIALS, sharedUniforms, type MaterialLibrary, type TexSet } from './materials';

/**
 * Vizuální reprezentace mapy. Každý objekt mapy = jedna skupina se stabilním ID
 * (editor tak může vybírat a přegenerovat jednotlivé objekty). Geometrie se při
 * odstranění uvolní, aby opakované změny nezvyšovaly paměť.
 */
export class WorldView {
  readonly root = new THREE.Group();
  readonly objects = new Map<string, THREE.Group>();
  /** Objekty zobrazené jako placeholder (chybějící asset / novější generátor). */
  readonly missing = new Map<string, string>();
  mode: 'editor' | 'play' = 'editor';
  private terrainMesh: THREE.Mesh | null = null;
  get terrain() {
    return this.terrainMesh;
  }
  readonly slopeDebug = { value: 0 };

  /** Aktualizace renderu terénu po tahu štětcem (výšky, malba, normály) bez přestavby materiálu. */
  updateTerrain(t: TerrainData) {
    const m = this.terrainMesh;
    if (!m) return this.setTerrain(t);
    const g = m.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    if (pos.count !== t.heights.length) return this.setTerrain(t);
    for (let i = 0; i < t.heights.length; i++) pos.setY(i, t.heights[i]);
    pos.needsUpdate = true;
    const d = g.getAttribute('aDirt') as THREE.BufferAttribute, u = g.getAttribute('aUrban') as THREE.BufferAttribute;
    for (let i = 0; i < t.heights.length; i++) {
      d.setX(i, t.dirt?.[i] ?? 0);
      u.setX(i, t.urban?.[i] ?? 0);
    }
    d.needsUpdate = u.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }
  private targets: Array<{ id: string; mesh: THREE.Object3D; base: THREE.Vector3; amp: number; speed: number; axis: THREE.Vector3 }> = [];

  constructor(
    private mats: MaterialLibrary,
    private textures: Map<string, TexSet>,
  ) {
    this.root.name = 'world';
  }

  build(doc: MapDocument, gen: GeneratedObject[]) {
    this.clear();
    this.setTerrain(doc.terrain);
    for (const g of gen) this.addObject(g);
  }

  addObject(g: GeneratedObject) {
    const o = g.object;
    if (this.batches.length) this.clearBatches(); // změna světa ruší sloučení (správnost má přednost)
    if (this.objects.has(o.id)) this.removeObject(o.id);
    if (g.missing) this.missing.set(o.id, g.missing);
    else this.missing.delete(o.id);
    const group = new THREE.Group();
    group.userData.editorHidden = !!o.editor?.hidden;
    group.userData.gameHidden = !!o.gameHidden;
    group.name = o.id;
    group.userData.objectId = o.id;
    const [px, py, pz] = o.transform.position;
    group.position.set(px, py, pz);
    group.rotation.set(o.transform.rotation[0], o.transform.rotation[1], o.transform.rotation[2], 'XYZ');
    group.scale.setScalar(o.transform.scale ?? 1);
    const geo = buildObjectGeometry(g.parts);
    for (const [key, { geometry, castShadow }] of geo.byMaterial) {
      const matId = key.split('|')[0];
      const mesh = new THREE.Mesh(geometry, this.mats.get(matId));
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.userData.objectId = o.id;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    for (const l of geo.labels) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(l.w, l.h), this.mats.label(l.text, l.style));
      mesh.applyMatrix4(l.matrix);
      mesh.receiveShadow = true;
      mesh.userData.objectId = o.id;
      group.add(mesh);
    }
    if (o.assetId === 'range.target') this.addTargetFigure(group, o.params);
    this.applyVisibility(group);
    group.updateMatrixWorld(true);
    this.root.add(group);
    this.objects.set(o.id, group);
  }

  private applyVisibility(g: THREE.Object3D) {
    g.visible = this.mode === 'editor' ? !g.userData.editorHidden : !g.userData.gameHidden;
  }

  /** Editor: skrytí v editoru; hra: herní viditelnost (skrytí v editoru hru nemění). */
  setMode(mode: 'editor' | 'play') {
    this.mode = mode;
    for (const g of this.objects.values()) this.applyVisibility(g);
    // Ve hře se svět nemění: statické díly se sloučí podle materiálu (méně draw calls ve scéně i ve stínech).
    if (mode === 'play') this.buildBatches();
    else this.clearBatches();
  }

  /** Sloučené statické meshe herního režimu a zdrojové meshe, které skrývají. */
  private batches: THREE.Mesh[] = [];
  private batchedSources: THREE.Mesh[] = [];
  /** Velikost buňky slučování (m) – zachová ořez mimo zorné pole i po sloučení. */
  static readonly BATCH_CELL = 40;

  /**
   * Sloučení přímých meshů objektů podle (materiál, vrhá stín, atributy, buňka mřížky).
   * Pohyblivé části (figuríny terčů) jsou ve vnořených skupinách, a proto se neslučují.
   */
  buildBatches() {
    this.clearBatches();
    const groups = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[]; srcs: THREE.Mesh[] }>();
    const C = WorldView.BATCH_CELL;
    for (const g of this.objects.values()) {
      if (!g.visible) continue;
      g.updateMatrixWorld(true);
      for (const c of g.children) {
        if (!(c instanceof THREE.Mesh) || !c.visible || Array.isArray(c.material)) continue;
        const geo = c.geometry as THREE.BufferGeometry;
        const sig = Object.keys(geo.attributes).sort().join(',') + (geo.index ? ':i' : ':n');
        const key = `${c.material.uuid}|${c.castShadow ? 1 : 0}|${sig}|${Math.floor(g.position.x / C)},${Math.floor(g.position.z / C)}`;
        let e = groups.get(key);
        if (!e) groups.set(key, (e = { mat: c.material, cast: c.castShadow, geos: [], srcs: [] }));
        e.geos.push(geo.clone().applyMatrix4(c.matrixWorld));
        e.srcs.push(c);
      }
    }
    for (const e of groups.values()) {
      if (e.srcs.length < 2) {
        for (const g of e.geos) g.dispose();
        continue;
      }
      const merged = mergeGeometries(e.geos, false);
      for (const g of e.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, e.mat);
      m.castShadow = e.cast;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.name = '__batch';
      this.root.add(m);
      this.batches.push(m);
      for (const s of e.srcs) {
        s.visible = false;
        this.batchedSources.push(s);
      }
    }
  }

  clearBatches() {
    for (const m of this.batches) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    for (const s of this.batchedSources) s.visible = true;
    this.batches = [];
    this.batchedSources = [];
  }

  /** Počet sloučených meshů (diagnostika a testy). */
  get batchStats() {
    return { batches: this.batches.length, sources: this.batchedSources.length };
  }

  removeObject(id: string) {
    if (this.batches.length) this.clearBatches();
    this.missing.delete(id);
    const g = this.objects.get(id);
    if (!g) return;
    g.traverse((c) => {
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    });
    this.targets = this.targets.filter((t) => !isDescendant(t.mesh, g));
    g.removeFromParent();
    this.objects.delete(id);
  }

  /** Runtime figurína terče (v pozdějším kroku dostane hitbox a zásahy). */
  private addTargetFigure(group: THREE.Group, params: Record<string, unknown>) {
    const fig = new THREE.Group();
    const mat = this.mats.get('target');
    const dark = this.mats.get('woodDark');
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.035), mat);
    torso.position.y = 1.0;
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.035), mat);
    shoulders.position.y = 1.3;
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.03), mat);
    neck.position.y = 1.42;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.27, 0.035), mat);
    head.position.y = 1.58;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), dark);
    post.position.y = 0.4;
    for (const m of [torso, shoulders, neck, head, post]) {
      m.castShadow = true;
      m.receiveShadow = true;
      addBaseH(m.geometry as THREE.BufferGeometry, m.position.y);
      fig.add(m);
    }
    // Kruhový zásahový terč namalovaný na trupu.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.1, 24), new THREE.MeshStandardMaterial({ color: '#3a2c22', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    ring.position.set(0, 1.05, 0.0185);
    fig.add(ring);
    const ring2 = ring.clone();
    ring2.rotation.y = Math.PI;
    ring2.position.z = -0.0185;
    fig.add(ring2);
    group.add(fig);
    this.targets.push({ id: group.userData.objectId, mesh: fig, base: fig.position.clone(), amp: params.moving ? Number(params.amplitude) || 4 : 0, speed: params.moving ? Number(params.speed) || 2 : 0, axis: new THREE.Vector3(1, 0, 0) });
  }

  /** Deterministický pohyb terčů z času simulace. */
  /** Figuríny ze simulace (poloha a sražení); prázdný seznam = výchozí stav (editor). */
  updateDummies(list: Array<{ id: string; offset: number; down: boolean }>) {
    const m = new Map(list.map((d) => [d.id, d]));
    for (const t of this.targets) {
      const d = m.get(t.id);
      t.mesh.position.copy(t.base).addScaledVector(t.axis, d ? d.offset : 0);
      const want = d?.down ? -1.45 : 0;
      t.mesh.rotation.x += (want - t.mesh.rotation.x) * 0.25;
    }
  }

  update(simTime: number) {
    for (const t of this.targets) {
      const period = (4 * t.amp) / Math.max(0.1, t.speed);
      const ph = (simTime % period) / period;
      // Trojúhelníkový průběh = konstantní rychlost.
      const s = ph < 0.5 ? -1 + 4 * ph : 3 - 4 * ph;
      t.mesh.position.copy(t.base).addScaledVector(t.axis, s * t.amp);
    }
  }

  setTerrain(t: TerrainData) {
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      this.terrainMesh.removeFromParent();
    }
    const geo = terrainGeometry(t, MATERIALS.sand.tile);
    const mat = this.terrainMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = '__terrain';
    mesh.userData.objectId = '__terrain';
    this.root.add(mesh);
    this.terrainMesh = mesh;
  }

  private terrainMat: THREE.MeshStandardMaterial | null = null;
  private terrainMaterial(): THREE.MeshStandardMaterial {
    if (this.terrainMat) return this.terrainMat;
    const sand = this.textures.get('sand')!, dirt = this.textures.get('dirt')!, urban = this.textures.get('concreteDark')!;
    const m = new THREE.MeshStandardMaterial({
      map: sand.map,
      normalMap: sand.normalMap,
      roughnessMap: sand.orm,
      aoMap: sand.orm,
      roughness: 1,
      metalness: 0,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uDirt = { value: dirt.map };
      sh.uniforms.uDirtN = { value: dirt.normalMap };
      sh.uniforms.uUrban = { value: urban.map };
      sh.uniforms.uUrbanN = { value: urban.normalMap };
      sh.uniforms.uMacro = sharedUniforms.uMacro;
      sh.uniforms.uSlopeDebug = this.slopeDebug;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDirt;\nattribute float aUrban;\nvarying vec3 vWPos;\nvarying float vUpN;\nvarying float vDirt;\nvarying float vUrban;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUpN = normal.y;\nvDirt = aDirt;\nvUrban = aUrban;',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D uDirt;\nuniform sampler2D uDirtN;\nuniform sampler2D uUrban;\nuniform sampler2D uUrbanN;\nuniform sampler2D uMacro;\nuniform float uSlopeDebug;\nvarying vec3 vWPos;\nvarying float vUpN;\nvarying float vDirt;\nvarying float vUrban;\nfloat gTerrainMix;\nfloat gUrbanMix;',
        )
        .replace(
          '#include <map_fragment>',
          `{
            // Dvě měřítka vzorkování + makro šum = potlačení viditelného opakování dlaždic.
            vec2 uvA = vMapUv;
            vec2 uvB = vMapUv * 0.37 + vec2(0.31, 0.77);
            float m1 = texture2D(uMacro, vWPos.xz * 0.009).r;
            float m2 = texture2D(uMacro, vWPos.xz * 0.045).g;
            vec4 sA = mix(texture2D(map, uvA), texture2D(map, uvB), 0.45);
            vec4 dA = mix(texture2D(uDirt, uvA * 0.9), texture2D(uDirt, uvB * 1.1), 0.45);
            float slope = 1.0 - smoothstep(0.75, 0.95, vUpN);
            gTerrainMix = clamp(max(smoothstep(0.45, 0.75, m1 * 0.75 + m2 * 0.35) + slope, smoothstep(0.0, 1.0, vDirt + (m2 - 0.5) * 0.3 * vDirt)), 0.0, 1.0);
            gUrbanMix = clamp(vUrban + (m2 - 0.5) * 0.4 * vUrban, 0.0, 1.0);
            vec4 col = mix(sA, dA, gTerrainMix);
            vec4 uA = mix(texture2D(uUrban, uvA * 1.4), texture2D(uUrban, uvB * 1.7), 0.4);
            col = mix(col, uA, gUrbanMix);
            col.rgb *= 0.86 + 0.26 * m2;
            // Debug: příliš prudké svahy (> 45°) červeně (jen zobrazení, nic se nevyrovnává).
            if (uSlopeDebug > 0.5 && vUpN < 0.7071) col.rgb = mix(col.rgb, vec3(1.0, 0.1, 0.05), 0.65);
            diffuseColor *= col;
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
            vec3 nA = texture2D(normalMap, vNormalMapUv).xyz;
            vec3 nB = texture2D(uDirtN, vNormalMapUv * 0.9).xyz;
            vec3 nU = texture2D(uUrbanN, vNormalMapUv * 1.4).xyz;
            vec3 mapN = mix(mix(nA, nB, gTerrainMix), nU, gUrbanMix) * 2.0 - 1.0;
            mapN.xy *= normalScale;
            normal = normalize( tbn * mapN );
          }`,
        );
    };
    m.customProgramCacheKey = () => 'terrain-v2';
    this.terrainMat = m;
    return m;
  }

  clear() {
    this.clearBatches();
    for (const id of [...this.objects.keys()]) this.removeObject(id);
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      this.terrainMesh.removeFromParent();
      this.terrainMesh = null;
    }
    this.targets = [];
  }
}

function isDescendant(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** BoxGeometry nemá atribut aBaseH (prach u paty) – doplnit výšku vrcholu nad podstavou. */
function addBaseH(g: THREE.BufferGeometry, offsetY: number) {
  const p = g.getAttribute('position');
  const arr = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) arr[i] = p.getY(i) + offsetY;
  g.setAttribute('aBaseH', new THREE.BufferAttribute(arr, 1));
}

export function terrainGeometry(t: TerrainData, tile: number): THREE.BufferGeometry {
  const nx = t.samplesX, nz = t.samplesZ;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      const i = z * nx + x;
      const wx = t.origin[0] + x * t.spacing, wz = t.origin[1] + z * t.spacing;
      pos[i * 3] = wx;
      pos[i * 3 + 1] = t.heights[i];
      pos[i * 3 + 2] = wz;
      uv[i * 2] = wx / tile;
      uv[i * 2 + 1] = wz / tile;
    }
  const idx: number[] = [];
  // Stejná triangulace jako Rapier heightfield (diagonála z (x,z) do (x+1,z+1)),
  // aby se vizuální povrch a kolize neodchylovaly.
  for (let z = 0; z < nz - 1; z++)
    for (let x = 0; x < nx - 1; x++) {
      const a = z * nx + x, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aDirt', new THREE.BufferAttribute(Float32Array.from(t.dirt ?? new Array(nx * nz).fill(0)), 1));
  g.setAttribute('aUrban', new THREE.BufferAttribute(Float32Array.from(t.urban ?? new Array(nx * nz).fill(0)), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
