import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import { M, chair, coreFlights, coreLayout, crate, door, ladderDef, ladderParts, parapet, rail, shelf, table, wall, win, type Op, type Rect } from './bk';
import { bx, rubble, thru } from './modules';
import { TRIM, groundFloor, hatch, partition, reg, roofSlab, shell, type SetMeta } from './residential';

/**
 * Sada 300 · D Obchody a městská vybavenost (položky 86–105): stánky, kiosky, kavárny, dílny,
 * čerpací stanice, věž, kupole, škola, úřad a tržnice.
 * Konvence jako u B/C. Patrové budovy (škola, úřad) jsou ve výchozím stavu uzavřené (BF2)
 * s přepínačem „Přístupný interiér“.
 */
const t = M.wall;
const S = M.storey;
const H = S - M.slab;
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regD = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, 'D');
const CONC = 'concreteLight';
const AWN = ['awningRed', 'awningBlue', 'awningGreen', 'awningSand'];

// ---------------------------------------------------------------------------
// Pomocné díly
// ---------------------------------------------------------------------------
/** Sloupek (kovový / dřevěný) od země do výšky h. */
const post = (x: number, z: number, h: number, mat = 'paintedMetal', s = 0.08): Part => ({ ...bx(x - s / 2, x + s / 2, 0, h, z - s / 2, z + s / 2, mat), collide: true });

/** Plachta s mírným prověšením: dvě poloviny skloněné ke středu (vzhled, bez kolize). */
function canopy(x0: number, x1: number, z0: number, z1: number, y: number, sag: number, mat: string, slopeZ = 0): Part[] {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const a = Math.atan2(sag, w / 2);
  const L = Math.hypot(w / 2, sag);
  const tilt = Math.atan2(slopeZ, d);
  return [
    { shape: 'box', pos: [cx - w / 4, y - sag / 2, cz], rot: [tilt, 0, -a], size: [L + 0.02, 0.02, Math.hypot(d, slopeZ)], material: mat },
    { shape: 'box', pos: [cx + w / 4, y - sag / 2, cz], rot: [tilt, 0, a], size: [L + 0.02, 0.02, Math.hypot(d, slopeZ)], material: mat },
    // Lem plachty (volánek) vpředu.
    { shape: 'box', pos: [cx, y - 0.12, z0 - Math.sign(slopeZ || 0) * 0], size: [w, 0.22, 0.015], material: mat },
  ];
}

/** Pult: plná dřevěná skříň (kryt), deska navrch. */
const counter = (x0: number, x1: number, z0: number, z1: number, h = 0.95, mat = 'wood'): Part[] => [
  bx(x0, x1, 0, h - 0.04, z0, z1, mat),
  bx(x0 - 0.03, x1 + 0.03, h - 0.04, h, z0 - 0.04, z1 + 0.03, 'woodDark', false),
];

/** Zboží na pultu (bedýnky s ovocem), jen vzhled. */
function goods(x0: number, x1: number, z: number, y: number, seed: number): Part[] {
  const r = rng(seed), out: Part[] = [];
  for (let x = x0 + 0.25; x < x1 - 0.2; x += 0.45) out.push({ shape: 'box', pos: [x, y + 0.1, z], rot: [0, (r() - 0.5) * 0.2, 0], size: [0.4, 0.2, 0.3], material: ['crateFruitA', 'crateFruitB', 'crateFruitC'][Math.floor(r() * 3)] });
  return out;
}

const roofFlat = (x0: number, x1: number, z0: number, z1: number, y: number, over = 0.1): Part[] => [
  bx(x0 - over, x1 + over, y, y + 0.18, z0 - over, z1 + over, CONC),
  bx(x0, x1, y + 0.18, y + 0.192, z0, z1, 'roof', false),
];

// ---------------------------------------------------------------------------
// D86–D89 Tržní stánky
// ---------------------------------------------------------------------------
regD(86, 'stallSmall', 'Malý tržní stánek', {
  describe: () => '2,5 × 2 × 2,6 m, 4 sloupky, plachta s prověšením, pult 0,95 m vpředu, vstup zezadu',
  generate(_p, seed) {
    const W = 2.5, D = 2, h = 2.6;
    const parts: Part[] = [];
    for (const [x, z] of [[-W / 2 + 0.05, -D / 2 + 0.05], [W / 2 - 0.05, -D / 2 + 0.05], [-W / 2 + 0.05, D / 2 - 0.05], [W / 2 - 0.05, D / 2 - 0.05]] as const) parts.push(post(x, z, z < 0 ? h : h - 0.2));
    parts.push(...canopy(-W / 2 - 0.1, W / 2 + 0.1, -D / 2 - 0.25, D / 2 + 0.05, h, 0.12, AWN[seed % 4], -0.2));
    parts.push(...counter(-W / 2 + 0.1, W / 2 - 0.1, -D / 2 + 0.1, -D / 2 + 0.65));
    parts.push(...goods(-W / 2 + 0.1, W / 2 - 0.1, -D / 2 + 0.38, 0.95, seed));
    parts.push(...crate(-0.7, 0.5, 0, 0.5));
    return parts;
  },
}, {
  target: [2.5, 2, 2.6],
  route: [{ p: [0.3, 0, 2.0], note: 'za stánkem' }, { p: [0.3, 0, 0.0], note: 'za pultem (vstup zezadu)' }, { p: [0.3, 0, 2.0] }],
  walkableRoof: false,
  rays: [thru(0, 0.6, true, 'pult kryje vkleče', -3, 0), thru(0, 1.6, false, 'nad pultem volno', -3, 0)],
  notes: ['Pult je plná skříň (kryt vkleče), plachta je jen vzhled (střely projdou).'],
});

regD(87, 'stallWide', 'Široký tržní stánek', {
  describe: () => '4 × 2,5 × 2,8 m, 2 pulty, vyšší zadní police 1,8 m, prověšená plachta, vstupy po stranách police',
  generate(_p, seed) {
    const W = 4, D = 2.5, h = 2.8;
    const parts: Part[] = [];
    for (const x of [-W / 2 + 0.05, 0, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) parts.push(post(x, z, z < 0 ? h : h - 0.25));
    parts.push(...canopy(-W / 2 - 0.1, W / 2 + 0.1, -D / 2 - 0.3, D / 2 + 0.05, h, 0.18, AWN[(seed + 1) % 4], -0.25));
    parts.push(...counter(-W / 2 + 0.1, -0.15, -D / 2 + 0.1, -D / 2 + 0.7), ...counter(0.15, W / 2 - 0.1, -D / 2 + 0.1, -D / 2 + 0.7));
    parts.push(...goods(-W / 2 + 0.1, -0.15, -D / 2 + 0.4, 0.95, seed), ...goods(0.15, W / 2 - 0.1, -D / 2 + 0.4, 0.95, seed + 3));
    // Zadní police (vyšší), uprostřed; po stranách vstupy.
    parts.push(bx(-1.2, 1.2, 0, 1.8, D / 2 - 0.55, D / 2 - 0.15, 'wood'));
    for (const y of [0.6, 1.2]) parts.push(...goods(-1.2, 1.2, D / 2 - 0.35, y, seed + y * 10));
    return parts;
  },
}, {
  target: [4, 2.5, 2.8],
  route: [{ p: [-1.6, 0, 2.2], note: 'za stánkem' }, { p: [-1.55, 0, 0.6], note: 'vstup vedle police' }, { p: [0.0, 0, 0.0], note: 'za pulty' }, { p: [1.55, 0, 0.6] }, { p: [1.6, 0, 2.2], note: 'ven druhou stranou' }],
  walkableRoof: false,
  rays: [thru(-1.0, 0.6, true, 'pult kryje', -3, -0.3), thru(0, 1.3, true, 'zadní police kryje zezadu', 3, 0.5)],
  notes: ['Dva pulty s mezerou 0,3 m (není průchod), zadní police 2,4 m široká – vstupy 0,6 m po stranách.'],
});

regD(88, 'stallCorner', 'Rohový tržní stánek', {
  describe: () => 'půdorys L 4 × 4 m (ramena 2 m), pulty do dvou ulic (−Z a −X), uvnitř ulička 1,2 m, krytý zadní vstup',
  generate(_p, seed) {
    const h = 2.7, parts: Part[] = [];
    // Ramena: A = x −2…2, z −2…0 ; B = x −2…0, z 0…2.
    for (const [x, z] of [[-1.95, -1.95], [0, -1.95], [1.95, -1.95], [1.95, -0.05], [0.05, -0.05], [0.05, 1.95], [-1.95, 1.95], [-1.95, 0]] as const) parts.push(post(x, z, h));
    parts.push(...canopy(-2.1, 2.1, -2.3, 0.05, h, 0.12, AWN[(seed + 2) % 4], -0.15), ...canopy(-2.1, 0.1, 0.05, 2.1, h - 0.02, 0.1, AWN[(seed + 2) % 4]));
    parts.push(...counter(-1.9, 1.9, -1.9, -1.4), ...counter(-1.9, -1.4, -1.4, 1.9));
    parts.push(...goods(-1.9, 1.9, -1.65, 0.95, seed), ...goods(-1.9, -1.4, 0.2, 0.95, seed + 4).map((p) => ({ ...p, pos: [-1.65, p.pos[1], p.pos[0]] as V3 })));
    // Zadní stěny (plachtovina) na vnitřních hranách kromě vstupu 1,2 m v koutě (krytý stříškou).
    parts.push(bx(0.05, 1.95, 0.3, 2.3, -0.06, -0.02, 'fabricSand', false), bx(0.02, 0.06, 0.3, 2.3, 1.25, 1.95, 'fabricSand', false));
    parts.push(...canopy(0.05, 1.4, 0.0, 1.3, h - 0.25, 0.05, 'fabricSand'));
    return parts;
  },
}, {
  target: [4, 4, 2.7],
  route: [{ p: [1.0, 0, 1.0], note: 'u krytého zadního vstupu' }, { p: [-0.5, 0, 0.7], note: 'vstup' }, { p: [-0.7, 0, -0.7], note: 'ulička za pulty' }, { p: [1.4, 0, -0.8] }, { p: [-0.7, 0, 1.4] }],
  walkableRoof: false,
  rays: [thru(0.8, 0.6, true, 'přední pult kryje', -3, -1.0), { from: [-3, 0.6, 1.0], to: [-1.0, 0.6, 1.0], hit: true, note: 'boční pult kryje' }],
  notes: ['Zadní vstup v koutě L pod malou stříškou; plachtovina na zadních stranách je jen vzhled.'],
});

regD(89, 'stallDamaged', 'Poškozený tržní stánek', {
  describe: () => '2,5 × 2 m, jeden sloupek nakloněný, utržená půlka plachty, pult částečně rozbitý',
  generate(_p, seed) {
    const W = 2.5, D = 2, h = 2.6, r = rng(seed);
    const parts: Part[] = [post(-W / 2 + 0.05, -D / 2 + 0.05, h), post(-W / 2 + 0.05, D / 2 - 0.05, h - 0.2), post(W / 2 - 0.05, D / 2 - 0.05, h - 0.2)];
    // Nakloněný sloupek vpravo vpředu.
    parts.push({ shape: 'box', pos: [W / 2 - 0.25, h / 2 - 0.1, -D / 2 + 0.15], rot: [0.12, 0, 0.3], size: [0.08, h, 0.08], material: 'paintedMetal', collide: true });
    // Levá půlka plachty drží, pravá visí utržená skoro k zemi.
    const mat = AWN[(seed + 3) % 4];
    parts.push({ shape: 'box', pos: [-W / 4, h - 0.06, 0], rot: [0.1, 0, -0.08], size: [W / 2 + 0.1, 0.02, D + 0.3], material: mat });
    parts.push({ shape: 'box', pos: [W / 4 + 0.1, h - 0.75, -0.2], rot: [0.2, 0.1, 1.05], size: [1.5, 0.02, D * 0.8], material: mat });
    // Pult: levá část celá, pravá ulomená (nižší) s prkny na zemi.
    parts.push(...counter(-W / 2 + 0.1, 0.2, -D / 2 + 0.1, -D / 2 + 0.65));
    parts.push(bx(0.2, W / 2 - 0.1, 0, 0.45, -D / 2 + 0.1, -D / 2 + 0.65, 'wood'));
    for (let i = 0; i < 4; i++) parts.push({ shape: 'box', pos: [0.7 + r() * 0.6, 0.04, -1.4 - r() * 0.5], rot: [0, r() * 3, 0], size: [0.9, 0.03, 0.12], material: 'woodDark' });
    parts.push(...goods(-W / 2 + 0.1, 0.2, -D / 2 + 0.38, 0.95, seed));
    parts.push({ shape: 'box', pos: [0.9, 0.12, -1.6], rot: [0.3, 0.5, 0.2], size: [0.4, 0.2, 0.3], material: 'crateFruitB' });
    return parts;
  },
}, {
  target: [2.5, 2, 2.6],
  route: [{ p: [-0.4, 0, 2.0], note: 'za stánkem' }, { p: [-0.4, 0, 0.1], note: 'za pultem' }, { p: [-0.4, 0, 2.0] }],
  walkableRoof: false,
  rays: [thru(-0.6, 0.6, true, 'celá část pultu kryje', -3, 0), thru(0.8, 0.6, false, 'ulomená část už nekryje vkleče', -3, 0)],
  notes: ['Nakloněný sloupek má kolizi (překážka), utržená plachta je jen vzhled.'],
});

// ---------------------------------------------------------------------------
// D90–D91 Kiosek a otevřená budka
// ---------------------------------------------------------------------------
regD(90, 'kiosk', 'Prodejní kiosek', {
  describe: () => '3 × 3 × 2,8 m, pevná budka, prodejní okno 1,6 × 1,05 m s pultem, boční dveře 1,1 × 2,2 m, pult uvnitř',
  generate(_p, _s, mat) {
    const W = 3, D = 3, h = 2.6, wt = 0.2;
    const parts: Part[] = [];
    parts.push(...wall([-W / 2, -D / 2 + wt / 2], [W / 2, -D / 2 + wt / 2], 0, h, wt, [{ c: W / 2, w: 1.6, b: 0.95, t: 2.0, kind: 'window' }], mat, { out: [0, -1], trim: TRIM }));
    parts.push(bx(-W / 2, W / 2, 0, h, D / 2 - wt, D / 2, mat));
    parts.push(bx(-W / 2, -W / 2 + wt, 0, h, -D / 2 + wt, D / 2 - wt, mat));
    parts.push(...wall([W / 2 - wt / 2, -D / 2 + wt], [W / 2 - wt / 2, D / 2 - wt], 0, h, wt, [{ c: (D - 2 * wt) / 2 + 0.3, w: 1.1, b: 0, t: 2.2, kind: 'door' }], mat, { out: [1, 0], trim: TRIM }));
    parts.push(...roofFlat(-W / 2, W / 2, -D / 2, D / 2, h, 0.25));
    // Venkovní parapet okna (pult) a vnitřní pult pod oknem.
    parts.push(bx(-0.85, 0.85, 0.93, 0.97, -D / 2 - 0.25, -D / 2 + wt, 'woodDark', false));
    parts.push(...counter(-1.2, 1.2, -D / 2 + wt, -D / 2 + wt + 0.5));
    parts.push(...shelf(-0.6, D / 2 - wt - 0.2, 0, Math.PI));
    parts.push(bx(-W / 2 + wt, W / 2 - wt, 0, 0.04, -D / 2 + wt, D / 2 - wt, 'plazaTile'));
    return parts;
  },
}, {
  target: [3, 3, 2.8],
  route: [{ p: [2.4, 0, 0.3], note: 'u bočních dveří' }, { p: [0.3, 0.04, 0.4], note: 'uvnitř za pultem' }, { p: [2.4, 0, 0.3] }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'prodejním oknem projde střela', -3, 0), thru(1.2, 1.5, true, 'stěna kiosku kryje', -3, 0)],
  notes: ['Prodejní okno je otvor (průstřel), pult pod ním kryje vkleče.'],
});

regD(91, 'boothOpen', 'Otevřená prodejní budka', {
  describe: () => '3 × 2,5 × 2,6 m, tři pevné stěny, otevřené čelo s pultem, stříška přesahuje 0,8 m nad pult',
  generate(_p, seed, mat) {
    const W = 3, D = 2.5, h = 2.6, wt = 0.15;
    const parts: Part[] = [];
    parts.push(bx(-W / 2, W / 2, 0, h, D / 2 - wt, D / 2, mat), bx(-W / 2, -W / 2 + wt, 0, h, -D / 2, D / 2 - wt, mat), bx(W / 2 - wt, W / 2, 0, h, -D / 2, D / 2 - wt, mat));
    // Pult přes čelo, u pravé stěny průchod 1,1 m dovnitř.
    parts.push(...counter(-W / 2 + wt, W / 2 - wt - 1.15, -D / 2 + 0.05, -D / 2 + 0.6));
    parts.push(...goods(-W / 2 + wt, W / 2 - wt - 1.15, -D / 2 + 0.32, 0.95, seed));
    parts.push(bx(-W / 2 - 0.05, W / 2 + 0.05, h, h + 0.12, -D / 2 - 0.8, D / 2 + 0.05, 'metalSheet', false));
    parts.push({ shape: 'box', pos: [0, h - 0.12, -D / 2 - 0.78], size: [W + 0.1, 0.24, 0.03], material: AWN[seed % 4] });
    parts.push(...shelf(0.2, D / 2 - wt - 0.2, 0, Math.PI, 1.6));
    return parts;
  },
}, {
  target: [3, 2.5, 2.6],
  route: [{ p: [0.8, 0, -2.0], note: 'před budkou' }, { p: [0.8, 0, -0.6], note: 'průchod vedle pultu' }, { p: [-0.6, 0, 0.0], note: 'za pultem' }],
  walkableRoof: false,
  rays: [thru(-0.6, 0.6, true, 'pult kryje', -3, -0.5), { from: [-3, 1.5, 0], to: [3, 1.5, 0], hit: true, note: 'boční stěny kryjí' }],
  notes: ['Stříška je vzhled (střely projdou), stěny a pult mají kolizi.'],
});

// ---------------------------------------------------------------------------
// D92–D93 Kavárny
// ---------------------------------------------------------------------------
/** Stolek s židlemi venku (vzhled + nízké kolize). */
const bistro = (x: number, z: number, y = 0): Part[] => [...table(x, z, y, 0.8, 0.8), ...chair(x - 0.6, z, y, Math.PI / 2), ...chair(x + 0.6, z, y, -Math.PI / 2)];

regD(92, 'cafeSmall', 'Malá kavárna s posezením', {
  describe: () => 'průčelí 6 m, přístupný interiér 6 × 5 m, výlohy, vstup, bar, 2 stolky pod markýzou, volný chodník 1,6 m u fasády',
  generate(_p, seed, mat) {
    const R: Rect = [-3, -2.5, 3, 2.5];
    const parts: Part[] = [...groundFloor(R)];
    parts.push(...shell(R, 0, 3.2, { front: [{ c: -1.8, w: 1.8, b: 0.5, t: 2.4, kind: 'window' }, door(0.3, { leaf: false }), { c: 2.1, w: 1.2, b: 0.5, t: 2.4, kind: 'window' }], back: [door(1.8, { leaf: false })], left: [win(2.2)] }, mat));
    parts.push(...roofSlab(R, 3.2), ...parapet(R, 3.4, 0.6, mat, TRIM));
    // Bar vzadu, stolky uvnitř.
    parts.push(...counter(-2.6, -0.4, 1.1, 1.7, 1.05, 'woodDark'), ...shelf(-1.5, 2.05, 0.08, Math.PI, 1.8));
    parts.push(...table(-1.5, -0.6, 0.08, 0.8, 0.8), ...chair(-1.5, -1.25, 0.08), ...chair(-1.5, 0.05, 0.08, Math.PI));
    // Markýza 2,8 m hluboká ve 2,6 m, stolky u její vnější hrany – u fasády volný chodník.
    parts.push({ shape: 'box', pos: [0, 2.75, -2.5 - 1.4], rot: [-0.18, 0, 0], size: [6.2, 0.03, 2.85], material: AWN[seed % 4] });
    parts.push({ shape: 'box', pos: [0, 2.37, -2.5 - 2.78], size: [6.2, 0.25, 0.02], material: AWN[seed % 4] });
    parts.push(...bistro(-1.6, -4.6), ...bistro(1.8, -4.6));
    return parts;
  },
}, {
  target: [6, 5, 3.4],
  route: [{ p: [-2.8, 0, -3.3], note: 'chodník u fasády (volný)' }, { p: [2.8, 0, -3.3] }, { p: [0.3, 0, -3.3] }, { p: [0.3, 0.08, -1.2], note: 'kavárna' }, { p: [1.8, 0.08, 1.4] }, { p: [1.8, 0, 3.4], note: 'zadní východ' }],
  walkableRoof: false,
  rays: [thru(-1.8, 1.5, false, 'výlohou střela projde', -5, 0), thru(-1.8, 0.3, true, 'sokl výlohy kryje', -5, 0)],
  notes: ['Výlohy jsou otvory se soklem 0,5 m; stolky stojí u vnější hrany markýzy, u fasády zůstává 1,6 m volného chodníku.'],
});

regD(93, 'cafeCorner', 'Rohová kavárna', {
  describe: () => 'půdorys 8 × 7 m, výlohy do dvou ulic (−Z a +X), kryté posezení v rohu 3 × 3 m pod střechou na sloupu, zadní východ',
  generate(_p, seed, mat) {
    // Hmota L: roh (+X, −Z) 3 × 3 m je krytá terasa.
    const A: Rect = [-4, -3.5, 1, 3.5]; // západní křídlo celé hloubky
    const B: Rect = [1, -0.5, 4, 3.5]; // východní křídlo za terasou
    const parts: Part[] = [...groundFloor(A), ...groundFloor(B)];
    const sw = (c: number, w = 1.8): Op => ({ c, w, b: 0.5, t: 2.4, kind: 'window' });
    parts.push(...wall([-4, -3.5 + t / 2], [1, -3.5 + t / 2], 0, 3.2, t, [sw(1.2), sw(3.4)], mat, { out: [0, -1], trim: TRIM }));
    parts.push(...wall([-4 + t / 2, -3.5 + t], [-4 + t / 2, 3.5 - t], 0, 3.2, t, [win(3.4)], mat, { out: [-1, 0], trim: TRIM }));
    parts.push(...wall([-4, 3.5 - t / 2], [4, 3.5 - t / 2], 0, 3.2, t, [door(6.4, { leaf: false })], mat, { out: [0, 1], trim: TRIM }));
    parts.push(...wall([4 - t / 2, -0.5], [4 - t / 2, 3.5 - t], 0, 3.2, t, [sw(2.0, 2.0)], mat, { out: [1, 0], trim: TRIM }));
    // Stěny do terasy: z terasy dveře (otevřené) a výloha.
    parts.push(...wall([1 - t / 2, -3.5 + t], [1 - t / 2, -0.5], 0, 3.2, t, [door(1.5, { leaf: false })], mat, { out: [1, 0], trim: TRIM }));
    parts.push(...wall([1, -0.5 + t / 2], [4, -0.5 + t / 2], 0, 3.2, t, [sw(1.5, 1.6)], mat, { out: [0, -1], trim: TRIM }));
    // Střecha přes celé 8 × 7 m včetně terasy, rohový sloup.
    parts.push(...roofSlab([-4, -3.5, 4, 3.5], 3.2), ...parapet([-4, -3.5, 4, 3.5], 3.4, 0.6, mat, TRIM));
    parts.push({ shape: 'cylinder', pos: [3.7, 1.6, -3.2], size: [0.36, 3.2, 0.36], material: 'plasterWhite', collide: true });
    parts.push(bx(1, 4, 0, 0.04, -3.5, -0.5, 'plazaTile'));
    parts.push(...bistro(2.8, -1.4), ...counter(-3.6, -1.6, 2.4, 3.0, 1.05, 'woodDark'), ...bistro(-1.5, -1.2, 0.08), ...bistro(-1.5, 1.6, 0.08));
    void seed;
    return parts;
  },
}, {
  target: [8, 7, 3.4],
  route: [{ p: [2.4, 0, -4.4], note: 'roh ulic' }, { p: [1.4, 0.04, -2.5], note: 'kryté posezení' }, { p: [1.4, 0.04, -1.7] }, { p: [0.0, 0.08, -1.7], note: 'dveře z terasy' }, { p: [-0.4, 0.08, 0.5], note: 'sál' }, { p: [0.8, 0.08, 0.6] }, { p: [2.4, 0.08, 0.2], note: 'východní křídlo' }, { p: [2.4, 0.08, 2.6] }, { p: [2.4, 0, 4.3], note: 'zadní východ' }],
  walkableRoof: false,
  rays: [thru(-2.8, 1.5, false, 'výloha do ulice −Z', -5, -2.5), { from: [6, 1.5, 1.3], to: [3, 1.5, 1.3], hit: false, note: 'výloha do ulice +X' }],
  notes: ['Terasa v rohu je pod střechou domu (sloup v nároží), vstup do sálu dveřmi z terasy, zadní východ v zadní stěně.'],
});

// ---------------------------------------------------------------------------
// D94–D95 Dílny
// ---------------------------------------------------------------------------
regD(94, 'workshopSmall', 'Malá dílna', {
  describe: () => '6 × 8 × 4 m, otevřená vrata 3 × 3 m, pracovní stůl u zadní stěny, boční dveře 1,1 × 2,2 m',
  generate(_p, _s, mat) {
    const R: Rect = [-3, -4, 3, 4], h = 3.8;
    const parts: Part[] = [bx(-2.9, 2.9, 0, 0.06, -3.9, 3.9, 'concreteDark')];
    parts.push(...shell(R, 0, h, { front: [{ c: -0.3, w: 3, b: 0, t: 3, kind: 'pass', bare: true }], right: [{ c: -2.2, w: 1.1, b: 0, t: 2.2, kind: 'door' }], left: [win(1.0, { b: 1.6, t: 2.6 })] }, mat));
    parts.push(bx(-1.85, 1.25, 3.0, 3.25, -4.08, -3.98, 'paintedMetal', false));
    parts.push(bx(-3.1, 3.1, h, h + 0.2, -4.1, 4.1, 'metalSheet'));
    parts.push(...counter(-1.8, 1.4, 3.0, 3.7, 0.9, 'woodDark'), ...shelf(2.5, 2.5, 0, -Math.PI / 2), ...crate(-2.3, 2.9, 0, 0.7), ...crate(2.3, -2.9, 0, 0.6));
    return parts;
  },
}, {
  target: [6, 8, 4],
  route: [{ p: [-0.3, 0, -5.5], note: 'ulice' }, { p: [-0.3, 0.06, -2.5], note: 'vrata' }, { p: [0, 0.06, 2.4], note: 'u pracovního stolu' }, { p: [-2.0, 0.06, -2.2] }, { p: [-3.9, 0, -2.2], note: 'boční dveře ven' }],
  walkableRoof: false,
  rays: [thru(-0.3, 1.5, false, 'vraty volno', -6, -2), thru(2.2, 1.5, true, 'čelní zeď kryje', -6, -2)],
  notes: ['Vrata bez křídel (otevřený otvor 3 × 3 m), plechová střecha 3,8–4,0 m.'],
});

regD(95, 'workshopGarage', 'Autodílna se dvěma vjezdy', {
  describe: () => '12 × 9 × 4,5 m, dvě vrata 3,5 × 3,5 m oddělená pilířem 1,2 m, propojený prostor, sklad 3 × 3 m, boční dveře',
  generate(_p, _s, mat) {
    const R: Rect = [-6, -4.5, 6, 4.5], h = 4.3;
    const parts: Part[] = [bx(-5.9, 5.9, 0, 0.06, -4.4, 4.4, 'concreteDark')];
    parts.push(...shell(R, 0, h, { front: [{ c: -2.35, w: 3.5, b: 0, t: 3.5, kind: 'pass', bare: true }, { c: 2.35, w: 3.5, b: 0, t: 3.5, kind: 'pass', bare: true }], left: [door(-2.5, { leaf: false })], back: [win(-3.0, { b: 1.8, t: 2.8 }), win(1.0, { b: 1.8, t: 2.8 })] }, mat));
    // Silný pilíř mezi vraty (vystupuje), překlad.
    parts.push(bx(-0.6, 0.6, 0, h, -4.7, -4.2, 'concreteLight'));
    parts.push(bx(-6, 6, 3.5, 3.8, -4.62, -4.5, 'paintedMetal', false));
    parts.push(bx(-6.1, 6.1, h, h + 0.2, -4.6, 4.6, 'metalSheet'));
    // Sklad vzadu vpravo (−X) se dveřmi.
    parts.push(...partition([-5.7, 1.5], [-2.7, 1.5], 0, h, [door(-4.2)], mat), ...partition([-2.7, 1.5], [-2.7, 4.2], 0, h, [], mat));
    parts.push(bx(-5.7, -2.85, 3.0, 3.12, 1.58, 4.2, CONC));
    parts.push(...shelf(-4.2, 3.9, 0.06, Math.PI, 2.0), ...crate(-5.2, 2.3, 0.06, 0.6));
    // Montážní jáma naznačená tmavým rámem, ponk, pneumatiky (cylindry).
    parts.push(...counter(1.5, 4.5, 3.6, 4.15, 0.9, 'woodDark'));
    for (let i = 0; i < 3; i++) parts.push({ shape: 'cylinder', pos: [5.4, 0.12 + i * 0.22, 2.0], size: [0.65, 0.2, 0.65], material: 'rubber', collide: i === 0 });
    return parts;
  },
}, {
  target: [12, 9, 4.5],
  route: [{ p: [-2.35, 0, -6.0], note: 'vjezd 1' }, { p: [-2.35, 0.06, -2.0] }, { p: [2.35, 0.06, -2.0], note: 'propojený prostor' }, { p: [2.35, 0, -6.0], note: 'vjezd 2' }, { p: [2.35, 0.06, -1.0] }, { p: [-4.2, 0.06, 0.6] }, { p: [-4.2, 0.06, 2.6], note: 'sklad' }, { p: [-4.2, 0.06, 0.6] }, { p: [4.5, 0.06, -2.5] }, { p: [6.8, 0, -2.5], note: 'boční dveře' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, true, 'pilíř mezi vraty kryje', -7, -3.5), thru(-2.35, 1.5, false, 'vjezd volný', -7, -3.5)],
  notes: ['Pilíř 1,2 m mezi vraty vystupuje 0,2 m před líc – kryt u vjezdu.'],
});

// ---------------------------------------------------------------------------
// D96–D98 Čerpací stanice
// ---------------------------------------------------------------------------
regD(96, 'fuelCanopy', 'Přístřešek čerpací stanice', {
  describe: () => 'střecha 12 × 8 m ve výšce 4,5 m (spodní líc), 4 sloupy 0,5 × 0,5 m, obvodový lem 0,6 m, bez značek',
  generate() {
    const parts: Part[] = [];
    for (const x of [-4, 4]) for (const z of [-2.2, 2.2]) {
      parts.push(bx(x - 0.25, x + 0.25, 0, 4.5, z - 0.25, z + 0.25, 'paintedMetal'));
      parts.push(bx(x - 0.32, x + 0.32, 0, 0.5, z - 0.32, z + 0.32, CONC));
    }
    parts.push(bx(-6, 6, 4.5, 4.8, -4, 4, CONC));
    // Obvodový lem (jednoduchý), podhled se světly.
    for (const [x0, x1, z0, z1] of [[-6.05, 6.05, -4.05, -3.95], [-6.05, 6.05, 3.95, 4.05], [-6.05, -5.95, -4, 4], [5.95, 6.05, -4, 4]] as const) parts.push(bx(x0, x1, 4.4, 5.0, z0, z1, 'plasterWhite', false));
    for (const x of [-3, 0, 3]) for (const z of [-2, 2]) parts.push(bx(x - 0.4, x + 0.4, 4.46, 4.5, z - 0.15, z + 0.15, 'lamp', false));
    return parts;
  },
}, {
  target: [12, 8, 5],
  route: [{ p: [-7, 0, 0], note: 'příjezd' }, { p: [0, 0, 0], note: 'pod střechou' }, { p: [7, 0, 0], note: 'výjezd' }],
  walkableRoof: false,
  rays: [{ from: [-8, 1.5, 2.2], to: [8, 1.5, 2.2], hit: true, note: 'sloupy kryjí' }],
  notes: ['Bez značek a reklam; podhled ve 4,5 m – projedou i vysoká vozidla.'],
});

regD(97, 'fuelPumps', 'Čerpací stojany', {
  describe: () => 'ostrůvek 4 × 1,2 × 0,2 m, 2 stojany 0,9 × 0,5 × 1,8 m s prohlubní pro pistole a prázdnými displeji',
  generate(_p, seed) {
    const parts: Part[] = [bx(-2, 2, 0, 0.2, -0.6, 0.6, CONC), bx(-2.03, 2.03, 0.16, 0.22, -0.63, 0.63, 'concreteDark', false)];
    for (const x of [-1.0, 1.0]) {
      parts.push(bx(x - 0.45, x + 0.45, 0.2, 2.0, -0.25, 0.25, seed % 2 ? 'paintedMetalRed' : 'paintedMetalBlue'));
      parts.push(bx(x - 0.47, x + 0.47, 2.0, 2.08, -0.27, 0.27, 'plasterWhite', false));
      for (const s of [-1, 1]) {
        const zf = s * 0.25;
        parts.push(bx(x - 0.3, x + 0.3, 1.45, 1.75, s < 0 ? zf - 0.01 : zf, s < 0 ? zf : zf + 0.01, 'glass', false));
        parts.push(bx(x - 0.38, x - 0.02, 0.7, 1.25, s < 0 ? zf - 0.005 : zf, s < 0 ? zf : zf + 0.005, 'gunPolymer', false));
        parts.push({ shape: 'box', pos: [x - 0.2, 1.05, zf + s * 0.06], rot: [s * 0.3, 0, 0], size: [0.08, 0.25, 0.08], material: 'gunMetal' });
        parts.push({ shape: 'cylinder', pos: [x + 0.32, 1.0, zf + s * 0.05], rot: [0, 0, 0.1], size: [0.035, 1.1, 0.035], material: 'rubber' });
      }
    }
    parts.push(bx(-1.95, -1.75, 0.2, 1.0, -0.1, 0.1, 'paintedMetal'), bx(1.75, 1.95, 0.2, 1.0, -0.1, 0.1, 'paintedMetal'));
    return parts;
  },
}, {
  target: [4, 1.2, 2.1],
  route: [{ p: [-2.5, 0, -1.4], note: 'u ostrůvku' }, { p: [2.5, 0, -1.4] }, { p: [2.5, 0, 1.4] }, { p: [-2.5, 0, 1.4] }],
  walkableRoof: false,
  rays: [thru(-1.0, 1.2, true, 'tělo stojanu kryje', -3, 3), thru(0, 1.2, false, 'mezi stojany volno', -3, 3)],
  notes: ['Hadice zjednodušené (válec), displeje prázdné (tmavé sklo). Ochranné sloupky na koncích ostrůvku.'],
});

regD(98, 'fuelShop', 'Obslužná budova čerpací stanice', {
  describe: () => '8 × 6 × 3,2 m, prosklené průčelí (sklo blokuje pohyb, střely projdou), otevřené dveře, pult, zadní místnost',
  generate(_p, _s, mat) {
    const R: Rect = [-4, -3, 4, 3], h = 3.2;
    const parts: Part[] = [...groundFloor(R)];
    // Průčelí: rám ze sloupků, skla do výšky 2,6 m, otevřené dveře 1,2 m.
    const z0 = -3;
    parts.push(bx(-4, 4, 2.6, h, z0, z0 + t, mat), bx(-4, -3.7, 0, 2.6, z0, z0 + t, mat), bx(3.7, 4, 0, 2.6, z0, z0 + t, mat));
    for (const [x0, x1] of [[-3.7, -1.6], [-1.6, 0.4], [1.6, 3.7]] as const) {
      parts.push(bx(x0, x1, 0, 0.3, z0, z0 + t, mat));
      parts.push({ ...bx(x0 + 0.03, x1 - 0.03, 0.3, 2.6, z0 + 0.13, z0 + 0.17, 'glassShop', true), moveOnly: true });
      parts.push(bx(x1 - 0.04, x1 + 0.04, 0, 2.6, z0 + 0.1, z0 + 0.2, 'paintedMetal', false));
    }
    parts.push(...shell(R, 0, h, { back: [door(2.6, { leaf: false })], left: [win(3.0)] }, mat, ['front']));
    parts.push(...roofSlab(R, h - 0.2), ...parapet(R, h, 0.5, mat, TRIM));
    parts.push(bx(-4.3, 4.3, 2.75, 2.9, -4.0, -3.0, 'paintedMetal', false));
    // Pult, regály, zadní místnost (příčka s dveřmi).
    parts.push(...counter(1.0, 3.5, -1.2, -0.6, 1.0), ...shelf(-3.0, -0.5, 0.08, Math.PI / 2, 1.6), ...shelf(-1.4, -0.5, 0.08, -Math.PI / 2, 1.6));
    parts.push(...partition([-3.7, 1.0], [3.7, 1.0], 0, h - 0.2, [door(2.6)], mat), ...crate(-3.0, 2.1, 0.08, 0.7), ...table(-0.8, 2.0, 0.08, 1.2, 0.7));
    return parts;
  },
}, {
  target: [8, 6, 3.7],
  route: [{ p: [1.0, 0, -4.5], note: 'před budovou' }, { p: [1.0, 0.08, -2.0], note: 'otevřené dveře' }, { p: [-2.2, 0.08, -1.8], note: 'prodejna' }, { p: [0.3, 0.08, -1.8] }, { p: [0.3, 0.08, 0.0] }, { p: [2.6, 0.08, 0.0] }, { p: [2.6, 0.08, 2.0], note: 'zadní místnost' }, { p: [2.6, 0, 3.8], note: 'zadní dveře' }],
  walkableRoof: false,
  rays: [thru(-2.6, 1.5, false, 'sklem projde střela', -5, -2.5), thru(-3.85, 1.5, true, 'nárožní pilíř kryje', -5, -2.5)],
  notes: ['Sklo průčelí: kolize jen pro pohyb (moveOnly) – střela projde, hráč ne. Otevřené dveře 1,2 m v prosklení.'],
});

// ---------------------------------------------------------------------------
// D99 Městská věž (bez náboženských symbolů), D100 Kupole
// ---------------------------------------------------------------------------
const TOWER_L = [0.08, 4.0, 8.0, 11.4];
/** Poklopy podest: žebřík u hrany −X, za ní podesta (výstup), poklopy se nad sebou nekryjí. */
const TOWER_H: Record<number, Rect> = { 4: [-0.85, 0.25, 0.05, 1.15], 8: [0.5, -1.15, 1.4, -0.25], 11.4: [-0.4, 0.25, 0.5, 1.15] };
regD(99, 'cityTower', 'Městská věž', {
  describe: () => 'půdorys 4 × 4 m, výška 14 m, tři stupně (4 / 3,4 / ochoz), uvnitř žebříky a podesty ve 4, 8 a 11,4 m, horní ochoz s atikou',
  ladders: () => towerLadders().map((l) => l.ladder),
  generate(_p, _s, mat) {
    const parts: Part[] = [bx(-1.7, 1.7, 0, 0.08, -1.7, 1.7, CONC)];
    const wt = 0.3;
    // 1. stupeň 4 × 4 do 8 m, dveře a úzké otvory; 2. stupeň 3,4 × 3,4 do 11,4 m.
    parts.push(...shell([-2, -2, 2, 2], 0, 8.0, { front: [door(0, { leaf: false }), win(0.9, { w: 0.4, b: 5.0, t: 6.4 })], back: [win(0, { w: 0.4, b: 2.5, t: 3.6 })], left: [win(0, { w: 0.4, b: 5.0, t: 6.4 })], right: [win(0, { w: 0.4, b: 5.0, t: 6.4 })] }, mat));
    parts.push(bx(-2.1, 2.1, 7.9, 8.1, -2.1, 2.1, TRIM, false));
    parts.push(...shell([-1.7, -1.7, 1.7, 1.7], 8.0, 3.4, { front: [win(0, { w: 0.5, b: 1.0, t: 2.4 })], back: [win(0, { w: 0.5, b: 1.0, t: 2.4 })], left: [win(0, { w: 0.5, b: 1.0, t: 2.4 })], right: [win(0, { w: 0.5, b: 1.0, t: 2.4 })] }, mat));
    // Podesty s poklopy (žebříky u stěny −X).
    for (const l of towerLadders()) parts.push(...l.parts);
    parts.push(...towerSlab(-2, 2, 4.0, mat), ...towerSlab(-2, 2, 8.0, mat), ...towerSlab(-1.7, 1.7, 11.4, mat, 0.7));
    // Horní ochoz: atika 1 m (s průhledy), čtyři pilířky a stříška do 14 m.
    parts.push(...parapet([-2.0, -2.0, 2.0, 2.0], 11.4, 1.0, mat, TRIM, { gaps: [{ side: 'front', from: -0.6, to: 0.6 }, { side: 'back', from: -0.6, to: 0.6 }, { side: 'left', from: -0.6, to: 0.6 }, { side: 'right', from: -0.6, to: 0.6 }] }));
    for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) parts.push(bx(x - 0.2, x + 0.2, 11.4, 13.4, z - 0.2, z + 0.2, mat));
    parts.push(bx(-2.1, 2.1, 13.4, 13.7, -2.1, 2.1, CONC), bx(-1.3, 1.3, 13.7, 14.0, -1.3, 1.3, mat));
    void wt;
    return parts;
  },
}, {
  target: [4, 4, 14],
  route: [
    { p: [0, 0, -3.0], note: 'ulice' },
    { p: [0, 0.08, -0.5], note: 'přízemí věže' },
    { p: [0.3, 0.08, 0.7], note: 'k žebříku' },
    { p: [-1.25, 4.0, 0.7], ladder: true, note: 'podesta 4 m' },
    { p: [-1.25, 4.0, -0.5] },
    { p: [1.2, 4.0, -0.7] },
    { p: [0.0, 8.0, -0.7], ladder: true, note: 'podesta 8 m' },
    { p: [0.8, 8.0, 0.7] },
    { p: [-1.0, 11.4, 0.7], ladder: true, note: 'horní ochoz 11,4 m' },
    { p: [-1.0, 11.4, -0.6] },
    { p: [1.0, 11.4, -1.0], note: 'u atiky' },
  ],
  walkableRoof: true,
  rays: [{ from: [0, 12.0, -4], to: [0, 12.0, 0], hit: false, note: 'průhled atikou' }, { from: [1.2, 11.9, -4], to: [1.2, 11.9, 0], hit: true, note: 'atika kryje' }],
  notes: ['Bez náboženských symbolů. Přístup jen vnitřními žebříky přes poklopy ve 4, 8 a 11,4 m.'],
});

/** Žebříky věže: tři ramena střídavě u různých stěn (poklopy se nekryjí nad sebou). */
function towerLadders() {
  const H1: Rect = TOWER_H[4], H2: Rect = TOWER_H[8], H3: Rect = TOWER_H[11.4];
  return [hatch(H1, TOWER_L[0], TOWER_L[1]), hatch(H2, TOWER_L[1], TOWER_L[2]), hatch(H3, TOWER_L[2], TOWER_L[3])];
}
function towerSlab(a: number, b: number, y: number, mat: string, over = 0): Part[] {
  const h = TOWER_H[y];
  const r: Rect = [a + 0.3 - over, a + 0.3 - over, b - 0.3 + over, b - 0.3 + over];
  const parts: Part[] = [];
  // Deska s otvorem (pásy kolem poklopu).
  const [hx0, hz0, hx1, hz1] = h;
  parts.push(bx(r[0], hx0, y - 0.2, y, r[1], r[3], CONC), bx(hx1, r[2], y - 0.2, y, r[1], r[3], CONC), bx(hx0, hx1, y - 0.2, y, r[1], hz0, CONC), bx(hx0, hx1, y - 0.2, y, hz1, r[3], CONC));
  void mat;
  return parts;
}

regD(100, 'domeRoof', 'Kupole', {
  describe: () => 'střešní modul: buben Ø 6 × 0,8 m, kupole do celkové výšky 3,5 m (6 prstenců), bez symbolů',
  mount: { kind: 'top' },
  generate(_p, _s, mat) {
    const R = 3, drum = 0.8, dh = 2.7, n = 6;
    const parts: Part[] = [{ shape: 'cylinder', pos: [0, drum / 2, 0], size: [2 * R, drum, 2 * R], material: mat, collide: true }];
    parts.push({ shape: 'cylinder', pos: [0, drum + 0.05, 0], size: [2 * R + 0.15, 0.1, 2 * R + 0.15], material: TRIM });
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * (Math.PI / 2), a1 = ((i + 1) / n) * (Math.PI / 2);
      const r = (R - 0.1) * Math.cos((a0 + a1) / 2), y0 = drum + dh * Math.sin(a0), y1 = drum + dh * Math.sin(a1);
      parts.push({ shape: 'cylinder', pos: [0, (y0 + y1) / 2, 0], size: [2 * r, y1 - y0 + 0.02, 2 * r], material: 'plasterWhite', collide: i < 3 });
    }
    return parts;
  },
}, {
  target: [6, 6, 3.5],
  route: [{ p: [-4, 0, 0] }, { p: [0, 0, -4], note: 'kolem bubnu' }, { p: [4, 0, 0] }],
  walkableRoof: false,
  rays: [{ from: [-5, 1.5, 0], to: [0, 1.5, 0], hit: true, note: 'kupole kryje' }],
  notes: ['Lepí se nahoru na budovu (mount top). Kolize jen buben a spodní prstence (horní část nepochozí).'],
});

// ---------------------------------------------------------------------------
// D101–D102 Škola a úřad (uzavřené, interiér přepínačem)
// ---------------------------------------------------------------------------
regD(101, 'school', 'Školní budova', {
  describe: () => '22 × 10 m, 2 podlaží (uzavřená, interiér volitelně): chodba podél čela, 4 učebny v podlaží, hlavní vstup uprostřed, druhý na konci',
  closed: { solids: [[-11, 0, -5, 11, 2 * S, 5]] },
  interior: true,
  generate(_p, seed, mat) {
    const R: Rect = [-11, -5, 11, 5];
    const c = coreLayout(0, -2.85, 1.2);
    const parts: Part[] = [...groundFloor(R)];
    const fw = [-9.0, -6.6, -4.2, 4.2, 6.6, 9.0];
    for (let i = 0; i < 2; i++) {
      const y = i * S;
      parts.push(...shell(R, y, H, {
        front: i === 0 ? [...fw.map((x) => win(x)), door(0, { leaf: false, w: 1.8 })] : [...fw.map((x) => win(x)), win(-1.6), win(1.6)],
        back: [-9, -7, -4.5, -2.5, 2.5, 4.5, 7, 9].map((x) => win(x, { w: 1.4 })),
        left: i === 0 ? [door(-4.0, { leaf: false })] : [win(1.0)],
        right: [win(5.0)],
      }, mat));
      // Chodba z −5 do −2,85: stěna se dveřmi do učeben a otevřeným jádrem.
      parts.push(...partition([-10.7, -2.85], [10.7, -2.85], y, H, [door(-8.0), door(-3.6), { c: 0, w: 2.6, b: 0, t: 2.4, kind: 'pass', bare: true }, door(3.6), door(8.0)], mat));
      for (const x of [-1.4, 1.4]) parts.push(...partition([x, -2.85], [x, 4.7], y, H, [], mat));
      for (const x of [-6.0, 6.0]) parts.push(...partition([x, -2.85], [x, 4.7], y, H, [door(3.5)], mat));
      const fy = i === 0 ? 0.08 : y;
      for (const cx of [-8.3, -3.7, 3.7, 8.3]) {
        for (const dz of [-0.8, 0.8, 2.4]) parts.push(...table(cx - 1.0, dz, fy, 1.1, 0.55), ...table(cx + 1.0, dz, fy, 1.1, 0.55));
        parts.push(bx(cx - 1.4, cx + 1.4, fy + 0.9, fy + 2.1, 4.66, 4.7, 'woodDark', false));
      }
    }
    parts.push(...coreFlights(c, 0.08, S - 0.08, 1.2, CONC, mat));
    parts.push(...roofSlab(R, H, [c.rect], CONC), ...roofSlab(R, 2 * S - M.slab), ...parapet(R, 2 * S, 0.8, mat, TRIM));
    parts.push(...rail([c.rect[0], c.rect[3]], [c.rect[2], c.rect[3]], S), ...rail([c.rect[0] + 0.04, c.rect[1] + 0.04], [c.xa + 0.65, c.rect[1] + 0.04], S));
    // Stříška nad hlavním vstupem, schodek.
    parts.push(bx(-1.6, 1.6, 2.55, 2.7, -6.4, -5, CONC), bx(-1.4, 1.4, 0, 0.12, -5.9, -5, 'concreteDark'));
    void seed;
    return parts;
  },
}, {
  target: [22, 10, 7.2],
  route: [
    { p: [0, 0, -7.0], note: 'ulice' },
    { p: [0, 0.08, -4.0], note: 'hlavní vstup → chodba' },
    { p: [-8.0, 0.08, -4.0] },
    { p: [-8.3, 0.08, -2.2] },
    { p: [-8.3, 0.08, 0.0], note: 'učebna 1' },
    { p: [-8.3, 0.08, 3.5] },
    { p: [-6.8, 0.08, 3.5] },
    { p: [-4.0, 0.08, 3.5], note: 'učebna 2 (propojená)' },
    { p: [-3.6, 0.08, -4.0] },
    { p: [9.5, 0.08, -4.0], note: 'konec chodby' },
    { p: [12.3, 0, -4.0], note: 'druhý vstup na konci' },
    { p: [9.5, 0.08, -4.0] },
    { p: [-0.65, 0.08, -3.6] },
    { p: [-0.65, 1.64, 0.6], note: 'mezipodesta' },
    { p: [0.65, 1.64, 0.6] },
    { p: [0.65, 3.2, -3.4], note: 'patro – chodba' },
    { p: [8.0, 3.2, -4.0] },
    { p: [8.3, 3.2, -2.2] },
    { p: [8.3, 3.2, 0.0], note: 'učebna v patře' },
  ],
  walkableRoof: false,
  view: [[-9.5, 1.7, -4.2], [6.0, 1.5, -3.6]],
  notes: ['Výchozí: uzavřená (BF2) – zvenku okna se sklem, dveře zavřené. „Přístupný interiér“: chodba, 4 učebny v podlaží (po dvou propojené), dvouramenné schodiště 1,2 m.'],
});

regD(102, 'office', 'Úřední budova', {
  describe: () => '18 × 12 m, 2 podlaží (uzavřená, interiér volitelně): vstupní hala, širší schodiště 1,4 m, kanceláře, pochozí střecha (vnější žebřík)',
  closed: { solids: [[-9, 0, -6, 9, 2 * S, 6]] },
  interior: true,
  ladders: () => [ladderDef(-9.05, 3.0, 0, 2 * S, 'x+')],
  generate(_p, _s, mat) {
    const R: Rect = [-9, -6, 9, 6];
    const c = coreLayout(0, 0.2, 1.4);
    const parts: Part[] = [...groundFloor(R)];
    for (let i = 0; i < 2; i++) {
      const y = i * S;
      parts.push(...shell(R, y, H, {
        front: i === 0 ? [win(-7), win(-4.6), door(0, { leaf: false, w: 2.0 }), win(4.6), win(7)] : [win(-7), win(-4.6), win(-1.6), win(1.6), win(4.6), win(7)],
        back: [win(-7), win(-4.6), win(4.6), win(7)],
        left: [win(-3), win(3)],
        right: [win(-3), win(3)],
      }, mat));
      // Hala uprostřed (x −3…3), kanceláře po stranách; za halou jádro.
      for (const x of [-3, 3]) parts.push(...partition([x, -5.7], [x, 5.7], y, H, [door(-3.5), door(3.5)], mat));
      for (const sx of [-1, 1]) parts.push(...partition([sx * 3, 0], [sx * 8.7, 0], y, H, [door(sx * 6)], mat));
      const fy = i === 0 ? 0.08 : y;
      for (const [x, z] of [[-6, -3], [6, -3], [-6, 3], [6, 3]] as const) parts.push(...table(x, z, fy, 1.6, 0.8), ...chair(x, z + 0.7, fy, Math.PI), ...shelf(x + (x < 0 ? -2.4 : 2.4), z, fy, x < 0 ? Math.PI / 2 : -Math.PI / 2));
    }
    parts.push(...coreFlights(c, 0.08, S - 0.08, 1.4, CONC, mat));
    parts.push(...roofSlab(R, H, [c.rect], CONC), ...roofSlab(R, 2 * S - M.slab), ...parapet(R, 2 * S, M.parapet, mat, TRIM, { gaps: [{ side: 'right', from: 2.5, to: 3.5 }] }));
    parts.push(...rail([c.rect[0], c.rect[3]], [c.rect[2], c.rect[3]], S), ...rail([c.rect[0], c.rect[1]], [c.xa + 0.7, c.rect[1]], S));
    parts.push(...ladderParts(-9.05, 3.0, 0, 2 * S, 'x+'));
    // Vstupní portál se stříškou a schody.
    parts.push(bx(-2.2, 2.2, 2.7, 2.9, -7.4, -6, CONC), bx(-1.6, 1.6, 0, 0.15, -6.9, -6, 'sandstone'));
    for (const x of [-2.0, 2.0]) parts.push({ shape: 'cylinder', pos: [x, 1.35, -7.2], size: [0.3, 2.7, 0.3], material: 'plasterWhite', collide: true });
    return parts;
  },
}, {
  target: [18, 12, 7.4],
  route: [
    { p: [0, 0, -8.5], note: 'ulice' },
    { p: [0, 0.08, -3.0], note: 'vstupní hala' },
    { p: [-3.0, 0.08, -3.5] },
    { p: [-6.0, 0.08, -1.5], note: 'kancelář' },
    { p: [-6.0, 0.08, 1.5], note: 'kancelář vzadu' },
    { p: [-3.0, 0.08, 3.5] },
    { p: [-2.2, 0.08, -0.4] },
    { p: [-0.775, 0.08, -0.4], note: 'pata schodiště' },
    { p: [-0.775, 1.64, 3.5], note: 'mezipodesta' },
    { p: [0.775, 1.64, 3.5] },
    { p: [0.75, 3.2, -0.6], note: 'patro – hala' },
    { p: [3.0, 3.2, -3.5] },
    { p: [6.0, 3.2, -1.2], note: 'kancelář v patře' },
    { p: [-9.7, 0, 3.0], teleport: true, note: 'za domem u žebříku' },
    { p: [-7.5, 6.4, 3.0], ladder: true, note: 'pochozí střecha' },
  ],
  walkableRoof: true,
  view: [[-2.5, 1.7, -5.0], [2.0, 1.6, 2.0]],
  notes: ['Výchozí: uzavřená (BF2). Na střechu vede vnější žebřík u boku −X (i v uzavřené verzi); atika 1 m.', '„Přístupný interiér“: hala, schodiště 1,4 m, 4 kanceláře v podlaží.'],
});

// ---------------------------------------------------------------------------
// D103–D105 Tržnice
// ---------------------------------------------------------------------------
function marketRoof(x0: number, x1: number, z0: number, z1: number, y: number, skip?: (x: number) => boolean): Part[] {
  const parts: Part[] = [];
  for (let x = x0; x < x1 - 1e-6; x += 2) {
    const xa = x, xb = Math.min(x1, x + 2);
    if (skip?.((xa + xb) / 2)) continue;
    parts.push(bx(xa, xb, y, y + 0.08, z0, z1, 'metalSheet', false));
  }
  parts.push(...[z0, z1].map((z) => bx(x0, x1, y - 0.3, y, z - 0.12, z + 0.12, 'woodDark', false)));
  return parts;
}
const pier = (x: number, z: number, h: number, mat: string): Part[] => [bx(x - 0.25, x + 0.25, 0, h, z - 0.25, z + 0.25, mat), bx(x - 0.3, x + 0.3, h - 0.15, h, z - 0.3, z + 0.3, TRIM, false)];

regD(103, 'marketSmall', 'Malá otevřená tržnice', {
  describe: () => '10 × 8 m, lehká plechová střecha ve 3,2 m na 8 zděných sloupech (ústí uliček volná), 4 pevné pulty, průchody ≥ 1,5 m',
  generate(_p, seed, mat) {
    const parts: Part[] = [bx(-5, 5, 0, 0.05, -4, 4, 'paving')];
    for (const x of [-4.75, -1.6, 1.6, 4.75]) for (const z of [-3.75, 3.75]) parts.push(...pier(x, z, 3.2, mat));
    parts.push(...marketRoof(-5.2, 5.2, -4.1, 4.1, 3.2));
    for (const [x0, x1, z0, z1] of [[-3.8, -1.0, -2.2, -1.4], [1.0, 3.8, -2.2, -1.4], [-3.8, -1.0, 1.4, 2.2], [1.0, 3.8, 1.4, 2.2]] as const) {
      parts.push(...counter(x0, x1, z0, z1));
      parts.push(...goods(x0, x1, (z0 + z1) / 2, 0.95, seed + x0 * 3 + z0));
    }
    return parts;
  },
}, {
  target: [10, 8, 3.3],
  route: [{ p: [0, 0, -5.5], note: 'vstup' }, { p: [0, 0.05, 0], note: 'hlavní ulička 2 m' }, { p: [-4.3, 0.05, 0] }, { p: [-4.3, 0.05, -3.0], note: 'boční ulička' }, { p: [4.3, 0.05, -3.0] }, { p: [0, 0, 5.5], note: 'ven' }],
  walkableRoof: false,
  rays: [thru(-2.4, 0.6, true, 'pult kryje', -5, -1.8), { from: [-6, 1.5, 0], to: [6, 1.5, 0], hit: false, note: 'ulička průstřelná' }],
  notes: ['Uličky: hlavní 2,0 m (mezi pulty), boční 1,5 m u sloupů. Střecha je plech bez kolize (průstřel shora).'],
});

/** Dlouhá tržnice; `broken` = chybí část střechy a krajní úsek je zřícený. */
function longMarket(mat: string, seed: number, broken: boolean): Part[] {
  const L = 20, D = 8, h = 3.4;
  const parts: Part[] = [bx(-L / 2, L / 2, 0, 0.05, -D / 2, D / 2, 'paving')];
  const xs = [-10, -6, -2, 2, 6, 10].map((x) => Math.max(-9.75, Math.min(9.75, x)));
  for (const x of xs) for (const z of [-3.75, 3.75]) {
    if (broken && x > 9) continue;
    if (broken && x === 6 && z > 0) {
      // Ulomený sloup (pahýl).
      parts.push(bx(x - 0.25, x + 0.25, 0, 1.3, z - 0.25, z + 0.25, mat));
      continue;
    }
    parts.push(...pier(x, z, h, mat));
  }
  parts.push(...marketRoof(-10.2, 10.2, -4.1, 4.1, h, broken ? (x) => (x > 2 && x < 6) || x > 8 : undefined));
  // Pulty po stranách, boční vstupy v x = ±4 na obou stranách; hlavní ulička 3 m.
  const r = rng(seed);
  for (const side of [-1, 1]) {
    for (const [x0, x1] of [[-9.4, -5.0], [-3.0, 3.0], [5.0, 9.4]] as const) {
      if (broken && x0 > 4 && side > 0) continue;
      const z0 = side < 0 ? -3.2 : 1.5, z1 = z0 + 1.7 - 0.0 - (side < 0 ? 0 : 0);
      parts.push(...counter(x0, x1, side < 0 ? -2.2 : 1.5, side < 0 ? -1.5 : 2.2));
      parts.push(...goods(x0, x1, side < 0 ? -1.85 : 1.85, 0.95, seed + x0 + side));
      void z0; void z1;
    }
  }
  if (broken) {
    // Zřícený krajní úsek: střešní plechy a trámy šikmo na zemi (u stran, osa volná), suť.
    parts.push({ shape: 'box', pos: [9.0, 1.2, 2.6], rot: [0.55, 0.1, 0.1], size: [2.6, 0.08, 3.4], material: 'metalSheetRust', collide: true });
    parts.push({ shape: 'box', pos: [9.2, 0.9, -2.8], rot: [-0.4, -0.2, 0.15], size: [2.2, 0.08, 2.8], material: 'metalSheetRust', collide: true });
    parts.push({ shape: 'box', pos: [8.6, 0.5, 3.4], rot: [0, 0.3, 0.35], size: [3.2, 0.25, 0.25], material: 'woodDark', collide: true });
    parts.push(...rubble(9.5, 3.4, 6, [1.2, 0.8], seed, 0.5), ...rubble(6.3, 3.0, 4, [0.8, 0.8], seed + 2, 0.4));
    parts.push(...counter(5.0, 7.0, 1.5, 2.2));
    for (let i = 0; i < 3; i++) parts.push({ shape: 'box', pos: [7.5 + r() * 1.5, 0.05, 1.8 + r()], rot: [0, r() * 3, 0], size: [1.0, 0.03, 0.14], material: 'woodDark' });
  }
  return parts;
}

regD(104, 'marketLong', 'Dlouhá krytá tržnice', {
  describe: () => '20 × 8 m, střecha ve 3,4 m na 12 sloupech, pulty po stranách, hlavní ulička 3 m, boční vstupy (x = ±4) na obou stranách',
  generate(_p, seed, mat) {
    return longMarket(mat, seed, false);
  },
}, {
  target: [20, 8, 3.5],
  route: [{ p: [-11.5, 0, 0], note: 'čelní vstup' }, { p: [0, 0.05, 0], note: 'hlavní ulička' }, { p: [4.0, 0.05, 0] }, { p: [4.0, 0, -5.5], note: 'boční vstup' }, { p: [-4.0, 0, -5.5] }, { p: [-4.0, 0.05, 0] }, { p: [-4.0, 0, 5.5], note: 'boční vstup druhá strana' }, { p: [11.5, 0, 5.5] }, { p: [11.5, 0, 0], note: 'druhý konec' }],
  walkableRoof: false,
  rays: [thru(-7.0, 0.6, true, 'pult kryje', -5, -1.0), { from: [-12, 1.5, 0], to: [12, 1.5, 0], hit: false, note: 'hlavní ulička průstřelná po celé délce' }],
  notes: ['Pulty po stranách (0,7 m hluboké) s mezerami 2 m v x = ±4 m = boční vstupy; hlavní ulička 3 m.'],
});

regD(105, 'marketDamaged', 'Poškozená tržnice', {
  describe: () => '20 × 8 m, chybí střecha v úseku x 2–6 m, krajní úsek (x > 8 m) zřícený, ulomený sloup, hlavní ulička volná',
  generate(_p, seed, mat) {
    return longMarket(mat, seed, true);
  },
}, {
  target: [20, 8, 3.5],
  route: [{ p: [-11.5, 0, 0], note: 'čelní vstup' }, { p: [0, 0.05, 0], note: 'hlavní ulička' }, { p: [7.0, 0.05, 0], note: 'pod chybějící střechou' }, { p: [11.5, 0, 0], note: 'skrz zřícený konec (osa volná)' }],
  walkableRoof: false,
  rays: [{ from: [-12, 1.5, 0], to: [12, 1.5, 0], hit: false, note: 'hlavní osa volná' }, { from: [9.0, 0.6, -6], to: [9.0, 0.6, -1.8], hit: true, note: 'spadlý plech kryje' }],
  notes: ['Spadlé plechy a trám leží u stran (kolize = kryt), osa 3 m zůstává průchozí; zbylé sloupy a pulty kryjí.'],
});
