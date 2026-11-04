/**
 * Procedurální generátor dlaždicových (tileable) textur. Bez DOM – běží ve Web Workeru.
 * Vlastní dílo projektu, žádné převzaté obrázky (viz ASSET_CREDITS.md).
 *
 * Každý recept vrací pro pixel: barvu (lineární 0–1), výšku (0–1), drsnost, kovovost, AO.
 */

export interface TexOutput {
  size: number;
  albedo: Uint8Array; // sRGB RGBA
  normal: Uint8Array; // tangent-space RGBA
  orm: Uint8Array; // R = AO, G = roughness, B = metalness
}

// ---------------- Šum ----------------

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a: number, p: number) => ((a % p) + p) % p;

/** Hodnotový šum s periodou `p` (celé číslo) → dlaždicový. */
function vnoise(x: number, y: number, p: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = mod(xi, p), x1 = mod(xi + 1, p), y0 = mod(yi, p), y1 = mod(yi + 1, p);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = fade(xf), v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** fBm v rozsahu ~0–1. u, v ∈ [0,1). `base` = perioda první oktávy. */
function fbm(u: number, v: number, base: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0, amp = 0.5, norm = 0, p = base;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(u * p, v * p, p, seed + i * 17) * amp;
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

/** Ridged šum pro praskliny (0 = hřbet). */
function ridge(u: number, v: number, base: number, oct: number, seed: number): number {
  return Math.abs(fbm(u, v, base, oct, seed) - 0.5) * 2;
}

/** Dlaždicový Worley F1 (vzdálenost k nejbližšímu bodu) a ID buňky. */
function worley(u: number, v: number, p: number, seed: number): { d: number; id: number; d2: number } {
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = mod(cx, p), wy = mod(cy, p);
      const px = cx + hash2(wx, wy, seed), py = cy + hash2(wx, wy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(wx, wy, seed + 2);
      } else if (d < d2) d2 = d;
    }
  return { d: d1, id, d2 };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
type RGB = [number, number, number];
const mixc = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mulc = (a: RGB, s: number): RGB => [a[0] * s, a[1] * s, a[2] * s];
/** sRGB hex → lineární RGB. */
function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

interface Px {
  c: RGB;
  h: number;
  r: number;
  m: number;
  ao: number;
  /** Průhlednost (alpha test), výchozí 1. */
  a?: number;
}

type Recipe = (u: number, v: number) => Px;

// ---------------- Recepty ----------------

function plaster(base: string, stain: string, seed: number): Recipe {
  const b = hex(base), st = hex(stain);
  return (u, v) => {
    const macro = fbm(u, v, 3, 4, seed);
    const fine = fbm(u, v, 48, 3, seed + 5);
    const grain = vnoise(u * 256, v * 256, 256, seed + 9);
    // Skvrny a stékající špína (protažené svisle).
    const streak = fbm(u * 1, v * 0.25, 8, 3, seed + 21);
    const stainT = smooth(0.58, 0.85, macro) * 0.4 + smooth(0.62, 0.88, streak) * 0.3;
    // Opadaná omítka.
    const chip = smooth(0.7, 0.74, fbm(u, v, 6, 5, seed + 33));
    const crackMask = smooth(0.62, 0.78, fbm(u, v, 3, 3, seed + 45));
    const crack = (1 - smooth(0.0, 0.02, ridge(u, v, 4, 5, seed + 44))) * crackMask;
    let c = mixc(b, st, stainT);
    c = mulc(c, 0.9 + 0.18 * fine + 0.06 * (grain - 0.5));
    c = mixc(c, mulc(st, 0.75), chip * 0.7);
    c = mulc(c, 1 - crack * 0.45);
    const h = 0.55 + fine * 0.3 + grain * 0.08 - chip * 0.35 - crack * 0.25;
    return { c, h, r: 0.88 + grain * 0.08, m: 0, ao: 1 - chip * 0.25 - crack * 0.4 };
  };
}

function concrete(base: string, seed: number, formwork = true): Recipe {
  const b = hex(base);
  return (u, v) => {
    const macro = fbm(u, v, 2, 4, seed);
    const mid = fbm(u, v, 12, 4, seed + 3);
    const w = worley(u, v, 40, seed + 7);
    const pore = 1 - smooth(0.04, 0.12, w.d);
    const speck = vnoise(u * 300, v * 300, 300, seed + 11);
    const seam = formwork ? 1 - smooth(0.0, 0.006, Math.abs(mod(v * 2, 1) - 0.5) - 0.494) : 0;
    let c = mulc(b, 0.82 + 0.3 * macro + 0.12 * (mid - 0.5));
    c = mulc(c, 1 + (speck - 0.5) * 0.12);
    c = mulc(c, 1 - pore * 0.35 - seam * 0.12);
    const water = smooth(0.5, 0.85, fbm(u * 1.0, v * 0.3, 6, 3, seed + 19));
    c = mulc(c, 1 - water * 0.22);
    // Otvory po spínacích tyčích bednění (pravidelná mřížka).
    const tu = mod(u * 4, 1) - 0.5, tv = mod(v * 2, 1) - 0.25;
    const tie = formwork ? smooth(0.03, 0.015, Math.hypot(tu * 0.5, tv)) : 0;
    c = mulc(c, 1 - tie * 0.5);
    const patch = smooth(0.58, 0.62, fbm(u, v, 5, 4, seed + 23));
    c = mixc(c, mulc(b, 1.12), patch * 0.25);
    const h = 0.6 + mid * 0.25 + speck * 0.05 - pore * 0.4 - seam * 0.2 - tie * 0.5 + patch * 0.05;
    return { c, h, r: 0.82 + speck * 0.1 - water * 0.05, m: 0, ao: 1 - pore * 0.5 - tie * 0.4 };
  };
}

function bricks(seed: number, rows: number, cols: number, palette: string[], mortar: string): Recipe {
  const pal = palette.map(hex), mo = hex(mortar);
  const gapV = 0.11, gapU = 0.035; // podíl spáry v buňce (svisle/vodorovně)
  return (u, v) => {
    const row = Math.floor(v * rows);
    const ru = u * cols + (row % 2 ? 0.5 : 0);
    const col = Math.floor(ru);
    const fu = ru - col, fv = v * rows - row;
    const id = hash2(mod(col, cols), row, seed);
    const edge = Math.min(fu / gapU, (1 - fu) / gapU, fv / gapV, (1 - fv) / gapV);
    const inBrick = smooth(0.6, 1.4, edge);
    const bevel = smooth(0.8, 3, edge);
    const noise = fbm(u, v, 16, 4, seed + 4);
    const chips = smooth(0.66, 0.72, fbm(u, v, 24, 4, seed + 8)) * inBrick;
    let bc = pal[Math.floor(id * pal.length) % pal.length];
    bc = mulc(bc, 0.82 + id * 0.3 + (noise - 0.5) * 0.3);
    const soot = smooth(0.5, 0.9, fbm(u, v, 3, 3, seed + 12));
    bc = mulc(bc, 1 - soot * 0.25);
    const mc = mulc(mo, 0.85 + noise * 0.25);
    const c = mixc(mc, mulc(bc, 1 - chips * 0.2), inBrick);
    const h = inBrick * (0.6 + bevel * 0.3 + noise * 0.1 - chips * 0.25);
    return { c, h, r: mix(0.95, 0.86, inBrick), m: 0, ao: mix(0.55, 1, smooth(0, 1.2, edge)) };
  };
}

function blocks(seed: number, rows: number, cols: number, base: string): Recipe {
  const b = hex(base);
  return (u, v) => {
    const row = Math.floor(v * rows);
    const off = hash2(row, 7, seed) * 0.6;
    const ru = u * cols + off;
    const col = Math.floor(ru);
    const fu = ru - col, fv = v * rows - row;
    const id = hash2(mod(col, cols), row, seed + 1);
    const edgeD = Math.min(fu, 1 - fu, fv * (rows / cols) * 0.7, (1 - fv) * (rows / cols) * 0.7);
    const wob = (fbm(u, v, 12, 3, seed + 5) - 0.5) * 0.04;
    const inB = smooth(0.012, 0.03, edgeD + wob);
    const n = fbm(u, v, 10, 5, seed + 3);
    const strata = vnoise(u * 4, v * 90, 90, seed + 9);
    let c = mulc(b, 0.85 + id * 0.25 + (n - 0.5) * 0.25 + (strata - 0.5) * 0.08);
    c = mixc(mulc(b, 0.6), c, inB);
    const h = inB * (0.7 + n * 0.3 - smooth(0.02, 0.0, edgeD) * 0.2);
    return { c, h, r: 0.9, m: 0, ao: mix(0.6, 1, inB) };
  };
}

function paving(seed: number, n: number, base: string, gap: string): Recipe {
  const b = hex(base), g = hex(gap);
  return (u, v) => {
    const fu = u * n, fv = v * n;
    const cu = Math.floor(fu), cv = Math.floor(fv);
    const lu = fu - cu, lv = fv - cv;
    const id = hash2(mod(cu, n), mod(cv, n), seed);
    const wob = (fbm(u, v, 20, 3, seed + 2) - 0.5) * 0.05;
    const e = Math.min(lu, 1 - lu, lv, 1 - lv) + wob;
    const inS = smooth(0.03, 0.07, e);
    const nn = fbm(u, v, 24, 4, seed + 6);
    const worn = smooth(0.4, 0.8, fbm(u, v, 3, 3, seed + 9));
    let c = mulc(b, 0.8 + id * 0.3 + (nn - 0.5) * 0.25);
    c = mixc(c, mulc(b, 1.12), worn * 0.3);
    c = mixc(mulc(g, 0.9 + nn * 0.2), c, inS);
    const h = inS * (0.65 + smooth(0.03, 0.2, e) * 0.25 + nn * 0.1);
    return { c, h, r: mix(1, 0.78 - worn * 0.1, inS), m: 0, ao: mix(0.5, 1, inS) };
  };
}

function asphalt(seed: number): Recipe {
  const b = hex('#3a3936');
  return (u, v) => {
    const m = fbm(u, v, 3, 4, seed);
    const agg = vnoise(u * 400, v * 400, 400, seed + 3);
    const w = worley(u, v, 90, seed + 5);
    const stone = smooth(0.25, 0.1, w.d) * (w.id > 0.6 ? 1 : 0);
    const crack = 1 - smooth(0.0, 0.025, ridge(u, v, 3, 6, seed + 9));
    const crackMask = smooth(0.55, 0.7, fbm(u, v, 2, 3, seed + 13));
    const faded = smooth(0.4, 0.8, fbm(u, v, 4, 4, seed + 17));
    let c = mulc(b, 0.8 + m * 0.35 + (agg - 0.5) * 0.25);
    c = mixc(c, hex('#8a857b'), stone * 0.55);
    c = mixc(c, hex('#6d675d'), faded * 0.35);
    c = mulc(c, 1 - crack * crackMask * 0.6);
    const h = 0.5 + agg * 0.2 + stone * 0.25 - crack * crackMask * 0.4;
    return { c, h, r: 0.92 - stone * 0.1, m: 0, ao: 1 - crack * crackMask * 0.5 };
  };
}

function ground(seed: number, base: string, dark: string, pebbleAmt: number): Recipe {
  const b = hex(base), d = hex(dark);
  return (u, v) => {
    const m = fbm(u, v, 2, 5, seed);
    const ripple = vnoise(u * 6 + fbm(u, v, 4, 2, seed + 1) * 3, v * 40, 40, seed + 2);
    const fine = vnoise(u * 350, v * 350, 350, seed + 3);
    const w = worley(u, v, 60, seed + 4);
    const pebble = smooth(0.32, 0.18, w.d) * (w.id < pebbleAmt * 0.5 ? 1 : 0);
    const w2 = worley(u, v, 18, seed + 8);
    const rock = smooth(0.22, 0.12, w2.d) * (w2.id < pebbleAmt * 0.25 ? 1 : 0);
    let c = mixc(b, d, smooth(0.35, 0.75, m) * 0.7);
    c = mulc(c, 0.9 + fine * 0.18 + ripple * 0.05);
    c = mixc(c, mulc(hex('#b3a58c'), 0.75 + w.id * 0.45), pebble * 0.7);
    c = mixc(c, mulc(hex('#9c8f7a'), 0.75 + w2.id * 0.4), rock * 0.9);
    const h = 0.4 + ripple * 0.12 + fine * 0.08 + pebble * 0.18 * smooth(0.32, 0.05, w.d) + rock * 0.3 * smooth(0.22, 0.04, w2.d);
    return { c, h, r: 0.97 - pebble * 0.1, m: 0, ao: 1 - smooth(0.3, 0.1, w.d) * 0.15 * (1 - pebble) };
  };
}

function wood(seed: number, base: string, planks: number): Recipe {
  const b = hex(base);
  return (u, v) => {
    const pv = v * planks;
    const pi = Math.floor(pv), pf = pv - pi;
    const id = hash2(pi, 3, seed);
    const grain = fbm(u * 0.5 + id * 3, pf * 0.08 + id, 6, 5, seed + 2);
    const rings = Math.sin((u * 30 + grain * 12 + id * 10) * Math.PI) * 0.5 + 0.5;
    const gap = 1 - smooth(0.0, 0.06, Math.min(pf, 1 - pf));
    const weather = fbm(u, v, 3, 4, seed + 5);
    let c = mulc(b, 0.75 + id * 0.35 + rings * 0.12 + (grain - 0.5) * 0.3);
    c = mixc(c, hex('#8b8478'), smooth(0.45, 0.85, weather) * 0.45); // vybledlé šedé dřevo
    c = mulc(c, 1 - gap * 0.7);
    const knot = smooth(0.06, 0.0, worley(u, v, 6, seed + 9).d) * 0.6;
    c = mulc(c, 1 - knot * 0.4);
    const h = 0.6 + rings * 0.08 + grain * 0.12 - gap * 0.6;
    return { c, h, r: 0.82 + weather * 0.12, m: 0, ao: 1 - gap * 0.6 };
  };
}

function paintedMetal(seed: number, paint: string, chipAmt = 0.72): Recipe {
  const p = hex(paint), rust = hex('#6b3d22'), steel = hex('#7a7a78');
  return (u, v) => {
    const n = fbm(u, v, 8, 5, seed);
    const chipN = fbm(u, v, 10, 5, seed + 3);
    const chip = smooth(chipAmt, chipAmt + 0.03, chipN);
    const rustT = smooth(chipAmt - 0.05, chipAmt + 0.08, chipN);
    const streak = smooth(0.55, 0.85, fbm(u * 1, v * 0.15, 12, 3, seed + 7));
    const scratch = smooth(0.985, 1.0, vnoise(u * 2, v * 260, 260, seed + 11)) * 0.6;
    let c = mulc(p, 0.88 + n * 0.22);
    c = mixc(c, rust, streak * 0.35);
    c = mixc(c, mixc(rust, steel, smooth(0.8, 0.95, chipN)), rustT * 0.9);
    c = mixc(c, mulc(p, 1.35), scratch);
    const h = 0.6 + n * 0.05 - chip * 0.15;
    return { c, h, r: mix(0.6, 0.85, rustT) + n * 0.08, m: chip * smooth(0.8, 0.95, chipN) * 0.8, ao: 1 };
  };
}

function bareMetal(seed: number): Recipe {
  const b = hex('#8c8d8a');
  return (u, v) => {
    const n = fbm(u, v, 6, 5, seed);
    const brush = vnoise(u * 2, v * 400, 400, seed + 1);
    const rustT = smooth(0.62, 0.8, fbm(u, v, 5, 5, seed + 3));
    let c = mulc(b, 0.8 + n * 0.3 + brush * 0.08);
    c = mixc(c, hex('#5e3a22'), rustT * 0.8);
    return { c, h: 0.5 + brush * 0.05 + rustT * 0.15, r: 0.45 + n * 0.2 + rustT * 0.4, m: 1 - rustT * 0.85, ao: 1 };
  };
}

function canvas(seed: number, base: string): Recipe {
  const b = hex(base);
  return (u, v) => {
    const wx = Math.sin(u * Math.PI * 2 * 120) * 0.5 + 0.5;
    const wy = Math.sin(v * Math.PI * 2 * 120) * 0.5 + 0.5;
    const weave = (u * 120 + v * 120) % 2 < 1 ? wx : wy;
    const n = fbm(u, v, 4, 5, seed);
    const dirt = smooth(0.5, 0.85, fbm(u, v, 3, 4, seed + 4));
    let c = mulc(b, 0.85 + weave * 0.12 + (n - 0.5) * 0.25);
    c = mixc(c, hex('#6e5f47'), dirt * 0.45);
    return { c, h: 0.5 + weave * 0.25 + n * 0.15, r: 0.97, m: 0, ao: 0.9 + weave * 0.1 };
  };
}

function paint(seed: number, base: string): Recipe {
  const b = hex(base);
  return (u, v) => {
    const wear = smooth(0.5, 0.75, fbm(u, v, 6, 5, seed));
    const n = vnoise(u * 200, v * 200, 200, seed + 3);
    const c = mixc(mulc(b, 0.92 + n * 0.1), hex('#9a8f7c'), wear * 0.6);
    return { c, h: 0.6 - wear * 0.2 + n * 0.05, r: 0.75 + wear * 0.2, m: 0, ao: 1 };
  };
}

function target(seed: number): Recipe {
  const b = hex('#c9b48a');
  return (u, v) => {
    const n = fbm(u, v, 8, 4, seed);
    const c = mulc(b, 0.85 + n * 0.25);
    return { c, h: 0.5 + n * 0.1, r: 0.95, m: 0, ao: 1 };
  };
}


function corrugated(seed: number, paint: string, rustAmt: number, ribs = 24): Recipe {
  const p = hex(paint), rust = hex('#6e4126');
  return (u, v) => {
    const wave = Math.sin(u * Math.PI * 2 * ribs);
    const n = fbm(u, v, 6, 5, seed);
    const streak = smooth(0.5, 0.85, fbm(u * 1.0, v * 0.12, 10, 4, seed + 3));
    const rustT = smooth(1 - rustAmt, 1 - rustAmt + 0.2, fbm(u, v, 5, 5, seed + 7));
    const dent = smooth(0.7, 0.9, fbm(u, v, 3, 3, seed + 11)) * 0.3;
    let c = mulc(p, 0.85 + n * 0.2 + wave * 0.05);
    c = mixc(c, rust, Math.max(streak * 0.4, rustT * 0.85) * (rustAmt > 0 ? 1 : 0.3));
    c = mulc(c, 1 - dent * 0.15);
    return { c, h: 0.5 + wave * 0.45 - dent * 0.1, r: 0.55 + rustT * 0.35 + n * 0.1, m: 0.25 * (1 - rustT), ao: 0.85 + 0.15 * (wave * 0.5 + 0.5) };
  };
}

function chainLink(seed: number): Recipe {
  const m = hex('#8b8d8a');
  return (u, v) => {
    const k = 24;
    const a = (u + v) * k, b = (u - v) * k;
    const da = Math.abs(a - Math.round(a)), db = Math.abs(b - Math.round(b));
    const wire = 1 - smooth(0.04, 0.09, Math.min(da, db));
    const n = vnoise(u * 50, v * 50, 50, seed);
    return { c: mulc(m, 0.75 + n * 0.3), h: wire, r: 0.5, m: 0.8, ao: 1, a: wire };
  };
}

function bitumen(seed: number): Recipe {
  const b = hex('#5b5650');
  return (u, v) => {
    const n = fbm(u, v, 4, 5, seed);
    const g = vnoise(u * 300, v * 300, 300, seed + 1);
    const seam = 1 - smooth(0, 0.01, Math.abs(mod(v * 3, 1) - 0.5) - 0.49);
    const c = mulc(mixc(b, hex('#8a8173'), smooth(0.5, 0.8, n) * 0.5), 0.85 + g * 0.3 - seam * 0.2);
    return { c, h: 0.5 + g * 0.2 + seam * 0.2, r: 0.9, m: 0, ao: 1 - seam * 0.3 };
  };
}

function shutter(seed: number, paint: string): Recipe {
  const p = hex(paint);
  return (u, v) => {
    const slats = 22;
    const f = mod(v * slats, 1);
    const groove = 1 - smooth(0.0, 0.12, Math.min(f, 1 - f));
    const n = fbm(u, v, 6, 4, seed);
    const grime = smooth(0.4, 0.9, fbm(u * 0.5, v * 1.5, 4, 4, seed + 2));
    const graffiti = smooth(0.78, 0.8, fbm(u, v, 3, 4, seed + 9)) * (v > 0.3 && v < 0.7 ? 1 : 0);
    let c = mulc(p, 0.85 + n * 0.2 - groove * 0.35);
    c = mixc(c, hex('#4d443a'), grime * 0.35);
    c = mixc(c, hex('#2c3c66'), graffiti * 0.7);
    return { c, h: 0.6 - groove * 0.5, r: 0.6 + grime * 0.3, m: 0.3, ao: 1 - groove * 0.4 };
  };
}

function stripes(seed: number, a: string, b2: string, count: number): Recipe {
  const ca = hex(a), cb = hex(b2);
  return (u, v) => {
    const s = mod(u * count, 1) < 0.5 ? 1 : 0;
    const n = fbm(u, v, 5, 4, seed);
    const fade = smooth(0.4, 0.9, fbm(u, v, 3, 3, seed + 4));
    const weave = (Math.sin(u * Math.PI * 2 * 180) * Math.sin(v * Math.PI * 2 * 180)) * 0.5 + 0.5;
    let c = mixc(cb, ca, s);
    c = mulc(c, 0.85 + n * 0.2 + weave * 0.05);
    c = mixc(c, hex('#d8cdb4'), fade * 0.3);
    return { c, h: 0.5 + weave * 0.2, r: 0.95, m: 0, ao: 1 };
  };
}

function acUnit(seed: number): Recipe {
  const b = hex('#cfcbc0');
  return (u, v) => {
    const slot = mod(v * 14, 1) < 0.35 && u > 0.08 && u < 0.92 ? 1 : 0;
    const n = fbm(u, v, 5, 4, seed);
    const dirt = smooth(0.3, 0.9, fbm(u, v * 0.3, 6, 4, seed + 2));
    let c = mulc(b, 0.85 + n * 0.15 - slot * 0.5);
    c = mixc(c, hex('#6b5a45'), dirt * 0.35);
    return { c, h: 0.6 - slot * 0.4, r: 0.6, m: 0.1, ao: 1 - slot * 0.4 };
  };
}

function produce(seed: number, col: string): Recipe {
  const c0 = hex(col);
  return (u, v) => {
    const w = worley(u, v, 16, seed);
    const ball = smooth(0.5, 0.1, w.d);
    const c = mulc(c0, 0.6 + ball * 0.5 + w.id * 0.15);
    return { c, h: ball, r: 0.6, m: 0, ao: 0.6 + ball * 0.4 };
  };
}

export const RECIPES: Record<string, { recipe: () => Recipe; normalStrength: number }> = {
  plaster: { recipe: () => plaster('#d8c8a8', '#a68e6a', 11), normalStrength: 2.2 },
  plasterWarm: { recipe: () => plaster('#d9b98a', '#9c7a55', 23), normalStrength: 2.2 },
  plasterWhite: { recipe: () => plaster('#e6e0d2', '#a9a08e', 31), normalStrength: 2.0 },
  concrete: { recipe: () => concrete('#9a978f', 41), normalStrength: 2.5 },
  concreteLight: { recipe: () => concrete('#bdb7a9', 43, false), normalStrength: 2.5 },
  brick: { recipe: () => bricks(51, 16, 4, ['#b98c5e', '#c79a68', '#a97b52', '#cfa778', '#9d6f4a'], '#cbbfa8'), normalStrength: 4 },
  sandstone: { recipe: () => blocks(61, 5, 3, '#cdb48a'), normalStrength: 3.5 },
  paving: { recipe: () => paving(71, 4, '#b0a58f', '#8a7a5e'), normalStrength: 4 },
  asphalt: { recipe: () => asphalt(81), normalStrength: 2.5 },
  sand: { recipe: () => ground(91, '#c9ab7f', '#a58460', 0.25), normalStrength: 2.5 },
  dirt: { recipe: () => ground(101, '#9a7c5a', '#6e5640', 0.5), normalStrength: 3 },
  wood: { recipe: () => wood(111, '#8a6a48', 5), normalStrength: 3 },
  woodDark: { recipe: () => wood(121, '#5e4733', 5), normalStrength: 3 },
  metal: { recipe: () => bareMetal(131), normalStrength: 1.5 },
  paintedMetal: { recipe: () => paintedMetal(141, '#5b5e44'), normalStrength: 1.5 },
  paintedMetalBlue: { recipe: () => paintedMetal(151, '#3f5a6e', 0.68), normalStrength: 1.5 },
  paintedMetalRed: { recipe: () => paintedMetal(161, '#8a2f22', 0.68), normalStrength: 1.5 },
  fabricSand: { recipe: () => canvas(171, '#b39e78'), normalStrength: 3 },
  paint: { recipe: () => paint(181, '#e8e2d2'), normalStrength: 1 },
  paintDim: { recipe: () => paint(191, '#cfc6b0'), normalStrength: 1 },
  target: { recipe: () => target(201), normalStrength: 1 },
  plasterOchre: { recipe: () => plaster('#c99a5f', '#8a6a44', 211), normalStrength: 2.2 },
  concreteDark: { recipe: () => concrete('#6f6b63', 221, false), normalStrength: 2.5 },
  metalSheet: { recipe: () => corrugated(231, '#a7aaa6', 0.25), normalStrength: 6 },
  metalSheetRust: { recipe: () => corrugated(241, '#8a7f6e', 0.7), normalStrength: 6 },
  containerRed: { recipe: () => corrugated(251, '#8f2f24', 0.3, 18), normalStrength: 6 },
  containerBlue: { recipe: () => corrugated(261, '#2f5476', 0.3, 18), normalStrength: 6 },
  containerGreen: { recipe: () => corrugated(271, '#3f5a3a', 0.3, 18), normalStrength: 6 },
  containerSand: { recipe: () => corrugated(281, '#b39a6c', 0.3, 18), normalStrength: 6 },
  chainLink: { recipe: () => chainLink(291), normalStrength: 2 },
  roof: { recipe: () => bitumen(301), normalStrength: 2 },
  shutter: { recipe: () => shutter(311, '#9c9a92'), normalStrength: 4 },
  awningRed: { recipe: () => stripes(321, '#a8352a', '#e3d6bb', 8), normalStrength: 1 },
  awningBlue: { recipe: () => stripes(331, '#2f5d8a', '#e3d6bb', 8), normalStrength: 1 },
  awningGreen: { recipe: () => stripes(341, '#3f6b3c', '#e3d6bb', 8), normalStrength: 1 },
  awningSand: { recipe: () => stripes(351, '#b5864a', '#e3d6bb', 6), normalStrength: 1 },
  acUnit: { recipe: () => acUnit(361), normalStrength: 2 },
  crateFruitA: { recipe: () => produce(371, '#c8551f'), normalStrength: 3 },
  crateFruitB: { recipe: () => produce(381, '#c9a227'), normalStrength: 3 },
  crateFruitC: { recipe: () => produce(391, '#5f8a2c'), normalStrength: 3 },
};

/** sRGB kódování lineární hodnoty. */
function toSRGB(x: number): number {
  x = clamp01(x);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

export function generateTexture(id: string, size: number): TexOutput {
  const def = RECIPES[id];
  if (!def) throw new Error(`neznámý recept ${id}`);
  const recipe = def.recipe();
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const normal = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const px = recipe((x + 0.5) / size, (y + 0.5) / size);
      albedo[i * 4] = Math.round(toSRGB(px.c[0]) * 255);
      albedo[i * 4 + 1] = Math.round(toSRGB(px.c[1]) * 255);
      albedo[i * 4 + 2] = Math.round(toSRGB(px.c[2]) * 255);
      albedo[i * 4 + 3] = Math.round(clamp01(px.a ?? 1) * 255);
      orm[i * 4] = Math.round(clamp01(px.ao) * 255);
      orm[i * 4 + 1] = Math.round(clamp01(px.r) * 255);
      orm[i * 4 + 2] = Math.round(clamp01(px.m) * 255);
      orm[i * 4 + 3] = 255;
      height[i] = px.h;
    }
  }
  // Normály z výšky (dlaždicové Sobelovo okolí). Síla se škáluje s rozlišením.
  const k = def.normalStrength * (size / 512);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hx = (dx: number, dy: number) => height[mod(y + dy, size) * size + mod(x + dx, size)];
      const gx = hx(1, -1) + 2 * hx(1, 0) + hx(1, 1) - hx(-1, -1) - 2 * hx(-1, 0) - hx(-1, 1);
      const gy = hx(-1, 1) + 2 * hx(0, 1) + hx(1, 1) - hx(-1, -1) - 2 * hx(0, -1) - hx(1, -1);
      let nx = -gx * k, ny = -gy * k, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      normal[i] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  }
  return { size, albedo, normal, orm };
}
