import * as THREE from 'three';
import type { Part } from '../../world/parts';
import { tileOf } from './materials';
import { blobRadius, icosphere } from '../../world/blob';

/**
 * Převádí díly objektu na render geometrii v lokálním prostoru objektu.
 * UV jsou v metrech děleno velikostí dlaždice materiálu → textury se při
 * změně rozměru opakují, nikdy nenatahují. Díly stejného materiálu se slučují.
 */
class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  baseH: number[] = [];
  idx: number[] = [];
  vcount = 0;

  quad(p: THREE.Vector3[], n: THREE.Vector3, uvs: [number, number][]) {
    const b = this.vcount;
    for (let i = 0; i < 4; i++) this.vert(p[i], n, uvs[i]);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  tri(p: THREE.Vector3[], n: THREE.Vector3, uvs: [number, number][]) {
    const b = this.vcount;
    for (let i = 0; i < 3; i++) this.vert(p[i], n, uvs[i]);
    this.idx.push(b, b + 1, b + 2);
  }
  vert(p: THREE.Vector3, n: THREE.Vector3, uv: [number, number]) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(uv[0], uv[1]);
    this.baseH.push(p.y);
    this.vcount++;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBaseH', new THREE.Float32BufferAttribute(this.baseH, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _n = new THREE.Matrix3();

function partMatrix(part: Part, scale: number): THREE.Matrix4 {
  _e.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0, 'XYZ');
  _q.setFromEuler(_e);
  return _m.compose(new THREE.Vector3(part.pos[0] * scale, part.pos[1] * scale, part.pos[2] * scale), _q, new THREE.Vector3(scale, scale, scale));
}

/** Plochá stěna s UV v metrech: osy u, v jsou lokální osy dílu. Offset dílu drží návaznost textur. */
function addFace(
  b: Builder,
  mat: THREE.Matrix4,
  nmat: THREE.Matrix3,
  corners: THREE.Vector3[],
  normal: THREE.Vector3,
  uAxis: 'x' | 'y' | 'z',
  vAxis: 'x' | 'y' | 'z',
  off: THREE.Vector3,
  tile: number,
  flipU: boolean,
) {
  const uvs = corners.map((c) => [((flipU ? -1 : 1) * (c[uAxis] + off[uAxis])) / tile, (c[vAxis] + off[vAxis]) / tile] as [number, number]);
  const wp = corners.map((c) => c.clone().applyMatrix4(mat));
  const wn = normal.clone().applyMatrix3(nmat).normalize();
  if (corners.length === 4) b.quad(wp, wn, uvs);
  else b.tri(wp, wn, uvs);
}

function addBox(b: Builder, part: Part, scale: number) {
  const tile = tileOf(part.material);
  const m = partMatrix(part, scale).clone();
  const nm = _n.getNormalMatrix(m).clone();
  const [sx, sy, sz] = part.size;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const off = new THREE.Vector3(part.pos[0], part.pos[1], part.pos[2]);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // +X
  addFace(b, m, nm, [V(hx, -hy, hz), V(hx, -hy, -hz), V(hx, hy, -hz), V(hx, hy, hz)], V(1, 0, 0), 'z', 'y', off, tile, true);
  // −X
  addFace(b, m, nm, [V(-hx, -hy, -hz), V(-hx, -hy, hz), V(-hx, hy, hz), V(-hx, hy, -hz)], V(-1, 0, 0), 'z', 'y', off, tile, false);
  // +Y
  addFace(b, m, nm, [V(-hx, hy, hz), V(hx, hy, hz), V(hx, hy, -hz), V(-hx, hy, -hz)], V(0, 1, 0), 'x', 'z', off, tile, false);
  // −Y
  addFace(b, m, nm, [V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, -hy, hz), V(-hx, -hy, hz)], V(0, -1, 0), 'x', 'z', off, tile, false);
  // +Z
  addFace(b, m, nm, [V(-hx, -hy, hz), V(hx, -hy, hz), V(hx, hy, hz), V(-hx, hy, hz)], V(0, 0, 1), 'x', 'y', off, tile, false);
  // −Z
  addFace(b, m, nm, [V(hx, -hy, -hz), V(-hx, -hy, -hz), V(-hx, hy, -hz), V(hx, hy, -hz)], V(0, 0, -1), 'x', 'y', off, tile, true);
}

function addWedge(b: Builder, part: Part, scale: number) {
  const tile = tileOf(part.material);
  const m = partMatrix(part, scale).clone();
  const nm = _n.getNormalMatrix(m).clone();
  const hx = part.size[0] / 2, hy = part.size[1] / 2, hz = part.size[2] / 2;
  const off = new THREE.Vector3(part.pos[0], part.pos[1], part.pos[2]);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // spodek
  addFace(b, m, nm, [V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, -hy, hz), V(-hx, -hy, hz)], V(0, -1, 0), 'x', 'z', off, tile, false);
  // zadní svislá stěna (+Z)
  addFace(b, m, nm, [V(-hx, -hy, hz), V(hx, -hy, hz), V(hx, hy, hz), V(-hx, hy, hz)], V(0, 0, 1), 'x', 'y', off, tile, false);
  // šikmá plocha – UV podél sklonu, aby se textura nenatahovala
  const slopeN = new THREE.Vector3(0, 2 * hz, -2 * hy).normalize();
  const slen = Math.hypot(2 * hy, 2 * hz);
  const corners = [V(hx, -hy, -hz), V(-hx, -hy, -hz), V(-hx, hy, hz), V(hx, hy, hz)];
  const uvs: [number, number][] = [
    [(hx + off.x) / tile, 0],
    [(-hx + off.x) / tile, 0],
    [(-hx + off.x) / tile, slen / tile],
    [(hx + off.x) / tile, slen / tile],
  ];
  b.quad(
    corners.map((c) => c.clone().applyMatrix4(m)),
    slopeN.clone().applyMatrix3(nm).normalize(),
    uvs,
  );
  // boční trojúhelníky
  addFace(b, m, nm, [V(hx, -hy, hz), V(hx, -hy, -hz), V(hx, hy, hz)], V(1, 0, 0), 'z', 'y', off, tile, true);
  addFace(b, m, nm, [V(-hx, -hy, -hz), V(-hx, -hy, hz), V(-hx, hy, hz)], V(-1, 0, 0), 'z', 'y', off, tile, false);
}

function addCylinder(b: Builder, part: Part, scale: number) {
  const tile = tileOf(part.material);
  const m = partMatrix(part, scale).clone();
  const nm = _n.getNormalMatrix(m).clone();
  const r = part.size[0] / 2, hy = part.size[1] / 2, tp = part.taper ?? 1;
  const seg = Math.max(10, Math.min(32, Math.round(r * 40)));
  const circ = 2 * Math.PI * r;
  const base = b.vcount;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const nx = Math.cos(a), nz = Math.sin(a);
    const n = new THREE.Vector3(nx, 0, nz).applyMatrix3(nm).normalize();
    const u = ((i / seg) * circ) / tile;
    b.vert(new THREE.Vector3(nx * r, -hy, nz * r).applyMatrix4(m), n, [u, (part.pos[1] - hy) / tile]);
    b.vert(new THREE.Vector3(nx * r * tp, hy, nz * r * tp).applyMatrix4(m), n, [u, (part.pos[1] + hy) / tile]);
  }
  for (let i = 0; i < seg; i++) {
    const a = base + i * 2;
    b.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  for (const side of [1, -1]) {
    const c = b.vcount;
    const n = new THREE.Vector3(0, side, 0).applyMatrix3(nm).normalize();
    b.vert(new THREE.Vector3(0, side * hy, 0).applyMatrix4(m), n, [0, 0]);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rr = side > 0 ? r * tp : r;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      b.vert(new THREE.Vector3(x, side * hy, z).applyMatrix4(m), n, [x / tile, z / tile]);
    }
    for (let i = 0; i < seg; i++) {
      if (side > 0) b.idx.push(c, c + 2 + i, c + 1 + i);
      else b.idx.push(c, c + 1 + i, c + 2 + i);
    }
  }
}

/** Deformovaná koule (kámen, koruna stromu). UV krabicovou projekcí podle normály stěny, v metrech. */
function addBlob(b: Builder, part: Part, scale: number) {
  const tile = tileOf(part.material);
  const m = partMatrix(part, scale).clone();
  const nm = _n.getNormalMatrix(m).clone();
  const hx = part.size[0] / 2, hy = part.size[1] / 2, hz = part.size[2] / 2;
  const { verts, faces } = icosphere(2);
  const seed = part.seed ?? 1, rough = part.rough ?? 0.5;
  const P = verts.map((d) => {
    const r = blobRadius(d, seed, rough);
    return new THREE.Vector3(d[0] * r * hx, d[1] * r * hy, d[2] * r * hz);
  });
  // Hladké normály: součet normál stěn u sdíleného vrcholu.
  const N = P.map(() => new THREE.Vector3());
  const fn = faces.map(([a, c, d]) => {
    const n = new THREE.Vector3().subVectors(P[c], P[a]).cross(new THREE.Vector3().subVectors(P[d], P[a]));
    if (n.dot(P[a]) < 0) n.negate();
    N[a].add(n);
    N[c].add(n);
    N[d].add(n);
    return n.normalize();
  });
  for (const n of N) n.normalize();
  const off = new THREE.Vector3(part.pos[0], part.pos[1], part.pos[2]);
  faces.forEach((f, i) => {
    const n = fn[i];
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const uv = (p: THREE.Vector3): [number, number] => {
      const q = p.clone().add(off);
      if (ay >= ax && ay >= az) return [q.x / tile, q.z / tile];
      if (ax >= az) return [q.z / tile, q.y / tile];
      return [q.x / tile, q.y / tile];
    };
    // Pořadí vrcholů tak, aby přední strana mířila ven.
    const order = new THREE.Vector3().subVectors(P[f[1]], P[f[0]]).cross(new THREE.Vector3().subVectors(P[f[2]], P[f[0]])).dot(P[f[0]]) >= 0 ? f : [f[0], f[2], f[1]];
    const base = b.vcount;
    for (const k of order) b.vert(P[k].clone().applyMatrix4(m), N[k].clone().applyMatrix3(nm).normalize(), uv(P[k]));
    b.idx.push(base, base + 1, base + 2);
  });
}

/**
 * Karta: oboustranný pruh v rovině XY od y = 0 (kotva v `pos`) do y = size[1], šířka size[0].
 * `bend` prohne konec k −Z (list palmy). UV 0–1 přes celou kartu (textura = jeden list).
 */
function addCard(b: Builder, part: Part, scale: number) {
  const m = partMatrix(part, scale).clone();
  const nm = _n.getNormalMatrix(m).clone();
  const w = part.size[0] / 2, h = part.size[1], bend = part.bend ?? 0;
  const seg = bend ? 5 : 1;
  const base = b.vcount;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const y = t * h * (1 - 0.15 * Math.abs(bend) / Math.max(h, 0.01) * t);
    const z = -bend * t * t;
    // Normála kolmo k tečně prohnutí.
    const n = new THREE.Vector3(0, 2 * bend * t, h).normalize().applyMatrix3(nm).normalize();
    b.vert(new THREE.Vector3(-w, y, z).applyMatrix4(m), n, [0, t]);
    b.vert(new THREE.Vector3(w, y, z).applyMatrix4(m), n, [1, t]);
  }
  for (let i = 0; i < seg; i++) {
    const a = base + i * 2;
    b.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
}

export interface ObjectGeometry {
  byMaterial: Map<string, { geometry: THREE.BufferGeometry; castShadow: boolean }>;
  labels: Array<{ text: string; style: string; matrix: THREE.Matrix4; w: number; h: number }>;
}

export function buildObjectGeometry(parts: Part[], scale = 1): ObjectGeometry {
  const builders = new Map<string, { b: Builder; cast: boolean }>();
  const labels: ObjectGeometry['labels'] = [];
  for (const p of parts) {
    if (p.render === false) continue;
    if (p.shape === 'label') {
      labels.push({ text: p.text ?? '', style: p.material, matrix: partMatrix(p, scale).clone(), w: p.size[0], h: p.size[1] });
      continue;
    }
    const cast = p.castShadow !== false;
    const key = `${p.material}|${cast ? 1 : 0}`;
    let e = builders.get(key);
    if (!e) builders.set(key, (e = { b: new Builder(), cast }));
    if (p.shape === 'box') addBox(e.b, p, scale);
    else if (p.shape === 'wedge') addWedge(e.b, p, scale);
    else if (p.shape === 'cylinder') addCylinder(e.b, p, scale);
    else if (p.shape === 'blob') addBlob(e.b, p, scale);
    else if (p.shape === 'card') addCard(e.b, p, scale);
  }
  const byMaterial = new Map<string, { geometry: THREE.BufferGeometry; castShadow: boolean }>();
  for (const [key, e] of builders) byMaterial.set(key, { geometry: e.b.build(), castShadow: e.cast });
  return { byMaterial, labels };
}
