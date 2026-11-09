import type { Part } from '../../parts';
import {
  M, acBox, bands, chair, coreFlights, coreLayout, crate, door, ladderDef, ladderParts, landing, mattress, parapet, pass, rail, rug, shelf, spout, stairHouse, stairs, table, tank, wall, win,
  type Core, type Op, type P2, type Rect,
} from './bk';
import { FLOOR, TRIM, groundFloor, hatch, partition, reg, roofSlab, shell, wellRail } from './residential';

/**
 * Sada 300 · A obytné budovy, položky 11–20: domy se dvory a činžáky (dvouramenné schodiště
 * přes všechna podlaží až do střešní nástavby), průjezdy, rohové domy.
 */
const t = M.wall;
const S = M.storey;
const H = S - M.slab;

/** Stěna s otvory v absolutní souřadnici osy (a < b). `out` = vnější strana (lišty, parapety). */
function W(a: P2, b: P2, y0: number, h: number, ops: Op[], mat: string, out?: P2, thick = t): Part[] {
  const alongX = Math.abs(b[1] - a[1]) < 1e-6;
  const start = alongX ? a[0] : a[1];
  return wall(a, b, y0, h, thick, ops.map((o) => ({ ...o, c: o.c - start })), mat, out ? { out, trim: TRIM } : { plain: true });
}

/** Otevřená křídla brány (plech na rámu) přiklopená kolmo dovnitř u pilířů. */
function gateLeaves(x0: number, x1: number, zWall: number, inward: 1 | -1, mat = 'paintedMetalBlue'): Part[] {
  const lw = (x1 - x0) / 2;
  return [x0 + 0.05, x1 - 0.05].map((x) => ({ shape: 'box' as const, pos: [x, 1.0, zWall + inward * (lw / 2 + 0.15)] as [number, number, number], size: [0.05, 1.9, lw - 0.05] as [number, number, number], material: mat, collide: true }));
}

/** Sušák s prádlem mezi dvěma sloupky (vzhled, sloupky kolidují). */
function clothesLine(a: P2, b: P2): Part[] {
  const parts: Part[] = [];
  for (const p of [a, b]) parts.push({ shape: 'box', pos: [p[0], 0.95, p[1]], size: [0.06, 1.9, 0.06], material: 'metal', collide: true });
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  parts.push({ shape: 'box', pos: [(a[0] + b[0]) / 2, 1.82, (a[1] + b[1]) / 2], rot: [0, yaw, 0], size: [0.01, 0.01, len], material: 'metal' });
  const cloth = ['fabricSand', 'awningBlue', 'awningSand', 'awningGreen'];
  for (let i = 0; i < 4; i++) {
    const f = (i + 0.7) / 4.4;
    parts.push({ shape: 'box', pos: [a[0] + (b[0] - a[0]) * f, 1.45, a[1] + (b[1] - a[1]) * f], rot: [0, yaw, 0], size: [0.02, 0.7, 0.55], material: cloth[i], castShadow: true });
  }
  return parts;
}

/** Kovový balkon: deska, zábradlí na třech stranách (přiléhá ke zdi bez mezery). */
function balcony(r: Rect, y: number, solid: boolean, mat: string): Part[] {
  const [x0, z0, x1, z1] = r;
  const parts: Part[] = [...landing(r, y, 'concreteLight', false)];
  // Strana u zdi = ta, která leží na líci fasády (detekce podle hloubky).
  const front = z1 - z0 < x1 - x0; // balkon na čele/zádech (hloubka v z)
  if (solid) {
    if (front) {
      const zf = Math.abs(z0) > Math.abs(z1) ? z0 : z1;
      parts.push({ shape: 'box', pos: [(x0 + x1) / 2, y + 0.5, zf + (zf === z0 ? 0.08 : -0.08)], size: [x1 - x0, 1.0, 0.16], material: mat, collide: true });
      for (const x of [x0 + 0.08, x1 - 0.08]) parts.push({ shape: 'box', pos: [x, y + 0.5, (z0 + z1) / 2], size: [0.16, 1.0, z1 - z0], material: mat, collide: true });
    } else {
      const xf = Math.abs(x0) > Math.abs(x1) ? x0 : x1;
      parts.push({ shape: 'box', pos: [xf + (xf === x0 ? 0.08 : -0.08), y + 0.5, (z0 + z1) / 2], size: [0.16, 1.0, z1 - z0], material: mat, collide: true });
      for (const z of [z0 + 0.08, z1 - 0.08]) parts.push({ shape: 'box', pos: [(x0 + x1) / 2, y + 0.5, z], size: [x1 - x0, 1.0, 0.16], material: mat, collide: true });
    }
  } else if (front) {
    const zf = Math.abs(z0) > Math.abs(z1) ? z0 : z1;
    parts.push(...rail([x0, zf], [x1, zf], y), ...rail([x0, z0], [x0, z1], y), ...rail([x1, z0], [x1, z1], y));
  } else {
    const xf = Math.abs(x0) > Math.abs(x1) ? x0 : x1;
    parts.push(...rail([xf, z0], [xf, z1], y), ...rail([x0, z0], [x1, z0], y), ...rail([x0, z1], [x1, z1], y));
  }
  return parts;
}

/** Zábradlí přes část hrany otvoru schodiště (horní podlaží bez dalšího ramene A). */
const edgeRail = (x0: number, x1: number, z: number, y: number) => rail([x0, z], [x1, z], y);

// ---------------------------------------------------------------------------
// A11 Dům s protáhlým dvorem: obálka 8 × 15 m, dům podél pravé dlouhé strany, dvůr 3,2 m
// podél něj, brána na krátké přední straně, zadní pěší východ, žebřík ze dvora na střechu.
// ---------------------------------------------------------------------------
reg(11, 'houseLongYard', 'Dům s protáhlým dvorem', {
  describe: () => 'obálka 8 × 15 m, dům 4,5 × 15 m, dvůr 3,2 m, brána 2,6 m, zadní branka',
  ladders: () => [ladderDef(0.55, 0.5, 0, S, 'x-')],
  generate(_p, _seed, mat) {
    const Hr: Rect = [-4, -7.5, 0.5, 7.5];
    const parts: Part[] = [];
    parts.push(...groundFloor(Hr));
    parts.push(...shell(Hr, 0, H, { front: [win(-1.75)], back: [win(-1.75)], left: [win(-5.5), door(-3.0), win(0.5, { w: 1.0 }), door(3.5), win(5.6)], right: [win(-4.0), win(3.0)] }, mat));
    parts.push(...partition([-3.7, -1.0], [0.2, -1.0], 0, H, [door(-1.75, { w: 1.0 })], mat));
    parts.push(...partition([-3.7, 2.0], [0.2, 2.0], 0, H, [door(-1.75, { w: 1.0 })], mat));
    parts.push(...roofSlab(Hr, H));
    parts.push(...parapet(Hr, S, M.parapet, mat, TRIM, { gaps: [{ side: 'left', from: 0.0, to: 1.0 }] }));
    parts.push(...ladderParts(0.55, 0.5, 0, S, 'x-'));
    // Dvůr: zeď 2,2 m, brána na přední krátké straně, zadní pěší branka.
    const wh = 2.2;
    parts.push(...W([3.85, -7.5], [3.85, 7.5], 0, wh, [], mat, undefined, 0.3));
    parts.push(...W([0.5, -7.35], [4.0, -7.35], 0, wh, [pass(2.05, 2.6, wh)], mat, undefined, 0.3));
    parts.push(...W([0.5, 7.35], [4.0, 7.35], 0, wh, [door(2.15, { leaf: false })], mat, [0, 1], 0.3));
    for (const x of [0.62, 3.48]) parts.push({ shape: 'box', pos: [x, (wh + 0.3) / 2, -7.35], size: [0.4, wh + 0.3, 0.4], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [3.85, wh + 0.04, 0], size: [0.38, 0.08, 15], material: TRIM });
    parts.push(...gateLeaves(0.85, 3.25, -7.35, 1));
    parts.push({ shape: 'box', pos: [2.25, 0.03, 0], size: [3.2, 0.06, 14.4], material: 'paving', collide: true });
    parts.push(...tank(3.0, 5.6, 0.06, 1.0, 1.0, 1.1), ...clothesLine([1.2, -4.6], [3.2, -2.4]));
    parts.push({ shape: 'box', pos: [3.4, 0.25, -0.8], size: [0.45, 0.5, 1.6], material: 'wood', collide: true });
    parts.push(...crate(3.3, 2.6, 0.06, 0.6), ...crate(3.35, 3.2, 0.06, 0.5));
    parts.push(...bands(Hr, 0.35, null, 'concreteDark', TRIM));
    parts.push(...acBox(-4.0, -5.6, 2.3, [-1, 0]), ...spout(-1.0, 7.5, S + 0.1, [0, 1]));
    parts.push(...table(-2.4, -4.5, 0.08), ...chair(-2.4, -3.85, 0.08, Math.PI), ...shelf(-3.45, -6.2, 0.08, Math.PI / 2, 1.0));
    parts.push(...rug(-1.8, 0.5, 0.08, 2.2, 1.6), ...mattress(-2.8, 5.2, 0.08), ...mattress(-1.6, 5.2, 0.08));
    return parts;
  },
}, {
  target: [8, 15, 3.2],
  route: [
    { p: [2.05, 0, -9.0], note: 'ulice' },
    { p: [2.05, 0.06, -6.0], note: 'brána' },
    { p: [2.05, 0.06, -3.0], note: 'dvůr' },
    { p: [-1.8, 0.08, -3.0], note: 'přední pokoj' },
    { p: [-1.75, 0.08, 0.5], note: 'střední místnost' },
    { p: [-1.75, 0.08, 4.5], note: 'zadní pokoj' },
    { p: [-1.0, 0.08, 3.5] },
    { p: [2.1, 0.06, 3.5], note: 'zpět do dvora' },
    { p: [2.15, 0.06, 6.6] },
    { p: [2.15, 0, 8.8], note: 'zadní branka ven' },
    { p: [2.15, 0.06, 6.6] },
    { p: [1.4, 0.06, 0.5], note: 'pod žebříkem' },
    { p: [-0.9, 3.2, 0.5], ladder: true, note: 'střecha' },
    { p: [-1.8, 3.2, -5.0] },
  ],
  walkableRoof: true,
  view: [[2.3, 1.7, -6.8], [2.0, 1.2, 5.0]],
  notes: ['Dvůr 3,2 m široký podél celého domu; brána 2,6 m, zadní branka 1,2 m.'],
});

// ---------------------------------------------------------------------------
// A12 Dům ve tvaru L se dvorem: obálka 12 × 12 m, zadní dvoupodlažní křídlo s terasou
// do dvora (na sloupech), boční přízemní křídlo s pochozí střechou (vstup z patra), dvůr
// uzavřený zdí s bránou.
// ---------------------------------------------------------------------------
reg(12, 'houseLYard', 'Dům ve tvaru L se dvorem', {
  describe: () => 'obálka 12 × 12 m, dvůr 8 × 8 m, zadní křídlo 2 podlaží s terasou, boční křídlo s pochozí střechou',
  ladders: () => [ladderDef(1.0, 1.95, S, S, 'z+')],
  generate(_p, _seed, mat) {
    const A: Rect = [-6, 2, 6, 6];
    const B: Rect = [-6, -6, -2, 2];
    const parts: Part[] = [];
    parts.push(...groundFloor(A), ...groundFloor(B));
    // Křídlo A – přízemí (čelo do dvora i do křídla B).
    parts.push(...shell(A, 0, H, { front: [door(-4.0, { leaf: false }), win(0.0), door(2.2), win(4.4)], back: [win(-4.0), win(-0.4), win(3.6)], left: [win(4.0)], right: [win(4.0)] }, mat));
    parts.push(...partition([-1.0, 2.3], [-1.0, 5.7], 0, H, [door(3.6, { w: 1.0 })], mat));
    // Schodiště v křídle A podél zadní stěny (nahoru k −X).
    const st = stairs(5.4, 5.1, 'x-', 1.1, 0.08, S, 'concreteLight', { railSide: ['left'] });
    parts.push(...st.parts);
    const xTop = 5.4 - st.run;
    const well: Rect = [xTop - 0.05, 4.5, 4.0, 5.7];
    // Křídlo B (bez zadní stěny – sdílí čelo křídla A).
    parts.push(...shell(B, 0, H, { front: [win(-4.0)], left: [door(-2.0), win(0.4, { w: 1.0 })], right: [win(-3.6), win(-0.2)] }, mat, ['back']));
    parts.push(...roofSlab(A, H, [well], FLOOR), ...roofSlab(B, H));
    // Křídlo A – patro: dveře na terasu a na střechu křídla B.
    parts.push(...shell(A, S, H, { front: [door(-4.0), win(-0.4), door(3.0)], back: [win(-3.6), win(0.0), win(3.0)], left: [win(4.0)], right: [win(4.0)] }, mat));
    parts.push(...partition([-1.0, 2.3], [-1.0, 5.7], S, H, [door(3.6, { w: 1.0 })], mat));
    parts.push(...wellRail(well, S, 'x-'));
    parts.push(...roofSlab(A, S + H));
    parts.push(...parapet(A, 2 * S, M.parapet, mat, TRIM, { gaps: [{ side: 'front', from: 0.5, to: 1.5 }] }));
    parts.push(...parapet(B, S, M.parapet, mat, TRIM, { skip: ['back'] }));
    // Terasa do dvora na dvou sloupech, zděné zábradlí, žebřík na horní střechu.
    const tz0 = 0.2;
    parts.push(...landing([0, tz0, 6, 2], S, 'concreteLight', false));
    parts.push({ shape: 'box', pos: [3.0, S + 0.5, tz0 + 0.08], size: [6, 1.0, 0.16], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [0.08, S + 0.5, (tz0 + 2) / 2], size: [0.16, 1.0, 2 - tz0], material: mat, collide: true });
    for (const x of [0.25, 5.55]) parts.push({ shape: 'box', pos: [x, (S - 0.2) / 2, tz0 + 0.25], size: [0.4, S - 0.2, 0.4], material: mat, collide: true });
    parts.push(...ladderParts(1.0, 1.95, S, S, 'z+'));
    // Dvůr: zeď 2,2 m s bránou 3 m, levá zeď.
    const wh = 2.2;
    parts.push(...W([-2, -5.85], [6, -5.85], 0, wh, [pass(2.0, 3.0, wh)], mat));
    parts.push(...W([5.85, -5.7], [5.85, 2], 0, wh, [], mat));
    for (const x of [0.3, 3.7]) parts.push({ shape: 'box', pos: [x, (wh + 0.3) / 2, -5.85], size: [0.45, wh + 0.3, 0.45], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [2.0, wh + 0.04, -5.85], size: [8.0, 0.08, 0.38], material: TRIM }, { shape: 'box', pos: [5.85, wh + 0.04, -1.85], size: [0.38, 0.08, 7.7], material: TRIM });
    parts.push(...gateLeaves(0.55, 3.45, -5.85, 1));
    parts.push({ shape: 'box', pos: [2.0, 0.03, -1.9], size: [7.7, 0.06, 7.8], material: 'paving', collide: true });
    parts.push(...tank(4.8, -4.6, 0.06, 1.1, 1.1, 1.2), ...clothesLine([-1.2, -1.2], [-1.2, 1.4]));
    parts.push({ shape: 'box', pos: [4.9, 0.25, -1.4], size: [0.45, 0.5, 1.6], material: 'wood', collide: true });
    parts.push(...table(4.9, 1.1, S, 1.0, 0.6));
    parts.push(...bands(A, 0.35, S - 0.05, 'concreteDark', TRIM), ...bands(B, 0.35, null, 'concreteDark', TRIM));
    parts.push(...acBox(-6, 4.0, 5.4, [-1, 0]), ...spout(-4.0, -6, S + 0.1, [0, -1]));
    parts.push(...table(-3.4, 4.95, 0.08), ...rug(1.6, 3.4, 0.08, 2.0, 1.4), ...mattress(-4.6, -3.6, 0.08), ...shelf(-2.5, -5.4, 0.08, Math.PI, 1.0));
    parts.push(...mattress(-3.6, 4.4, S, Math.PI / 2), ...shelf(-5.55, 3.2, S, Math.PI / 2, 1.0));
    return parts;
  },
}, {
  target: [12, 12, 6.4],
  route: [
    { p: [2.0, 0, -7.5], note: 'ulice' },
    { p: [2.0, 0.06, -4.6], note: 'brána' },
    { p: [2.0, 0.06, -1.0], note: 'dvůr' },
    { p: [2.2, 0.08, 3.4], note: 'křídlo A' },
    { p: [0.5, 0.08, 3.6] },
    { p: [-4.0, 0.08, 3.6] },
    { p: [-4.0, 0.08, 0.5], note: 'křídlo B' },
    { p: [-3.2, 0.08, -2.0] },
    { p: [-1.0, 0.06, -2.0], note: 'dvůr' },
    { p: [2.2, 0.06, 1.0] },
    { p: [2.2, 0.08, 3.4] },
    { p: [4.9, 0.08, 3.8] },
    { p: [4.9, 0.08, 5.1], note: 'pata schodů' },
    { p: [-0.1, 3.2, 5.1], note: 'patro' },
    { p: [0.5, 3.2, 3.4] },
    { p: [3.0, 3.2, 3.2] },
    { p: [3.0, 3.2, 1.0], note: 'terasa' },
    { p: [1.0, 6.4, 3.4], ladder: true, note: 'horní střecha' },
    { p: [-1.0, 6.4, 4.0] },
    { p: [-4.0, 3.2, 3.6], teleport: true },
    { p: [-4.0, 3.2, 0.0], note: 'střecha křídla B' },
  ],
  walkableRoof: true,
  view: [[-5.2, 1.7, 2.8], [4.5, 1.4, 5.0]],
  notes: ['Terasa 6 × 1,8 m na dvou sloupech; střecha křídla B pochozí z patra.'],
});

// ---------------------------------------------------------------------------
// A13 Dům s centrálním dvorem: obálka 14 × 12 m, dvůr 6 × 5 m, kolem něj krytá chodba
// na sloupech, pokoje po stranách, přední brána s předsíní a zadní průchod (dvě cesty).
// ---------------------------------------------------------------------------
reg(13, 'houseAtrium', 'Dům s centrálním dvorem', {
  describe: () => 'obálka 14 × 12 m, dvůr 6 × 5 m, krytá chodba kolem dvora, přední brána + zadní průchod',
  ladders: () => [ladderDef(2.0, 2.45, 0, S, 'z+')],
  generate(_p, _seed, mat) {
    const R: Rect = [-7, -6, 7, 6];
    const C: Rect = [-3, -2.5, 3, 2.5];
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    parts.push(...shell(R, 0, H, { front: [win(-5.2), { ...pass(0, 2.4, 2.8), bare: false, kind: 'door' }, win(5.2)], back: [win(-5.2), door(0), win(5.2)], left: [win(-1.75, { w: 1.0 }), win(1.75, { w: 1.0 })], right: [win(-1.75, { w: 1.0 }), win(1.75, { w: 1.0 })] }, mat));
    for (const sx of [-1, 1]) {
      // Boční křídlo: stěna do chodby s dveřmi, příčka mezi pokoji.
      parts.push(...partition([sx * 4.0, -3.5], [sx * 4.0, 3.5], 0, H, [door(-1.75, { w: 1.0 }), door(1.75, { w: 1.0 })], mat));
      parts.push(...partition([Math.min(sx * 4.075, sx * 6.7), 0], [Math.max(sx * 4.075, sx * 6.7), 0], 0, H, [], mat));
      // Přední pokoj (vedle předsíně) a zadní pokoj (vedle průchodu).
      parts.push(...partition([Math.min(sx * 1.5, sx * 6.7), -3.5], [Math.max(sx * 1.5, sx * 6.7), -3.5], 0, H, [door(sx * 2.75, { w: 1.0 })], mat));
      parts.push(...partition([sx * 1.5, -5.7], [sx * 1.5, -3.5], 0, H, [], mat));
      parts.push(...partition([Math.min(sx * 0.75, sx * 6.7), 3.5], [Math.max(sx * 0.75, sx * 6.7), 3.5], 0, H, [door(sx * 2.4, { w: 1.0 })], mat));
      parts.push(...partition([sx * 0.75, 3.5], [sx * 0.75, 5.7], 0, H, [], mat));
    }
    // Sloupy kolem dvora.
    for (const [x, z] of [[-3, -2.5], [-1.5, -2.5], [1.5, -2.5], [3, -2.5], [-3, 0], [3, 0], [-3, 2.5], [-1.5, 2.5], [1.5, 2.5], [3, 2.5]] as const) {
      parts.push({ shape: 'box', pos: [x, H / 2, z], size: [0.36, H, 0.36], material: mat, collide: true });
      parts.push({ shape: 'box', pos: [x, 0.1, z], size: [0.46, 0.2, 0.46], material: 'concreteDark' });
    }
    // Střecha: prstenec kolem dvora, atika venku i kolem dvora (s průchodem k žebříku).
    parts.push(...roofSlab(R, H, [C]));
    parts.push(...parapet(R, S, M.parapet, mat, TRIM));
    parts.push(...parapet([C[0] - 0.2, C[1] - 0.2, C[2] + 0.2, C[3] + 0.2], S, 0.9, mat, TRIM, { t: 0.2, gaps: [{ side: 'back', from: 1.5, to: 2.5 }] }));
    parts.push(...ladderParts(2.0, 2.45, 0, S, 'z+'));
    // Dvůr: dlažba, studna, lavička.
    parts.push({ shape: 'box', pos: [0, 0.1, 0], size: [5.8, 0.04, 4.8], material: 'paving' });
    parts.push({ shape: 'cylinder', pos: [-1.2, 0.45, 0.4], size: [1.2, 0.8, 1.2], material: 'stoneWall', collide: true });
    parts.push({ shape: 'box', pos: [1.6, 0.27, -1.4], size: [1.6, 0.4, 0.42], material: 'wood', collide: true });
    parts.push(...bands(R, 0.35, null, 'concreteDark', TRIM));
    parts.push(...acBox(-7, -4.0, 2.3, [-1, 0]), ...spout(5.5, 6, S + 0.1, [0, 1]));
    for (const sx of [-1, 1]) {
      parts.push(...mattress(sx * 5.4, -1.8, 0.08), ...table(sx * 5.3, 1.8, 0.08, 1.2, 0.7), ...chair(sx * 5.3, 2.4, 0.08, Math.PI));
      parts.push(...shelf(sx * 3.5, -5.45, 0.08, Math.PI, 1.0), ...crate(sx * 3.4, 5.2, 0.08, 0.6));
    }
    return parts;
  },
}, {
  target: [14, 12, 3.2],
  route: [
    { p: [0, 0, -7.5], note: 'ulice' },
    { p: [0, 0.08, -4.6], note: 'předsíň' },
    { p: [0, 0.1, -1.0], note: 'dvůr' },
    { p: [3.5, 0.08, -1.0], note: 'krytá chodba' },
    { p: [3.5, 0.08, -1.75] },
    { p: [5.4, 0.08, -0.9], note: 'boční pokoj' },
    { p: [3.5, 0.08, -1.75] },
    { p: [3.5, 0.08, 3.0] },
    { p: [2.4, 0.08, 3.0] },
    { p: [2.4, 0.08, 4.6], note: 'zadní pokoj' },
    { p: [2.4, 0.08, 3.0] },
    { p: [0, 0.08, 3.0] },
    { p: [0, 0.08, 5.0], note: 'zadní průchod' },
    { p: [0, 0, 7.6], note: 'ven zadem' },
    { p: [2.0, 0.1, 1.2], teleport: true },
    { p: [2.0, 3.2, 4.4], ladder: true, note: 'střecha' },
    { p: [2.0, 3.2, 4.7] },
    { p: [-5.0, 3.2, 4.7] },
    { p: [-5.0, 3.2, -4.0], note: 'střecha – přední křídlo' },
  ],
  walkableRoof: true,
  view: [[-2.6, 1.7, -2.0], [3.5, 1.4, 3.0]],
  notes: ['Krytá chodba 1,0–1,0 m kolem dvora na 8 sloupech; dvě cesty skrz (brána – dvůr – zadní průchod).'],
});

// ---------------------------------------------------------------------------
// Činžáky: společná pomůcka – dvouramenné schodiště přes `floors` podlaží + nástavba na střechu.
// ---------------------------------------------------------------------------
function coreAll(c: Core, floors: number, mat: string, wallMat: string, toRoof = true): Part[] {
  const parts: Part[] = [];
  const last = toRoof ? floors : floors - 1;
  for (let i = 0; i < last; i++) parts.push(...coreFlights(c, i === 0 ? 0.08 : i * S, i === 0 ? S - 0.08 : S, 1.1, mat, wallMat));
  return parts;
}

/** Stropy všech podlaží a střecha s otvorem pro schodiště; vrací díly a výšku střechy. */
function slabs(r: Rect, floors: number, core: Rect, toRoof = true): Part[] {
  const parts: Part[] = [];
  for (let i = 1; i <= floors; i++) {
    const roof = i === floors;
    parts.push(...roofSlab(r, i * S - M.slab, roof && !toRoof ? [] : [core], roof ? 'roof' : FLOOR));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// A14 Třípodlažní činžák s výklenkem: 10 × 9 m, centrální dvouramenné schodiště až na
// střechu (nástavba), dva pokoje na podlaží, dva sloupce balkonů, vstup zapuštěný 1,5 m.
// ---------------------------------------------------------------------------
reg(14, 'flats3Recess', 'Třípodlažní činžák s výklenkem', {
  describe: () => '10 × 9 m, 3 podlaží, centrální schodiště na střechu, 2 sloupce balkonů, výklenek 2 × 1,5 m',
  generate(_p, _seed, mat) {
    const R: Rect = [-5, -4.5, 5, 4.5];
    const F = 3;
    const c = coreLayout(0, 0.3);
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    // Přízemí: čelo s výklenkem uprostřed.
    const zf = -4.5 + t / 2;
    parts.push(...W([-5, zf], [-1.3, zf], 0, H, [win(-3.1)], mat, [0, -1]));
    parts.push(...W([1.3, zf], [5, zf], 0, H, [win(3.1)], mat, [0, -1]));
    for (const sx of [-1, 1]) parts.push(...W([sx * 1.15, -4.5], [sx * 1.15, -3.0], 0, H, [], mat));
    parts.push(...W([-1.3, -2.85], [1.3, -2.85], 0, H, [door(0)], mat, [0, -1]));
    parts.push({ shape: 'box', pos: [0, 0.04, -3.75], size: [2.0, 0.08, 1.5], material: 'paving', collide: true });
    parts.push(...shell(R, 0, H, { left: [win(-2.4), win(2.4)], right: [win(-2.4), win(2.4)], back: [win(-3.0), win(3.0)] }, mat, ['front']));
    for (const sx of [-1, 1]) parts.push(...partition([sx * 1.25, -2.7], [sx * 1.25, 4.2], 0, H, [door(-1.6, { w: 1.0 })], mat));
    // Patra.
    for (let i = 1; i < F; i++) {
      const y = i * S;
      parts.push(...shell(R, y, H, { front: [door(-3.1), win(0, { w: 1.0 }), door(3.1)], left: [win(-2.4), win(2.4)], right: [win(-2.4), win(2.4)], back: [win(-3.0), win(3.0)] }, mat));
      for (const sx of [-1, 1]) {
        parts.push(...partition([sx * 1.25, -4.2], [sx * 1.25, 4.2], y, H, [door(-2.4, { w: 1.0 })], mat));
        parts.push(...balcony([sx * 3.1 - 1.2, -5.6, sx * 3.1 + 1.2, -4.5], y, true, mat));
      }
    }
    parts.push(...coreAll(c, F, 'concreteLight', mat));
    parts.push(...slabs(R, F, c.rect));
    const yR = F * S;
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM, { gaps: [{ side: 'back', from: -1.6, to: 1.6 }] }));
    parts.push(...stairHouse(c, yR, mat, TRIM));
    parts.push(...bands(R, 0.35, S - 0.05, 'concreteDark', TRIM));
    parts.push(...tank(3.2, 2.6, yR, 0.6, 1.1, 1.2), ...acBox(5, 1.0, 5.4, [1, 0]), ...acBox(-5, -1.0, 8.6, [-1, 0]));
    for (let i = 0; i < F; i++) {
      const y = i === 0 ? 0.08 : i * S;
      parts.push(...mattress(-3.4, 2.6, y), ...table(3.2, 1.6, y, 1.2, 0.7), ...chair(3.2, 2.2, y, Math.PI), ...shelf(4.55, -1.2, y, -Math.PI / 2, 1.0));
    }
    return parts;
  },
}, {
  target: [10, 9, 9.6],
  route: [
    { p: [0, 0, -6.0], note: 'ulice' },
    { p: [0, 0.08, -3.6], note: 'výklenek' },
    { p: [0, 0.08, -1.6], note: 'chodba' },
    { p: [3.0, 0.08, -1.6], note: 'pokoj vlevo' },
    { p: [0, 0.08, -1.6] },
    { p: [-0.62, 0.08, -0.2], note: 'pata schodů (rameno A)' },
    { p: [-0.62, 1.68, 3.5], note: 'mezipodesta' },
    { p: [0.62, 1.68, 3.5] },
    { p: [0.62, 3.2, -0.3], note: '2. podlaží' },
    { p: [0, 3.2, -2.4] },
    { p: [3.0, 3.2, -2.4] },
    { p: [3.1, 3.2, -5.0], note: 'balkon' },
    { p: [3.0, 3.2, -2.4] },
    { p: [0.4, 3.2, -2.4] },
    { p: [0, 3.2, -1.0] },
    { p: [-0.62, 3.2, -0.2] },
    { p: [-0.62, 4.8, 3.5] },
    { p: [0.62, 4.8, 3.5] },
    { p: [0.62, 6.4, -0.3], note: '3. podlaží' },
    { p: [-0.62, 6.4, -0.2] },
    { p: [-0.62, 8.0, 3.5] },
    { p: [0.62, 8.0, 3.5] },
    { p: [0.62, 9.6, -0.3], note: 'nástavba' },
    { p: [0, 9.6, -1.6] },
    { p: [0, 9.6, -2.6], note: 'střecha' },
    { p: [-3.0, 9.6, -2.5] },
  ],
  walkableRoof: true,
  view: [[-0.6, 1.6, -2.6], [0.5, 2.4, 3.5]],
  notes: ['Dvouramenné schodiště 2 × 1,1 m s mezipodestou, 9 stupňů po 17,8 cm na rameno.', 'Balkony 2,4 × 1,1 m se zděným zábradlím na 2. a 3. podlaží.'],
});

// ---------------------------------------------------------------------------
// A15 Třípodlažní činžák s bočním vstupem: 9 × 11 m, hluboký vstupní výklenek u pravého
// okraje vede přímo ke schodišti, nepravidelné balkony (čelo i bok), boční okna.
// ---------------------------------------------------------------------------
reg(15, 'flats3SideEntry', 'Třípodlažní činžák s bočním vstupem', {
  describe: () => '9 × 11 m, 3 podlaží, výklenek 2,0 × 1,8 m vpravo přímo ke schodišti, nepravidelné balkony',
  generate(_p, _seed, mat) {
    const R: Rect = [-4.5, -5.5, 4.5, 5.5];
    const F = 3;
    const c = coreLayout(-3.025, -2.6);
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    const zf = -5.5 + t / 2;
    // Přízemí: výklenek vpravo (x −4,2 … −2,2, hloubka 1,8 m).
    parts.push(...W([-1.9, zf], [4.5, zf], 0, H, [win(-0.2), win(2.8)], mat, [0, -1]));
    parts.push(...W([-2.05, -5.5], [-2.05, -3.7], 0, H, [], mat));
    parts.push(...W([-4.2, -3.55], [-1.9, -3.55], 0, H, [door(-3.2)], mat, [0, -1]));
    parts.push({ shape: 'box', pos: [-4.5 + t / 2, H / 2, -5.5 + t / 2], size: [t, H, t], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [-3.2, 0.04, -4.6], size: [2.0, 0.08, 1.8], material: 'paving', collide: true });
    parts.push(...shell(R, 0, H, { left: [win(-3.0), win(2.6)], right: [win(3.3)], back: [win(-3.0), win(1.6)] }, mat, ['front']));
    for (let i = 0; i < F; i++) {
      const y = i * S;
      const zA = i === 0 ? -3.4 : -5.2;
      parts.push(...partition([-1.775, zA], [-1.775, 5.2], y, H, [door(i === 0 ? -3.0 : -4.0, { w: i === 0 ? 0.8 : 1.0 }), door(3.3, { w: 1.0 })], mat));
      parts.push(...partition([-4.2, 1.375], [-1.85, 1.375], y, H, [], mat));
      parts.push(...partition([-1.7, 0.5], [4.2, 0.5], y, H, [door(1.0, { w: 1.0 })], mat));
      if (i > 0) {
        const front = i === 1 ? [win(-3.0, { w: 1.0 }), door(1.0), win(3.2)] : [win(-3.0, { w: 1.0 }), win(0.0), door(3.0)];
        const left = i === 1 ? [win(-3.0), door(2.6)] : [win(-3.0), win(2.6)];
        parts.push(...shell(R, y, H, { front, left, right: [win(-4.0, { w: 1.0 }), win(3.3)], back: [win(-3.0), win(1.6)] }, mat));
        if (i === 1) {
          parts.push(...balcony([0.0, -6.6, 2.0, -5.5], y, false, mat));
          parts.push(...balcony([4.5, 1.6, 5.6, 3.6], y, true, mat));
        } else parts.push(...balcony([1.8, -6.7, 4.2, -5.5], y, true, mat));
      }
    }
    parts.push(...coreAll(c, F, 'concreteLight', mat));
    parts.push(...slabs(R, F, c.rect));
    const yR = F * S;
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM, { gaps: [{ side: 'right', from: -4.2, to: 1.6 }] }));
    parts.push(...stairHouse(c, yR, mat, TRIM));
    parts.push(...bands(R, 0.35, S - 0.05, 'concreteDark', TRIM));
    parts.push(...tank(2.4, 3.0, yR, 0.6, 1.1, 1.2), ...acBox(4.5, -1.5, 5.4, [1, 0]), ...spout(3.5, 5.5, yR + 0.1, [0, 1]));
    for (let i = 0; i < F; i++) {
      const y = i === 0 ? 0.08 : i * S;
      parts.push(...mattress(3.0, 3.6, y), ...table(2.9, -3.8, y, 1.2, 0.7), ...chair(2.9, -3.2, y, Math.PI), ...shelf(-3.0, 4.95, y, Math.PI, 1.0));
    }
    return parts;
  },
}, {
  target: [9, 11, 9.6],
  route: [
    { p: [-3.2, 0, -7.0], note: 'ulice' },
    { p: [-3.2, 0.08, -4.6], note: 'výklenek' },
    { p: [-3.2, 0.08, -3.0], note: 'u schodiště' },
    { p: [-1.0, 0.08, -3.0], note: 'přední pokoj' },
    { p: [1.0, 0.08, 0.0] },
    { p: [1.0, 0.08, 3.3], note: 'zadní pokoj' },
    { p: [-3.0, 0.08, 3.3], note: 'pokoj za schodištěm' },
    { p: [1.0, 0.08, 3.3] },
    { p: [1.0, 0.08, 0.0] },
    { p: [-1.0, 0.08, -3.0] },
    { p: [-3.65, 0.08, -2.9], note: 'pata schodů' },
    { p: [-3.65, 1.68, 0.8] },
    { p: [-2.4, 1.68, 0.8] },
    { p: [-2.4, 3.2, -3.0], note: '2. podlaží' },
    { p: [-1.0, 3.2, -4.0] },
    { p: [1.0, 3.2, -4.4] },
    { p: [1.0, 3.2, -6.1], note: 'balkon' },
    { p: [1.0, 3.2, -4.4] },
    { p: [1.0, 3.2, 0.0] },
    { p: [2.6, 3.2, 2.6] },
    { p: [5.0, 3.2, 2.6], note: 'boční balkon' },
    { p: [2.6, 3.2, 2.6] },
    { p: [1.0, 3.2, 0.0] },
    { p: [1.0, 3.2, -4.4] },
    { p: [-1.0, 3.2, -4.0] },
    { p: [-3.65, 3.2, -3.0] },
    { p: [-3.65, 4.8, 0.8] },
    { p: [-2.4, 4.8, 0.8] },
    { p: [-2.4, 6.4, -3.0], note: '3. podlaží' },
    { p: [-3.65, 6.4, -3.0] },
    { p: [-3.65, 8.0, 0.8] },
    { p: [-2.4, 8.0, 0.8] },
    { p: [-2.4, 9.6, -3.0], note: 'nástavba' },
    { p: [-3.0, 9.6, -4.4], note: 'střecha' },
    { p: [1.0, 9.6, -3.0] },
  ],
  walkableRoof: true,
  view: [[2.8, 1.6, -4.6], [-3.5, 1.4, 2.5]],
  notes: ['Výklenek vede přímo k patě schodiště; balkony: 2. podlaží čelo + bok, 3. podlaží čelo jinde.'],
});

// ---------------------------------------------------------------------------
// A16 Třípodlažní činžák s úzkými balkony: 12 × 8 m, tři okenní osy, mělké balkony 0,9 m
// přiléhající ke zdi, krátká centrální chodba, schodiště na střechu.
// ---------------------------------------------------------------------------
reg(16, 'flats3Narrow', 'Třípodlažní činžák s úzkými balkony', {
  describe: () => '12 × 8 m, 3 podlaží, tři okenní osy, mělké balkony 2 × 0,9 m, krátká chodba',
  generate(_p, _seed, mat) {
    const R: Rect = [-6, -4, 6, 4];
    const F = 3;
    const c = coreLayout(0, -0.2);
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    for (let i = 0; i < F; i++) {
      const y = i * S;
      const front = i === 0 ? [win(-3.5), win(-5.0, { w: 0.9 }), door(0), win(3.5), win(5.0, { w: 0.9 })] : [door(-3.5), win(-5.1, { w: 0.8 }), win(0, { w: 1.0 }), door(3.5), win(5.1, { w: 0.8 })];
      parts.push(...shell(R, y, H, { front, back: [win(-3.5), win(3.5)], left: [win(-1.8), win(1.8)], right: [win(-1.8), win(1.8)] }, mat));
      for (const sx of [-1, 1]) {
        parts.push(...partition([sx * 1.25, -3.7], [sx * 1.25, 3.7], y, H, [door(-2.0, { w: 1.0 })], mat));
        parts.push(...partition([Math.min(sx * 1.325, sx * 5.7), 0.4], [Math.max(sx * 1.325, sx * 5.7), 0.4], y, H, [door(sx * 3.6, { w: 1.0 })], mat));
        if (i > 0) parts.push(...balcony([sx * 3.5 - 1.0, -4.9, sx * 3.5 + 1.0, -4.0], y, false, mat));
      }
    }
    // Stříška nad vchodem.
    parts.push({ shape: 'box', pos: [0, 2.62, -4.45], size: [2.2, 0.1, 0.9], material: 'concreteLight', collide: true });
    parts.push(...coreAll(c, F, 'concreteLight', mat));
    parts.push(...slabs(R, F, c.rect));
    const yR = F * S;
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM, { gaps: [{ side: 'back', from: -1.6, to: 1.6 }] }));
    parts.push(...stairHouse(c, yR, mat, TRIM));
    parts.push(...bands(R, 0.35, S - 0.05, 'concreteDark', TRIM));
    parts.push(...tank(-3.8, 2.2, yR, 0.6, 1.1, 1.2), ...tank(3.8, 2.2, yR, 0.6, 1.1, 1.2), ...acBox(-6, -2.0, 5.4, [-1, 0]), ...acBox(6, 2.0, 8.6, [1, 0]));
    for (let i = 0; i < F; i++) {
      const y = i === 0 ? 0.08 : i * S;
      parts.push(...mattress(-3.6, 2.4, y, Math.PI / 2), ...table(4.9, -0.9, y, 1.0, 0.6), ...shelf(5.45, 2.2, y, -Math.PI / 2, 1.0), ...rug(-3.4, -2.0, y, 1.8, 1.4));
    }
    return parts;
  },
}, {
  target: [12, 8, 9.6],
  route: [
    { p: [0, 0, -5.6], note: 'ulice' },
    { p: [0, 0.08, -2.0], note: 'chodba' },
    { p: [3.4, 0.08, -2.6], note: 'přední pokoj' },
    { p: [3.6, 0.08, 2.0], note: 'zadní pokoj' },
    { p: [3.4, 0.08, -2.6] },
    { p: [0, 0.08, -2.0] },
    { p: [-0.62, 0.08, -0.7], note: 'pata schodů' },
    { p: [-0.62, 1.68, 3.0] },
    { p: [0.62, 1.68, 3.0] },
    { p: [0.62, 3.2, -0.8], note: '2. podlaží' },
    { p: [0, 3.2, -2.0] },
    { p: [3.5, 3.2, -2.6] },
    { p: [3.5, 3.2, -4.45], note: 'úzký balkon' },
    { p: [3.5, 3.2, -2.6] },
    { p: [0, 3.2, -2.0] },
    { p: [-0.62, 3.2, -0.7] },
    { p: [-0.62, 4.8, 3.0] },
    { p: [0.62, 4.8, 3.0] },
    { p: [0.62, 6.4, -0.8], note: '3. podlaží' },
    { p: [-0.62, 6.4, -0.7] },
    { p: [-0.62, 8.0, 3.0] },
    { p: [0.62, 8.0, 3.0] },
    { p: [0.62, 9.6, -0.8], note: 'nástavba' },
    { p: [0, 9.6, -2.0], note: 'střecha' },
    { p: [-4.0, 9.6, -2.6] },
  ],
  walkableRoof: true,
  view: [[0.2, 1.6, -3.5], [0.0, 2.2, 3.0]],
  notes: ['Balkony 2,0 × 0,9 m s kovovým zábradlím, deska přiléhá ke zdi (bez mezery).'],
});

// ---------------------------------------------------------------------------
// A17 Činžák s ustoupeným posledním podlažím: spodní dvě podlaží 11 × 9 m, horní 8 × 7 m
// vzadu, terasa s atikou kolem, schodiště spojuje všechna podlaží, žebřík na horní střechu.
// ---------------------------------------------------------------------------
reg(17, 'flats3Setback', 'Činžák s ustoupeným posledním podlažím', {
  describe: () => 'podlaží 1–2: 11 × 9 m, 3. podlaží 8 × 7 m, terasa ve tvaru U, žebřík na horní střechu',
  ladders: () => [ladderDef(4.05, 1.0, 2 * S, S, 'x-')],
  generate(_p, _seed, mat) {
    const R: Rect = [-5.5, -4.5, 5.5, 4.5];
    const T: Rect = [-4, -2.5, 4, 4.5];
    const c = coreLayout(0, 0.3);
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    for (let i = 0; i < 2; i++) {
      const y = i * S;
      const front = i === 0 ? [win(-3.4), door(0), win(3.4)] : [win(-3.4), win(-1.0, { w: 0.9 }), win(1.0, { w: 0.9 }), win(3.4)];
      parts.push(...shell(R, y, H, { front, back: [win(-3.4), win(3.4)], left: [win(-2.4), win(2.4)], right: [win(-2.4), win(2.4)] }, mat));
      for (const sx of [-1, 1]) {
        parts.push(...partition([sx * 1.25, -4.2], [sx * 1.25, 4.2], y, H, [door(-2.2, { w: 1.0 })], mat));
        parts.push(...partition([Math.min(sx * 1.325, sx * 5.2), 0.8], [Math.max(sx * 1.325, sx * 5.2), 0.8], y, H, [door(sx * 3.3, { w: 1.0 })], mat));
      }
    }
    // Stropy: 1. a 2. podlaží celé, nad 2. podlažím = podlaha terasy a ustoupeného patra.
    parts.push(...roofSlab(R, S - M.slab, [c.rect], FLOOR), ...roofSlab(R, 2 * S - M.slab, [c.rect]));
    parts.push(...coreFlights(c, 0.08, S - 0.08, 1.1, 'concreteLight', mat), ...coreFlights(c, S, S, 1.1, 'concreteLight', mat));
    const y2 = 2 * S;
    parts.push(...parapet(R, y2, M.parapet, mat, TRIM, { gaps: [{ side: 'back', from: -4, to: 4 }] }));
    // Ustoupené patro s dveřmi na terasu.
    parts.push(...shell(T, y2, H, { front: [win(-2.6), door(-0.9), win(2.6)], left: [win(-0.9, { w: 1.0 })], right: [win(1.0, { w: 1.0 })], back: [win(-2.4), win(2.4)] }, mat));
    parts.push(...partition([1.25, -2.2], [1.25, 4.2], y2, H, [door(-1.0, { w: 1.0 })], mat));
    parts.push(...partition([-1.25, 0.3], [-1.25, 4.2], y2, H, [], mat));
    parts.push(...edgeRail(c.rect[0], (c.rect[0] + c.rect[2]) / 2 - 0.1, c.zStart, y2));
    parts.push(...roofSlab(T, y2 + H));
    parts.push(...parapet(T, 3 * S, 0.8, mat, TRIM, { gaps: [{ side: 'left', from: 0.5, to: 1.5 }] }));
    parts.push(...ladderParts(4.05, 1.0, y2, S, 'x-'));
    // Terasa: pergola, květináče, stůl.
    parts.push(...table(-2.6, -3.5, y2), ...chair(-3.2, -3.5, y2, Math.PI / 2), ...chair(-2.0, -3.5, y2, -Math.PI / 2));
    for (const x of [-5.0, 5.0]) parts.push({ shape: 'box', pos: [x, y2 + 0.3, -4.0], size: [0.6, 0.6, 0.6], material: 'concreteLight', collide: true });
    parts.push(...bands(R, 0.35, S - 0.05, 'concreteDark', TRIM), ...bands(T, 0, y2 + H - 0.05, 'concreteDark', TRIM).filter((_, i) => i < 4));
    parts.push(...tank(-2.4, 2.6, 3 * S, 0.5, 1.0, 1.1), ...acBox(5.5, -2.0, 5.4, [1, 0]), ...spout(-4.6, 4.5, y2 + 0.1, [0, 1]));
    for (let i = 0; i < 3; i++) {
      const y = i === 0 ? 0.08 : i * S;
      parts.push(...mattress(-3.4, 2.8, y, Math.PI / 2), ...table(3.2, -1.6, y, 1.2, 0.7), ...chair(3.2, -1.0, y, Math.PI));
    }
    return parts;
  },
}, {
  target: [11, 9, 9.6],
  route: [
    { p: [0, 0, -6.0], note: 'ulice' },
    { p: [0, 0.08, -2.4], note: 'chodba' },
    { p: [3.2, 0.08, -2.8], note: 'pokoj' },
    { p: [0, 0.08, -2.4] },
    { p: [-0.62, 0.08, -0.2], note: 'pata schodů' },
    { p: [-0.62, 1.68, 3.5] },
    { p: [0.62, 1.68, 3.5] },
    { p: [0.62, 3.2, -0.3], note: '2. podlaží' },
    { p: [-0.62, 3.2, -0.2] },
    { p: [-0.62, 4.8, 3.5] },
    { p: [0.62, 4.8, 3.5] },
    { p: [0.62, 6.4, -0.3], note: 'ustoupené patro' },
    { p: [-0.9, 6.4, -1.4] },
    { p: [-0.9, 6.4, -3.6], note: 'terasa' },
    { p: [4.7, 6.4, -3.6] },
    { p: [4.6, 6.4, 1.0], note: 'pod žebříkem' },
    { p: [3.0, 9.6, 1.0], ladder: true, note: 'horní střecha' },
    { p: [0, 9.6, -1.0] },
  ],
  walkableRoof: true,
  view: [[-5.0, 7.9, -4.0], [2.0, 7.2, 2.5]],
  notes: ['Terasa: pruh 2 m vpředu a 1,5 m po stranách, atika 1,0 m; horní střecha po žebříku.'],
});

// ---------------------------------------------------------------------------
// A18 Pětipodlažní činžák s centrálním průjezdem: 14 × 11 m, průjezd 3,5 × 3,0 m přízemím,
// schodiště vedle průjezdu (vstup z průjezdu), v patrech chodba a pokoje, nástavba na střeše.
// ---------------------------------------------------------------------------
reg(18, 'flats5Passage', 'Pětipodlažní činžák s centrálním průjezdem', {
  describe: () => '14 × 11 m, 5 podlaží, průjezd 3,5 × 3,0 m, schodiště z průjezdu až na střechu',
  generate(_p, _seed, mat) {
    const R: Rect = [-7, -5.5, 7, 5.5];
    const F = 5;
    const c = coreLayout(-3.25, -1.5);
    const parts: Part[] = [];
    // Přízemí: dvě křídla podél průjezdu.
    parts.push(...groundFloor([-7, -5.5, -1.75, 5.5]), ...groundFloor([1.75, -5.5, 7, 5.5]));
    parts.push({ shape: 'box', pos: [0, 0.02, 0], size: [3.5, 0.04, 11], material: 'asphalt' });
    const zf = -5.5 + t / 2, zb = 5.5 - t / 2;
    parts.push(...W([-7, zf], [-1.75, zf], 0, H, [win(-5.6), door(-4.5, { w: 1.2 }), win(-2.9, { w: 0.9 })], mat, [0, -1]));
    parts.push(...W([1.75, zf], [7, zf], 0, H, [win(2.9, { w: 0.9 }), door(4.5, { w: 1.2 }), win(5.8, { w: 0.9 })], mat, [0, -1]));
    parts.push(...W([-7, zb], [-1.75, zb], 0, H, [win(-4.4)], mat, [0, 1]));
    parts.push(...W([1.75, zb], [7, zb], 0, H, [win(4.4)], mat, [0, 1]));
    parts.push(...W([-7 + t / 2, -5.2], [-7 + t / 2, 5.2], 0, H, [win(-1.0), win(3.8, { w: 1.0 })], mat, [-1, 0]));
    parts.push(...W([7 - t / 2, -5.2], [7 - t / 2, 5.2], 0, H, [win(-2.0), win(2.0)], mat, [1, 0]));
    // Stěny průjezdu (dveře ke schodišti a do levého křídla).
    parts.push(...W([-1.9, -5.5], [-1.9, 5.5], 0, H, [door(-2.2, { w: 1.1 })], mat, [1, 0]));
    parts.push(...W([1.9, -5.5], [1.9, 5.5], 0, H, [door(0.0)], mat, [-1, 0]));
    // Pravé křídlo: obchod vpředu, hala + schodiště, boční pokoj, zadní pokoj.
    parts.push(...partition([-6.7, -2.9], [-2.05, -2.9], 0, H, [door(-3.25, { w: 1.0 })], mat));
    parts.push(...partition([-4.5, -2.9], [-4.5, 2.55], 0, H, [door(-2.2, { w: 0.9 })], mat));
    parts.push(...partition([-6.7, 2.55], [-2.05, 2.55], 0, H, [door(-5.6, { w: 1.0 })], mat));
    // Patra 2–5: celá plocha, chodba před schodištěm přes celou šířku.
    for (let i = 1; i < F; i++) {
      const y = i * S;
      parts.push(...shell(R, y, H, { front: [win(-5.6), win(-3.4), win(-0.6), win(1.6), win(4.0), win(5.9, { w: 0.8 })], back: [win(-5.6), win(-1.0), win(2.0), win(4.8)], left: [win(-3.6), win(1.8)], right: [win(-3.6), win(1.8)] }, mat));
      parts.push(...partition([-6.7, -2.9], [6.7, -2.9], y, H, [door(-5.2, { w: 1.0 }), door(-0.6, { w: 1.0 }), door(4.4, { w: 1.0 })], mat));
      parts.push(...partition([-2.5, -5.2], [-2.5, -2.9], y, H, [], mat), ...partition([2.0, -5.2], [2.0, -2.9], y, H, [], mat));
      parts.push(...partition([-2.0, -1.5], [6.7, -1.5], y, H, [door(0.4, { w: 1.0 }), door(4.4, { w: 1.0 })], mat));
      parts.push(...partition([-6.7, -1.5], [-4.575, -1.5], y, H, [door(-5.6, { w: 1.0 })], mat));
      parts.push(...partition([-4.5, -1.5], [-4.5, 5.2], y, H, [door(3.9, { w: 1.0 })], mat));
      parts.push(...partition([-4.425, 2.475], [-2.0, 2.475], y, H, [], mat));
      parts.push(...partition([-2.0, -1.5], [-2.0, 5.2], y, H, [], mat));
      parts.push(...partition([2.4, -1.5], [2.4, 5.2], y, H, [], mat));
    }
    parts.push(...coreAll(c, F, 'concreteLight', mat));
    parts.push(...slabs(R, F, c.rect));
    const yR = F * S;
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM));
    parts.push(...stairHouse(c, yR, mat, TRIM));
    // Průvlak nad průjezdem (čitelný vjezd), sokl.
    for (const z of [-5.45, 5.45]) parts.push({ shape: 'box', pos: [0, 2.85, z], size: [3.8, 0.3, 0.12], material: TRIM });
    parts.push(...bands(R, 0, S - 0.05, 'concreteDark', TRIM));
    parts.push(...tank(4.0, 2.8, yR, 0.6, 1.2, 1.3), ...tank(1.6, 2.8, yR, 0.6, 1.2, 1.3), ...acBox(7, -1.0, 8.6, [1, 0]), ...acBox(-7, 3.0, 11.8, [-1, 0]));
    // Vybavení: obchod (pulty, police), byty.
    parts.push({ shape: 'box', pos: [-4.5, 0.55, -4.3], size: [2.4, 0.95, 0.6], material: 'wood', collide: true }, ...shelf(-6.4, -4.2, 0.08, Math.PI / 2, 1.4), ...crate(5.6, 4.4, 0.08, 0.7), ...crate(5.0, 4.6, 0.08, 0.55));
    for (let i = 1; i < F; i++) {
      const y = i * S;
      parts.push(...mattress(-5.6, 3.4, y), ...table(4.4, 2.6, y, 1.2, 0.7), ...chair(4.4, 3.2, y, Math.PI), ...shelf(-0.5, -5.0, y, Math.PI, 1.0));
    }
    return parts;
  },
}, {
  target: [14, 11, 16],
  route: [
    { p: [0, 0, -7.0], note: 'ulice' },
    { p: [0, 0.04, 0.0], note: 'průjezd' },
    { p: [0, 0, 7.0], note: 'průjezd skrz' },
    { p: [0, 0.04, -2.2] },
    { p: [-3.3, 0.08, -2.2], note: 'hala u schodiště' },
    { p: [-3.25, 0.08, -4.2], note: 'obchod' },
    { p: [-3.3, 0.08, -2.2] },
    { p: [-3.87, 0.08, -1.8], note: 'pata schodů' },
    { p: [-3.87, 1.68, 1.9] },
    { p: [-2.63, 1.68, 1.9] },
    { p: [-2.63, 3.2, -2.0], note: '2. podlaží – chodba' },
    { p: [-0.6, 3.2, -2.2] },
    { p: [-0.6, 3.2, -4.0], note: 'přední byt' },
    { p: [-0.6, 3.2, -2.2] },
    { p: [0.4, 3.2, -2.2] },
    { p: [0.4, 3.2, 1.0], note: 'zadní byt' },
    { p: [0.4, 3.2, -2.2] },
    { p: [-3.87, 3.2, -2.0] },
    { p: [-3.87, 4.8, 1.9] }, { p: [-2.63, 4.8, 1.9] }, { p: [-2.63, 6.4, -2.0] },
    { p: [-3.87, 6.4, -2.0] }, { p: [-3.87, 8.0, 1.9] }, { p: [-2.63, 8.0, 1.9] }, { p: [-2.63, 9.6, -2.0] },
    { p: [-3.87, 9.6, -2.0] }, { p: [-3.87, 11.2, 1.9] }, { p: [-2.63, 11.2, 1.9] }, { p: [-2.63, 12.8, -2.0], note: '5. podlaží' },
    { p: [-3.87, 12.8, -2.0] }, { p: [-3.87, 14.4, 1.9] }, { p: [-2.63, 14.4, 1.9] }, { p: [-2.63, 16.0, -2.0], note: 'nástavba' },
    { p: [-3.25, 16.0, -3.4], note: 'střecha' },
    { p: [3.0, 16.0, -3.0] },
  ],
  walkableRoof: true,
  view: [[0.0, 1.7, -6.5], [0.0, 1.5, 5.0]],
  notes: ['Průjezd 3,5 m široký, světlá výška 3,0 m; schodiště vstupem z průjezdu.'],
});

// ---------------------------------------------------------------------------
// A19 Pětipodlažní činžák s bočním průjezdem: 15 × 10 m, průjezd 3,5 m u levého okraje,
// obytný vstup vpravo, vystouplý schodišťový trakt vzadu, balkony v patrech.
// ---------------------------------------------------------------------------
reg(19, 'flats5SidePassage', 'Pětipodlažní činžák s bočním průjezdem', {
  describe: () => '15 × 10 m, 5 podlaží, boční průjezd 3,5 m, vystouplý schodišťový trakt, balkony',
  generate(_p, _seed, mat) {
    const R: Rect = [-7.5, -5, 7.5, 5];
    const Tw: Rect = [-7.5, 5, -4.55, 6.9];
    const F = 5;
    const c = coreLayout(-6.025, 2.7);
    const parts: Part[] = [];
    parts.push(...groundFloor([-7.5, -5, 3.4, 5]), ...groundFloor(Tw));
    parts.push({ shape: 'box', pos: [5.45, 0.02, 0], size: [3.5, 0.04, 10], material: 'asphalt' });
    const zf = -5 + t / 2;
    for (let i = 0; i < F; i++) {
      const y = i * S;
      const g = i === 0;
      const xEnd = g ? 3.4 : 7.5;
      // Čelo, záda (bez traktu), boky.
      const front = g ? [door(-6.0), win(-3.2), win(-0.4), win(2.2, { w: 1.0 })] : [win(-6.0, { w: 1.0 }), win(-3.2), door(-1.5), win(0.6), win(3.0), door(4.6), win(6.4, { w: 0.8 })];
      parts.push(...W([-7.5, zf], [xEnd, zf], y, H, front, mat, [0, -1]));
      parts.push(...W([-4.55, 5 - t / 2], [xEnd, 5 - t / 2], y, H, g ? [win(-2.0), win(1.0)] : [win(-2.0), win(1.0), win(4.0), win(6.4, { w: 0.8 })], mat, [0, 1]));
      parts.push(...W([-7.5 + t / 2, -4.7], [-7.5 + t / 2, 6.6], y, H, [win(-3.0, { w: 1.0 }), win(0.0, { w: 1.0 })], mat, [-1, 0]));
      if (g) {
        // Průjezd: vnitřní stěna s dveřmi do přízemí a plná vnější stěna (nese patra nad ním).
        parts.push(...W([3.55, -5], [3.55, 5], y, H, [door(0.0, { w: 1.1 })], mat, [1, 0]));
        parts.push(...W([7.5 - t / 2, -5], [7.5 - t / 2, 5], y, H, [], mat, [1, 0]));
      }
      else parts.push(...W([7.5 - t / 2, -4.7], [7.5 - t / 2, 4.7], y, H, [win(-2.5), win(2.5)], mat, [1, 0]));
      // Schodišťový trakt (vystupuje 1,9 m za zadní fasádu).
      parts.push(...W([-7.5, 6.75], [-4.55, 6.75], y, H, [win(-6.0, { w: 0.6, b: 1.6, t: 2.4 })], mat, [0, 1]));
      parts.push(...W([-4.7, 5], [-4.7, 6.6], y, H, [], mat, [1, 0]));
      // Chodba podél pravé strany k jádru, pokoje.
      parts.push(...partition([-4.775, -4.7], [-4.775, 5], y, H, [door(g ? -2.0 : -3.6, { w: 1.0 }), door(1.6, { w: 1.0 })], mat));
      parts.push(...partition([-4.7, 0.5], [g ? 3.4 : 7.2, 0.5], y, H, [door(-1.0, { w: 1.0 }), ...(g ? [] : [door(4.6, { w: 1.0 })])], mat));
      if (!g) {
        parts.push(...partition([1.5, -4.7], [1.5, 0.5], y, H, [door(-2.0, { w: 1.0 })], mat), ...partition([1.5, 0.5], [1.5, 4.7], y, H, [door(2.6, { w: 1.0 })], mat));
        for (const x of [-1.5, 4.6]) parts.push(...balcony([x - 1.1, -6.1, x + 1.1, -5], y, true, mat));
      }
    }
    parts.push(...coreAll(c, F, 'concreteLight', mat));
    for (let i = 1; i <= F; i++) {
      const roof = i === F;
      parts.push(...roofSlab(R, i * S - M.slab, [c.rect], roof ? 'roof' : FLOOR), ...roofSlab(Tw, i * S - M.slab, [c.rect], roof ? 'roof' : FLOOR));
    }
    const yR = F * S;
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM, { gaps: [{ side: 'right', from: 1.2, to: 5.0 }, { side: 'back', from: -7.5, to: -4.4 }] }));
    parts.push(...parapet(Tw, yR, M.parapet, mat, TRIM, { skip: ['front'] }));
    parts.push(...stairHouse(c, yR, mat, TRIM));
    for (const z of [-4.95, 4.95]) parts.push({ shape: 'box', pos: [5.45, 2.85, z], size: [3.9, 0.3, 0.12], material: TRIM });
    parts.push(...bands(R, 0, S - 0.05, 'concreteDark', TRIM));
    parts.push(...tank(2.0, 2.6, yR, 0.6, 1.2, 1.3), ...tank(4.6, 2.6, yR, 0.6, 1.2, 1.3), ...acBox(-7.5, -2.0, 5.4, [-1, 0]), ...acBox(7.5, 1.0, 11.8, [1, 0]));
    parts.push(...table(-1.0, -2.5, 0.08, 1.2, 0.7), ...chair(-1.0, -1.9, 0.08, Math.PI), ...mattress(1.6, 3.0, 0.08), ...shelf(3.15, -3.0, 0.08, -Math.PI / 2, 1.0));
    for (let i = 1; i < F; i++) {
      const y = i * S;
      parts.push(...mattress(5.6, 3.2, y), ...table(-2.6, 2.8, y, 1.2, 0.7), ...chair(-2.6, 3.4, y, Math.PI));
    }
    return parts;
  },
}, {
  target: [15, 10, 16],
  route: [
    { p: [5.45, 0, -6.5], note: 'ulice' },
    { p: [5.45, 0.04, 0.0], note: 'průjezd' },
    { p: [5.45, 0, 6.5], note: 'průjezd skrz' },
    { p: [5.45, 0.04, 0.0] },
    { p: [2.0, 0.08, 0.0], note: 'boční dveře z průjezdu' },
    { p: [-6.0, 0, -6.5], teleport: true, note: 'obytný vstup' },
    { p: [-6.0, 0.08, -3.6], note: 'chodba' },
    { p: [-3.5, 0.08, -2.0], note: 'přední pokoj' },
    { p: [-1.0, 0.08, -0.4] },
    { p: [-1.0, 0.08, 2.4], note: 'zadní pokoj' },
    { p: [-1.0, 0.08, -0.4] },
    { p: [-3.5, 0.08, -2.0] },
    { p: [-6.0, 0.08, -2.0] },
    { p: [-6.65, 0.08, 2.2], note: 'pata schodů' },
    { p: [-6.65, 1.68, 5.9] },
    { p: [-5.4, 1.68, 5.9] },
    { p: [-5.4, 3.2, 2.2], note: '2. podlaží' },
    { p: [-6.0, 3.2, -3.6] },
    { p: [-3.5, 3.2, -3.6] },
    { p: [-1.5, 3.2, -4.4] },
    { p: [-1.5, 3.2, -5.55], note: 'balkon' },
    { p: [-1.5, 3.2, -4.4] },
    { p: [-3.5, 3.2, -3.6] },
    { p: [-6.0, 3.2, -3.0] },
    { p: [-6.65, 3.2, 2.2] },
    { p: [-6.65, 4.8, 5.9] }, { p: [-5.4, 4.8, 5.9] }, { p: [-5.4, 6.4, 2.2] },
    { p: [-6.65, 6.4, 2.2] }, { p: [-6.65, 8.0, 5.9] }, { p: [-5.4, 8.0, 5.9] }, { p: [-5.4, 9.6, 2.2] },
    { p: [-6.65, 9.6, 2.2] }, { p: [-6.65, 11.2, 5.9] }, { p: [-5.4, 11.2, 5.9] }, { p: [-5.4, 12.8, 2.2], note: '5. podlaží' },
    { p: [-6.65, 12.8, 2.2] }, { p: [-6.65, 14.4, 5.9] }, { p: [-5.4, 14.4, 5.9] }, { p: [-5.4, 16.0, 2.2], note: 'nástavba' },
    { p: [-6.0, 16.0, 0.8], note: 'střecha' },
    { p: [2.0, 16.0, -2.0] },
  ],
  walkableRoof: true,
  view: [[5.45, 1.7, -6.0], [5.45, 1.5, 4.0]],
  notes: ['Průjezd 3,5 m, světlá výška 3,0 m; schodišťový trakt vystupuje 1,9 m za zadní fasádu.'],
});

// ---------------------------------------------------------------------------
// A20 Rohový dům se zapuštěným rohovým vstupem: 10 × 10 m, 2 podlaží, nároží ustupuje do
// krytého vstupu na sloupu, v přízemí obchod s výlohami do obou ulic, patro po vlastních
// venkovních schodech, poklop na střechu.
// ---------------------------------------------------------------------------
const A20_HATCH: Rect = [0.6, 0.4, 1.8, 1.6];
reg(20, 'cornerShop', 'Rohový dům se zapuštěným rohovým vstupem', {
  describe: () => '10 × 10 m, 2 podlaží, rohový krytý vstup 2,5 × 2,5 m, obchod s výlohami do dvou ulic, schody do patra',
  ladders: () => [hatch(A20_HATCH, S, 2 * S).ladder],
  generate(_p, _seed, mat) {
    const R: Rect = [-5, -5, 5, 5];
    const parts: Part[] = [];
    parts.push(...groundFloor([-2.5, -5, 5, 5]), ...groundFloor([-5, -2.5, -2.5, 5]));
    parts.push({ shape: 'box', pos: [-3.75, 0.03, -3.75], size: [2.5, 0.06, 2.5], material: 'paving', collide: true });
    const shop = (c: number, w = 2.6): Op => ({ c, w, b: 0.5, t: 2.6, kind: 'window' });
    const zf = -5 + t / 2;
    // Přízemí: výlohy do obou ulic, dva vstupy v koutě nároží.
    parts.push(...W([-2.5, zf], [5, zf], 0, H, [shop(0.0), shop(3.3, 2.2)], mat, [0, -1]));
    parts.push(...W([-5 + t / 2, -2.5], [-5 + t / 2, 4.7], 0, H, [shop(0.2), shop(3.1, 2.0)], mat, [-1, 0]));
    parts.push(...W([-5, -2.5 + t / 2], [-2.5, -2.5 + t / 2], 0, H, [door(-3.75)], mat, [0, -1]));
    parts.push(...W([-2.5 + t / 2, -5 + t], [-2.5 + t / 2, -2.5], 0, H, [door(-3.75)], mat, [-1, 0]));
    parts.push(...W([-5, 5 - t / 2], [5, 5 - t / 2], 0, H, [win(-2.6), door(3.8)], mat, [0, 1]));
    parts.push(...W([5 - t / 2, -4.7], [5 - t / 2, 4.7], 0, H, [win(-1.5), win(2.0)], mat, [1, 0]));
    // Sklad vzadu vlevo.
    parts.push(...partition([1.8, 2.0], [4.7, 2.0], 0, H, [door(3.2, { w: 1.0 })], mat), ...partition([1.8, 2.0], [1.8, 4.7], 0, H, [], mat));
    // Roh: sloup a průvlaky pod patrem (světlost 2,65 m).
    parts.push({ shape: 'box', pos: [-4.72, 1.4, -4.72], size: [0.55, 2.8, 0.55], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [-3.75, 2.83, -4.75], size: [2.5, 0.36, 0.5], material: mat, collide: true }, { shape: 'box', pos: [-4.75, 2.83, -3.75], size: [0.5, 0.36, 2.5], material: mat, collide: true });
    parts.push(...roofSlab(R, H, [], FLOOR));
    // Patro (celá plocha nad nárožím), dveře na podestu vnějších schodů.
    parts.push(...shell(R, S, H, { front: [win(-3.6), win(-1.0), win(1.6), win(3.8)], right: [win(-3.6), win(-1.0), win(1.6), win(3.8)], back: [win(-3.4), door(1.6), win(3.9, { w: 1.0 })], left: [win(-2.6), win(2.0)] }, mat));
    parts.push(...partition([-4.7, 0.0], [4.7, 0.0], S, H, [door(-2.6, { w: 1.0 }), door(2.8, { w: 1.0 })], mat));
    parts.push(...partition([0.0, -4.7], [0.0, 0.0], S, H, [door(-1.6, { w: 1.0 })], mat));
    parts.push(...roofSlab(R, S + H, [A20_HATCH]));
    parts.push(...parapet(R, 2 * S, M.parapet, mat, TRIM));
    parts.push(...hatch(A20_HATCH, S, 2 * S).parts);
    // Venkovní schody podél zadní stěny do patra (nahoru k +X), podesta u dveří.
    const st = stairs(-4.3, 5.6, 'x+', 1.1, 0, S, 'concreteLight', { solid: true, wallSide: ['right'] });
    parts.push(...st.parts);
    const xTop = -4.3 + st.run;
    parts.push(...landing([xTop, 5.0, xTop + 1.4, 6.2], S, 'concreteLight'));
    parts.push({ shape: 'box', pos: [xTop + 0.7, S + 0.5, 6.12], size: [1.4, 1.0, 0.16], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [xTop + 1.32, S + 0.5, 5.6], size: [0.16, 1.0, 1.2], material: mat, collide: true });
    // Obchod: pult, police, bedny; markýzy nad výlohami.
    parts.push({ shape: 'box', pos: [-1.2, 0.55, -1.0], size: [2.4, 0.95, 0.6], material: 'wood', collide: true });
    parts.push(...shelf(4.55, -2.0, 0.08, -Math.PI / 2, 1.6), ...shelf(-1.0, 4.45, 0.08, Math.PI, 1.6), ...crate(4.2, 4.3, 0.08, 0.7), ...crate(4.3, 3.5, 0.08, 0.55));
    // Markýzy nad výlohami: vnější hrana níž (sklon 20°).
    for (const [x, w] of [[0.0, 3.0], [3.3, 2.6]] as const) parts.push({ shape: 'box', pos: [x, 2.85, -5.6], rot: [-0.35, 0, 0], size: [w, 0.04, 1.2], material: 'awningSand' });
    for (const [z, w] of [[0.2, 3.0], [3.1, 2.4]] as const) parts.push({ shape: 'box', pos: [-5.6, 2.85, z], rot: [0, 0, 0.35], size: [1.2, 0.04, w], material: 'awningSand' });
    parts.push(...bands(R, 0, S - 0.05, 'concreteDark', TRIM));
    parts.push(...tank(3.2, -2.8, 2 * S, 0.6, 1.1, 1.2), ...acBox(5, -2.5, 5.4, [1, 0]), ...spout(-4.0, 5, 2 * S + 0.1, [0, 1]));
    parts.push(...mattress(-3.6, 2.4, S, Math.PI / 2), ...table(2.8, 2.6, S, 1.2, 0.7), ...chair(2.8, 3.2, S, Math.PI), ...rug(-2.4, -2.4, S, 2.0, 1.6), ...shelf(4.55, -3.0, S, -Math.PI / 2, 1.0));
    return parts;
  },
}, {
  target: [10, 10, 6.4],
  route: [
    { p: [-6.5, 0, -6.5], note: 'nároží' },
    { p: [-3.75, 0.06, -3.75], note: 'krytý rohový vstup' },
    { p: [-1.5, 0.08, -3.75], note: 'obchod (dveře z čela)' },
    { p: [-3.75, 0.06, -3.75] },
    { p: [-3.75, 0.08, -1.5], note: 'obchod (dveře z boku)' },
    { p: [2.0, 0.08, 1.0] },
    { p: [3.2, 0.08, 3.4], note: 'sklad' },
    { p: [3.2, 0.08, 1.5] },
    { p: [2.0, 0.08, 1.0] },
    { p: [3.8, 0.08, 4.0] },
    { p: [3.8, 0, 6.0], note: 'zadní dveře ven' },
    { p: [-5.0, 0, 6.6] },
    { p: [-4.6, 0, 5.6], note: 'pata vnějších schodů' },
    { p: [1.1, 3.2, 5.6], note: 'podesta' },
    { p: [1.6, 3.2, 3.6], note: 'patro' },
    { p: [2.8, 3.2, 1.0] },
    { p: [2.6, 3.2, -1.0] },
    { p: [-1.5, 3.2, -2.4] },
    { p: [2.8, 3.2, -1.0] },
    { p: [2.8, 3.2, 1.0] },
    { p: [0.1, 6.4, 1.0], ladder: true, note: 'poklopem na střechu' },
    { p: [-3.0, 6.4, -3.0] },
  ],
  walkableRoof: true,
  view: [[3.8, 1.6, 1.4], [-3.6, 1.3, -3.6]],
  notes: ['Rohový vstup 2,5 × 2,5 m, světlost pod průvlaky 2,65 m; výlohy 2,6 × 2,1 m se soklem 0,5 m.'],
});

