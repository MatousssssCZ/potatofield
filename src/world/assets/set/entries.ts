import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import type { Params } from '../../registry';
import { M, slab, stairs, wall, type Op, type Rect } from './bk';
import { archFill, bx, faceStrip, n, rubble, thru } from './modules';
import { TRIM, reg, type SetMeta } from './residential';

/**
 * Sada 300 · C Vstupy, výklenky a průchody (položky 61–85): klenuté a pravoúhlé vstupy,
 * brány, průjezdy, rolety s průlezem vleže, sklepní vstupy, verandy a proražené zdi.
 * Konvence jako u B: pivot = střed půdorysu u paty, uliční strana −Z, zdi 0,3 m.
 */
const t = M.wall;
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regC = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, 'C');
const STONE = 'sandstone';
const CONC = 'concreteLight';

/** Posun dílů (vycentrování půdorysu). */
function shift(parts: Part[], dx: number, dz: number): Part[] {
  return parts.map((p) => ({ ...p, pos: [p.pos[0] + dx, p.pos[1], p.pos[2] + dz] as V3, path: p.path?.map((q) => [q[0] + dx, q[1], q[2] + dz] as V3) }));
}

// ---------------------------------------------------------------------------
// C61–C68 Vstupy s výklenkem (klenuté a pravoúhlé)
// ---------------------------------------------------------------------------
interface EntrySpec {
  W: number;
  rw: number;
  rd: number;
  h: number;
  ft?: number;
  /** Oblouk (patka ve výšce `spring`, poloměr rw/2, valená klenba přes celou hloubku) nebo rovné nadpraží. */
  arch?: { spring: number };
  lintel?: number;
  door: { w: number; h: number; off: number };
  step?: number;
  /** Boční stěna vybíhající před fasádu: strana (+1 = +X) a délka. */
  sideExt?: { side: 1 | -1; len: number };
  stone?: boolean;
  damage?: 'arch' | 'rect';
  cornice?: boolean;
  plinth?: number;
}

const entryFrame = (s: EntrySpec) => {
  const ext = s.sideExt?.len ?? 0;
  const D = s.rd + t + ext;
  const zf = -D / 2 + ext; // přední líc fasády
  const zb = zf + s.rd; // líc dveřní stěny
  return { zf, zb, D, ext, ft: s.ft ?? t };
};

/** Kamenné klenáky kolem oblouku na předním líci (vzhled), svorník větší. */
function voussoirs(rw: number, spring: number, zf: number, n = 9, ring = 0.38): Part[] {
  const r = rw / 2, parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (1 - (i + 0.5) / n);
    const key = i === Math.floor(n / 2);
    const rr = r + ring / 2;
    const seg = (Math.PI * (r + ring)) / n - 0.03;
    parts.push({ shape: 'box', pos: [Math.cos(a) * rr, spring + Math.sin(a) * rr + (key ? 0.04 : 0), zf - 0.03], rot: [0, 0, a - Math.PI / 2], size: [seg * (key ? 1.25 : 1), ring + (key ? 0.1 : 0), 0.08], material: STONE });
  }
  return parts;
}

function entryModule(s: EntrySpec, mat: string, seed = 1): Part[] {
  const { zf, zb, ft } = entryFrame(s);
  const parts: Part[] = [];
  const sx = s.rw / 2 + t / 2;
  const top = s.arch ? s.arch.spring : s.lintel!;
  const brokenRight = !!s.damage;
  // Pilíře přední zdi.
  parts.push(bx(-s.W / 2, -s.rw / 2, 0, s.h, zf, zf + ft, mat));
  if (!brokenRight) parts.push(bx(s.rw / 2, s.W / 2, 0, s.h, zf, zf + ft, mat));
  else {
    // Ulomený vnější horní roh pravého pilíře (stupňovitě), u pravoúhlého navíc otlučené ostění.
    const pw = s.W / 2 - s.rw / 2;
    const jamb = s.damage === 'rect' ? 0.12 : 0;
    parts.push(bx(s.rw / 2 + jamb, s.W / 2, 0, top - 0.3, zf, zf + ft, mat));
    if (jamb) parts.push(bx(s.rw / 2, s.rw / 2 + jamb, 0, 1.1, zf, zf + ft, mat), bx(s.rw / 2, s.rw / 2 + jamb, 1.6, top - 0.3, zf, zf + ft, mat));
    parts.push(bx(s.rw / 2 + jamb, s.W / 2 - pw * 0.35, top - 0.3, top + 0.5, zf, zf + ft, mat));
    parts.push(bx(s.rw / 2 + (s.damage === 'rect' ? 0 : 0), s.W / 2 - pw * 0.65, top + 0.5, s.h, zf, zf + ft, mat));
    parts.push({ shape: 'box', pos: [s.W / 2 - pw * 0.3, top - 0.28, zf + ft / 2], rot: [0, 0, 0.4], size: [pw * 0.42, 0.12, ft + 0.02], material: 'concreteDark' });
    parts.push({ shape: 'box', pos: [s.W / 2 - pw * 0.55, top + 0.52, zf + ft / 2], rot: [0, 0, -0.5], size: [pw * 0.3, 0.12, ft + 0.02], material: 'concreteDark' });
    if (jamb) for (const y of [1.1, 1.6]) parts.push({ shape: 'box', pos: [s.rw / 2 + 0.06, y, zf + ft / 2], rot: [0, 0, y > 1.3 ? 0.6 : -0.6], size: [0.16, 0.1, ft + 0.02], material: 'brick' });
  }
  // Nad otvorem: oblouk (plátky) nebo nadpraží.
  if (s.arch) {
    const r = s.rw / 2;
    if (s.damage === 'arch') {
      // Levá polovina čelního oblouku celá, pravá vnější část ulomená (klenba za ní zůstává).
      parts.push(...archFill(0, s.rw, s.arch.spring, s.h, zf, zf + ft, mat).filter((p) => p.pos[0] < r * 0.35));
      parts.push(...archFill(0, s.rw, s.arch.spring, s.arch.spring + r + 0.25, zf, zf + ft, mat).filter((p) => p.pos[0] >= r * 0.35));
    } else parts.push(...archFill(0, s.rw, s.arch.spring, s.h, zf, zf + ft, mat));
    // Valená klenba nad výklenkem (prostorový oblouk).
    parts.push(...archFill(0, s.rw, s.arch.spring, s.h, zf + ft, zb, mat));
    if (s.stone) {
      parts.push(...voussoirs(s.rw, s.arch.spring, zf).filter((p) => s.damage !== 'arch' || p.pos[0] < r * 0.3));
      // Patky a impostní kameny bočních pilířů.
      for (const sg of [-1, 1]) {
        if (s.damage === 'arch' && sg > 0) continue;
        const x0 = sg < 0 ? -r - 0.4 : r, x1 = sg < 0 ? -r : r + 0.4;
        parts.push(bx(x0, x1, 0, 0.35, zf - 0.08, zf, STONE, false));
        parts.push(bx(x0 - 0.04, x1 + 0.04, s.arch.spring - 0.18, s.arch.spring, zf - 0.1, zf, STONE, false));
      }
    }
  } else {
    parts.push(bx(-s.rw / 2, s.rw / 2, s.lintel!, s.h, zf, zf + ft, mat));
    if (s.damage === 'rect') {
      // Prasklý překlad: zalomená silueta (klín vylomený uprostřed) + tmavá spára.
      // Prohnuté poloviny překladu (spodní hrana klesá k trhlině), lícují se zdí.
      parts.push({ shape: 'box', pos: [s.rw * 0.22, s.lintel! - 0.04, zf + ft / 2], rot: [0, 0, 0.12], size: [s.rw * 0.5, 0.14, ft - 0.02], material: mat });
      parts.push({ shape: 'box', pos: [-s.rw * 0.25, s.lintel! - 0.03, zf + ft / 2], rot: [0, 0, -0.08], size: [s.rw * 0.5, 0.12, ft - 0.02], material: mat });
      parts.push({ shape: 'box', pos: [0.02, s.lintel! + 0.18, zf - 0.005], rot: [0, 0, 1.2], size: [0.5, 0.03, 0.02], material: 'concreteDark' });
    } else {
      // Mírně vystupující překlad.
      parts.push(bx(-s.rw / 2 - 0.2, s.rw / 2 + 0.2, s.lintel!, s.lintel! + 0.3, zf - 0.08, zf, CONC, false));
    }
  }
  // Boční krycí stěny výklenku, volitelně jedna vybíhá před fasádu.
  for (const sg of [-1, 1] as const) {
    const z0 = s.sideExt?.side === sg ? zf - s.sideExt.len : zf + ft;
    parts.push(...wall([sg * sx, z0], [sg * sx, zb], 0, s.h, t, [], mat, { plain: true }));
  }
  // Dveřní stěna se skutečným otvorem (bez křídla).
  const bw = s.rw + 2 * t;
  const dop: Op = { c: bw / 2 + s.door.off, w: s.door.w, b: 0, t: s.door.h, kind: 'door' };
  parts.push(...wall([-bw / 2, zb + t / 2], [bw / 2, zb + t / 2], 0, s.h, t, [dop], mat, { out: [0, -1], trim: TRIM }));
  // Strop výklenku (u pravoúhlých), dlažba / schod.
  if (!s.arch) parts.push(bx(-s.rw / 2, s.rw / 2, s.h - 0.2, s.h, zf + ft, zb, CONC));
  const fy = s.step ?? 0.06;
  parts.push(bx(-s.rw / 2 - 0.02, s.rw / 2 + 0.02, 0, fy, zf + (s.step ? 0 : -0.1), zb, s.step ? STONE : 'paving'));
  if (s.step) parts.push(bx(-s.rw / 2, s.rw / 2, fy - 0.02, fy, zf, zf + 0.06, 'concreteDark', false));
  if (s.plinth) {
    parts.push(...faceStrip(-s.W / 2, -s.rw / 2, 0, s.plinth, zf, 0.04, 'concreteDark'));
    parts.push(...faceStrip(s.rw / 2, brokenRight ? s.W / 2 - 0.5 : s.W / 2, 0, s.plinth, zf, 0.04, 'concreteDark'));
  }
  if (s.cornice) parts.push(bx(-s.W / 2 - 0.04, brokenRight ? 0.2 : s.W / 2 + 0.04, s.h - 0.22, s.h - 0.06, zf - 0.12, zf, TRIM, false));
  if (s.damage) {
    // Úlomky jen u kraje (bez kolize, mimo průchozí osu).
    parts.push(...rubble(s.W / 2 - 0.5, zf - 0.6, 6, [0.8, 0.8], seed, 0.5));
    if (s.stone) for (let i = 0; i < 3; i++) parts.push({ shape: 'box', pos: [s.W / 2 + 0.3 - i * 0.35, 0.16, zf - 1.0 - i * 0.25], rot: [0.2 * i, 0.7 * i, 0.3], size: [0.5, 0.3, 0.32], material: STONE });
  }
  return parts;
}

const entryRoute = (s: EntrySpec): SetMeta['route'] => {
  const { zf, zb } = entryFrame(s);
  const fy = s.step ?? 0.06;
  return [
    { p: [0, 0, zf - 2.0], note: 'ulice' },
    { p: [s.door.off * 0.5, fy, zf + 0.5], note: 'výklenek' },
    { p: [s.door.off, fy, zb - 0.4], note: 'u dveří' },
    { p: [s.door.off, 0, zb + t + 1.2], note: 'za dveřmi' },
  ];
};

const entryRays = (s: EntrySpec) => {
  const { zf, zb } = entryFrame(s);
  return [
    { from: [s.W / 2 + 2, 1.4, zf - 1.5] as V3, to: [-s.rw / 2 + 0.3, 1.4, zb - 0.3] as V3, hit: true, note: 'hráč ve výklenku je ze strany krytý' },
    { from: [s.door.off, 1.4, zf - 3] as V3, to: [s.door.off, 1.4, zb + 2] as V3, hit: false, note: 'osa vstupu a dveří volná' },
  ];
};

function regEntry(item: number, id: string, label: string, s: EntrySpec, describe: string, target: [number, number, number], notes: string[], extraRays: SetMeta['rays'] = []) {
  regC(item, id, label, {
    describe: () => describe,
    generate(_p, seed, mat) {
      return entryModule(s, mat, seed);
    },
  }, { target, route: entryRoute(s), walkableRoof: false, rays: [...entryRays(s), ...extraRays], notes });
}

const ARCH_A: EntrySpec = { W: 4.0, rw: 1.6, rd: 1.4, h: 3.5, arch: { spring: 2.2 }, door: { w: 1.2, h: 2.4, off: 0 }, plinth: 0.35 };
const ARCH_B: EntrySpec = { W: 5.0, rw: 1.6, rd: 1.8, h: 3.5, arch: { spring: 2.2 }, door: { w: 1.2, h: 2.4, off: 0 }, plinth: 0.35, cornice: true };
regEntry(61, 'entryArchA', 'Klenutý vstup A (pilot)', ARCH_A, '4,0 × 1,7 × 3,5 m, výklenek 1,6 × 1,4 m, oblouk s patkou 2,2 m (vrchol 3,0 m), valená klenba, dveře 1,2 × 2,4 m', [4.3, 1.83, 3.58], [
  'Podle pilotu entry_recess_arch_a: výklenek 1,6 × 1,4 m, dveře 1,2 × 2,4 m, výška 3,5 m.',
  'Úprava: šířka 4,0 m místo 4,2 m (rastr 4 m jako B39). Oblouk je skutečný: valená klenba přes celou hloubku výklenku (pilot měl rovný strop).',
  'Patka oblouku 2,2 m = nejnižší světlá výška u bočních stěn, ve středu 3,0 m.',
]);
regEntry(62, 'entryArchB', 'Klenutý vstup B (pilot)', ARCH_B, '5,0 × 2,1 × 3,5 m, výklenek 1,6 × 1,8 m, pilíře 1,7 m, oblouk a klenba, římsa', [5.1, 2.23, 3.58], [
  'Podle pilotu entry_recess_arch_b: výklenek 1,6 × 1,8 m (o 0,4 m hlubší než A), pilíře 1,7 m.',
  'Oblouk i boční ostění čitelné: klenba v celé hloubce, sokl a římsa na líci.',
]);
const STONE_E: EntrySpec = { W: 5.0, rw: 2.2, rd: 1.7, h: 4.0, arch: { spring: 2.4 }, door: { w: 1.2, h: 2.4, off: 0 }, stone: true };
regEntry(63, 'entryArchStone', 'Klenutý vstup s kamenným ostěním', STONE_E, '5 × 2,0 × 4,0 m, výklenek 2,2 × 1,7 m, 9 kamenných klenáků se svorníkem, patky a impostní kameny', [5, 2.0, 4.0], [
  'Klenáky jsou vzhled (kolize sleduje oblouk z plátků); patky pilířů 0,35 m nevyčnívají do průchodu.',
]);
regEntry(64, 'entryArchDamaged', 'Poškozený klenutý vstup', { ...STONE_E, damage: 'arch' }, '5 × 2,0 × 4,0 m, odlomený vnější roh oblouku a pilíře, kameny mimo osu', [5, 2.0, 4.0], [
  'Chybí pravá vnější část čelního oblouku a horní roh pilíře; klenba výklenku a obě boční stěny zůstávají.',
  'Spadlé kameny leží vpravo před pilířem, mimo osu vstupu (bez kolize).',
]);
const RECT_STEP: EntrySpec = { W: 4.0, rw: 1.8, rd: 1.5, h: 3.2, lintel: 2.6, door: { w: 1.2, h: 2.3, off: 0 }, step: 0.17, plinth: 0.35 };
regEntry(65, 'entryRectStep', 'Pravoúhlý vstup se schodkem', RECT_STEP, '4 × 1,8 × 3,2 m, výklenek 1,8 × 1,5 m, schod 0,17 m, vystupující překlad, dveře 1,2 × 2,3 m', [4, 1.8, 3.2], ['Celá podlaha výklenku je o 0,17 m výš (jeden schod u líce), za dveřmi zpět na úroveň terénu.']);
const RECT_WIDE: EntrySpec = { W: 5.0, rw: 2.5, rd: 1.8, h: 3.2, lintel: 2.65, door: { w: 1.2, h: 2.3, off: -0.55 }, plinth: 0.35, cornice: true };
regEntry(66, 'entryRectWide', 'Široký pravoúhlý vstup', RECT_WIDE, '5 × 2,1 × 3,2 m, výklenek 2,5 × 1,8 m, dveře posunuté k levé stěně, vedle plná zeď', [5, 2.1, 3.2], ['Vedle dveří zůstává 1,25 m plné zdi – kryt pro hráče ve výklenku.'], [
  { from: [0.9, 1.4, -3.5], to: [0.9, 1.4, 1.8], hit: true, note: 'plná zeď vedle dveří kryje' },
]);
const RECT_ASYM: EntrySpec = { W: 4.0, rw: 2.0, rd: 1.5, h: 3.2, lintel: 2.6, door: { w: 1.2, h: 2.3, off: 0 }, sideExt: { side: 1, len: 0.5 }, plinth: 0.35 };
regEntry(67, 'entryRectAsym', 'Asymetrický pravoúhlý vstup', RECT_ASYM, '4 × 2,3 × 3,2 m, výklenek 2,0 × 1,5 m, levá (+X) boční stěna vybíhá 0,5 m před fasádu', [4, 2.3, 3.2], ['Vybíhající stěna je v líci boční stěny výklenku – šířka 2,0 m se nikde nezužuje.', 'Přední líc fasády je v z = −0,9 (pivot = střed půdorysu včetně výběžku).'], [
  { from: [3, 1.4, -1.0], to: [-0.5, 1.4, -1.0], hit: true, note: 'výběžek kryje z boku podél fasády' },
]);
const RECT_DMG: EntrySpec = { W: 4.0, rw: 2.0, rd: 1.5, h: 3.2, lintel: 2.6, door: { w: 1.2, h: 2.3, off: 0 }, damage: 'rect' };
regEntry(68, 'entryRectDamaged', 'Poškozený pravoúhlý vstup', RECT_DMG, '4 × 1,8 × 3,2 m, otlučené ostění, prasklý překlad, úlomky u kraje', [4, 1.8, 3.2], ['Dveřní otvor 1,2 × 2,3 m beze změny; úlomky vpravo před pilířem bez kolize.']);

// ---------------------------------------------------------------------------
// C69–C72 Brány ve zdi (zeď 0,4 m, dvůr = +Z)
// ---------------------------------------------------------------------------
const GT = 0.4;
/** Zeď podél X s otvorem šířky ow uprostřed (osa z = 0). */
function gateWall(W: number, h: number, ow: number, mat: string): Part[] {
  // Krycí lišta jen nad zdí (nad otvorem nic nevisí).
  return [
    bx(-W / 2, -ow / 2, 0, h, -GT / 2, GT / 2, mat), bx(ow / 2, W / 2, 0, h, -GT / 2, GT / 2, mat),
    bx(-W / 2 - 0.03, -ow / 2, h, h + 0.08, -GT / 2 - 0.04, GT / 2 + 0.04, TRIM, false), bx(ow / 2, W / 2 + 0.03, h, h + 0.08, -GT / 2 - 0.04, GT / 2 + 0.04, TRIM, false),
  ];
}
/** Křídlo vrat: obdélník (šířka podél osy a→b), tloušťka, kovové pásy; kolize = deska. */
function leaf(x0: number, z0: number, x1: number, z1: number, h: number, th: number, mat: string, straps: string, nStraps = 3, rot?: V3): Part[] {
  const alongX = Math.abs(z1 - z0) < 1e-6;
  const L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const parts: Part[] = [{ shape: 'box', pos: [cx, 0.05 + h / 2, cz], size: alongX ? [L, h, th] : [th, h, L], material: mat, collide: true, rot }];
  for (let i = 0; i < nStraps; i++) {
    const y = 0.05 + h * (0.15 + (0.7 * i) / Math.max(1, nStraps - 1));
    parts.push({ shape: 'box', pos: [cx, y, cz], size: alongX ? [L - 0.06, 0.1, th + 0.02] : [th + 0.02, 0.1, L - 0.06], material: straps, rot });
  }
  return parts;
}

regC(69, 'gateWood', 'Brána s dřevěnými vraty', {
  describe: () => 'zeď 7 × 0,4 × 3,4 m, otvor 3 × 2,8 m s trámem, dvě dřevěná křídla otevřená ke stranám (k vnitřnímu líci)',
  generate(_p, _s, mat) {
    const W = 7, h = 3.4, ow = 3, oh = 2.8;
    const parts = gateWall(W, h, ow, mat);
    parts.push(bx(-ow / 2, ow / 2, oh, h, -GT / 2, GT / 2, mat), bx(-ow / 2, ow / 2, h, h + 0.08, -GT / 2 - 0.04, GT / 2 + 0.04, TRIM, false));
    parts.push(bx(-ow / 2 - 0.15, ow / 2 + 0.15, oh, oh + 0.25, -GT / 2 - 0.06, -GT / 2, 'woodDark', false));
    // Křídla přiklopená k vnitřnímu líci zdi vedle otvoru (nezužují průjezd).
    for (const sg of [-1, 1]) parts.push(...leaf(sg * (ow / 2 + 0.05), GT / 2 + 0.07, sg * (ow / 2 + 1.5), GT / 2 + 0.07, oh - 0.1, 0.1, 'woodDark', 'metal'));
    parts.push(bx(-ow / 2, ow / 2, 0, 0.04, -GT / 2, GT / 2, STONE));
    return parts;
  },
}, {
  target: [7, 0.6, 3.4],
  route: [{ p: [0, 0, -2.5], note: 'ulice' }, { p: [1.0, 0.04, 0], note: 'v bráně' }, { p: [0, 0, 2.5], note: 'dvůr' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průjezd volný'), thru(2.5, 1.5, true, 'zeď a otevřené křídlo kryjí')],
  notes: ['Otvor 3,0 × 2,8 m; křídla 1,45 m otevřená o ~180° k vnitřnímu líci, kovové příčné pásy.'],
});

regC(70, 'gateMetal', 'Brána s kovovými vraty', {
  describe: () => 'zeď 8 × 0,4 × 3,0 m, otvor 3,5 × 3,0 m mezi ocelovými sloupky, plechová křídla otevřená o 90°',
  generate(_p, _s, mat) {
    const W = 8, h = 3.0, ow = 3.5;
    const parts = gateWall(W, h, ow + 0.6, mat);
    for (const sg of [-1, 1]) {
      parts.push(bx(sg < 0 ? -ow / 2 - 0.3 : ow / 2, sg < 0 ? -ow / 2 : ow / 2 + 0.3, 0, 3.2, -0.15, 0.15, 'paintedMetal'));
      // Křídlo kolmo do dvora, závěs za hranou otvoru (průjezd se nezužuje).
      const x = sg * (ow / 2 + 0.04);
      parts.push(...leaf(x, 0.2, x, 0.2 + ow / 2, 2.85, 0.05, 'metalSheet', 'paintedMetal', 3));
      parts.push(bx(x - 0.04, x + 0.04, 0.05, 2.95, 0.2, 0.26, 'paintedMetal', false), bx(x - 0.04, x + 0.04, 0.05, 2.95, 0.14 + ow / 2, 0.2 + ow / 2, 'paintedMetal', false));
    }
    return parts;
  },
}, {
  target: [8, 2.2, 3.2],
  route: [{ p: [0, 0, -2.5], note: 'ulice' }, { p: [-1.2, 0, 1.2], note: 'mezi křídly' }, { p: [0, 0, 3.0], note: 'dvůr' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průjezd volný'), { from: [-3, 1.5, 1.0], to: [0, 1.5, 1.0], hit: true, note: 'plechové křídlo kryje z boku' }],
  notes: ['Křídla 1,75 m otevřená o 90° do dvora, závěsy za hranou otvoru → průjezd celých 3,5 m.'],
});

/** Klenutá brána (pilíře + oblouk) – sdílí C71 a poškozená C72. */
function archGate(mat: string, broken: boolean, seed: number): Part[] {
  const W = 8, wallH = 2.6, ow = 3, spring = 2.0, pw = 0.9, pd = 0.7, top = 4.0;
  const parts: Part[] = [];
  parts.push(bx(-W / 2, -ow / 2 - pw, 0, wallH, -GT / 2, GT / 2, mat), bx(ow / 2 + pw, W / 2, 0, wallH, -GT / 2, GT / 2, mat));
  parts.push(bx(-W / 2, -ow / 2 - pw, wallH, wallH + 0.08, -GT / 2 - 0.04, GT / 2 + 0.04, TRIM, false), bx(ow / 2 + pw, W / 2, wallH, wallH + 0.08, -GT / 2 - 0.04, GT / 2 + 0.04, TRIM, false));
  // Pilíře.
  parts.push(bx(-ow / 2 - pw, -ow / 2, 0, top, -pd / 2, pd / 2, mat));
  if (!broken) parts.push(bx(ow / 2, ow / 2 + pw, 0, top, -pd / 2, pd / 2, mat));
  else {
    // Rozbitý pravý pilíř: zůstává spodek a nepravidelný pahýl, oblouk nad ním chybí.
    const r = rng(seed);
    parts.push(bx(ow / 2, ow / 2 + pw, 0, 1.9, -pd / 2, pd / 2, mat));
    parts.push(bx(ow / 2 + 0.25, ow / 2 + pw, 1.9, 2.5, -pd / 2, pd / 2 - 0.15, mat));
    for (let i = 0; i < 3; i++) parts.push({ shape: 'box', pos: [ow / 2 + 0.2 + r() * 0.5, 1.95 + r() * 0.5, (r() - 0.5) * 0.4], rot: [r() - 0.5, r(), r() - 0.5], size: [0.3, 0.18, 0.3], material: 'concreteDark' });
  }
  for (const sg of [-1, 1]) {
    if (broken && sg > 0) continue;
    const x0 = sg < 0 ? -ow / 2 - pw - 0.05 : ow / 2 - 0.05, x1 = x0 + pw + 0.1;
    parts.push(bx(x0, x1, top, top + 0.12, -pd / 2 - 0.05, pd / 2 + 0.05, TRIM, false), bx(x0, x1, 0, 0.3, -pd / 2 - 0.05, pd / 2 + 0.05, STONE, false));
  }
  if (!broken) {
    parts.push(...archFill(0, ow, spring, top, -pd / 2, pd / 2, mat));
    parts.push(...voussoirs(ow, spring, -pd / 2, 11, 0.3));
  } else {
    // Zbytek oblouku od levého pilíře.
    parts.push(...archFill(0, ow, spring, top, -pd / 2, pd / 2, mat).filter((p) => p.pos[0] < -0.4));
  }
  return parts;
}

regC(71, 'gateArch', 'Klenutá dvorní brána', {
  describe: () => 'zeď 8 m × 2,6 m, otvor 3 m, oblouk s patkou 2,0 m a vrcholem 3,5 m, pilíře 0,9 × 0,7 m, vrata otevřená za lícem',
  generate(_p, seed, mat) {
    const parts = archGate(mat, false, seed);
    // Vrata otevřená o 90° do dvora za vnitřním lícem pilířů.
    for (const sg of [-1, 1]) parts.push(...leaf(sg * 1.55, 0.4, sg * 1.55, 1.9, 2.0, 0.08, 'woodDark', 'metal', 2));
    return parts;
  },
}, {
  target: [8, 2.0, 4.0],
  route: [{ p: [0, 0, -2.5], note: 'ulice' }, { p: [0, 0, 0], note: 'pod obloukem' }, { p: [0, 0, 3.0], note: 'dvůr' }],
  walkableRoof: false,
  rays: [thru(0, 2.8, false, 'pod vrcholem oblouku volno'), thru(-1.95, 1.5, true, 'pilíř kryje')],
  notes: ['Světlá výška 2,0 m u pilířů, 3,5 m ve vrcholu; vrata ustoupená za vnitřní líc (nezužují 3 m).'],
});

regC(72, 'gateDamaged', 'Poškozená dvorní brána', {
  describe: () => 'zeď 8 m, otvor 3 m, pravý pilíř rozbitý, jedno křídlo svěšené u zdi mimo průchod, suť u stran',
  generate(_p, seed, mat) {
    const parts = archGate(mat, true, seed);
    // Levé křídlo otevřené o 90°, pravé svěšené a opřené šikmo o vnitřní líc zdi vpravo.
    parts.push(...leaf(-1.55, 0.4, -1.55, 1.9, 2.0, 0.08, 'woodDark', 'metal', 2));
    parts.push({ shape: 'box', pos: [3.0, 0.85, 0.42], rot: [0.12, 0.08, 0.35], size: [1.45, 1.9, 0.08], material: 'woodDark', collide: true });
    parts.push(...rubble(2.6, -0.9, 6, [1.2, 0.8], seed, 0.5), ...rubble(-2.8, -0.8, 3, [0.8, 0.6], seed + 5, 0.35));
    return parts;
  },
}, {
  target: [8, 2.0, 4.0],
  route: [{ p: [0, 0, -2.5], note: 'ulice' }, { p: [0.4, 0, 0], note: 'v bráně' }, { p: [0, 0, 3.0], note: 'dvůr' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průchod volný'), thru(-1.95, 1.5, true, 'celý pilíř kryje')],
  notes: ['Svěšené křídlo leží u zdi vpravo (x ≈ 3 m), mimo 3 m průchod; suť jen u stran bez kolize.'],
});

// ---------------------------------------------------------------------------
// C73–C75 Průjezdy domem (profil 3 × 3 m, délka 6 m)
// ---------------------------------------------------------------------------
const PW = 0.4; // boční zdi průjezdu
function passageShell(mat: string, o: { vault?: boolean; sideOpen?: boolean; ceilingHole?: boolean; seed?: number } = {}): Part[] {
  const L = 6, w = 3, z0 = -L / 2, z1 = L / 2, top = 3.6;
  const wallH = o.vault ? 2.7 : 3.0;
  const parts: Part[] = [];
  // Pravá stěna (−X) se dveřmi do schodiště (zavřené dveře, BF2), levá plná / s průrazem.
  parts.push(...wall([-w / 2 - PW / 2, z0], [-w / 2 - PW / 2, z1], 0, top, PW, [{ c: 4.0, w: 1.1, b: 0, t: 2.2, kind: 'door' }], mat, { plain: true }));
  parts.push(bx(-w / 2 - 0.12, -w / 2 - 0.04, 0.02, 2.18, 4.0 - 3 - 0.53, 4.0 - 3 + 0.53, 'woodDark'));
  parts.push(bx(-w / 2 - 0.02, -w / 2, 0, 2.3, 0.4, 0.47, TRIM, false), bx(-w / 2 - 0.02, -w / 2, 0, 2.3, 1.53, 1.6, TRIM, false), bx(-w / 2 - 0.02, -w / 2, 2.2, 2.3, 0.4, 1.6, TRIM, false));
  if (!o.sideOpen) parts.push(bx(w / 2, w / 2 + PW, 0, top, z0, z1, mat));
  else {
    // Rozšířený otvor 2,4 × 2,6 m do vedlejší místnosti (místnost 3 × 3 m za ním).
    parts.push(...wall([w / 2 + PW / 2, z0], [w / 2 + PW / 2, z1], 0, top, PW, [{ c: 3.2, w: 2.4, b: 0, t: 2.6, kind: 'pass', bare: true }], mat, { plain: true }));
    const rx0 = w / 2 + PW, rx1 = rx0 + 3;
    parts.push(bx(rx1, rx1 + 0.3, 0, 3.0, -1.7, 1.9, mat), bx(rx0, rx1 + 0.3, 0, 3.0, -1.9, -1.6, mat), bx(rx0, rx1 + 0.3, 0, 3.0, 1.6, 1.9, mat));
    parts.push(bx(rx0, rx1 + 0.3, 3.0, 3.25, -1.9, 0.4, CONC));
    parts.push(bx(rx0, rx1, 0, 0.04, -1.6, 1.6, 'concreteDark'));
    // Otlučené hrany průrazu.
    for (const [y, z, rz] of [[2.6, 0.9, 0.3], [1.8, -0.75, -0.6], [0.6, 2.05, 0.5]] as const) parts.push({ shape: 'box', pos: [w / 2 + PW / 2, y, z], rot: [rz, 0, 0], size: [PW + 0.02, 0.18, 0.3], material: 'brick' });
    parts.push(...rubble(rx0 + 1.5, 1.2, 5, [1.6, 0.6], (o.seed ?? 1) + 2, 0.45));
  }
  // Strop / klenba.
  const holes: Rect[] = o.ceilingHole ? [[0.1, -0.2, 1.4, 1.9]] : [];
  if (o.vault) {
    // Segmentová klenba: tětiva 3 m, vzepětí 0,5 m (R = 2,5 m); boční výška 2,7 m.
    const f = 0.5, R = (w * w / 4 + f * f) / (2 * f);
    const yAt = (x: number) => wallH + Math.sqrt(Math.max(0, R * R - x * x)) - (R - f);
    const slices = (k: number, low: boolean, collide: boolean) => {
      for (let i = 0; i < k; i++) {
        const u0 = -w / 2 + (i * w) / k, u1 = u0 + w / k;
        const um = low ? Math.max(Math.abs(u0), Math.abs(u1)) : u0 < 0 && u1 > 0 ? 0 : Math.min(Math.abs(u0), Math.abs(u1));
        parts.push({ ...bx(u0, u1, yAt(um), top, z0, z1, mat, collide), render: collide ? false : undefined });
      }
    };
    slices(10, true, false);
    slices(4, false, true);
  } else parts.push(...slab([-w / 2, z0, w / 2, z1], top, top - wallH, holes, CONC));
  if (o.ceilingHole) {
    // Odkrytý strop: zubaté hrany otvoru, armatura, kusy na zemi u stěny.
    const r = rng(o.seed ?? 3);
    for (let i = 0; i < 5; i++) parts.push({ shape: 'box', pos: [0.1 + r() * 1.3, wallH + 0.05, -0.2 + r() * 2.1], rot: [r() - 0.5, r() * 3, r() - 0.5], size: [0.3, 0.12, 0.25], material: 'concreteDark' });
    for (let i = 0; i < 4; i++) parts.push({ shape: 'cylinder', pos: [0.15 + i * 0.35, wallH + 0.1, -0.2], rot: [0.9, 0, 0], size: [0.025, 0.6, 0.025], material: 'metalSheetRust' });
    parts.push(...rubble(1.1, 0.8, 5, [0.6, 1.6], (o.seed ?? 3) + 7, 0.4));
  }
  // Dlažba, čelní rámy obou vjezdů.
  parts.push(bx(-w / 2, w / 2, 0, 0.04, z0, z1, 'paving'));
  for (const z of [z0, z1]) {
    const zz = z < 0 ? z - 0.08 : z + 0.08;
    parts.push(bx(-w / 2 - PW, -w / 2, 0, top, Math.min(z, zz), Math.max(z, zz), TRIM, false), bx(w / 2, w / 2 + PW, 0, top, Math.min(z, zz), Math.max(z, zz), TRIM, false));
    if (!o.vault) parts.push(bx(-w / 2, w / 2, wallH, wallH + 0.3, Math.min(z, zz), Math.max(z, zz), TRIM, false));
  }
  return parts;
}

const passRoute = (side?: boolean): SetMeta['route'] => [
  { p: [0, 0, -4.5], note: 'ulice' },
  { p: [0, 0.04, -1.0], note: 'průjezd' },
  ...(side ? [{ p: [1.0, 0.04, 0.2] as V3 }, { p: [3.4, 0.04, 0.2] as V3, note: 'průraz do vedlejší místnosti' }, { p: [1.0, 0.04, 0.2] as V3 }] : []),
  { p: [0, 0.04, 2.0] },
  { p: [0, 0, 4.5], note: 'dvůr' },
];

regC(73, 'passageStraight', 'Přímý průjezd domem', {
  describe: () => 'profil 3 × 3 m, délka 6 m, boční zdi 0,4 m, strop, zavřené dveře do schodiště',
  generate(_p, _s, mat) {
    return passageShell(mat);
  },
}, {
  target: [3.8, 6, 3.6],
  route: passRoute(),
  walkableRoof: true,
  rays: [{ from: [-4, 1.5, 0], to: [4, 1.5, 0], hit: true, note: 'boční zdi kryjí' }, { from: [0, 1.5, -5], to: [0, 1.5, 5], hit: false, note: 'průjezd průstřelný podélně' }],
  notes: ['Dveře do schodišťového prostoru jsou zavřené (BF2) – průjezd se vkládá do uzavřené budovy.', 'Střecha (3,6 m) je pochozí deska pro napojení horní hmoty.'],
});

regC(74, 'passageVault', 'Klenutý průjezd', {
  describe: () => 'profil 3 m, boční výška 2,7 m, segmentová klenba se vzepětím 0,5 m (vrchol 3,2 m), délka 6 m',
  generate(_p, _s, mat) {
    return passageShell(mat, { vault: true });
  },
}, {
  target: [3.8, 6, 3.6],
  route: passRoute(),
  walkableRoof: true,
  rays: [{ from: [-1.45, 2.65, -5], to: [-1.45, 2.65, 5], hit: false, note: 'u boční stěny volno do 2,7 m' }],
  notes: ['Klenba začíná ve 2,7 m – boční průchozí výška neklesne pod 2,6 m. Kolize klenby ze 4 hrubších plátků (nikdy pod viditelnou klenbou).'],
});

regC(75, 'passageDamaged', 'Poškozený průjezd', {
  describe: () => 'průjezd 3 × 3 × 6 m, průraz 2,4 × 2,6 m do vedlejší místnosti, odkrytý strop 1,3 × 2,1 m',
  generate(_p, seed, mat) {
    return passageShell(mat, { sideOpen: true, ceilingHole: true, seed });
  },
}, {
  target: [7.1, 6, 3.6],
  route: passRoute(true),
  walkableRoof: false,
  rays: [{ from: [0.7, 4.5, 0.8], to: [0.7, 1.0, 0.8], hit: false, note: 'odkrytým stropem lze střílet shora' }],
  notes: ['Hlavní cesta (osa 3 m) zůstává volná, suť jen u stěny průrazu a pod otvorem ve stropě (bez kolize).'],
});

// ---------------------------------------------------------------------------
// C76–C78 Obchody s roletou (průlez vleže – v herních datech `crawl`)
// ---------------------------------------------------------------------------
interface ShopSpec { W: number; D: number; ow: number; post: number; gap: number }
function shopRoom(s: ShopSpec, mat: string): Part[] {
  const h = 3.2, top = 2.6, z0 = -s.D / 2, z1 = s.D / 2;
  const parts: Part[] = [];
  // Čelo: silné sloupky kolem otvoru, nadpraží; boky, záda s dveřmi, střecha.
  parts.push(bx(-s.W / 2, -s.ow / 2, 0, h, z0, z0 + s.post, mat), bx(s.ow / 2, s.W / 2, 0, h, z0, z0 + s.post, mat), bx(-s.ow / 2, s.ow / 2, top, h, z0, z0 + 0.3, mat));
  parts.push(bx(-s.W / 2, -s.W / 2 + t, 0, h, z0 + s.post, z1, mat), bx(s.W / 2 - t, s.W / 2, 0, h, z0 + s.post, z1, mat));
  parts.push(...wall([-s.W / 2 + t, z1 - t / 2], [s.W / 2 - t, z1 - t / 2], 0, h, t, [{ c: (s.W - 2 * t) / 2 + 0.6, w: 1.2, b: 0, t: 2.25, kind: 'door' }], mat, { out: [0, 1], trim: TRIM }));
  parts.push(bx(-s.W / 2 - 0.05, s.W / 2 + 0.05, h, h + 0.2, z0 - 0.05, z1 + 0.05, CONC), bx(-s.W / 2 + 0.1, s.W / 2 - 0.1, h + 0.2, h + 0.212, z0 + 0.1, z1 - 0.1, 'roof', false));
  parts.push(bx(-s.W / 2 + t, s.W / 2 - t, 0, 0.04, z0 + s.post, z1 - t, 'plazaTile'));
  // Box rolety nad otvorem, vodicí lišty.
  parts.push(bx(-s.ow / 2 - 0.05, s.ow / 2 + 0.05, top - 0.02, top + 0.34, z0 - 0.32, z0, 'shutterBox'));
  for (const sg of [-1, 1]) parts.push(bx(sg * s.ow / 2 - 0.04, sg * s.ow / 2 + 0.04, 0, top, z0 - 0.08, z0, 'metal', false));
  // Pult vzadu (kryt), regál.
  parts.push(bx(-s.W / 2 + 0.5, -s.W / 2 + 1.9, 0, 1.0, z1 - 1.5, z1 - 0.9, 'wood'));
  return parts;
}
/** Roleta (lamely) od výšky y0 po nadpraží; kolize = deska. */
const shutter = (x0: number, x1: number, y0: number, top: number, z: number): Part[] => {
  const parts: Part[] = [{ ...bx(x0, x1, y0, top, z - 0.03, z + 0.03, 'shutter'), collide: true }];
  parts.push(bx(x0, x1, y0, y0 + 0.06, z - 0.05, z + 0.05, 'metal', false));
  return parts;
};

const SHOP76: ShopSpec = { W: 4.6, D: 4.5, ow: 2.5, post: 0.3, gap: 0.65 };
regC(76, 'shopShutterHalf', 'Obchod s částečně staženou roletou', {
  describe: () => 'obchod 4,6 × 4,5 × 3,2 m, otvor 2,5 m, roleta končí 0,65 m nad podlahou – průlez jen vleže; zadní dveře',
  generate(_p, _s, mat) {
    const z0 = -SHOP76.D / 2;
    return [...shopRoom(SHOP76, mat), ...shutter(-SHOP76.ow / 2, SHOP76.ow / 2, SHOP76.gap, 2.6, z0 - 0.12)];
  },
}, {
  target: [4.6, 4.5, 3.2],
  route: [
    { p: [0, 0, -4.0], note: 'ulice' },
    { p: [0, 0, -3.2], note: 'před roletou' },
    { p: [0, 0.04, -0.6], stance: 'prone', note: 'průlez vleže pod roletou' },
    { p: [0, 0.04, -0.2], note: 'vstát uvnitř' },
    { p: [0.6, 0.04, 1.2] },
    { p: [0.6, 0, 3.2], note: 'zadní dveře ven' },
  ],
  crawl: [{ at: [0, 0.325, -2.37], w: 2.5, h: 0.65, stance: 'prone', note: 'roleta 0,65 m nad podlahou – jen vleže, nejsou to dveře' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, true, 'roleta kryje', -4, 0), thru(0, 0.3, false, 'pod roletou střela projde', -4, 0)],
  notes: ['Průlez vleže, ne dveře: v JSON `crawl_passages` (stance prone, výška 0,65 m). Vestoje / v dřepu neprojde (ověřeno).'],
});

const SHOP77: ShopSpec = { W: 6.0, D: 4.5, ow: 4.0, post: 0.5, gap: 0.7 };
regC(77, 'shopShutterWide', 'Široký obchodní průlez', {
  describe: () => 'obchod 6 × 4,5 × 3,2 m, otvor 4 m, roleta 0,7 m nad podlahou, sloupky 0,5 m, za roletou volno na vstávání',
  generate(_p, _s, mat) {
    const z0 = -SHOP77.D / 2;
    return [...shopRoom(SHOP77, mat), ...shutter(-SHOP77.ow / 2, SHOP77.ow / 2, SHOP77.gap, 2.6, z0 - 0.12)];
  },
}, {
  target: [6, 4.5, 3.2],
  route: [
    { p: [1.2, 0, -4.0], note: 'ulice' },
    { p: [1.2, 0, -3.2] },
    { p: [1.2, 0.04, -0.4], stance: 'prone', note: 'průlez vleže' },
    { p: [1.2, 0.04, 0.0], note: 'vstát (volný prostor za roletou)' },
    { p: [0.6, 0, 3.2], note: 'zadní dveře' },
  ],
  crawl: [{ at: [0, 0.35, -2.37], w: 4.0, h: 0.7, stance: 'prone', note: 'roleta 0,7 m – průlez vleže v celé šířce 4 m' }],
  walkableRoof: false,
  rays: [thru(-2.3, 1.5, true, 'silný sloupek kryje', -4, 0), thru(0, 0.35, false, 'pod roletou volno', -4, 0)],
  notes: ['Za roletou 3,5 m volné hloubky – vstávání bez zachycení o pult (pult je vzadu vlevo).'],
});

const SHOP78: ShopSpec = { W: 4.6, D: 4.5, ow: 2.5, post: 0.3, gap: 0.8 };
regC(78, 'shopShutterDamaged', 'Poškozená obchodní roleta', {
  describe: () => 'obchod 4,6 × 4,5 m, zkroucená roleta: vlevo průlez 1,0 × 0,8 m, uprostřed 0,45 m, vpravo téměř dole',
  generate(_p, _s, mat) {
    const z = -SHOP78.D / 2 - 0.12;
    const parts = shopRoom(SHOP78, mat);
    // Kolize po třetinách podle skutečné spodní hrany (průchozí jen levá část 0,8 m).
    const x0 = -SHOP78.ow / 2, x1 = SHOP78.ow / 2;
    parts.push({ ...bx(x0, x0 + 1.0, 0.8, 2.6, z - 0.05, z + 0.05, 'shutter', true), render: false });
    parts.push({ ...bx(x0 + 1.0, x0 + 1.8, 0.45, 2.6, z - 0.05, z + 0.05, 'shutter', true), render: false });
    parts.push({ ...bx(x0 + 1.8, x1, 0.12, 2.6, z - 0.05, z + 0.05, 'shutter', true), render: false });
    // Vzhled: horní část rovná, spodní lamely zkroucené a vyboulené ven.
    parts.push(bx(x0, x1, 1.6, 2.6, z - 0.02, z + 0.02, 'shutter', false));
    parts.push({ shape: 'box', pos: [x0 + 0.5, 1.2, z - 0.05], rot: [0.25, 0, 0.12], size: [1.02, 0.8, 0.04], material: 'shutter' });
    parts.push({ shape: 'box', pos: [x0 + 1.4, 1.02, z - 0.1], rot: [0.35, 0, -0.08], size: [0.82, 1.15, 0.04], material: 'shutter' });
    parts.push({ shape: 'box', pos: [x0 + 2.15, 0.86, z - 0.12], rot: [0.3, 0, -0.18], size: [0.72, 1.5, 0.04], material: 'shutter' });
    parts.push({ shape: 'box', pos: [x0 + 0.5, 0.82, z - 0.14], rot: [0.25, 0, 0.12], size: [1.02, 0.06, 0.06], material: 'metal' });
    return parts;
  },
}, {
  target: [4.6, 4.5, 3.2],
  route: [
    { p: [-0.75, 0, -4.0], note: 'ulice' },
    { p: [-0.75, 0, -3.2] },
    { p: [-0.75, 0.04, -0.5], stance: 'prone', note: 'průlez vleže vlevo (0,8 m)' },
    { p: [-0.6, 0.04, -0.1], note: 'vstát' },
    { p: [0.6, 0, 3.2], note: 'zadní dveře' },
  ],
  crawl: [{ at: [-0.75, 0.4, -2.37], w: 1.0, h: 0.8, stance: 'prone', note: 'zkroucená roleta – průlez vleže jen v levé části' }],
  walkableRoof: false,
  rays: [thru(0.9, 0.3, true, 'vpravo roleta skoro u země – kryje i vleže', -4, 0), thru(-0.75, 0.4, false, 'v průlezu volno', -4, 0)],
  notes: ['Kolize rolety po třetinách podle nejnižší skutečně průchozí výšky (0,8 / 0,45 / 0,12 m); zkroucené lamely jen vzhled.'],
});

// ---------------------------------------------------------------------------
// C79–C81 Sklepní vstupy (pod terén): terrainCut + dlážděné okolí
// ---------------------------------------------------------------------------
const DEPTH = 1.8;
const apronParam = { key: 'apron', label: 'Dlážděné okolí', type: 'number' as const, min: 1, max: 6, step: 0.1, unit: 'm', default: 2.2 };

interface Cellar {
  parts: Part[];
  /** Obdélník prohlubně (schody + podesta + sklep) a díry v dlažbě (otvor schodů) – před vycentrováním. */
  cut: Rect;
  holes: Rect[];
  /** Plochy, které kryje vlastní střecha (sklep) – dlažba tam není. */
  roofs: Rect[];
  route: SetMeta['route'];
}

/** Sklep za dveřmi: místnost 2,8 × 2,5 m, světlá výška 2,2 m, strop vystupuje 0,6 m nad terén. */
function cellarRoom(x0: number, x1: number, z0: number, z1: number, mat: string, doorAxis: 'z' | 'x', doorAt: number): Part[] {
  const y0 = -DEPTH, yc = y0 + 2.25, w = 0.25, parts: Part[] = [];
  parts.push(bx(x0, x1, y0 - 0.2, y0, z0, z1, CONC));
  // Obvodové zdi (dveřní stěna řeší volající), strop.
  if (doorAxis === 'z') {
    parts.push(bx(x0, x1, y0, yc, z1 - w, z1, mat), bx(x0, x0 + w, y0, yc, z0, z1, mat), bx(x1 - w, x1, y0, yc, z0, z1, mat));
  } else {
    parts.push(bx(x0, x1, y0, yc, z0, z0 + w, mat), bx(x0, x1, y0, yc, z1 - w, z1, mat), bx(x1 - w, x1, y0, yc, z0, z1, mat));
  }
  parts.push(bx(x0, x1, yc, yc + 0.2, z0, z1, CONC), bx(x0 - 0.03, x1 + 0.03, yc + 0.2, yc + 0.26, z0 - 0.03, z1 + 0.03, 'concreteDark', false));
  void doorAt;
  return parts;
}

/** Dveřní stěna sklepa (otvor 1,1 × 2,2 m) kolmo na osu z v z, šířka x0..x1, výška do stropu sklepa. */
function cellarDoorWallZ(x0: number, x1: number, z: number, mat: string): Part[] {
  const y0 = -DEPTH, yc = y0 + 2.25, w = 0.25;
  return [bx(x0, -0.55, y0, yc, z, z + w, mat), bx(0.55, x1, y0, yc, z, z + w, mat), bx(-0.55, 0.55, y0 + 2.2, yc, z, z + w, mat), bx(-0.62, 0.62, y0 + 2.2, y0 + 2.32, z - 0.04, z, TRIM, false)];
}

function straightCellar(mat: string, covered: boolean): Cellar {
  const w = 1.3, wt = 0.25, zt = -3.6;
  const st = stairs(0, zt + 3.0, 'z-', w, -DEPTH, 0, CONC, { solid: true });
  const zl = zt + st.run, zd = zl + 1.2; // podesta, dveřní stěna
  const parts: Part[] = [...st.parts];
  parts.push(bx(-w / 2, w / 2, -DEPTH - 0.2, -DEPTH, zl, zd, CONC));
  // Opěrné zdi po obou stranách (z pod terénu až 1,0 m nad terén, u kryté verze 2,4 m).
  const above = covered ? 2.4 : 1.0;
  for (const sg of [-1, 1]) parts.push(bx(sg < 0 ? -w / 2 - wt : w / 2, sg < 0 ? -w / 2 : w / 2 + wt, -DEPTH - 0.2, above, zt, zd, mat));
  for (const sg of [-1, 1]) parts.push(bx(sg < 0 ? -w / 2 - wt - 0.03 : w / 2 - 0.03, sg < 0 ? -w / 2 + 0.03 : w / 2 + wt + 0.03, above, above + 0.06, zt - 0.03, zd, TRIM, false));
  parts.push(...cellarDoorWallZ(-1.4, 1.4, zd, mat));
  // Nad dveřmi a sklepem: stěna nad terén (kryt) – sklep 2,8 × 2,5 m.
  parts.push(...cellarRoom(-1.4, 1.4, zd + 0.25, zd + 2.75, mat, 'z', 0));
  if (covered) {
    // Lehká betonová stříška nad schody na bočních zdech (výška 2,4 m nad terénem).
    parts.push(bx(-w / 2 - wt - 0.15, w / 2 + wt + 0.15, above + 0.06, above + 0.22, zt - 0.35, zd + 0.25, CONC));
  }
  return {
    parts,
    cut: [-1.45, zt, 1.45, zd + 2.75],
    holes: [[-w / 2 - wt, zt, w / 2 + wt, zd + 0.25]],
    roofs: [[-1.4, zd + 0.25, 1.4, zd + 2.75]],
    route: [
      { p: [0, 0.04, zt - 0.8], note: 'u sestupu' },
      { p: [0, -DEPTH, zl + 0.6], note: 'dolní podesta' },
      { p: [0, -DEPTH, zd + 1.4], note: 'sklep' },
      { p: [0, -DEPTH, zl + 0.6] },
      { p: [0, 0.04, zt - 0.8], note: 'zpět nahoru' },
    ],
  };
}

function doglegCellar(mat: string): Cellar {
  const w = 1.3, wt = 0.25, zt = -2.0, mid = -DEPTH / 2;
  const f1 = stairs(0, zt + 1.5, 'z-', w, mid, 0, CONC, { solid: true });
  const zm0 = zt + f1.run, zm1 = zm0 + w; // mezipodesta 1,3 × 1,3
  const xs = w / 2; // začátek ramene 2 (směr +X)
  const f2 = stairs(xs + 1.5, (zm0 + zm1) / 2, 'x-', w, -DEPTH, mid, CONC, { solid: true });
  const xb0 = xs + f2.run, xb1 = xb0 + 1.2; // dolní podesta
  const parts: Part[] = [...f1.parts, ...f2.parts];
  parts.push(bx(-w / 2, w / 2, -DEPTH - 0.2, mid, zm0, zm1, CONC));
  parts.push(bx(xb0, xb1, -DEPTH - 0.2, -DEPTH, zm0, zm1, CONC));
  const up = 1.0, y0 = -DEPTH - 0.2;
  // Zídky kolem celé jámy (1 m nad terén) – chrání sestup z boku.
  parts.push(bx(-w / 2 - wt, -w / 2, y0, up, zt, zm1 + wt, mat)); // levá strana ramene 1
  parts.push(bx(w / 2, w / 2 + wt, y0, up, zt, zm0, mat)); // pravá strana ramene 1 (do mezipodesty)
  parts.push(bx(w / 2, xb1, y0, up, zm0 - wt, zm0, mat)); // přední strana ramene 2
  parts.push(bx(-w / 2, xb1, y0, up, zm1, zm1 + wt, mat)); // zadní strana
  for (const [a, b, c, d] of [[-w / 2 - wt, -w / 2, zt, zm1 + wt], [w / 2, w / 2 + wt, zt, zm0], [w / 2, xb1, zm0 - wt, zm0], [-w / 2, xb1, zm1, zm1 + wt]] as const) parts.push(bx(a - 0.03, b + 0.03, up, up + 0.06, c - 0.03, d + 0.03, TRIM, false));
  // Dveřní stěna kolmo na X na konci dolní podesty a sklep za ní.
  const yc = -DEPTH + 2.25, zc = (zm0 + zm1) / 2;
  parts.push(bx(xb1, xb1 + wt, -DEPTH, yc, zc - 1.4, zc - 0.55, mat), bx(xb1, xb1 + wt, -DEPTH, yc, zc + 0.55, zc + 1.4, mat), bx(xb1, xb1 + wt, -DEPTH + 2.2, yc, zc - 0.55, zc + 0.55, mat));
  parts.push(bx(xb1 + wt, xb1 + wt + 0.04, -DEPTH + 2.2, -DEPTH + 2.32, zc - 0.62, zc + 0.62, TRIM, false));
  // Dveřní stěna stojí pod úrovní terénu i nad ní (jako zídka) – nad sklepem je jeho strop.
  parts.push(...cellarRoom(xb1 + wt, xb1 + wt + 2.5, zc - 1.4, zc + 1.4, mat, 'x', zc));
  const roomX1 = xb1 + wt + 2.5;
  return {
    parts,
    cut: [-w / 2 - wt, zt, roomX1, zc + 1.4],
    holes: [[-w / 2 - wt, zt, w / 2 + wt, zm1 + wt], [w / 2, zm0 - wt, xb1 + wt, zm1 + wt]],
    roofs: [[xb1 + wt, zc - 1.4, roomX1, zc + 1.4]],
    route: [
      { p: [0, 0.04, zt - 0.8], note: 'u sestupu' },
      { p: [0, mid, zc], note: 'mezipodesta' },
      { p: [xb0 + 0.6, -DEPTH, zc], note: 'dolní podesta' },
      { p: [xb1 + wt + 1.3, -DEPTH, zc], note: 'sklep' },
      { p: [xb0 + 0.6, -DEPTH, zc] },
      { p: [0, mid, zc] },
      { p: [0, 0.04, zt - 0.8], note: 'zpět nahoru' },
    ],
  };
}

/** Dlažba kolem jámy (kolize, zakrývá přechod terénu), vycentrování a prohlubeň. */
function finishCellar(c: Cellar, apron: number): { parts: Part[]; cut: Rect; route: SetMeta['route'] } {
  const [x0, z0, x1, z1] = c.cut;
  const A: Rect = [x0 - apron, z0 - apron, x1 + apron, z1 + apron];
  const parts = [...c.parts];
  for (const p of slab(A, 0.04, 0.24, [...c.holes, ...c.roofs], 'paving')) parts.push(p);
  // Obrubník po obvodu dlažby (jen vzhled).
  parts.push(bx(A[0], A[2], 0, 0.07, A[1], A[1] + 0.12, 'concreteDark', false), bx(A[0], A[2], 0, 0.07, A[3] - 0.12, A[3], 'concreteDark', false));
  const cx = (A[0] + A[2]) / 2, cz = (A[1] + A[3]) / 2;
  return {
    parts: shift(parts, -cx, -cz),
    cut: [x0 - cx, z0 - cz, x1 - cx, z1 - cz],
    route: c.route.map((w) => ({ ...w, p: [w.p[0] - cx, w.p[1], w.p[2] - cz] as V3 })),
  };
}

function regCellar(item: number, id: string, label: string, make: (mat: string) => Cellar, describe: string, target: [number, number, number], notes: string[], rays: SetMeta['rays'] = []) {
  const ref = finishCellar(make('plaster'), apronParam.default as number);
  regC(item, id, label, {
    describe: () => describe,
    params: [apronParam],
    terrainCut: (p: Params) => ({ rect: finishCellar(make('plaster'), n(p, 'apron')).cut, depth: DEPTH + 0.05 }),
    generate(p, _s, mat) {
      return finishCellar(make(mat), n(p, 'apron')).parts;
    },
  }, {
    target,
    route: ref.route,
    walkableRoof: false,
    rays,
    notes: [
      ...notes,
      `Schody vedou ${DEPTH} m pod terén: model nese „snížit terén“ (JSON terrain_cut). V editoru to provede „Dorovnat terén pod předměty“ nebo Kontrola → „Snížit terén“.`,
      'Dlážděné okolí (parametr, výchozí 2,2 m) zakrývá přechod terénu – na mapě s mřížkou 2 m nastav aspoň 4,1 m (Kontrola na to upozorní).',
    ],
  });
}

regCellar(79, 'cellarStraight', 'Přímý vstup do sklepa', (m) => straightCellar(m, false), 'schody 1,3 m široké, 10 stupňů 18 × 30 cm, 1,8 m pod terén, boční zdi (1 m nad terén), dolní podesta, dveře 1,1 × 2,2 m do sklepa 2,8 × 2,5 m', [3, 7.3, 2.8], ['Obě strany sestupu kryté zdmi, které nad terénem pokračují 1 m jako zídky.'], [
  { from: [-3, 0.5, 0], to: [0, 0.5, -1.5], hit: true, note: 'zídka kryje sestup z boku' },
]);
regCellar(80, 'cellarDogleg', 'Zalomený vstup do sklepa', doglegCellar, 'dvě ramena po 0,9 m s mezipodestou 1,3 × 1,3 m (zalomení o 90°), zídky 1 m kolem jámy, sklep 2,5 × 2,8 m', [6.6, 5.6, 2.8], ['Zídky na všech volných stranách jámy – sestup je chráněný před boční palbou.']);
regCellar(81, 'cellarCovered', 'Krytý sklepní vstup', (m) => straightCellar(m, true), 'přímé schody 1,8 m pod terén, boční zdi 2,4 m nad terén s betonovou stříškou, sklep 2,8 × 2,5 m', [3, 7.3, 2.8], ['Stříška ve 2,4 m nad terénem (nad dolní podestou 4,2 m) – nikde neomezuje prostor nad hlavou.']);

// ---------------------------------------------------------------------------
// C82–C83 Verandy (zadní strana pro fasádu)
// ---------------------------------------------------------------------------
function veranda(W: number, D: number, mat: string, o: { stairW: number; cols: number[]; sideWalls?: boolean }): Part[] {
  const nSteps = 3, rise = 0.17, deck = nSteps * rise, run = nSteps * 0.3;
  const L = D + run, z0 = -L / 2 + run; // přední hrana podesty
  const z1 = L / 2;
  const parts: Part[] = [];
  parts.push(bx(-W / 2, W / 2, 0, deck, z0, z1, STONE));
  parts.push(bx(-W / 2 - 0.02, W / 2 + 0.02, deck - 0.05, deck, z0 - 0.04, z0, 'concreteDark', false));
  parts.push(...stairs(0, z0 - run, 'z+', o.stairW, 0, deck, STONE, { solid: true }).parts);
  // Sloupy a střecha (2,6 m nad podestou).
  const roofY = deck + 2.6;
  for (const x of o.cols) {
    parts.push({ shape: 'cylinder', pos: [x, deck + 1.3, z0 + 0.25], size: [0.24, 2.6, 0.24], material: 'plasterWhite', collide: true });
    parts.push(bx(x - 0.18, x + 0.18, deck, deck + 0.18, z0 + 0.07, z0 + 0.43, TRIM, false));
  }
  parts.push(bx(-W / 2 - 0.15, W / 2 + 0.15, roofY, roofY + 0.16, z0 - 0.15, z1, CONC));
  parts.push(bx(-W / 2 - 0.15, W / 2 + 0.15, roofY - 0.25, roofY, z0 + 0.13, z0 + 0.37, mat));
  if (o.sideWalls) {
    // Nízké zídky (0,9 m nad podestou) po bocích a vpředu kromě schodů.
    const wh = deck + 0.9, wt = 0.25;
    for (const sg of [-1, 1]) {
      parts.push(bx(sg < 0 ? -W / 2 : W / 2 - wt, sg < 0 ? -W / 2 + wt : W / 2, deck, wh, z0, z1, mat));
      parts.push(bx(sg < 0 ? -W / 2 : o.stairW / 2 + 0.05, sg < 0 ? -o.stairW / 2 - 0.05 : W / 2, deck, wh, z0, z0 + wt, mat));
    }
    for (const sg of [-1, 1]) parts.push(bx(sg < 0 ? -W / 2 - 0.02 : W / 2 - wt - 0.02, sg < 0 ? -W / 2 + wt + 0.02 : W / 2 + 0.02, wh, wh + 0.06, z0 - 0.02, z1, TRIM, false));
  }
  return parts;
}

regC(82, 'verandaSmall', 'Malá krytá veranda', {
  describe: () => 'podesta 3 × 2 m ve výšce 0,51 m, 3 stupně 17 × 30 cm, střecha na dvou sloupech (2,6 m nad podestou), zadní strana otevřená',
  generate(_p, _s, mat) {
    return veranda(3, 2, mat, { stairW: 1.4, cols: [-1.3, 1.3] });
  },
}, {
  target: [3, 2.9, 3.3],
  route: [{ p: [0, 0, -2.6], note: 'ulice' }, { p: [0, 0.51, 0.0], note: 'podesta' }, { p: [1.0, 0.51, 1.0], note: 'u fasády' }],
  walkableRoof: false,
  notes: ['Zadní hrana podesty (z = +1,45) přiléhá k fasádě; magnet ji přilepí k budově.'],
});

regC(83, 'verandaWide', 'Široká veranda', {
  describe: () => 'podesta 5 × 2,5 m, schodiště 1,6 m uprostřed, 4 sloupy, nízké boční a přední zídky 0,9 m',
  generate(_p, _s, mat) {
    return veranda(5, 2.5, mat, { stairW: 1.6, cols: [-2.25, -1.1, 1.1, 2.25], sideWalls: true });
  },
}, {
  target: [5, 3.4, 3.3],
  route: [{ p: [0, 0, -3.0], note: 'ulice' }, { p: [0, 0.51, 0.2], note: 'podesta' }, { p: [-1.6, 0.51, 1.0] }, { p: [1.6, 0.51, 1.0] }],
  walkableRoof: false,
  rays: [{ from: [-4, 0.9, 0.6], to: [0, 0.9, 0.6], hit: true, note: 'boční zídka kryje' }],
  notes: ['Zídky 0,9 m nad podestou na bocích a vpředu vedle schodů.'],
});

// ---------------------------------------------------------------------------
// C84–C85 Proražené zdi (4 × 3 m)
// ---------------------------------------------------------------------------
/**
 * Zeď z plátků podél X: v každém plátku je otvor [lo, hi] (null = plná). Okraje otvoru dostanou
 * vnitřní zdivo (cihla) jako vzhled.
 */
function brokenWall(W: number, h: number, th: number, slice: number, open: (xc: number) => [number, number] | null, mat: string, edgeMat: string, bricks: boolean, seed: number): Part[] {
  const parts: Part[] = [];
  const r = rng(seed);
  const nS = Math.round(W / slice);
  let run0 = -W / 2;
  const flushSolid = (x1: number) => {
    if (x1 - run0 > 1e-3) parts.push(bx(run0, x1, 0, h, -th / 2, th / 2, mat));
  };
  for (let i = 0; i < nS; i++) {
    const x0 = -W / 2 + i * slice, x1 = x0 + slice, xc = (x0 + x1) / 2;
    const o = open(xc);
    if (!o) continue;
    flushSolid(x0);
    run0 = x1;
    if (o[0] > 0.005) parts.push(bx(x0, x1, 0, o[0], -th / 2, th / 2, mat));
    if (o[1] < h - 0.005) parts.push(bx(x0, x1, o[1], h, -th / 2, th / 2, mat));
    // Odkryté zdivo na hraně otvoru (vzhled).
    if (o[1] < h - 0.005) parts.push(bx(x0, x1, o[1] - 0.01, o[1] + 0.04, -th / 2 + 0.03, th / 2 - 0.03, edgeMat, false));
    if (bricks && o[1] < h - 0.005 && r() < 0.6) parts.push({ shape: 'box', pos: [xc + (r() - 0.5) * 0.1, o[1] - 0.04, (r() - 0.5) * 0.1], rot: [0, r() * 0.4, (r() - 0.5) * 0.3], size: [0.24, 0.07, 0.11], material: 'brick' });
  }
  flushSolid(W / 2);
  return parts;
}

regC(84, 'wallBreachPlaster', 'Proražená omítnutá zeď', {
  describe: () => 'zeď 4 × 0,3 × 3 m, nepravidelný průraz (jádro 1,6 × 2,25 m), odkryté zdivo, nízká suť',
  generate(_p, seed, mat) {
    const r = rng(seed + 11);
    const prof = [0, 1.2, 1.8, 2.3, 2.4, 2.5, 2.55, 2.5, 2.45, 2.35, 2.3, 1.6, 0];
    const parts = brokenWall(4, 3, 0.3, 4 / 20, (xc) => {
      const k = Math.round((xc + 1.2) / 0.2);
      if (k < 0 || k >= prof.length || prof[k] <= 0) return null;
      const lo = k < 2 || k > 10 ? 0.35 + r() * 0.2 : 0;
      return [lo, prof[k] + (r() - 0.5) * 0.08];
    }, mat, 'brick', false, seed);
    parts.push(...rubble(0, -0.55, 6, [1.6, 0.6], seed, 0.4), ...rubble(0.2, 0.55, 4, [1.4, 0.5], seed + 3, 0.35));
    return parts;
  },
}, {
  target: [4, 0.3, 3],
  route: [{ p: [0, 0, -2.0], note: 'před zdí' }, { p: [0, 0, 0], note: 'průraz' }, { p: [0, 0, 2.0], note: 'za zdí' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průrazem volno'), thru(1.7, 1.5, true, 'zbytek zdi kryje')],
  notes: ['Průchozí jádro 1,6 × 2,25 m (≥ 1,2 × 2,2), okraje nepravidelné; suť nízká a bez kolize.'],
});

regC(85, 'wallBreachBrick', 'Proražená cihlová zeď', {
  describe: () => 'cihlová zeď 4 × 0,3 × 3 m, stupňovitý průraz po vrstvách cihel (jádro 1,25 × 2,25 m), cihly jen na siluetě',
  generate(_p, seed) {
    // Stupně po 0,25 m (šířka cihly) a 0,25 m výšky – velké odlomy, uprostřed nejvýš.
    const tops = [1.0, 1.5, 2.0, 2.25, 2.5, 2.5, 2.25, 2.25, 1.75, 1.25];
    const parts = brokenWall(4, 3, 0.3, 0.25, (xc) => {
      const k = Math.floor((xc + 1.25) / 0.25);
      if (k < 0 || k >= tops.length) return null;
      return [k === 0 || k === tops.length - 1 ? 0.5 : 0, tops[k]];
    }, 'brick', 'brick', true, seed);
    parts.push(...rubble(0, -0.5, 6, [1.4, 0.5], seed + 1, 0.35));
    for (const p of parts) if (p.material === 'concreteLight') p.material = 'brick';
    return parts;
  },
}, {
  target: [4, 0.3, 3],
  route: [{ p: [0, 0, -2.0], note: 'před zdí' }, { p: [0, 0, 0], note: 'průraz' }, { p: [0, 0, 2.0], note: 'za zdí' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průrazem volno'), thru(-1.8, 1.5, true, 'zbytek zdi kryje')],
  notes: ['Jednotlivé cihly jen na siluetě otvoru (vzhled), zbytek zdi je plný kvádr s cihlovou texturou.'],
});
