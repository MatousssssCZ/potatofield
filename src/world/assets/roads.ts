import type { Part } from '../parts';
import { registerAsset, type Params } from '../registry';

/**
 * Kreslená ulice: body (lokálně x,z) → hladká křivka (Catmull-Rom) → asfaltový pás, obrubníky,
 * chodníky a vodorovné značení. Ulice kopíruje terén (volitelně). Body se edituje úchopy
 * ve viewportu (rovinky = dva body daleko od sebe, zatáčka = víc bodů do oblouku).
 */
const n = (p: Params, k: string) => p[k] as number;

export type Pt = [number, number];

export function parsePoints(s: string): Pt[] {
  const out: Pt[] = [];
  for (const chunk of String(s).split(';')) {
    const [x, z] = chunk.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) out.push([x, z]);
  }
  return out;
}

export function formatPoints(pts: Pt[]): string {
  return pts.map(([x, z]) => `${Math.round(x * 100) / 100},${Math.round(z * 100) / 100}`).join(';');
}

/** Vzorkování Catmull-Rom (centripetální) křivky po zhruba `step` metrech; prochází všemi body. */
export function sampleCurve(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(1, Math.ceil(seg / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Posun křivky do strany o `d` (kladně doleva po směru jízdy). */
export function offsetCurve(c: Pt[], d: number): Pt[] {
  return c.map((p, i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    return [p[0] - (tz / l) * d, p[1] + (tx / l) * d];
  });
}

/** Úseky křivky mezi vzdálenostmi [s0, s1] (pro přerušované čáry). */
function slice(c: Pt[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [];
  let acc = 0;
  for (let i = 0; i + 1 < c.length; i++) {
    const a = c[i], b = c[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lerp = (s: number): Pt => {
      const t = Math.max(0, Math.min(1, (s - acc) / (l || 1)));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    if (acc + l >= s0 && acc <= s1) {
      if (!out.length) out.push(lerp(Math.max(s0, acc)));
      out.push(lerp(Math.min(s1, acc + l)));
    }
    acc += l;
  }
  return out;
}

function lengthOf(c: Pt[]) {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
  return s;
}

registerAsset({
  assetId: 'street.roadPath',
  label: 'Ulice (kreslená body)',
  category: 'street',
  generatorVersion: 1,
  params: [
    { key: 'points', label: 'Body', type: 'points', default: '0,0;24,0' },
    { key: 'width', label: 'Šířka vozovky', type: 'number', min: 3, max: 24, step: 0.5, unit: 'm', default: 7 },
    { key: 'sidewalk', label: 'Chodníky', type: 'bool', default: true },
    { key: 'sidewalkWidth', label: 'Šířka chodníku', type: 'number', min: 0.8, max: 6, step: 0.1, unit: 'm', default: 2.2 },
    {
      key: 'lines',
      label: 'Značení',
      type: 'enum',
      default: 'dashed',
      options: [
        { value: 'none', label: 'Bez čar' },
        { value: 'dashed', label: 'Přerušovaná osa' },
        { value: 'solid', label: 'Plná osa' },
        { value: 'edges', label: 'Osa + okraje' },
      ],
    },
    { key: 'follow', label: 'Kopírovat terén', type: 'bool', default: true },
  ],
  usesTerrain: (p) => !!p.follow,
  materials: ['asphalt', 'dirt', 'sand', 'paving'],
  defaultMaterial: 'asphalt',
  describe(p) {
    const pts = parsePoints(String(p.points));
    return `${pts.length} bodů, délka ${lengthOf(sampleCurve(pts, 1)).toFixed(0)} m · táhni body, klik na „+“ přidá bod, Shift+klik bod smaže`;
  },
  generate(p, seed, material, ctx) {
    const pts = parsePoints(String(p.points));
    if (pts.length < 2) return [];
    const W = n(p, 'width');
    const c = sampleCurve(pts, 1.5);
    const follow = !!p.follow;
    // Různé ulice o pár milimetrů jinak vysoko → křižovatky se neblikají (z-fighting).
    const lift = 0.04 + (seed % 7) * 0.003;
    const y = (q: Pt) => (follow ? ctx.ground(q[0], q[1]) : 0);
    const path = (curve: Pt[], dy: number): [number, number, number][] => curve.map((q) => [q[0], y(q) + dy, q[1]]);
    const parts: Part[] = [{ shape: 'strip', pos: [0, 0, 0], size: [W, 0.25, 0], path: path(c, lift), material, castShadow: false }];
    if (p.sidewalk) {
      const sw = n(p, 'sidewalkWidth'), curb = 0.15;
      for (const s of [-1, 1]) {
        parts.push({ shape: 'strip', pos: [0, 0, 0], size: [0.2, curb + 0.3, 0], path: path(offsetCurve(c, s * (W / 2 + 0.1)), lift + curb), material: 'concreteLight', collide: true, castShadow: false });
        parts.push({ shape: 'strip', pos: [0, 0, 0], size: [sw, curb + 0.3, 0], path: path(offsetCurve(c, s * (W / 2 + 0.2 + sw / 2)), lift + curb - 0.01), material: 'paving', collide: true, castShadow: false });
      }
    }
    const lines = p.lines as string;
    if (lines !== 'none' && material === 'asphalt') {
      const total = lengthOf(c);
      const line = (curve: Pt[]) => parts.push({ shape: 'strip', pos: [0, 0, 0], size: [0.14, 0, 0], path: path(curve, lift + 0.008), material: 'paint', castShadow: false });
      if (lines === 'dashed') for (let s = 1; s < total - 1; s += 6) line(slice(c, s, Math.min(total - 1, s + 3)));
      else line(c);
      if (lines === 'edges') for (const s of [-1, 1]) line(offsetCurve(c, s * (W / 2 - 0.35)));
    }
    return parts;
  },
});
