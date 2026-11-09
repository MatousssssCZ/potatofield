import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import type { Params } from '../../registry';
import { M, landing, rail, stairs, wall, type Op, type P2 } from './bk';
import { TRIM, reg, type SetMeta } from './residential';

/**
 * Sada 300 · B Stavební moduly (položky 31–60): fasády, výklenky, rohy, štíty, střechy,
 * nástavby, schodiště, balkony a podloubí pro skládání delších ulic.
 *
 * Společné konvence (N):
 * - pivot = střed půdorysu u paty, přední (uliční) líc směrem −Z,
 * - zdi 0,3 m, výška modulu 3,2 m (u pilotních výklenků 3,5 m podle pilotu), konce zdí rovné,
 * - střechy a nástavby se lepí nahoru (mount top), balkony na zeď (mount wall, zadní hrana z = 0),
 * - okna jsou skutečné otvory (průstřel), pilíře a plné zdi jsou kryt.
 */
const t = M.wall;
const FACE = -t / 2; // přední líc rovné fasády
const B = 'B' as const;

type Meta = Omit<SetMeta, 'item'>;
const regB = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, B);

const n = (p: Params, k: string) => p[k] as number;
const heightParam = (def: number) => ({ key: 'h', label: 'Výška stěny', type: 'number' as const, min: 2.6, max: 4.6, step: 0.1, unit: 'm', default: def });

// ---------------------------------------------------------------------------
// Pomocné díly
// ---------------------------------------------------------------------------

/** Kvádr podle rozsahů [x0, x1] × [y0, y1] × [z0, z1]. */
function bx(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: string, collide = true): Part {
  return { shape: 'box', pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0], material, collide };
}

/** Rovná stěna podél X v ose z = zc s otvory v absolutní souřadnici x; vnější strana −Z. */
function wallX(x0: number, x1: number, zc: number, y0: number, h: number, ops: Op[], mat: string, thick = t, trim = TRIM, out: P2 | null = [0, -1]): Part[] {
  return wall([x0, zc], [x1, zc], y0, h, thick, ops.map((o) => ({ ...o, c: o.c - x0 })), mat, out ? { out, trim } : { plain: true });
}

/** Pás na předním líci (sokl, římsa, pás cedule) s mezerami (např. dveře); jen vzhled. */
function faceStrip(x0: number, x1: number, y0: number, y1: number, face: number, depth: number, mat: string, gaps: P2[] = []): Part[] {
  const parts: Part[] = [];
  let cur = x0;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g0 - cur > 0.02) parts.push(bx(cur, g0, y0, y1, face - depth, face, mat, false));
    cur = Math.max(cur, g1);
  }
  if (x1 - cur > 0.02) parts.push(bx(cur, x1, y0, y1, face - depth, face, mat, false));
  return parts;
}

const doorOp = (c: number, w = 1.2, h = 2.3): Op => ({ c, w, b: 0, t: h, kind: 'door' });
const winOp = (c: number, w = 1.4, b = 1.0, top = 2.3): Op => ({ c, w, b, t: top, kind: 'window' });
const gapsOf = (ops: Op[]): P2[] => ops.filter((o) => o.b < 0.3).map((o) => [o.c - o.w / 2 - 0.05, o.c + o.w / 2 + 0.05]);

/** Ostění: vystupující šambrána kolem otvoru na předním líci (boky + nadpraží), jen vzhled. */
function surround(o: Op, face: number, mat: string, w = 0.14, d = 0.05): Part[] {
  const x0 = o.c - o.w / 2, x1 = o.c + o.w / 2;
  return [
    bx(x0 - w, x0, o.b, o.t, face - d, face, mat, false),
    bx(x1, x1 + w, o.b, o.t, face - d, face, mat, false),
  ];
}

/** Suť: hranaté kusy (jen vzhled, nízké, mimo průchozí osu podle zadání). */
function rubble(x: number, z: number, n: number, spread: [number, number], seed: number, size = 0.45): Part[] {
  const r = rng(seed);
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const s = size * (0.5 + r() * 0.8);
    parts.push({ shape: 'box', pos: [x + (r() - 0.5) * spread[0], s * 0.15, z + (r() - 0.5) * spread[1]], rot: [(r() - 0.5) * 0.7, r() * Math.PI, (r() - 0.5) * 0.7], size: [s * 1.2, s * (0.25 + r() * 0.3), s * (0.6 + r() * 0.5)], material: r() < 0.7 ? 'concreteLight' : 'brick' });
  }
  return parts;
}

/** Rovná fasáda délky L (osa z = 0), otvory, sokl a římsa. */
function facade(L: number, h: number, ops: Op[], mat: string, o: { plinth?: number; cornice?: boolean; surrounds?: boolean } = {}): Part[] {
  const parts = wallX(-L / 2, L / 2, 0, 0, h, ops, mat);
  const gaps = gapsOf(ops);
  if (o.plinth) parts.push(...faceStrip(-L / 2, L / 2, 0, o.plinth, FACE, 0.04, 'concreteDark', gaps));
  if (o.cornice !== false) parts.push(bx(-L / 2, L / 2, h - 0.2, h - 0.06, FACE - 0.08, FACE, TRIM, false));
  if (o.surrounds) for (const op of ops) parts.push(...surround(op, FACE, TRIM));
  return parts;
}

/** Paprsky střel kolmo přes stěnu (v x, výška y): `hit` = má narazit. */
const thru = (x: number, y: number, hit: boolean, note: string, z0 = -3, z1 = 3) => ({ from: [x, y, z0] as [number, number, number], to: [x, y, z1] as [number, number, number], hit, note });

// ---------------------------------------------------------------------------
// B31–B38 Rovné fasády 4 m a 8 m
// ---------------------------------------------------------------------------
regB(31, 'facade4Window', 'Fasáda 4 m s oknem', {
  describe: (p) => `4 × 0,3 × ${n(p, 'h').toFixed(1)} m, okno 1,4 × 1,3 m, parapet 1,0 m`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    return facade(4, n(p, 'h'), [winOp(0)], mat, { plinth: 0.35, surrounds: true });
  },
}, {
  target: [4, 0.3, 3.2],
  route: [{ p: [-1.8, 0, -1.2], note: 'před fasádou' }, { p: [1.8, 0, -1.2], note: 'podél fasády' }],
  walkableRoof: false,
  rays: [thru(0, 1.6, false, 'oknem projde střela'), thru(-1.4, 1.6, true, 'pilíř kryje'), thru(0, 0.6, true, 'parapetní zídka kryje vleže')],
  notes: ['Okno je skutečný otvor (průstřel), parapet 1,0 m chrání vleže a v kleku.', 'Konce zdí rovné 0,3 m – navazují na další moduly i rohy B43–B46.'],
});

regB(32, 'facade4Door', 'Fasáda 4 m s dveřmi', {
  describe: (p) => `4 × 0,3 × ${n(p, 'h').toFixed(1)} m, dveřní otvor 1,2 × 2,3 m mimo střed`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const d = doorOp(0.5);
    const parts = facade(4, n(p, 'h'), [d], mat, { plinth: 0.35 });
    // Silné ostění (0,2 m) a jednoduchý překlad; bez dveřního křídla.
    parts.push(...surround(d, FACE, TRIM, 0.2, 0.08));
    parts.push(bx(d.c - d.w / 2 - 0.2, d.c + d.w / 2 + 0.2, d.t, d.t + 0.25, FACE - 0.08, FACE, 'concreteLight', false));
    return parts;
  },
}, {
  target: [4, 0.3, 3.2],
  route: [{ p: [0.5, 0, -2.0], note: 'ulice' }, { p: [0.5, 0, 0], note: 'dveřní otvor' }, { p: [0.5, 0, 2.0], note: 'za fasádou' }],
  walkableRoof: false,
  rays: [thru(0.5, 1.5, false, 'dveřní otvor volný'), thru(-1.2, 1.5, true, 'plná část kryje')],
  notes: ['Dveřní otvor 1,2 × 2,3 m bez křídla, posunutý o 0,5 m od středu.'],
});

regB(33, 'facade4Shop', 'Fasáda 4 m s výlohou', {
  describe: (p) => `4 × 0,3 × ${n(p, 'h').toFixed(1)} m, výloha 1,8 × 2,0 m na soklu 0,5 m, dveře 1,1 × 2,3 m, pás cedule`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const h = n(p, 'h');
    const shop: Op = { c: -0.75, w: 1.8, b: 0.5, t: 2.5, kind: 'window' };
    const d = doorOp(1.1, 1.1, 2.3);
    const parts = facade(4, h, [shop, d], mat, { plinth: 0.5 });
    // Rám výlohy (kovový, jen vzhled) a prázdná cedule nad otvory.
    const fx0 = shop.c - shop.w / 2, fx1 = shop.c + shop.w / 2;
    parts.push(bx(fx0, fx1, shop.b, shop.b + 0.06, -0.05, 0.05, 'paintedMetal', false));
    parts.push(bx(fx0, fx1, shop.t - 0.06, shop.t, -0.05, 0.05, 'paintedMetal', false));
    for (const x of [fx0 + 0.03, fx1 - 0.03]) parts.push(bx(x - 0.03, x + 0.03, shop.b, shop.t, -0.05, 0.05, 'paintedMetal', false));
    parts.push(bx(-1.85, 1.85, 2.6, Math.min(h - 0.25, 3.0), FACE - 0.07, FACE, 'paintedMetal', false));
    return parts;
  },
}, {
  target: [4, 0.3, 3.2],
  route: [{ p: [1.1, 0, -2.0], note: 'ulice' }, { p: [1.1, 0, 0], note: 'vstup do obchodu' }, { p: [1.1, 0, 2.0], note: 'prodejna' }],
  walkableRoof: false,
  rays: [thru(-0.75, 1.5, false, 'výlohou projde střela'), thru(-0.75, 0.3, true, 'sokl výlohy kryje vleže'), thru(1.1, 1.5, false, 'dveře volné')],
  notes: ['Výloha bez skla (otevřený otvor, průstřel), sokl 0,5 m.', 'Pás cedule 2,6–3,0 m je prázdný (vlastní nápis přes rekvizitu cedule).'],
});

regB(34, 'facade4Blank', 'Slepá fasáda 4 m', {
  describe: (p) => `4 × 0,3 × ${n(p, 'h').toFixed(1)} m, plná, sokl a římsa`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    return facade(4, n(p, 'h'), [], mat, { plinth: 0.45 });
  },
}, {
  target: [4, 0.3, 3.2],
  route: [{ p: [-1.8, 0, -1.0] }, { p: [1.8, 0, -1.0], note: 'podél fasády' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, true, 'plná stěna kryje'), thru(1.9, 2.8, true, 'kryje až k okraji')],
  notes: ['Levné doplnění delších stěn – bez dekorace kromě soklu a římsy.'],
});

regB(35, 'facade8Windows', 'Fasáda 8 m s okny', {
  describe: (p) => `8 × 0,3 × ${n(p, 'h').toFixed(1)} m, 3 okna 1,4 × 1,3 m, pilíře 1,2 m`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    return facade(8, n(p, 'h'), [winOp(-2.6), winOp(0), winOp(2.6)], mat, { plinth: 0.35, surrounds: true });
  },
}, {
  target: [8, 0.3, 3.2],
  route: [{ p: [-3.8, 0, -1.2] }, { p: [3.8, 0, -1.2], note: 'podél fasády' }],
  walkableRoof: false,
  rays: [thru(-2.6, 1.6, false, 'okno 1'), thru(0, 1.6, false, 'okno 2'), thru(2.6, 1.6, false, 'okno 3'), thru(-1.3, 1.6, true, 'pilíř 1,2 m kryje'), thru(1.3, 1.6, true, 'pilíř 1,2 m kryje')],
  notes: ['Mezi okny pilíře 1,2 m (kryt pro stojícího hráče), na krajích 0,7 m.'],
});

regB(36, 'facade8Door', 'Fasáda 8 m s dveřmi', {
  describe: (p) => `8 × 0,3 × ${n(p, 'h').toFixed(1)} m, dveře 1,2 × 2,3 m + 2 okna, asymetricky`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const d = doorOp(-2.2);
    const parts = facade(8, n(p, 'h'), [d, winOp(0.6), winOp(2.8)], mat, { plinth: 0.35 });
    parts.push(...surround(d, FACE, TRIM, 0.2, 0.08));
    parts.push(...surround(winOp(0.6), FACE, TRIM), ...surround(winOp(2.8), FACE, TRIM));
    return parts;
  },
}, {
  target: [8, 0.3, 3.2],
  route: [{ p: [-2.2, 0, -2.0], note: 'ulice' }, { p: [-2.2, 0, 0], note: 'dveřní otvor' }, { p: [-2.2, 0, 2.0], note: 'za fasádou' }],
  walkableRoof: false,
  rays: [thru(-2.2, 1.5, false, 'dveře volné'), thru(0.6, 1.6, false, 'okno'), thru(-0.9, 1.6, true, 'pilíř mezi dveřmi a oknem')],
  notes: ['Konce zdí plné (0,5 m od otvorů) – napojení rohů a dalších fasád.'],
});

regB(37, 'facade8Shops', 'Fasáda 8 m s výlohami', {
  describe: (p) => `8 × 0,3 × ${n(p, 'h').toFixed(1)} m, 2 výlohy 2,4 m, vstup 1,2 m mezi nimi, krajní pilíře 0,6 m`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const h = n(p, 'h');
    const shops: Op[] = [{ c: -2.2, w: 2.4, b: 0.45, t: 2.5, kind: 'window' }, { c: 2.2, w: 2.4, b: 0.45, t: 2.5, kind: 'window' }];
    const d = doorOp(0, 1.2, 2.5);
    const parts = facade(8, h, [...shops, d], mat, { plinth: 0.45 });
    // Robustní krajní pilíře (vystupují o 0,1 m), průběžný překlad a lišta pro markýzu.
    for (const s of [-1, 1]) parts.push(bx(s < 0 ? -4 : 3.4, s < 0 ? -3.4 : 4, 0, h - 0.2, FACE - 0.1, FACE, 'concreteLight', true));
    parts.push(bx(-3.4, 3.4, 2.5, 2.8, FACE - 0.08, FACE, 'concreteLight', false));
    parts.push(bx(-3.3, 3.3, 2.82, 2.9, FACE - 0.14, FACE, 'paintedMetal', false));
    for (const s of shops) for (const x of [s.c - s.w / 2 + 0.03, s.c + s.w / 2 - 0.03]) parts.push(bx(x - 0.03, x + 0.03, s.b, s.t, -0.05, 0.05, 'paintedMetal', false));
    return parts;
  },
}, {
  target: [8, 0.3, 3.2],
  route: [{ p: [0, 0, -2.0], note: 'ulice' }, { p: [0, 0, 0], note: 'vstup mezi výlohami' }, { p: [0, 0, 2.0], note: 'obchod' }],
  walkableRoof: false,
  rays: [thru(-2.2, 1.5, false, 'výloha'), thru(2.2, 1.5, false, 'výloha'), thru(-3.7, 1.5, true, 'krajní pilíř kryje'), thru(-2.2, 0.25, true, 'sokl kryje vleže')],
  notes: ['Lišta 2,82–2,9 m slouží k přilepení markýzy (rekvizita).', 'Výlohy bez skla (průstřel).'],
});

regB(38, 'facade8Blank', 'Slepá fasáda 8 m', {
  describe: (p) => `8 × 0,3 × ${n(p, 'h').toFixed(1)} m, plná, mělký pilíř 0,6 × 0,12 m`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const h = n(p, 'h');
    const parts = facade(8, h, [], mat, { plinth: 0.4 });
    parts.push(bx(0.6, 1.2, 0, h - 0.2, FACE - 0.12, FACE, mat, true));
    return parts;
  },
}, {
  target: [8, 0.3, 3.2],
  route: [{ p: [-3.8, 0, -1.0] }, { p: [3.8, 0, -1.0], note: 'podél fasády kolem pilíře' }],
  walkableRoof: false,
  rays: [thru(-2, 1.5, true, 'plná stěna'), thru(0.9, 1.5, true, 'pilíř')],
  notes: ['Pilíř je mimo střed (x 0,6–1,2 m), aby se opakující moduly nečetly jako zrcadlo.'],
});

// ---------------------------------------------------------------------------
// B39–B42 Fasády s výklenkem
// ---------------------------------------------------------------------------
interface RecessSpec {
  W: number; // šířka modulu
  rw: number; // světlá šířka výklenku
  rd: number; // hloubka od předního líce k líci dveřní stěny
  h: number;
  lintel: number; // spodní líc nadpraží výklenku (světlá výška)
  ft?: number; // tloušťka přední zdi
  door: { w: number; h: number; off: number };
  cornice?: boolean;
  plinth?: number;
}

/** Fasáda s pravoúhlým výklenkem; pivot ve středu půdorysu (přední líc z = −D/2). */
function recessModule(s: RecessSpec, mat: string, damaged = false, seed = 1): Part[] {
  const ft = s.ft ?? t;
  const D = s.rd + t; // přední líc → zadní líc dveřní stěny
  const zf = -D / 2, zb = zf + s.rd; // líc dveřní stěny
  const sx = s.rw / 2 + t / 2; // osy bočních stěn
  const parts: Part[] = [];
  const fzc = zf + ft / 2;
  if (!damaged) {
    parts.push(...wall([-s.W / 2, fzc], [s.W / 2, fzc], 0, s.h, ft, [{ c: s.W / 2, w: s.rw, b: 0, t: s.lintel, kind: 'pass', bare: true }], mat, { out: [0, -1], trim: TRIM }));
  } else {
    // Poškozený: levý pilíř celý, pravému chybí vnější horní roh, nadpraží zůstává.
    const px0 = -s.W / 2, px1 = -s.rw / 2;
    parts.push(bx(px0, px1, 0, s.h, zf, zf + ft, mat));
    const qx0 = s.rw / 2, qx1 = s.W / 2;
    parts.push(bx(qx0, qx1, 0, 2.1, zf, zf + ft, mat));
    parts.push(bx(qx0, qx1 - 0.55, 2.1, 2.75, zf, zf + ft, mat));
    parts.push(bx(qx0, qx1 - 0.95, 2.75, s.h, zf, zf + ft, mat));
    parts.push(bx(-s.rw / 2, s.rw / 2, s.lintel, s.h, zf, zf + ft, mat));
    // Lomové plochy (tmavší beton) a armatura na zlomu.
    parts.push({ shape: 'box', pos: [qx1 - 0.3, 2.15, zf + ft / 2], rot: [0, 0, 0.35], size: [0.62, 0.12, ft + 0.02], material: 'concreteDark' });
    parts.push({ shape: 'box', pos: [qx1 - 0.78, 2.8, zf + ft / 2], rot: [0, 0, -0.4], size: [0.45, 0.12, ft + 0.02], material: 'concreteDark' });
    for (let i = 0; i < 3; i++) parts.push({ shape: 'cylinder', pos: [qx1 - 0.5 - i * 0.18, 2.45 + i * 0.12, zf + 0.12 + i * 0.05], rot: [0, 0, 0.6 + i * 0.3], size: [0.025, 0.55, 0.025], material: 'metalSheetRust' });
  }
  // Boční krycí stěny výklenku a dveřní stěna (vnitřní líc výklenku je „venku“).
  for (const sg of [-1, 1]) parts.push(...wall([sg * sx, zf + ft], [sg * sx, zb], 0, s.h, t, [], mat, { plain: true }));
  parts.push(...wall([-(sx + t / 2), zb + t / 2], [sx + t / 2, zb + t / 2], 0, s.h, t, [{ c: sx + t / 2 + s.door.off, w: s.door.w, b: 0, t: s.door.h, kind: 'door' }], mat, { out: [0, -1], trim: TRIM }));
  // Strop výklenku, dlažba (nízká, s kolizí) a světlo nade dveřmi.
  parts.push(bx(-s.rw / 2, s.rw / 2, s.h - 0.2, s.h, zf + ft, zb, 'concreteLight'));
  parts.push(bx(-s.rw / 2 - 0.02, s.rw / 2 + 0.02, 0, 0.06, zf - 0.1, zb, 'paving'));
  parts.push(bx(s.door.off - 0.12, s.door.off + 0.12, s.door.h + 0.25, s.door.h + 0.4, zb - 0.1, zb, 'lamp', false));
  if (s.plinth) {
    parts.push(...faceStrip(-s.W / 2, -s.rw / 2, 0, s.plinth, zf, 0.04, 'concreteDark'));
    parts.push(...faceStrip(s.rw / 2, damaged ? s.W / 2 - 0.4 : s.W / 2, 0, s.plinth, zf, 0.04, 'concreteDark'));
  }
  if (s.cornice) {
    // Římsa; u poškozené varianty jen nad levou polovinou.
    const cx1 = damaged ? 0.3 : s.W / 2;
    parts.push(bx(-s.W / 2 - 0.04, cx1, s.h - 0.22, s.h - 0.04, zf - 0.12, zf, TRIM, false));
  }
  if (damaged) {
    // Nízká suť jen u paty pilířů, osa vstupu volná (bez kolize, max ~0,3 m).
    parts.push(...rubble(s.W / 2 - 0.45, zf - 0.55, 7, [0.8, 0.7], seed, 0.5));
    parts.push(...rubble(-s.rw / 2 - 0.35, zf - 0.35, 3, [0.4, 0.4], seed + 3, 0.3));
  }
  return parts;
}

const recessRoute = (s: RecessSpec): SetMeta['route'] => {
  const D = s.rd + t, zf = -D / 2, zb = zf + s.rd;
  return [
    { p: [0, 0, zf - 2.0], note: 'ulice' },
    { p: [s.door.off, 0.06, zf + 0.6], note: 'výklenek' },
    { p: [s.door.off, 0.06, zb - 0.4], note: 'u dveří' },
    { p: [s.door.off, 0, zb + t + 1.2], note: 'za dveřmi' },
  ];
};

const recessRays = (s: RecessSpec) => {
  const D = s.rd + t, zf = -D / 2, zb = zf + s.rd;
  return [
    // Hráč ve výklenku je z boku krytý: paprsek z ulice šikmo na místo vedle dveří narazí do boční stěny.
    { from: [s.W / 2 + 2, 1.4, zf - 1.5] as [number, number, number], to: [-s.rw / 2 + 0.3, 1.4, zb - 0.3] as [number, number, number], hit: true, note: 'boční stěna výklenku kryje' },
    { from: [s.door.off, 1.4, zf - 3] as [number, number, number], to: [s.door.off, 1.4, zb + 2] as [number, number, number], hit: false, note: 'osa výklenku a dveří volná' },
  ];
};

const PILOT_A: RecessSpec = { W: 4.0, rw: 2.0, rd: 1.5, h: 3.5, lintel: 2.7, door: { w: 1.2, h: 2.4, off: 0 } };
const PILOT_B: RecessSpec = { W: 5.0, rw: 2.0, rd: 2.0, h: 3.5, lintel: 2.7, door: { w: 1.2, h: 2.4, off: 0 } };
const recessParams = (s: RecessSpec) => [heightParam(s.h)];
const withH = (s: RecessSpec, p: Params): RecessSpec => ({ ...s, h: n(p, 'h'), lintel: Math.min(s.lintel, n(p, 'h') - 0.5) });

regB(39, 'facadeRecessA', 'Fasáda s výklenkem A (pilot)', {
  describe: (p) => `4,0 × 1,8 × ${n(p, 'h').toFixed(1)} m, výklenek 2,0 × 1,5 m, světlá výška 2,7 m, dveře 1,2 × 2,4 m`,
  params: recessParams(PILOT_A),
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    return recessModule({ ...withH(PILOT_A, p), plinth: 0.35 }, mat);
  },
}, {
  target: [4.3, 1.975, 3.58],
  route: recessRoute(PILOT_A),
  walkableRoof: false,
  rays: recessRays(PILOT_A),
  notes: [
    'Podle pilotu mod_facade_recess_a: výklenek 2,0 × 1,5 m, boční krycí stěny 0,3 m, nadpraží 2,7 m, dveře 1,2 × 2,4 m, výška 3,5 m.',
    'Úprava: šířka 4,0 m místo 4,2 m (pilíře 1,0 m), aby modul seděl do rastru 4 m s rovnými fasádami B31–B34.',
    'Napojení: přední líc je v z = −0,90 (pivot = střed půdorysu); rovná fasáda má líc v −0,15 → posun 0,75 m.',
    'Výška stěny je parametr (výchozí 3,5 m podle pilotu, pro řadu s B31–B38 nastavit 3,2 m).',
  ],
});

regB(40, 'facadeRecessB', 'Fasáda s výklenkem B (pilot)', {
  describe: (p) => `5,0 × 2,3 × ${n(p, 'h').toFixed(1)} m, výklenek 2,0 × 2,0 m, pilíře 1,5 m`,
  params: recessParams(PILOT_B),
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    return recessModule({ ...withH(PILOT_B, p), plinth: 0.35, cornice: true }, mat);
  },
}, {
  target: [5.1, 2.475, 3.58],
  route: recessRoute(PILOT_B),
  walkableRoof: false,
  rays: recessRays(PILOT_B),
  notes: [
    'Podle pilotu mod_facade_recess_b: výklenek 2,0 × 2,0 m (o 0,5 m hlubší než A), pilíře 1,5 m, šířka 5,0 m.',
    'Rozdíl proti A je prostorový: hlubší výklenek a širší pilíře (víc krytu po stranách), navíc římsa.',
    'Napojení: přední líc v z = −1,15.',
  ],
});

const WIDE: RecessSpec = { W: 5.0, rw: 2.2, rd: 1.6, h: 3.2, lintel: 2.65, ft: 0.45, door: { w: 1.2, h: 2.3, off: 0.35 }, cornice: true, plinth: 0.4 };
regB(41, 'facadeRecessWide', 'Výklenek se širokým ostěním', {
  describe: (p) => `5 × 1,9 × ${n(p, 'h').toFixed(1)} m, výklenek 2,2 × 1,6 m, zesílené pilíře 0,45 m, římsa`,
  params: recessParams(WIDE),
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const s = withH(WIDE, p);
    const parts = recessModule(s, mat);
    // Široké ostění: šambrána kolem vstupu do výklenku.
    const zf = -(s.rd + t) / 2;
    parts.push(bx(-s.rw / 2 - 0.3, -s.rw / 2, 0, s.lintel + 0.3, zf - 0.06, zf, TRIM, false));
    parts.push(bx(s.rw / 2, s.rw / 2 + 0.3, 0, s.lintel + 0.3, zf - 0.06, zf, TRIM, false));
    parts.push(bx(-s.rw / 2 - 0.3, s.rw / 2 + 0.3, s.lintel, s.lintel + 0.3, zf - 0.06, zf, TRIM, false));
    return parts;
  },
}, {
  target: [5, 1.9, 3.2],
  route: recessRoute(WIDE),
  walkableRoof: false,
  rays: recessRays(WIDE),
  notes: ['Přední zeď 0,45 m (zesílené pilíře), dveře posunuté o 0,35 m – vedle nich plná zeď jako kryt.', 'Napojení: přední líc v z = −0,95.'],
});

regB(42, 'facadeRecessDamaged', 'Poškozený fasádní výklenek', {
  describe: (p) => `5 × 1,9 × ${n(p, 'h').toFixed(1)} m, ulomený vnější roh a římsa, boční stěny celé`,
  params: recessParams(WIDE),
  sizeParams: { y: 'h' },
  generate(p, seed, mat) {
    return recessModule(withH(WIDE, p), mat, true, seed);
  },
}, {
  target: [5, 1.9, 3.2],
  route: recessRoute(WIDE),
  walkableRoof: false,
  rays: recessRays(WIDE),
  notes: ['Chybí horní vnější roh pravého pilíře a pravá polovina římsy; obě boční krycí stěny výklenku zůstávají celé.', 'Suť jen u paty pilířů, bez kolize – osa vstupu volná.'],
});

// ---------------------------------------------------------------------------
// B43–B46 Rohy
// ---------------------------------------------------------------------------
function plinthRun(a: [number, number], b: [number, number], face: 'x' | 'z', at: number, h: number): Part {
  // Sokl na vnějším líci (x = at nebo z = at), délka a→b.
  return face === 'z' ? bx(a[0], b[0], 0, h, at - 0.04, at, 'concreteDark', false) : bx(at - 0.04, at, 0, h, a[1], b[1], 'concreteDark', false);
}

regB(43, 'cornerOuter', 'Vnější roh', {
  describe: (p) => `ramena 2 × 2 m, tloušťka 0,3 m, výška ${n(p, 'h').toFixed(1)} m, vnější líce −X a −Z`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const h = n(p, 'h');
    return [
      bx(-1, 1, 0, h, -1, -1 + t, mat),
      bx(-1, -1 + t, 0, h, -1 + t, 1, mat),
      plinthRun([-1.04, 0], [1, 0], 'z', -1, 0.35),
      plinthRun([0, -1], [0, 1], 'x', -1, 0.35),
      bx(-1.08, 1, h - 0.2, h - 0.06, -1.08, -1, TRIM, false),
      bx(-1.08, -1, h - 0.2, h - 0.06, -1, 1, TRIM, false),
    ];
  },
}, {
  target: [2, 2, 3.2],
  route: [{ p: [1.5, 0, -1.8], note: 'podél ramene X' }, { p: [-1.8, 0, -1.8], note: 'kolem nároží' }, { p: [-1.8, 0, 1.6], note: 'podél ramene Z' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, true, 'rameno X kryje'), { from: [-3, 1.5, 0], to: [3, 1.5, 0], hit: true, note: 'rameno Z kryje' }],
  notes: ['Připojovací hrany: konec ramene X v x = +1 (z −1…−0,7), ramene Z v z = +1 (x −1…−0,7) – přesně 0,3 m jako fasády.'],
});

regB(44, 'cornerOuterPier', 'Vnější roh se zesíleným nárožím', {
  describe: (p) => `ramena 2 m, betonový nárožní pilíř 0,6 × 0,6 m (vystupuje 0,15 m), římsa kolem, výška ${n(p, 'h').toFixed(1)} m`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const h = n(p, 'h');
    return [
      bx(-1, 1, 0, h, -1, -1 + t, mat),
      bx(-1, -1 + t, 0, h, -1 + t, 1, mat),
      bx(-1.15, -0.55, 0, h + 0.1, -1.15, -0.55, 'concreteLight'),
      bx(-1.17, -0.53, h + 0.1, h + 0.18, -1.17, -0.53, 'concreteDark', false),
      plinthRun([-0.55, 0], [1, 0], 'z', -1, 0.35),
      plinthRun([0, -0.55], [0, 1], 'x', -1, 0.35),
      // Římsa obíhá obě strany i pilíř.
      bx(-1.23, 1, h - 0.24, h - 0.08, -1.23, -1.15, TRIM, false),
      bx(-0.55, 1, h - 0.24, h - 0.08, -1.15, -1, TRIM, false),
      bx(-1.23, -1.15, h - 0.24, h - 0.08, -1.15, 1, TRIM, false),
      bx(-1.15, -1, h - 0.24, h - 0.08, -0.55, 1, TRIM, false),
    ];
  },
}, {
  target: [2.15, 2.15, 3.3],
  route: [{ p: [1.5, 0, -1.9] }, { p: [-1.9, 0, -1.9], note: 'kolem pilíře' }, { p: [-1.9, 0, 1.6] }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.5, -3], to: [0.5, 1.5, 0.5], hit: true, note: 'nárožní pilíř kryje' }],
  notes: ['Připojovací hrany shodné s B43 (pilíř je navíc, ramena končí v ±1 m).'],
});

regB(45, 'cornerInner', 'Vnitřní roh', {
  describe: (p) => `kout dvora, ramena 2 m, výška ${n(p, 'h').toFixed(1)} m, pochozí strana bez výstupků`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const h = n(p, 'h');
    // Pochozí strana = kout směrem −X/−Z; lišty jen na zadní (vnější) straně.
    return [
      bx(-1, 1, 0, h, 1 - t, 1, mat),
      bx(1 - t, 1, 0, h, -1, 1 - t, mat),
      bx(-1, 1.08, h - 0.2, h - 0.06, 1, 1.08, TRIM, false),
      bx(1, 1.08, h - 0.2, h - 0.06, -1, 1, TRIM, false),
    ];
  },
}, {
  target: [2, 2, 3.2],
  route: [{ p: [-0.8, 0, 0.3], note: 'podél ramene' }, { p: [0.3, 0, 0.3], note: 'až do kouta' }, { p: [0.3, 0, -0.8], note: 'podél druhého ramene' }],
  walkableRoof: false,
  rays: [{ from: [-2, 1.5, -2], to: [2, 1.5, 2], hit: true, note: 'kout kryje proti střelbě z dvora ven' }],
  notes: ['Na pochozí straně (kout) žádné lišty ani sokl – hráč se o nic nezachytí.'],
});

regB(46, 'cornerInnerWindow', 'Vnitřní roh s oknem', {
  describe: (p) => `kout, rameno 3 m s oknem 1,2 × 1,2 m (0,9 m od spoje), rameno 2 m plné, výška ${n(p, 'h').toFixed(1)} m`,
  params: [heightParam(3.2)],
  sizeParams: { y: 'h' },
  generate(p, _s, mat) {
    const h = n(p, 'h');
    const parts = wallX(-1.5, 1.5, 1 - t / 2, 0, h, [winOp(-0.4, 1.2, 1.0, 2.2)], mat);
    parts.push(bx(1.5 - t, 1.5, 0, h, -1, 1 - t, mat));
    return parts;
  },
}, {
  target: [3, 2, 3.2],
  route: [{ p: [-1.3, 0, 0.2] }, { p: [0.8, 0, 0.3], note: 'kout' }, { p: [0.8, 0, -0.8] }],
  walkableRoof: false,
  rays: [{ from: [-0.4, 1.6, -2], to: [-0.4, 1.6, 3], hit: false, note: 'okno – průstřel' }, { from: [0.8, 1.6, -2], to: [0.8, 1.6, 3], hit: true, note: 'plná část u spoje' }],
  notes: ['Okno končí 0,9 m od líce druhého ramene (není těsně u spoje).'],
});

// ---------------------------------------------------------------------------
// B47–B48 Štít a požární zeď
// ---------------------------------------------------------------------------
regB(47, 'gableWall', 'Štítová stěna', {
  describe: () => '6 × 0,3 m, okap 3,0 m, vrchol 4,5 m (trojúhelníkový štít)',
  generate(_p, _s, mat) {
    const eave = 3.0, peak = 4.5, half = 3, rise = peak - eave;
    const parts: Part[] = [bx(-half, half, 0, eave, -t / 2, t / 2, mat)];
    // Dva klíny (stoupají k vrcholu), kolize = konvexní klín.
    parts.push({ shape: 'wedge', pos: [-half / 2, eave + rise / 2, 0], rot: [0, Math.PI / 2, 0], size: [t, rise, half], material: mat, collide: true });
    parts.push({ shape: 'wedge', pos: [half / 2, eave + rise / 2, 0], rot: [0, -Math.PI / 2, 0], size: [t, rise, half], material: mat, collide: true });
    const a = Math.atan2(rise, half), L = Math.hypot(rise, half);
    for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [(s * half) / 2, eave + rise / 2 + 0.04 / Math.cos(a), 0], rot: [0, 0, -s * a], size: [L + 0.1, 0.08, t + 0.1], material: TRIM });
    // Větrací otvor ve štítu (jen tmavá výplň) a sokl.
    parts.push(bx(-0.25, 0.25, 3.45, 3.8, -t / 2 - 0.02, -t / 2, 'woodDark', false));
    parts.push(...faceStrip(-half, half, 0, 0.35, FACE, 0.04, 'concreteDark'));
    return parts;
  },
}, {
  target: [6, 0.3, 4.5],
  route: [{ p: [-2.8, 0, -1.0] }, { p: [2.8, 0, -1.0], note: 'podél štítu' }],
  walkableRoof: false,
  rays: [thru(0, 4.0, true, 'štít kryje i nad okapem'), thru(-2.8, 3.4, false, 'u kraje nad okapem je štít nízký')],
  notes: ['Pro hospodářské stavby; kolize štítu = dva konvexní klíny (stejný tvar jako vzhled).'],
});

regB(48, 'fireWall', 'Stěna s požární zdí', {
  describe: () => '6 × 0,3 × 4,4 m, slepá, převyšuje sousední střechu (3,4 m) o 1 m',
  generate(_p, _s, mat) {
    const h = 4.4, roof = 3.4;
    const parts: Part[] = [bx(-3, 3, 0, h, -t / 2, t / 2, mat)];
    parts.push(bx(-3.04, 3.04, h, h + 0.08, -t / 2 - 0.05, t / 2 + 0.05, 'concreteDark', false));
    // Oplechování v úrovni sousední střechy (obě strany) – čitelná výška napojení.
    for (const s of [-1, 1]) parts.push(bx(-3, 3, roof - 0.04, roof + 0.12, s < 0 ? -t / 2 - 0.05 : t / 2, s < 0 ? -t / 2 : t / 2 + 0.05, 'metal', false));
    return parts;
  },
}, {
  target: [6, 0.3, 4.4],
  route: [{ p: [-2.8, 0, -1.0] }, { p: [2.8, 0, -1.0] }],
  walkableRoof: false,
  rays: [thru(0, 4.2, true, 'nad sousední střechou (3,4 m) stále kryt 1 m'), thru(2.5, 1.5, true, 'slepá')],
  notes: ['Oplechování v 3,4 m ukazuje výšku sousední střechy; nad ní 1 m krytu pro hráče na střeše.'],
});

// ---------------------------------------------------------------------------
// B49–B51 Střešní moduly (lepí se nahoru: pata = spodní líc desky)
// ---------------------------------------------------------------------------
const ROOF_T = 0.2;
function roofDeck(x0: number, x1: number, z0: number, z1: number): Part[] {
  return [bx(x0, x1, 0, ROOF_T, z0, z1, 'concreteLight'), bx(x0 + 0.1, x1 - 0.1, ROOF_T, ROOF_T + 0.012, z0 + 0.1, z1 - 0.1, 'roof', false)];
}
/** Atika na hraně: strana podle osy, od–do, výška h nad deskou. */
function atika(x0: number, x1: number, z0: number, z1: number, h: number, mat: string): Part[] {
  return [bx(x0, x1, ROOF_T, ROOF_T + h, z0, z1, mat), bx(x0 - 0.02, x1 + 0.02, ROOF_T + h, ROOF_T + h + 0.06, z0 - 0.04, z1 + 0.04, TRIM, false)];
}
const PT = 0.2;

regB(49, 'roof4x4', 'Střecha 4 × 4 m', {
  describe: () => '4 × 4 m, deska 0,2 m, atika 1 m na třech stranách, zadní strana otevřená',
  mount: { kind: 'top' },
  generate(_p, _s, mat) {
    return [
      ...roofDeck(-2, 2, -2, 2),
      ...atika(-2, 2, -2, -2 + PT, 1, mat),
      ...atika(-2, -2 + PT, -2 + PT, 2, 1, mat),
      ...atika(2 - PT, 2, -2 + PT, 2, 1, mat),
    ];
  },
}, {
  target: [4, 4, 1.2],
  route: [{ p: [0, 0, 2.6], note: 'u otevřené strany' }, { p: [0, 0.2, 1.2], note: 'na střeše' }, { p: [0, 0.2, -1.4], note: 'u přední atiky' }, { p: [-1.4, 0.2, -1.4] }],
  walkableRoof: true,
  rays: [{ from: [0, 0.9, -4], to: [0, 0.9, 0], hit: true, note: 'atika kryje ležícího/klečícího' }],
  notes: ['Pata = spodní líc desky (mount nahoru); zadní strana bez atiky pro napojení dalšího střešního modulu.'],
});

regB(50, 'roof4x8', 'Střecha 4 × 8 m', {
  describe: () => '4 × 8 m, atika 1 m na dvou sousedních stranách (přední, levá), okapový chrlič na viditelné hraně',
  mount: { kind: 'top' },
  generate(_p, _s, mat) {
    const parts = [...roofDeck(-2, 2, -4, 4), ...atika(-2, 2, -4, -4 + PT, 1, mat), ...atika(2 - PT, 2, -4 + PT, 4, 1, mat)];
    // Drenáž: chrlič skrz přední atiku + stékající tmavá stopa (jen vzhled).
    parts.push(bx(-1.2, -1.0, ROOF_T + 0.02, ROOF_T + 0.12, -4.45, -4 + PT, 'metal', false));
    parts.push(bx(-1.18, -1.02, -0.5, ROOF_T, -4.012, -4.002, 'concreteDark', false));
    return parts;
  },
}, {
  target: [4, 8, 1.2],
  route: [{ p: [-2.6, 0, 3.0], note: 'u otevřené strany' }, { p: [-1.2, 0.2, 3.0], note: 'na střeše' }, { p: [0.8, 0.2, -3.2], note: 'roh s atikou' }],
  walkableRoof: true,
  rays: [{ from: [0, 0.9, -6], to: [0, 0.9, 0], hit: true, note: 'přední atika' }, { from: [4, 0.9, 0], to: [0, 0.9, 0], hit: true, note: 'levá atika' }],
  notes: ['Atika jen na přední a levé (+X) straně; pravá a zadní strana navazují na další moduly.'],
});

regB(51, 'roofDamagedParapet', 'Střecha s poškozenou atikou', {
  describe: () => '4 × 4 m, deska celá, atika na 3 stranách s ulomenou částí (nepravidelná silueta)',
  mount: { kind: 'top' },
  generate(_p, seed, mat) {
    const r = rng(seed);
    const parts = [...roofDeck(-2, 2, -2, 2), ...atika(-2, -2 + PT, -2 + PT, 2, 1, mat), ...atika(2 - PT, 2, -2 + PT, 0.2, 1, mat)];
    // Přední atika: zubatý ulomený úsek v polovině (výšky 0,25–0,8 m), zbytek celý.
    parts.push(...atika(-2, -0.6, -2, -2 + PT, 1, mat));
    const steps = [0.8, 0.45, 0.25, 0.35, 0.6];
    steps.forEach((hh, i) => {
      const x0 = -0.6 + i * 0.4, x1 = x0 + 0.4;
      const h = hh + (r() - 0.5) * 0.1;
      parts.push(bx(x0, x1, ROOF_T, ROOF_T + h, -2, -2 + PT, mat));
      parts.push({ shape: 'box', pos: [(x0 + x1) / 2, ROOF_T + h, -2 + PT / 2], rot: [0, 0, (r() - 0.5) * 0.8], size: [0.42, 0.08, PT + 0.01], material: 'concreteDark' });
    });
    parts.push(...atika(1.4, 2, -2, -2 + PT, 1, mat));
    // Levá atika končí ulomená v z = 0,2 (pahýl), kusy na střeše jsou nízké a bez kolize.
    parts.push({ shape: 'box', pos: [2 - PT / 2, ROOF_T + 0.4, 0.45], rot: [0.5, 0, 0], size: [PT, 0.8, 0.4], material: mat });
    for (let i = 0; i < 4; i++) parts.push({ shape: 'box', pos: [0.4 + r() * 0.8, ROOF_T + 0.06, -1.5 + r() * 0.3], rot: [0, r() * 3, 0], size: [0.25 + r() * 0.2, 0.12, 0.18], material: 'concreteLight' });
    return parts;
  },
}, {
  target: [4, 4, 1.2],
  route: [{ p: [0, 0, 2.6] }, { p: [0, 0.2, 1.2], note: 'na střeše' }, { p: [-1.4, 0.2, -1.4] }, { p: [1.4, 0.2, -1.4], note: 'za ulomenou atikou' }],
  walkableRoof: true,
  rays: [{ from: [-1.3, 0.9, -4], to: [-1.3, 0.9, 0], hit: true, note: 'celá část atiky kryje' }, { from: [0.4, 1.0, -4], to: [0.4, 1.0, 0], hit: false, note: 'ulomené místo – průstřel nad 0,6 m' }],
  notes: ['Pochozí plocha desky zůstává celistvá; kusy atiky na střeše bez kolize (nepřekáží).'],
});

// ---------------------------------------------------------------------------
// B52–B53 Střešní nástavby (otevřené dole – napojení schodiště)
// ---------------------------------------------------------------------------
function roofHouse(W: number, D: number, H: number, mat: string, doorX: number, sideWin: boolean): Part[] {
  const wt = 0.25, x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const parts: Part[] = [];
  parts.push(...wall([x0, z0 + wt / 2], [x1, z0 + wt / 2], 0, H, wt, [{ c: doorX - x0, w: 1.1, b: 0, t: 2.2, kind: 'door' }], mat, { out: [0, -1], trim: TRIM }));
  parts.push(bx(x0, x1, 0, H, z1 - wt, z1, mat));
  parts.push(bx(x0, x0 + wt, 0, H, z0 + wt, z1 - wt, mat));
  if (sideWin) parts.push(...wall([x1 - wt / 2, z0 + wt], [x1 - wt / 2, z1 - wt], 0, H, wt, [{ c: (D - 2 * wt) / 2, w: 0.6, b: 1.2, t: 1.8, kind: 'window' }], mat, { out: [1, 0], trim: TRIM }));
  else parts.push(bx(x1 - wt, x1, 0, H, z0 + wt, z1 - wt, mat));
  // Rovná střecha s přesahem a hydroizolací.
  parts.push(bx(x0 - 0.1, x1 + 0.1, H, H + 0.15, z0 - 0.1, z1 + 0.1, 'concreteLight'));
  parts.push(bx(x0, x1, H + 0.15, H + 0.165, z0, z1, 'roof', false));
  return parts;
}

regB(52, 'roofHouseSmall', 'Malá střešní nástavba', {
  describe: () => '2,5 × 3 × 2,7 m, dveře 1,1 × 2,2 m, rovná střecha, bez podlahy (napojení schodiště)',
  mount: { kind: 'top' },
  generate(_p, _s, mat) {
    return roofHouse(2.5, 3, 2.55, mat, 0.25, false);
  },
}, {
  target: [2.5, 3, 2.7],
  route: [{ p: [0.25, 0, -2.6], note: 'střecha před nástavbou' }, { p: [0.25, 0, -1.0], note: 'dveře' }, { p: [0.0, 0, 0.6], note: 'uvnitř (místo pro výstup schodů)' }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.5, 0], to: [3, 1.5, 0], hit: true, note: 'boční stěny kryjí' }],
  notes: ['Spodní část otevřená – pod nástavbu se napojí schodiště (B54–B56 nebo vlastní).'],
});

regB(53, 'roofHouseWide', 'Širší střešní nástavba', {
  describe: () => '4 × 3,5 × 2,8 m, výstupní dveře 1,1 × 2,2 m, boční okno, prostor pro horní podestu',
  mount: { kind: 'top' },
  generate(_p, _s, mat) {
    return roofHouse(4, 3.5, 2.65, mat, -1.0, true);
  },
}, {
  target: [4, 3.5, 2.8],
  route: [{ p: [-1.0, 0, -2.8], note: 'střecha' }, { p: [-1.0, 0, -1.2], note: 'dveře' }, { p: [0.6, 0, 0.5], note: 'horní podesta' }],
  walkableRoof: false,
  rays: [{ from: [3, 1.5, 0], to: [0, 1.5, 0], hit: false, note: 'boční okno – průstřel' }, { from: [3, 1.5, 1.2], to: [0, 1.5, 1.2], hit: true, note: 'stěna vedle okna' }],
  notes: ['Uvnitř volná plocha 3,5 × 3 m pro horní podestu a výstup schodiště.'],
});

// ---------------------------------------------------------------------------
// B54–B56 Venkovní schodiště
// ---------------------------------------------------------------------------
const CONC = 'concreteLight';

regB(54, 'stairStraight', 'Přímé venkovní schodiště', {
  describe: () => 'převýšení 3,2 m, šířka 1,2 m, 18 stupňů 17,8 × 30 cm, plné zábradlí, horní podesta 1,2 × 1,2 m',
  generate() {
    // Výstup ve směru +Z podél zdi domu na straně +X; volná strana −X má plné zábradlí.
    const w = 1.2, H = 3.2;
    const st = stairs(0, 0, 'z+', w, 0, H, CONC, { solid: true, wallSide: ['right'] });
    const L = st.run + 1.2, z0 = -L / 2;
    const parts = stairs(0, z0, 'z+', w, 0, H, CONC, { solid: true, wallSide: ['right'] }).parts;
    parts.push(...landing([-w / 2, z0 + st.run, w / 2, z0 + L], H, CONC));
    // Zábradlí podesty (plné) na volné straně a vpředu nechává průchod ke dveřím na +Z / +X.
    parts.push(bx(-w / 2 - 0.18, -w / 2, H, H + 1.0, z0 + st.run - 0.05, z0 + L, CONC));
    parts.push(bx(-w / 2 - 0.2, -w / 2 + 0.02, H + 1.0, H + 1.05, z0 + st.run - 0.05, z0 + L, TRIM, false));
    return parts;
  },
}, {
  target: [1.4, 6.6, 4.2],
  route: [{ p: [0, 0, -4.2], note: 'pata schodů' }, { p: [0, 3.2, 2.7], note: 'horní podesta' }],
  walkableRoof: false,
  rays: [{ from: [-3, 3.7, 2.7], to: [0, 3.7, 2.7], hit: true, note: 'plné zábradlí podesty kryje' }],
  notes: ['Stupně 0,178 / 0,30 m. Strana +X je pro zeď domu (bez zábradlí), výstup z podesty na +Z nebo +X.'],
});

regB(55, 'stairDogleg', 'Zalomené venkovní schodiště', {
  describe: () => 'dvě ramena po 1,6 m s mezipodestou, převýšení 3,2 m, půdorys 2,7 × 4,9 m, zábradlí na volných stranách',
  generate() {
    const w = 1.2, gap = 0.3, H = 3.2, mid = 1.6;
    const xa = -(w + gap) / 2, xb = (w + gap) / 2; // osy ramen (A nahoru k +Z, B zpět k −Z)
    const run = stairs(0, 0, 'z+', w, 0, mid, CONC).run;
    const top = 1.0, ml = 1.2;
    const L = top + run + ml, z0 = -L / 2 + top; // pata ramene A
    const zm = z0 + run; // začátek mezipodesty
    const parts: Part[] = [];
    parts.push(...stairs(xa, z0, 'z+', w, 0, mid, CONC, { solid: true, railSide: ['right'] }).parts);
    parts.push(...landing([xa - w / 2, zm, xb + w / 2, zm + ml], mid, CONC));
    parts.push(...stairs(xb, zm, 'z-', w, mid, H, CONC, { solid: true, railSide: ['left', 'right'] }).parts);
    // Pod ramenem B plná betonová stěna (nelze podlézt), mezi rameny dělicí zídka.
    parts.push(bx(xb - w / 2, xb + w / 2, 0, mid, z0, zm, CONC));
    parts.push(bx(-gap / 2, gap / 2, 0, mid + 1.0, z0, zm + 0.0, CONC));
    // Horní podesta (před ramenem B) – výstup ke dveřím na −Z.
    parts.push(...landing([xb - w / 2, z0 - top, xb + w / 2, z0], H, CONC));
    parts.push(bx(-gap / 2, gap / 2, 0, H + 1.0, z0 - top, z0, CONC));
    // Zábradlí mezipodesty na volných stranách.
    parts.push(...rail([xa - w / 2 + 0.03, zm + ml - 0.03], [xb + w / 2 - 0.03, zm + ml - 0.03], mid));
    parts.push(...rail([xa - w / 2 + 0.03, zm], [xa - w / 2 + 0.03, zm + ml - 0.03], mid));
    parts.push(...rail([xb + w / 2 - 0.03, zm], [xb + w / 2 - 0.03, zm + ml - 0.03], mid));
    parts.push(...rail([xb + w / 2 - 0.03, z0 - top], [xb + w / 2 - 0.03, z0], H));
    return parts;
  },
}, {
  target: [3, 4.5, 4.2],
  route: [{ p: [-0.75, 0, -2.6], note: 'pata ramene A' }, { p: [-0.75, 1.6, 2.0], note: 'mezipodesta' }, { p: [0.75, 1.6, 2.0] }, { p: [0.75, 3.2, -2.0], note: 'horní podesta' }],
  walkableRoof: false,
  rays: [{ from: [-3, 0.5, 0], to: [0, 0.5, 0], hit: true, note: 'plná podstava ramene A kryje vleže' }],
  notes: ['Půdorys 2,7 × 4,9 m (zadání ~3 × 4,5): horní podesta 1,0 m navíc, aby výstup nebyl rovnou do dveří.', 'Výstup z horní podesty směrem −Z (dveře budovy).'],
});

regB(56, 'stairTwoLevels', 'Schodiště do dvou podlaží', {
  describe: () => 'převýšení 6,4 m, 2 ramena po 3,2 m, podesty v 3,2 m a 6,4 m s výstupy na +X, půdorys 2,5 × 7,8 m',
  generate() {
    const w = 1.2, gap = 0.1, H1 = 3.2, H2 = 6.4, pl = 1.2;
    const xi = (w + gap) / 2, xo = -(w + gap) / 2; // vnitřní pruh (u domu, +X) a vnější
    const run = stairs(0, 0, 'z+', w, 0, H1, CONC).run;
    const L = pl + run + pl, zf = -L / 2 + pl; // pata ramene 1
    const zb = zf + run;
    const parts: Part[] = [];
    // Rameno 1: podél domu nahoru k +Z, plné.
    parts.push(...stairs(xi, zf, 'z+', w, 0, H1, CONC, { solid: true }).parts);
    // Podesta 1 přes oba pruhy (výstup do 1. patra na +X), podepřená plnou stěnou.
    parts.push(...landing([xo - w / 2, zb, xi + w / 2, zb + pl], H1, CONC));
    // Rameno 2: vnější pruh zpět k −Z (tenká šikmá deska), pod ním volný prostor.
    parts.push(...stairs(xo, zb, 'z-', w, H1, H2, CONC, { railSide: ['left', 'right'] }).parts);
    // Podesta 2 vpředu přes oba pruhy ve 6,4 m na dvou sloupech (vstup na rameno 1 pod ní).
    parts.push(bx(xo - w / 2, xi + w / 2, H2 - 0.25, H2, zf - pl, zf, CONC));
    for (const x of [xo - w / 2 + 0.15, xi + w / 2 - 0.15]) parts.push(bx(x - 0.15, x + 0.15, 0, H2 - 0.25, zf - pl, zf - pl + 0.3, CONC));
    // Rameno 2 podepřené u podesty 2 trámem.
    parts.push(bx(xo - w / 2, xo + w / 2, H2 - 0.5, H2 - 0.25, zf - 0.25, zf, CONC));
    // Zábradlí: vnější strany podest, čelo podesty 2, mezi pruhy u ramene 1 (nad ním je rameno 2).
    parts.push(...rail([xo - w / 2 + 0.03, zb], [xo - w / 2 + 0.03, zb + pl - 0.03], H1));
    parts.push(...rail([xo - w / 2 + 0.03, zb + pl - 0.03], [xi + w / 2 - 0.03, zb + pl - 0.03], H1));
    parts.push(...rail([xo - w / 2 + 0.03, zf - pl + 0.03], [xi + w / 2 - 0.03, zf - pl + 0.03], H2));
    parts.push(...rail([xo - w / 2 + 0.03, zf - pl + 0.03], [xo - w / 2 + 0.03, zf], H2));
    return parts;
  },
}, {
  target: [2.5, 7.8, 7.4],
  route: [
    { p: [0.65, 0, -4.4], note: 'pod podestou 2' },
    { p: [0.65, 0, -2.6], note: 'pata ramene 1' },
    { p: [0.65, 3.2, 3.3], note: 'podesta 1 (výstup 1. patro)' },
    { p: [-0.65, 3.2, 3.3] },
    { p: [-0.65, 6.4, -3.3], note: 'podesta 2 (výstup 2. patro)' },
    { p: [0.65, 6.4, -3.3], note: 'výstup na +X' },
  ],
  walkableRoof: false,
  notes: ['Výstupy obou podest jsou na straně +X (zeď domu), ostatní volné strany mají zábradlí.', 'Rameno 2 je tenká deska nad pruhem vedle ramene 1 – pod ním zůstává průchozí výška.'],
});

// ---------------------------------------------------------------------------
// B57–B58 Balkony (lepí se na zeď: zadní hrana z = 0, pata = spodní líc desky)
// ---------------------------------------------------------------------------
regB(57, 'balconyMasonry', 'Balkon se zděným zábradlím', {
  describe: () => 'deska 3 × 1,4 m, plné zábradlí 1 m, zadní hrana bez stěny',
  mount: { kind: 'wall', back: 0 },
  generate(_p, _s, mat) {
    const W = 3, D = 1.4, th = 0.18, pt = 0.15;
    return [
      bx(-W / 2, W / 2, 0, th, -D, 0, 'concreteLight'),
      bx(-W / 2, W / 2, th, th + 1.0, -D, -D + pt, mat),
      bx(-W / 2, -W / 2 + pt, th, th + 1.0, -D + pt, 0, mat),
      bx(W / 2 - pt, W / 2, th, th + 1.0, -D + pt, 0, mat),
      bx(-W / 2 - 0.02, W / 2 + 0.02, th + 1.0, th + 1.06, -D - 0.03, -D + pt + 0.03, TRIM, false),
      bx(-W / 2 - 0.03, -W / 2 + pt + 0.03, th + 1.0, th + 1.06, -D + pt, 0, TRIM, false),
      bx(W / 2 - pt - 0.03, W / 2 + 0.03, th + 1.0, th + 1.06, -D + pt, 0, TRIM, false),
      // Okapnička pod deskou.
      bx(-W / 2, W / 2, -0.04, 0, -D - 0.02, -D + 0.04, 'concreteDark', false),
    ];
  },
}, {
  target: [3, 1.4, 1.2],
  route: [{ p: [-1.0, 0.18, -0.4], note: 'na balkonu' }, { p: [-1.0, 0.18, -0.5] }, { p: [1.0, 0.18, -0.5], note: 'podél zábradlí' }],
  walkableRoof: true,
  rays: [{ from: [0, 0.8, -3], to: [0, 0.8, -0.2], hit: true, note: 'zděné zábradlí kryje' }],
  notes: ['V editoru se přilepí zadní hranou na fasádu (mount wall, zadní hrana z = 0).'],
});

regB(58, 'balconyMetal', 'Balkon s kovovým zábradlím', {
  describe: () => 'deska 2,5 × 1,3 m, rámové kovové zábradlí 1 m (průstřelné), zjednodušená pohybová kolize',
  mount: { kind: 'wall', back: 0 },
  generate() {
    const W = 2.5, D = 1.3, th = 0.16, y = th;
    const parts: Part[] = [bx(-W / 2, W / 2, 0, th, -D, 0, 'concreteLight')];
    parts.push(...rail([-W / 2 + 0.03, -D + 0.03], [W / 2 - 0.03, -D + 0.03], y));
    parts.push(...rail([-W / 2 + 0.03, -D + 0.03], [-W / 2 + 0.03, -0.05], y));
    parts.push(...rail([W / 2 - 0.03, -D + 0.03], [W / 2 - 0.03, -0.05], y));
    // Konzoly pod deskou.
    for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) parts.push({ shape: 'box', pos: [x, -0.25, -0.35], rot: [0.75, 0, 0], size: [0.06, 0.06, 0.8], material: 'paintedMetal' });
    return parts;
  },
}, {
  target: [2.5, 1.3, 1.2],
  route: [{ p: [-0.8, 0.16, -0.4], note: 'na balkonu' }, { p: [-0.8, 0.16, -0.5] }, { p: [0.8, 0.16, -0.5], note: 'podél zábradlí' }],
  walkableRoof: true,
  rays: [{ from: [0, 0.8, -3], to: [0, 0.8, -0.2], hit: false, note: 'kovové zábradlí střelu propustí' }],
  notes: ['Zábradlí: tenké pruty jen vzhled, kolize jeden kvádr jen pro pohyb (střely projdou).'],
});

// ---------------------------------------------------------------------------
// B59–B60 Podloubí (zadní strana otevřená pro fasádu)
// ---------------------------------------------------------------------------
/**
 * Oblouk z plátků: výplň nad polokruhem šířky w s patkou ve výšce ys až do výšky top.
 * Vzhled = 8 plátků (spodní hrana v nejnižším bodě oblouku), kolize = 3 hrubší plátky
 * s hranou v nejvyšším bodě – kolize tak nikdy nezasahuje pod viditelný oblouk.
 */
function archFill(xc: number, w: number, ys: number, top: number, z0: number, z1: number, mat: string): Part[] {
  const r = w / 2, parts: Part[] = [];
  const slices = (n: number, low: boolean, collide: boolean) => {
    for (let i = 0; i < n; i++) {
      const u0 = -r + (i * w) / n, u1 = u0 + w / n;
      const um = low ? Math.max(Math.abs(u0), Math.abs(u1)) : u0 < 0 && u1 > 0 ? 0 : Math.min(Math.abs(u0), Math.abs(u1));
      const yb = ys + Math.sqrt(Math.max(0, r * r - um * um));
      parts.push({ ...bx(xc + u0, xc + u1, yb, top, z0, z1, mat, collide), render: collide ? false : undefined });
    }
  };
  slices(8, true, false);
  slices(3, false, true);
  return parts;
}

regB(59, 'arcade3', 'Podloubí se třemi oblouky', {
  describe: () => '5 × 2 m, 3 oblouky 1,13 m na pilířích 0,4 × 0,5 m, světlá výška 2,6 m (patka), vrchol 3,15 m',
  generate(_p, _s, mat) {
    const W = 5, D = 2, pw = 0.4, ys = 2.6, top = 3.4, z0 = -D / 2, z1 = z0 + 0.5;
    const aw = (W - 4 * pw) / 3;
    const parts: Part[] = [];
    for (let i = 0; i < 4; i++) {
      const x0 = -W / 2 + i * (pw + aw);
      parts.push(bx(x0, x0 + pw, 0, top, z0, z1, mat));
      parts.push(bx(x0 - 0.04, x0 + pw + 0.04, 0, 0.3, z0 - 0.04, z1 + 0.04, TRIM, false));
      parts.push(bx(x0 - 0.04, x0 + pw + 0.04, ys - 0.12, ys, z0 - 0.04, z1, TRIM, false));
    }
    for (let i = 0; i < 3; i++) parts.push(...archFill(-W / 2 + pw + i * (pw + aw) + aw / 2, aw, ys, top, z0, z1, mat));
    // Strop podloubí a dlažba; zadní strana otevřená.
    parts.push(bx(-W / 2, W / 2, top, top + 0.2, z0, D / 2, 'concreteLight'));
    parts.push(bx(-W / 2, W / 2, top - 0.25, top, z1, D / 2, 'concreteLight', false));
    parts.push(bx(-W / 2, W / 2, 0, 0.04, z1, D / 2, 'plazaTile'));
    parts.push(bx(-W / 2 - 0.03, W / 2 + 0.03, top - 0.05, top + 0.12, z0 - 0.1, z0, TRIM, false));
    return parts;
  },
}, {
  target: [5, 2, 3.6],
  route: [{ p: [0, 0, -2.5], note: 'ulice' }, { p: [0, 0.04, 0.4], note: 'podloubí (prostřední oblouk)' }, { p: [-1.5, 0.04, 0.4] }, { p: [-1.5, 0, -2.5], note: 'ven krajním obloukem' }],
  walkableRoof: false,
  rays: [{ from: [-2.3, 1.5, -3], to: [-2.3, 1.5, 0.5], hit: true, note: 'krajní pilíř kryje' }, { from: [0, 2.0, -3], to: [0, 2.0, 0.5], hit: false, note: 'oblouk otevřený' }],
  notes: ['Oblouky: vzhled z 8 svislých plátků, kolize ze 3 hrubších (nikdy pod viditelným obloukem); patka 2,6 m = minimální světlá výška u pilíře.', 'Zadní strana otevřená – napojí se fasáda (např. B32/B36).'],
});

regB(60, 'porticoBeam', 'Podloubí s rovnými překlady', {
  describe: () => '4 × 2,5 m, dva sloupy 0,45 × 0,45 m, rovný nosník, světlá výška 2,7 m, zadní strana otevřená',
  generate(_p, _s, mat) {
    const W = 4, D = 2.5, c = 0.45, beamB = 2.7, top = 3.2, z0 = -D / 2;
    const parts: Part[] = [];
    for (const x of [-W / 2 + 0.25, W / 2 - 0.25 - c]) {
      parts.push(bx(x, x + c, 0, beamB, z0 + 0.05, z0 + 0.05 + c, 'concreteLight'));
      parts.push(bx(x - 0.05, x + c + 0.05, 0, 0.25, z0, z0 + 0.1 + c, 'concreteDark', false));
    }
    parts.push(bx(-W / 2, W / 2, beamB, top, z0, z0 + 0.55, mat));
    parts.push(bx(-W / 2, W / 2, top, top + 0.2, z0, D / 2, 'concreteLight'));
    parts.push(bx(-W / 2 - 0.04, W / 2 + 0.04, top + 0.05, top + 0.2, z0 - 0.06, z0, TRIM, false));
    parts.push(bx(-W / 2, W / 2, 0, 0.04, z0 + 0.55, D / 2, 'paving'));
    return parts;
  },
}, {
  target: [4, 2.5, 3.4],
  route: [{ p: [0, 0, -2.6], note: 'ulice' }, { p: [0, 0.04, 0.4], note: 'podloubí' }, { p: [-1.6, 0.04, 0.8] }, { p: [-2.8, 0, 0.8], note: 'ven bokem' }, { p: [-2.8, 0, -2.4] }],
  walkableRoof: false,
  rays: [{ from: [-1.5, 1.5, -3], to: [-1.5, 1.5, 0.5], hit: true, note: 'sloup kryje' }, { from: [0, 2.2, -3], to: [0, 2.2, 0.5], hit: false, note: 'mezi sloupy volno' }],
  notes: ['Sloupy 0,45 m posunuté 0,25 m od krajů, aby se dvě podloubí vedle sebe nesrazila sloupy.'],
});
