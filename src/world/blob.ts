/**
 * Deterministický „blob“: ikosféra deformovaná hladkým šumem podle směru. Sdílí ho render
 * (jemnější síť) i kolize (hrubší síť → konvexní obal), takže tvar na serveru i u klienta sedí.
 * Vstup: jednotková koule; měřítko (elipsoid) a poloha se aplikují až v dílu.
 */

type V = [number, number, number];

const cache = new Map<number, { verts: V[]; faces: [number, number, number][] }>();

/** Ikosféra s `level` děleními (0 = 12 vrcholů, 1 = 42, 2 = 162). */
export function icosphere(level: number): { verts: V[]; faces: [number, number, number][] } {
  const hit = cache.get(level);
  if (hit) return hit;
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: V[] = ([
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ] as V[]).map(norm);
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(k);
      if (i === undefined) {
        const p = verts[a], q = verts[b];
        i = verts.push(norm([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2])) - 1;
        mid.set(k, i);
      }
      return i;
    };
    const nf: typeof faces = [];
    for (const [a, b, c] of faces) {
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  const out = { verts, faces };
  cache.set(level, out);
  return out;
}

function norm(v: V): V {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function hash(i: number, seed: number) {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Poloměr ve směru `d` (jednotkový): 1 + součet několika hladkých „hrbolů“ (kosinové laloky
 * kolem náhodných směrů). Plynulé → hrubá kolizní síť i jemná render síť dají stejný tvar.
 */
export function blobRadius(d: V, seed: number, rough: number): number {
  let r = 1;
  for (let k = 0; k < 7; k++) {
    const a = norm([hash(k * 3, seed), hash(k * 3 + 1, seed), hash(k * 3 + 2, seed)]);
    const dot = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    const w = hash(k + 40, seed);
    r += rough * w * Math.max(0, dot) ** 3 * 0.6;
  }
  return Math.max(0.55, r);
}

/** Vrcholy deformované koule (jednotkové měřítko) – pro kolizní obal. */
export function blobPoints(seed: number, rough: number, level = 1): V[] {
  return icosphere(level).verts.map((d) => {
    const r = blobRadius(d, seed, rough);
    return [d[0] * r, d[1] * r, d[2] * r];
  });
}
