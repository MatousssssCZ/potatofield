import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import {
  M, acBox, bands, chair, rail, coreFlights, coreLayout, crate, door, ladderDef, ladderParts, landing, mattress, parapet, pass, rug, shelf, slab, spout, stairs, table, tank, wall, wallLine, win,
  type Op, type P2, type Rect,
} from './bk';
import type { B6 } from './close';
import { TRIM, groundFloor, partition, reg, roofSlab, shell } from './residential';

/**
 * Sada 300 · A obytné budovy, položky 21–30: rohové domy, hliněné domy, vily, poškozené domy.
 * Budovy s více nadzemními podlažími jsou uzavřené (BF2): bez interiéru, okna se sklem.
 */
const t = M.wall;
const S = M.storey;
const H = S - M.slab;

function W(a: P2, b: P2, y0: number, h: number, ops: Op[], mat: string, out?: P2, thick = t, trim = TRIM): Part[] {
  const alongX = Math.abs(b[1] - a[1]) < 1e-6;
  const start = alongX ? a[0] : a[1];
  return wall(a, b, y0, h, thick, ops.map((o) => ({ ...o, c: o.c - start })), mat, out ? { out, trim } : { plain: true });
}

const shopOp = (c: number, w = 2.6): Op => ({ c, w, b: 0, t: 2.5, kind: 'door' });
const smallWin = (c: number): Op => ({ c, w: 0.7, b: 1.0, t: 1.6, kind: 'window' });

/** Roleta ve stažené poloze nad otvorem (box rolety + kousek pancíře). */
function shutterOver(at: [number, number, number], w: number, alongX: boolean): Part[] {
  const [x, y, z] = at;
  return [
    { shape: 'box', pos: [x, y + 0.18, z], size: alongX ? [w + 0.1, 0.32, 0.3] : [0.3, 0.32, w + 0.1], material: 'shutterBox' },
    { shape: 'box', pos: [x, y - 0.18, z], size: alongX ? [w, 0.4, 0.04] : [0.04, 0.4, w], material: 'shutter' },
  ];
}

/** Pomůcka: vnitřní plochy otevřeného prostoru v plné budově (zbořený roh, průraz) – jen vzhled. */
function roomFaces(h: B6, open: ('x0' | 'x1' | 'z0' | 'z1' | 'top')[], mat: string): Part[] {
  const [x0, y0, z0, x1, y1, z1] = h;
  const th = 0.1, parts: Part[] = [];
  const cy = (y0 + y1) / 2, hh = y1 - y0;
  if (!open.includes('x0')) parts.push({ shape: 'box', pos: [x0 + th / 2, cy, (z0 + z1) / 2], size: [th, hh, z1 - z0], material: mat });
  if (!open.includes('x1')) parts.push({ shape: 'box', pos: [x1 - th / 2, cy, (z0 + z1) / 2], size: [th, hh, z1 - z0], material: mat });
  if (!open.includes('z0')) parts.push({ shape: 'box', pos: [(x0 + x1) / 2, cy, z0 + th / 2], size: [x1 - x0, hh, th], material: mat });
  if (!open.includes('z1')) parts.push({ shape: 'box', pos: [(x0 + x1) / 2, cy, z1 - th / 2], size: [x1 - x0, hh, th], material: mat });
  if (!open.includes('top')) parts.push({ shape: 'box', pos: [(x0 + x1) / 2, y1 - th / 2, (z0 + z1) / 2], size: [x1 - x0, th, z1 - z0], material: 'concreteLight' });
  parts.push({ shape: 'box', pos: [(x0 + x1) / 2, y0 + 0.02, (z0 + z1) / 2], size: [x1 - x0, 0.04, z1 - z0], material: 'concreteDark' });
  return parts;
}

/** Suť: několik velkých kusů betonu a cihel (vzhled; kolizi řeší rampa / bloky zvlášť). */
function debris(x: number, z: number, y: number, n: number, spread: number, seed: number, size = 0.7): Part[] {
  const r = rng(seed);
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const s = size * (0.5 + r());
    // Hranaté kusy (deska / blok), natočené a částečně zapadlé.
    parts.push({ shape: 'box', pos: [x + (r() - 0.5) * spread, y + s * 0.22, z + (r() - 0.5) * spread], rot: [(r() - 0.5) * 0.9, r() * Math.PI, (r() - 0.5) * 0.9], size: [s * 1.3, s * (0.25 + r() * 0.35), s * (0.7 + r() * 0.5)], material: r() < 0.65 ? 'concreteLight' : 'brick' });
  }
  return parts;
}

/** Armatura trčící z hrany desky (vzhled). */
function rebar(a: P2, b: P2, y: number, out: P2, n: number, seed: number): Part[] {
  const r = rng(seed);
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
    const len = 0.3 + r() * 0.5;
    const yaw = Math.atan2(out[0], out[1]) + (r() - 0.5) * 0.5;
    parts.push({ shape: 'cylinder', pos: [x + Math.sin(yaw) * len / 2, y - 0.08 + (r() - 0.5) * 0.06, z + Math.cos(yaw) * len / 2], rot: [Math.PI / 2 + (r() - 0.5) * 0.6, yaw, 0], size: [0.025, len, 0.025], material: 'metalSheetRust' });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// A21 Rohový dům se dvěma výlohami: 11 × 9 m, přízemní, každá uliční fasáda má vlastní
// obchodní otvor, uvnitř propojený prodejní prostor; plný roh jako výrazný kryt.
// ---------------------------------------------------------------------------
reg(21, 'cornerTwoShops', 'Rohový dům se dvěma výlohami', {
  describe: () => '11 × 9 m, přízemní obchod, otvory do obou ulic, plné nároží, sklad, žebřík na střechu',
  ladders: () => [ladderDef(3.6, 4.55, 0, S, 'z-')],
  generate(_p, seed, mat) {
    const R: Rect = [-5.5, -4.5, 5.5, 4.5];
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    parts.push(...shell(R, 0, H, { front: [shopOp(1.4), win(4.2, { w: 1.6, b: 0.6, t: 2.3 })], right: [shopOp(-0.8), win(3.0, { w: 1.0 })], back: [door(-3.6), win(1.8)], left: [win(0.0)] }, mat));
    // Plné nároží: vystouplý pilastr (kryt).
    parts.push({ shape: 'box', pos: [-5.35, H / 2, -4.35], size: [0.7, H, 0.7], material: mat, collide: true });
    parts.push(...shutterOver([1.4, 2.5, -4.6], 2.6, true), ...shutterOver([-5.6, 2.5, -0.8], 2.6, false));
    // Sklad vzadu vpravo.
    parts.push(...partition([-5.2, 1.8], [-1.0, 1.8], 0, H, [door(-2.2, { w: 1.0 })], mat), ...partition([-1.0, 1.8], [-1.0, 4.2], 0, H, [], mat));
    parts.push(...roofSlab(R, H));
    parts.push(...parapet(R, S, M.parapet, mat, TRIM, { gaps: [{ side: 'back', from: 3.1, to: 4.1 }] }));
    parts.push(...ladderParts(3.6, 4.55, 0, S, 'z-'));
    // Markýza nad čelní výlohou, prodejní pulty, police, bedny.
    parts.push({ shape: 'box', pos: [3.0, 2.8, -5.15], rot: [-0.32, 0, 0], size: [5.6, 0.04, 1.3], material: 'awningGreen' });
    parts.push({ shape: 'box', pos: [-2.4, 0.55, -2.6], size: [2.4, 0.95, 0.6], material: 'wood', collide: true }, { shape: 'box', pos: [-3.3, 0.55, -1.6], size: [0.6, 0.95, 1.4], material: 'wood', collide: true });
    parts.push(...shelf(5.0, -2.0, 0.08, -Math.PI / 2, 1.6), ...shelf(5.0, 0.4, 0.08, -Math.PI / 2, 1.6), ...shelf(2.0, 4.0, 0.08, Math.PI, 1.6));
    parts.push(...crate(-4.6, 2.5, 0.08, 0.7), ...crate(-4.7, 3.3, 0.08, 0.55), ...crate(-4.6, 3.95, 0.08, 0.5));
    parts.push(...bands(R, 0.35, null, 'concreteDark', TRIM), ...acBox(5.5, 2.5, 2.4, [1, 0]), ...spout(-2.0, 4.5, S + 0.1, [0, 1]));
    void seed;
    return parts;
  },
}, {
  target: [11, 9, 3.2],
  route: [
    { p: [1.4, 0, -6.0], note: 'ulice A' },
    { p: [1.4, 0.08, -2.0], note: 'prodejna' },
    { p: [-1.0, 0.08, 0.0] },
    { p: [-4.2, 0.08, -0.8] },
    { p: [-7.0, 0, -0.8], note: 'ulice B (druhá výloha)' },
    { p: [-4.2, 0.08, -0.8] },
    { p: [-2.2, 0.08, 1.2] },
    { p: [-2.2, 0.08, 3.0], note: 'sklad' },
    { p: [-3.6, 0.08, 3.2] },
    { p: [-3.6, 0, 5.6], note: 'zadní dveře ven' },
    { p: [3.6, 0, 5.4] },
    { p: [3.6, 3.2, 2.6], ladder: true, note: 'střecha' },
    { p: [-3.0, 3.2, -2.5] },
  ],
  walkableRoof: true,
  view: [[3.8, 1.6, 3.0], [-4.0, 1.2, -3.6]],
  notes: ['Dva obchodní otvory 2,6 × 2,5 m (každá ulice jeden), roleta vytažená; nároží plné s pilastrem.'],
});

// ---------------------------------------------------------------------------
// A22 Rohový dům se zkoseným nárožím: 10 × 10 m, 2 podlaží (uzavřený), nároží seříznuté
// pod 45°, ve zkosení dveře a nad nimi malý balkon.
// ---------------------------------------------------------------------------
const CH = 2.1; // délka seříznutí na každé straně
reg(22, 'cornerChamfer', 'Rohový dům se zkoseným nárožím', {
  describe: () => '10 × 10 m, 2 podlaží (uzavřený), nároží zkosené 45°, dveře a balkon ve zkosení, žebřík na střechu',
  closed: { solids: [[-5 + CH, 0, -5, 5, 2 * S, 5], [-5, 0, -5 + CH, -5 + CH, 2 * S, 5]] },
  ladders: () => [ladderDef(-3.5, 5.05, 0, 2 * S, 'z-')],
  generate(_p, _seed, mat) {
    const parts: Part[] = [];
    const x0 = -5 + CH, z0 = -5 + CH;
    const inset = t / 2 / Math.SQRT2;
    for (let i = 0; i < 2; i++) {
      const y = i * S;
      parts.push(...W([x0, -5 + t / 2], [5, -5 + t / 2], y, H, [win(-1.2), win(1.4), win(3.7)], mat, [0, -1]));
      parts.push(...W([-5 + t / 2, z0], [-5 + t / 2, 4.7], y, H, [win(-1.0), win(1.6), win(3.8)], mat, [-1, 0]));
      parts.push(...W([-5, 5 - t / 2], [5, 5 - t / 2], y, H, i === 0 ? [win(-1.6), door(2.0), win(0.2, { w: 0.9 })] : [win(-1.6), win(0.6), win(3.0)], mat, [0, 1]));
      parts.push(...W([5 - t / 2, -4.7], [5 - t / 2, 4.7], y, H, [win(-2.5), win(0), win(2.5)], mat, [1, 0]));
      // Zkosení: z konce pravé stěny ke začátku čelní (vnější strana k nároží).
      const L = Math.hypot(CH, CH);
      parts.push(...wallLine([-5 + inset, z0 + inset], [x0 + inset, -5 + inset], y, H, t, [i === 0 ? door(L / 2) : door(L / 2, { leaf: false })], mat, 1, { ext: 0.18, collideInfill: true }));
    }
    // Výplň objemu za zkosením (trojúhelník) a střecha / atika ve zkosení.
    const cx = -5 + CH / 2, cz = -5 + CH / 2;
    const yaw = Math.atan2(1, -1);
    parts.push({ shape: 'box', pos: [cx + 0.53, S, cz + 0.53], rot: [0, yaw, 0], size: [1.5, 2 * S, Math.hypot(CH, CH)], material: mat, collide: true, render: false });
    for (const y of [S, 2 * S]) parts.push(...slab([x0, -5, 5, 5], y, M.slab, [], 'concreteLight'), ...slab([-5, z0, x0, 5], y, M.slab, [], 'concreteLight'));
    parts.push({ shape: 'box', pos: [cx + 0.53, S - 0.1, cz + 0.53], rot: [0, yaw, 0], size: [1.5, 0.2, Math.hypot(CH, CH) + 0.1], material: 'concreteLight' });
    parts.push({ shape: 'box', pos: [cx + 0.53, 2 * S - 0.1, cz + 0.53], rot: [0, yaw, 0], size: [1.5, 0.2, Math.hypot(CH, CH) + 0.1], material: 'concreteLight', collide: true });
    parts.push({ shape: 'box', pos: [cx + 0.6, 2 * S + 0.012, cz + 0.6], rot: [0, yaw, 0], size: [1.3, 0.012, Math.hypot(CH, CH) - 0.3], material: 'roof' });
    parts.push(...slab([x0 + 0.1, -4.9, 4.9, 4.9], 2 * S + 0.012, 0.012, [], 'roof', false), ...slab([-4.9, z0 + 0.1, x0 + 0.1, 4.9], 2 * S + 0.012, 0.012, [], 'roof', false));
    const yR = 2 * S;
    parts.push(...W([x0, -5 + 0.125], [5, -5 + 0.125], yR, 1.0, [], mat, undefined, 0.25), ...W([-5 + 0.125, z0], [-5 + 0.125, 5], yR, 1.0, [], mat, undefined, 0.25));
    parts.push(...W([-5, 5 - 0.125], [-4.0, 5 - 0.125], yR, 1.0, [], mat, undefined, 0.25), ...W([-3.0, 5 - 0.125], [5, 5 - 0.125], yR, 1.0, [], mat, undefined, 0.25), ...W([5 - 0.125, -5], [5 - 0.125, 5], yR, 1.0, [], mat, undefined, 0.25));
    parts.push(...wallLine([-5 + 0.09, z0 + 0.09], [x0 + 0.09, -5 + 0.09], yR, 1.0, 0.25, [], mat, 1, { ext: 0.12 }));
    parts.push(...ladderParts(-3.5, 5.05, 0, yR, 'z-'));
    // Balkon nad dveřmi ve zkosení.
    const bx = cx - 0.5, bz = cz - 0.5;
    parts.push({ shape: 'box', pos: [bx, S - 0.1, bz], rot: [0, yaw, 0], size: [1.0, 0.2, 2.0], material: 'concreteLight', collide: true });
    parts.push({ shape: 'box', pos: [bx - 0.32, S + 0.5, bz - 0.32], rot: [0, yaw, 0], size: [0.14, 1.0, 2.0], material: mat, collide: true });
    for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [bx + s * 0.7 * Math.SQRT1_2 * 1.0 + 0.0, S + 0.5, bz - s * 0.7 * Math.SQRT1_2], rot: [0, yaw, 0], size: [1.0, 1.0, 0.12], material: mat, collide: true });
    parts.push(...tank(2.6, 2.4, yR, 0.6, 1.1, 1.2), ...acBox(5, -2.5, 5.4, [1, 0]), ...acBox(-1.0, 5, 2.3, [0, 1]));
    parts.push({ shape: 'box', pos: [1.0, S - 0.05, -5.05], size: [8.2, 0.12, 0.1], material: TRIM }, { shape: 'box', pos: [-5.05, S - 0.05, 1.0], size: [0.1, 0.12, 8.2], material: TRIM });
    return parts;
  },
}, {
  target: [10, 10, 6.4],
  route: [
    { p: [-7.0, 0, -7.0], note: 'nároží' },
    { p: [-4.6, 0, -4.6], note: 'u dveří ve zkosení' },
    { p: [-7.0, 0, 2.0] },
    { p: [-3.5, 0, 6.6], note: 'za domem' },
    { p: [-3.5, 6.4, 3.5], ladder: true, note: 'střecha' },
    { p: [2.0, 6.4, -2.0] },
  ],
  walkableRoof: true,
  view: [[-8.5, 2.2, -8.5], [-3.6, 2.6, -3.6]],
  notes: ['Uzavřená budova (2 podlaží, styl BF2) – zkosené nároží s dveřmi a balkonem, střecha po žebříku.'],
});

// ---------------------------------------------------------------------------
// Hliněné domy (A23–A26): silné mírně nepravidelné stěny, zaoblené horní hrany, dřevěná
// nadpraží, trámy stropu přečnívající z fasády, nízké zaoblené atiky, rovné podlahy.
// ---------------------------------------------------------------------------

/** Zaoblená horní hrana zdi (válec po délce) – vzhled. */
function roundCap(a: P2, b: P2, y: number, th: number, mat: string): Part {
  const alongX = Math.abs(b[1] - a[1]) < 1e-6;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { shape: 'cylinder', pos: [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2], rot: alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0], size: [th, len, th], material: mat };
}

/** Plášť hliněného domu: stěny tloušťky th, výška se po stěnách mírně liší, zaoblená koruna. */
function mudShell(r: Rect, h: number, th: number, ops: { front?: Op[]; back?: Op[]; left?: Op[]; right?: Op[] }, mat: string, seed: number, skip: string[] = []): Part[] {
  const R = rng(seed);
  const [x0, z0, x1, z1] = r;
  const parts: Part[] = [];
  const sides: [string, P2, P2, P2, number][] = [
    ['front', [x0, z0 + th / 2], [x1, z0 + th / 2], [0, -1], x0],
    ['back', [x0, z1 - th / 2], [x1, z1 - th / 2], [0, 1], x0],
    ['left', [x1 - th / 2, z0 + th], [x1 - th / 2, z1 - th], [1, 0], z0 + th],
    ['right', [x0 + th / 2, z0 + th], [x0 + th / 2, z1 - th], [-1, 0], z0 + th],
  ];
  for (const [side, a, b, out, start] of sides) {
    if (skip.includes(side)) continue;
    const hh = h + (R() - 0.5) * 0.12;
    const list = (ops as Record<string, Op[] | undefined>)[side] ?? [];
    parts.push(...wall(a, b, 0, hh, th, list.map((o) => ({ ...o, c: o.c - start, leaf: false })), mat, { out, trim: 'woodDark' }));
    parts.push(roundCap(a, b, hh, th * 0.9, mat));
  }
  return parts;
}

/** Hliněná střecha: deska, zemina navrchu, nízká zaoblená atika, trámy přečnívající z čela a zad. */
function mudRoof(r: Rect, h: number, mat: string, seed: number, gaps: { side: 'front' | 'back' | 'left' | 'right'; from: number; to: number }[] = []): Part[] {
  const R = rng(seed + 3);
  const [x0, z0, x1, z1] = r;
  const parts: Part[] = [];
  parts.push(...slab([x0 + 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05], h + 0.25, 0.25, [], mat));
  parts.push(...slab([x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2], h + 0.27, 0.02, [], 'dirt', false));
  parts.push(...parapet([x0, z0, x1, z1], h + 0.25, 0.4, mat, mat, { t: 0.3, gaps }));
  const n = Math.max(3, Math.round((x1 - x0) / 1.1));
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.5 + ((x1 - x0 - 1.0) * i) / (n - 1);
    for (const [z, s] of [[z0, -1], [z1, 1]] as const) parts.push({ shape: 'cylinder', pos: [x, h - 0.1, z + s * 0.12], rot: [Math.PI / 2, 0, 0], size: [0.14 + R() * 0.04, 0.35 + R() * 0.15, 0.14], material: 'woodDark' });
  }
  return parts;
}

/** Udusaná hliněná podlaha. */
const mudFloor = (r: Rect): Part[] => groundFloor(r).map((q) => ({ ...q, material: 'dirt' }));

/** Nízký stolek, hliněné nádoby. */
function lowTable(x: number, z: number, y: number): Part[] {
  return [{ shape: 'box', pos: [x, y + 0.34, z], size: [0.9, 0.05, 0.6], material: 'wood', collide: true }, { shape: 'box', pos: [x, y + 0.16, z], size: [0.7, 0.32, 0.4], material: 'woodDark' }];
}
function pots(x: number, z: number, y: number, n: number, seed: number): Part[] {
  const r = rng(seed);
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const d = 0.3 + r() * 0.2, h = 0.4 + r() * 0.3;
    out.push({ shape: 'cylinder', pos: [x + (r() - 0.5) * 0.8, y + h / 2, z + (r() - 0.5) * 0.5], size: [d, h, d], taper: 0.75, material: 'plasterOchre' });
  }
  return out;
}

reg(23, 'mudSmall', 'Malý hliněný dům', {
  describe: () => '5 × 5 × 3 m, silné hliněné zdi 0,45 m, jedna místnost, dvě malá okna, žebřík na střechu',
  ladders: () => [ladderDef(1.2, 2.55, 0, 2.95, 'z-')],
  defaultMaterial: 'plasterOchre',
  generate(_p, seed, mat) {
    const R: Rect = [-2.5, -2.5, 2.5, 2.5];
    const th = 0.45, h = 2.7;
    const parts: Part[] = [...mudFloor(R)];
    parts.push(...mudShell(R, h, th, { front: [door(-0.6, { w: 1.1, t: 2.2 }), smallWin(1.3)], left: [smallWin(0.4)] }, mat, seed));
    parts.push(...mudRoof(R, h, mat, seed, [{ side: 'back', from: 0.7, to: 1.7 }]));
    parts.push(...ladderParts(1.2, 2.55, 0, 2.95, 'z-'));
    parts.push(...mattress(-1.3, 0.9, 0.08), ...lowTable(0.8, 0.6, 0.08), ...rug(0.3, 0.3, 0.08, 1.6, 1.2), ...pots(1.4, 1.7, 0.08, 3, seed));
    return parts;
  },
}, {
  target: [5, 5, 3],
  route: [
    { p: [-0.6, 0, -4.0], note: 'venku' },
    { p: [-0.6, 0.08, -1.0], note: 'místnost' },
    { p: [0.6, 0.08, -1.2] },
    { p: [-0.6, 0.08, -1.0] },
    { p: [-0.6, 0, -4.0] },
    { p: [3.6, 0, -3.6] },
    { p: [3.6, 0, 3.8] },
    { p: [1.2, 0, 3.0] },
    { p: [1.2, 2.95, 1.2], ladder: true, note: 'střecha' },
  ],
  walkableRoof: true,
  view: [[1.6, 1.5, -1.6], [-1.4, 0.7, 1.4]],
  notes: ['Zdi 0,45 m se zaoblenou korunou, trámy stropu přečnívají z čela a zad.'],
});

reg(24, 'mudTwoRooms', 'Hliněný dům se dvěma místnostmi', {
  describe: () => '8 × 5 × 3 m, dvě místnosti, přední a boční vstup, mírně nepravidelná střecha',
  ladders: () => [ladderDef(-2.6, 2.55, 0, 2.75, 'z-')],
  defaultMaterial: 'plasterOchre',
  generate(_p, seed, mat) {
    const R: Rect = [-4, -2.5, 4, 2.5];
    const th = 0.45;
    const parts: Part[] = [...mudFloor(R)];
    parts.push(...mudShell(R, 2.75, th, { front: [door(-1.8, { w: 1.1, t: 2.2 }), smallWin(1.6)], back: [smallWin(-2.0), smallWin(2.2)], left: [door(0.0, { w: 1.1, t: 2.2 })], right: [smallWin(0.2)] }, mat, seed));
    parts.push(...partition([0.5, -2.05], [0.5, 2.05], 0, 2.7, [door(-0.4, { w: 1.0 })], mat).map((q) => ({ ...q, size: [0.3, q.size[1], q.size[2]] as [number, number, number] })));
    // Dvě střechy v mírně odlišné výšce (charakteristický nepravidelný obrys).
    parts.push(...mudRoof([-4, -2.5, 0.5, 2.5], 2.5, mat, seed, [{ side: 'back', from: -3.1, to: -2.1 }]), ...mudRoof([0.5, -2.5, 4, 2.5], 2.68, mat, seed + 9));
    parts.push(...ladderParts(-2.6, 2.55, 0, 2.75, 'z-'));
    parts.push(...mattress(2.6, 1.0, 0.08), ...mattress(3.2, -0.6, 0.08, Math.PI / 2), ...lowTable(-2.2, 1.2, 0.08), ...rug(-1.6, 0.3, 0.08, 2.0, 1.4), ...pots(-3.2, -1.6, 0.08, 4, seed));
    return parts;
  },
}, {
  target: [8, 5, 3],
  route: [
    { p: [-1.8, 0, -4.0], note: 'venku' },
    { p: [-1.8, 0.08, -0.6], note: 'pravá místnost' },
    { p: [0.5, 0.08, -0.4] },
    { p: [2.4, 0.08, -0.4], note: 'levá místnost' },
    { p: [5.6, 0, 0.0], note: 'boční vstup ven' },
    { p: [5.6, 0, 3.8] },
    { p: [-2.6, 0, 3.6] },
    { p: [-2.6, 2.75, 1.0], ladder: true, note: 'střecha' },
  ],
  walkableRoof: true,
  view: [[-3.4, 1.5, -1.8], [2.6, 0.9, 1.0]],
  notes: ['Střechy místností ve výškách 2,75 / 2,93 m (nepravidelný obrys).'],
});

reg(25, 'mudAnnex', 'Hliněný dům s přístavkem', {
  describe: () => 'hlavní blok 6 × 6 m, přístavek 3 × 4 m s nižší střechou (sklad), vnitřní propojení',
  ladders: () => [ladderDef(1.5, 3.05, 0, 3.15, 'z-')],
  defaultMaterial: 'plasterOchre',
  generate(_p, seed, mat) {
    const Mn: Rect = [-3, -3, 3, 3];
    const An: Rect = [-6, -2, -3, 2];
    const th = 0.45;
    const parts: Part[] = [...mudFloor(Mn), ...mudFloor(An)];
    parts.push(...mudShell(Mn, 2.9, th, { front: [door(0.6, { w: 1.1, t: 2.2 }), smallWin(-1.6)], back: [smallWin(-0.5)], left: [smallWin(0.0)], right: [door(0.6, { w: 1.0, t: 2.1 })] }, mat, seed));
    parts.push(...mudShell(An, 2.2, th, { front: [door(-4.5, { w: 1.1, t: 2.15 })], right: [smallWin(0.5)] }, mat, seed + 5, ['left']));
    parts.push(...mudRoof(Mn, 2.9, mat, seed, [{ side: 'back', from: 1.0, to: 2.0 }]), ...mudRoof(An, 2.2, mat, seed + 7, []));
    parts.push(...ladderParts(1.5, 3.05, 0, 3.15, 'z-'));
    // Sklad: pytle a bedny.
    for (let i = 0; i < 5; i++) parts.push({ shape: 'box', pos: [-5.2 + (i % 3) * 0.55, 0.2 + Math.floor(i / 3) * 0.3, 1.2 - (i % 2) * 0.1], rot: [0, (i % 3) * 0.2, 0], size: [0.6, 0.25, 0.4], material: 'fabricSand' });
    parts.push(...crate(-5.3, -1.2, 0.08, 0.6), ...crate(-5.3, -0.4, 0.08, 0.55));
    parts.push(...mattress(1.6, 1.4, 0.08), ...lowTable(-1.2, 1.4, 0.08), ...rug(-0.4, 0.6, 0.08, 2.0, 1.6), ...pots(2.0, -2.0, 0.08, 3, seed));
    return parts;
  },
}, {
  target: [9, 6, 3],
  route: [
    { p: [0.6, 0, -4.5], note: 'venku' },
    { p: [0.6, 0.08, -1.0], note: 'hlavní místnost' },
    { p: [-2.0, 0.08, 0.6] },
    { p: [-4.2, 0.08, 0.6], note: 'přístavek (sklad)' },
    { p: [-4.5, 0.08, -1.2] },
    { p: [-4.5, 0, -3.6], note: 'ven přístavkem' },
    { p: [3.6, 0, -3.8] },
    { p: [3.6, 0, 4.0] },
    { p: [1.5, 0, 3.5] },
    { p: [1.5, 3.15, 1.6], ladder: true, note: 'střecha' },
  ],
  walkableRoof: true,
  view: [[2.2, 1.5, -2.2], [-5.0, 1.0, 0.4]],
  notes: ['Přístavek 3 × 4 m o 0,7 m nižší, propojený dveřmi s hlavní místností.'],
});

reg(26, 'mudIrregular', 'Hliněný dům s nepravidelným půdorysem', {
  describe: () => 'obálka 9 × 7 m, vychýlené obvodové zdi, vstupní předprostor, dvě místnosti a úzký sklad',
  ladders: () => [ladderDef(-2.6, 3.65, 0, 2.95, 'z-')],
  defaultMaterial: 'plasterOchre',
  generate(_p, seed, mat) {
    const th = 0.45, h = 2.7;
    const A: P2 = [-4.5, -3.3], B: P2 = [4.4, -3.6], C: P2 = [4.6, 3.4], D: P2 = [-4.3, 3.6];
    const cx = 0, cz = 0;
    const parts: Part[] = [...mudFloor([-4.4, -3.5, 4.5, 3.5])];
    const edge = (a: P2, b: P2, ops: Op[]) => {
      // Osa zdi o th/2 dovnitř (k těžišti), vnější strana podle polohy těžiště.
      const ux = b[0] - a[0], uz = b[1] - a[1], L = Math.hypot(ux, uz);
      const nx = -uz / L, nz = ux / L; // levá normála
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const towards = (cx - mx) * nx + (cz - mz) * nz > 0 ? 1 : -1; // levá normála míří dovnitř?
      const ix = nx * towards * th / 2, iz = nz * towards * th / 2;
      const out: 1 | -1 = towards > 0 ? -1 : 1;
      parts.push(...wallLine([a[0] + ix, a[1] + iz], [b[0] + ix, b[1] + iz], 0, h, th, ops, mat, out, { trim: 'woodDark', ext: th / 2 }));
    };
    edge(A, B, [door(4.4, { w: 1.1, t: 2.2, leaf: false }), smallWin(7.2)]);
    edge(B, C, [smallWin(3.5)]);
    edge(C, D, [smallWin(2.2), smallWin(6.4)]);
    edge(D, A, [smallWin(3.4)]);
    // Vnitřní dělení (rovné): dvě místnosti a úzký sklad vzadu.
    parts.push(...partition([0.9, -3.0], [0.9, 3.1], 0, h, [door(-1.2, { w: 1.0 })], mat).map((q) => ({ ...q, size: [0.3, q.size[1], q.size[2]] as [number, number, number] })));
    parts.push(...partition([1.05, 1.9], [4.2, 1.9], 0, h, [door(2.6, { w: 0.9 })], mat));
    // Střecha (deska po obálce), nízká atika po zdech, trámy.
    parts.push(...slab([-4.6, -3.7, 4.7, 3.7], h + 0.25, 0.25, [], mat), ...slab([-4.3, -3.4, 4.4, 3.4], h + 0.27, 0.02, [], 'dirt', false));
    for (const [a, b] of [[A, B], [B, C], [C, D], [D, A]] as const) parts.push(...wallLine(a, b, h + 0.25, 0.38, 0.3, [], mat, 1, { ext: 0.15 }));
    parts.push(...ladderParts(-2.6, 3.65, 0, 2.95, 'z-'));
    // Vstupní předprostor: nízké zídky 1,1 m.
    parts.push({ shape: 'box', pos: [-1.3, 0.55, -4.9], size: [0.4, 1.1, 1.6], material: mat, collide: true }, { shape: 'box', pos: [0.9, 0.55, -5.0], size: [0.4, 1.1, 1.6], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [-0.2, 0.03, -4.6], size: [2.6, 0.06, 2.0], material: 'paving', collide: true });
    parts.push(...mattress(-3.0, 1.6, 0.08), ...lowTable(-2.0, -1.4, 0.08), ...rug(-1.6, 0.6, 0.08, 2.2, 1.6), ...mattress(2.8, -1.4, 0.08, Math.PI / 2));
    parts.push(...pots(3.4, 2.7, 0.08, 4, seed), ...crate(1.8, 2.7, 0.08, 0.55));
    return parts;
  },
}, {
  target: [9, 7, 3],
  route: [
    { p: [-0.2, 0, -6.6], note: 'ulice' },
    { p: [-0.2, 0.06, -4.6], note: 'předprostor' },
    { p: [-0.1, 0.08, -2.0], note: 'první místnost' },
    { p: [0.9, 0.08, -1.2] },
    { p: [2.6, 0.08, -0.6], note: 'druhá místnost' },
    { p: [2.6, 0.08, 2.6], note: 'úzký sklad' },
    { p: [2.6, 0.08, -0.6] },
    { p: [0.9, 0.08, -1.2] },
    { p: [-0.1, 0.08, -2.0] },
    { p: [-0.2, 0.06, -4.6] },
    { p: [-0.2, 0, -6.4] },
    { p: [-5.8, 0, -6.4] },
    { p: [-5.8, 0, 5.0] },
    { p: [-2.6, 0, 4.4] },
    { p: [-2.6, 2.95, 2.2], ladder: true, note: 'střecha' },
  ],
  walkableRoof: true,
  view: [[-3.2, 1.5, -2.0], [3.0, 1.0, 2.4]],
  notes: ['Obvodové zdi vychýlené až o 0,3 m (natočené kvádry), podlahy rovné.'],
});

/** Zábradlí kolem otvoru schodiště v patře: všude kromě výstupu ramene B (přední hrana u xb). */
function holeRails(c: ReturnType<typeof coreLayout>): Part[] {
  const [x0, z0, x1, z1] = c.rect, y = S, e = 0.04;
  const exitX = Math.min(c.xa, c.xb) + 0.55 + 0.075; // konec ramene A u dělicí zdi
  return [
    ...rail([x0 + e, z1 - e], [x1 - e, z1 - e], y),
    ...rail([x0 + e, z0 + e], [x0 + e, z1 - e], y),
    ...rail([x1 - e, z0 + e], [x1 - e, z1 - e], y),
    ...rail([x0 + e, z0 + e], [exitX, z0 + e], y),
  ];
}

// ---------------------------------------------------------------------------
// A27 Vila s dvorem a terasou: obálka 16 × 14 m, dvoupodlažní křídlo (uzavřené), sloupové
// podloubí do dvora nesoucí širokou terasu, venkovní schody na terasu, dvůr se zdí a bránou.
// ---------------------------------------------------------------------------
reg(27, 'villaTerrace', 'Vila s dvorem a terasou', {
  describe: () => 'obálka 16 × 14 m, křídlo 2 podlaží (uzavřené), podloubí na 5 sloupech, terasa 14 × 2,3 m, schody',
  closed: { solids: [[-8, 0, 1, 8, 2 * S, 7]] },
  interior: true,
  generate(_p, seed, mat) {
    const Wg: Rect = [-8, 1, 8, 7];
    const parts: Part[] = [];
    // Interiér (s přepínačem): chodba u čela, schodišťové jádro uprostřed, dva pokoje v každém podlaží.
    const c = coreLayout(0, 2.6);
    parts.push(...groundFloor(Wg));
    for (let i = 0; i < 2; i++) {
      const y = i * S;
      parts.push(...shell(Wg, y, H, { front: i === 0 ? [win(-5.4), door(-3.0), win(-0.8), win(0.8), door(3.0), win(5.4)] : [win(-5.4), win(-3.0), door(0), win(3.0), win(5.4)], back: [win(-5), win(-1.6), win(1.6), win(5)], left: [win(4.0)], right: [win(4.0)] }, mat));
      for (const x of [-1.3, 1.3]) parts.push(...partition([x, 1.3], [x, 6.7], y, H, [door(1.95)], mat));
      const fy = i === 0 ? 0.08 : y;
      parts.push(...table(-6.0, 4.6, fy, 1.4, 0.8), ...chair(-6.0, 3.8, fy), ...chair(-6.0, 5.4, fy, Math.PI), ...shelf(-7.45, 3.0, fy, Math.PI / 2));
      if (i === 0) parts.push(...rug(4.5, 4.2, fy, 2.4, 1.6), ...table(4.5, 4.2, fy, 1.2, 0.7), ...shelf(7.45, 5.4, fy, -Math.PI / 2));
      else parts.push(...mattress(4.8, 5.6, fy), ...mattress(6.8, 3.0, fy, Math.PI / 2), ...rug(3.5, 4.0, fy, 1.8, 1.2));
    }
    parts.push(...coreFlights(c, 0.08, S - 0.08, 1.1, 'concreteLight', mat));
    parts.push(...roofSlab(Wg, H, [c.rect], 'concreteLight'), ...roofSlab(Wg, 2 * S - M.slab), ...parapet(Wg, 2 * S, 0.9, mat, TRIM));
    // Zábradlí kolem otvoru schodiště v patře (u výstupu volno).
    parts.push(...holeRails(c));
    // Podloubí: 5 sloupů, průvlak, terasa nahoře (+ díl u schodů).
    for (const x of [-6, -3, 0, 3, 6]) {
      parts.push({ shape: 'cylinder', pos: [x, (S - 0.25) / 2, -1.0], size: [0.42, S - 0.25, 0.42], material: 'plasterWhite', collide: true });
      parts.push({ shape: 'box', pos: [x, 0.12, -1.0], size: [0.56, 0.24, 0.56], material: TRIM }, { shape: 'box', pos: [x, S - 0.32, -1.0], size: [0.56, 0.14, 0.56], material: TRIM });
    }
    parts.push({ shape: 'box', pos: [0, S - 0.42, -1.0], size: [12.6, 0.36, 0.46], material: mat, collide: true });
    parts.push(...landing([-6.3, -1.3, 6.3, 1.0], S, 'concreteLight', false), ...landing([6.3, -0.7, 7.6, 1.0], S, 'concreteLight', false));
    parts.push({ shape: 'box', pos: [0.0, S + 0.5, -1.22], size: [12.6, 1.0, 0.16], material: 'plasterWhite', collide: true });
    parts.push({ shape: 'box', pos: [-6.22, S + 0.5, -0.15], size: [0.16, 1.0, 2.3], material: 'plasterWhite', collide: true });
    parts.push({ shape: 'box', pos: [7.52, S + 0.5, 0.15], size: [0.16, 1.0, 1.7], material: 'plasterWhite', collide: true });
    parts.push(...stairs(7.0, -6.1, 'z+', 1.1, 0, S, 'concreteLight', { solid: true }).parts);
    // Dvůr: zeď 2,2 m s bránou, dlažba, kašna, květináče.
    const wh = 2.2;
    parts.push(...W([-8, -6.85], [8, -6.85], 0, wh, [pass(0, 3.0, wh)], mat));
    for (const s of [-1, 1]) parts.push(...W([s * 7.85, -6.7], [s * 7.85, 1], 0, wh, [], mat));
    for (const x of [-1.7, 1.7]) parts.push({ shape: 'box', pos: [x, (wh + 0.4) / 2, -6.85], size: [0.5, wh + 0.4, 0.5], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [0, wh + 0.04, -6.85], size: [16, 0.08, 0.38], material: TRIM });
    parts.push({ shape: 'box', pos: [0, 0.03, -2.85], size: [15.4, 0.06, 7.7], material: 'plazaTile', collide: true });
    parts.push({ shape: 'cylinder', pos: [-3.0, 0.35, -4.2], size: [2.0, 0.6, 2.0], material: 'stoneWall', collide: true }, { shape: 'cylinder', pos: [-3.0, 0.62, -4.2], size: [1.7, 0.04, 1.7], material: 'water' });
    for (const [x, z] of [[-6.6, -5.6], [4.6, -5.6], [-6.6, -2.2]] as const) parts.push({ shape: 'box', pos: [x, 0.35, z], size: [0.9, 0.7, 0.9], material: 'concreteLight', collide: true });
    parts.push({ shape: 'box', pos: [3.0, 0.25, -4.0], size: [1.8, 0.5, 0.45], material: 'wood', collide: true });
    parts.push(...table(-3.6, 0.5, S, 1.4, 0.7), ...table(2.2, 0.5, S, 1.4, 0.7));
    parts.push(...bands(Wg, 0.35, S - 0.05, 'concreteDark', TRIM), ...acBox(-8, 4.0, 5.4, [-1, 0]), ...spout(6.0, 7, 2 * S + 0.1, [0, 1]));
    void seed;
    return parts;
  },
}, {
  target: [16, 14, 6.4],
  route: [
    { p: [0, 0, -8.5], note: 'ulice' },
    { p: [0, 0.06, -5.6], note: 'brána' },
    { p: [0, 0.06, -2.4], note: 'dvůr' },
    { p: [1.5, 0.06, 0.1], note: 'podloubí' },
    { p: [5.0, 0.06, -2.0] },
    { p: [7.0, 0.06, -6.4], note: 'pata schodů' },
    { p: [7.0, 3.2, 0.2], note: 'terasa' },
    { p: [5.8, 3.2, -0.6] },
    { p: [-4.5, 3.2, -0.6] },
    { p: [0, 3.2, -0.5], note: 'terasa u dveří patra' },
    { p: [0, 3.2, 1.9], note: 'chodba patra (interiér)' },
    { p: [-4.0, 3.2, 2.0] },
    { p: [-4.0, 3.2, 5.6], note: 'pokoj patra' },
    { p: [-0.5, 3.2, 1.95] },
    { p: [0.625, 3.2, 2.2], note: 'horní výstup schodů' },
    { p: [0.625, 1.64, 5.9], note: 'mezipodesta' },
    { p: [-0.625, 1.64, 5.9] },
    { p: [-0.625, 0.08, 2.1], note: 'přízemí – chodba' },
    { p: [3.0, 0.08, 1.95] },
    { p: [3.0, 0.08, 5.0], note: 'pokoj přízemí' },
    { p: [3.0, 0.08, 1.7] },
    { p: [3.0, 0, -0.6], note: 'ven do podloubí' },
  ],
  walkableRoof: false,
  view: [[-6.8, 1.7, -5.8], [4.0, 2.0, 0.0]],
  notes: ['Výchozí: uzavřené dvoupodlažní křídlo (BF2); dvůr, podloubí a terasa jsou přístupné.', 'Parametr „Přístupný interiér“: chodba, dvouramenné schodiště, 2 pokoje v každém podlaží, dveře z patra na terasu.'],
});

// ---------------------------------------------------------------------------
// A28 Vila s obvodovou zdí: pozemek 18 × 16 m, dům 11 × 10 m (2 podlaží, uzavřený), otevřená
// brána, boční pěší branka, ochozy kolem domu, žebřík na střechu.
// ---------------------------------------------------------------------------
reg(28, 'villaWalled', 'Vila s obvodovou zdí', {
  describe: () => 'pozemek 18 × 16 m, dům 11 × 10 m (2 podlaží, uzavřený), brána 3 m, boční branka, žebřík na střechu',
  closed: { solids: [[-5.5, 0, -3.5, 5.5, 2 * S, 6.5]] },
  interior: true,
  ladders: () => [ladderDef(-5.55, 0.0, 0, 2 * S, 'x+')],
  generate(_p, seed, mat) {
    const Hs: Rect = [-5.5, -3.5, 5.5, 6.5];
    const parts: Part[] = [];
    // Interiér (s přepínačem): hala za vchodem, jádro se schody, 2 přední pokoje, zadní pokoj přes celou šířku.
    const c = coreLayout(0, -1.9);
    parts.push(...groundFloor(Hs));
    for (let i = 0; i < 2; i++) {
      const y = i * S;
      parts.push(...shell(Hs, y, H, { front: i === 0 ? [win(-3.6), door(0), win(3.6)] : [win(-3.6), win(-1.2), win(1.2), win(3.6)], back: [win(-3), win(0), win(3)], left: [win(-1), win(3)], right: [win(-2.0, { w: 1.0 }), win(3)] }, mat));
      for (const x of [-1.3, 1.3]) parts.push(...partition([x, -3.2], [x, 2.0], y, H, [door(-2.5)], mat));
      parts.push(...partition([-5.2, 2.075], [5.2, 2.075], y, H, [door(-3.0), door(3.0)], mat));
      const fy = i === 0 ? 0.08 : y;
      parts.push(...table(-4.3, 0.4, fy, 1.4, 0.8), ...chair(-4.3, -0.4, fy), ...shelf(-5.05, -2.2, fy, -Math.PI / 2));
      if (i === 0) parts.push(...rug(0, 4.4, fy, 3.0, 1.8), ...table(0, 4.4, fy, 1.6, 0.8), ...chair(-1.2, 4.4, fy, Math.PI / 2), ...shelf(4.3, 0.9, fy, Math.PI / 2));
      else parts.push(...mattress(-3.6, 5.4, fy), ...mattress(3.6, 5.4, fy), ...mattress(3.8, 0.2, fy));
    }
    parts.push(...coreFlights(c, 0.08, S - 0.08, 1.1, 'concreteLight', mat));
    parts.push(...holeRails(c));
    parts.push(...roofSlab(Hs, H, [c.rect], 'concreteLight'), ...roofSlab(Hs, 2 * S - M.slab), ...parapet(Hs, 2 * S, M.parapet, mat, TRIM, { gaps: [{ side: 'right', from: -0.5, to: 0.5 }] }));
    parts.push(...ladderParts(-5.55, 0.0, 0, 2 * S, 'x+'));
    // Vstupní stříška a schod.
    parts.push({ shape: 'box', pos: [0, 2.62, -4.0], size: [2.4, 0.1, 1.1], material: 'concreteLight', collide: true });
    // Obvodová zeď 2,4 m: brána vpředu, branka vlevo.
    const wh = 2.4;
    parts.push(...W([-9, -7.85], [9, -7.85], 0, wh, [pass(0, 3.0, wh)], mat));
    parts.push(...W([-9, 7.85], [9, 7.85], 0, wh, [], mat));
    parts.push(...W([8.85, -7.7], [8.85, 7.7], 0, wh, [door(2.0, { leaf: false })], mat, [1, 0]));
    parts.push(...W([-8.85, -7.7], [-8.85, 7.7], 0, wh, [], mat));
    for (const x of [-1.75, 1.75]) parts.push({ shape: 'box', pos: [x, (wh + 0.4) / 2, -7.85], size: [0.5, wh + 0.4, 0.5], material: mat, collide: true });
    for (const [x, z, sx, sz] of [[0, -7.85, 18, 0.38], [0, 7.85, 18, 0.38], [8.85, 0, 0.38, 15.7], [-8.85, 0, 0.38, 15.7]] as const) parts.push({ shape: 'box', pos: [x, wh + 0.04, z], size: [sx, 0.08, sz], material: TRIM });
    // Kryty na pozemku: nízká zídka se záhonem, nádrž, bedny, auto stání se stříškou.
    parts.push({ shape: 'box', pos: [-4.0, 0.55, -6.0], size: [3.6, 1.1, 0.4], material: mat, collide: true }, { shape: 'box', pos: [4.2, 0.55, -5.6], size: [0.4, 1.1, 2.6], material: mat, collide: true });
    parts.push(...tank(-7.6, -6.6, 0, 1.2, 1.2, 1.3), ...crate(-6.3, -6.9, 0, 0.7), ...crate(-6.2, -6.2, 0, 0.55));
    for (const [x, z] of [[6.0, -6.8], [8.2, -6.8], [6.0, -3.6], [8.2, -3.6]] as const) parts.push({ shape: 'box', pos: [x, 1.25, z], size: [0.12, 2.5, 0.12], material: 'metal', collide: true });
    parts.push({ shape: 'box', pos: [7.1, 2.52, -5.2], size: [2.6, 0.05, 3.6], material: 'metalSheet' });
    parts.push({ shape: 'box', pos: [0, 0.02, -5.6], size: [3.2, 0.04, 4.4], material: 'paving' });
    parts.push(...bands(Hs, 0.35, S - 0.05, 'concreteDark', TRIM), ...acBox(5.5, 2.0, 5.4, [1, 0]), ...spout(-3.0, 6.5, 2 * S + 0.1, [0, 1]));
    void seed;
    return parts;
  },
}, {
  target: [18, 16, 6.4],
  route: [
    { p: [0, 0, -9.5], note: 'ulice' },
    { p: [0, 0.04, -6.5], note: 'brána' },
    { p: [0, 0.04, -5.0], note: 'předzahrádka' },
    { p: [-7.2, 0, -4.4] },
    { p: [-7.2, 0, -2.0], note: 'boční ochoz' },
    { p: [-7.2, 0, 7.1], note: 'zadní ochoz' },
    { p: [7.2, 0, 7.1] },
    { p: [7.6, 0, 2.0] },
    { p: [10.2, 0, 2.0], note: 'boční branka ven' },
    { p: [7.6, 0, 2.0] },
    { p: [7.2, 0, -2.0] },
    { p: [7.1, 0, -4.0] },
    { p: [-7.0, 0, -4.0] },
    { p: [-7.2, 0, -2.0] },
    { p: [-6.0, 0, 0.0], note: 'pod žebříkem' },
    { p: [-4.0, 6.4, 0.0], ladder: true, note: 'střecha' },
    { p: [0, 0.04, -5.0], teleport: true, note: 'před vchodem' },
    { p: [0, 0.08, -2.6], note: 'hala (interiér)' },
    { p: [-3.3, 0.08, -2.5] },
    { p: [-3.0, 0.08, 1.4], note: 'levý pokoj' },
    { p: [-3.0, 0.08, 3.6], note: 'zadní pokoj' },
    { p: [3.0, 0.08, 3.6] },
    { p: [3.0, 0.08, 1.4], note: 'pravý pokoj' },
    { p: [3.0, 0.08, -2.5] },
    { p: [-0.625, 0.08, -2.5] },
    { p: [-0.625, 1.64, 1.5], note: 'mezipodesta' },
    { p: [0.625, 1.64, 1.5] },
    { p: [0.625, 3.2, -2.5], note: 'patro – hala' },
    { p: [-3.3, 3.2, -2.5] },
    { p: [-3.0, 3.2, 3.6], note: 'zadní pokoj patra' },
  ],
  walkableRoof: true,
  view: [[-8.0, 1.8, -7.0], [2.0, 2.0, 0.0]],
  notes: ['Výchozí: uzavřený dům (BF2); ochozy 3,2 m po stranách a 1,2 m vzadu, kryty na pozemku.', 'Parametr „Přístupný interiér“: hala, dvouramenné schodiště, 3 pokoje v každém podlaží.'],
});

// ---------------------------------------------------------------------------
// A29 Poškozený dvoupodlažní dům: 8 × 7 m, chybí přední levý roh patra (odkrytá deska
// s armaturou), velké úlomky; po hromadě suti se dá vylézt na odkrytou desku patra.
// ---------------------------------------------------------------------------
const A29_D: B6 = [1.0, S, -3.5, 4, 2 * S + 0.5, -0.5];
reg(29, 'damaged2', 'Poškozený dvoupodlažní dům', {
  describe: () => '8 × 7 m, 2 podlaží (uzavřený), zřícený roh patra, odkrytá deska, výstup po suti',
  closed: { solids: [[-4, 0, -3.5, 4, 2 * S, 3.5]], holes: [A29_D] },
  generate(_p, seed, mat) {
    const R: Rect = [-4, -3.5, 4, 3.5];
    const parts: Part[] = [];
    const zf = -3.5 + t / 2;
    // Přízemí celé.
    parts.push(...shell(R, 0, H, { front: [win(-2.6), door(-0.4), win(2.6)], back: [win(-2.4), win(2.0)], left: [win(-1.6), win(1.6)], right: [win(0)] }, mat));
    // Patro bez předního levého rohu (x 1–4, z −3,5 … −0,5).
    parts.push(...W([-4, zf], [1.0, zf], S, H, [win(-2.6), win(-0.6, { w: 1.0 })], mat, [0, -1]));
    parts.push(...W([4 - t / 2, -0.5], [4 - t / 2, 3.2], S, H, [win(1.6)], mat, [1, 0]));
    parts.push(...W([-4, 3.5 - t / 2], [4, 3.5 - t / 2], S, H, [win(-2.4), win(2.0)], mat, [0, 1]));
    parts.push(...W([-4 + t / 2, -3.2], [-4 + t / 2, 3.2], S, H, [win(0)], mat, [-1, 0]));
    // Vnitřní plochy odkrytého rohu (stěny zbylé části, zavřené dveře) a podlaha patra.
    parts.push(...roomFaces([1.0, S, -3.5, 4, S + H, -0.5], ['x1', 'z0', 'top'], 'plasterWhite'));
    parts.push({ shape: 'box', pos: [1.08, S + 1.1, -2.0], size: [0.04, 2.1, 1.0], material: 'woodDark' });
    parts.push(...roofSlab(R, H, [], 'concreteLight'));
    // Pahýly zdí na odkryté hraně (nízký kryt) a armatura.
    const r = rng(seed);
    // Pahýly jen po krajích – uprostřed hrany je volno (sem dosedá hromada suti).
    for (const x of [1.25, 3.75]) {
      const h = 0.5 + r() * 0.8;
      parts.push({ shape: 'box', pos: [x, S + h / 2, zf], size: [0.45, h, t], material: mat, collide: true });
    }
    for (let i = 0; i < 3; i++) {
      const h = 0.3 + r() * 1.2, z = -3.1 + i * 0.9;
      parts.push({ shape: 'box', pos: [4 - t / 2, S + h / 2, z], size: [t, h, 0.85], material: mat, collide: true });
    }
    parts.push(...rebar([1.0, -3.5], [4.0, -3.5], S, [0, -1], 7, seed), ...rebar([4.0, -3.5], [4.0, -0.5], S, [1, 0], 5, seed + 1));
    // Střecha jen nad zbylou částí, se zubatou hranou.
    parts.push(...slab([-4.05, -3.55, 1.0, 3.55], 2 * S, M.slab, [], 'concreteLight'), ...slab([1.0, -0.5, 4.05, 3.55], 2 * S, M.slab, [], 'concreteLight'));
    for (let i = 0; i < 4; i++) parts.push({ shape: 'box', pos: [1.0 + r() * 0.3, 2 * S - 0.1, -3.2 + i * 0.75], rot: [0, 0, (r() - 0.5) * 0.4], size: [0.5, 0.2, 0.7], material: 'concreteLight' });
    parts.push(...parapet([-4, -3.5, 1.0, 3.5], 2 * S, M.parapet, mat, TRIM, { skip: ['left'] }), ...parapet([1.0, -0.5, 4, 3.5], 2 * S, M.parapet, mat, TRIM, { skip: ['right', 'front'] }));
    // Hromada suti: rampa na odkrytou desku (sklon ~36°) + velké kusy.
    parts.push({ shape: 'wedge', pos: [2.5, S / 2, -5.65], size: [2.6, S, 4.3], material: 'concreteLight', collide: true, render: false });
    for (let i = 0; i < 9; i++) {
      const f = i / 8;
      const s = 0.8 + r() * 0.7;
      parts.push({ shape: 'box', pos: [1.6 + r() * 1.8, f * S * 0.92 - s * 0.1, -7.6 + f * 4.0], rot: [-0.6 + (r() - 0.5) * 0.6, (r() - 0.5) * 1.2, (r() - 0.5) * 0.6], size: [s * 1.5, s * (0.3 + r() * 0.3), s * (0.9 + r() * 0.4)], material: r() < 0.65 ? 'concreteLight' : 'brick' });
    }
    parts.push({ shape: 'box', pos: [3.9, 1.0, -5.4], rot: [0.5, 0.3, 0.2], size: [1.6, 0.2, 1.4], material: 'concreteLight' });
    parts.push(...debris(-2.5, -4.6, 0, 4, 2.0, seed + 5), ...debris(5.0, -2.5, 0, 3, 1.5, seed + 6));
    parts.push(...bands(R, 0.35, null, 'concreteDark', TRIM));
    return parts;
  },
}, {
  target: [8, 7, 6.4],
  route: [
    { p: [2.5, 0, -9.5], note: 'ulice' },
    { p: [2.5, 0, -8.4], note: 'pata suti' },
    { p: [2.5, 3.2, -2.4], note: 'odkrytá deska patra' },
    { p: [1.6, 3.2, -1.2] },
  ],
  walkableRoof: false,
  view: [[5.5, 4.6, -6.0], [1.6, 3.4, -1.0]],
  notes: ['Uzavřená budova (BF2) s otevřeným zřiceným rohem patra; výstup po suti (rampa 36°), pahýly zdí jako nízký kryt.'],
});

// ---------------------------------------------------------------------------
// A30 Poškozený třípodlažní činžák: 12 × 8 m, průraz v přízemí 1,6 × 2,4 m do vybydlené
// místnosti, zřícený horní roh fasády, utržený balkon.
// ---------------------------------------------------------------------------
const A30_G: B6 = [-4.8, 0, -4, -1.2, 3.0, -0.8];
const A30_U: B6 = [3.0, 2 * S, -4, 6, 3 * S + 0.5, -1.5];
reg(30, 'damaged3', 'Poškozený třípodlažní činžák', {
  describe: () => '12 × 8 m, 3 podlaží (uzavřený), průraz 1,6 × 2,4 m do vybydlené místnosti, zřícený horní roh, utržený balkon',
  closed: { solids: [[-6, 0, -4, 6, 3 * S, 4]], holes: [A30_G, A30_U] },
  generate(_p, seed, mat) {
    const R: Rect = [-6, -4, 6, 4];
    const parts: Part[] = [];
    const zf = -4 + t / 2;
    const r = rng(seed);
    // Přízemí: dveře, okna, průraz.
    parts.push(...W([-6, zf], [6, zf], 0, H, [{ c: -3.0, w: 1.6, b: 0, t: 2.4, kind: 'pass', bare: true }, door(0), win(3.0), win(5.0, { w: 0.9 })], mat, [0, -1]));
    for (let i = 0; i < 5; i++) parts.push({ shape: 'box', pos: [-3.0 + (r() - 0.5) * 1.9, 2.4 + r() * 0.25, zf + (r() - 0.5) * 0.1], rot: [0, 0, (r() - 0.5) * 0.6], size: [0.4 + r() * 0.3, 0.25, t + 0.04], material: 'brick' });
    // Patra 2 a 3 (ve 3. chybí pravý přední roh).
    parts.push(...W([-6, zf], [6, zf], S, H, [win(-4.5), win(-1.5), win(1.5), win(4.5)], mat, [0, -1]));
    parts.push(...W([-6, zf], [3.0, zf], 2 * S, H, [win(-4.5), win(-1.5), win(1.5, { w: 1.0 })], mat, [0, -1]));
    for (let i = 0; i < 3; i++) {
      const y = i * S;
      parts.push(...W([-6, 4 - t / 2], [6, 4 - t / 2], y, H, [win(-3.5), win(0), win(3.5)], mat, [0, 1]));
      parts.push(...W([-6 + t / 2, -3.7], [-6 + t / 2, 3.7], y, H, [win(-1.8), win(1.8)], mat, [-1, 0]));
      parts.push(...W([6 - t / 2, i === 2 ? -1.5 : -3.7], [6 - t / 2, 3.7], y, H, i === 2 ? [win(1.8)] : [win(-1.8), win(1.8)], mat, [1, 0]));
    }
    // Vybydlená místnost za průrazem (vnitřní plochy, suť uvnitř).
    parts.push(...roomFaces(A30_G, ['z0'], 'plasterWhite'));
    parts.push(...debris(-3.6, -2.0, 0.08, 4, 2.0, seed + 2, 0.5), ...crate(-2.0, -1.4, 0.08, 0.6));
    parts.push({ shape: 'box', pos: [-4.2, 0.4, -1.4], rot: [0, 0.4, 1.2], size: [1.4, 0.06, 0.7], material: 'woodDark' });
    // Zřícený horní roh: vnitřní plochy, pahýly, armatura, chybějící kus střechy a atiky.
    parts.push(...roomFaces([3.0, 2 * S, -4, 6, 2 * S + H, -1.5], ['x1', 'z0', 'top'], 'plasterWhite'));
    for (let i = 0; i < 3; i++) {
      const h = 0.4 + r() * 1.0;
      parts.push({ shape: 'box', pos: [3.4 + i * 0.9, 2 * S + h / 2, zf], size: [0.8, h, t], material: mat, collide: true });
    }
    parts.push({ shape: 'box', pos: [6 - t / 2, 2 * S + 0.5, -2.8], size: [t, 1.0, 2.4], material: mat, collide: true });
    parts.push(...rebar([3.0, -4.0], [6.0, -4.0], 2 * S, [0, -1], 7, seed + 3));
    parts.push(...slab([-6.05, -4.05, 6.05, 4.05], S, M.slab, [], 'concreteLight'), ...slab([-6.05, -4.05, 6.05, 4.05], 2 * S, M.slab, [], 'concreteLight'));
    parts.push(...slab([-6.05, -4.05, 3.0, 4.05], 3 * S, M.slab, [], 'concreteLight'), ...slab([3.0, -1.5, 6.05, 4.05], 3 * S, M.slab, [], 'concreteLight'));
    parts.push(...slab([-5.9, -3.9, 3.0, 3.9], 3 * S + 0.012, 0.012, [], 'roof', false));
    parts.push(...parapet([-6, -4, 3.0, 4], 3 * S, M.parapet, mat, TRIM, { skip: ['left'] }), ...parapet([3.0, -1.5, 6, 4], 3 * S, M.parapet, mat, TRIM, { skip: ['right', 'front'] }));
    parts.push(...debris(4.6, -5.8, 0, 6, 2.6, seed + 4, 0.8));
    // Utržený balkon (2. podlaží): deska visí šikmo, zábradlí ohnuté.
    parts.push({ shape: 'box', pos: [-1.5, S - 0.45, -4.55], rot: [0.55, 0.05, 0.08], size: [2.2, 0.18, 1.1], material: 'concreteLight', collide: true });
    parts.push({ shape: 'box', pos: [-1.5, S - 0.05, -5.15], rot: [-0.4, 0.1, 0.25], size: [2.1, 0.05, 0.05], material: 'paintedMetal' });
    for (let i = 0; i < 3; i++) parts.push({ shape: 'box', pos: [-2.4 + i * 0.9, S - 0.4, -5.05], rot: [0.5 + r() * 0.4, 0, (r() - 0.5) * 0.5], size: [0.04, 0.9, 0.04], material: 'paintedMetal' });
    parts.push(...bands(R, 0, S - 0.05, 'concreteDark', TRIM), ...acBox(-6, 2.0, 5.4, [-1, 0]), ...tank(-3.0, 2.0, 3 * S, 0.6, 1.1, 1.2));
    return parts;
  },
}, {
  target: [12, 8, 9.6],
  route: [
    { p: [-3.0, 0, -6.0], note: 'ulice' },
    { p: [-3.0, 0, -3.4], note: 'průraz' },
    { p: [-3.0, 0, -2.2], note: 'vybydlená místnost' },
  ],
  walkableRoof: false,
  view: [[-1.6, 1.6, -1.2], [-3.4, 1.4, -5.0]],
  notes: ['Uzavřená budova (BF2); průraz 1,6 × 2,4 m vede do otevřené místnosti, zřícený horní roh, utržený balkon.'],
});

void table;
void shelf;
