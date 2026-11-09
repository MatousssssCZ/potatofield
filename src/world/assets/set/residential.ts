import type { LadderLocal, Part } from '../../parts';
import { registerAsset, type AssetDef, type Params } from '../../registry';
import {
  M, acBox, bands, chair, crate, door, ladderDef, ladderParts, landing, mattress, parapet, rail, rug, shelf, slab, spout, stairs, table, tank, wall, win,
  type Op, type P2, type Rect,
} from './bk';

/**
 * Sada 300 · A Obytné budovy (položky 1–30). Každý dům je přístupný: vstup ≥ 1,2 × 2,25 m,
 * propojené místnosti, cesta mezi podlažími a na pochozí střechu (schody / žebřík / poklop).
 * Rozměry jsou cílové rozměry ze zadání (N); detaily (lišty, rámy, nábytek) jsou jen vzhled.
 */

export const WALL_MATS = ['plasterWarm', 'plaster', 'plasterWhite', 'plasterOchre', 'sandstone', 'concreteLight'];
export const TRIM = 'sandstone';
export const FLOOR = 'concreteLight';
const ROOF = 'roof';
const t = M.wall;

/** Metadata pro validaci a export (JSON): trasa průchodu a popis vstupů/schodů. */
export interface SetMeta {
  item: number;
  /** Cílové rozměry ze zadání [šířka, hloubka, výška]. */
  target: [number, number, number];
  /** Trasa hráče v lokálních souřadnicích: [x, y podlahy, z]; `ladder` = úsek po žebříku. */
  route: { p: [number, number, number]; ladder?: boolean; teleport?: boolean; note?: string }[];
  walkableRoof: boolean;
  notes: string[];
  /** Pohled kamery do interiéru pro rendery [pozice, cíl]. */
  view?: [[number, number, number], [number, number, number]];
}

export const SET_META: Record<string, SetMeta> = {};

/** Plášť obdélníkové hmoty: otvory zadané v absolutní souřadnici (x pro čelo/záda, z pro boky). */
export function shell(r: Rect, y0: number, h: number, ops: { front?: Op[]; back?: Op[]; left?: Op[]; right?: Op[] }, mat: string, skip: ('front' | 'back' | 'left' | 'right')[] = []): Part[] {
  const [x0, z0, x1, z1] = r;
  const parts: Part[] = [];
  const rel = (list: Op[] | undefined, start: number) => (list ?? []).map((o) => ({ ...o, c: o.c - start }));
  if (!skip.includes('front')) parts.push(...wall([x0, z0 + t / 2], [x1, z0 + t / 2], y0, h, t, rel(ops.front, x0), mat, { out: [0, -1], trim: TRIM }));
  if (!skip.includes('back')) parts.push(...wall([x0, z1 - t / 2], [x1, z1 - t / 2], y0, h, t, rel(ops.back, x0), mat, { out: [0, 1], trim: TRIM }));
  if (!skip.includes('left')) parts.push(...wall([x1 - t / 2, z0 + t], [x1 - t / 2, z1 - t], y0, h, t, rel(ops.left, z0 + t), mat, { out: [1, 0], trim: TRIM }));
  if (!skip.includes('right')) parts.push(...wall([x0 + t / 2, z0 + t], [x0 + t / 2, z1 - t], y0, h, t, rel(ops.right, z0 + t), mat, { out: [-1, 0], trim: TRIM }));
  return parts;
}

/** Příčka (bez lišt) z a do b, otvory v absolutní souřadnici osy příčky. */
export function partition(a: P2, b: P2, y0: number, h: number, ops: Op[], mat: string): Part[] {
  const alongX = Math.abs(b[1] - a[1]) < 1e-6;
  const start = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
  const A: P2 = alongX ? [Math.min(a[0], b[0]), a[1]] : [a[0], Math.min(a[1], b[1])];
  const B: P2 = alongX ? [Math.max(a[0], b[0]), a[1]] : [a[0], Math.max(a[1], b[1])];
  return wall(A, B, y0, h, M.inner, ops.map((o) => ({ ...o, c: o.c - start, leaf: false })), mat, { plain: true });
}

/** Podlaha přízemí (tenká deska nad terénem). */
export const groundFloor = (r: Rect): Part[] => [{ shape: 'box', pos: [(r[0] + r[2]) / 2, 0.04, (r[1] + r[3]) / 2], size: [r[2] - r[0] - 0.02, 0.08, r[3] - r[1] - 0.02], material: FLOOR, collide: true }];

/** Strop/střecha nad hmotou: deska s přesahem 0,05 m, spodní líc v y, otvory. */
/**
 * Strop / střecha nad hmotou: betonová deska s přesahem 0,05 m (spodní líc v y) a otvory;
 * střešní deska navíc dostane tmavou hydroizolaci navrchu (jen vzhled).
 */
export const roofSlab = (r: Rect, y: number, holes: Rect[] = [], top: string = ROOF): Part[] => {
  const out = slab([r[0] - 0.05, r[1] - 0.05, r[2] + 0.05, r[3] + 0.05], y + M.slab, M.slab, holes, 'concreteLight');
  if (top === ROOF) out.push(...slab([r[0] + 0.1, r[1] + 0.1, r[2] - 0.1, r[3] - 0.1], y + M.slab + 0.012, 0.012, holes.map((h) => [h[0] - 0.05, h[1] - 0.05, h[2] + 0.05, h[3] + 0.05] as Rect), ROOF, false));
  return out;
};

const D2 = (...a: number[]) => a;
void D2;

export function reg(item: number, id: string, label: string, def: Omit<AssetDef, 'assetId' | 'label' | 'category' | 'generatorVersion' | 'params' | 'materials' | 'defaultMaterial'> & { params?: AssetDef['params']; defaultMaterial?: string }, meta: Omit<SetMeta, 'item'>) {
  const assetId = `setA.${id}`;
  SET_META[assetId] = { item, ...meta };
  registerAsset({
    assetId,
    label: `A${String(item).padStart(2, '0')} ${label}`,
    category: 'setA',
    generatorVersion: 1,
    params: def.params ?? [],
    materials: WALL_MATS,
    defaultMaterial: def.defaultMaterial ?? 'plasterWarm',
    ...def,
  });
}

// ---------------------------------------------------------------------------
// A01 Přízemní dům s venkovními schody: 7 × 6 m, střecha 3,2 m, dvě místnosti,
// přímé schody podél pravé stěny na pochozí střechu s atikou a malou nádrží.
// ---------------------------------------------------------------------------
reg(1, 'house1Stairs', 'Přízemní dům s venkovními schody', {
  describe: () => '7 × 6 m, střecha 3,2 m, 2 místnosti, venkovní schody na střechu (18 × 17,8 cm)',
  generate(_p, _seed, mat) {
    const R: Rect = [-3.5, -3, 3.5, 3];
    const H = 3.0;
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    parts.push(...shell(R, 0, H, { front: [door(1.3), win(-1.9)], left: [win(0)], back: [win(1.6)] }, mat));
    // Příčka mezi pokoji (x = −0,6) s průchodem.
    parts.push(...partition([-0.6, -2.7], [-0.6, 2.7], 0, H, [door(0.9, { w: 1.0 })], mat));
    parts.push(...roofSlab(R, H));
    const yR = H + M.slab;
    // Venkovní schody podél pravé (−X) stěny: nahoru dozadu, podesta u zadního rohu.
    const sx = -3.5 - 0.6;
    const st = stairs(sx, -3.6, 'z+', 1.2, 0, yR, 'concreteLight', { solid: true, wallSide: ['right'] });
    parts.push(...st.parts);
    const zTop = -3.6 + st.run;
    parts.push(...landing([-4.7, zTop, -3.5, 3.0], yR, 'concreteLight'));
    // Zídka podesty (venkovní strana a záda).
    parts.push({ shape: 'box', pos: [-4.61, yR + 0.5, (zTop + 3.0) / 2], size: [0.18, 1.0, 3.0 - zTop], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [-4.1, yR + 0.5, 2.91], size: [1.2, 1.0, 0.18], material: mat, collide: true });
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM, { gaps: [{ side: 'right', from: zTop + 0.05, to: 2.85 }] }));
    parts.push(...tank(1.9, 1.7, yR, 0.6, 1.0, 1.1));
    parts.push(...bands(R, 0.35, null, 'concreteDark', TRIM));
    parts.push(...spout(2.5, 3.0, yR + 0.1, [0, 1]), ...acBox(-1.5, 3.0, 2.3, [0, 1]));
    // Interiér: obývací pokoj (stůl, židle, koberec), ložnice (matrace, police).
    parts.push(...table(1.6, 1.0, 0.08), ...chair(1.0, 1.0, 0.08, Math.PI / 2), ...chair(2.2, 1.0, 0.08, -Math.PI / 2), ...rug(1.6, 0.6, 0.08, 2.0, 1.6));
    parts.push(...mattress(-2.5, 1.4, 0.08), ...shelf(-3.0, -1.6, 0.08, Math.PI / 2, 1.0));
    return parts;
  },
}, {
  target: [7, 6, 3.2],
  route: [
    { p: [1.3, 0, -4.5], note: 'před vchodem' },
    { p: [1.3, 0.08, -1.5], note: 'obývací pokoj' },
    { p: [0.4, 0.08, 0.9] },
    { p: [-1.8, 0.08, 0.9], note: 'průchod do ložnice' },
    { p: [0.4, 0.08, 0.9] },
    { p: [1.3, 0.08, -1.5] },
    { p: [1.3, 0, -4.5], note: 'ven' },
    { p: [-4.1, 0, -4.4], note: 'pata schodů' },
    { p: [-4.1, 3.2, 2.4], note: 'podesta' },
    { p: [-2.6, 3.2, 2.4], note: 'střecha' },
    { p: [0, 3.2, -1.5] },
  ],
  walkableRoof: true,
  view: [[2.9, 1.6, -2.5], [-1.5, 1.0, 1.5]],
  notes: ['Kolize schodů = rampa; zídka schodů a podesty plná (kryt).'],
});

// ---------------------------------------------------------------------------
// A02 Přízemní dům se zapuštěným vstupem: 8 × 6 m, výklenek 2 × 1,5 m uprostřed,
// dveře v zadní stěně výklenku, obývací pokoj + menší zadní pokoj, zadní žebřík na střechu.
// ---------------------------------------------------------------------------
reg(2, 'houseRecess', 'Přízemní dům se zapuštěným vstupem', {
  describe: () => '8 × 6 m, výklenek 2,0 × 1,5 m, zadní žebřík na střechu',
  ladders: () => [ladderDef(2.6, 3.05, 0, 3.2, 'z-')],
  generate(_p, _seed, mat) {
    const R: Rect = [-4, -3, 4, 3];
    const H = 3.0, rw = 1.0, rd = 1.5; // polovina šířky výklenku, hloubka
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    const zf = -3 + t / 2;
    // Čelo po stranách výklenku.
    parts.push(...wall([-4, zf], [-rw - t, zf], 0, H, t, [win(1.35)], mat, { out: [0, -1], trim: TRIM }));
    parts.push(...wall([rw + t, zf], [4, zf], 0, H, t, [win(1.35)], mat, { out: [0, -1], trim: TRIM }));
    // Boční stěny výklenku (plné, kryt) a zadní stěna s dveřmi.
    for (const s of [-1, 1]) parts.push(...wall([s * (rw + t / 2), -3], [s * (rw + t / 2), -3 + rd], 0, H, t, [], mat, { plain: true }));
    parts.push(...wall([-rw - t, -3 + rd + t / 2], [rw + t, -3 + rd + t / 2], 0, H, t, [door(rw + t)], mat, { out: [0, -1], trim: TRIM }));
    parts.push(...shell(R, 0, H, { left: [win(0)], right: [win(-0.6)], back: [win(-2.2), win(0.6)] }, mat, ['front']));
    // Zadní pokoj (pravá zadní čtvrtina): příčky s průchodem.
    parts.push(...partition([-3.7, 0.9], [0.5, 0.9], 0, H, [door(-1.6, { w: 1.0 })], mat));
    parts.push(...partition([0.5, 0.9], [0.5, 2.7], 0, H, [], mat));
    parts.push(...roofSlab(R, H));
    const yR = H + M.slab;
    // Výklenek má vlastní podlahu (dlažba) – střecha nad ním je strop (světlost 3,0 m).
    parts.push({ shape: 'box', pos: [0, 0.04, -3 + rd / 2], size: [2 * rw, 0.08, rd], material: 'paving', collide: true });
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM, { gaps: [{ side: 'back', from: 2.05, to: 3.15 }] }));
    parts.push(...ladderParts(2.6, 3.05, 0, yR, 'z-'));
    parts.push(...bands(R, 0.35, null, 'concreteDark', TRIM));
    parts.push(...acBox(-2.6, 3.0, 2.2, [0, 1]), ...spout(-3.0, -3.0, yR + 0.1, [0, -1]));
    parts.push({ shape: 'box', pos: [0, H - 0.25, -3 + 0.04], size: [2 * rw + 0.3, 0.5, 0.08], material: TRIM });
    parts.push(...table(2.2, -1.2, 0.08), ...chair(2.2, -0.55, 0.08, Math.PI), ...rug(-1.8, -1.4, 0.08, 2.2, 1.4), ...shelf(3.6, 1.5, 0.08, -Math.PI / 2, 1.0));
    parts.push(...mattress(-2.6, 1.85, 0.08, Math.PI / 2), ...crate(-0.3, 2.3, 0.08, 0.55));
    return parts;
  },
}, {
  target: [8, 6, 3.2],
  route: [
    { p: [0, 0, -4.5], note: 'ulice' },
    { p: [0, 0.08, -2.0], note: 've výklenku' },
    { p: [0, 0.08, -0.6], note: 'obývací pokoj' },
    { p: [-1.6, 0.08, 0.3] },
    { p: [-1.6, 0.08, 1.9], note: 'zadní pokoj' },
    { p: [-1.6, 0.08, 0.3] },
    { p: [0, 0.08, -0.6] },
    { p: [0, 0.08, -2.0] },
    { p: [0, 0, -4.5] },
    { p: [5, 0, -4] },
    { p: [5, 0, 4.2] },
    { p: [2.6, 0, 3.6], note: 'pod žebříkem' },
    { p: [2.6, 3.2, 1.8], ladder: true, note: 'žebřík na střechu' },
    { p: [0, 3.2, 0], note: 'střecha' },
  ],
  walkableRoof: true,
  view: [[3.4, 1.6, -2.4], [-2.5, 1.0, 0.6]],
  notes: ['Výklenek: volná šířka 2,0 m, hloubka 1,5 m, světlost 3,0 m; boční stěny plné.'],
});

// ---------------------------------------------------------------------------
// A03 Přízemní dům s bočním schodištěm: 6 × 8 m (užší čelo), vstup vlevo, schody podél
// delší boční stěny, na střeše nádrž na ocelovém stojanu a krátká krycí přepážka.
// ---------------------------------------------------------------------------
reg(3, 'houseSideStair', 'Přízemní dům s bočním schodištěm', {
  describe: () => '6 × 8 m, vstup vlevo, schody podél boku, nádrž na stojanu, krycí přepážka',
  generate(_p, _seed, mat) {
    const R: Rect = [-3, -4, 3, 4];
    const H = 3.0;
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    parts.push(...shell(R, 0, H, { front: [door(1.5), win(-1.3)], left: [win(-1.6), win(2.0)], back: [win(0)] }, mat));
    parts.push(...partition([-2.7, 0.8], [2.7, 0.8], 0, H, [door(0.6, { w: 1.0 })], mat));
    parts.push(...roofSlab(R, H));
    const yR = H + M.slab;
    const sx = -3 - 0.6;
    const st = stairs(sx, -3.4, 'z+', 1.2, 0, yR, 'concreteLight', { solid: true, railSide: ['right'] });
    parts.push(...st.parts);
    const zTop = -3.4 + st.run;
    parts.push(...landing([-4.2, zTop, -3.0, zTop + 1.3], yR, 'concreteLight'));
    parts.push(...rail([-4.15, zTop], [-4.15, zTop + 1.25], yR), ...rail([-4.2, zTop + 1.25], [-3.0, zTop + 1.25], yR));
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM, { gaps: [{ side: 'right', from: zTop + 0.05, to: zTop + 1.2 }] }));
    // Nádrž na vysokém ocelovém stojanu a krycí přepážka (1,8 m) na střeše.
    parts.push(...tank(1.6, 2.6, yR, 1.3, 1.3, 1.4));
    parts.push({ shape: 'box', pos: [0.6, yR + 0.9, -1.6], size: [2.4, 1.8, 0.25], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [0.6, yR + 1.83, -1.6], size: [2.46, 0.06, 0.33], material: TRIM });
    parts.push(...bands(R, 0.35, null, 'concreteDark', TRIM));
    parts.push(...acBox(3.0, 0.5, 2.3, [1, 0]), ...spout(-1.5, 4.0, yR + 0.1, [0, 1]));
    parts.push(...table(-1.2, -2.4, 0.08), ...chair(-1.2, -1.75, 0.08, Math.PI), ...shelf(2.6, -1.2, 0.08, -Math.PI / 2, 1.0));
    parts.push(...mattress(-1.9, 2.6, 0.08), ...mattress(1.9, 2.6, 0.08), ...rug(0, 2.3, 0.08, 1.6, 2.0));
    return parts;
  },
}, {
  target: [6, 8, 3.2],
  route: [
    { p: [1.5, 0, -5.2] },
    { p: [1.5, 0.08, -2.0], note: 'přední pokoj' },
    { p: [0.6, 0.08, 0.2] },
    { p: [0.6, 0.08, 2.0], note: 'zadní pokoj' },
    { p: [0.6, 0.08, 0.2] },
    { p: [1.5, 0.08, -2.0] },
    { p: [1.5, 0, -5.2] },
    { p: [-3.6, 0, -4.2], note: 'pata schodů' },
    { p: [-3.6, 3.2, 2.6], note: 'podesta' },
    { p: [-2.0, 3.2, 2.6], note: 'střecha' },
    { p: [-1.4, 3.2, -2.4] },
    { p: [0.6, 3.2, -2.4], note: 'za přepážkou' },
  ],
  walkableRoof: true,
  view: [[2.4, 1.6, -3.4], [-1.5, 1.0, 0.8]],
  notes: ['Zábradlí schodů kovové: blokuje pohyb, střela projde.'],
});

// ---------------------------------------------------------------------------
// A04 Přízemní dům s členitým půdorysem (L): obálka 9 × 7 m, vnitřní kout = chráněný
// předprostor, dvě propojená křídla, rozdílná výška atik, venkovní žebřík na střechu.
// ---------------------------------------------------------------------------
reg(4, 'houseL', 'Přízemní dům s půdorysem L', {
  describe: () => 'obálka 9 × 7 m, dvě křídla, předprostor v koutě, žebřík na střechu',
  ladders: () => [ladderDef(4.55, 2.0, 0, 3.2, 'x-')],
  generate(_p, _seed, mat) {
    const H = 3.0;
    const A: Rect = [0.5, -3.5, 4.5, 3.5]; // levé křídlo (+X), celá hloubka
    const B: Rect = [-4.5, 0, 0.5, 3.5]; // zadní pravé křídlo
    const parts: Part[] = [];
    parts.push(...groundFloor(A), ...groundFloor(B));
    // Křídlo A: čelo, levý bok, záda (společná zeď přes obě křídla), pravá stěna do předprostoru.
    parts.push(...wall([0.5, -3.5 + t / 2], [4.5, -3.5 + t / 2], 0, H, t, [win(2.0)], mat, { out: [0, -1], trim: TRIM }));
    parts.push(...wall([4.5 - t / 2, -3.5 + t], [4.5 - t / 2, 3.5 - t], 0, H, t, [win(1.9), win(5.0)], mat, { out: [1, 0], trim: TRIM }));
    parts.push(...wall([-4.5, 3.5 - t / 2], [4.5, 3.5 - t / 2], 0, H, t, [win(2.0), win(7.0)], mat, { out: [0, 1], trim: TRIM }));
    parts.push(...wall([0.5 + t / 2, -3.5 + t], [0.5 + t / 2, 0], 0, H, t, [door(1.6)], mat, { out: [-1, 0], trim: TRIM }));
    parts.push(...partition([0.5 + t / 2, 0], [0.5 + t / 2, 3.2], 0, H, [door(1.6, { w: 1.1 })], mat));
    // Křídlo B: čelo do předprostoru s dveřmi a oknem, pravý bok.
    parts.push(...wall([-4.5, t / 2], [0.5, t / 2], 0, H, t, [door(2.6), win(0.9, { w: 0.9 })], mat, { out: [0, -1], trim: TRIM }));
    parts.push(...wall([-4.5 + t / 2, t], [-4.5 + t / 2, 3.5 - t], 0, H, t, [win(1.6)], mat, { out: [-1, 0], trim: TRIM }));
    parts.push(...roofSlab(A, H), ...roofSlab(B, H));
    const yR = H + M.slab;
    // Atiky: křídlo A 1,0 m (bez strany do B), křídlo B 0,6 m (bez strany do A).
    parts.push(...parapet(A, yR, 1.0, mat, TRIM, { gaps: [{ side: 'right', from: 0.0, to: 3.5 }, { side: 'left', from: 1.45, to: 2.55 }] }));
    parts.push(...parapet(B, yR, 0.6, mat, TRIM, { skip: ['left'] }));
    parts.push(...ladderParts(4.55, 2.0, 0, yR, 'x-'));
    // Předprostor: dlažba, nízká zídka (1,1 m) do ulice, lavička.
    parts.push({ shape: 'box', pos: [-2.0, 0.03, -1.75], size: [5.0, 0.06, 3.5], material: 'paving', collide: true });
    parts.push({ shape: 'box', pos: [-3.25, 0.55, -3.35], size: [2.5, 1.1, 0.3], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [-3.25, 1.13, -3.35], size: [2.56, 0.06, 0.38], material: TRIM });
    parts.push({ shape: 'box', pos: [-4.35, 0.55, -2.0], size: [0.3, 1.1, 2.4], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [-3.8, 0.22, -0.55], size: [1.4, 0.44, 0.4], material: 'wood', collide: true });
    parts.push(...bands(A, 0.35, null, 'concreteDark', TRIM));
    parts.push(...acBox(-2.0, 3.5, 2.3, [0, 1]), ...spout(4.5, -2.5, yR + 0.1, [1, 0]));
    parts.push(...table(3.3, -1.0, 0.08), ...chair(3.3, -0.35, 0.08, Math.PI), ...shelf(4.05, -2.6, 0.08, -Math.PI / 2, 1.0), ...rug(2.5, 1.6, 0.08, 2.0, 2.4));
    parts.push(...mattress(-3.6, 2.2, 0.08, Math.PI / 2), ...crate(-0.4, 2.8, 0.08, 0.6));
    return parts;
  },
}, {
  target: [9, 7, 3.2],
  route: [
    { p: [-2.0, 0, -5.0], note: 'ulice' },
    { p: [-2.0, 0.06, -1.6], note: 'předprostor' },
    { p: [-1.9, 0.08, 1.4], note: 'křídlo B' },
    { p: [1.8, 0.08, 1.4], note: 'průchod do křídla A' },
    { p: [2.5, 0.08, -2.4], note: 'křídlo A' },
    { p: [1.8, 0.08, -1.6] },
    { p: [-0.4, 0.06, -1.6], note: 'dveře A do předprostoru' },
    { p: [-2.0, 0, -5.0] },
    { p: [5.6, 0, -4.2] },
    { p: [5.0, 0, 2.0], note: 'pod žebříkem' },
    { p: [3.0, 3.2, 2.0], ladder: true },
    { p: [2.5, 3.2, -2.0], note: 'střecha A' },
    { p: [-2.0, 3.2, 1.8], note: 'střecha B' },
  ],
  walkableRoof: true,
  view: [[3.9, 1.6, -3.0], [1.0, 1.0, 2.6]],
  notes: ['Atiky: křídlo A 1,0 m, křídlo B 0,6 m; střechy propojené.'],
});

// ---------------------------------------------------------------------------
// Pomůcky pro patrové domy.
// ---------------------------------------------------------------------------

/** Poklop ve střeše s volně stojícím žebříkem: otvor [x0, z0, x1, z1], žebřík u hrany x0 (lezec se dívá k −X). */
export function hatch(h: Rect, yFloor: number, yRoof: number): { parts: Part[]; ladder: LadderLocal } {
  const lx = h[0] + 0.06, lz = (h[1] + h[3]) / 2;
  const parts = ladderParts(lx, lz, yFloor, yRoof - yFloor, 'x-');
  // Rám poklopu a odklopené víko (vzhled).
  parts.push({ shape: 'box', pos: [(h[0] + h[2]) / 2, yRoof + 0.05, h[1] - 0.05], size: [h[2] - h[0] + 0.1, 0.1, 0.1], material: 'paintedMetal' });
  parts.push({ shape: 'box', pos: [(h[0] + h[2]) / 2, yRoof + 0.05, h[3] + 0.05], size: [h[2] - h[0] + 0.1, 0.1, 0.1], material: 'paintedMetal' });
  parts.push({ shape: 'box', pos: [h[2] + 0.05, yRoof + 0.05, lz], size: [0.1, 0.1, h[3] - h[1]], material: 'paintedMetal' });
  parts.push({ shape: 'box', pos: [h[2] + 0.1, yRoof + (h[2] - h[0]) / 2, lz], rot: [0, 0, 0.15], size: [0.05, h[2] - h[0], h[3] - h[1]], material: 'paintedMetal' });
  return { parts, ladder: ladderDef(lx, lz, yFloor, yRoof - yFloor, 'x-') };
}

/** Zábradlí kolem otvoru schodiště ve stropě (strany bez nástupu). */
export function wellRail(h: Rect, y: number, open: 'x-' | 'x+' | 'z-' | 'z+'): Part[] {
  const [x0, z0, x1, z1] = h;
  const out: Part[] = [];
  if (open !== 'z-') out.push(...rail([x0, z0], [x1, z0], y));
  if (open !== 'z+') out.push(...rail([x0, z1], [x1, z1], y));
  if (open !== 'x-') out.push(...rail([x0, z0], [x0, z1], y));
  if (open !== 'x+') out.push(...rail([x1, z0], [x1, z1], y));
  return out;
}

// ---------------------------------------------------------------------------
// A05 / A06 – pilotní dvoupodlažní domy (GLB res_house_2f_a / _b) převedené do sady:
// zachované rozměry z jejich JSON (tělo 8,0 / 7,2 × 8,0 m, podlaží 3,15 m, schody podél
// levé stěny 18 stupňů, zadní žebřík na střechu x = −1,5) + doplněná okna ve všech
// podlažích a členění interiéru (pilot měl jediné okno).
// ---------------------------------------------------------------------------
function pilotHouse(W: number, recess: boolean, mat: string): Part[] {
  const hw = W / 2;
  const R: Rect = [-hw, -4, hw, 4];
  const S = 3.15, H = S - M.slab, y2 = 2 * S;
  const parts: Part[] = [];
  parts.push(...groundFloor(R));
  const zf = -4 + t / 2;
  if (recess) {
    const rw = 1.0, rd = 1.45;
    parts.push(...wall([-hw, zf], [-rw - t, zf], 0, H, t, [win(hw - rw - t - 1.35)], mat, { out: [0, -1], trim: TRIM }));
    parts.push(...wall([rw + t, zf], [hw, zf], 0, H, t, [win(1.35)], mat, { out: [0, -1], trim: TRIM }));
    for (const sgn of [-1, 1]) parts.push(...wall([sgn * (rw + t / 2), -4], [sgn * (rw + t / 2), -4 + rd], 0, H, t, [], mat, { plain: true }));
    parts.push(...wall([-rw - t, -4 + rd + t / 2], [rw + t, -4 + rd + t / 2], 0, H, t, [door(rw + t)], mat, { out: [0, -1], trim: TRIM }));
    parts.push({ shape: 'box', pos: [0, 0.04, -4 + rd / 2], size: [2 * rw, 0.08, rd], material: 'paving', collide: true });
  } else {
    parts.push(...wall([-hw, zf], [hw, zf], 0, H, t, [door(hw, { w: 1.4 }), win(1.2), win(W - 1.2)], mat, { out: [0, -1], trim: TRIM }));
    // Stříška nad vstupem na dvou konzolách.
    parts.push({ shape: 'box', pos: [0, 2.62, -4.45], size: [2.2, 0.1, 0.9], material: 'concreteLight', collide: true });
    for (const sx of [-0.95, 0.95]) parts.push({ shape: 'box', pos: [sx, 2.45, -4.15], rot: [0.6, 0, 0], size: [0.08, 0.5, 0.08], material: 'paintedMetal' });
  }
  const sideZ = recess ? [win(-2.2), win(1.6)] : [win(-1.6), win(2.0)];
  parts.push(...shell(R, 0, H, { right: sideZ, back: [win(-2.6), win(1.0)] }, mat, ['front']));
  // Schody podél levé (+X) stěny jako u pilotu.
  const sx = hw - t - 0.6;
  const st = stairs(sx, -2.8, 'z+', 1.15, 0.08, S, 'concreteLight', { railSide: ['right'] });
  parts.push(...st.parts);
  const zTop = -2.8 + st.run;
  const well: Rect = [sx - 0.62, -1.4, hw - t, zTop + 0.05];
  if (recess) parts.push(...partition([-hw + t, 1.0], [sx - 0.65, 1.0], 0, H, [door(-1.2, { w: 1.0 })], mat));
  else {
    parts.push(...partition([-hw + t, -0.6], [-0.4, -0.6], 0, H, [door(-1.9, { w: 1.0 })], mat));
    parts.push(...partition([-0.4, -0.6], [-0.4, 3.7], 0, H, [door(1.6, { w: 1.0 })], mat));
  }
  parts.push(...roofSlab(R, H, [well], FLOOR));
  // Patro.
  const upFront = recess ? [win(0, { w: 2.0, b: 1.0, t: 2.3 }), win(-2.6), win(2.6)] : [win(-2.2), win(0), win(2.2)];
  parts.push(...shell(R, S, H, { front: upFront, right: [win(-1.8), win(1.8)], left: [win(-2.6, { w: 0.9 })], back: [win(1.2)] }, mat));
  parts.push(...wellRail(well, S, 'z+'));
  parts.push(...partition([-hw + t, 0.6], [sx - 0.65, 0.6], S, H, [door(-0.6, { w: 1.0 })], mat));
  parts.push(...roofSlab(R, S + H));
  parts.push(...parapet(R, y2, M.parapet, mat, TRIM, { gaps: [{ side: 'back', from: -2.05, to: -0.95 }] }));
  parts.push(...ladderParts(-1.5, 4.05, 0, y2, 'z-'));
  parts.push(...tank(recess ? 1.6 : 1.44, 1.25, y2, 0.5, 1.0, 1.0));
  parts.push(...bands(R, 0.35, S - 0.05, 'concreteDark', TRIM));
  parts.push(...acBox(-hw, -1.0, 5.2, [-1, 0]), ...spout(hw - 0.6, -4, y2 + 0.1, [0, -1]));
  parts.push(...(recess ? [...table(-1.9, 0.0, 0.08), ...chair(-1.9, -0.65, 0.08, 0)] : [...table(-2.2, 1.8, 0.08), ...chair(-2.2, 1.15, 0.08, 0)]), ...rug(-1.2, -2.0, 0.08, 2.0, 1.4), ...shelf(-hw + t + 0.25, 2.4, 0.08, Math.PI / 2, 1.0));
  parts.push(...mattress(-hw + 1.0, 2.6, S, Math.PI / 2), ...crate(0.6, 3.3, S, 0.6), ...table(-1.6, -2.6, S, 1.2, 0.7), ...chair(-1.6, -2.0, S, Math.PI));
  return parts;
}

reg(5, 'house2Recess', 'Dvoupodlažní dům s hlubokým výklenkem (pilot, upravený)', {
  describe: () => '8 × 8 m, 2 podlaží po 3,15 m, výklenek 2,0 × 1,45 m, vnitřní schody, zadní žebřík; doplněná okna',
  ladders: () => [ladderDef(-1.5, 4.05, 0, 6.3, 'z-')],
  generate: (_p, _s, mat) => pilotHouse(8, true, mat),
}, {
  target: [8.08, 8.405, 7.6],
  route: [
    { p: [0, 0, -5.5], note: 'ulice' },
    { p: [0, 0.08, -3.2], note: 'výklenek' },
    { p: [0, 0.08, -1.6], note: 'za dveřmi' },
    { p: [1.8, 0.08, -1.8] },
    { p: [2.0, 0.08, -3.2] },
    { p: [3.1, 0.08, -3.25], note: 'pata schodů' },
    { p: [3.1, 3.15, 2.9], note: 'patro' },
    { p: [1.0, 3.15, 2.9] },
    { p: [-1.0, 3.15, 1.6] },
    { p: [-0.6, 3.15, -1.5], note: 'přední pokoj patra' },
    { p: [-1.5, 0, 6.0], teleport: true, note: 'za domem' },
    { p: [-1.5, 6.3, 2.5], ladder: true, note: 'žebřík na střechu' },
  ],
  walkableRoof: true,
  view: [[-3.3, 1.6, -3.3], [3.0, 1.5, 1.2]],
  notes: ['Pilot GLB (glb.res_house_2f_a) zůstává beze změny v kategorii Modely GLB.', 'Doplněno: 6 oken v přízemí, 7 v patře, příčky, zábradlí u schodišťového otvoru.'],
});

reg(6, 'house2Plain', 'Dvoupodlažní dům bez výklenku (pilot, upravený)', {
  describe: () => '7,2 × 8 m, 2 podlaží po 3,15 m, přímý vstup 1,4 m se stříškou, chodba a dva pokoje; doplněná okna',
  ladders: () => [ladderDef(-1.5, 4.05, 0, 6.3, 'z-')],
  generate: (_p, _s, mat) => pilotHouse(7.2, false, mat),
  defaultMaterial: 'plasterOchre',
}, {
  target: [7.28, 8.405, 7.6],
  route: [
    { p: [0, 0, -5.5], note: 'ulice' },
    { p: [0, 0.08, -3.0], note: 'za dveřmi' },
    { p: [-1.9, 0.08, -1.6] },
    { p: [-1.9, 0.08, 0.3], note: 'zadní pokoj' },
    { p: [-1.9, 0.08, -1.6] },
    { p: [0.8, 0.08, -3.2] },
    { p: [2.7, 0.08, -3.25], note: 'pata schodů' },
    { p: [2.7, 3.15, 2.9], note: 'patro' },
    { p: [0.6, 3.15, 2.9] },
    { p: [-0.6, 3.15, 1.4] },
    { p: [-0.6, 3.15, -1.5] },
    { p: [-1.5, 0, 6.0], teleport: true, note: 'za domem' },
    { p: [-1.5, 6.3, 2.5], ladder: true, note: 'žebřík na střechu' },
  ],
  walkableRoof: true,
  view: [[-3.0, 1.6, -3.3], [2.7, 1.5, 1.2]],
  notes: ['Pilot GLB (glb.res_house_2f_b) zůstává beze změny v kategorii Modely GLB.', 'Odlišení od A05: užší (7,2 m), přímý vstup se stříškou, chodba + dva pokoje v přízemí.'],
});

// ---------------------------------------------------------------------------
// A07 Dvoupodlažní dům s bočním zapuštěným vstupem: 8 × 7 m, výklenek u levého okraje
// čela (hloubka 1,8 m), nad ním balkon, hlavní schodiště podél zadní stěny, poklop na střechu.
// ---------------------------------------------------------------------------
const A07_HATCH: Rect = [-2.6, -1.4, -1.4, -0.2];
reg(7, 'house2SideRecess', 'Dvoupodlažní dům s bočním zapuštěným vstupem', {
  describe: () => '8 × 7 m, 2 podlaží, výklenek 2,0 × 1,8 m vlevo, balkon, schody u zadní stěny, poklop na střechu',
  ladders: () => [hatch(A07_HATCH, 3.2, 6.4).ladder],
  generate(_p, _seed, mat) {
    const R: Rect = [-4, -3.5, 4, 3.5];
    const H = 3.0, y1 = M.storey, y2 = 2 * M.storey;
    const rx0 = 1.7, rx1 = 3.7, rd = 1.8; // výklenek (x od–do), hloubka
    const parts: Part[] = [];
    parts.push(...groundFloor(R));
    const zf = -3.5 + t / 2;
    // Přízemí: čelo vpravo od výklenku, boční stěna výklenku, zadní stěna výklenku s dveřmi.
    parts.push(...wall([-4, zf], [rx0 - t, zf], 0, H, t, [win(1.4), win(3.9)], mat, { out: [0, -1], trim: TRIM }));
    parts.push(...wall([rx0 - t / 2, -3.5], [rx0 - t / 2, -3.5 + rd], 0, H, t, [], mat, { plain: true }));
    parts.push(...wall([rx0 - t, -3.5 + rd + t / 2], [4 - t, -3.5 + rd + t / 2], 0, H, t, [door(1.3)], mat, { out: [0, -1], trim: TRIM }));
    parts.push(...shell(R, 0, H, { left: [win(1.2)], right: [win(-1.5)], back: [win(-3.0, { b: 1.6 })] }, mat, ['front']));
    // Nárožní pilíř vlevo od výklenku.
    parts.push({ shape: 'box', pos: [4 - t / 2, H / 2, -3.5 + t / 2], size: [t, H, t], material: mat, collide: true });
    // Pravá zeď výklenku = levý obvod (plný), výklenek dlážděný.
    parts.push({ shape: 'box', pos: [(rx0 + rx1) / 2, 0.04, -3.5 + rd / 2], size: [rx1 - rx0, 0.08, rd], material: 'paving', collide: true });
    parts.push(...partition([-0.6, -3.2], [-0.6, 1.9], 0, H, [door(-1.0, { w: 1.0 })], mat));
    // Schodiště podél zadní stěny: nahoru k −X.
    const st = stairs(3.6, 2.6, 'x-', 1.1, 0.08, y1, 'concreteLight', { railSide: ['left'] });
    parts.push(...st.parts);
    const xTop = 3.6 - st.run;
    const well: Rect = [xTop - 0.05, 2.0, 2.4, 3.2];
    parts.push(...roofSlab(R, H, [well], FLOOR));
    // 1. patro.
    parts.push(...shell(R, y1, H, { front: [win(-2.6), win(-0.2), door(2.7)], left: [win(0.5)], right: [win(-1.5), win(1.5)], back: [win(0.5)] }, mat));
    parts.push(...partition([0.6, -3.2], [0.6, 1.9], y1, H, [door(-0.4, { w: 1.0 })], mat));
    parts.push(...wellRail(well, y1, 'x-'));
    // Balkon nad výklenkem.
    parts.push(...landing([rx0 - 0.1, -4.6, rx1 + 0.2, -3.45], y1, 'concreteLight', false));
    parts.push({ shape: 'box', pos: [(rx0 + rx1) / 2 + 0.05, y1 + 0.5, -4.52], size: [rx1 - rx0 + 0.3, 1.0, 0.16], material: mat, collide: true });
    for (const x of [rx0 - 0.02, rx1 + 0.12]) parts.push({ shape: 'box', pos: [x, y1 + 0.5, -4.05], size: [0.16, 1.0, 0.95], material: mat, collide: true });
    parts.push(...roofSlab(R, y1 + H, [A07_HATCH]));
    const yR = y2;
    parts.push(...parapet(R, yR, M.parapet, mat, TRIM));
    const ht = hatch(A07_HATCH, y1, yR);
    parts.push(...ht.parts);
    parts.push(...bands(R, 0.35, y1 - 0.05, 'concreteDark', TRIM));
    parts.push(...tank(2.4, 2.2, yR, 0.5, 1.0, 1.1), ...acBox(-2.0, 3.5, 4.8, [0, 1]), ...spout(-3.6, -3.5, yR + 0.1, [0, -1]));
    parts.push(...table(-2.4, -1.6, 0.08), ...chair(-2.4, -0.95, 0.08, Math.PI), ...rug(1.6, 0.2, 0.08, 1.8, 1.6), ...crate(3.4, 0.6, 0.08, 0.6));
    parts.push(...mattress(-3.0, 0.9, y1, Math.PI / 2), ...shelf(-0.85, -2.4, y1, Math.PI / 2, 1.0), ...table(2.5, -1.4, y1, 1.2, 0.7), ...chair(2.5, -0.8, y1, Math.PI));
    return parts;
  },
}, {
  target: [8, 7, 6.4],
  route: [
    { p: [2.7, 0, -5.0], note: 'ulice' },
    { p: [2.7, 0.08, -2.6], note: 'výklenek' },
    { p: [2.7, 0.08, -0.6], note: 'chodba' },
    { p: [3.2, 0.08, 1.0] },
    { p: [3.4, 0.08, 2.6], note: 'pata schodů' },
    { p: [-2.2, 3.2, 2.6], note: '1. patro' },
    { p: [-2.4, 3.2, 1.2] },
    { p: [-0.2, 3.2, -0.4] },
    { p: [1.6, 3.2, -0.4] },
    { p: [2.7, 3.2, -2.9] },
    { p: [2.7, 3.2, -4.1], note: 'balkon' },
    { p: [2.7, 3.2, -2.9] },
    { p: [1.6, 3.2, -0.4] },
    { p: [-0.2, 3.2, -0.4] },
    { p: [-3.1, 6.4, -0.8], ladder: true, note: 'poklopem na střechu' },
    { p: [0, 6.4, 1.5] },
  ],
  walkableRoof: true,
  view: [[-3.4, 1.6, -0.8], [3.0, 1.3, 2.6]],
  notes: ['Výklenek: volná šířka 2,0 m, hloubka 1,8 m; nad ním balkon 2,3 × 1,1 m.'],
});

// ---------------------------------------------------------------------------
// A08 Dvoupodlažní dům s podloubím: 10 × 8 m, přízemí ustupuje o 2,5 m pod patro
// neseným třemi sloupy; souvislý průchod podloubím, schody uvnitř, poklop na střechu.
// ---------------------------------------------------------------------------
const A08_HATCH: Rect = [-3.4, -0.6, -2.2, 0.6];
reg(8, 'house2Arcade', 'Dvoupodlažní dům s podloubím', {
  describe: () => '10 × 8 m, podloubí 2,5 m hluboké, světlost 2,65 m, 3 sloupy',
  ladders: () => [hatch(A08_HATCH, 3.2, 6.4).ladder],
  generate(_p, _seed, mat) {
    const R: Rect = [-5, -4, 5, 4];
    const G: Rect = [-5, -1.5, 5, 4]; // přízemí ustoupené
    const H = 3.0, y1 = M.storey, y2 = 2 * M.storey;
    const parts: Part[] = [];
    parts.push(...groundFloor(G));
    parts.push({ shape: 'box', pos: [0, 0.03, -2.75], size: [10, 0.06, 2.5], material: 'paving', collide: true });
    parts.push(...shell(G, 0, H, { front: [win(-3.0), door(1.0), win(3.4)], left: [win(1.2)], right: [win(1.2)], back: [win(-2.6), win(2.0)] }, mat));
    // Sloupy a průvlak pod čelem patra (spodní líc 2,65 m).
    for (const x of [-4.7, 0, 4.7]) parts.push({ shape: 'box', pos: [x, 1.4, -3.7], size: [0.55, 2.8, 0.55], material: mat, collide: true });
    for (const x of [-4.7, 0, 4.7]) parts.push({ shape: 'box', pos: [x, 0.15, -3.7], size: [0.65, 0.3, 0.65], material: 'concreteDark' });
    parts.push({ shape: 'box', pos: [0, 2.83, -3.75], size: [10, 0.36, 0.5], material: mat, collide: true });
    parts.push(...partition([-1.4, -1.2], [-1.4, 2.3], 0, H, [door(0.0, { w: 1.0 })], mat));
    const st = stairs(4.5, 3.1, 'x-', 1.1, 0.08, y1, 'concreteLight', { railSide: ['left'] });
    parts.push(...st.parts);
    const xTop = 4.5 - st.run;
    const well: Rect = [xTop - 0.05, 2.5, 3.3, 3.7];
    parts.push(...roofSlab(R, H, [well], FLOOR));
    // Patro na celé ploše.
    parts.push(...shell(R, y1, H, { front: [win(-3.4), win(-1.1), win(1.2), win(3.5)], left: [win(-1.5), win(1.5)], right: [win(-2.0), win(1.0)], back: [win(-1.0)] }, mat));
    parts.push(...partition([0.8, -3.7], [0.8, 2.4], y1, H, [door(-1.0, { w: 1.0 })], mat));
    parts.push(...wellRail(well, y1, 'x-'));
    parts.push(...roofSlab(R, y1 + H, [A08_HATCH]));
    parts.push(...parapet(R, y2, M.parapet, mat, TRIM));
    parts.push(...hatch(A08_HATCH, y1, y2).parts);
    parts.push(...bands(R, 0, y1 - 0.05, 'concreteDark', TRIM));
    parts.push(...tank(3.4, 2.0, y2, 0.6, 1.2, 1.2), ...acBox(-3.0, 4.0, 4.9, [0, 1]), ...acBox(5.0, -1.0, 2.3, [1, 0]));
    parts.push(...table(-3.2, 1.2, 0.08), ...chair(-3.2, 0.55, 0.08, 0), ...chair(-3.2, 1.85, 0.08, Math.PI), ...shelf(-4.55, -0.4, 0.08, Math.PI / 2, 1.0), ...rug(2.4, 0.6, 0.08, 2.0, 1.6));
    parts.push(...mattress(3.8, -2.0, y1), ...mattress(-4.0, 2.6, y1, Math.PI / 2), ...table(-2.0, -2.4, y1, 1.2, 0.7), ...crate(4.3, 0.4, y1, 0.55));
    return parts;
  },
}, {
  target: [10, 8, 6.4],
  route: [
    { p: [-6.0, 0, -2.75], note: 'podloubí – začátek' },
    { p: [6.0, 0, -2.75], note: 'podloubí – konec (souvislý průchod)' },
    { p: [1.0, 0.06, -2.75] },
    { p: [1.0, 0.08, -0.4], note: 'přízemí' },
    { p: [4.3, 0.08, 1.2] },
    { p: [4.3, 0.08, 3.1], note: 'pata schodů' },
    { p: [-1.1, 3.2, 3.1], note: 'patro' },
    { p: [-1.4, 3.2, 1.6] },
    { p: [-3.9, 6.4, 0.0], ladder: true, note: 'poklopem na střechu' },
    { p: [1.0, 6.4, -2.0] },
  ],
  walkableRoof: true,
  view: [[-0.9, 1.6, -0.9], [4.0, 1.4, 3.0]],
  notes: ['Podloubí: hloubka 2,5 m, světlá výška pod průvlakem 2,65 m.'],
});

// ---------------------------------------------------------------------------
// A09 Dvoupodlažní dům s ustoupeným patrem: přízemí 9 × 8 m, patro 6 × 6 m vzadu vpravo,
// terasa s atikou, dveře z patra na terasu, žebřík z terasy na nejvyšší střechu.
// ---------------------------------------------------------------------------
reg(9, 'house2Setback', 'Dvoupodlažní dům s ustoupeným patrem', {
  describe: () => 'přízemí 9 × 8 m, patro 6 × 6 m, terasa ve tvaru L, žebřík na horní střechu',
  ladders: () => [ladderDef(1.55, 1.0, 3.2, 3.2, 'x-')],
  generate(_p, _seed, mat) {
    const G: Rect = [-4.5, -4, 4.5, 4];
    const U: Rect = [-4.5, -2, 1.5, 4];
    const H = 3.0, y1 = M.storey, y2 = 2 * M.storey;
    const parts: Part[] = [];
    parts.push(...groundFloor(G));
    parts.push(...shell(G, 0, H, { front: [win(-2.6), door(0.6), win(3.0)], left: [win(-1.6), win(1.8)], right: [win(-2.6)], back: [win(-1.5), win(2.5)] }, mat));
    parts.push(...partition([-1.6, -3.7], [-1.6, -0.6], 0, H, [], mat));
    parts.push(...partition([1.8, -0.6], [4.2, -0.6], 0, H, [door(3.0, { w: 1.0 })], mat));
    // Schody podél pravé stěny (−X): nahoru dozadu, vyústí v patře.
    const st = stairs(-3.6, -2.6, 'z+', 1.1, 0.08, y1, 'concreteLight', { railSide: ['left'] });
    parts.push(...st.parts);
    const zTop = -2.6 + st.run;
    const well: Rect = [-4.2, -1.4, -3.0, zTop + 0.05];
    parts.push(...roofSlab(G, H, [well], FLOOR));
    // Patro (ustoupené) s dveřmi na terasu.
    parts.push(...shell(U, y1, H, { front: [door(-1.4), win(0.4)], left: [win(1.0, { w: 1.0 })], back: [win(-1.5)], right: [win(2.4)] }, mat));
    parts.push(...wellRail(well, y1, 'z+'));
    parts.push(...roofSlab(U, y1 + H));
    // Atika terasy (po obvodu přízemí kromě stěn patra) a atika horní střechy s průchodem k žebříku.
    parts.push(...parapet(G, y1, M.parapet, mat, TRIM, { gaps: [{ side: 'back', from: -4.5, to: 1.55 }, { side: 'right', from: -2.05, to: 4 }] }));
    parts.push(...parapet(U, y2, 0.8, mat, TRIM, { gaps: [{ side: 'left', from: 0.5, to: 1.5 }] }));
    parts.push(...ladderParts(1.55, 1.0, y1, H + M.slab, 'x-'));
    // Pergola nad částí terasy, květináče.
    // Pergola nad levým předním rohem terasy: trámky od stěny patra k nosníku na dvou sloupcích.
    for (let i = 0; i < 6; i++) parts.push({ shape: 'box', pos: [2.95, y1 + 2.55, -3.3 + i * 0.55], size: [2.9, 0.1, 0.08], material: 'woodDark' });
    for (const z of [-3.55, -0.6]) parts.push({ shape: 'box', pos: [4.1, y1 + 1.25, z], size: [0.12, 2.5, 0.12], material: 'woodDark', collide: true });
    parts.push({ shape: 'box', pos: [4.1, y1 + 2.45, -2.07], size: [0.14, 0.14, 3.2], material: 'woodDark' });
    parts.push({ shape: 'box', pos: [1.6, y1 + 2.45, -2.6], size: [0.14, 0.14, 1.6], material: 'woodDark' });
    parts.push(...table(3.0, 2.8, y1), ...chair(2.4, 2.8, y1, Math.PI / 2), ...chair(3.6, 2.8, y1, -Math.PI / 2));
    parts.push(...bands(G, 0.35, y1 - 0.05, 'concreteDark', TRIM));
    parts.push(...acBox(-4.5, 1.0, 5.2, [-1, 0]), ...spout(-3.8, 4.0, y2 + 0.1, [0, 1]));
    parts.push(...table(2.8, 1.6, 0.08), ...chair(2.8, 2.25, 0.08, Math.PI), ...shelf(-2.0, 3.6, 0.08, Math.PI, 1.2), ...rug(-0.4, -2.2, 0.08, 1.8, 2.0));
    parts.push(...mattress(-2.0, 2.4, y1, Math.PI / 2), ...shelf(1.1, 3.0, y1, -Math.PI / 2, 1.0));
    return parts;
  },
}, {
  target: [9, 8, 6.4],
  route: [
    { p: [0.6, 0, -5.2], note: 'ulice' },
    { p: [0.6, 0.08, -2.4], note: 'přízemí' },
    { p: [-2.6, 0.08, -0.4] },
    { p: [-3.6, 0.08, -3.2], note: 'pata schodů' },
    { p: [-3.6, 3.2, 3.0], note: 'patro' },
    { p: [-1.6, 3.2, 3.0] },
    { p: [-1.6, 3.2, 2.0] },
    { p: [-1.4, 3.2, -1.2] },
    { p: [-1.4, 3.2, -3.0], note: 'terasa' },
    { p: [2.8, 3.2, -3.0] },
    { p: [2.4, 3.2, 1.0], note: 'pod žebříkem' },
    { p: [0.5, 6.4, 1.0], ladder: true, note: 'horní střecha' },
    { p: [-1.5, 6.4, 1.0] },
  ],
  walkableRoof: true,
  view: [[3.8, 1.6, 1.2], [-3.6, 1.2, -2.4]],
  notes: ['Terasa ve tvaru L (pruh 2 m vpředu, 3 m vlevo) s atikou 1,0 m.'],
});

// ---------------------------------------------------------------------------
// A10 Dům s malým uzavřeným dvorem: obálka 11 × 10 m, jednopodlažní blok vzadu, dvůr
// obehnaný 2m zdí, otevřená brána, nádrž a lavička; žebřík ze dvora na střechu.
// ---------------------------------------------------------------------------
reg(10, 'houseCourtyard', 'Dům s malým uzavřeným dvorem', {
  describe: () => 'obálka 11 × 10 m, dvůr 11 × 6,5 m, zeď 2 m, brána 3 m, žebřík na střechu',
  ladders: () => [ladderDef(4.5, 1.45, 0, 3.2, 'z+')],
  generate(_p, _seed, mat) {
    const Bk: Rect = [-5.5, 1.5, 5.5, 5];
    const H = 3.0;
    const parts: Part[] = [];
    parts.push(...groundFloor(Bk));
    parts.push(...shell(Bk, 0, H, { front: [win(-3.8), door(-1.6), win(1.0), door(3.0)], back: [win(-3.0), win(2.6)], left: [win(3.25, { w: 1.0 })], right: [win(3.25, { w: 1.0 })] }, mat));
    parts.push(...partition([1.6, 1.8], [1.6, 4.7], 0, H, [door(3.6, { w: 1.0 })], mat));
    parts.push(...roofSlab(Bk, H));
    const yR = H + M.slab;
    parts.push(...parapet(Bk, yR, M.parapet, mat, TRIM, { gaps: [{ side: 'front', from: 4.0, to: 5.0 }] }));
    parts.push(...ladderParts(4.5, 1.45, 0, yR, 'z+'));
    // Dvorní zeď 2 m s krycí deskou, brána 3 m s otevřenými křídly (otočenými dovnitř).
    const wh = 2.0, wt = 0.3;
    parts.push(...wall([-5.5, -5 + wt / 2], [5.5, -5 + wt / 2], 0, wh, wt, [{ c: 5.5, w: 3.0, b: 0, t: wh, kind: 'pass', bare: true }], mat, { plain: true }));
    for (const s of [-1, 1]) parts.push(...wall([s * (5.5 - wt / 2), -5 + wt], [s * (5.5 - wt / 2), 1.5], 0, wh, wt, [], mat, { plain: true }));
    for (const [cx, len] of [[-3.5, 4.0], [3.5, 4.0]] as const) parts.push({ shape: 'box', pos: [cx, wh + 0.04, -5 + wt / 2], size: [len + 0.06, 0.08, wt + 0.1], material: TRIM });
    for (const s of [-1, 1]) {
      parts.push({ shape: 'box', pos: [s * 5.35, wh + 0.04, -1.75], size: [wt + 0.1, 0.08, 6.5], material: TRIM });
      // Pilíře brány a otevřené křídlo (plech na rámu, kolize – stojí mimo průjezd).
      parts.push({ shape: 'box', pos: [s * 1.7, wh / 2 + 0.15, -5 + wt / 2], size: [0.45, wh + 0.3, 0.45], material: mat, collide: true });
      parts.push({ shape: 'box', pos: [s * 1.55, 1.0, -4.0], size: [0.05, 1.9, 1.45], material: 'paintedMetalBlue', collide: true });
    }
    parts.push({ shape: 'box', pos: [0, 0.03, -1.75], size: [10.4, 0.06, 6.5], material: 'paving', collide: true });
    // Nádrž ve dvoře, lavička, bedny.
    parts.push(...tank(4.2, -3.6, 0.06, 1.2, 1.2, 1.3));
    parts.push({ shape: 'box', pos: [-4.0, 0.25, -0.2], size: [1.8, 0.5, 0.45], material: 'wood', collide: true });
    parts.push({ shape: 'box', pos: [-4.0, 0.7, 0.0], size: [1.8, 0.45, 0.06], material: 'wood' });
    parts.push(...crate(-4.6, -4.2, 0.06, 0.6), ...crate(-4.0, -4.3, 0.06, 0.5));
    parts.push(...bands(Bk, 0.35, null, 'concreteDark', TRIM));
    parts.push(...acBox(-1.0, 5.0, 2.3, [0, 1]));
    parts.push(...table(-3.4, 3.4, 0.08), ...chair(-2.8, 3.4, 0.08, -Math.PI / 2), ...rug(-1.0, 3.2, 0.08, 2.0, 1.6), ...mattress(3.6, 4.1, 0.08, Math.PI / 2), ...shelf(5.05, 2.8, 0.08, -Math.PI / 2, 1.0));
    return parts;
  },
}, {
  target: [11, 10, 3.2],
  route: [
    { p: [0, 0, -6.5], note: 'ulice' },
    { p: [0, 0.06, -2.0], note: 'dvůr' },
    { p: [-1.6, 0.06, 0.6] },
    { p: [-1.6, 0.08, 3.0], note: 'obytná místnost' },
    { p: [1.4, 0.08, 3.6] },
    { p: [3.0, 0.08, 3.6], note: 'druhý pokoj' },
    { p: [3.0, 0.06, 0.6], note: 'dveře do dvora' },
    { p: [4.5, 0.06, 0.95], note: 'pod žebříkem' },
    { p: [4.5, 3.2, 2.8], ladder: true, note: 'střecha' },
    { p: [-2.0, 3.2, 3.2] },
  ],
  walkableRoof: true,
  view: [[-5.0, 1.6, 2.2], [1.0, 1.2, 4.2]],
  notes: ['Dvorní zeď 2,0 m s krycí deskou; křídla brány otevřená dovnitř mimo průjezd.'],
});

/** Parametr materiálu je společný (WALL_MATS); jiné parametry zatím nejsou. */
export const n = (p: Params, k: string) => p[k] as number;
