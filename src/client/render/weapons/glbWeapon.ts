import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildOptic } from './optic';
import { lathe } from './meshkit';
import { hipFromGrip, triCount, type MovingPart, type WeaponModel, type WeaponPoints } from './types';

/**
 * Zbraně z balíčků „CC0 Flat Guns West/East“ (Pichuliru, CC0 – viz ASSET_CREDITS.md).
 * GLB má kostru po dílech (zásobník, závěr, pumpa, mířidla) a body montáže (optika, ústí).
 * Převod na náš WeaponModel: barvy materiálů → barvy vrcholů, díly podle dominantní kosti,
 * body úchopu/mířidel z kloubů. Chování (styl přebití, cyklus, optika, zvětšení) se přebírá
 * z procedurálního modelu stejné zbraně, ať animace a pravidla zůstanou stejné.
 * Konvence je shodná s naší: metry, hlaveň k −Z, +Y nahoru.
 */

interface GunSpec {
  file: string;
  /** Pohyblivý díl natahování: kost závěru / páky / závěru pistole. */
  handle?: string;
  /** Optika: kolimátor nebo puškohled na bodu Attach_Scope (jinak mechanická mířidla). */
  optic?: 'reddot' | 'scope';
  /** Doladění pozice v pohledu z boku (hip) – posun proti referenčnímu úchopu. */
  hipAdjust?: [number, number, number];
}

export const GLB_GUNS: Record<string, GunSpec> = {
  m4a1: { file: 'Rifle_Assault_West.glb', handle: 'Charging_Handle', optic: 'reddot' },
  m16a2: { file: 'Rifle_Assault_West.glb', handle: 'Charging_Handle' },
  r870: { file: 'Shotgun_Pump_East.glb' },
  m24: { file: 'Sniper_Rifle_West.glb', handle: 'Bolt', optic: 'scope' },
  m9: { file: 'Pistol_Full_West.glb', handle: 'Slide' },
  ak101: { file: 'Rifle_Assault_East.glb', handle: 'Bolt', optic: 'reddot' },
  akm: { file: 'Rifle_Battle_East.glb', handle: 'Bolt' },
  saiga: { file: 'Shotgun_Auto_East.glb', handle: 'Bolt' },
  svd: { file: 'Sniper_Rifle_East.glb', handle: 'Bolt', optic: 'scope' },
  pm: { file: 'Pistol_Compact_East.glb', handle: 'Slide' },
};

/** Načtené scény podle souboru (jedno načtení pro více zbraní). */
const scenes = new Map<string, THREE.Object3D>();

/** Načte GLB zbraní (volá se při startu; bez načtení se použijí procedurální modely). */
export async function preloadGunModels(base = '/'): Promise<void> {
  const loader = new GLTFLoader();
  const files = [...new Set(Object.values(GLB_GUNS).map((g) => g.file))];
  await Promise.all(
    files.map(async (f) => {
      try {
        const g = await loader.loadAsync(`${base}models/weapons/${f}`);
        scenes.set(f, g.scene);
      } catch (e) {
        console.warn(`Model zbraně ${f} se nenačetl, zůstává procedurální.`, e);
      }
    }),
  );
}

/** Pro testy (Node): vloží už načtenou scénu. */
export function registerGunScene(file: string, scene: THREE.Object3D) {
  scenes.set(file, scene);
}

export function hasGlbGun(id: string) {
  const s = GLB_GUNS[id];
  return !!s && scenes.has(s.file);
}

interface Tri {
  bone: string;
  v: THREE.Vector3[];
  n: THREE.Vector3[];
  uv: THREE.Vector2[];
  c: THREE.Color;
}

/** Trojúhelníky modelu v klidové póze, každý s dominantní kostí a barvou materiálu. */
function extract(scene: THREE.Object3D): { tris: Tri[]; joints: Map<string, THREE.Vector3> } {
  scene.updateMatrixWorld(true);
  const tris: Tri[] = [];
  const joints = new Map<string, THREE.Vector3>();
  const nm = new THREE.Matrix3();
  scene.traverse((o) => {
    const sk = o as THREE.SkinnedMesh;
    if (!sk.isSkinnedMesh) return;
    for (const b of sk.skeleton.bones) joints.set(b.name, b.getWorldPosition(new THREE.Vector3()));
    const g = sk.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const mat = (Array.isArray(sk.material) ? sk.material[0] : sk.material) as THREE.MeshStandardMaterial;
    // Ploché barvy balíčku jsou velmi tmavé – lehce zesvětlit, ať černá není „díra“ ve stínu.
    const col = mat.color.clone().multiplyScalar(1.5).addScalar(0.012);
    nm.getNormalMatrix(sk.matrixWorld);
    const P = (i: number) => sk.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(sk.matrixWorld);
    const N = (i: number) => (nor ? new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(nm).normalize() : new THREE.Vector3(0, 1, 0));
    const U = (i: number) => (uv ? new THREE.Vector2(uv.getX(i), uv.getY(i)) : new THREE.Vector2());
    const boneOf = (i: number) => {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bw) {
          bw = w;
          best = si.getComponent(i, k);
        }
      }
      return sk.skeleton.bones[best].name;
    };
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let t = 0; t < count; t += 3) {
      const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      tris.push({ bone: boneOf(ids[0]), v: ids.map(P), n: ids.map(N), uv: ids.map(U), c: col });
    }
  });
  return { tris, joints };
}

/** Geometrie z trojúhelníků, posunutá o −pivot (díly se kreslí relativně k pivotu). */
function geom(tris: Tri[], pivot = new THREE.Vector3()): THREE.BufferGeometry {
  const n = tris.length * 3;
  const p = new Float32Array(n * 3), no = new Float32Array(n * 3), uv = new Float32Array(n * 2), c = new Float32Array(n * 3);
  let k = 0;
  for (const t of tris)
    for (let j = 0; j < 3; j++, k++) {
      p.set([t.v[j].x - pivot.x, t.v[j].y - pivot.y, t.v[j].z - pivot.z], k * 3);
      no.set([t.n[j].x, t.n[j].y, t.n[j].z], k * 3);
      uv.set([t.uv[j].x, t.uv[j].y], k * 2);
      c.set([t.c.r, t.c.g, t.c.b], k * 3);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(no, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeBoundingSphere();
  return g;
}

function bounds(tris: Tri[]) {
  const b = new THREE.Box3();
  for (const t of tris) for (const v of t.v) b.expandByPoint(v);
  return b;
}

/** Nejvyšší bod modelu v pásmu z ∈ [z0, z1] blízko svislé roviny (vrchol mířidla). */
function topIn(tris: Tri[], z0: number, z1: number): number {
  let y = -1;
  for (const t of tris) for (const v of t.v) if (v.z >= z0 && v.z <= z1 && Math.abs(v.x) < 0.006) y = Math.max(y, v.y);
  return y;
}

/**
 * Sestaví WeaponModel z načteného GLB. `proc` = procedurální model téže zbraně (zdroj chování).
 */
export function buildGlbWeapon(id: string, proc: WeaponModel): WeaponModel | null {
  const spec = GLB_GUNS[id];
  const scene = spec && scenes.get(spec.file);
  if (!spec || !scene) return null;
  const { tris, joints } = extract(scene);
  const J = (name: string) => joints.get(name)?.clone();
  const by = (names: string[]) => tris.filter((t) => names.includes(t.bone));
  const all = bounds(tris);

  const magBones = proc.reloadStyle === 'single' || proc.reloadStyle === 'bolt' ? ['Shell'] : ['Magazine'];
  const pumpBones = proc.moving.pump ? ['Pump'] : [];
  const handleBones = spec.handle && proc.moving.chargingHandle ? [spec.handle] : [];
  const movingSet = new Set([...magBones, ...pumpBones, ...handleBones]);
  const staticTris = tris.filter((t) => !movingSet.has(t.bone));

  // --- Body ---
  const trigger = J('Trigger') ?? new THREE.Vector3(0, -0.02, 0.08);
  const muzzle = J('Attach_Muzzle') ?? new THREE.Vector3(0, (() => {
    const front = tris.filter((t) => t.v.some((v) => v.z < all.min.z + 0.01));
    return front.length ? bounds(front).getCenter(new THREE.Vector3()).y : 0.02;
  })(), all.min.z);
  muzzle.z = Math.min(muzzle.z, all.min.z + 0.002);
  const pistol = proc.slideCycle === true;
  const gripRight = trigger.clone().add(new THREE.Vector3(0, pistol ? -0.05 : -0.045, pistol ? 0.028 : 0.042));
  const pumpT = by(pumpBones);
  const pumpCenter = pumpT.length ? bounds(pumpT).getCenter(new THREE.Vector3()) : null;
  const railBottom = J('Attach_RailBottom');
  const gripLeft = pistol
    ? gripRight.clone().add(new THREE.Vector3(0, -0.012, -0.022))
    : pumpCenter
      ? new THREE.Vector3(0, bounds(pumpT).min.y + 0.01, pumpCenter.z)
      : railBottom
        ? new THREE.Vector3(0, railBottom.y - 0.005, Math.max(railBottom.z, muzzle.z + 0.12))
        : new THREE.Vector3(0, trigger.y + 0.01, (trigger.z + muzzle.z) / 2);

  // --- Mířidla / optika ---
  const metalOptic: THREE.BufferGeometry[] = [];
  let optic: WeaponModel['optic'];
  let sightRear: THREE.Vector3, sightFront: THREE.Vector3, eye: THREE.Vector3;
  const scopeAt = J('Attach_Scope') ?? new THREE.Vector3(0, all.max.y, trigger.z - 0.06);
  if (spec.optic === 'reddot') {
    const axisY = scopeAt.y + 0.054; // zvýšená montáž: mechanická mířidla zůstanou ve spodní třetině průhledu
    const z0 = scopeAt.z + 0.04, z1 = z0 - 0.117;
    const S = (n: number) => n;
    const o = buildOptic(axisY, z0, z1, S);
    metalOptic.push(...o.metal);
    metalOptic.push(colorBox(0.016, axisY - scopeAt.y - 0.017, 0.044, [0, (axisY - 0.017 + scopeAt.y) / 2, (z0 + z1) / 2], 0.012));
    metalOptic.push(colorBox(0.03, 0.01, 0.05, [0, scopeAt.y + 0.004, (z0 + z1) / 2], 0.012));
    optic = { lensZ: o.lensZ, axisY, innerR: o.innerR, glass: o.glass, kind: 'reddot' };
    sightRear = new THREE.Vector3(0, axisY, z0);
    sightFront = new THREE.Vector3(0, axisY, z1);
    eye = new THREE.Vector3(0, axisY, z0 + 0.095);
  } else if (spec.optic === 'scope') {
    // Puškohled: dutý tubus (objektiv vpředu širší), dva kroužky na montáži.
    const axisY = scopeAt.y + 0.048;
    const z0 = scopeAt.z + 0.16, z1 = scopeAt.z - 0.16;
    const rIn = 0.0125, rTube = 0.0155, rObj = 0.024;
    const prof: Array<[number, number]> = [
      [rIn, -z0], [0.02, -z0], [0.02, -z0 + 0.06], [rTube, -z0 + 0.08], [rTube, -z1 - 0.08], [rObj, -z1 - 0.03], [rObj, -z1], [rIn, -z1], [rIn, -z0],
    ];
    metalOptic.push(lathe(prof, 24, '#1b1c1d', 0, axisY, true));
    for (const dz of [0.06, -0.06]) {
      const ring = lathe([[0, -0.006], [0.019, -0.006], [0.019, 0.006], [0, 0.006]], 16, '#1b1c1d', 0, axisY);
      ring.translate(0, 0, scopeAt.z + dz);
      metalOptic.push(ring);
      metalOptic.push(colorBox(0.012, axisY - scopeAt.y - 0.012, 0.012, [0, (axisY + scopeAt.y) / 2 - 0.006, scopeAt.z + dz], 0.012));
    }
    const glass = new THREE.CircleGeometry(rIn + 0.0005, 24);
    glass.translate(0, axisY, z0 - 0.012);
    optic = { lensZ: z0 - 0.012, axisY, innerR: rIn, glass, kind: 'scope', zoom: proc.optic?.zoom ?? 4, reticle: proc.optic?.reticle ?? 'mildot' };
    sightRear = new THREE.Vector3(0, axisY, z0);
    sightFront = new THREE.Vector3(0, axisY, z1);
    eye = new THREE.Vector3(0, axisY, z0 + 0.08);
  } else {
    // Mechanická mířidla: vrchol muška/hledí (pojmenované díly, jinak nejvyšší bod u ústí a nad pouzdrem).
    const fs = by(['Front_Sights']), rs = by(['Rear_Sights']);
    const slide = by(['Slide']);
    let yF: number, yR: number, zF: number, zR: number;
    if (fs.length && rs.length) {
      zF = J('Front_Sights')!.z;
      zR = J('Rear_Sights')!.z;
      yF = bounds(fs).max.y - 0.004;
      yR = bounds(rs).max.y - 0.004;
    } else if (pistol && slide.length) {
      const b = bounds(slide);
      zF = b.min.z + 0.008;
      zR = b.max.z - 0.01;
      yF = yR = b.max.y;
    } else {
      zF = muzzle.z + 0.06;
      zR = trigger.z - 0.04;
      yF = topIn(tris, muzzle.z, muzzle.z + 0.14);
      yR = Math.max(yF, topIn(tris, zR - 0.08, zR));
      yR = yF; // rovnoběžná záměrná přímka (muška ve středu průzoru)
    }
    sightFront = new THREE.Vector3(0, yF, zF);
    sightRear = new THREE.Vector3(0, yR, zR);
    eye = sightRear.clone().add(new THREE.Vector3(0, 0, pistol ? 0.45 : fs.length ? 0.1 : 0.17));
  }

  // --- Pohyblivé díly (pivot = kloub kosti) ---
  const part = (bones: string[], mat: 'metal' | 'polymer', travel?: THREE.Vector3): MovingPart | undefined => {
    const t = by(bones);
    if (!t.length) return undefined;
    const pivot = J(bones[0]) ?? bounds(t).getCenter(new THREE.Vector3());
    return { geometry: geom(t, pivot), material: mat, pivot, travel };
  };
  const mag = part(magBones, 'metal') ?? { geometry: geom([]), material: 'metal' as const, pivot: J('Magazine') ?? new THREE.Vector3() };
  const handle = handleBones.length ? part(handleBones, 'metal', proc.moving.chargingHandle?.travel?.clone()) : undefined;
  const pump = pumpBones.length ? part(pumpBones, 'polymer', proc.moving.pump?.travel?.clone()) : undefined;

  const hb = handle ? bounds(by(handleBones)) : null;
  const bolt = J('Bolt') ?? trigger.clone().add(new THREE.Vector3(0, 0.04, -0.05));
  const points: WeaponPoints = {
    weaponRoot: new THREE.Vector3(),
    muzzle,
    sightRear,
    sightFront,
    opticEye: eye,
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight,
    gripLeft,
    magazineSocket: mag.pivot.clone(),
    ejectionPort: bolt.clone().add(new THREE.Vector3(0.016, 0.006, 0)),
    chargingHandle: hb ? new THREE.Vector3(hb.max.x - 0.004, (hb.min.y + hb.max.y) / 2, hb.max.z - 0.01) : bolt.clone(),
    boltCatch: J('Bolt_Release') ?? J('Slide_Release') ?? J('Magazine_Release') ?? trigger.clone(),
  };
  if (pump && pumpCenter) points.pumpGrip = new THREE.Vector3(0, bounds(pumpT).min.y + 0.004, pumpCenter.z);
  if (proc.points.loadingPort) points.loadingPort = J('Lifter') ?? trigger.clone().add(new THREE.Vector3(0, -0.01, -0.06));

  const staticG = geom(staticTris);
  const metal = metalOptic.length ? mergeLike(staticGeomFor(metalOptic)) : emptyLike();
  const procAdjust = proc.hipRoot.clone().sub(hipFromGrip(proc.points.gripRight));
  const hipRoot = hipFromGrip(gripRight).add(procAdjust).add(new THREE.Vector3(...(spec.hipAdjust ?? [0, 0, 0])));
  return {
    ...proc,
    id,
    static: { metal, polymer: staticG },
    moving: {
      magazine: mag,
      ...(handle ? { chargingHandle: handle } : {}),
      ...(pump ? { pump } : {}),
    },
    optic,
    sight: optic ? 'optic' : 'iron',
    points,
    hipRoot,
    triangles: triCount(staticG, metal, mag.geometry, handle?.geometry, pump?.geometry, optic?.glass),
  };
}

/** Optika z generátoru (indexované i neindexované díly) → jednotný neindexovaný formát s UV. */
function staticGeomFor(gs: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  return gs.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    if (!x.attributes.normal) x.computeVertexNormals();
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) x.deleteAttribute(k);
    return x;
  });
}

function mergeLike(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [k, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]] as const) {
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of gs) {
      const a = g.attributes[k] as THREE.BufferAttribute | undefined;
      if (a) arr.set(a.array as Float32Array, o);
      o += g.attributes.position.count * size;
    }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/** Kvádr s jednotnou barvou vrcholů (lineární šedá). */
function colorBox(w: number, h: number, d: number, at: [number, number, number], grey: number): THREE.BufferGeometry {
  const b = new THREE.BoxGeometry(w, Math.max(0.002, h), d).toNonIndexed();
  b.translate(...at);
  b.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.attributes.position.count * 3).fill(grey), 3));
  return b;
}

function emptyLike(): THREE.BufferGeometry {
  return geom([]);
}
