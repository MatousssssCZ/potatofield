import * as THREE from 'three';
import type { TerrainData } from '../../shared/map/schema';
import { heightAt } from '../../world/terrain';

/**
 * Daleký plán (jen vzhled, bez kolize): věnec kopců kolem terénu mapy, který plynule navazuje na jeho okraj,
 * a siluety vzdálených budov a nádrží za nimi. Barvu do dálky dává mlha scény, takže plány vybledají jako v BF2.
 * Deterministické (stejné kopce při každém načtení), žádné textury navíc.
 */
function hash(x: number, z: number) {
  let h = Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(z), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a + (b - a) * s(fx)) * (1 - s(fz)) + (c + (d - c) * s(fx)) * s(fz);
}
function fbm(x: number, z: number) {
  return vnoise(x * 0.004, z * 0.004) * 0.55 + vnoise(x * 0.011 + 17, z * 0.011) * 0.28 + vnoise(x * 0.03 + 5, z * 0.03 + 9) * 0.12;
}

export function buildSurround(t: TerrainData, sand: THREE.Texture | undefined): THREE.Group {
  const g = new THREE.Group();
  g.name = '__surround';
  const x0 = t.origin[0], z0 = t.origin[1];
  const x1 = x0 + (t.samplesX - 1) * t.spacing, z1 = z0 + (t.samplesZ - 1) * t.spacing;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const hw = (x1 - x0) / 2, hd = (z1 - z0) / 2;
  const SEG = 128;
  // Poloměry prstenců od okraje terénu (m): hustě u okraje, řidčeji do dálky.
  const rings = [0, 6, 14, 26, 44, 70, 105, 150, 210, 290, 400, 560, 780, 1050];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const edgeY = (dx: number, dz: number) => {
    const px = Math.max(x0, Math.min(x1, cx + dx)), pz = Math.max(z0, Math.min(z1, cz + dz));
    return heightAt(t, px, pz) ?? 0;
  };
  for (let r = 0; r < rings.length; r++)
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      // Bod na okraji obdélníku ve směru a, odsazený o rings[r] ven.
      const k = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dz) / hd);
      const ex = dx * k, ez = dz * k;
      const wx = cx + ex + dx * rings[r], wz = cz + ez + dz * rings[r];
      const base = edgeY(ex, ez);
      const d = rings[r];
      // Výška: od okraje stoupá šumem do kopců (nejvýš ~45 m), nejdřív pozvolna, aby navazovala na val mapy.
      const ramp = Math.min(1, d / 160);
      const hills = (fbm(wx, wz) - 0.28) * 95 * ramp * ramp * (0.4 + 0.6 * Math.min(1, d / 400));
      const y = base + Math.max(-1.5, hills) - (d === 0 ? 0.04 : 0);
      pos.push(wx, y, wz);
      uv.push(wx / 6, wz / 6);
    }
  for (let r = 0; r < rings.length - 1; r++)
    for (let i = 0; i < SEG; i++) {
      const a = r * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#c9ad82', roughness: 1, metalness: 0, map: sand ?? null });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  mesh.frustumCulled = false;
  g.add(mesh);

  // Vzdálené budovy a nádrže: siluety v pásu 450–900 m (mlha je zbarví do oparu).
  const boxes: THREE.Matrix4[] = [], cyls: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const surfY = (wx: number, wz: number) => {
    const dxm = Math.max(0, Math.abs(wx - cx) - hw), dzm = Math.max(0, Math.abs(wz - cz) - hd);
    const d = Math.hypot(dxm, dzm);
    const ex = Math.max(-hw, Math.min(hw, wx - cx)), ez = Math.max(-hd, Math.min(hd, wz - cz));
    const ramp = Math.min(1, d / 160);
    return edgeY(ex, ez) + Math.max(-1.5, (fbm(wx, wz) - 0.28) * 95 * ramp * ramp * (0.4 + 0.6 * Math.min(1, d / 400)));
  };
  let tries = 0;
  while (boxes.length + cyls.length < 70 && tries++ < 600) {
    const a = hash(tries, 3) * Math.PI * 2;
    const dist = 430 + hash(tries, 11) * 420;
    const wx = cx + Math.cos(a) * (hw + dist), wz = cz + Math.sin(a) * (hd + dist);
    const y = surfY(wx, wz);
    // Jen v mírných polohách (ne na vrcholech kopců); shluky podle šumu → „městečka“.
    if (vnoise(wx * 0.006, wz * 0.006) < 0.5) continue;
    const w = 10 + hash(tries, 5) * 30, d = 8 + hash(tries, 7) * 22, h = 5 + hash(tries, 9) * 14;
    if (hash(tries, 13) < 0.12) {
      q.setFromAxisAngle(up, 0);
      p.set(wx, y + h * 0.8, wz);
      s.set(7, h * 1.6, 7);
      m.compose(p, q, s);
      cyls.push(m.clone());
    } else {
      q.setFromAxisAngle(up, hash(tries, 17) * Math.PI);
      p.set(wx, y + h / 2 - 0.5, wz);
      s.set(w, h, d);
      m.compose(p, q, s);
      boxes.push(m.clone());
    }
  }
  const bm = new THREE.MeshStandardMaterial({ color: '#b5a78c', roughness: 1 });
  const ib = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bm, boxes.length);
  boxes.forEach((mm, i) => ib.setMatrixAt(i, mm));
  const ic = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), bm, cyls.length);
  cyls.forEach((mm, i) => ic.setMatrixAt(i, mm));
  for (const im of [ib, ic]) {
    im.frustumCulled = false;
    im.raycast = () => {};
    g.add(im);
  }
  return g;
}
