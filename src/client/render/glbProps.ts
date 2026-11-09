import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLB_PROPS } from '../../world/assets/glbProps.data';

/**
 * Sítě modelů GLB pro díly 'model' (viz world/assets/glbProps). Po načtení: pro každý model
 * seznam (materiál → pozice, normály, UV v metrech) v lokálním prostoru objektu.
 */
export interface ModelMesh {
  material: string;
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
}

const meshes = new Map<string, ModelMesh[]>();

export function modelMeshes(id: string): ModelMesh[] | undefined {
  return meshes.get(id);
}

export async function preloadGlbProps(base = '/'): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    GLB_PROPS.map(async (d) => {
      try {
        const g = await loader.loadAsync(`${base}models/props/${d.id}.glb`);
        registerPropScene(d.id, g.scene);
      } catch (e) {
        console.warn(`Model ${d.id} se nenačetl (v editoru zůstane obálka).`, e);
      }
    }),
  );
}

/** Rozloží scénu GLB na sítě podle materiálu (i pro testy v Node). */
export function registerPropScene(id: string, scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const out: ModelMesh[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry;
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv');
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const pos = new Float32Array(P.count * 3), nrm = new Float32Array(P.count * 3), uv = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld).toArray(pos, i * 3);
      if (N) v.fromBufferAttribute(N as THREE.BufferAttribute, i).applyMatrix3(nm).normalize().toArray(nrm, i * 3);
      if (U) uv.set([U.getX(i), U.getY(i)], i * 2);
    }
    const index = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: P.count }, (_, i) => i);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    out.push({ material: mat?.name || 'concrete', pos, nrm, uv, index });
  });
  meshes.set(id, out);
}
