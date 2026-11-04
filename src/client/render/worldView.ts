import * as THREE from 'three';
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
  private terrainMesh: THREE.Mesh | null = null;
  private targets: Array<{ mesh: THREE.Object3D; base: THREE.Vector3; amp: number; speed: number; axis: THREE.Vector3 }> = [];

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
    const group = new THREE.Group();
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
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(l.w, l.h), this.mats.label(l.text));
      mesh.applyMatrix4(l.matrix);
      mesh.receiveShadow = true;
      mesh.userData.objectId = o.id;
      group.add(mesh);
    }
    if (o.assetId === 'range.target') this.addTargetFigure(group, o.params);
    group.updateMatrixWorld(true);
    this.root.add(group);
    this.objects.set(o.id, group);
  }

  removeObject(id: string) {
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
    if (params.moving) {
      this.targets.push({ mesh: fig, base: fig.position.clone(), amp: Number(params.amplitude) || 4, speed: Number(params.speed) || 2, axis: new THREE.Vector3(1, 0, 0) });
    }
  }

  /** Deterministický pohyb terčů z času simulace. */
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
    const sand = this.textures.get('sand')!, dirt = this.textures.get('dirt')!;
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
      sh.uniforms.uMacro = sharedUniforms.uMacro;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vUpN;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUpN = normal.y;',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D uDirt;\nuniform sampler2D uDirtN;\nuniform sampler2D uMacro;\nvarying vec3 vWPos;\nvarying float vUpN;\nfloat gTerrainMix;',
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
            gTerrainMix = clamp(smoothstep(0.45, 0.75, m1 * 0.75 + m2 * 0.35) + slope, 0.0, 1.0);
            vec4 col = mix(sA, dA, gTerrainMix);
            col.rgb *= 0.86 + 0.26 * m2;
            diffuseColor *= col;
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
            vec3 nA = texture2D(normalMap, vNormalMapUv).xyz;
            vec3 nB = texture2D(uDirtN, vNormalMapUv * 0.9).xyz;
            vec3 mapN = mix(nA, nB, gTerrainMix) * 2.0 - 1.0;
            mapN.xy *= normalScale;
            normal = normalize( tbn * mapN );
          }`,
        );
    };
    m.customProgramCacheKey = () => 'terrain-v1';
    this.terrainMat = m;
    return m;
  }

  clear() {
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
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
