import * as THREE from 'three';
import type { Part } from '../../world/parts';

/**
 * Proti z-fightingu: generátory skládají předměty z kvádrů a válců, jejichž plochy často leží
 * přesně ve stejné rovině (obklad na zdi, víko na bedně, pás přes bednu, pletivo v rámu…).
 * Takové plochy při pohybu kamery „přeskakují“. Před vykreslením se proto najdou dvojice
 * ploch ve stejné rovině, se stejnou orientací a s překryvem, a pozdější díl (detail bývá
 * přidaný po podkladu) se posune o ZSEP_STEP ven ve směru plochy – další v pořadí o další krok.
 * Kolize se nemění (počítají se z původních dílů); posun 3 mm není vidět.
 */
/** 3 mm: při ořezové rovině 3 cm rozliší 24bitová hloubka plochy od sebe zhruba do 40 m. */
export const ZSEP_STEP = 0.003;
/** Plochy blíž než tato vzdálenost se berou jako jedna rovina. */
const PLANE_TOL = 0.0004;

interface Face {
  part: number;
  /** Lokální osa dílu (0 = x, 1 = y, 2 = z) a strana (+1 / −1). */
  axis: number;
  sign: number;
  n: THREE.Vector3;
  d: number;
  c: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  hu: number;
  hv: number;
}

const AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

function facesOf(p: Part, idx: number, out: Face[]) {
  if (p.render === false || (p.shape !== 'box' && p.shape !== 'cylinder')) return;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
  const c0 = new THREE.Vector3(...p.pos);
  const ax = AX.map((v) => v.clone().applyQuaternion(q));
  const h = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
  // Válec: jen podstavy (osa Y); obvod je zaoblený. Podstava ~ čtverec vepsaný kruhu.
  const axes = p.shape === 'cylinder' ? [1] : [0, 1, 2];
  const shrink = p.shape === 'cylinder' ? 0.7 : 1;
  for (const i of axes) {
    const [j, k] = [0, 1, 2].filter((x) => x !== i);
    for (const s of [-1, 1]) {
      const n = ax[i].clone().multiplyScalar(s);
      const c = c0.clone().addScaledVector(n, h[i]);
      out.push({ part: idx, axis: i, sign: s, n, d: n.dot(c), c, u: ax[j], v: ax[k], hu: h[j] * shrink, hv: h[k] * shrink });
    }
  }
}

/** Překrývají se dvě obdélníkové plochy v téže rovině? (vzorkování mřížkou, oběma směry) */
const _pt = new THREE.Vector3(), _r = new THREE.Vector3();
function overlaps(a: Face, b: Face): boolean {
  // Rychlé vyřazení: středy dál než součet poloměrů ploch.
  if (a.c.distanceToSquared(b.c) > (Math.hypot(a.hu, a.hv) + Math.hypot(b.hu, b.hv)) ** 2) return false;
  const inside = (f: Face, g: Face) => {
    const pt = _pt, r = _r;
    for (let i = 0; i <= 6; i++)
      for (let j = 0; j <= 6; j++) {
        pt.copy(f.c).addScaledVector(f.u, ((i / 6) * 2 - 1) * f.hu * 0.98).addScaledVector(f.v, ((j / 6) * 2 - 1) * f.hv * 0.98);
        r.subVectors(pt, g.c);
        if (Math.abs(r.dot(g.u)) < g.hu - 1e-4 && Math.abs(r.dot(g.v)) < g.hv - 1e-4) return true;
      }
    return false;
  };
  return inside(a, b) || inside(b, a);
}

/** Klíč roviny (směr + vzdálenost), s tolerancí řešenou sousedními koši. */
const dirKey = (n: THREE.Vector3) => `${Math.round(n.x * 500)},${Math.round(n.y * 500)},${Math.round(n.z * 500)}`;

export function separateCoplanar(parts: Part[]): Part[] {
  const faces: Face[] = [];
  parts.forEach((p, i) => facesOf(p, i, faces));
  if (faces.length < 2) return parts;
  const buckets = new Map<string, Face[]>();
  for (const f of faces) {
    const k = `${dirKey(f.n)}|${Math.round(f.d / PLANE_TOL)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(f);
  }
  // Posun jednotlivých ploch: díl se na té straně prodlouží (opačná plocha zůstane) – posun celého
  // dílu by se u desky sevřené z obou stran vyrušil.
  const grow = new Map<number, number[]>(); // [x+, x−, y+, y−, z+, z−]
  const level = new Map<string, number>();
  for (const [key, list] of buckets) {
    // Sousední koš (vzdálenost těsně přes hranici koše) patří ke stejné rovině.
    const [dk, dq] = key.split('|');
    const all = [...(buckets.get(`${dk}|${Number(dq) - 1}`) ?? []), ...list, ...(buckets.get(`${dk}|${Number(dq) + 1}`) ?? [])];
    if (all.length < 2) continue;
    all.sort((a, b) => a.part - b.part);
    for (let i = 1; i < all.length; i++) {
      const f = all[i];
      if (!list.includes(f)) continue; // sousední koše jen jako protějšky
      let rank = 0;
      for (let j = 0; j < i; j++) if (all[j].part !== f.part && Math.abs(all[j].d - f.d) < PLANE_TOL && overlaps(all[j], f)) rank = Math.max(rank, (level.get(`${all[j].part}|${all[j].axis}|${all[j].sign}`) ?? 0) + 1);
      if (!rank) continue;
      level.set(`${f.part}|${f.axis}|${f.sign}`, rank);
      const g = grow.get(f.part) ?? [0, 0, 0, 0, 0, 0];
      const slot = f.axis * 2 + (f.sign > 0 ? 0 : 1);
      g[slot] = Math.max(g[slot], ZSEP_STEP * rank);
      grow.set(f.part, g);
    }
  }
  if (!grow.size) return parts;
  return parts.map((p, i) => {
    const g = grow.get(i);
    if (!g) return p;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
    const size: [number, number, number] = [p.size[0] + g[0] + g[1], p.size[1] + g[2] + g[3], p.size[2] + g[4] + g[5]];
    // Střed se posune o polovinu rozdílu přírůstků (plocha s přírůstkem jde ven, opačná stojí).
    const off = new THREE.Vector3((g[0] - g[1]) / 2, (g[2] - g[3]) / 2, (g[4] - g[5]) / 2).applyQuaternion(q);
    return { ...p, size, pos: [p.pos[0] + off.x, p.pos[1] + off.y, p.pos[2] + off.z] };
  });
}
