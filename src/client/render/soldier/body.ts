import * as THREE from 'three';
import { BONE_INDEX, restPosition, type BoneName } from './rig';

/**
 * Programový model vojáka: souvislé tělo ze svislých profilů (trup, končetiny, hlava) se
 * skinováním (≤ 4 vlivy na vertex, plynulé přechody v kloubech) a pevně navázaná výstroj.
 * Dva materiály: 0 = tělo (atlas uniformy frakce + barva vrcholů pro kůži/boty/rukavice),
 * 1 = výstroj (barva vrcholů). Varianty = doplňky stejné kostry (factionId + classId).
 * Vlastní dílo projektu (bez převzatých modelů a textur).
 */
export type SoldierFaction = 'usmc' | 'mec';
export type SoldierVariant = 'base' | 'assault' | 'medic' | 'sniper';

export interface LodSpec {
  /** Radiální segmenty profilů těla. */
  seg: number;
  /** Podíl pruhů hejkalu a drobností (1 = vše, 0 = jen hlavní obrys). */
  detail: number;
}
export const SOLDIER_LODS: LodSpec[] = [
  { seg: 18, detail: 1 },
  { seg: 10, detail: 0.35 },
  { seg: 6, detail: 0 },
];

type W = Array<[BoneName, number]>;

interface Palette {
  skin: string;
  boots: string;
  gloves: string;
  beard?: string;
}
const PAL: Record<SoldierFaction, Palette> = {
  usmc: { skin: '#c49a7c', boots: '#a48d68', gloves: '#6f6448' },
  mec: { skin: '#a37656', boots: '#2b2722', gloves: '#2e2c27', beard: '#2a2119' },
};

// Oblasti atlasu uniformy (u0, v0, šířka, výška).
const SHIRT: [number, number, number, number] = [0, 0, 0.5, 1];
const PANTS: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
const PLAIN: [number, number] = [0.75, 0.25];

class Builder {
  readonly mats: Array<{ pos: number[]; uv: number[]; col: number[]; si: number[]; sw: number[]; smooth: boolean[] }> = [
    { pos: [], uv: [], col: [], si: [], sw: [], smooth: [] },
    { pos: [], uv: [], col: [], si: [], sw: [], smooth: [] },
  ];
  /** Hladké stínování pro tělo a oblé díly; kvádry výstroje zůstávají s ostrými hranami. */
  smooth = true;

  private push(m: number, p: THREE.Vector3, uv: [number, number], c: THREE.Color, w: W) {
    const t = this.mats[m];
    t.smooth.push(this.smooth);
    t.pos.push(p.x, p.y, p.z);
    t.uv.push(uv[0], uv[1]);
    t.col.push(c.r, c.g, c.b);
    const ws = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((s, x) => s + x[1], 0) || 1;
    for (let i = 0; i < 4; i++) {
      t.si.push(ws[i] ? BONE_INDEX[ws[i][0]] : 0);
      t.sw.push(ws[i] ? ws[i][1] / sum : 0);
    }
  }

  tri(m: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, uv: [[number, number], [number, number], [number, number]], col: [THREE.Color, THREE.Color, THREE.Color], w: [W, W, W]) {
    this.push(m, a, uv[0], col[0], w[0]);
    this.push(m, b, uv[1], col[1], w[1]);
    this.push(m, c, uv[2], col[2], w[2]);
  }

  /**
   * Svislý profil (tělo, končetina): prstence s elipsou (rx, rz) a středem (cx, cz) ve výšce y.
   * `weights(y, x)` určí vlivy kostí pro vertex; `region` = oblast atlasu (null = jednobarevné).
   */
  profile(m: number, rings: Array<{ y: number; rx: number; rz: number; cx: number; cz: number }>, seg: number, color: THREE.ColorRepresentation, wIn: W | ((p: THREE.Vector3) => W), region: [number, number, number, number] | null, capTop = false, capBottom = false) {
    const c = new THREE.Color(color);
    const weights = typeof wIn === 'function' ? wIn : () => wIn;
    const y0 = Math.min(...rings.map((r) => r.y)), y1 = Math.max(...rings.map((r) => r.y));
    const pt = (r: (typeof rings)[0], i: number) => {
      const a = (i / seg) * Math.PI * 2;
      return new THREE.Vector3(r.cx + Math.sin(a) * r.rx, r.y, r.cz - Math.cos(a) * r.rz);
    };
    const uvAt = (r: (typeof rings)[0], i: number): [number, number] =>
      region ? [region[0] + (i / seg) * region[2], region[1] + ((r.y - y0) / Math.max(1e-6, y1 - y0)) * region[3]] : PLAIN;
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], B = rings[k + 1];
      for (let i = 0; i < seg; i++) {
        const a0 = pt(A, i), a1 = pt(A, i + 1), b0 = pt(B, i), b1 = pt(B, i + 1);
        const up = B.y > A.y;
        const t1: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = up ? [a0, b0, a1] : [a0, a1, b0];
        const t2: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = up ? [a1, b0, b1] : [a1, b1, b0];
        const uvs = (v: THREE.Vector3) => (v === a0 ? uvAt(A, i) : v === a1 ? uvAt(A, i + 1) : v === b0 ? uvAt(B, i) : uvAt(B, i + 1));
        for (const t of [t1, t2]) this.tri(m, t[0], t[1], t[2], [uvs(t[0]), uvs(t[1]), uvs(t[2])], [c, c, c], [weights(t[0]), weights(t[1]), weights(t[2])]);
      }
    }
    const cap = (r: (typeof rings)[0], top: boolean) => {
      const ctr = new THREE.Vector3(r.cx, r.y, r.cz);
      for (let i = 0; i < seg; i++) {
        const p0 = pt(r, i), p1 = pt(r, i + 1);
        const tri: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = top ? [ctr, p1, p0] : [ctr, p0, p1];
        this.tri(m, tri[0], tri[1], tri[2], [uvAt(r, i), uvAt(r, i), uvAt(r, i)], [c, c, c], [weights(tri[0]), weights(tri[1]), weights(tri[2])]);
      }
    };
    const top = rings.reduce((a, b) => (b.y > a.y ? b : a)), bot = rings.reduce((a, b) => (b.y < a.y ? b : a));
    if (capTop) cap(top, true);
    if (capBottom) cap(bot, false);
  }

  /** Kvádr (volitelně natočený), jedna kost. */
  box(m: number, center: THREE.Vector3, size: [number, number, number], color: THREE.ColorRepresentation, w: W, rot?: THREE.Euler) {
    const g = new THREE.BoxGeometry(...size).toNonIndexed();
    if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
    g.translate(center.x, center.y, center.z);
    this.smooth = false;
    this.addGeometry(m, g, color, w);
    this.smooth = true;
  }

  /** Elipsoid (střed, poloosy) – volitelně jen část nad rovinou y >= cutY (relativně −1..1). */
  ellipsoid(m: number, center: THREE.Vector3, r: [number, number, number], segU: number, segV: number, color: THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.Color), w: W | ((p: THREE.Vector3) => W), thetaMax = Math.PI, phiSkip?: (phi: number) => boolean) {
    const g = new THREE.SphereGeometry(1, segU, segV, 0, Math.PI * 2, 0, thetaMax).toNonIndexed();
    g.scale(r[0], r[1], r[2]);
    g.translate(center.x, center.y, center.z);
    if (phiSkip) {
      // Vynechat trojúhelníky v zadaném úhlovém sektoru (otvor kapuce pro obličej).
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const keep: number[] = [];
      for (let i = 0; i < p.count; i += 3) {
        const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 - center.x;
        const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 - center.z;
        const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 - center.y;
        if (!phiSkip(Math.atan2(cx, -cz)) || cy > r[1] * 0.55) keep.push(i);
      }
      const np = new Float32Array(keep.length * 9);
      keep.forEach((i, k) => {
        for (let j = 0; j < 3; j++) np.set([p.getX(i + j), p.getY(i + j), p.getZ(i + j)], (k * 3 + j) * 3);
      });
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.BufferAttribute(np, 3));
      this.addGeometry(m, ng, color, w);
      g.dispose();
      return;
    }
    this.addGeometry(m, g, color, w);
  }

  addGeometry(m: number, g: THREE.BufferGeometry, color: THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.Color), w: W | ((p: THREE.Vector3) => W)) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const fixed = typeof color === 'function' ? null : new THREE.Color(color);
    for (let i = 0; i < p.count; i += 3) {
      for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(p, i + j);
      const ctr = v[0].clone().add(v[1]).add(v[2]).multiplyScalar(1 / 3);
      const c = fixed ?? (color as (p: THREE.Vector3) => THREE.Color)(ctr);
      const ww = typeof w === 'function' ? [w(v[0]), w(v[1]), w(v[2])] : [w, w, w];
      this.tri(m, v[0].clone(), v[1].clone(), v[2].clone(), [PLAIN, PLAIN, PLAIN], [c, c, c], ww as [W, W, W]);
    }
    g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const all = (k: 'pos' | 'uv' | 'col' | 'si' | 'sw') => [...this.mats[0][k], ...this.mats[1][k]];
    g.setAttribute('position', new THREE.Float32BufferAttribute(all('pos'), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(all('uv'), 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(all('col'), 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(all('si'), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(all('sw'), 4));
    const n0 = this.mats[0].pos.length / 3, n1 = this.mats[1].pos.length / 3;
    g.addGroup(0, n0, 0);
    g.addGroup(n0, n1, 1);
    // Normály: plošné, u hladkých dílů zprůměrované podle polohy (v rámci materiálu).
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = new Float32Array(pos.count * 3);
    const smooth = [...this.mats[0].smooth, ...this.mats[1].smooth];
    const acc = new Map<string, THREE.Vector3>();
    const key = (i: number) => `${i < n0 ? 0 : 1}:${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      const fn = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      for (let j = 0; j < 3; j++) {
        if (smooth[i + j]) {
          const k = key(i + j);
          const v = acc.get(k) ?? acc.set(k, new THREE.Vector3()).get(k)!;
          v.add(fn);
        }
        const f = fn.clone().normalize();
        nrm.set([f.x, f.y, f.z], (i + j) * 3);
      }
    }
    for (let i = 0; i < pos.count; i++) {
      if (!smooth[i]) continue;
      const v = acc.get(key(i))!.clone().normalize();
      nrm.set([v.x, v.y, v.z], i * 3);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    g.boundingSphere!.radius += 0.6; // pózy (leh, paže) přesahují klidovou polohu
    return g;
  }
}

const ss = THREE.MathUtils.smoothstep;
const R = (b: BoneName) => restPosition(b);

/** Vlivy trupu podle výšky; ramena částečně na klíční kosti. */
function torsoWeights(p: THREE.Vector3): W {
  const y = p.y;
  const w: W = [];
  const s1 = ss(y, 1.0, 1.12), s2 = ss(y, 1.2, 1.3), nk = ss(y, 1.43, 1.48);
  w.push(['pelvis', 1 - s1], ['spine1', s1 * (1 - s2)], ['spine2', s2 * (1 - nk)], ['neck', nk]);
  const sh = ss(y, 1.28, 1.4) * ss(Math.abs(p.x), 0.1, 0.19) * 0.6;
  if (sh > 0) {
    for (const e of w) e[1] *= 1 - sh;
    w.push([p.x < 0 ? 'clavL' : 'clavR', sh]);
  }
  return w;
}

/** Vlivy končetiny: horní konec sdílený s rodičem, dolní kloub s dítětem. */
function limbWeights(top: BoneName, bone: BoneName, child: BoneName | null, yTop: number, yJoint: number): (p: THREE.Vector3) => W {
  return (p) => {
    const a = ss(p.y, yTop - 0.06, yTop + 0.02); // 1 = u horního konce
    const b = child ? 1 - ss(p.y, yJoint - 0.05, yJoint + 0.05) : 0; // 1 = pod kloubem
    const w: W = [[bone, Math.max(0, 1 - a * 0.5 - b * 0.5)]];
    if (a > 0) w.push([top, a * 0.5]);
    if (child && b > 0) w.push([child, b * 0.5]);
    return w;
  };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Geometrie vojáka pro frakci, roli a LOD (sdílená mezi instancemi). */
export function buildSoldierGeometry(faction: SoldierFaction, variant: SoldierVariant, lod: LodSpec): THREE.BufferGeometry {
  const B = new Builder();
  const P = PAL[faction];
  const seg = lod.seg;
  const usmc = faction === 'usmc';

  // --- Trup (košile – atlas) ---
  const torso: Array<[number, number, number, number]> = [
    // y, rx, rz, cz
    [0.86, 0.15, 0.1, 0.005], [0.95, 0.165, 0.105, 0], [1.05, 0.155, 0.1, 0], [1.15, 0.158, 0.1, -0.005],
    [1.25, 0.17, 0.11, -0.01], [1.33, 0.185, 0.115, -0.005], [1.4, 0.18, 0.11, 0], [1.44, 0.13, 0.085, 0.005], [1.47, 0.06, 0.055, 0.01],
  ];
  B.profile(0, torso.map(([y, rx, rz, cz]) => ({ y, rx, rz, cx: 0, cz })), seg + 2, '#ffffff', torsoWeights, SHIRT, false, true);
  // Krk a hlava (kůže).
  B.profile(0, [{ y: 1.45, rx: 0.05, rz: 0.05, cx: 0, cz: 0.01 }, { y: 1.57, rx: 0.048, rz: 0.048, cx: 0, cz: 0.005 }], Math.max(5, seg - 2), P.skin, limbWeights('spine2', 'neck', 'head', 1.47, 1.54), null);
  const headC = new THREE.Vector3(0, 1.635, -0.005);
  B.ellipsoid(
    0,
    headC,
    [0.083, 0.108, 0.098],
    seg + 2,
    Math.max(6, seg),
    P.beard && variant !== 'sniper' ? (p) => new THREE.Color(p.y < 1.6 && p.z < -0.02 ? P.beard! : P.skin) : P.skin,
    [['head', 1]],
  );
  if (lod.detail > 0) {
    B.box(0, new THREE.Vector3(0, 1.62, -0.103), [0.022, 0.035, 0.025], P.skin, [['head', 1]]); // nos
    for (const sx of [-1, 1]) B.box(0, new THREE.Vector3(sx * 0.083, 1.63, 0.0), [0.012, 0.035, 0.022], P.skin, [['head', 1]]); // uši
    B.box(0, new THREE.Vector3(0, 1.655, -0.095), [0.07, 0.012, 0.01], '#2a2724', [['head', 1]]); // oči (stín)
  }

  // --- Paže (rukávy – atlas, rukavice) ---
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const sh = R(`upperArm${side}`), el = R(`lowerArm${side}`), wr = R(`hand${side}`);
    B.profile(0, [
      { y: sh.y + 0.04, rx: 0.06, rz: 0.06, cx: sh.x - sx * 0.005, cz: 0 },
      { y: sh.y - 0.06, rx: 0.058, rz: 0.055, cx: sh.x, cz: 0 },
      { y: el.y + 0.04, rx: 0.046, rz: 0.046, cx: el.x, cz: 0 },
      { y: el.y - 0.02, rx: 0.045, rz: 0.045, cx: el.x, cz: 0 },
      { y: wr.y + 0.03, rx: 0.037, rz: 0.034, cx: wr.x, cz: 0 },
    ], seg, '#ffffff', (p) => (p.y > el.y + 0.03 ? limbWeights(`clav${side}`, `upperArm${side}`, `lowerArm${side}`, sh.y, el.y)(p) : limbWeights(`upperArm${side}`, `lowerArm${side}`, `hand${side}`, el.y, wr.y)(p)), SHIRT, true, false);
    // Rukavice (dlaň + sevřené prsty jedním tvarem).
    B.profile(0, [
      { y: wr.y + 0.035, rx: 0.036, rz: 0.03, cx: wr.x, cz: 0 },
      { y: wr.y - 0.03, rx: 0.042, rz: 0.024, cx: wr.x, cz: -0.004 },
      { y: wr.y - 0.085, rx: 0.036, rz: 0.026, cx: wr.x, cz: -0.012 },
    ], Math.max(5, seg - 2), P.gloves, (p) => (p.y > wr.y + 0.02 ? [[`lowerArm${side}`, 0.5], [`hand${side}`, 0.5]] : [[`hand${side}`, 1]]), null, false, true);
  }

  // --- Nohy (kalhoty – atlas, boty) ---
  for (const side of ['L', 'R'] as const) {
    const hp = R(`thigh${side}`), kn = R(`shin${side}`), an = R(`foot${side}`);
    B.profile(0, [
      { y: hp.y + 0.06, rx: 0.088, rz: 0.09, cx: hp.x * 0.85, cz: 0 },
      { y: hp.y - 0.1, rx: 0.08, rz: 0.082, cx: hp.x, cz: 0 },
      { y: kn.y + 0.06, rx: 0.06, rz: 0.062, cx: kn.x, cz: -0.005 },
      { y: kn.y - 0.04, rx: 0.058, rz: 0.06, cx: kn.x, cz: -0.003 },
      { y: an.y + 0.16, rx: 0.05, rz: 0.052, cx: an.x, cz: 0.005 },
      { y: an.y + 0.07, rx: 0.052, rz: 0.054, cx: an.x, cz: 0 },
    ], seg, '#ffffff', (p) => (p.y > kn.y + 0.02 ? limbWeights('pelvis', `thigh${side}`, `shin${side}`, hp.y, kn.y)(p) : limbWeights(`thigh${side}`, `shin${side}`, `foot${side}`, kn.y, an.y + 0.02)(p)), PANTS);
    // Bota: svršek + podrážka.
    B.profile(0, [
      { y: an.y + 0.11, rx: 0.053, rz: 0.056, cx: an.x, cz: 0 },
      { y: an.y + 0.03, rx: 0.052, rz: 0.066, cx: an.x, cz: -0.018 },
      { y: an.y - 0.02, rx: 0.05, rz: 0.118, cx: an.x, cz: -0.05 },
      { y: an.y - 0.065, rx: 0.048, rz: 0.12, cx: an.x, cz: -0.052 },
    ], Math.max(6, seg), P.boots, (p) => (p.y > an.y + 0.06 ? [[`shin${side}`, 0.5], [`foot${side}`, 0.5]] : [[`foot${side}`, 1]]), null, false, true);
  }

  // --- Výstroj (materiál 1) ---
  gear(B, faction, variant, lod, headC);
  void usmc;
  return B.build();
}

/** Doplňky podle frakce a role (pevně na kostech). */
function gear(B: Builder, faction: SoldierFaction, variant: SoldierVariant, lod: LodSpec, headC: THREE.Vector3) {
  const usmc = faction === 'usmc';
  const seg = lod.seg;
  const det = lod.detail;
  const vestCol = usmc ? '#5c5f3d' : variant === 'assault' ? '#3f3527' : '#4b3d2c';
  const pouchCol = usmc ? '#53573a' : '#3e3324';
  const r = rng((usmc ? 11 : 23) * 31 + ['base', 'assault', 'medic', 'sniper'].indexOf(variant));

  // Vesta / nosná výstroj: obal trupu (sleduje páteř stejně jako trup).
  const vestScale = variant === 'sniper' ? 1.04 : usmc ? 1.1 : 1.07;
  const vRings: Array<[number, number, number]> = [[1.04, 0.158, 0.103], [1.15, 0.161, 0.103], [1.25, 0.173, 0.113], [1.33, 0.188, 0.118], [1.39, 0.178, 0.11]];
  B.profile(1, vRings.map(([y, rx, rz]) => ({ y, rx: rx * vestScale, rz: rz * vestScale, cx: 0, cz: -0.004 })), seg + 2, vestCol, torsoWeights, null, true, true);
  // Opasek.
  B.profile(1, [{ y: 0.97, rx: 0.17, rz: 0.112, cx: 0, cz: 0 }, { y: 0.92, rx: 0.172, rz: 0.114, cx: 0, cz: 0 }], seg + 2, usmc ? '#4f5236' : '#3a3226', [['pelvis', 1]], null);

  // Sumky na vestě a opasku (výrazné u Assaulta).
  const front = variant === 'sniper' ? 2 : 3;
  for (let i = 0; i < front; i++) {
    const x = (i - (front - 1) / 2) * 0.075;
    B.box(1, new THREE.Vector3(x, 1.17, -0.125), [0.062, 0.11, 0.045], pouchCol, [['spine1', 0.4], ['spine2', 0.6]]);
    if (det > 0) B.box(1, new THREE.Vector3(x, 1.225, -0.128), [0.064, 0.018, 0.05], '#3c3e2a', [['spine2', 1]]);
  }
  const waist = variant === 'assault' ? 4 : 2;
  for (let i = 0; i < waist; i++) {
    const a = (i - (waist - 1) / 2) * 0.55 + Math.PI / 2;
    for (const sx of [-1, 1]) {
      if (waist === 2 && sx === 1 && i === 1) continue;
      B.box(1, new THREE.Vector3(sx * Math.sin(a) * 0.17, 0.92, -Math.cos(a) * 0.115), [0.06, 0.09, 0.05], pouchCol, [['pelvis', 1]], new THREE.Euler(0, -sx * (a - Math.PI / 2), 0));
    }
  }
  if (variant !== 'sniper' || usmc) {
    // Ramenní popruhy.
    for (const sx of [-1, 1]) B.box(1, new THREE.Vector3(sx * 0.09, 1.42, 0), [0.05, 0.02, 0.2], vestCol, [['spine2', 1]]);
  }

  // Chrániče kolen (USMC výrazné, MEC méně).
  if (usmc || variant === 'assault') {
    for (const side of ['L', 'R'] as const) {
      const kn = R(`shin${side}`);
      B.box(1, new THREE.Vector3(kn.x, kn.y - 0.01, -0.062), [0.085, 0.1, 0.03], usmc ? '#2c2c28' : '#3a3428', [[`shin${side}`, 1]]);
    }
  }

  // Batoh medika (nejvýraznější rozdíl zezadu a zboku).
  if (variant === 'medic') {
    const col = usmc ? '#565a3a' : '#5a5d3c';
    B.box(1, new THREE.Vector3(0, 1.22, 0.19), [0.3, 0.36, 0.15], col, [['spine2', 0.7], ['spine1', 0.3]]);
    B.box(1, new THREE.Vector3(0, 1.43, 0.18), [0.26, 0.07, 0.11], '#474a30', [['spine2', 1]]); // svinutý vak nahoře
    if (det > 0) for (const sx of [-1, 1]) B.box(1, new THREE.Vector3(sx * 0.17, 1.18, 0.18), [0.05, 0.2, 0.1], col, [['spine2', 1]]);
  }

  // --- Hlava ---
  const helmetCol = usmc ? '#ad9a74' : '#5f5a45';
  const head: [['head', number]] = [['head', 1]];
  if (variant === 'sniper') {
    hood(B, faction, lod, headC, r);
  } else if (usmc) {
    // Přilba (medik: vzorovaný kryt, Assault/základ: brýle na přilbě).
    const patterned = variant === 'medic';
    const col = patterned ? (p: THREE.Vector3) => new THREE.Color(Math.sin(p.x * 90) * Math.cos(p.z * 70 + p.y * 50) > 0.2 ? '#8f7c5c' : '#b8a57e') : helmetCol;
    B.ellipsoid(1, headC.clone().add(new THREE.Vector3(0, 0.025, 0.004)), [0.118, 0.12, 0.13], seg + 4, Math.max(5, seg - 3), col, head, Math.PI * 0.52);
    B.profile(1, [{ y: 1.648, rx: 0.124, rz: 0.136, cx: 0, cz: 0.004 }, { y: 1.635, rx: 0.126, rz: 0.138, cx: 0, cz: 0.004 }], seg + 4, helmetCol, head, null);
    if (variant !== 'medic') {
      const big = variant === 'assault' ? 1.25 : 1;
      B.profile(1, [{ y: 1.69, rx: 0.121, rz: 0.133, cx: 0, cz: 0.004 }, { y: 1.71, rx: 0.12, rz: 0.131, cx: 0, cz: 0.004 }], seg + 4, '#2a2a26', head, null); // pásek brýlí
      for (const sx of [-1, 1]) B.box(1, new THREE.Vector3(sx * 0.035, 1.705, -0.128), [0.05 * big, 0.034 * big, 0.022], '#1c2024', head);
    }
  } else if (variant === 'base') {
    // Baret (sklopený doprava).
    B.ellipsoid(1, headC.clone().add(new THREE.Vector3(0.02, 0.085, 0.01)), [0.1, 0.03, 0.11], seg + 2, Math.max(4, seg - 4), '#39402e', head);
    B.profile(1, [{ y: 1.705, rx: 0.088, rz: 0.1, cx: 0, cz: 0 }, { y: 1.69, rx: 0.088, rz: 0.1, cx: 0, cz: 0 }], seg + 2, '#2b3022', head, null);
  } else {
    // MEC Assault: maskovaná přilba s látkovým krytím zátylku; Medic: vzorovaná pokrývka.
    const col = (p: THREE.Vector3) => new THREE.Color(Math.sin(p.x * 70 + p.z * 40) * Math.cos(p.y * 90) > 0 ? '#6a5e43' : variant === 'medic' ? '#8a7a58' : '#4f4936');
    B.ellipsoid(1, headC.clone().add(new THREE.Vector3(0, 0.022, 0.004)), [0.116, 0.118, 0.128], seg + 4, Math.max(5, seg - 3), col, head, Math.PI * 0.52);
    if (variant === 'assault') B.box(1, new THREE.Vector3(0, 1.6, 0.11), [0.2, 0.13, 0.02], '#5b523d', [['head', 0.7], ['neck', 0.3]], new THREE.Euler(0.25, 0, 0)); // krytí zátylku
  }
}

/** Lehký hejkal: kapuce kolem hlavy a nepravidelné pruhy na ramenou, zádech a nadloktích. */
function hood(B: Builder, faction: SoldierFaction, lod: LodSpec, headC: THREE.Vector3, r: () => number) {
  const usmc = faction === 'usmc';
  const pal = usmc ? ['#a8946a', '#8a7a55', '#6c6a48', '#b9a77d'] : ['#5e5038', '#4b4a32', '#6a5a3c', '#3f4029'];
  const head: [['head', number]] = [['head', 1]];
  // Kapuce (otevřený obličej; MEC: obličej částečně zakrytý šátkem).
  B.ellipsoid(1, headC.clone().add(new THREE.Vector3(0, 0.012, 0.012)), [0.112, 0.125, 0.122], lod.seg + 4, Math.max(5, lod.seg - 2), pal[0], head, Math.PI * 0.75, (phi) => Math.abs(phi) < 0.75);
  if (!usmc) B.box(1, new THREE.Vector3(0, 1.585, -0.088), [0.11, 0.06, 0.03], '#3a352c', head); // šátek
  // Ramenní kryt (obrys zachován i v LOD2).
  B.profile(1, [{ y: 1.47, rx: 0.08, rz: 0.075, cx: 0, cz: 0.02 }, { y: 1.42, rx: 0.2, rz: 0.13, cx: 0, cz: 0.015 }, { y: 1.33, rx: 0.205, rz: 0.13, cx: 0, cz: 0.02 }], lod.seg + 2, pal[1], torsoWeights, null);
  // Pruhy (počet podle LOD; neprůhledná geometrie, žádné průhledné listy).
  const n = Math.round(46 * lod.detail);
  for (let i = 0; i < n; i++) {
    const zone = r();
    const col = pal[Math.floor(r() * pal.length)];
    const len = 0.08 + r() * 0.12;
    const w = 0.018 + r() * 0.02;
    if (zone < 0.35) {
      // Kolem hlavy (vyjma obličeje).
      let a = r() * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.95) a += Math.PI; // obličej (vpředu) volný
      const p = headC.clone().add(new THREE.Vector3(Math.sin(a) * 0.11, 0.03 - r() * 0.06, -Math.cos(a) * 0.115));
      B.box(1, p.add(new THREE.Vector3(0, -len / 2, 0)), [w, len, 0.008], col, head, new THREE.Euler((r() - 0.5) * 0.5, -a, (r() - 0.5) * 0.4));
    } else if (zone < 0.8) {
      // Ramena a horní část zad.
      const sx = r() < 0.5 ? -1 : 1;
      const x = sx * (0.05 + r() * 0.17), z = -0.06 + r() * 0.2;
      B.box(1, new THREE.Vector3(x, 1.4 - len / 2, z), [w, len, 0.008], col, [['spine2', 1]], new THREE.Euler((r() - 0.5) * 0.4, r() * Math.PI, sx * 0.25));
    } else {
      // Nadloktí.
      const side = r() < 0.5 ? 'L' : 'R';
      const sh = R(`upperArm${side}`);
      const a = r() * Math.PI * 2;
      B.box(1, new THREE.Vector3(sh.x + Math.sin(a) * 0.062, sh.y - 0.05 - len / 2, -Math.cos(a) * 0.062), [w, len, 0.008], col, [[`upperArm${side}`, 1]], new THREE.Euler(0, -a, 0));
    }
  }
}

/** Atlas uniformy frakce: košile (vlevo), kalhoty (vpravo nahoře), čistá plocha pro barvu vrcholů. */
export function makeUniformAtlas(faction: SoldierFaction): THREE.DataTexture {
  const n = 256;
  const d = new Uint8Array(n * n * 4);
  const r = rng(faction === 'usmc' ? 777 : 991);
  const hex = (h: string) => new THREE.Color(h).convertLinearToSRGB();
  const fill = (x0: number, y0: number, w: number, h: number, pal: string[], cell: number, blob: boolean) => {
    const cols = pal.map(hex);
    // Základ + skvrny: buňky (digitální vzor USMC) nebo měkké skvrny (MEC).
    const grid: number[] = [];
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    for (let i = 0; i < gw * gh; i++) grid.push(r() < 0.45 ? 0 : 1 + Math.floor(r() * (cols.length - 1)));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let k = grid[Math.floor(y / cell) * gw + Math.floor(x / cell)];
        if (blob) {
          const nx = Math.sin((x + y * 0.3) * 0.11) + Math.sin((y - x * 0.4) * 0.07 + 1.3) + Math.sin((x * 0.6 + y) * 0.05 + 2.1);
          k = nx > 1.1 ? 1 : nx < -1.1 ? 2 : nx > 0.2 && nx < 0.45 ? Math.min(3, cols.length - 1) : 0;
        }
        const c = cols[k];
        const j = ((y0 + y) * n + x0 + x) * 4;
        const g = 0.94 + r() * 0.08;
        d[j] = Math.min(255, c.r * 255 * g);
        d[j + 1] = Math.min(255, c.g * 255 * g);
        d[j + 2] = Math.min(255, c.b * 255 * g);
        d[j + 3] = 255;
      }
  };
  if (faction === 'usmc') {
    const desert = ['#c8b38b', '#a8916a', '#8c7757', '#d6c5a0'];
    fill(0, 0, 128, 256, desert, 4, false);
    fill(128, 128, 128, 128, desert, 4, false);
  } else {
    fill(0, 0, 128, 256, ['#6b5440', '#5b4636', '#7a634b', '#64503c'], 9, true);
    fill(128, 128, 128, 128, ['#5e5b3f', '#4a4632', '#71603f', '#3f3d2c'], 6, true);
  }
  // Čistá bílá oblast (kůže, boty, rukavice barví barva vrcholů).
  for (let y = 0; y < 128; y++) for (let x = 128; x < 256; x++) d.set([255, 255, 255, 255], (y * n + x) * 4);
  const t = new THREE.DataTexture(d, n, n);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const cache = new Map<string, THREE.BufferGeometry>();
export function soldierGeometry(faction: SoldierFaction, variant: SoldierVariant, lod: number): THREE.BufferGeometry {
  const key = `${faction}:${variant}:${lod}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = buildSoldierGeometry(faction, variant, SOLDIER_LODS[lod])));
  return g;
}

export function triangles(g: THREE.BufferGeometry) {
  return g.getAttribute('position').count / 3;
}
