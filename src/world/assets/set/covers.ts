import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import { crate } from './bk';
import { bx, rubble, thru } from './modules';
import { eulerYX } from './industrial';
import { reg, type SetMeta } from './residential';

/**
 * Sada 300 · G Kryty a barikády (položky 161–190): pytle, jersey bariéry, betonové bloky,
 * ježky, suť, barikády z vraků a nábytku, betonové roury, bedny, pneumatiky a hliněné valy.
 * Konvence: pivot = střed půdorysu u paty, strana nepřítele −Z.
 */
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regG = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, 'G');
const CONC = 'concreteLight';
const SAND = 'fabricSand';

// ---------------------------------------------------------------------------
// Pytle s pískem: stlačené vaky (blob) v převázaných řadách, kolize = kvádr úseku
// ---------------------------------------------------------------------------
const ROWS = 6;
/** Úsek pytlů podél osy z bodu a do b (střed tloušťky), výška h, tloušťka t. `skipEnd` = konce pro převázání rohu. */
function bagRun(a: [number, number], b: [number, number], h: number, t: number, seed: number, o: { rowOffset?: (row: number) => number; endTrim?: (row: number) => [number, number]; collide?: boolean } = {}): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
  const ux = dx / L, uz = dz / L;
  const rh = h / ROWS;
  if (o.collide !== false) parts.push({ shape: 'box', pos: [(a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2], rot: [0, yaw, 0], size: [t, h, L], material: SAND, collide: true, render: false });
  for (let row = 0; row < ROWS; row++) {
    const [t0, t1] = o.endTrim?.(row) ?? [0, 0];
    const off = (o.rowOffset?.(row) ?? (row % 2) * 0.3) - 0.6;
    for (let u = off; u < L; u += 0.6) {
      const u0 = Math.max(t0, u), u1 = Math.min(L - t1, u + 0.6);
      if (u1 - u0 < 0.18) continue;
      const c = (u0 + u1) / 2, y = rh * (row + 0.5) - 0.01;
      // Vak: zploštělý, mírně přesahuje sousedy (stlačení), drobné natočení.
      parts.push({ shape: 'blob', pos: [a[0] + ux * c, y, a[1] + uz * c], rot: [(r() - 0.5) * 0.08, yaw + (r() - 0.5) * 0.1, (r() - 0.5) * 0.08], size: [t * (0.95 + r() * 0.08), rh * 1.25, (u1 - u0) * 1.05], material: SAND, seed: Math.floor(r() * 9999), rough: 0.12, detail: 1 });
    }
  }
  return parts;
}

regG(161, 'bagsStraight', 'Rovný kryt z pytlů (pilot)', {
  describe: () => '2,4 × 0,5 × 1,0 m, 6 převázaných řad stlačených vaků',
  generate(_p, seed) {
    return bagRun([-1.2, 0], [1.2, 0], 1.0, 0.5, seed);
  },
}, {
  target: [2.48, 0.44, 1.04],
  route: [{ p: [-1.0, 0, 0.8], note: 'za krytem' }, { p: [1.0, 0, 0.8] }],
  walkableRoof: false,
  rays: [thru(0, 0.8, true, 'kryje vkleče'), thru(0, 1.3, false, 'vestoje přes něj')],
  notes: ['Podle pilotu cover_sandbags_a (2,4 × 0,5 × 1,02 m, kolize jeden kvádr). Úprava vzhledu: vaky jsou zploštělé měkké tvary s posunem o půl vaku v každé řadě (ne válce).'],
});

/** Roh L: rameno X (z = −0,9) a rameno Z (x = −0,95); řady se v rohu střídavě převazují. */
function bagCorner(seed: number, withRight = false): Part[] {
  const t = 0.5, h = 1.0, zx = -0.895, xz = -0.97;
  const parts: Part[] = [{ ...bx(-1.22, 1.18, 0, h, zx - t / 2, zx + t / 2, SAND), render: false }, { ...bx(xz - t / 2, xz + t / 2, 0, h, zx + t / 2, 1.055, SAND), render: false }];
  // Liché řady: rohový vak patří ramenu X, sudé ramenu Z (provázání přes roh).
  parts.push(...bagRun([-1.22, zx], [1.18, zx], h, t, seed, { collide: false, endTrim: (row) => [row % 2 ? 0 : t, 0] }));
  parts.push(...bagRun([xz, zx - t / 2], [xz, 1.055], h, t, seed + 1, { collide: false, endTrim: (row) => [row % 2 ? t : 0, 0], rowOffset: (row) => ((row + 1) % 2) * 0.3 }));
  if (withRight) {
    parts.push({ ...bx(0.93 - t / 2, 0.93 + t / 2, 0, h, zx + t / 2, 1.055, SAND), render: false });
    parts.push(...bagRun([0.93, zx - t / 2], [0.93, 1.055], h, t, seed + 2, { collide: false, endTrim: (row) => [row % 2 ? t : 0, 0], rowOffset: (row) => ((row + 1) % 2) * 0.3 }));
  }
  return parts;
}

regG(162, 'bagsCorner', 'Rohový kryt z pytlů (pilot)', {
  describe: () => 'tvar L 2,4 × 2,2 m, výška 1,0 m, řady převázané přes roh, vnitřek bez výstupků',
  generate(_p, seed) {
    return bagCorner(seed);
  },
}, {
  target: [2.48, 2.23, 1.04],
  route: [{ p: [0.6, 0, 0.6], note: 'uvnitř L' }, { p: [-0.35, 0, -0.3], note: 'v koutě' }, { p: [0.6, 0, 0.6] }],
  walkableRoof: false,
  rays: [{ from: [-3, 0.8, -3], to: [0, 0.8, 0], hit: true, note: 'roh kryje vkleče' }],
  notes: ['Podle pilotu cover_sandbags_b (kolize 2 kvádry, rozměry beze změny). Vnitřní líc obou ramen rovný – bez kolizních výstupků.'],
});

regG(163, 'bagsU', 'Stanoviště U z pytlů (pilot)', {
  describe: () => 'tři strany 2,4 × 2,2 m, výška 1,0 m, otevřený zadní vstup, vnitřek 1,4 × 1,7 m',
  generate(_p, seed) {
    return bagCorner(seed, true);
  },
}, {
  target: [2.48, 2.23, 1.04],
  route: [{ p: [0, 0, 1.8], note: 'za stanovištěm' }, { p: [0, 0, 0.6], note: 'zadní vstup' }, { p: [-0.1, 0, -0.25], note: 'u čelní hradby' }, { p: [0.2, 0, 0.5] }],
  walkableRoof: false,
  rays: [thru(0, 0.8, true, 'čelo kryje', -3, 0), { from: [3, 0.8, 0.2], to: [0, 0.8, 0.2], hit: true, note: 'bok kryje' }],
  notes: ['Podle pilotu cover_sandbags_c. Vnitřek 1,4 × 1,7 m – stačí na otočení vestoje i vkleče.'],
});

regG(164, 'bagsArc', 'Obloukový kryt z pytlů', {
  describe: () => 'půlkruh Ø 3 m (osa hradby), výška 1,0 m, tloušťka 0,5 m, zadní strana otevřená',
  generate(_p, seed) {
    const parts: Part[] = [], R = 1.5, n = 7;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * (i / n), a1 = Math.PI * ((i + 1) / n);
      const p0: [number, number] = [R * Math.cos(a0 + Math.PI), -R * Math.sin(a0) + 0.75], p1: [number, number] = [R * Math.cos(a1 + Math.PI), -R * Math.sin(a1) + 0.75];
      // Mírné prodloužení segmentů, aby se v kloubech nedělaly mezery.
      const ex = (p1[0] - p0[0]) * 0.06, ez = (p1[1] - p0[1]) * 0.06;
      parts.push(...bagRun([p0[0] - ex, p0[1] - ez], [p1[0] + ex, p1[1] + ez], 1.0, 0.5, seed + i, { rowOffset: (row) => (row % 2) * 0.2 }));
    }
    return parts;
  },
}, {
  target: [3.5, 2.0, 1.04],
  route: [{ p: [0, 0, 1.5], note: 'za krytem' }, { p: [0, 0, 0.2], note: 'uvnitř oblouku' }, { p: [-0.6, 0, 0.5] }],
  walkableRoof: false,
  rays: [thru(0, 0.8, true, 'čelo oblouku kryje', -3, 0), { from: [-3, 0.8, 0.3], to: [0, 0.8, 0.3], hit: true, note: 'bok oblouku kryje' }],
  notes: ['7 rovných úseků po oblouku, kolize = 7 natočených kvádrů s malým přesahem v kloubech.'],
});

regG(165, 'mgNest', 'Kulometné hnízdo', {
  describe: () => 'stanoviště 4 × 3 m: čelo snížené na 0,8 m (střelecká část) s boky 1,3 m u krajů, boční stěny 1,4 m, zadní vstup',
  generate(_p, seed) {
    const parts: Part[] = [];
    // Čelo: snížená střední část 2 m a vyšší „líce“ po stranách.
    parts.push(...bagRun([-1.0, -1.25], [1.0, -1.25], 0.8, 0.6, seed));
    for (const s of [-1, 1]) parts.push(...bagRun([s * 2.0, -1.25], [s * 1.0, -1.25], 1.3, 0.6, seed + 3 + s));
    // Boky 1,4 m a krátké zadní zalomení (vstup uprostřed vzadu).
    for (const s of [-1, 1]) {
      parts.push(...bagRun([s * 1.7, -0.95], [s * 1.7, 1.5], 1.4, 0.6, seed + 6 + s));
      parts.push(...bagRun([s * 1.4, 1.2], [s * 0.7, 1.2], 1.0, 0.6, seed + 9 + s));
    }
    // Plošina pro dvojnožku (pytle v čele nahoře plošší) – jen vzhled.
    parts.push(bx(-0.6, 0.6, 0.8, 0.84, -1.5, -1.0, 'wood', false));
    return parts;
  },
}, {
  target: [4, 3, 1.4],
  route: [{ p: [0, 0, 2.4], note: 'za hnízdem' }, { p: [0, 0, 1.2], note: 'zadní vstup 1,4 m' }, { p: [0, 0, -0.4], note: 'u střelecké části' }, { p: [-0.9, 0, 0.3] }],
  walkableRoof: false,
  rays: [thru(0, 1.0, false, 'snížená střelecká část (střelba vkleče přes ni)', -3, -0.5), thru(0, 0.6, true, 'vleže kryje', -3, -0.5), thru(-1.5, 1.2, true, 'líc čela kryje', -3, -0.5)],
  notes: ['Bez pevně přidané zbraně; snížené čelo 0,8 m pro střelbu z dvojnožky vkleče.'],
});

regG(166, 'bagsDamaged', 'Poškozené pytlové opevnění', {
  describe: () => 'rovný kryt 3 m: pravá část snížená na 0,5 m, sklouzlé pytle na zemi, rozsypaný písek (jeden objem)',
  generate(_p, seed) {
    const r = rng(seed);
    const parts = bagRun([-1.5, 0], [0.3, 0], 1.0, 0.5, seed);
    parts.push(...bagRun([0.3, 0], [1.5, 0], 0.5, 0.5, seed + 1));
    for (let i = 0; i < 5; i++) parts.push({ shape: 'blob', pos: [0.5 + r() * 1.0, 0.09, -0.55 - r() * 0.5], rot: [0, r() * 3, (r() - 0.5) * 0.4], size: [0.5, 0.16, 0.6], material: SAND, seed: i * 31 + seed, rough: 0.15, detail: 1 });
    parts.push({ shape: 'blob', pos: [0.9, 0.06, -0.4], size: [1.6, 0.14, 1.0], material: 'sand', seed: seed + 77, rough: 0.3 });
    return parts;
  },
}, {
  target: [3, 1.5, 1.04],
  route: [{ p: [-1.2, 0, 0.8], note: 'za celou částí' }, { p: [1.2, 0, 0.8], note: 'za sníženou částí' }],
  walkableRoof: false,
  rays: [thru(-0.8, 0.8, true, 'celá část kryje vkleče'), thru(1.0, 0.8, false, 'snížená část už vkleče nekryje'), thru(1.0, 0.3, true, 'vleže ano')],
  notes: ['Sklouzlé pytle a písek jsou nízké a bez kolize (nepřekáží).'],
});

// ---------------------------------------------------------------------------
// G167–G172 Beton
// ---------------------------------------------------------------------------
/** Jersey profil podél X: patka 0,6 m, zlom ve 0,33 m, horní hrana 0,15 m, výška 1 m. */
function jersey(x0: number, x1: number, o: { notch?: [number, number]; brokenEnd?: boolean } = {}, seed = 1): Part[] {
  const parts: Part[] = [], L = x1 - x0, cx = (x0 + x1) / 2;
  const seg = (a: number, b: number, top = 1.0) => {
    const c = (a + b) / 2, l = b - a;
    parts.push(bx(a, b, 0, 0.08, -0.3, 0.3, CONC));
    // Spodní šikmé plochy (55°) a horní strmé (84°) z natočených desek; jádro 0,15 m.
    for (const s of [-1, 1]) {
      parts.push({ shape: 'box', pos: [c, 0.205, s * 0.235], rot: [s * -0.6, 0, 0], size: [l, 0.29, 0.1], material: CONC });
      const hTop = top - 0.33;
      parts.push({ shape: 'box', pos: [c, 0.33 + hTop / 2, s * (0.075 + 0.05 * 0.5 + 0.03)], rot: [s * -0.1, 0, 0], size: [l, hTop + 0.02, 0.06], material: CONC });
    }
    parts.push(bx(a, b, 0.08, top, -0.1, 0.1, CONC, false));
    // Kolize: dva kvádry (spodek široký, vršek úzký).
    parts.push({ ...bx(a, b, 0, 0.33, -0.28, 0.28, CONC), render: false }, { ...bx(a, b, 0.33, top, -0.12, 0.12, CONC), render: false });
  };
  if (!o.notch) seg(x0 + (o.brokenEnd ? 0.25 : 0), x1);
  else {
    seg(x0 + (o.brokenEnd ? 0.25 : 0), o.notch[0]);
    seg(o.notch[0], o.notch[1], 0.6);
    seg(o.notch[1], x1);
  }
  if (o.brokenEnd) {
    // Ulomený konec: stupňovitý zbytek a kusy u paty (kolize jen nízká).
    parts.push(bx(x0, x0 + 0.25, 0, 0.45, -0.28, 0.28, CONC), { shape: 'box', pos: [x0 + 0.12, 0.5, 0], rot: [0, 0, 0.5], size: [0.3, 0.12, 0.3], material: 'concreteDark' });
    parts.push(...rubble(x0 - 0.3, -0.4, 4, [0.5, 0.5], seed, 0.3));
    for (let i = 0; i < 3; i++) parts.push({ shape: 'cylinder', pos: [x0 + 0.1, 0.55 + i * 0.12, -0.05 + i * 0.05], rot: [0, 0, 1.0 + i * 0.2], size: [0.02, 0.4, 0.02], material: 'metalSheetRust' });
  }
  if (o.notch) parts.push({ shape: 'box', pos: [(o.notch[0] + o.notch[1]) / 2, 0.62, 0], rot: [0, 0, 0.3], size: [o.notch[1] - o.notch[0], 0.1, 0.2], material: 'concreteDark' });
  // Zvedací otvory na čelech (tmavé) a odvodňovací průchod dole.
  parts.push(bx(cx - 0.3, cx + 0.3, 0.0, 0.12, -0.31, 0.31, 'concreteDark', false));
  void L;
  return parts;
}

regG(167, 'jersey', 'Jersey bariéra', {
  describe: () => 'délka 3 m, výška 1 m, patka 0,6 m, lomený profil (zlom ve 0,33 m), horní hrana 0,15 m',
  generate() {
    return jersey(-1.5, 1.5);
  },
}, {
  target: [3, 0.6, 1],
  route: [{ p: [-1.3, 0, 0.8], note: 'za bariérou' }, { p: [1.3, 0, 0.8] }],
  walkableRoof: false,
  rays: [thru(0, 0.8, true, 'kryje vkleče'), thru(0, 0.2, true, 'patka kryje vleže')],
  notes: ['Kolize = dva kvádry (široký spodek, úzký vršek) – odpovídá lomenému profilu.'],
});

regG(168, 'jerseyDamaged', 'Poškozená jersey bariéra', {
  describe: () => 'jersey 3 m s odlomeným levým koncem a výlomem horní hrany (0,6 m výšky v délce 0,7 m)',
  generate(_p, seed) {
    return jersey(-1.5, 1.5, { notch: [0.2, 0.9], brokenEnd: true }, seed);
  },
}, {
  target: [3, 0.6, 1],
  route: [{ p: [-1.3, 0, 0.8] }, { p: [1.3, 0, 0.8] }],
  walkableRoof: false,
  rays: [thru(0.55, 0.8, false, 'výlomem vkleče střelba'), thru(-0.5, 0.8, true, 'zbytek kryje')],
  notes: ['Hlavní hmota zachovaná, výlom 0,7 m je střelecké místo vkleče.'],
});

regG(169, 'jerseyFence', 'Jersey bariéra s plotem', {
  describe: () => 'jersey 3 m + ocelový rám s pletivem 1,2 m navrch (pletivo průstřelné, beton kryje)',
  generate() {
    const parts = jersey(-1.5, 1.5);
    for (const x of [-1.45, 0, 1.45]) parts.push({ shape: 'cylinder', pos: [x, 1.6, 0], size: [0.05, 1.2, 0.05], material: 'paintedMetal' });
    parts.push({ shape: 'cylinder', pos: [0, 2.2, 0], rot: [0, 0, Math.PI / 2], size: [0.04, 2.95, 0.04], material: 'paintedMetal' });
    parts.push({ shape: 'box', pos: [0, 1.6, 0], size: [2.9, 1.2, 0.01], material: 'chainLink', collide: true, moveOnly: true });
    return parts;
  },
}, {
  target: [3, 0.6, 2.2],
  route: [{ p: [-1.3, 0, 0.8] }, { p: [1.3, 0, 0.8] }],
  walkableRoof: false,
  rays: [thru(0.6, 0.7, true, 'beton zastaví střelu'), thru(0.6, 1.6, false, 'pletivo střelu propustí')],
  notes: ['Beton: plná kolize; pletivo: jen pro pohyb (nepřeleze se, ale střílí se skrz).'],
});

/** Betonový blok se sraženými (mírně poškozenými) hranami. */
function block(W: number, D: number, H: number, seed: number, chip = 0.08, bigChip = false): Part[] {
  const r = rng(seed), parts: Part[] = [];
  parts.push(bx(-W / 2, W / 2, 0, H, -D / 2, D / 2, CONC));
  // Otlučené rohy: tmavší klíny na hranách (vzhled).
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) if (r() < 0.7) parts.push({ shape: 'box', pos: [sx * (W / 2 - chip / 3), H - chip / 3, sz * (D / 2 - chip / 3)], rot: [0.6 * sz, 0.785, 0.6 * sx], size: [chip, chip, chip], material: 'concreteDark' });
  if (bigChip) parts.push({ shape: 'box', pos: [W / 2 - 0.12, H - 0.12, -D / 2 + 0.12], rot: [0.5, 0.6, 0.4], size: [0.3, 0.3, 0.3], material: 'concreteDark' }, ...rubble(W / 2 + 0.3, -D / 2 - 0.3, 3, [0.3, 0.3], seed, 0.2));
  return parts;
}

regG(170, 'blockLow', 'Nízký betonový blok', {
  describe: () => '2 × 0,8 × 1 m, masivní, mírně otlučené hrany',
  generate(_p, seed) {
    return block(2, 0.8, 1.0, seed);
  },
}, {
  target: [2, 0.8, 1],
  route: [{ p: [-0.8, 0, 0.9] }, { p: [0.8, 0, 0.9] }],
  walkableRoof: false,
  rays: [thru(0, 0.8, true, 'kryje vkleče')],
  notes: ['Jedna kolize, horní plocha dosažitelná skokem.'],
});

regG(171, 'blockHigh', 'Vysoký betonový blok', {
  describe: () => '1,5 × 0,8 × 2 m, plný kryt pro stojícího, bez otvorů',
  generate(_p, seed) {
    return block(1.5, 0.8, 2.0, seed);
  },
}, {
  target: [1.5, 0.8, 2],
  route: [{ p: [-0.6, 0, 0.9] }, { p: [0.6, 0, 0.9] }],
  walkableRoof: false,
  rays: [thru(0, 1.7, true, 'kryje stojícího')],
  notes: [],
});

regG(172, 'blockCube', 'Betonová kostka', {
  describe: () => '1,2 × 1,2 × 1,2 m, jeden roh odlomený, pochozí vršek',
  generate(_p, seed) {
    return block(1.2, 1.2, 1.2, seed, 0.08, true);
  },
}, {
  target: [1.2, 1.2, 1.2],
  route: [{ p: [-1.0, 0, 1.0] }, { p: [1.0, 0, 1.0] }],
  walkableRoof: true,
  rays: [thru(0, 1.0, true, 'kryje vkleče')],
  notes: ['Horní plocha 1,2 × 1,2 m pochozí (vyskočit z bedny / suti).'],
});

// ---------------------------------------------------------------------------
// G173–G174 Protitankové ježky (úhelníkový profil, velké průhledy)
// ---------------------------------------------------------------------------
/** Úhelník L 0,12 m z bodu a do b: dvě desky (ramena) se společnou hranou. */
function angleBeam(a: V3, b: V3, w = 0.12, th = 0.012, mat = 'metalSheetRust'): Part[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz)), aa = -pitch;
  const rot = eulerYX(yaw, aa);
  const c = Math.cos(yaw), s = Math.sin(yaw), ca = Math.cos(aa), sa = Math.sin(aa);
  const ex: V3 = [c, 0, -s], ey: V3 = [s * sa, ca, c * sa];
  const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const off = (e: V3, d: number): V3 => [m[0] + e[0] * d, m[1] + e[1] * d, m[2] + e[2] * d];
  return [
    { shape: 'box', pos: off(ex, w / 2), rot, size: [w, th, L], material: mat, collide: true },
    { shape: 'box', pos: off(ey, w / 2), rot, size: [th, w, L], material: mat, collide: true },
  ];
}

/** Tři navzájem kolmé směry se stejným sklonem (ježek stojí na třech koncích). */
function hedgehogDirs(tilt = 0): V3[] {
  return [0, 1, 2].map((k) => {
    const th = (k * 2 * Math.PI) / 3 + 0.4;
    let v: V3 = [Math.sqrt(2 / 3) * Math.cos(th), 1 / Math.sqrt(3), Math.sqrt(2 / 3) * Math.sin(th)];
    if (tilt) v = [v[0], v[1] * Math.cos(tilt) - v[2] * Math.sin(tilt), v[1] * Math.sin(tilt) + v[2] * Math.cos(tilt)];
    return v;
  });
}

regG(173, 'hedgehog', 'Protitankový ježek', {
  describe: () => 'tři navzájem kolmé úhelníky 120 × 120 mm, délka 2,6 m, výška 1,5 m, stojí na třech koncích',
  generate() {
    const parts: Part[] = [], half = 1.3, cy = 0.75;
    for (const v of hedgehogDirs()) parts.push(...angleBeam([v[0] * -half, cy - v[1] * half, v[2] * -half], [v[0] * half, cy + v[1] * half, v[2] * half]));
    // Spojovací plech ve středu.
    parts.push(bx(-0.12, 0.12, cy - 0.12, cy + 0.12, -0.12, 0.12, 'metalSheetRust', false));
    return parts;
  },
}, {
  target: [2.2, 2.2, 1.5],
  route: [{ p: [-1.8, 0, -1.8] }, { p: [1.8, 0, -1.8], note: 'kolem ježku' }],
  walkableRoof: false,
  rays: [{ from: [-3, 0.5, 0.6], to: [3, 0.5, 0.6], hit: false, note: 'velké průhledy – střela projde' }],
  notes: ['Kolize = 6 tenkých desek (skutečný profil), ne plný kvádr: blokuje pohyb, střelbu jen v místě nosníku.'],
});

regG(174, 'hedgehogDamaged', 'Poškozený ježek', {
  describe: () => 'ježek nakloněný o 15°, jeden nosník ohnutý v půli, průhledy zachované',
  generate() {
    const parts: Part[] = [], half = 1.3, cy = 0.72;
    const dirs = hedgehogDirs(0.26);
    dirs.forEach((v, k) => {
      const a: V3 = [v[0] * -half, cy - v[1] * half, v[2] * -half], b: V3 = [v[0] * half, cy + v[1] * half, v[2] * half];
      if (k === 1) {
        // Ohnutý: střed → konec vychýlený o 0,35 m dolů.
        const m: V3 = [0, cy, 0], bb: V3 = [b[0] * 0.95, b[1] - 0.45, b[2] * 0.95];
        parts.push(...angleBeam(a, m), ...angleBeam(m, bb));
      } else parts.push(...angleBeam(a, b));
    });
    // Konce pod zemí zvednout: posun tak, aby nejnižší bod byl na zemi.
    let minY = Infinity;
    for (const p of parts) minY = Math.min(minY, p.pos[1] - 0.05);
    return parts.map((p) => ({ ...p, pos: [p.pos[0], p.pos[1] - Math.min(0, minY), p.pos[2]] as V3 }));
  },
}, {
  target: [2.2, 2.2, 1.5],
  route: [{ p: [-1.8, 0, -1.8] }, { p: [1.8, 0, -1.8] }],
  walkableRoof: false,
  rays: [{ from: [-3, 0.5, 0.6], to: [3, 0.5, 0.6], hit: false, note: 'průhledy zachované' }],
  notes: ['Bez obalové kolize – jen desky nosníků.'],
});

// ---------------------------------------------------------------------------
// G175–G178 Suť
// ---------------------------------------------------------------------------
/** Kus betonu: natočený kvádr (kolize) s tmavší lomovou plochou. */
const chunk = (x: number, y: number, z: number, s: V3, rot: V3, collide = true, mat = CONC): Part => ({ shape: 'box', pos: [x, y, z], rot, size: s, material: mat, collide });

regG(175, 'rubbleSmall', 'Malá hromada sutě', {
  describe: () => 'půdorys 2 × 1,5 m, výška 0,8 m, několik velkých betonových kusů a jedna výplň',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    parts.push({ shape: 'blob', pos: [0, 0.3, 0], size: [1.9, 0.6, 1.4], material: 'concreteDark', seed, rough: 0.35, collide: true });
    for (let i = 0; i < 5; i++) parts.push(chunk((r() - 0.5) * 1.3, 0.3 + r() * 0.3, (r() - 0.5) * 0.9, [0.6 + r() * 0.4, 0.22 + r() * 0.15, 0.4 + r() * 0.3], [(r() - 0.5) * 0.8, r() * 3, (r() - 0.5) * 0.8], i < 2));
    return parts;
  },
}, {
  target: [2, 1.5, 0.8],
  route: [{ p: [-1.6, 0, 1.2] }, { p: [1.6, 0, 1.2] }],
  walkableRoof: true,
  rays: [thru(0, 0.35, true, 'kryje vleže')],
  notes: ['Výplň = jeden konvexní objem (kolize), dva velké kusy mají vlastní kolizi, zbytek vzhled.'],
});

regG(176, 'rubbleRebar', 'Velká suť s armaturou', {
  describe: () => 'půdorys 4 × 3 m, výška 1,8 m, dominantní odlomená deska, silné pruty (bez pohybové kolize)',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    parts.push({ shape: 'blob', pos: [0, 0.4, 0.2], size: [3.6, 0.8, 2.6], material: 'concreteDark', seed, rough: 0.3, collide: true });
    // Deska 2,6 × 1,8 × 0,22 m opřená šikmo (hrana ve 1,8 m) – vysoký kryt.
    parts.push(chunk(-0.3, 1.0, -0.4, [2.6, 0.22, 1.9], [-0.9, 0.15, 0.08]));
    parts.push(chunk(-0.3, 1.0, -0.4, [2.56, 0.02, 1.86], [-0.9, 0.15, 0.08], false, 'concreteLight'));
    for (let i = 0; i < 4; i++) parts.push(chunk(-1.2 + r() * 2.6, 0.5 + r() * 0.3, 0.4 + r() * 0.8, [0.7, 0.3, 0.5], [r() - 0.5, r() * 3, r() - 0.5], i < 2));
    // Armatura z horní hrany desky (Ø 25 mm, vzhled).
    for (let i = 0; i < 6; i++) parts.push({ shape: 'cylinder', pos: [-1.4 + i * 0.45, 1.75 + r() * 0.2, -0.95 - r() * 0.1], rot: [0.4 + r() * 0.6, r() - 0.5, (r() - 0.5) * 0.5], size: [0.025, 0.7 + r() * 0.4, 0.025], material: 'metalSheetRust' });
    return parts;
  },
}, {
  target: [4, 3, 1.8],
  route: [{ p: [-2.6, 0, 1.8], note: 'za sutí' }, { p: [2.6, 0, 1.8] }],
  walkableRoof: true,
  rays: [thru(-0.3, 1.4, true, 'deska kryje stojícího', -3, 2)],
  notes: ['Armatura bez kolize; deska a výplň s kolizí (výplň je konvexní objem).'],
});

regG(177, 'wallCollapse', 'Zřícený úsek zdi', {
  describe: () => 'obálka 5 × 2 × 2 m: stojící zbytek zdi 2 m (vysoký kryt) přechází do hromady suti',
  generate(_p, seed, mat) {
    const r = rng(seed), parts: Part[] = [];
    parts.push(bx(-2.5, -0.9, 0, 2.0, -0.15, 0.15, mat), bx(-0.9, -0.3, 0, 1.4, -0.15, 0.15, mat), bx(-0.3, 0.2, 0, 0.8, -0.15, 0.15, mat));
    for (const [x, y, rz] of [[-0.9, 1.75, 0.6], [-0.3, 1.15, 0.5], [0.2, 0.6, 0.6]] as const) parts.push({ shape: 'box', pos: [x, y, 0], rot: [0, 0, rz], size: [0.4, 0.12, 0.32], material: 'brick' });
    parts.push({ shape: 'blob', pos: [1.2, 0.35, 0.1], size: [2.6, 0.7, 1.8], material: 'concreteDark', seed, rough: 0.35, collide: true });
    for (let i = 0; i < 6; i++) parts.push(chunk(0.4 + r() * 1.8, 0.4 + r() * 0.3, (r() - 0.5) * 1.2, [0.5 + r() * 0.3, 0.2, 0.35], [r() - 0.5, r() * 3, r() - 0.5], false, i % 2 ? 'brick' : CONC));
    return parts;
  },
}, {
  target: [5, 2, 2],
  route: [{ p: [-2.0, 0, 1.0], note: 'za stojící zdí' }, { p: [2.2, 0, 1.4], note: 'za sutí' }],
  walkableRoof: false,
  rays: [thru(-1.7, 1.7, true, 'zbytek zdi kryje stojícího'), thru(1.2, 0.4, true, 'suť kryje vleže')],
  notes: ['Silueta klesá 2,0 → 1,4 → 0,8 m a pak suť 0,7 m.'],
});

regG(178, 'rubbleBerm', 'Podlouhlá betonová suť', {
  describe: () => 'obálka 6 × 2 × 1,1 m, nepravidelný val podél ulice (4 konvexní objemy)',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    for (let i = 0; i < 4; i++) parts.push({ shape: 'blob', pos: [-2.25 + i * 1.5, 0.45 + r() * 0.1, (r() - 0.5) * 0.3], size: [1.9, 0.9 + r() * 0.25, 1.7], material: 'concreteDark', seed: seed + i * 13, rough: 0.35, collide: true });
    for (let i = 0; i < 6; i++) parts.push(chunk(-2.6 + r() * 5.2, 0.7 + r() * 0.2, (r() - 0.5) * 1.0, [0.5 + r() * 0.4, 0.2, 0.4], [r() - 0.5, r() * 3, r() - 0.5], false));
    return parts;
  },
}, {
  target: [6, 2, 1.1],
  route: [{ p: [-2.8, 0, 1.4], note: 'za valem' }, { p: [2.8, 0, 1.4] }],
  walkableRoof: true,
  rays: [thru(-1.0, 0.5, true, 'kryje vleže / vkleče'), thru(1.5, 0.5, true, '')],
  notes: [],
});

// ---------------------------------------------------------------------------
// G179–G182 Barikády
// ---------------------------------------------------------------------------
/**
 * Jednoduchý civilní vrak (sedan) podél X: karoserie, kabina, kola. `flip` = na střeše.
 * Kolize: spodek karoserie + kabina (2 kvádry). Sdílí ho sekce H.
 */
export function sedan(cx: number, cz: number, yaw: number, o: { flip?: boolean; burnt?: boolean; seed: number }): Part[] {
  const L = 4.4, W = 1.75, r = rng(o.seed);
  const body = o.burnt ? 'burntMetal' : ['paintedMetalBlue', 'paintedMetalRed', 'plasterWhite', 'metal'][Math.floor(r() * 4)];
  const local: Part[] = [];
  const y = (v: number, h: number) => (o.flip ? 1.45 - v - h : v); // spodní hrana dílu
  const box = (x0: number, x1: number, v: number, h: number, z0: number, z1: number, mat: string, collide = false): Part => bx(x0, x1, y(v, h), y(v, h) + h, z0, z1, mat, collide);
  local.push(box(-L / 2, L / 2, 0.3, 0.55, -W / 2, W / 2, body, true));
  local.push(box(-1.0, 1.1, 0.85, 0.55, -W / 2 + 0.12, W / 2 - 0.12, body, true));
  local.push(box(-0.95, 1.05, 0.9, 0.42, -W / 2 + 0.1, W / 2 - 0.1, o.burnt ? 'burntMetal' : 'glass'));
  for (const x of [-1.35, 1.35]) for (const s of [-1, 1]) local.push({ shape: 'cylinder', pos: [x, o.flip ? 1.1 : 0.33, s * (W / 2 - 0.08)], rot: [Math.PI / 2, 0, 0], size: [0.64, 0.2, 0.64], material: 'rubber' });
  local.push(box(-L / 2 - 0.04, -L / 2 + 0.05, 0.35, 0.15, -W / 2 + 0.05, W / 2 - 0.05, 'metal'), box(L / 2 - 0.05, L / 2 + 0.04, 0.35, 0.15, -W / 2 + 0.05, W / 2 - 0.05, 'metal'));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return local.map((p) => ({ ...p, pos: [cx + c * p.pos[0] + s * p.pos[2], p.pos[1], cz - s * p.pos[0] + c * p.pos[2]] as V3, rot: p.rot ? (p.shape === 'cylinder' ? eulerYX(yaw, Math.PI / 2) : [p.rot[0], p.rot[1] + yaw, p.rot[2]]) : [0, yaw, 0] }));
}

/** Stoh pneumatik. */
const tires = (x: number, z: number, n: number): Part[] => {
  const parts: Part[] = [{ shape: 'cylinder', pos: [x, (n * 0.22) / 2, z], size: [0.68, n * 0.22, 0.68], material: 'rubber', collide: true, render: false }];
  for (let i = 0; i < n; i++) parts.push({ shape: 'cylinder', pos: [x + (i % 2) * 0.03, 0.11 + i * 0.22, z], size: [0.66, 0.2, 0.66], material: 'rubber' }, { shape: 'cylinder', pos: [x, 0.11 + i * 0.22, z], size: [0.38, 0.205, 0.38], material: 'gunMetal' });
  return parts;
};

regG(179, 'barricadeCarTires', 'Barikáda z auta a pneumatik', {
  describe: () => 'převrácený civilní vrak 4,4 m + dva stohy pneumatik (5 a 4 kusy), šířka 5,8 m',
  generate(_p, seed) {
    return [...sedan(-0.6, 0, 0, { flip: true, seed }), ...tires(2.3, -0.3, 5), ...tires(2.4, 0.45, 4)];
  },
}, {
  target: [5.8, 1.8, 1.45],
  route: [{ p: [-2.4, 0, 1.6], note: 'za vrakem' }, { p: [2.4, 0, 1.6], note: 'za pneumatikami' }],
  walkableRoof: false,
  rays: [thru(-0.6, 0.9, true, 'vrak kryje vkleče'), thru(2.3, 0.8, true, 'pneumatiky kryjí')],
  notes: ['Vrak je zjednodušený (karoserie, kabina, kola); podrobné vraky přijdou v sekci H.'],
});

regG(180, 'barricadeTwoCars', 'Barikáda ze dvou vraků', {
  describe: () => 'dva vraky šikmo přes ulici, mezi nimi pěší průchod 1,4 m',
  generate(_p, seed) {
    return [...sedan(-3.1, 0.2, 0.35, { seed, burnt: true }), ...sedan(3.1, -0.2, -0.35, { seed: seed + 1 })];
  },
}, {
  target: [10.6, 3.2, 1.45],
  route: [{ p: [0, 0, -2.5], note: 'před barikádou' }, { p: [0, 0, 0], note: 'pěší průchod' }, { p: [0, 0, 2.5], note: 'za barikádou' }],
  walkableRoof: false,
  rays: [thru(-3.4, 0.9, true, 'vrak kryje'), thru(0, 1.0, false, 'průchod')],
  notes: ['Kolize vraků = 2 natočené kvádry na vůz; průchod mezi předky ≥ 1,4 m (ověřeno trasou).'],
});

regG(181, 'barricadeTables', 'Barikáda ze stolů a dveří', {
  describe: () => 'obálka 3 × 1,2 × 1,4 m: převrácený stůl (deska jako štít), tři dveřní desky, bedna jako opora',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    // Stůl na boku: deska svisle, nohy vodorovně dozadu.
    parts.push(bx(-1.5, -0.1, 0, 0.8, -0.05, 0.0, 'wood'));
    for (const x of [-1.4, -0.2]) for (const y of [0.06, 0.74]) parts.push(bx(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0, 0.72, 'woodDark', false));
    // Dveře opřené šikmo (kolize).
    for (const [x, rot] of [[0.3, 0.2], [0.8, 0.26], [1.3, 0.18]] as const) parts.push({ shape: 'box', pos: [x, 0.98, 0.18], rot: [rot, (r() - 0.5) * 0.1, 0], size: [0.85, 2.0, 0.05], material: 'woodDark', collide: true });
    parts.push(...crate(0.8, 0.75, 0, 0.6), ...crate(-0.8, 0.6, 0, 0.5));
    return parts;
  },
}, {
  target: [3, 1.2, 1.4],
  route: [{ p: [-1.2, 0, 1.5], note: 'za barikádou' }, { p: [1.2, 0, 1.5] }],
  walkableRoof: false,
  rays: [thru(-0.8, 0.6, true, 'deska stolu kryje'), thru(0.8, 1.2, true, 'dveře kryjí')],
  notes: ['Měkký kryt (dřevo) – v herních datech povrch wood.'],
});

regG(182, 'barricadeWardrobes', 'Barikáda ze skříní', {
  describe: () => 'obálka 3 × 1,5 × 2 m: stojící skříň 2 m, převrácená skříň, komoda',
  generate() {
    const parts: Part[] = [];
    parts.push(bx(-1.5, -0.5, 0, 2.0, -0.3, 0.3, 'woodDark'), bx(-1.47, -1.0, 0.1, 1.9, -0.31, -0.3, 'wood', false), bx(-0.98, -0.53, 0.1, 1.9, -0.31, -0.3, 'wood', false));
    parts.push({ shape: 'box', pos: [0.45, 0.32, 0.1], rot: [0, 0.08, 0], size: [1.9, 0.62, 0.95], material: 'woodDark', collide: true });
    parts.push(bx(0.3, 1.5, 0.64, 1.5, -0.25, 0.3, 'wood'), bx(0.35, 1.45, 1.0, 1.04, -0.26, -0.25, 'woodDark', false));
    return parts;
  },
}, {
  target: [3, 1.5, 2],
  route: [{ p: [-1.2, 0, 1.4], note: 'za barikádou' }, { p: [1.2, 0, 1.4] }],
  walkableRoof: false,
  rays: [thru(-1.0, 1.8, true, 'skříň kryje stojícího'), thru(0.9, 1.3, true, 'komoda na skříni kryje vkleče')],
  notes: ['Nepravidelná silueta 2,0 / 1,5 m.'],
});

// ---------------------------------------------------------------------------
// G183–G184 Betonové roury (průchozí)
// ---------------------------------------------------------------------------
function pipeRing(L: number, seed: number): Part[] {
  const rin = 1.1, wt = 0.2, rc = rin + wt / 2, cy = rin + wt, parts: Part[] = [];
  // Vzhled: 16 segmentů; kolize: 8 desek tečných k vnitřnímu líci (vnitřek nikde užší než kruh).
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 2 * Math.PI;
    parts.push({ shape: 'box', pos: [Math.sin(a) * rc, cy - Math.cos(a) * rc, 0], rot: [0, 0, a], size: [(2 * Math.PI * rc) / 16 + 0.02, wt, L], material: CONC });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI, rr = rin / Math.cos(Math.PI / 8) + wt / 2;
    const w = 2 * (rin + 0.02) * Math.tan(Math.PI / 8);
    void rr;
    parts.push({ shape: 'box', pos: [Math.sin(a) * (rin + wt / 2), cy - Math.cos(a) * (rin + wt / 2), 0], rot: [0, 0, a], size: [w + 0.18, wt, L], material: CONC, collide: true, render: false });
  }
  // Rovná podlaha uvnitř (nízká, zakrývá spodní segment) pro hladký pohyb.
  parts.push(bx(-0.55, 0.55, wt, wt + 0.06, -L / 2, L / 2, 'concreteDark'));
  // Lem čel a podložky.
  for (const s of [-1, 1]) parts.push(bx(-0.8, 0.8, 0, 0.12, s * (L / 2 - 0.3) - 0.2, s * (L / 2 - 0.3) + 0.2, 'woodDark', false));
  void seed;
  return parts;
}

regG(183, 'pipeShort', 'Krátká betonová roura', {
  describe: () => 'délka 2,5 m, vnitřní Ø 2,2 m, stěna 0,2 m, obě čela otevřená, uvnitř rovný pás pro chůzi',
  generate(_p, seed) {
    return pipeRing(2.5, seed);
  },
}, {
  target: [2.6, 2.5, 2.6],
  route: [{ p: [0, 0, -2.2], note: 'před rourou' }, { p: [0, 0.26, 0], note: 'uvnitř' }, { p: [0, 0, 2.2], note: 'ven' }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.2, 0], to: [0, 1.2, 0], hit: true, note: 'stěna roury kryje' }, { from: [0, 1.2, -3], to: [0, 1.2, 3], hit: false, note: 'podélně průstřelná' }],
  notes: ['Kapsle stojícího hráče (1,8 m) prochází uvnitř – ověřeno trasou. Kolize: 8 desek tečných k vnitřnímu líci, vnitřek nikde užší než kruh.'],
});

regG(184, 'pipeLong', 'Dlouhá betonová roura', {
  describe: () => 'délka 5 m, stejný profil jako G183, 8 kolizních desek (prioritou je bezpečný průchod)',
  generate(_p, seed) {
    return pipeRing(5, seed);
  },
}, {
  target: [2.6, 5, 2.6],
  route: [{ p: [0, 0, -3.4], note: 'před rourou' }, { p: [0, 0.26, -1.5] }, { p: [0, 0.26, 1.5], note: 'uvnitř' }, { p: [0, 0, 3.4], note: 'ven' }],
  walkableRoof: false,
  rays: [{ from: [0, 1.2, -4], to: [0, 1.2, 4], hit: false, note: 'podélně průstřelná' }],
  notes: ['Stejné kolize jako krátká roura, jen delší – bez zúžení.'],
});

// ---------------------------------------------------------------------------
// G185–G187 Stohy beden
// ---------------------------------------------------------------------------
regG(185, 'cratesLow', 'Nízký stoh beden', {
  describe: () => 'půdorys 2 × 1,5 m, výška 1,0 m, čtyři bedny různé velikosti bez mezer',
  generate() {
    return [...crate(-0.5, -0.25, 0, 1.0), ...crate(0.5, -0.35, 0, 0.8), ...crate(0.5, 0.4, 0, 0.7), ...crate(-0.5, 0.5, 0, 0.5)];
  },
}, {
  target: [2, 1.5, 1],
  route: [{ p: [-1.5, 0, 1.3] }, { p: [1.5, 0, 1.3] }],
  walkableRoof: true,
  rays: [thru(-0.5, 0.8, true, 'kryje vkleče')],
  notes: [],
});

regG(186, 'cratesMid', 'Střední stoh beden', {
  describe: () => 'půdorys 2,5 × 1,8 m, výška 1,5 m, stupňovitá silueta, horní bedna mírně odsazená',
  generate() {
    return [...crate(-0.7, -0.4, 0, 1.0), ...crate(0.35, -0.4, 0, 1.0), ...crate(-0.75, 0.55, 0, 0.8), ...crate(0.4, 0.55, 0, 0.7), ...crate(-0.55, -0.35, 1.0, 0.5, 0.15), ...crate(1.05, 0.4, 0, 0.5)];
  },
}, {
  target: [2.5, 1.8, 1.5],
  route: [{ p: [-1.7, 0, 1.4] }, { p: [1.8, 0, 1.4] }],
  walkableRoof: true,
  rays: [thru(-0.55, 1.3, true, 'horní bedna kryje')],
  notes: [],
});

regG(187, 'cratesHigh', 'Vysoký stoh beden', {
  describe: () => 'půdorys 3 × 2 m, výška 2,2 m, nepravidelný, stabilní vysoký kryt',
  generate() {
    return [...crate(-1.0, -0.45, 0, 1.0), ...crate(0.05, -0.45, 0, 1.1), ...crate(1.05, -0.4, 0, 0.9), ...crate(-0.95, 0.55, 0, 0.9), ...crate(0.1, 0.6, 0, 0.8), ...crate(-0.95, -0.4, 1.0, 1.0, 0.1), ...crate(0.1, -0.45, 1.1, 0.9, -0.08), ...crate(-0.95, 0.5, 0.9, 0.6)];
  },
}, {
  target: [3, 2, 2.2],
  route: [{ p: [-1.8, 0, 1.6] }, { p: [1.8, 0, 1.6] }],
  walkableRoof: false,
  rays: [thru(-0.5, 1.8, true, 'kryje stojícího')],
  notes: ['Horní řada natočená ±5° – nepravidelná silueta bez mezer v kolizi.'],
});

// ---------------------------------------------------------------------------
// G188 Zeď z pneumatik, G189–G190 Hliněné valy
// ---------------------------------------------------------------------------
regG(188, 'tireWall', 'Zeď z pneumatik', {
  describe: () => 'délka 4 m, výška 1,2 m, dvě převázané řady ležících pneumatik (5 vrstev), některé vyplněné zeminou',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [{ ...bx(-2, 2, 0, 1.2, -0.65, 0.65, 'rubber'), render: false }];
    for (let layer = 0; layer < 5; layer++) for (const z of [-0.33, 0.33]) {
      const off = ((layer + (z > 0 ? 1 : 0)) % 2) * 0.33;
      for (let x = -2 + 0.33 + off; x < 2 - 0.3; x += 0.66) {
        const y = 0.12 + layer * 0.24;
        parts.push({ shape: 'cylinder', pos: [x, y, z], size: [0.64, 0.22, 0.64], material: 'rubber' });
        parts.push({ shape: 'cylinder', pos: [x, y + 0.005, z], size: [0.36, 0.225, 0.36], material: r() < 0.4 ? 'dirt' : 'gunMetal' });
      }
    }
    return parts;
  },
}, {
  target: [4, 1.3, 1.2],
  route: [{ p: [-1.6, 0, 1.4] }, { p: [1.6, 0, 1.4] }],
  walkableRoof: false,
  rays: [thru(0, 1.0, true, 'kryje vkleče')],
  notes: ['Kolize jeden kvádr (vrstvy jsou převázané, bez průhledů).'],
});

/** Val podél X: dva svahy (klíny) a vršek; volitelně pozvolný konec (rampa). */
function berm(L: number, W: number, H: number, top: number, seed: number, ramp = 0): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const run = (W - top) / 2;
  const x0 = -L / 2 + ramp, x1 = L / 2;
  for (const s of [-1, 1]) parts.push({ shape: 'wedge', pos: [(x0 + x1) / 2, H / 2, s * (top / 2 + run / 2)], rot: [0, s < 0 ? 0 : Math.PI, 0], size: [x1 - x0, H, run], material: 'dirt', collide: true });
  parts.push(bx(x0, x1, 0, H, -top / 2, top / 2, 'dirt'));
  if (ramp) {
    // Pozvolná rampa na −X konci (celá šířka vršku, svahy po stranách).
    parts.push({ shape: 'wedge', pos: [-L / 2 + ramp / 2, H / 2, 0], rot: [0, Math.PI / 2, 0], size: [W - 0.2, H, ramp], material: 'dirt', collide: true });
  }
  // Nepravidelný vršek a okraje (vzhled).
  for (let i = 0; i < Math.round(L / 1.2); i++) parts.push({ shape: 'blob', pos: [x0 + 0.5 + r() * (x1 - x0 - 1), H - 0.05, (r() - 0.5) * top], size: [1.2, 0.25, top + 0.4], material: 'dirt', seed: seed + i, rough: 0.4 });
  // Čela (kolmá) zakryje nízký zával (vzhled).
  parts.push({ shape: 'blob', pos: [x1, H * 0.4, 0], size: [0.8, H * 0.8, W * 0.8], material: 'dirt', seed: seed + 99, rough: 0.3 });
  if (!ramp) parts.push({ shape: 'blob', pos: [x0, H * 0.4, 0], size: [0.8, H * 0.8, W * 0.8], material: 'dirt', seed: seed + 98, rough: 0.3 });
  return parts;
}

regG(189, 'bermLow', 'Nízký hliněný val', {
  describe: () => 'délka 6 m, šířka 2,5 m, výška 1 m, pozvolné boky (42°, dají se vyjít), nepravidelný vršek',
  generate(_p, seed) {
    return berm(6, 2.5, 1.0, 0.3, seed);
  },
}, {
  target: [6, 2.5, 1.1],
  route: [{ p: [0, 0, -2.2], note: 'před valem' }, { p: [0, 1.0, 0], note: 'na valu (přes svah)' }, { p: [0, 0, 2.2], note: 'za valem' }],
  walkableRoof: true,
  rays: [thru(0, 0.6, true, 'val kryje vleže / vkleče')],
  notes: ['Kolize svahů = klíny (sklon 42°) – pohyb odpovídá svahu, nahoru se dá vyjít.'],
});

regG(190, 'bermHigh', 'Vysoký hliněný val', {
  describe: () => 'délka 8 m, šířka 4 m, výška 2 m, strmé boky (51°), jeden konec pozvolna klesá (rampa 30°) pro výstup',
  generate(_p, seed) {
    return berm(8, 4, 2.0, 0.8, seed, 3.5);
  },
}, {
  target: [8, 4, 2.1],
  route: [{ p: [-5.0, 0, 0], note: 'u rampy' }, { p: [0.5, 2.0, 0], note: 'na valu' }, { p: [3.0, 2.0, 0] }],
  walkableRoof: true,
  rays: [thru(1.0, 1.7, true, 'kryje stojícího')],
  notes: ['Boky 51° nejdou vyjít (kryt), na val se dostane jen rampou na −X konci.'],
});
