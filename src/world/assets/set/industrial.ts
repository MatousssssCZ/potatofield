import { rng } from '../../../shared/math';
import type { LadderLocal, Part } from '../../parts';
import { crate, ladderDef, ladderParts, rail, shelf, type Dir } from './bk';
import { bx, rubble, thru } from './modules';
import { reg, type SetMeta } from './residential';

/**
 * Sada 300 · E Průmyslové a vojenské objekty (položky 106–135): sklady, hangáry, sila a nádrže,
 * potrubní mosty, jeřáb, kontrolní stanoviště, strážní věže, bunkry, HESCO, stany a stožáry.
 * Konvence jako u B–D: pivot = střed půdorysu u paty, přední strana −Z.
 */
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regE = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, { ...meta }, 'E');
const CONC = 'concreteLight';
const STEEL = 'paintedMetal';
const SHEET = 'metalSheet';
const RUST = 'metalSheetRust';

// ---------------------------------------------------------------------------
// Pomocné díly
// ---------------------------------------------------------------------------
/**
 * Natočení R = Ry(yaw) · Rx(a) převedené na Eulerovy úhly v pořadí XYZ (jako Three.js a
 * quatFromEuler), aby šikmé nosníky mířily správně i při současném natočení.
 */
function eulerYX(yaw: number, a: number): V3 {
  const c = Math.cos(yaw), s = Math.sin(yaw), ca = Math.cos(a), sa = Math.sin(a);
  const m13 = s * ca;
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(sa, c * ca), Math.asin(m13), Math.atan2(-s * sa, c)];
  return [Math.atan2(c * sa, ca), Math.asin(Math.max(-1, Math.min(1, m13))), 0];
}

/** Kvádr mezi dvěma body (nosník, vzpěra): čtvercový průřez s. */
export function beam(a: V3, b: V3, s: number, material: string, collide = false): Part {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  // Osa boxu = lokální Z: sklopit o pitch nahoru (Rx(−pitch)), pak natočit kolem Y.
  return { shape: 'box', pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: eulerYX(yaw, -pitch), size: [s, s, L], material, collide };
}

/** Válec mezi dvěma body (trubka). */
export function pipe(a: V3, b: V3, d: number, material: string, collide = true): Part {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz);
  // Válec má osu Y: sklopit kolem X o 90° (osa → Z), pak natočit jako nosník.
  const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { shape: 'cylinder', pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: eulerYX(yaw, Math.PI / 2 - pitch), size: [d, L, d], material, collide };
}

/** Zábradlí v libovolném směru (madlo, sloupky; kolize jen pro pohyb, natočená). */
function railLine(a: [number, number], b: [number, number], y: number, h = 1.0): Part[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const c: V3 = [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2];
  const parts: Part[] = [beam([a[0], y + h, a[1]], [b[0], y + h, b[1]], 0.05, STEEL), beam([a[0], y + h / 2, a[1]], [b[0], y + h / 2, b[1]], 0.035, STEEL)];
  for (const p of [a, b]) parts.push(bx(p[0] - 0.025, p[0] + 0.025, y, y + h, p[1] - 0.025, p[1] + 0.025, STEEL, false));
  parts.push({ shape: 'box', pos: [c[0], y + h / 2, c[2]], rot: [0, yaw, 0], size: [0.06, h, L], material: STEEL, collide: true, render: false, moveOnly: true });
  return parts;
}

const cyl = (x: number, y0: number, y1: number, z: number, d: number, material: string, collide = true): Part => ({ shape: 'cylinder', pos: [x, (y0 + y1) / 2, z], size: [d, y1 - y0, d], material, collide });

/** Žebřík s definicí pro simulaci. */
function ladder(x: number, z: number, y0: number, h: number, face: Dir): { parts: Part[]; def: LadderLocal } {
  return { parts: ladderParts(x, z, y0, h, face), def: ladderDef(x, z, y0, h, face) };
}

/** Stěna z plechu (tenká, kolize) s otvory podél X; otvor = [x0, x1, výška]. */
function sheetWallX(x0: number, x1: number, z: number, h: number, holes: [number, number, number][], mat = SHEET, th = 0.1): Part[] {
  const parts: Part[] = [];
  let cur = x0;
  for (const [a, b, hh] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (a > cur) parts.push(bx(cur, a, 0, h, z - th / 2, z + th / 2, mat));
    parts.push(bx(a, b, hh, h, z - th / 2, z + th / 2, mat));
    cur = b;
  }
  if (x1 > cur) parts.push(bx(cur, x1, 0, h, z - th / 2, z + th / 2, mat));
  return parts;
}
function sheetWallZ(z0: number, z1: number, x: number, h: number, holes: [number, number, number][], mat = SHEET, th = 0.1): Part[] {
  return sheetWallX(z0, z1, 0, h, holes, mat, th).map((p) => ({ ...p, pos: [x + p.pos[2], p.pos[1], p.pos[0]] as V3, size: [p.size[2], p.size[1], p.size[0]] as V3 }));
}

/** Sedlová plechová střecha nad obdélníkem (hřeben podél Z), okap ve výšce eave, hřeben ridge. */
function gableRoof(W: number, z0: number, z1: number, eave: number, ridge: number, mat: string, skip?: (side: number, zc: number) => boolean, pieces = 1): Part[] {
  const half = W / 2 + 0.25, rise = ridge - eave, a = Math.atan2(rise, half), L = Math.hypot(rise, half) + 0.05;
  const parts: Part[] = [];
  const seg = (z1 - z0) / pieces;
  for (const s of [-1, 1]) for (let i = 0; i < pieces; i++) {
    const za = z0 + i * seg, zb = za + seg, zc = (za + zb) / 2;
    if (skip?.(s, zc)) continue;
    parts.push({ shape: 'box', pos: [(s * half) / 2, eave + rise / 2 + 0.05, zc], rot: [0, 0, -s * a], size: [L, 0.06, zb - za + 0.3], material: mat, collide: true });
  }
  return parts;
}

/** Ocelový rám skladu: sloupy po obvodu v roztečích, vaznice nahoře (vzhled + kolize sloupů). */
function steelFrame(W: number, D: number, h: number, step: number, s = 0.22): Part[] {
  const parts: Part[] = [];
  const n = Math.round(D / step);
  for (let i = 0; i <= n; i++) {
    const z = -D / 2 + (i * D) / n;
    for (const sx of [-1, 1]) parts.push(bx(sx * W / 2 - (sx > 0 ? s : 0) - (sx < 0 ? 0 : 0) + (sx < 0 ? 0 : 0), sx * W / 2 + (sx < 0 ? s : 0), 0, h, z - s / 2, z + s / 2, STEEL));
    parts.push(bx(-W / 2, W / 2, h - 0.3, h, z - 0.08, z + 0.08, STEEL, false));
  }
  return parts;
}

/** Elipsová (oblouková) skořepina hangáru podél Z: poloosy a (šířka/2), b (výška), n segmentů. */
function archShell(a: number, b: number, z0: number, z1: number, n: number, mat: string, gap?: { side: number; z0: number; z1: number }): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = (Math.PI * i) / n, t1 = (Math.PI * (i + 1)) / n;
    const p0 = [a * Math.cos(t0), b * Math.sin(t0)], p1 = [a * Math.cos(t1), b * Math.sin(t1)];
    const cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2, L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + 0.04;
    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const mk = (za: number, zb: number) => parts.push({ shape: 'box', pos: [cx, cy, (za + zb) / 2], rot: [0, 0, ang], size: [L, 0.14, zb - za], material: mat, collide: true });
    // Dveře v nejnižším segmentu na jedné straně (gap.side = +1 → segment u +X).
    const lowest = gap && ((gap.side > 0 && i === 0) || (gap.side < 0 && i === n - 1));
    if (lowest) {
      mk(z0, gap.z0);
      mk(gap.z1, z1);
    } else mk(z0, z1);
  }
  return parts;
}
/** Výška elipsy v x (0 mimo). */
const archY = (a: number, b: number, x: number) => (Math.abs(x) >= a ? 0 : b * Math.sqrt(1 - (x / a) ** 2));

/** Čelní stěna hangáru z plátků po elipse, otvory [x0, x1, výška]. */
function archEnd(a: number, b: number, z: number, slice: number, holes: [number, number, number][], mat: string): Part[] {
  const parts: Part[] = [];
  for (let x = -a; x < a - 1e-6; x += slice) {
    const xa = x, xb = Math.min(a, x + slice), xc = (xa + xb) / 2;
    const top = archY(a, b, Math.max(Math.abs(xa), Math.abs(xb)) === Math.abs(xa) ? xb : xa) * 0 + archY(a, b, xc);
    const hole = holes.find((h) => xc > h[0] && xc < h[1]);
    const y0 = hole ? hole[2] : 0;
    if (top - y0 > 0.05) parts.push(bx(xa, xb, y0, top, z - 0.08, z + 0.08, mat));
  }
  return parts;
}

/** Pytle s pískem: řady „polštářů“ (vzhled), kolize = jeden kvádr zdi. */
function sandbags(x0: number, x1: number, z0: number, z1: number, h: number, seed: number): Part[] {
  const r = rng(seed);
  const alongX = x1 - x0 >= z1 - z0;
  const L = alongX ? x1 - x0 : z1 - z0, T = alongX ? z1 - z0 : x1 - x0;
  const parts: Part[] = [{ ...bx(x0, x1, 0, h, z0, z1, 'fabricSand'), render: false }];
  const rows = Math.round(h / 0.22);
  for (let k = 0; k < rows; k++) {
    const y = 0.11 + k * (h / rows);
    const off = (k % 2) * 0.3;
    for (let u = -off; u < L - 0.05; u += 0.6) {
      const ua = Math.max(0, u), ub = Math.min(L, u + 0.6);
      if (ub - ua < 0.15) continue;
      const c = (ua + ub) / 2;
      const sz: V3 = alongX ? [ub - ua - 0.03, h / rows + 0.02, T] : [T, h / rows + 0.02, ub - ua - 0.03];
      parts.push({ shape: 'box', pos: alongX ? [x0 + c, y, (z0 + z1) / 2] : [(x0 + x1) / 2, y, z0 + c], rot: [(r() - 0.5) * 0.06, (r() - 0.5) * 0.08, (r() - 0.5) * 0.06], size: sz, material: 'fabricSand' });
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// E106–E108 Plechové sklady
// ---------------------------------------------------------------------------
function shed(W: number, D: number, eave: number, ridge: number, o: { gates: { side: 'front' | 'back'; x0: number; x1: number; h: number }[]; sideDoor?: number; damaged?: boolean; seed: number }): Part[] {
  const parts: Part[] = [bx(-W / 2 + 0.05, W / 2 - 0.05, 0, 0.06, -D / 2 + 0.05, D / 2 - 0.05, 'concreteDark')];
  parts.push(...steelFrame(W, D, eave, 5));
  const g = (side: 'front' | 'back') => o.gates.filter((q) => q.side === side).map((q) => [q.x0, q.x1, q.h] as [number, number, number]);
  parts.push(...sheetWallX(-W / 2, W / 2, -D / 2 + 0.05, eave, g('front')), ...sheetWallX(-W / 2, W / 2, D / 2 - 0.05, eave, g('back')));
  // Štíty nad okapem (trojúhelník z plátků).
  for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) for (let x = -W / 2; x < W / 2 - 1e-6; x += 1) {
    const xc = x + 0.5, top = eave + (ridge - eave) * (1 - Math.abs(xc) / (W / 2));
    parts.push(bx(x, x + 1, eave, top, z - 0.05, z + 0.05, SHEET, false));
  }
  // Boky: levý (+X) se dveřmi, pravý (−X) případně potrhaný.
  parts.push(...sheetWallZ(-D / 2, D / 2, W / 2 - 0.05, eave, o.sideDoor !== undefined ? [[o.sideDoor - 0.6, o.sideDoor + 0.6, 2.2]] : []));
  if (!o.damaged) parts.push(...sheetWallZ(-D / 2, D / 2, -W / 2 + 0.05, eave, []));
  else {
    // Odtržené opláštění v z ∈ (−1, 3,5) nad 1,2 m; plech visí ohnutý, odkrytá paždíky.
    parts.push(...sheetWallZ(-D / 2, -1, -W / 2 + 0.05, eave, []), ...sheetWallZ(3.5, D / 2, -W / 2 + 0.05, eave, []));
    parts.push(...sheetWallZ(-1, 3.5, -W / 2 + 0.05, 1.2, []));
    parts.push({ shape: 'box', pos: [-W / 2 - 0.35, 1.0, 1.2], rot: [0.15, 0, 0.55], size: [0.05, 2.2, 2.4], material: RUST });
    for (const y of [1.2, 2.4, 3.6]) parts.push(bx(-W / 2, -W / 2 + 0.12, y - 0.06, y + 0.06, -1, 3.5, STEEL, false));
  }
  parts.push(...gableRoof(W, -D / 2 - 0.2, D / 2 + 0.2, eave, ridge, SHEET, o.damaged ? (s, zc) => s < 0 && zc > D / 2 - 2.6 : undefined, o.damaged ? 4 : 1));
  if (o.damaged) {
    // Utržený roh střechy: kus plechu visí šikmo, krokve odkryté.
    parts.push({ shape: 'box', pos: [-W / 2 + 1.0, eave - 1.0, D / 2 - 0.9], rot: [0.3, 0.2, 1.1], size: [2.6, 0.05, 2.0], material: RUST });
    for (let i = 0; i < 3; i++) parts.push(beam([-W / 2, eave, D / 2 - 0.4 - i * 0.9], [0, ridge, D / 2 - 0.4 - i * 0.9], 0.12, STEEL));
    parts.push(...rubble(-W / 2 + 0.8, 1.0, 4, [1.0, 3.0], o.seed, 0.4));
  }
  return parts;
}

regE(106, 'shedSmall', 'Malý plechový sklad', {
  describe: () => '8 × 10 × 5 m, ocelový rám, sedlová plechová střecha (okap 4,2 m), otevřená vrata 4 × 4 m, boční dveře',
  generate(_p, seed) {
    const parts = shed(8, 10, 4.2, 5.0, { gates: [{ side: 'front', x0: -2, x1: 2, h: 4 }], sideDoor: 2.5, seed });
    parts.push(...crate(-2.8, 3.5, 0.06, 1.0), ...crate(-2.8, 2.3, 0.06, 0.8), ...shelf(3.4, -2.5, 0.06, -Math.PI / 2, 2.4));
    return parts;
  },
}, {
  target: [8, 10, 5],
  route: [{ p: [0, 0, -7], note: 'před vraty' }, { p: [0, 0.06, -2], note: 'uvnitř' }, { p: [2.8, 0.06, 2.5] }, { p: [4.8, 0, 2.5], note: 'boční dveře ven' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'vraty volno', -8, 0), thru(3.0, 1.5, true, 'plechová stěna zastaví střelu (kolize)', -8, -3)],
  notes: ['Vlnitý plech řešen materiálem, stěny 0,1 m s kolizí. Rám: sloupy po 5 m.'],
});

regE(107, 'warehouseLarge', 'Velký sklad', {
  describe: () => '14 × 20 × 7 m, dva vstupy 5 × 5 m (čelo a záda), dvě řady ocelových sloupů, regály u stěn, volná středová cesta 5 m',
  generate(_p, seed) {
    const W = 14, D = 20;
    const parts = shed(W, D, 6.0, 7.0, { gates: [{ side: 'front', x0: -2.5, x1: 2.5, h: 5 }, { side: 'back', x0: -2.5, x1: 2.5, h: 5 }], sideDoor: -5.75, seed });
    for (const x of [-3.5, 3.5]) for (const z of [-5, 0, 5]) parts.push(bx(x - 0.15, x + 0.15, 0, 6.0, z - 0.15, z + 0.15, STEEL));
    for (const sx of [-1, 1]) for (const z of [-8.2, -3.3, 1.6, 6.5]) {
      const x = sx * (W / 2 - 0.7);
      parts.push(bx(x - 0.5, x + 0.5, 0.06, 2.6, z - 1.6, z + 1.6, 'wood'));
      // Zboží nahoře na regálu jen jako vzhled (nedosažitelné, šetří kolize).
      parts.push(...[...crate(x, z - 0.8, 2.6, 0.7), ...crate(x, z + 0.8, 2.6, 0.6)].map((p) => ({ ...p, collide: false })));
    }
    parts.push(...crate(-1.5, 8.5, 0.06, 1.0), ...crate(5.0, -8.0, 0.06, 1.2));
    return parts;
  },
}, {
  target: [14, 20, 7],
  route: [{ p: [0, 0, -12], note: 'čelní vstup' }, { p: [0, 0.06, 0], note: 'středová cesta' }, { p: [0, 0, 12], note: 'zadní vstup' }, { p: [0, 0.06, 0] }, { p: [5.0, 0.06, -5.75] }, { p: [7.6, 0, -5.75], note: 'boční dveře' }],
  walkableRoof: false,
  rays: [{ from: [0, 1.5, -12], to: [0, 1.5, 12], hit: false, note: 'středová cesta průstřelná skrz' }, { from: [-8, 1.3, -3], to: [-5.5, 1.3, -3], hit: true, note: 'regál u stěny kryje' }],
  notes: ['Sloupy v x = ±3,5 m – mezi nimi 6,7 m volné cesty od čela k zádům.'],
});

regE(108, 'shedDamaged', 'Poškozený sklad', {
  describe: () => 'malý sklad 8 × 10 m s odtrženým bočním opláštěním (z −1…3,5 m nad 1,2 m) a utrženým rohem střechy',
  generate(_p, seed) {
    return shed(8, 10, 4.2, 5.0, { gates: [{ side: 'front', x0: -2, x1: 2, h: 4 }], sideDoor: 2.5, damaged: true, seed });
  },
}, {
  target: [8, 10, 5],
  route: [{ p: [0, 0, -7], note: 'před vraty' }, { p: [0, 0.06, 0], note: 'uvnitř' }, { p: [-2.6, 0.06, 1.2] }, { p: [4.8, 0, 2.5], note: 'boční dveře' }],
  walkableRoof: false,
  rays: [{ from: [-7, 2.5, 1.2], to: [0, 2.5, 1.2], hit: false, note: 'odtrženým bokem lze střílet dovnitř' }, { from: [-7, 0.6, 1.2], to: [0, 0.6, 1.2], hit: true, note: 'spodní pás plechu zůstal' }],
  notes: ['Odkrytý rám (paždíky, krokve) jen v poškozené části; visící plechy jsou vzhled.'],
});

// ---------------------------------------------------------------------------
// E109–E110 Obloukové hangáry
// ---------------------------------------------------------------------------
function hangar(a: number, b: number, D: number, n: number, o: { front: [number, number, number][] | null; back: [number, number, number][]; sideDoor?: { side: number; z: number } ; ribs: number; seed: number; covers?: boolean }): Part[] {
  const z0 = -D / 2, z1 = D / 2;
  const parts: Part[] = [bx(-a + 0.2, a - 0.2, 0, 0.06, z0, z1, 'concreteDark')];
  parts.push(...archShell(a, b, z0, z1, n, SHEET, o.sideDoor ? { side: o.sideDoor.side, z0: o.sideDoor.z - 0.6, z1: o.sideDoor.z + 0.6 } : undefined));
  if (o.front) parts.push(...archEnd(a - 0.1, b - 0.1, z0 + 0.1, 1, o.front, SHEET));
  parts.push(...archEnd(a - 0.1, b - 0.1, z1 - 0.1, 1, o.back, SHEET));
  // Vnitřní žebra v hrubém rytmu (vzhled).
  for (let k = 1; k < o.ribs; k++) {
    const z = z0 + (k * D) / o.ribs;
    for (let i = 0; i < n; i++) {
      const t0 = (Math.PI * i) / n, t1 = (Math.PI * (i + 1)) / n, f = 0.94;
      parts.push(beam([a * f * Math.cos(t0), b * f * Math.sin(t0), z], [a * f * Math.cos(t1), b * f * Math.sin(t1), z], 0.18, STEEL));
    }
  }
  if (o.covers) {
    // Vnitřní kryty (neuzavírají prostor): bedny, kontejnerová stěna, zábrany.
    parts.push(bx(-a + 1.5, -a + 4.0, 0.06, 2.6, -2, 4, 'containerGreen'));
    parts.push(...crate(4, -4, 0.06, 1.2), ...crate(5.2, -4, 0.06, 1.0), ...crate(4.6, -4, 1.26, 0.9));
    parts.push(bx(2, 6, 0.06, 1.1, 6, 6.6, CONC), bx(-8, -4, 0.06, 1.1, -9, -8.4, CONC));
  }
  return parts;
}

regE(109, 'hangarSmall', 'Malý obloukový hangár', {
  describe: () => '12 × 18 × 7 m, oblouková skořepina (10 segmentů), plně otevřené čelo, zadní stěna s pěšími dveřmi, žebra po 4,5 m',
  generate(_p, seed) {
    return hangar(6, 7, 18, 10, { front: null, back: [[2.0, 3.0, 2.2]], ribs: 4, seed });
  },
}, {
  target: [12, 18, 7],
  route: [{ p: [0, 0, -11], note: 'otevřené čelo' }, { p: [0, 0.06, 0], note: 'uvnitř' }, { p: [2.5, 0.06, 7.5] }, { p: [2.5, 0, 10.5], note: 'zadní dveře' }],
  walkableRoof: false,
  rays: [{ from: [-8, 1.5, 0], to: [0, 1.5, 0], hit: true, note: 'skořepina kryje' }, { from: [0, 3, -12], to: [0, 3, 5], hit: false, note: 'čelo otevřené' }],
  notes: ['Kolize skořepiny = 10 natočených desek (stejný tvar jako vzhled); čelní stěna chybí záměrně (plně otevřené čelo).'],
});

regE(110, 'hangarLarge', 'Velký obloukový hangár', {
  describe: () => '20 × 30 × 10 m, čelo s vjezdem 12 × 7 m, boční servisní dveře ve skořepině, zadní dveře, vnitřní kryty',
  generate(_p, seed) {
    return hangar(10, 10, 30, 12, { front: [[-6, 6, 7]], back: [[-1.5, -0.3, 2.2]], sideDoor: { side: 1, z: 6 }, ribs: 6, seed, covers: true });
  },
}, {
  target: [20, 30, 10],
  route: [{ p: [0, 0, -17], note: 'vjezd' }, { p: [0, 0.06, 0], note: 'hala' }, { p: [8.6, 0.06, 6], note: 'k bočním dveřím' }, { p: [11.0, 0, 6], note: 'boční servisní dveře' }, { p: [8.6, 0.06, 6] }, { p: [-0.9, 0.06, 13] }, { p: [-0.9, 0, 16.2], note: 'zadní dveře' }],
  walkableRoof: false,
  rays: [{ from: [-12, 1.2, -4], to: [0, 1.2, -4], hit: true, note: 'skořepina kryje' }, { from: [0, 3, -17], to: [0, 3, 0], hit: false, note: 'vjezd volný' }],
  notes: ['Dveře 1,2 × 2,5 m vynechané v nejnižším segmentu skořepiny; vnitřní kryty (kontejner, bedny, betonové zábrany) prostor nedělí.'],
});

// ---------------------------------------------------------------------------
// E111–E115 Silo, vodojem, nádrže
// ---------------------------------------------------------------------------
regE(111, 'silo', 'Válcové silo', {
  describe: () => 'Ø 4 × 10 m, kuželová střecha Ø 2 m do 11,6 m, vnější žebřík, horní obvodová plošina 1 m se zábradlím',
  ladders: () => [ladderDef(2.08, 0, 0, 10, 'x-')],
  generate() {
    const parts: Part[] = [cyl(0, 0, 10, 0, 4, SHEET), cyl(0, 0, 0.3, 0, 4.3, CONC)];
    for (const y of [2.5, 5, 7.5]) parts.push(cyl(0, y - 0.05, y + 0.05, 0, 4.06, STEEL, false));
    // Kužel ze 6 prstenců (každý 0,27 m – dá se po nich vyjít k plošině).
    // Kuželová střecha (Ø 2 m, 6 prstenců) uprostřed, kolem obvodová plošina 1 m se zábradlím.
    for (let i = 0; i < 6; i++) parts.push(cyl(0, 10 + i * 0.27, 10 + (i + 1) * 0.27, 0, 2.0 - i * 0.3, i % 2 ? SHEET : STEEL));
    parts.push(cyl(0, 10, 10.04, 0, 4.0, 'metal', false));
    for (let k = 1; k < 8; k++) {
      const a0 = ((k - 0.5) * Math.PI) / 4, a1 = ((k + 0.5) * Math.PI) / 4, R = 1.95;
      parts.push(...railLine([R * Math.cos(a0), R * Math.sin(a0)], [R * Math.cos(a1), R * Math.sin(a1)], 10));
    }
    parts.push(...ladder(2.08, 0, 0, 10, 'x-').parts);
    return parts;
  },
}, {
  target: [4, 4, 11.7],
  route: [{ p: [3.0, 0, 0], note: 'u žebříku' }, { p: [1.45, 10, 0], ladder: true, note: 'horní plošina' }, { p: [1.0, 10, 1.0] }, { p: [0, 10, 1.4], note: 'kolem kužele' }],
  walkableRoof: true,
  rays: [{ from: [-5, 4, 0], to: [0, 4, 0], hit: true, note: 'silo kryje' }],
  notes: ['Plošina = obvodový ochoz 1 m kolem kužele, zábradlí po obvodu kromě výstupu žebříku.'],
});

regE(112, 'waterTower', 'Vodojem na ocelových nohách', {
  describe: () => 'nádrž Ø 5 × 4 m ve 10 m (celkem 14,6 m), 4 nohy, diagonální výztuhy, obvodová lávka a žebřík',
  ladders: () => [ladderDef(3.45, 0, 0, 10, 'x-')],
  generate() {
    const parts: Part[] = [];
    const L = 2.1, top = 10;
    for (const x of [-L, L]) for (const z of [-L, L]) {
      parts.push(bx(x - 0.15, x + 0.15, 0, top, z - 0.15, z + 0.15, STEEL), bx(x - 0.4, x + 0.4, 0, 0.4, z - 0.4, z + 0.4, CONC));
    }
    // Diagonální výztuhy ve dvou patrech na všech čtyřech stranách (vzhled).
    for (const [y0, y1] of [[0.5, 5], [5, 9.6]]) for (const s of [-1, 1]) {
      parts.push(beam([-L, y0, s * L], [L, y1, s * L], 0.08, STEEL), beam([L, y0, s * L], [-L, y1, s * L], 0.08, STEEL));
      parts.push(beam([s * L, y0, -L], [s * L, y1, L], 0.08, STEEL), beam([s * L, y0, L], [s * L, y1, -L], 0.08, STEEL));
    }
    for (const y of [5]) for (const s of [-1, 1]) parts.push(bx(-L, L, y - 0.06, y + 0.06, s * L - 0.06, s * L + 0.06, STEEL, false), bx(s * L - 0.06, s * L + 0.06, y - 0.06, y + 0.06, -L, L, STEEL, false));
    // Lávka 6,8 × 6,8 m kolem nádrže (díra pod nádrží), zábradlí.
    const o = 3.4;
    parts.push(bx(-o, o, top - 0.15, top, -o, -2.5, STEEL), bx(-o, o, top - 0.15, top, 2.5, o, STEEL), bx(-o, -2.5, top - 0.15, top, -2.5, 2.5, STEEL), bx(2.5, o, top - 0.15, top, -2.5, 2.5, STEEL));
    parts.push(bx(-2.5, 2.5, top - 0.3, top, -0.15, 0.15, STEEL), bx(-0.15, 0.15, top - 0.3, top, -2.5, 2.5, STEEL));
    parts.push(...rail([-o, -o], [o, -o], top), ...rail([o, o], [-o, o], top), ...rail([-o, -o], [-o, o], top), ...rail([o, -o], [o, -0.4], top), ...rail([o, 0.4], [o, o], top));
    parts.push(cyl(0, top, top + 4, 0, 5, 'paintedMetalBlue'), cyl(0, top + 4, top + 4.4, 0, 4.2, 'paintedMetalBlue'), cyl(0, top + 4.4, top + 4.6, 0, 2.4, 'paintedMetalBlue'));
    parts.push(pipe([0, 0.4, 0], [0, top, 0], 0.35, STEEL));
    parts.push(...ladder(3.45, 0, 0, top, 'x-').parts);
    return parts;
  },
}, {
  target: [6.8, 6.8, 14.6],
  route: [{ p: [4.3, 0, 0], note: 'pod žebříkem' }, { p: [2.9, 10, 0], ladder: true, note: 'lávka' }, { p: [2.9, 10, -2.9] }, { p: [-2.9, 10, -2.9], note: 'kolem nádrže' }],
  walkableRoof: true,
  rays: [{ from: [-6, 12, 0], to: [0, 12, 0], hit: true, note: 'nádrž kryje' }, { from: [-6, 3, 2.1], to: [6, 3, 2.1], hit: true, note: 'nosné nohy kryjí' }],
  notes: ['Výztuhy jsou vzhled (bez kolize), nohy, lávka a nádrž mají kolizi.'],
});

regE(113, 'tankLow', 'Nízká průmyslová nádrž', {
  describe: () => 'Ø 5 × 4 m, mírně kuželový vršek, servisní poklop, žebřík na vršek, krátké výstupní potrubí s ventilem',
  ladders: () => [ladderDef(-2.58, 0, 0, 4.18, 'x+')],
  generate() {
    const parts: Part[] = [cyl(0, 0, 0.25, 0, 5.4, CONC), cyl(0, 0.25, 4, 0, 5, 'paintedMetal'), cyl(0, 4, 4.18, 0, 4.4, 'paintedMetal'), cyl(0, 4.18, 4.3, 0, 2.6, 'paintedMetal')];
    parts.push(bx(0.8, 1.5, 4.18, 4.42, -0.35, 0.35, STEEL), bx(0.75, 1.55, 4.42, 4.46, -0.4, 0.4, 'metal', false));
    parts.push(pipe([2.4, 0.8, 0], [3.6, 0.8, 0], 0.4, STEEL), cyl(3.4, 0.6, 1.25, 0, 0.6, 'paintedMetalRed'), cyl(3.4, 1.25, 1.35, 0, 0.5, 'metal', false), pipe([3.6, 0.8, 0], [3.6, 0.25, 0], 0.4, STEEL));
    parts.push(...ladder(-2.58, 0, 0, 4.18, 'x+').parts, ...rail([-2.2, -0.45], [-1.6, -0.45], 4.18), ...rail([-2.2, 0.45], [-1.6, 0.45], 4.18));
    return parts;
  },
}, {
  target: [5, 5, 4.3],
  route: [{ p: [-3.4, 0, 0], note: 'pod žebříkem' }, { p: [-1.85, 4.18, 0], ladder: true, note: 'vršek nádrže' }, { p: [0.4, 4.3, 0.9] }],
  walkableRoof: true,
  rays: [{ from: [0, 1.5, -5], to: [0, 1.5, 0], hit: true, note: 'nádrž kryje' }],
  notes: ['Vršek pochozí (dva nízké stupně), poklop jako vzhled s malou kolizí.'],
});

regE(114, 'fuelTanksVertical', 'Svislé palivové nádrže', {
  describe: () => '2 nádrže Ø 3 × 5 m na betonové ploše 9 × 4,5 m, průchod 2 m mezi nimi, hlavní potrubí ve 3,6 m nad průchodem',
  generate() {
    const parts: Part[] = [bx(-4.5, 4.5, 0, 0.2, -2.25, 2.25, CONC)];
    for (const x of [-2.5, 2.5]) {
      parts.push(cyl(x, 0.2, 5.2, 0, 3, 'plasterWhite'), cyl(x, 5.2, 5.45, 0, 2.6, 'plasterWhite'), cyl(x, 5.45, 5.6, 0, 1.2, 'plasterWhite'));
      parts.push(cyl(x, 0.2, 0.45, 0, 3.2, STEEL, false));
    }
    parts.push(pipe([-1.0, 3.6, 0], [1.0, 3.6, 0], 0.35, STEEL), pipe([-2.5, 3.6, 1.6], [2.5, 3.6, 1.6], 0.3, STEEL), pipe([-2.5, 3.6, 1.6], [-2.5, 0.6, 1.6], 0.3, STEEL));
    for (const x of [-0.9, 0.9]) parts.push(cyl(x, 3.6, 3.95, 0, 0.5, 'paintedMetalRed', false));
    parts.push(bx(-0.9, 0.9, 0.2, 0.35, -0.3, 0.3, 'concreteDark', false));
    return parts;
  },
}, {
  target: [9, 4.5, 5.6],
  route: [{ p: [0, 0, -3.5], note: 'před plochou' }, { p: [0, 0.2, 0], note: 'průchod mezi nádržemi' }, { p: [0, 0, 3.5], note: 'za nádržemi' }],
  walkableRoof: false,
  rays: [{ from: [-6, 1.5, 0], to: [0, 1.5, 0], hit: true, note: 'nádrž kryje' }, { from: [0, 1.5, -4], to: [0, 1.5, 4], hit: false, note: 'průchod volný' }],
  notes: ['Potrubí ve 3,6 m – průchod mezi nádržemi bez snížené výšky.'],
});

regE(115, 'fuelTanksHorizontal', 'Vodorovné palivové nádrže', {
  describe: () => '2 válcové nádrže Ø 2,4 × 5 m na sedlových podpěrách, střídmě zaoblená čela, velké ventily',
  generate() {
    const parts: Part[] = [];
    for (const z of [-1.9, 1.9]) {
      parts.push(pipe([-2.25, 1.6, z], [2.25, 1.6, z], 2.4, 'plasterWhite'));
      for (const s of [-1, 1]) parts.push(pipe([s * 2.25, 1.6, z], [s * 2.5, 1.6, z], 2.0, 'plasterWhite'), pipe([s * 2.5, 1.6, z], [s * 2.62, 1.6, z], 1.2, 'plasterWhite', false));
      for (const x of [-1.5, 1.5]) parts.push(bx(x - 0.2, x + 0.2, 0, 0.75, z - 0.9, z + 0.9, CONC), bx(x - 0.15, x + 0.15, 0.75, 1.0, z - 1.0, z + 1.0, STEEL, false));
      parts.push(cyl(0.6, 2.75, 3.15, z, 0.35, STEEL), cyl(0.6, 3.15, 3.22, z, 0.6, 'paintedMetalRed', false), cyl(-1.2, 2.75, 3.0, z, 0.5, STEEL, false));
    }
    return parts;
  },
}, {
  target: [5.2, 6.2, 3.2],
  route: [{ p: [-4, 0, 0], note: 'mezi nádržemi' }, { p: [4, 0, 0] }],
  walkableRoof: false,
  rays: [{ from: [0, 1.6, -4], to: [0, 1.6, 0], hit: true, note: 'nádrž kryje' }, { from: [0, 0.25, -4], to: [0, 0.25, 0], hit: false, note: 'pod nádrží mezi podpěrami volno' }],
  notes: ['Mezi nádržemi 1,4 m průchod; pod nádržemi se dá střílet mezi podpěrami.'],
});

// ---------------------------------------------------------------------------
// E116–E118 Potrubní mosty a jeřáb
// ---------------------------------------------------------------------------
regE(116, 'pipeBridgeLow', 'Nízký potrubní most', {
  describe: () => 'délka 8 m (podél X), průchozí výška 3 m, 2 ocelové rámy, 3 trubky Ø 0,5 / 0,4 / 0,3 m',
  generate() {
    const parts: Part[] = [];
    for (const x of [-3, 3]) {
      for (const z of [-1, 1]) parts.push(bx(x - 0.15, x + 0.15, 0, 3.4, z - 0.15, z + 0.15, STEEL), bx(x - 0.3, x + 0.3, 0, 0.3, z - 0.3, z + 0.3, CONC));
      parts.push(bx(x - 0.15, x + 0.15, 3.0, 3.35, -1.15, 1.15, STEEL));
    }
    for (const [z, d] of [[-0.6, 0.5], [0.05, 0.4], [0.6, 0.3]] as const) parts.push(pipe([-4, 3.35 + d / 2, z], [4, 3.35 + d / 2, z], d, z < 0 ? STEEL : 'metal'));
    return parts;
  },
}, {
  target: [8, 2.6, 3.9],
  route: [{ p: [0, 0, -3], note: 'před mostem' }, { p: [0, 0, 3], note: 'pod mostem (3 m)' }, { p: [-4.5, 0, 3] }, { p: [-4.5, 0, -3] }],
  walkableRoof: false,
  rays: [{ from: [0, 2.8, -3], to: [0, 2.8, 3], hit: false, note: 'pod trubkami volno do 3 m' }],
  notes: ['Příruby vynechány; trubky mají kolizi (lze po nich ve hře teoreticky chodit – ne zamýšleno).'],
});

regE(117, 'pipeBridgeHigh', 'Vysoký potrubní most', {
  describe: () => 'délka 12 m, světlá výška 5 m, 3 rámy, 4 trubky, servisní lávka 0,9 m v 6,4 m se zábradlím, žebřík',
  ladders: () => [ladderDef(-5.55, -2.85, 0, 6.4, 'z+')],
  generate() {
    const parts: Part[] = [];
    for (const x of [-5.5, 0, 5.5]) {
      for (const z of [-1.4, 1.4]) parts.push(bx(x - 0.18, x + 0.18, 0, 6.4, z - 0.18, z + 0.18, STEEL), bx(x - 0.35, x + 0.35, 0, 0.35, z - 0.35, z + 0.35, CONC));
      parts.push(bx(x - 0.18, x + 0.18, 5.0, 5.4, -1.55, 1.55, STEEL), beam([x, 0.5, -1.4], [x, 4.9, 1.4], 0.1, STEEL));
    }
    for (const [z, d] of [[-0.9, 0.6], [-0.15, 0.5], [0.5, 0.4], [1.05, 0.3]] as const) parts.push(pipe([-6, 5.4 + d / 2, z], [6, 5.4 + d / 2, z], d, STEEL));
    // Lávka vně rámů podél −Z strany (konzoly ze sloupů), zábradlí; výstup ze žebříku na −X konci.
    parts.push(bx(-6, 6, 6.3, 6.4, -2.6, -1.7, 'metal'));
    for (const x of [-5.5, 0, 5.5]) parts.push(bx(x - 0.08, x + 0.08, 6.15, 6.3, -2.6, -1.4, STEEL, false));
    parts.push(...rail([-5.15, -2.6], [6, -2.6], 6.4), ...rail([6, -2.6], [6, -1.7], 6.4), ...rail([-6, -1.7], [6, -1.7], 6.4), ...rail([-6, -2.6], [-6, -1.7], 6.4));
    parts.push(...ladder(-5.55, -2.85, 0, 6.4, 'z+').parts);
    return parts;
  },
}, {
  target: [12, 3.8, 7.4],
  route: [{ p: [0, 0, -3.5], note: 'před mostem' }, { p: [2.7, 0, 3.5], note: 'pod mostem (5 m)' }, { p: [-5.55, 0, -3.6], note: 'pod žebříkem' }, { p: [-5.2, 6.4, -2.15], ladder: true, note: 'servisní lávka' }, { p: [4.5, 6.4, -2.15] }],
  walkableRoof: true,
  rays: [{ from: [2.7, 4.5, -4], to: [2.7, 4.5, 4], hit: false, note: 'světlá výška 5 m' }, { from: [2.7, 6.9, -4], to: [2.7, 6.9, -1.9], hit: false, note: 'lávka – zábradlí střelu propustí' }],
  notes: ['Lávka 0,9 m široká vně rámů (sloupy ji nezužují); žebřík u −X konce mezerou v zábradlí; zábradlí kovové (jen pohybová kolize).'],
});

regE(118, 'gantryCrane', 'Portálový jeřáb', {
  describe: () => 'rozpětí 12 m, výška 10 m, dvě boční podpěry (A-rám), horní nosník, statický zavěšený hák (bez simulace lana)',
  generate() {
    const parts: Part[] = [];
    for (const x of [-6, 6]) {
      parts.push(beam([x, 0, -2.2], [x, 9.0, -0.4], 0.35, 'paintedMetalRed', true), beam([x, 0, 2.2], [x, 9.0, 0.4], 0.35, 'paintedMetalRed', true));
      parts.push(bx(x - 0.4, x + 0.4, 0, 0.6, -2.8, 2.8, 'paintedMetalRed'), beam([x, 3.5, -1.5], [x, 3.5, 1.5], 0.2, 'paintedMetalRed'));
      for (const z of [-2.4, 2.4]) parts.push(cyl(x, 0, 0.5, z, 0.5, 'gunMetal', false));
    }
    parts.push(bx(-6.6, 6.6, 9.0, 10.0, -0.7, 0.7, 'paintedMetalRed'));
    parts.push(bx(-1.2, 1.2, 8.4, 9.0, -0.9, 0.9, 'paintedMetal'));
    for (const s of [-0.25, 0.25]) parts.push(cyl(0, 5.2, 8.4, s, 0.05, 'metal', false));
    parts.push(bx(-0.35, 0.35, 4.6, 5.2, -0.45, 0.45, 'paintedMetal'), { shape: 'box', pos: [0, 4.3, 0], rot: [0, 0, 0.3], size: [0.15, 0.5, 0.15], material: 'gunMetal' });
    for (const z of [-2.4, 2.4]) parts.push(bx(-9, 9, 0, 0.08, z - 0.1, z + 0.1, 'metal', false));
    return parts;
  },
}, {
  target: [13.2, 5.6, 10],
  route: [{ p: [-3, 0, -4], note: 'před jeřábem' }, { p: [-3, 0, 4], note: 'pod jeřábem' }, { p: [3, 0, 4] }, { p: [3, 0, -4] }],
  walkableRoof: false,
  rays: [{ from: [-8, 1.2, -1.8], to: [-4, 1.2, -1.8], hit: true, note: 'noha podpěry kryje' }],
  notes: ['Hák a kladnice jsou statické (bez lana a pohybu), kolizi mají jen nohy, patky a nosník.'],
});

// ---------------------------------------------------------------------------
// E119–E121 Kontrolní stanoviště
// ---------------------------------------------------------------------------
/** Budka 2 × 2 × 2,6 m (dveře vzadu, okna), volitelně bez rohu. */
function booth(cx: number, cz: number, mat: string, broken = false): Part[] {
  const parts: Part[] = [];
  const x0 = cx - 1, x1 = cx + 1, z0 = cz - 1, z1 = cz + 1, h = 2.5, w = 0.12;
  parts.push(bx(x0, x1, 0, 0.08, z0, z1, CONC));
  // Čelo (k silnici −X) s oknem, zadní stěna s dveřmi, boky s okny.
  const winBand = (a: number, b: number, z: number) => [bx(a, b, 0, 1.0, z - w / 2, z + w / 2, mat), bx(a, b, 2.0, h, z - w / 2, z + w / 2, mat)];
  parts.push(...winBand(x0, x1, z0 + w / 2));
  if (!broken) parts.push(bx(x0, x0 + 0.35, 0, h, z1 - w, z1, mat), bx(x0 + 1.45, x1, 0, h, z1 - w, z1, mat), bx(x0 + 0.35, x0 + 1.45, 2.2, h, z1 - w, z1, mat));
  else parts.push(bx(x0, x0 + 0.35, 0, h, z1 - w, z1, mat), bx(x0 + 0.35, x0 + 1.45, 2.2, h, z1 - w, z1, mat), bx(x0 + 1.45, x1 - 0.5, 0, 1.2, z1 - w, z1, mat));
  parts.push(bx(x0, x0 + w, 0, 1.0, z0, z1, mat), bx(x0, x0 + w, 2.0, h, z0, z1, mat));
  if (!broken) parts.push(bx(x1 - w, x1, 0, 1.0, z0, z1, mat), bx(x1 - w, x1, 2.0, h, z0, z1, mat), bx(x0 - 0.2, x1 + 0.2, h, h + 0.15, z0 - 0.2, z1 + 0.2, SHEET));
  else {
    // Chybějící roh (+X, +Z): bok jen do půlky, střecha jen nad zbytkem.
    parts.push(bx(x1 - w, x1, 0, 1.0, z0, cz, mat), bx(x1 - w, x1, 2.0, h - 0.4, z0, cz - 0.3, mat));
    parts.push(bx(x0 - 0.2, cx + 0.3, h, h + 0.15, z0 - 0.2, z1 + 0.2, SHEET), { shape: 'box', pos: [cx + 0.9, h - 0.5, cz + 0.2], rot: [0.2, 0, 0.6], size: [1.2, 0.05, 1.6], material: RUST });
  }
  for (const z of [z0 + w / 2]) parts.push(bx(x0 + 0.05, x1 - 0.05, 1.0, 1.04, z - 0.15, z + 0.15, 'woodDark', false));
  return parts;
}
/** Závora: sloupek + rameno (zvednuté / položené). */
function barrier(x: number, z: number, raised: boolean, broken = false): Part[] {
  const parts: Part[] = [bx(x - 0.2, x + 0.2, 0, 1.1, z - 0.2, z + 0.2, 'paintedMetalRed'), bx(x - 0.12, x + 0.12, 0.9, 1.2, z - 0.12, z + 0.12, 'paintedMetal', false)];
  if (raised) parts.push({ shape: 'box', pos: [x, 1.1 + 2.0, z - 0.25], rot: [0, 0, 0], size: [0.1, 4.0, 0.1], material: 'paintedMetalRed' });
  else if (broken) {
    parts.push({ shape: 'box', pos: [x + 0.9, 0.05, z + 1.1], rot: [0, 0.4, Math.PI / 2], size: [0.1, 2.4, 0.1], material: 'paintedMetalRed' }, { shape: 'box', pos: [x + 0.6, 0.05, z + 2.6], rot: [0, -0.3, Math.PI / 2], size: [0.1, 1.4, 0.1], material: 'paintedMetal' });
    parts.push({ shape: 'box', pos: [x, 1.2, z - 0.25], rot: [0.5, 0, 0], size: [0.1, 0.6, 0.1], material: 'paintedMetalRed' });
  }
  return parts;
}
/** Betonový svodidlový blok (jersey) 2 × 0,6 × 0,85 m podél Z; `broken` = ulomený konec. */
function jersey(x: number, z: number, broken = false): Part[] {
  const parts: Part[] = [bx(x - 0.3, x + 0.3, 0, 0.3, z - 1, broken ? z + 0.3 : z + 1, CONC), bx(x - 0.15, x + 0.15, 0.3, 0.85, z - 1, broken ? z + 0.1 : z + 1, CONC)];
  if (broken) parts.push({ shape: 'box', pos: [x + 0.5, 0.25, z + 0.9], rot: [0.4, 0.7, 0.3], size: [0.4, 0.5, 0.7], material: CONC, collide: true }, ...rubble(x + 0.3, z + 0.6, 4, [0.6, 0.5], 7, 0.3));
  return parts;
}

regE(119, 'checkpoint', 'Kontrolní stanoviště s budkou', {
  describe: () => 'sestava 8 × 5 m: přístupná budka 2 × 2 m, zdvižená závora u průjezdu (4 m), dva betonové bloky mimo průjezd',
  generate(_p, _s, mat) {
    return [...booth(3.0, 0.5, mat), ...barrier(1.3, -1.6, true), ...jersey(-3.4, -1.0), ...jersey(-3.4, 1.4), bx(-2.5, 2.5, 0, 0.02, -2.5, 2.5, 'asphalt', false)];
  },
}, {
  target: [8, 5, 5.1],
  route: [{ p: [0, 0, -4], note: 'průjezd' }, { p: [0, 0, 4] }, { p: [2.9, 0, 2.3], note: 'za budkou' }, { p: [2.9, 0.08, 0.6], note: 'v budce (dveře vzadu)' }],
  walkableRoof: false,
  rays: [{ from: [-6, 0.5, -1.0], to: [-3, 0.5, -1.0], hit: true, note: 'betonový blok kryje' }, { from: [0, 1.5, -4], to: [0, 1.5, 4], hit: false, note: 'průjezd volný (závora zvednutá)' }],
  notes: ['Průjezd x −2,5…2,5 m bez překážek; bloky a budka stojí mimo něj.'],
});

regE(120, 'sandbagPost', 'Stanoviště s pytli a přístřeškem', {
  describe: () => 'prostor 5 × 4 m, lehká plechová střecha na 4 sloupcích (2,4 m), hradba pytlů 1,1 m, boční pěší průchod 1,0 m',
  generate(_p, seed) {
    const parts: Part[] = [];
    // Hradba: čelo, levý bok, zadní strana; pravý bok s průchodem 1,0 m vzadu.
    parts.push(...sandbags(-2.5, 2.5, -2.0, -1.5, 1.1, seed), ...sandbags(2.0, 2.5, -1.5, 2.0, 1.1, seed + 1), ...sandbags(-2.5, 2.5, 1.5, 2.0, 1.1, seed + 2));
    parts.push(...sandbags(-2.5, -2.0, -1.5, 0.5, 1.1, seed + 3));
    for (const [x, z] of [[-2.2, -1.25], [1.75, -1.25], [-2.2, 1.25], [1.75, 1.25]] as const) parts.push(bx(x - 0.06, x + 0.06, 0, 2.4, z - 0.06, z + 0.06, 'wood'));
    parts.push({ shape: 'box', pos: [-0.2, 2.45, 0], rot: [0.06, 0, 0], size: [5.0, 0.04, 3.4], material: RUST });
    parts.push(...crate(0.6, 0.8, 0, 0.6), bx(-1.2, -0.2, 0, 0.45, 0.6, 1.1, 'woodDark'));
    return parts;
  },
}, {
  target: [5, 4, 2.5],
  route: [{ p: [-3.4, 0, 1.0], note: 'bok' }, { p: [-2.25, 0, 1.0], note: 'pěší průchod' }, { p: [0, 0, -0.6], note: 'uvnitř za pytli' }],
  walkableRoof: false,
  rays: [{ from: [0, 0.8, -4], to: [0, 0.8, 0], hit: true, note: 'pytle kryjí vkleče' }, { from: [0, 1.6, -4], to: [0, 1.6, 0], hit: false, note: 'nad pytli palebné pole' }],
  notes: ['Pytle: vzhled z mírně natočených pytlů ve vazbě, kolize jeden kvádr na úsek. Střecha je plech bez kolize.'],
});

regE(121, 'checkpointDamaged', 'Poškozené kontrolní stanoviště', {
  describe: () => 'budka s chybějícím rohem, ulomená závora položená vedle cesty, částečně rozpadlý betonový blok',
  generate(_p, _s, mat) {
    return [...booth(3.0, 0.5, mat, true), ...barrier(1.3, -1.6, false, true), ...jersey(-3.4, -1.0, true), ...jersey(-3.4, 1.4), bx(-2.5, 2.5, 0, 0.02, -2.5, 2.5, 'asphalt', false)];
  },
}, {
  target: [8, 5, 2.7],
  route: [{ p: [0, 0, -4], note: 'průjezd' }, { p: [0, 0, 4] }, { p: [2.9, 0, 2.3] }, { p: [2.9, 0.08, 0.6], note: 'v budce' }],
  walkableRoof: false,
  rays: [{ from: [0, 1.5, -4], to: [0, 1.5, 4], hit: false, note: 'průjezd volný (rameno závory leží u kraje)' }, { from: [6, 1.5, 1.2], to: [3, 1.5, 1.2], hit: false, note: 'chybějícím rohem lze do budky střílet' }],
  notes: ['Ulomené rameno leží u kraje cesty (x ≈ 2,2), bez kolize.'],
});

// ---------------------------------------------------------------------------
// E122–E124 Strážní věže
// ---------------------------------------------------------------------------
function woodTower(o: { broken: boolean }): Part[] {
  const P = 1.4, y = 5, parts: Part[] = [];
  for (const x of [-P, P]) for (const z of [-P, P]) parts.push(bx(x - 0.1, x + 0.1, 0, o.broken && x > 0 && z > 0 ? y + 1.0 : y + 2.2, z - 0.1, z + 0.1, 'wood'), bx(x - 0.25, x + 0.25, 0, 0.3, z - 0.25, z + 0.25, CONC));
  for (const [a, b] of [[[-P, 0.5, -P], [P, 4.6, -P]], [[P, 0.5, -P], [-P, 4.6, -P]], [[-P, 0.5, P], [P, 4.6, P]], [[P, 0.5, P], [-P, 4.6, P]], [[-P, 0.5, -P], [-P, 4.6, P]], [[P, 0.5, P], [P, 4.6, -P]]] as [V3, V3][]) parts.push(beam(a, b, 0.09, 'woodDark'));
  // Plošina 3 × 3 m, prkenné zábradlí 1,0 m (plné do 0,9 – kryt), výstup žebříkem na −Z.
  parts.push(bx(-1.5, 1.5, y - 0.15, y, -1.5, 1.5, 'wood'));
  const railWall = (x0: number, x1: number, z0: number, z1: number) => parts.push(bx(x0, x1, y, y + 1.0, z0, z1, 'wood'), bx(x0 - 0.02, x1 + 0.02, y + 1.0, y + 1.06, z0 - 0.02, z1 + 0.02, 'woodDark', false));
  railWall(-1.5, -0.4, -1.5, -1.42); railWall(0.4, 1.5, -1.5, -1.42);
  railWall(-1.5, -1.42, -1.42, 1.5);
  if (!o.broken) { railWall(-1.42, 1.5, 1.42, 1.5); railWall(1.42, 1.5, -1.42, 1.42); }
  else { railWall(-1.42, 0.2, 1.42, 1.5); railWall(1.42, 1.5, -1.42, -0.2); parts.push({ shape: 'box', pos: [1.9, 0.08, 2.2], rot: [0, 0.5, 0], size: [1.4, 0.08, 0.6], material: 'wood' }); }
  // Střecha ve 7,2 m (u poškozené jen polovina, kus visí).
  if (!o.broken) parts.push({ shape: 'box', pos: [0, y + 2.25, 0], rot: [0.08, 0, 0], size: [3.6, 0.06, 3.6], material: RUST });
  else parts.push({ shape: 'box', pos: [-0.9, y + 2.25, 0], rot: [0.08, 0, 0], size: [1.8, 0.06, 3.6], material: RUST }, { shape: 'box', pos: [0.6, y + 1.6, 0.6], rot: [0.2, 0.1, 0.9], size: [1.6, 0.05, 2.4], material: RUST });
  parts.push(...ladderParts(0, -1.55, 0, y, 'z+'));
  return parts;
}

regE(122, 'watchtowerWood', 'Dřevěná strážní věž', {
  describe: () => 'plošina 3 × 3 m v 5 m, 4 sloupy, diagonální výztuhy, žebřík, prkenné zábradlí 1 m, lehká střecha 7,2 m',
  ladders: () => [ladderDef(0, -1.55, 0, 5, 'z+')],
  generate() {
    return woodTower({ broken: false });
  },
}, {
  target: [3.6, 3.6, 7.3],
  route: [{ p: [0, 0, -2.4], note: 'pod žebříkem' }, { p: [0, 5, -0.6], ladder: true, note: 'plošina' }, { p: [0.8, 5, 0.8] }],
  walkableRoof: false,
  rays: [{ from: [3, 5.6, 0.5], to: [0, 5.6, 0.5], hit: true, note: 'zábradlí kryje vkleče' }, { from: [3, 6.5, 0.5], to: [0, 6.5, 0.5], hit: false, note: 'nad zábradlím výhled' }],
  notes: ['Výstup ze žebříku mezerou 0,8 m v čelním zábradlí.'],
});

regE(123, 'watchtowerConcrete', 'Betonová strážní věž', {
  describe: () => '3,5 × 3,5 m, výška 8 m: uzavřený dřík se dveřmi, vnitřní žebřík poklopem do kabiny v 5,5 m, parapet 1,1 m, široké otvory',
  ladders: () => [hatchTower().ladder],
  generate(_p, _s, mat) {
    const h = 5.5, A = 1.75, w = 0.3, parts: Part[] = [];
    // Dřík s dveřmi vpředu (−Z).
    parts.push(bx(-A, -0.55, 0, h, -A, -A + w, mat), bx(0.55, A, 0, h, -A, -A + w, mat), bx(-0.55, 0.55, 2.2, h, -A, -A + w, mat));
    parts.push(bx(-A, A, 0, h, A - w, A, mat), bx(-A, -A + w, 0, h, -A + w, A - w, mat), bx(A - w, A, 0, h, -A + w, A - w, mat));
    parts.push(bx(-A + w, A - w, 0, 0.06, -A + w, A - w, 'concreteDark'));
    // Podlaha kabiny s poklopem, kabina: parapet 1,1 m, nároží, střecha.
    const H: [number, number, number, number] = [-0.6, 0.3, 0.3, 1.2];
    parts.push(bx(-A, H[0], h - 0.25, h, -A, A, CONC), bx(H[2], A, h - 0.25, h, -A, A, CONC), bx(H[0], H[2], h - 0.25, h, -A, H[1], CONC), bx(H[0], H[2], h - 0.25, h, H[3], A, CONC));
    parts.push(...hatchTower().parts);
    for (const [x0, x1, z0, z1] of [[-A, A, -A, -A + 0.25], [-A, A, A - 0.25, A], [-A, -A + 0.25, -A + 0.25, A - 0.25], [A - 0.25, A, -A + 0.25, A - 0.25]] as const) parts.push(bx(x0, x1, h, h + 1.1, z0, z1, mat));
    for (const x of [-A, A - 0.4]) for (const z of [-A, A - 0.4]) parts.push(bx(x, x + 0.4, h + 1.1, 7.6, z, z + 0.4, mat));
    parts.push(bx(-A - 0.15, A + 0.15, 7.6, 8.0, -A - 0.15, A + 0.15, CONC));
    return parts;
  },
}, {
  target: [3.5, 3.5, 8],
  route: [{ p: [0, 0, -3.0], note: 'ulice' }, { p: [0, 0.06, -0.6], note: 'dřík' }, { p: [0.0, 0.06, 0.75], note: 'k žebříku' }, { p: [-1.1, 5.5, 0.75], ladder: true, note: 'kabina' }, { p: [0.8, 5.5, -0.9] }],
  walkableRoof: false,
  rays: [{ from: [0, 6.2, -4], to: [0, 6.2, 0], hit: true, note: 'parapet 1,1 m kryje' }, { from: [0, 7.0, -4], to: [0, 7.0, 0], hit: false, note: 'pozorovací otvor' }],
  notes: ['Kabina: parapet 1,1 m, otvory 1,4 m vysoké po celém obvodu mezi nárožními pilíři.'],
});
function hatchTower() {
  const lx = -0.6 + 0.06, lz = 0.75, h = 5.5;
  return { parts: ladderParts(lx, lz, 0.06, h - 0.06, 'x-'), ladder: ladderDef(lx, lz, 0.06, h - 0.06, 'x-') };
}

regE(124, 'watchtowerDamaged', 'Poškozená strážní věž', {
  describe: () => 'dřevěná věž 3 × 3 m v 5 m: chybí půlka střechy a část zábradlí (roh +X/+Z), sloupy a žebřík celé',
  ladders: () => [ladderDef(0, -1.55, 0, 5, 'z+')],
  generate() {
    return woodTower({ broken: true });
  },
}, {
  target: [3.6, 3.6, 7.3],
  route: [{ p: [0, 0, -2.4], note: 'pod žebříkem' }, { p: [0, 5, -0.6], ladder: true, note: 'plošina' }, { p: [-0.8, 5, 0.8] }],
  walkableRoof: false,
  rays: [{ from: [3, 5.6, 0.8], to: [0, 5.6, 0.8], hit: false, note: 'chybějící zábradlí – bez krytu' }, { from: [-3, 5.6, 0.5], to: [0, 5.6, 0.5], hit: true, note: 'zbylé zábradlí kryje' }],
  notes: ['Hlavní konstrukce stabilní; přístup žebříkem beze změny.'],
});

// ---------------------------------------------------------------------------
// E125–E127 Bunkry
// ---------------------------------------------------------------------------
regE(125, 'bunkerSmall', 'Malý bunkr', {
  describe: () => '5 × 4 × 2,8 m, stěny 0,6 m, přední střílna 1,6 × 0,3 m, zadní vstup 1,1 × 2,0 m kryt krátkou boční zdí',
  generate() {
    const W = 5, D = 4, h = 2.8, w = 0.6, parts: Part[] = [];
    const z0 = -D / 2, z1 = D / 2;
    // Čelo se střílnou ve výšce 1,2–1,5 m.
    parts.push(bx(-W / 2, W / 2, 0, 1.2, z0, z0 + w, CONC), bx(-W / 2, W / 2, 1.5, h - 0.5, z0, z0 + w, CONC), bx(-W / 2, -0.8, 1.2, 1.5, z0, z0 + w, CONC), bx(0.8, W / 2, 1.2, 1.5, z0, z0 + w, CONC));
    parts.push(bx(-W / 2, -W / 2 + w, 0, h - 0.5, z0 + w, z1, CONC), bx(W / 2 - w, W / 2, 0, h - 0.5, z0 + w, z1, CONC));
    parts.push(bx(-W / 2 + w, 0.6, 0, h - 0.5, z1 - w, z1, CONC), bx(1.7, W / 2 - w, 0, h - 0.5, z1 - w, z1, CONC), bx(0.6, 1.7, 2.0, h - 0.5, z1 - w, z1, CONC));
    parts.push(bx(-W / 2 - 0.1, W / 2 + 0.1, h - 0.5, h, z0 - 0.1, z1 + 0.1, CONC), bx(-W / 2 + w, W / 2 - w, 0, 0.05, z0 + w, z1 - w, 'concreteDark'));
    // Krátká boční (ochranná) zeď za vstupem.
    parts.push(bx(-0.4, 2.9, 0, 2.0, z1 + 1.1, z1 + 1.5, CONC));
    parts.push(...sandbags(-W / 2, W / 2, z0 - 0.5, z0, 0.6, 3));
    return parts;
  },
}, {
  target: [5, 5.5, 2.8],
  route: [{ p: [3.6, 0, 2.6], note: 'za ochrannou zdí' }, { p: [1.15, 0, 2.6] }, { p: [1.15, 0.05, 1.0], note: 'vstup' }, { p: [0, 0.05, -0.8], note: 'u střílny' }],
  walkableRoof: true,
  rays: [{ from: [0, 1.35, -5], to: [0, 1.35, 0], hit: false, note: 'střílna' }, { from: [1.4, 1.35, -5], to: [1.4, 1.35, 0], hit: true, note: 'čelo mimo střílnu' }, { from: [1.15, 1.2, 6], to: [1.15, 1.2, 0.5], hit: true, note: 'ochranná zeď kryje vstup zezadu' }],
  notes: ['Vstup je zezadu přístupný jen z boku kolem ochranné zdi (není průhled do vnitřku).'],
});

regE(126, 'bunkerWide', 'Široký bunkr', {
  describe: () => '8 × 5 × 3 m, dvě střílny, vnitřní přepážka s průchodem, zalomený vstup (bez průhledu skrz)',
  generate() {
    const W = 8, D = 5, h = 3.0, w = 0.6, parts: Part[] = [];
    const z0 = -D / 2, z1 = D / 2, top = h - 0.5;
    parts.push(bx(-W / 2, W / 2, 0, 1.2, z0, z0 + w, CONC), bx(-W / 2, W / 2, 1.5, top, z0, z0 + w, CONC));
    for (const [a, b] of [[-W / 2, -2.8], [-1.2, 1.2], [2.8, W / 2]] as const) parts.push(bx(a, b, 1.2, 1.5, z0, z0 + w, CONC));
    parts.push(bx(-W / 2, -W / 2 + w, 0, top, z0 + w, z1, CONC), bx(W / 2 - w, W / 2, 0, top, z0 + w, z1, CONC));
    // Zadní stěna s otvorem vpravo, za ním zalomená předsíň (vstup z boku).
    parts.push(bx(-W / 2 + w, 1.6, 0, top, z1 - w, z1, CONC), bx(2.8, W / 2 - w, 0, top, z1 - w, z1, CONC), bx(1.6, 2.8, 2.1, top, z1 - w, z1, CONC));
    parts.push(bx(0.8, 4.0, 0, top, z1 + 1.3, z1 + 1.7, CONC), bx(3.6, 4.0, 0, top, z1, z1 + 1.3, CONC), bx(0.8, 4.0, top, h, z1, z1 + 1.7, CONC));
    // Přepážka s průchodem 1,2 m (vnitřní dělení).
    parts.push(bx(-0.2, 0.2, 0, top, z0 + w, -0.2, CONC), bx(-0.2, 0.2, 0, top, 1.0, z1 - w, CONC), bx(-0.2, 0.2, 2.1, top, -0.2, 1.0, CONC));
    parts.push(bx(-W / 2 - 0.1, W / 2 + 0.1, top, h, z0 - 0.1, z1 + 0.1, CONC), bx(-W / 2 + w, W / 2 - w, 0, 0.05, z0 + w, z1 - w, 'concreteDark'));
    return parts;
  },
}, {
  target: [8, 6.7, 3],
  route: [{ p: [0.0, 0, 3.4], note: 'u předsíně' }, { p: [2.2, 0, 3.4], note: 'zalomený vstup' }, { p: [2.2, 0.05, 1.2] }, { p: [2.0, 0.05, -1.2], note: 'pravá střílna' }, { p: [0, 0.05, 0.4], note: 'průchod přepážkou' }, { p: [-2.0, 0.05, -1.2], note: 'levá střílna' }],
  walkableRoof: true,
  rays: [{ from: [-2.0, 1.35, -5], to: [-2.0, 1.35, 0], hit: false, note: 'levá střílna' }, { from: [2.2, 1.3, 7], to: [2.2, 1.3, -3], hit: true, note: 'zalomený vstup – žádný průhled skrz' }],
  notes: ['Předsíň za zadní stěnou otočí vstup o 90° (vchod z −X strany předsíně).'],
});

regE(127, 'bunkerDamaged', 'Poškozený bunkr', {
  describe: () => 'malý bunkr 5 × 4 m s odlomeným rohem (−X, −Z), odkrytou armaturou stropu a hromadou suti jako druhým vstupem',
  generate(_p, seed) {
    const W = 5, D = 4, h = 2.8, w = 0.6, top = h - 0.5, parts: Part[] = [];
    const z0 = -D / 2, z1 = D / 2;
    // Čelo jen od x = −0,6 (levý roh chybí), boční −X stěna jen vzadu.
    parts.push(bx(-0.6, W / 2, 0, 1.2, z0, z0 + w, CONC), bx(-0.6, W / 2, 1.5, top, z0, z0 + w, CONC), bx(0.8, W / 2, 1.2, 1.5, z0, z0 + w, CONC));
    parts.push(bx(-W / 2, -W / 2 + w, 0, top, 0.4, z1, CONC), bx(-W / 2, -W / 2 + w, 0, 0.9, z0 + w, 0.4, CONC));
    parts.push(bx(W / 2 - w, W / 2, 0, top, z0 + w, z1, CONC));
    parts.push(bx(-W / 2 + w, 0.6, 0, top, z1 - w, z1, CONC), bx(1.7, W / 2 - w, 0, top, z1 - w, z1, CONC), bx(0.6, 1.7, 2.0, top, z1 - w, z1, CONC));
    parts.push(bx(-0.9, W / 2 + 0.1, top, h, z0 - 0.1, z1 + 0.1, CONC), bx(-W / 2 - 0.1, -0.9, top, h, 0.2, z1 + 0.1, CONC));
    parts.push(bx(-W / 2 + w, W / 2 - w, 0, 0.05, z0 + w, z1 - w, 'concreteDark'));
    for (let i = 0; i < 6; i++) parts.push({ shape: 'cylinder', pos: [-1.0 - i * 0.25, top + 0.25, z0 + 0.4 + (i % 2) * 0.3], rot: [0.5, 0, 1.2 + i * 0.1], size: [0.03, 0.8, 0.03], material: RUST });
    // Hromada suti = rampa do rohu (druhý vstup), mimo hlavní vstup vzadu.
    parts.push({ shape: 'wedge', pos: [-1.8, 0.45, z0 - 0.6], rot: [0, 0, 0], size: [1.4, 0.9, 1.6], material: CONC, collide: true, render: false });
    parts.push(...rubble(-1.8, z0 - 0.5, 8, [1.4, 1.4], seed, 0.6), ...rubble(-1.6, z0 + 0.8, 4, [1.0, 0.8], seed + 4, 0.45));
    return parts;
  },
}, {
  target: [5, 5.4, 2.8],
  route: [{ p: [-1.8, 0, -3.8], note: 'před sutí' }, { p: [-1.8, 0.9, -1.2], note: 'přes suť – druhý vstup' }, { p: [0.6, 0.05, 0.6], note: 'uvnitř' }, { p: [1.15, 0.05, 1.4] }, { p: [1.15, 0, 3.0], note: 'hlavní vstup vzadu' }],
  walkableRoof: false,
  rays: [{ from: [-4, 1.5, -1.4], to: [0, 1.5, -1.4], hit: false, note: 'odlomeným rohem lze střílet dovnitř' }, { from: [2.0, 1.35, -5], to: [2.0, 1.35, 0], hit: true, note: 'zbytek čela kryje' }],
  notes: ['Suť (rampa, kolize jako klín) tvoří druhý vstup v rohu; hlavní vstup vzadu volný.'],
});

// ---------------------------------------------------------------------------
// E128–E131 HESCO
// ---------------------------------------------------------------------------
/** Řada košů HESCO 1 × 1 m: kolize souvislý kvádr, vzhled koše + rám ze sítě. */
function hesco(x0: number, x1: number, z0: number, z1: number, h: number, seed: number, irregular = false): Part[] {
  const r = rng(seed), parts: Part[] = [{ ...bx(x0, x1, 0, h, z0, z1, 'hescoFill'), render: false }];
  const alongX = x1 - x0 >= z1 - z0;
  const L = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L));
  for (let i = 0; i < n; i++) {
    const a = (i * L) / n, b = ((i + 1) * L) / n;
    const hh = h + (irregular ? (r() - 0.3) * 0.12 : 0);
    const box = alongX ? bx(x0 + a + 0.01, x0 + b - 0.01, 0, hh, z0, z1, 'hescoFill', false) : bx(x0, x1, 0, hh, z0 + a + 0.01, z0 + b - 0.01, 'hescoFill', false);
    parts.push(box);
    // Svislé dráty v rozích (síť řeší materiál), horní lem.
    parts.push({ ...box, pos: [box.pos[0], hh - 0.03, box.pos[2]], size: [box.size[0] + 0.02, 0.06, box.size[2] + 0.02], material: 'chainLink' });
    if (irregular) parts.push({ shape: 'blob', pos: [box.pos[0], hh - 0.05, box.pos[2]], size: [box.size[0] * 0.8, 0.18, box.size[2] * 0.8], material: 'sand', seed: Math.floor(r() * 999), rough: 0.4 });
  }
  return parts;
}

regE(128, 'hescoLow', 'Nízká HESCO stěna', {
  describe: () => 'úsek 4 × 1 × 1,1 m, 4 spojené koše, souvislá kolize',
  generate(_p, seed) {
    return hesco(-2, 2, -0.5, 0.5, 1.1, seed);
  },
}, {
  target: [4, 1, 1.1],
  route: [{ p: [-1.8, 0, -1.2] }, { p: [1.8, 0, -1.2], note: 'podél stěny' }],
  walkableRoof: false,
  rays: [thru(0, 0.8, true, 'kryje vkleče'), thru(0, 1.4, false, 'vestoje přes ni lze střílet')],
  notes: ['Síť řešena materiálem; kolize jeden kvádr bez mezer mezi koši.'],
});

regE(129, 'hescoHigh', 'Vysoká HESCO stěna', {
  describe: () => 'úsek 4 × 1 × 2,1 m, mírně nepravidelná výplň nahoře, souvislá kolize',
  generate(_p, seed) {
    return hesco(-2, 2, -0.5, 0.5, 2.1, seed, true);
  },
}, {
  target: [4, 1, 2.2],
  route: [{ p: [-1.8, 0, -1.2] }, { p: [1.8, 0, -1.2], note: 'podél stěny' }],
  walkableRoof: false,
  rays: [thru(0, 1.9, true, 'kryje i stojícího'), thru(1.95, 1.0, true, 'bez mezer až k okraji')],
  notes: ['Nepravidelná výplň nahoře je vzhled; kolize souvislá do 2,1 m.'],
});

regE(130, 'hescoCorner', 'Rohová HESCO stěna', {
  describe: () => 'dvě ramena po 3 m, výška 2,1 m, kout bez mezer',
  generate(_p, seed) {
    return [...hesco(-1.5, 1.5, -1.5, -0.5, 2.1, seed, true), ...hesco(-1.5, -0.5, -0.5, 1.5, 2.1, seed + 1, true)];
  },
}, {
  target: [3, 3, 2.2],
  route: [{ p: [1.2, 0, 0.6], note: 'v koutě' }, { p: [0.0, 0, 0.2] }, { p: [-0.1, 0, 1.2] }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.5, -3], to: [0.5, 1.5, 0.5], hit: true, note: 'kout kryje' }],
  notes: ['Ramena se překrývají v rohu (jeden souvislý objem) – žádná štěrbina.'],
});

regE(131, 'hescoGap', 'HESCO stěna s průchodem', {
  describe: () => 'dva bloky 2 × 1 × 2,1 m, průchod 1,5 m bez horního překladu',
  generate(_p, seed) {
    return [...hesco(-2.75, -0.75, -0.5, 0.5, 2.1, seed, true), ...hesco(0.75, 2.75, -0.5, 0.5, 2.1, seed + 1, true)];
  },
}, {
  target: [5.5, 1, 2.2],
  route: [{ p: [0, 0, -2], note: 'před stěnou' }, { p: [0, 0, 0], note: 'průchod 1,5 m' }, { p: [0, 0, 2] }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průchod'), thru(-1.8, 1.5, true, 'blok kryje')],
  notes: ['Průchod 1,5 m otevřený nahoru.'],
});

// ---------------------------------------------------------------------------
// E132–E133 Stany (plachta: kolize jen pro pohyb, střely projdou)
// ---------------------------------------------------------------------------
function tent(W: number, D: number, wallH: number, ridge: number, ends: ('front' | 'back')[], beds: number, seed: number): Part[] {
  const parts: Part[] = [];
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const FAB = 'fabricSand';
  // Rám: sloupy po obvodu (2 m rozteč) a hřebenové sloupy na čelech.
  for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / Math.round((z1 - z0) / 2)) for (const x of [x0 + 0.05, x1 - 0.05]) parts.push(bx(x - 0.04, x + 0.04, 0, wallH, z - 0.04, z + 0.04, 'paintedMetal', false));
  for (const z of [z0 + 0.05, z1 - 0.05]) parts.push(bx(-0.04, 0.04, 0, ridge, z - 0.04, z + 0.04, 'paintedMetal', z === z0 + 0.05 ? false : false));
  // Stěny s bočním prověšením (mírně dovnitř skloněné), kolize jen pro pohyb.
  for (const s of [-1, 1]) {
    parts.push({ shape: 'box', pos: [s * (W / 2 - 0.08), wallH / 2, 0], rot: [0, 0, s * 0.05], size: [0.03, wallH, D], material: FAB });
    parts.push({ ...bx(s < 0 ? x0 : x1 - 0.06, s < 0 ? x0 + 0.06 : x1, 0, wallH, z0, z1, FAB), render: false, moveOnly: true });
  }
  // Střecha: dvě plochy k hřebeni s prověšením (mírně prohnuté – dvě části na stranu).
  const half = W / 2 + 0.2, rise = ridge - wallH;
  for (const s of [-1, 1]) {
    const a = Math.atan2(rise, half), L = Math.hypot(rise, half);
    parts.push({ shape: 'box', pos: [(s * half) / 2, wallH + rise / 2 - 0.06, 0], rot: [0, 0, -s * a], size: [L, 0.03, D + 0.2], material: FAB });
  }
  // Čela: plná s plachtou, vstupy (otevřené, srolovaná chlopeň nahoře).
  for (const [z, name] of [[z0, 'front'], [z1, 'back']] as const) {
    const open = ends.includes(name);
    for (let x = x0; x < x1 - 1e-6; x += 0.5) {
      const xc = x + 0.25, top = wallH + rise * (1 - Math.abs(xc) / (W / 2));
      const inDoor = open && Math.abs(xc) < 0.9;
      if (inDoor) {
        parts.push(bx(x, x + 0.5, Math.min(top, 2.3), top, z - 0.02, z + 0.02, FAB, false));
        continue;
      }
      parts.push(bx(x, x + 0.5, 0, top, z - 0.02, z + 0.02, FAB, false));
    }
    if (open) parts.push(pipe([-0.9, 2.25, z - 0.08], [0.9, 2.25, z - 0.08], 0.16, FAB, false));
    const holeX = open ? 0.9 : 0;
    parts.push({ ...bx(x0, -holeX || x1, 0, wallH, z - 0.03, z + 0.03, FAB), render: false, moveOnly: true });
    if (open) parts.push({ ...bx(holeX, x1, 0, wallH, z - 0.03, z + 0.03, FAB), render: false, moveOnly: true });
  }
  // Lůžka při stěnách (polní lehátka), volná středová cesta.
  const r = rng(seed);
  for (let i = 0; i < beds; i++) {
    const z = z0 + 1.2 + i * 1.3;
    if (z > z1 - 1.0) break;
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 0.65);
      parts.push(bx(x - 0.35, x + 0.35, 0.35, 0.45, z - 0.95, z + 0.95, 'fabricSand', true), bx(x - 0.37, x + 0.37, 0, 0.35, z - 0.97, z - 0.9, 'paintedMetal', false), bx(x - 0.37, x + 0.37, 0, 0.35, z + 0.9, z + 0.97, 'paintedMetal', false));
      if (r() < 0.5) parts.push(bx(x - 0.25, x + 0.25, 0.45, 0.6, z + 0.5, z + 0.85, 'fabricSand', false));
    }
  }
  return parts;
}

regE(132, 'tentSmall', 'Malý vojenský stan', {
  describe: () => '5 × 4 × 3 m, otevřený vstup 1,8 × 2,3 m, jednoduchý rám, prověšené boky, prázdný průchozí interiér',
  generate(_p, seed) {
    return tent(4, 5, 1.9, 3.0, ['front'], 0, seed);
  },
}, {
  target: [4, 5, 3],
  route: [{ p: [0, 0, -3.5], note: 'před stanem' }, { p: [0, 0, 0], note: 'uvnitř' }, { p: [1.2, 0, 1.6] }],
  walkableRoof: false,
  rays: [{ from: [-4, 1.2, 0], to: [0, 1.2, 0], hit: false, note: 'plachta střelu nezastaví' }],
  notes: ['Plachta: kolize jen pro pohyb (moveOnly) – hráč neprojde, střela ano.'],
});

regE(133, 'tentLarge', 'Velký vojenský stan', {
  describe: () => '10 × 6 × 3,5 m (podél Z), vstupy na obou koncích, 6 lůžek při stěnách, volná středová cesta 2,6 m',
  generate(_p, seed) {
    return tent(6, 10, 2.1, 3.5, ['front', 'back'], 6, seed);
  },
}, {
  target: [6, 10, 3.5],
  route: [{ p: [0, 0, -6.5], note: 'vstup 1' }, { p: [0, 0, 0], note: 'středová cesta' }, { p: [0, 0, 6.5], note: 'vstup 2' }],
  walkableRoof: false,
  rays: [{ from: [0, 1.5, -7], to: [0, 1.5, 7], hit: false, note: 'středová cesta průstřelná skrz' }],
  notes: ['Lůžka 0,7 m široká u obou stěn, mezi nimi 2,6 m volného průchodu.'],
});

// ---------------------------------------------------------------------------
// E134–E135 Anténní stožáry (kotevní lana bez pohybové kolize)
// ---------------------------------------------------------------------------
function lattice(h: number, r: number, step: number): Part[] {
  const parts: Part[] = [];
  const legs: [number, number][] = [0, 1, 2].map((i) => [r * Math.cos((i * 2 * Math.PI) / 3 + Math.PI / 2), r * Math.sin((i * 2 * Math.PI) / 3 + Math.PI / 2)]);
  for (const [x, z] of legs) parts.push(cyl(x, 0, h, z, 0.06, STEEL, true));
  for (let y = step; y < h; y += step)
    for (let i = 0; i < 3; i++) {
      const a = legs[i], b = legs[(i + 1) % 3];
      parts.push(beam([a[0], y, a[1]], [b[0], y, b[1]], 0.035, STEEL), beam([a[0], y - step, a[1]], [b[0], y, b[1]], 0.03, STEEL));
    }
  // Kolize dříku: jeden svislý kvádr (tenké pruty bez kolize).
  parts.push({ ...bx(-r * 0.6, r * 0.6, 0, h, -r * 0.6, r * 0.6, STEEL), render: false });
  return parts.map((p) => (p.shape === 'cylinder' ? { ...p, collide: false } : p));
}
function guys(h: number, R: number): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3 + Math.PI / 6;
    const g: V3 = [R * Math.cos(a), 0.2, R * Math.sin(a)];
    parts.push(bx(g[0] - 0.3, g[0] + 0.3, 0, 0.25, g[2] - 0.3, g[2] + 0.3, CONC, false), pipe(g, [0, h, 0], 0.015, 'metal', false), pipe(g, [0, h * 0.55, 0], 0.015, 'metal', false));
  }
  return parts;
}

regE(134, 'mastLow', 'Nízký anténní stožár', {
  describe: () => 'výška 8 m, příhradový dřík (trojboký), 3 kotevní body ve 4 m, lana bez pohybové kolize',
  generate() {
    return [bx(-0.5, 0.5, 0, 0.3, -0.5, 0.5, CONC), ...lattice(8, 0.22, 1.0), ...guys(7.5, 4), cyl(0, 8, 9.0, 0, 0.04, 'metal', false), bx(-0.3, 0.3, 7.4, 7.8, -0.05, 0.05, 'plasterWhite', false)];
  },
}, {
  target: [8, 8, 9],
  route: [{ p: [-2, 0, -2] }, { p: [2, 0, 2], note: 'mezi kotevními lany' }],
  walkableRoof: false,
  notes: ['Kotevní lana a příhrada jsou vzhled (bez pohybové kolize); kolizi má jen dřík a patka.'],
});

regE(135, 'mastHigh', 'Vysoký anténní stožár', {
  describe: () => 'výška 16 m, betonový základ 2 × 2 m, širší příhradový dřík, parabola, směrové antény, 3 kotvy v 7 m',
  generate() {
    const parts: Part[] = [bx(-1, 1, 0, 0.6, -1, 1, CONC), ...lattice(16, 0.4, 1.2), ...guys(14, 7)];
    parts.push({ shape: 'cylinder', pos: [0.55, 12.5, 0], rot: [0, 0, Math.PI / 2], size: [1.2, 0.25, 1.2], material: 'plasterWhite' });
    for (const [y, a] of [[14.5, 0], [14.5, 2.1], [15.3, 4.2]] as const) parts.push({ shape: 'box', pos: [Math.cos(a) * 0.45, y, Math.sin(a) * 0.45], size: [0.12, 1.4, 0.06], rot: [0, -a, 0], material: 'plasterWhite' });
    parts.push(cyl(0, 16, 17.5, 0, 0.05, 'metal', false), bx(-0.08, 0.08, 0.6, 15.5, 0.35, 0.45, 'rubber', false));
    return parts;
  },
}, {
  target: [14, 14, 17.5],
  route: [{ p: [-2.5, 0, -2.5] }, { p: [2.5, 0, 2.5], note: 'kolem základu' }],
  walkableRoof: false,
  rays: [{ from: [-3, 0.4, 0], to: [0, 0.4, 0], hit: true, note: 'základ kryje vleže' }],
  notes: ['Kabely nahrazeny jedním svazkem podél dříku; lana bez pohybové kolize.'],
});
