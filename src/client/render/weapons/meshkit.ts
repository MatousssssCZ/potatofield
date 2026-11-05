import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Programové modelování zbraní: profilové výtažky se zkosením, trubky, rotační profily.
 * Konvence: metry; zbraň míří k −Z, +Y nahoru, +X vpravo (pravá strana zbraně).
 * Geometrie se tvoří jednou při přípravě assetu, ne ve smyčce.
 */

export type P2 = [number, number];

/**
 * Míra detailu generátorů (rozpočet trojúhelníků). Výchozí = plný detail; zbraně se staví
 * v `withDetail(...)` podle rozpočtu (FP 3 000–3 500, world model 1 000–1 300).
 * - bevelSegments: segmenty zkosení hran (0 = bez zkosení)
 * - corner: segmenty zaoblení rohů malých dílů (0 = ostrý roh)
 * - latheScale/latheMin: počet segmentů rotačních těles
 * - minPart: díly s největším rozměrem pod touto mezí se vynechají (jen pro world modely)
 */
export interface Detail {
  bevelSegments: number;
  corner: number;
  latheScale: number;
  latheMin: number;
  magSegs: number;
  minPart: number;
  /** Nejmenší počet segmentů dílů u oka (optika, clona) – jen pro vlastní pohled; 0 = běžné škálování. */
  eyeSegs?: number;
}
export const FULL_DETAIL: Detail = { bevelSegments: 2, corner: 2, latheScale: 1, latheMin: 8, magSegs: 10, minPart: 0, eyeSegs: 20 };
let DETAIL: Detail = FULL_DETAIL;

export function detail(): Detail {
  return DETAIL;
}

export function withDetail<T>(d: Detail, fn: () => T): T {
  const prev = DETAIL;
  DETAIL = d;
  try {
    return fn();
  } finally {
    DETAIL = prev;
  }
}

/** Barva vrcholů – tón v rámci sdíleného materiálu (bez dalších materiálů). */
function tint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function normalize(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  if (!out.getAttribute('uv')) {
    const n = out.getAttribute('position').count;
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  out = tint(out, color);
  return out;
}

/**
 * Boční profil (Z, Y) vytažený do šířky podél X se zkosenými hranami.
 * `pts` jsou body obrysu v rovině Z–Y (z dopředu záporné). Výsledek je vycentrovaný na x = cx.
 */
export function sideProfile(pts: P2[], width: number, bevel: number, color: THREE.ColorRepresentation, cx = 0, curveSegments = 6): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const b = DETAIL.bevelSegments > 0 ? Math.min(bevel, width * 0.45) : 0;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0005, width - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: Math.max(1, DETAIL.bevelSegments),
    curveSegments,
  });
  // Shape je v rovině X–Y s výtažkem podél Z → otočit: tvarové X → Z, výtažek → X.
  g.translate(0, 0, -(width - 2 * b) / 2);
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  g.translate(cx, 0, 0);
  // Zrcadlení determinantem −1 otočí winding → vrátit orientaci trojúhelníků.
  flipWinding(g);
  g.computeVertexNormals();
  return normalize(g, color);
}

/** Průřez (X, Y) vytažený podél −Z od z0 do z1 se zkosením. */
export function crossProfile(pts: P2[], z0: number, z1: number, bevel: number, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const len = Math.abs(z1 - z0);
  const b = DETAIL.bevelSegments > 0 ? Math.min(bevel, len * 0.45) : 0;
  const g = new THREE.ExtrudeGeometry(shape, { depth: len - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: Math.max(1, DETAIL.bevelSegments), curveSegments: 8 });
  g.translate(0, 0, Math.min(z0, z1) + b);
  g.computeVertexNormals();
  return normalize(g, color);
}

/** Zaoblený obdélník jako bodový profil (pro průřezy). */
export function roundedRect(w: number, h: number, r: number, cx = 0, cy = 0, seg = 3): P2[] {
  if (seg <= 0 || r <= 0) return [[cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2]];
  const pts: P2[] = [];
  const corners: Array<[number, number, number]> = [
    [cx + w / 2 - r, cy + h / 2 - r, 0],
    [cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2],
    [cx - w / 2 + r, cy - h / 2 + r, Math.PI],
    [cx + w / 2 - r, cy - h / 2 + r, (3 * Math.PI) / 2],
  ];
  for (const [x, y, a0] of corners) for (let i = 0; i <= seg; i++) {
    const a = a0 + (i / seg) * (Math.PI / 2);
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return pts;
}

/** Rotační těleso kolem osy Z: profil [poloměr, z] ve světových souřadnicích zbraně. */
/** `nearEye`: díl u oka (optika, clona hledí) – v první osobě nejméně `eyeSegs` segmentů bez ohledu na stupeň detailu. */
export function lathe(profile: Array<[number, number]>, segments: number, color: THREE.ColorRepresentation, cx = 0, cy = 0, nearEye = false): THREE.BufferGeometry {
  // Lathe rotuje kolem Y; rotateX(−π/2) mapuje profilové y na −z → zadat −z.
  const scaled = Math.max(DETAIL.latheMin, Math.round(segments * DETAIL.latheScale));
  segments = nearEye && DETAIL.eyeSegs ? Math.max(DETAIL.eyeSegs, scaled) : scaled;
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, -z)), segments);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, cy, 0);
  g.computeVertexNormals();
  return normalize(g, color);
}

/** Trubka (válec) podél Z. */
export function tube(r: number, z0: number, z1: number, segments: number, color: THREE.ColorRepresentation, cx = 0, cy = 0, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), segments, 1, open);
  g.rotateX(Math.PI / 2);
  g.translate(cx, cy, (z0 + z1) / 2);
  return normalize(g, color);
}

/** Kvádr se zkosením (malé díly: ovladače, montáže). */
export function bevelBox(w: number, h: number, d: number, bevel: number, color: THREE.ColorRepresentation, pos: [number, number, number], rot?: [number, number, number]): THREE.BufferGeometry {
  const g = crossProfile(roundedRect(w, h, DETAIL.corner > 0 ? Math.min(bevel, w / 2.2, h / 2.2) : 0, 0, 0, DETAIL.corner), -d / 2, d / 2, Math.min(bevel, d / 3), color);
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.translate(...pos);
  return g;
}

export function flipWinding(g: THREE.BufferGeometry) {
  const idx = g.index;
  if (idx) {
    const a = idx.array as unknown as number[];
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
    return;
  }
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    for (let c = 0; c < 3; c++) {
      const t = pos.getComponent(i + 1, c);
      pos.setComponent(i + 1, c, pos.getComponent(i + 2, c));
      pos.setComponent(i + 2, c, t);
    }
  }
}

export function transform(g: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Sloučení podle materiálu (statické díly = 1 draw call na materiál). */
export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // World modely: vynechat drobné díly pod mezí (nečitelné na vzdálenost, drahé v trojúhelnících).
  if (DETAIL.minPart > 0 && list.length > 1) {
    const keep = list.filter((g) => {
      g.computeBoundingBox();
      const s = g.boundingBox!.getSize(new THREE.Vector3());
      return Math.max(s.x, s.y, s.z) >= DETAIL.minPart;
    });
    for (const g of list) if (!keep.includes(g)) g.dispose();
    if (keep.length) list = keep;
  }
  const m = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!m) throw new Error('merge selhal');
  m.computeBoundingSphere();
  return m;
}

/** Zakřivený zásobník: oblouk s danou délkou, zakřivením a průřezem. */
export function curvedMag(len: number, depth: number, width: number, curve: number, color: THREE.ColorRepresentation, segs = DETAIL.magSegs): THREE.BufferGeometry {
  // Boční obrys: přední a zadní hrana po kružnicovém oblouku (z dopředu, y dolů).
  const front: P2[] = [], back: P2[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = -t * len;
    const bend = curve * t * t; // dopředu se zakřivuje
    front.push([-depth / 2 - bend, y]);
    back.push([depth / 2 - bend * 0.92, y]);
  }
  const pts: P2[] = [...back, ...front.reverse()];
  return sideProfile(pts, width, 0.003, color);
}

/** Profil zadaný „kladně dopředu“ → světové z (−Z dopředu). */
export const fwd = (p: Array<[number, number]>): Array<[number, number]> => p.map(([r, z]) => [r, -z]);

/** Jednoduchý kvádr bez zkosení (drobné opakované díly – 12 trojúhelníků). */
export function plainBox(w: number, h: number, d: number, color: THREE.ColorRepresentation, pos: [number, number, number]): THREE.BufferGeometry {
  const g = normalize(new THREE.BoxGeometry(w, h, d), color);
  g.translate(...pos);
  return g;
}
