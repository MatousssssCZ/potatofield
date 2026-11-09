import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import { bx, rubble, thru } from './modules';
import { brokenWall } from './entries';
import { beam } from './industrial';
import { TRIM, reg, type SetMeta } from './residential';

/**
 * Sada 300 · F Zdi, ploty a brány (položky 136–160).
 * Dvorní zdi: tloušťka 0,3 m, výška 2,0 m, pilíře 0,45 m (2,2 m + krycí deska). Modul měří 4 m
 * mezi osami pilířů; parametr „Koncové pilíře“ – vypnout u modulů skládaných za sebou (magnet
 * pak napojí zeď přesně na pilíř souseda bez zdvojení).
 * Pletivo a zábradlí: kolize jen pro pohyb (průstřelné). Plné ploty a zdi kryjí.
 */
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regF = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, 'F');
const CONC = 'concreteLight';
const STEEL = 'paintedMetal';
const WT = 0.3, WH = 2.0, PW = 0.45, PH = 2.2;
const pierParam = { key: 'piers', label: 'Koncové pilíře', type: 'bool' as const, default: true };

/** Pilíř s krycí deskou. */
const pier = (x: number, z: number, _mat: string, w = PW, h = PH): Part[] => [bx(x - w / 2, x + w / 2, 0, h, z - w / 2, z + w / 2, CONC), bx(x - w / 2 - 0.04, x + w / 2 + 0.04, h, h + 0.1, z - w / 2 - 0.04, z + w / 2 + 0.04, TRIM, false)];
/** Zeď podél X (z0..z1 = tloušťka) s krycí deskou. */
const wallX = (x0: number, x1: number, z: number, h: number, mat: string, t = WT): Part[] => [bx(x0, x1, 0, h, z - t / 2, z + t / 2, mat), bx(x0, x1, h, h + 0.06, z - t / 2 - 0.04, z + t / 2 + 0.04, TRIM, false)];
const wallZ = (z0: number, z1: number, x: number, h: number, mat: string, t = WT): Part[] => [bx(x - t / 2, x + t / 2, 0, h, z0, z1, mat), bx(x - t / 2 - 0.04, x + t / 2 + 0.04, h, h + 0.06, z0, z1, TRIM, false)];

/** Křídlo vrat (rám + výplň). `mesh` = pletivo (kolize jen pro pohyb). */
function gateLeaf(x0: number, z0: number, x1: number, z1: number, h: number, fill: string, mesh: boolean, frame = STEEL, y0 = 0.05): Part[] {
  const alongX = Math.abs(z1 - z0) < 1e-6;
  const L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const sz = (l: number, hh: number, t: number): V3 => (alongX ? [l, hh, t] : [t, hh, l]);
  const at = (u: number, y: number): V3 => (alongX ? [Math.min(x0, x1) + u, y, cz] : [cx, y, Math.min(z0, z1) + u]);
  const parts: Part[] = [{ shape: 'box', pos: [cx, y0 + h / 2, cz], size: sz(L - 0.08, h - 0.08, mesh ? 0.01 : 0.04), material: fill, collide: true, moveOnly: mesh || undefined }];
  for (const u of [0.03, L - 0.03]) parts.push({ shape: 'box', pos: at(u, y0 + h / 2), size: sz(0.06, h, 0.06), material: frame });
  for (const y of [y0 + 0.03, y0 + h - 0.03, y0 + h / 2]) parts.push({ shape: 'box', pos: at(L / 2, y), size: sz(L, 0.06, 0.06), material: frame });
  return parts;
}

// ---------------------------------------------------------------------------
// F136–F138 Pilotní dvorní zdi
// ---------------------------------------------------------------------------
regF(136, 'courtWall', 'Rovná dvorní zeď (pilot)', {
  describe: (p) => `4 m mezi osami pilířů, zeď 2,0 × 0,3 m, pilíře 0,45 × 2,2 m s krycí deskou${p.piers ? '' : ' (bez koncových pilířů – pro skládání)'}`,
  params: [pierParam],
  generate(p, _s, mat) {
    const parts = wallX(-2, 2, 0, WH, mat);
    if (p.piers) parts.push(...pier(-2, 0, mat), ...pier(2, 0, mat, PW - 0.01, PH - 0.005));
    else parts.push(...pier(-2, 0, mat));
    return parts;
  },
}, {
  target: [4.15, 0.55, 2.3],
  route: [{ p: [-1.6, 0, -1.0] }, { p: [1.6, 0, -1.0], note: 'podél zdi' }],
  walkableRoof: false,
  rays: [thru(0, 1.7, true, 'zeď kryje stojícího'), thru(-2, 2.1, true, 'pilíř')],
  notes: [
    'Podle pilotu wall_courtyard_a: zeď 4 × 2 × 0,3 m, pilíře 0,45 × 2,2 m. Úprava: osy pilířů ve ±2,0 m (pilot ±1,8 m), aby modul měřil 4 m a navazoval na roh F137 i na další moduly.',
    'Pravý pilíř je o 1 cm menší – při překrytí s pilířem souseda se neperou plochy (bez blikání). Vypnutím „Koncové pilíře“ zůstane jen levý pilíř a magnet moduly řadí bez zdvojení.',
  ],
});

regF(137, 'courtWallCorner', 'Rohová dvorní zeď (pilot)', {
  describe: () => 'pravoúhlý roh, ramena 4 m (osa rohového pilíře → osa koncového), výška a tloušťka jako F136',
  params: [pierParam],
  generate(p, _s, mat) {
    // Roh v (−2, −2): rameno podél +X a rameno podél +Z; pivot = střed půdorysu.
    const c = -2, parts: Part[] = [...wallX(c, c + 4, c, WH, mat), ...wallZ(c + WT / 2, c + 4, c, WH, mat), ...pier(c, c, mat)];
    if (p.piers) parts.push(...pier(c + 4, c, mat, PW - 0.01, PH - 0.005), ...pier(c, c + 4, mat, PW - 0.01, PH - 0.005));
    return parts;
  },
}, {
  target: [4.2, 4.05, 2.3],
  route: [{ p: [1.6, 0, -3.0], note: 'vně podél ramene X' }, { p: [-3.0, 0, -3.0], note: 'kolem rohu' }, { p: [-3.0, 0, 1.6] }, { p: [-1.0, 0, 1.6], teleport: true }, { p: [-1.0, 0, -1.0], note: 'uvnitř kouta' }, { p: [1.6, 0, -1.0] }],
  walkableRoof: false,
  rays: [{ from: [-4, 1.5, -4], to: [0, 1.5, 0], hit: true, note: 'rohový pilíř kryje' }],
  notes: ['Podle pilotu wall_courtyard_b; ramena napojená bez překryvu: rameno Z začíná za lícem ramene X (z = −1,85), rohový pilíř obě překrývá.', 'Konce ramen v osách pilířů → rovná zeď F136 (s vypnutými koncovými pilíři) navazuje přesně.'],
});

regF(138, 'courtWallGate', 'Zeď s otevřenou bránou (pilot)', {
  describe: () => 'zeď 4 × 3 × 0,35 m, otvor 1,6 × 2,4 m, dvě kovová křídla otevřená o 90° do dvora (kolize v otevřené poloze)',
  generate(_p, _s, mat) {
    const t = 0.35, z = -0.6;
    const parts: Part[] = [bx(-2, -0.8, 0, 3, z - t / 2, z + t / 2, mat), bx(0.8, 2, 0, 3, z - t / 2, z + t / 2, mat), bx(-0.8, 0.8, 2.4, 3, z - t / 2, z + t / 2, mat)];
    parts.push(bx(-2.04, 2.04, 3.0, 3.08, z - t / 2 - 0.04, z + t / 2 + 0.04, TRIM, false), bx(-0.9, 0.9, 2.4, 2.55, z - t / 2 - 0.05, z - t / 2, TRIM, false));
    for (const s of [-1, 1]) parts.push(...gateLeaf(s * 0.84, z + t / 2 + 0.02, s * 0.84, z + t / 2 + 1.47, 2.1, 'metalSheet', false));
    return parts;
  },
}, {
  target: [4.1, 1.8, 3.08],
  route: [{ p: [0, 0, -2.2], note: 'ulice' }, { p: [0, 0, -0.6], note: 'branka 1,6 m' }, { p: [0, 0, 1.6], note: 'dvůr' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'otvor volný'), { from: [-2, 1.2, 0.5], to: [0, 1.2, 0.5], hit: true, note: 'otevřené křídlo kryje z boku' }],
  notes: ['Podle pilotu wall_courtyard_c: otvor 1,6 × 2,4 m, křídla 1,45 m kolmo do dvora, závěsy za hranou otvoru (průchod 1,6 m nezúžen).'],
});

// ---------------------------------------------------------------------------
// F139–F143 Další dvorní zdi
// ---------------------------------------------------------------------------
regF(139, 'courtWallLow', 'Nízká dvorní zeď', {
  describe: () => '4 × 1,1 × 0,3 m, krajní pilíře 0,4 m o 0,2 m vyšší',
  params: [pierParam],
  generate(p, _s, mat) {
    const parts = wallX(-2, 2, 0, 1.1, mat);
    parts.push(...pier(-2, 0, mat, 0.4, 1.3));
    if (p.piers) parts.push(...pier(2, 0, mat, 0.39, 1.295));
    return parts;
  },
}, {
  target: [4.4, 0.48, 1.4],
  route: [{ p: [-1.6, 0, -1.0] }, { p: [1.6, 0, -1.0] }],
  walkableRoof: false,
  rays: [thru(0, 0.8, true, 'kryje vkleče'), thru(0, 1.5, false, 'vestoje přes ni')],
  notes: ['Stejný modul 4 m jako F136.'],
});

regF(140, 'courtWallWideGate', 'Dvorní zeď se širokou bránou', {
  describe: () => 'délka 6 m, průjezd 3 m, dva pilíře 0,6 × 0,6 × 2,6 m, kovová vrata otevřená o 90° do dvora',
  generate(_p, _s, mat) {
    const parts: Part[] = [...wallX(-3, -2.1, 0, WH, mat), ...wallX(2.1, 3, 0, WH, mat)];
    for (const x of [-1.8, 1.8]) parts.push(...pier(x, 0, mat, 0.6, 2.6));
    for (const s of [-1, 1]) parts.push(...gateLeaf(s * 1.54, 0.32, s * 1.54, 0.32 + 1.48, 1.9, 'metalSheet', false));
    return parts;
  },
}, {
  target: [6, 2.2, 2.7],
  route: [{ p: [0, 0, -2.0], note: 'ulice' }, { p: [0, 0, 0], note: 'průjezd 3 m' }, { p: [0, 0, 2.6], note: 'dvůr' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průjezd volný'), thru(-1.8, 1.5, true, 'pilíř kryje')],
  notes: ['Křídla zavěšená za lícem pilířů (x = ±1,54), průjezd 3,0 m nezúžený.'],
});

regF(141, 'courtWallBreach', 'Zeď s průchozím proražením', {
  describe: () => 'zeď 4 × 2,2 × 0,3 m, nepravidelný otvor až k zemi, jádro 1,4 × 1,9 m',
  generate(_p, seed, mat) {
    const prof = [0.9, 1.5, 1.95, 2.2, 2.2, 2.2, 2.1, 1.9, 1.4];
    const r = rng(seed);
    const parts = brokenWall(4, 2.2, 0.3, 0.2, (xc) => {
      const k = Math.round((xc + 0.8) / 0.2);
      if (k < 0 || k >= prof.length) return null;
      return [k === 0 || k === prof.length - 1 ? 0.3 + r() * 0.2 : 0, Math.min(2.2, prof[k] + (r() - 0.5) * 0.08)];
    }, mat, 'brick', false, seed);
    parts.push(bx(-2.02, 2.02, 2.2, 2.26, -0.19, 0.19, TRIM, false), ...rubble(0.2, -0.5, 4, [1.2, 0.5], seed, 0.35), ...rubble(-0.2, 0.5, 3, [1.0, 0.4], seed + 2, 0.3));
    return parts;
  },
}, {
  target: [4, 0.4, 2.3],
  route: [{ p: [0, 0, -1.8], note: 'před zdí' }, { p: [0, 0, 0], note: 'proražení' }, { p: [0, 0, 1.8], note: 'za zdí' }],
  walkableRoof: false,
  rays: [thru(0, 1.2, false, 'otvorem volno'), thru(1.6, 1.2, true, 'zbytek zdi kryje')],
  notes: ['Otvor sahá k zemi, průchozí šířka ≥ 1,4 m do výšky 1,9 m.'],
});

regF(142, 'courtWallCollapsed', 'Sesutá dvorní zeď', {
  describe: () => 'délka 4 m: levý konec v plné výšce 2,0 m, k pravému konci klesá až na hromadu suti 0,5 m',
  generate(_p, seed, mat) {
    const r = rng(seed), parts: Part[] = [...pier(-2, 0, mat)];
    const tops = [2.0, 2.0, 1.95, 1.7, 1.5, 1.4, 1.1, 0.9, 0.7, 0.55];
    tops.forEach((h, i) => {
      const x0 = -2 + i * 0.4, x1 = x0 + 0.4, hh = h + (r() - 0.5) * 0.08;
      parts.push(bx(x0, x1, 0, hh, -WT / 2, WT / 2, mat));
      parts.push({ shape: 'box', pos: [x0 + 0.2, hh, 0], rot: [0, 0, (r() - 0.5) * 0.6], size: [0.42, 0.1, WT + 0.02], material: 'brick' });
    });
    parts.push(bx(-2, -0.4, WH, WH + 0.06, -WT / 2 - 0.04, WT / 2 + 0.04, TRIM, false));
    // Hromada suti na konci (nízký kryt, nájezd jako klín).
    parts.push({ shape: 'wedge', pos: [1.9, 0.25, 0], rot: [0, Math.PI / 2, 0], size: [1.2, 0.5, 1.2], material: CONC, collide: true, render: false });
    parts.push(...rubble(2.0, 0, 8, [1.2, 1.2], seed, 0.5), ...rubble(1.0, -0.6, 3, [0.6, 0.4], seed + 3, 0.35));
    return parts;
  },
}, {
  target: [4.6, 1.4, 2.1],
  route: [{ p: [-1.6, 0, -1.0], note: 'u plné části' }, { p: [3.4, 0, -1.0], note: 'kolem suti' }],
  walkableRoof: false,
  rays: [thru(-1.4, 1.7, true, 'plná výška kryje stojícího'), thru(1.2, 1.0, false, 'u sesutého konce jen vleže')],
  notes: ['Silueta klesá ve 40cm stupních – úroveň krytu je čitelná: stojící / klečící / ležící.'],
});

regF(143, 'courtWallDamagedTop', 'Zeď s poškozeným vrškem', {
  describe: () => '4 × 2,0 × 0,3 m, spodních 1,2 m souvislých, nahoře tři velké odlomy (bez drobných úlomků)',
  generate(_p, _s, mat) {
    const parts: Part[] = [bx(-2, 2, 0, 1.2, -WT / 2, WT / 2, mat)];
    const top: [number, number, number][] = [[-2, -1.3, 2.0], [-1.3, -0.6, 1.35], [-0.6, 0.3, 2.0], [0.3, 0.9, 1.5], [0.9, 1.4, 1.75], [1.4, 2, 1.25]];
    for (const [a, b, h] of top) if (h > 1.21) parts.push(bx(a, b, 1.2, h, -WT / 2, WT / 2, mat));
    // Lomové hrany (šikmé) na krajích odlomů.
    for (const [x, y, rz] of [[-1.3, 1.62, 0.6], [-0.6, 1.62, -0.6], [0.3, 1.72, 0.5], [1.4, 1.45, -0.5]] as const) parts.push({ shape: 'box', pos: [x, y, 0], rot: [0, 0, rz], size: [0.3, 0.12, WT + 0.02], material: 'concreteDark' });
    parts.push(bx(-2, -1.3, WH, WH + 0.06, -WT / 2 - 0.04, WT / 2 + 0.04, TRIM, false), bx(-0.6, 0.3, WH, WH + 0.06, -WT / 2 - 0.04, WT / 2 + 0.04, TRIM, false));
    return parts;
  },
}, {
  target: [4, 0.38, 2.06],
  route: [{ p: [-1.6, 0, -1.0] }, { p: [1.6, 0, -1.0] }],
  walkableRoof: false,
  rays: [thru(-1.0, 1.6, false, 'odlomem lze střílet vestoje'), thru(-1.0, 1.0, true, 'spodní část kryje')],
  notes: ['Spodních 1,2 m souvislý kryt; horní hrana s odlomy 1,25–2,0 m.'],
});

// ---------------------------------------------------------------------------
// F144–F146 Kamenné zídky
// ---------------------------------------------------------------------------
/** Kamenná zídka podél X: jádro (kolize) + hrubé kameny na vršku a koncích (vzhled). */
function stoneRun(x0: number, x1: number, z: number, h: number, t: number, seed: number, low?: (x: number) => number | null): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const step = 0.4;
  for (let x = x0; x < x1 - 1e-6; x += step) {
    const xa = x, xb = Math.min(x1, x + step), xc = (xa + xb) / 2;
    const hh = low?.(xc) ?? h;
    parts.push(bx(xa, xb, 0, hh - 0.12, z - t / 2, z + t / 2, 'stoneWall'));
    // Kamenný vršek: dva kameny vedle sebe, nepravidelné.
    for (const dz of [-t / 4, t / 4]) parts.push({ shape: 'box', pos: [xc + (r() - 0.5) * 0.06, hh - 0.08 + (r() - 0.5) * 0.04, z + dz], rot: [(r() - 0.5) * 0.15, (r() - 0.5) * 0.3, (r() - 0.5) * 0.15], size: [step * (0.8 + r() * 0.3), 0.18 + r() * 0.06, t / 2 * (0.85 + r() * 0.2)], material: 'rock', collide: false });
    parts.push({ ...bx(xa, xb, hh - 0.12, hh, z - t / 2, z + t / 2, 'rock'), render: false });
  }
  for (const xe of [x0, x1]) parts.push({ shape: 'box', pos: [xe, h * 0.5, z], rot: [0, (r() - 0.5) * 0.3, 0], size: [0.2, h * 0.9, t + 0.06], material: 'rock' });
  return parts;
}

regF(144, 'stoneWall', 'Rovná kamenná zídka', {
  describe: () => '4 × 1,0 × 0,6 m, hrubé kameny na vršku a koncích',
  generate(_p, seed) {
    return stoneRun(-2, 2, 0, 1.0, 0.6, seed);
  },
}, {
  target: [4, 0.6, 1.0],
  route: [{ p: [-1.6, 0, -1.2] }, { p: [1.6, 0, -1.2] }],
  walkableRoof: false,
  rays: [thru(0, 0.7, true, 'kryje vkleče'), thru(0, 1.4, false, 'vestoje přes ni')],
  notes: ['Kolize: jádro + horní pás (souvislé), kameny jsou vzhled.'],
});

regF(145, 'stoneWallCorner', 'Rohová kamenná zídka', {
  describe: () => 'dvě ramena po 3 m, výška 1,0 m, nepravidelná kamenná silueta, kout průchodný podél obou stran',
  generate(_p, seed) {
    const parts = stoneRun(-1.5, 1.5, -1.2, 1.0, 0.6, seed);
    for (const p of stoneRun(-0.9, 1.5, 0, 1.0, 0.6, seed + 7)) parts.push({ ...p, pos: [-1.2 + p.pos[2] - 0, p.pos[1], p.pos[0]] as V3, size: [p.size[2], p.size[1], p.size[0]] as V3, rot: p.rot ? [p.rot[2], p.rot[1], p.rot[0]] as V3 : undefined });
    return parts;
  },
}, {
  target: [3, 3, 1.0],
  route: [{ p: [1.3, 0, -0.4], note: 'uvnitř podél ramene X' }, { p: [-0.5, 0, -0.4], note: 'kout' }, { p: [-0.5, 0, 1.3], note: 'podél ramene Z' }],
  walkableRoof: false,
  rays: [{ from: [-3, 0.7, -3], to: [0, 0.7, 0], hit: true, note: 'roh kryje' }],
  notes: ['Vnitřní líc bez výstupků (kameny jen navrchu a na koncích).'],
});

regF(146, 'stoneWallBroken', 'Zbořená kamenná zídka', {
  describe: () => '4 × 1,0 × 0,6 m, uprostřed snížená na 0,3 m, velké kameny mimo průchod',
  generate(_p, seed) {
    const parts = stoneRun(-2, 2, 0, 1.0, 0.6, seed, (x) => (Math.abs(x) < 0.7 ? 0.3 : Math.abs(x) < 1.1 ? 0.65 : null));
    for (const [x, z, s] of [[1.5, -0.8, 0.5], [1.9, -0.6, 0.4], [-1.6, 0.8, 0.45], [-1.2, 1.0, 0.35]] as const) parts.push({ shape: 'blob', pos: [x, s * 0.35, z], size: [s, s * 0.7, s * 0.9], material: 'rock', seed: Math.round(x * 100), rough: 0.4, collide: true });
    return parts;
  },
}, {
  target: [4, 0.6, 1.0],
  route: [{ p: [0, 0, -1.4], note: 'před zídkou' }, { p: [0, 0.3, 0], note: 'přes sníženou část' }, { p: [0, 0, 1.4], note: 'za zídkou' }],
  walkableRoof: false,
  rays: [thru(0, 0.5, false, 'uprostřed už nekryje'), thru(1.6, 0.6, true, 'okraje kryjí')],
  notes: ['Snížená část 0,3 m je překročitelná; kameny leží mimo osu průchodu.'],
});

// ---------------------------------------------------------------------------
// F147–F148 Betonové T-stěny
// ---------------------------------------------------------------------------
function tWall(broken: boolean, seed: number): Part[] {
  const W = 2, H = 3, t = 0.25, parts: Part[] = [];
  // Patka 2 × 1,2 × 0,3 m a stěna s mírně sraženými hranami.
  parts.push(bx(-W / 2, W / 2, 0, 0.3, -0.6, 0.6, CONC), bx(-W / 2 + 0.03, W / 2 - 0.03, 0.3, 0.33, -0.57, 0.57, CONC, false));
  if (!broken) {
    parts.push(bx(-W / 2, W / 2, 0.3, H - 0.04, -t / 2, t / 2, CONC), bx(-W / 2 + 0.04, W / 2 - 0.04, H - 0.04, H, -t / 2 + 0.03, t / 2 - 0.03, CONC, false));
    for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [s * (W / 2 - 0.015), 1.6, 0], size: [0.03, 2.6, t - 0.06], material: 'concreteDark' });
  } else {
    // Chybí horní pravý roh, pravý bok nepravidelně odlomený (stupně), patka celá.
    const r = rng(seed);
    parts.push(bx(-W / 2, 0.2, 0.3, H - 0.04, -t / 2, t / 2, CONC), bx(0.2, 0.75, 0.3, 2.2, -t / 2, t / 2, CONC), bx(0.75, W / 2, 0.3, 1.3, -t / 2, t / 2, CONC));
    for (const [x, y, rz] of [[0.25, 2.55, 0.7], [0.7, 1.9, -0.5], [0.95, 1.35, 0.3]] as const) parts.push({ shape: 'box', pos: [x, y, 0], rot: [0, 0, rz + (r() - 0.5) * 0.2], size: [0.4, 0.15, t + 0.02], material: 'concreteDark' });
    for (let i = 0; i < 4; i++) parts.push({ shape: 'cylinder', pos: [0.3 + i * 0.15, 2.3 - i * 0.2, 0], rot: [0, 0, 0.8], size: [0.025, 0.5, 0.025], material: 'metalSheetRust' });
    parts.push(...rubble(0.9, -1.0, 4, [0.6, 0.5], seed, 0.4));
  }
  // Zvedací oka nahoře (vzhled).
  if (!broken) for (const x of [-0.5, 0.5]) parts.push({ shape: 'cylinder', pos: [x, H + 0.05, 0], rot: [Math.PI / 2, 0, 0], size: [0.12, 0.04, 0.12], material: 'metal' });
  return parts;
}

regF(147, 'tWall', 'Betonová T-stěna', {
  describe: () => 'výška 3 m, šířka 2 m, stěna 0,25 m, stabilizační patka 2 × 1,2 × 0,3 m, sražené hrany',
  generate(_p, seed) {
    return tWall(false, seed);
  },
}, {
  target: [2, 1.2, 3],
  route: [{ p: [-1.6, 0, -1.2] }, { p: [1.6, 0, -1.2] }],
  walkableRoof: false,
  rays: [thru(0, 2.5, true, 'kryje i stojícího')],
  notes: ['Stěny jdou řadit vedle sebe po 2 m (magnet), patky na sebe navazují.'],
});

regF(148, 'tWallDamaged', 'Poškozená T-stěna', {
  describe: () => 'T-stěna 2 × 3 m bez horního pravého rohu, nepravidelně odlomený bok, patka celá',
  generate(_p, seed) {
    return tWall(true, seed);
  },
}, {
  target: [2, 1.2, 3],
  route: [{ p: [-1.6, 0, -1.2] }, { p: [1.6, 0, -1.2] }],
  walkableRoof: false,
  rays: [thru(-0.5, 2.5, true, 'levá část v plné výšce'), thru(0.9, 1.8, false, 'odlomený roh')],
  notes: ['Patka beze změny – stěna stojí stabilně.'],
});

// ---------------------------------------------------------------------------
// F149–F151 Pletivové ploty (průstřelné)
// ---------------------------------------------------------------------------
/** Pletivo podél X mezi sloupky + ostnatá horní část; kolize jen pro pohyb. */
function meshRun(x0: number, x1: number, z: number, h: number, barbed: boolean, postEvery = 2, posts = true): Part[] {
  const parts: Part[] = [{ shape: 'box', pos: [(x0 + x1) / 2, h / 2, z], size: [x1 - x0, h, 0.01], material: 'chainLink', collide: true, moveOnly: true }];
  const n = Math.max(1, Math.round((x1 - x0) / postEvery));
  if (posts) for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    parts.push({ shape: 'cylinder', pos: [x, (h + (barbed ? 0.5 : 0)) / 2, z], size: [0.06, h + (barbed ? 0.5 : 0), 0.06], material: STEEL, collide: true });
    if (barbed) parts.push({ shape: 'box', pos: [x, h + 0.25, z - 0.17], rot: [0.75, 0, 0], size: [0.04, 0.5, 0.04], material: STEEL });
  }
  parts.push({ shape: 'cylinder', pos: [(x0 + x1) / 2, h, z], rot: [0, 0, Math.PI / 2], size: [0.04, x1 - x0, 0.04], material: STEEL });
  if (barbed) for (let k = 0; k < 3; k++) parts.push({ shape: 'cylinder', pos: [(x0 + x1) / 2, h + 0.1 + k * 0.13, z - 0.07 - k * 0.1], rot: [0, 0, Math.PI / 2], size: [0.015, x1 - x0, 0.015], material: 'metal' });
  if (barbed) parts.push({ shape: 'box', pos: [(x0 + x1) / 2, h + 0.25, z - 0.17], rot: [0.75, 0, 0], size: [x1 - x0, 0.5, 0.01], material: 'chainLink', collide: true, moveOnly: true });
  return parts;
}
regF(149, 'fenceMesh', 'Rovný pletivový plot', {
  describe: () => '4 × 2 m + ostnatá část 0,5 m (3 dráty), ocelové sloupky po 2 m, pletivo průstřelné',
  generate() {
    return meshRun(-2, 2, 0, 2.0, true);
  },
}, {
  target: [4, 0.45, 2.5],
  route: [{ p: [-1.6, 0, -1.0] }, { p: [1.6, 0, -1.0] }],
  walkableRoof: false,
  rays: [thru(0.6, 1.2, false, 'pletivo střelu propustí'), thru(0, 1.2, true, 'sloupek zastaví')],
  notes: ['Pletivo na oboustranné alfa ploše (materiál chainLink), kolize jen pro pohyb.'],
});

regF(150, 'fenceMeshCorner', 'Rohový pletivový plot', {
  describe: () => 'dvě ramena po 3 m, zesílený rohový sloupek Ø 0,12 m, výška 2 m + ostnatá část',
  generate() {
    const parts: Part[] = [...meshRun(-1.5, 1.5, -1.5, 2.0, true, 1.5)];
    // Rameno podél Z (x = −1,5): pletivo, sloupky, horní trubka; ostnatý výložník ven (−X).
    parts.push({ shape: 'box', pos: [-1.5, 1.0, 0], size: [0.01, 2.0, 3], material: 'chainLink', collide: true, moveOnly: true });
    for (const z of [0, 1.5]) parts.push({ shape: 'cylinder', pos: [-1.5, 1.25, z], size: [0.06, 2.5, 0.06], material: STEEL, collide: true });
    parts.push({ shape: 'cylinder', pos: [-1.5, 2.0, 0], rot: [Math.PI / 2, 0, 0], size: [0.04, 3, 0.04], material: STEEL });
    for (let k = 0; k < 3; k++) parts.push({ shape: 'cylinder', pos: [-1.57 - k * 0.1, 2.1 + k * 0.13, 0], rot: [Math.PI / 2, 0, 0], size: [0.015, 3, 0.015], material: 'metal' });
    parts.push({ shape: 'box', pos: [-1.67, 2.25, 0], rot: [0, 0, -0.75], size: [0.01, 0.5, 3], material: 'chainLink', collide: true, moveOnly: true });
    parts.push({ shape: 'cylinder', pos: [-1.5, 1.3, -1.5], size: [0.12, 2.6, 0.12], material: STEEL, collide: true });
    return parts;
  },
}, {
  target: [3, 3, 2.5],
  route: [{ p: [1.2, 0, -0.9], note: 'uvnitř' }, { p: [-0.9, 0, -0.9], note: 'kout' }, { p: [-0.9, 0, 1.2] }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.2, 0.7], to: [0, 1.2, 0.7], hit: false, note: 'pletivo průstřelné' }],
  notes: ['Rohový sloupek silnější (Ø 0,12 m), ostnatá část na obou ramenech vyložená ven.'],
});

regF(151, 'fenceMeshGate', 'Pletivová brána', {
  describe: () => 'rám 3 m mezi sloupky Ø 0,12 m, dvě křídla 1,5 m otevřená o 90°, pletivo průstřelné, ostnaté plotové navázání 1 m',
  generate() {
    const parts: Part[] = [...meshRun(-2.5, -1.55, 0, 2.0, true, 1), ...meshRun(1.55, 2.5, 0, 2.0, true, 1)];
    for (const x of [-1.55, 1.55]) parts.push({ shape: 'cylinder', pos: [x, 1.3, 0], size: [0.12, 2.6, 0.12], material: STEEL, collide: true });
    for (const s of [-1, 1]) parts.push(...gateLeaf(s * 1.45, 0.1, s * 1.45, 1.55, 1.95, 'chainLink', true, 'paintedMetal'));
    return parts;
  },
}, {
  target: [5, 1.8, 2.6],
  route: [{ p: [0, 0, -2.0], note: 'před bránou' }, { p: [0, 0, 0], note: 'brána 3 m' }, { p: [0, 0, 2.4], note: 'za bránou' }],
  walkableRoof: false,
  rays: [thru(0, 1.2, false, 'průjezd'), { from: [-3, 1.2, 0.8], to: [0, 1.2, 0.8], hit: false, note: 'pletivo křídla propustí střelu' }],
  notes: ['Rám křídel (trubky) je vzhled; kolize křídla jen pro pohyb. Křídla zavěšená uvnitř rámu, průjezd 2,9 m.'],
});

// ---------------------------------------------------------------------------
// F152–F155 Plechové a dřevěné ploty
// ---------------------------------------------------------------------------
function sheetFence(seed: number, damaged: boolean): Part[] {
  const r = rng(seed), parts: Part[] = [];
  for (const x of [-2, -0.67, 0.67, 2]) if (!(damaged && x === -0.67)) parts.push({ shape: 'cylinder', pos: [x, 1.05, 0.06], size: [0.08, 2.1, 0.08], material: STEEL, collide: true });
  for (const y of [0.4, 1.6]) parts.push(bx(-2, 2, y - 0.03, y + 0.03, 0.04, 0.1, STEEL, false));
  // Tabule ~1,1 m s přesahem, střídavě vpředu/vzadu, nepravidelný horní okraj.
  const xs = [-2.0, -1.05, -0.1, 0.85, 1.8];
  for (let i = 0; i < 4; i++) {
    let x0 = xs[i] - (i ? 0.1 : 0), x1 = xs[i + 1] + (i < 3 ? 0.1 : 0.2);
    const h = 1.9 + r() * 0.2, z = i % 2 ? 0.0 : -0.03;
    // Poškozený: otvor −1,15…0,0 m (tabule i sloupek vytržené).
    if (damaged && i === 0) x1 = -1.15;
    if (damaged && i === 2) x0 = 0.0;
    if (damaged && i === 1) {
      // Vytržená tabule leží opodál.
      parts.push({ shape: 'box', pos: [-0.6, 0.08, -1.3], rot: [Math.PI / 2 - 0.1, 0.4, 0], size: [1.1, 2.0, 0.02], material: 'metalSheetRust' }, { shape: 'cylinder', pos: [0.3, 0.05, -1.6], rot: [0, 0.3, Math.PI / 2], size: [0.08, 2.1, 0.08], material: STEEL });
      continue;
    }
    if (damaged && i === 2) {
      // Ohnutá tabule: spodek drží, horní část vyhnutá ven.
      parts.push(bx(x0, x1, 0.05, 1.0, z - 0.01, z + 0.01, 'metalSheetRust'));
      parts.push({ shape: 'box', pos: [(x0 + x1) / 2, 1.35, z - 0.25], rot: [-0.55, 0, 0.05], size: [x1 - x0, 0.9, 0.02], material: 'metalSheetRust', collide: true });
      continue;
    }
    parts.push(bx(x0, Math.min(2, x1), 0.05, h, z - 0.01, z + 0.01, i % 2 ? 'metalSheet' : 'metalSheetRust'));
  }
  return parts;
}

regF(152, 'fenceSheet', 'Plechový plot', {
  describe: () => '4 × 2 m, 4 překrývající se plechové tabule na ocelových sloupcích, nepravidelný horní okraj',
  generate(_p, seed) {
    return sheetFence(seed, false);
  },
}, {
  target: [4, 0.2, 2.1],
  route: [{ p: [-1.6, 0, -1.0] }, { p: [1.6, 0, -1.0] }],
  walkableRoof: false,
  rays: [thru(0.3, 1.2, true, 'plech zastaví hráče i střelu (kryt slabý, ale plný)')],
  notes: ['Tabule mají kolizi (plný plot); průstřel řeší případně hra materiálem plechu.'],
});

regF(153, 'fenceSheetDamaged', 'Poškozený plechový plot', {
  describe: () => '4 × 2 m, jedna tabule i se sloupkem vytržená (průchod 1,15 m), další ohnutá ven',
  generate(_p, seed) {
    return sheetFence(seed, true);
  },
}, {
  target: [4, 1.6, 2.1],
  route: [{ p: [-0.6, 0, -1.6], note: 'před plotem' }, { p: [-0.6, 0, 0], note: 'otvor po vytržené tabuli' }, { p: [-0.6, 0, 1.4], note: 'za plotem' }],
  walkableRoof: false,
  rays: [thru(-0.6, 1.2, false, 'otvor'), thru(1.3, 1.2, true, 'celá tabule')],
  notes: ['Otvor x −1,15…0,0 m (1,15 m) s kolizí přesně podle zbylých tabulí; vytržená tabule a sloupek leží před plotem.'],
});

function woodFence(seed: number, damaged: boolean): Part[] {
  const r = rng(seed), parts: Part[] = [];
  for (const x of [-2, 0, 2]) parts.push(bx(x - 0.05, x + 0.05, 0, 1.55, 0.03, 0.13, 'woodDark'));
  for (const y of [0.35, 1.2]) parts.push(bx(-2, 2, y - 0.04, y + 0.04, 0.0, 0.05, 'woodDark', false));
  const W = 0.14, gap = 0.03;
  const gapX: [number, number] = [-1.05, -0.05];
  for (let x = -2; x < 2 - 1e-6; x += W + gap) {
    const xc = x + W / 2;
    if (damaged && xc > gapX[0] && xc < gapX[1]) continue;
    const broken = damaged && (xc > 0.6 && xc < 1.4) && r() < 0.7;
    const h = broken ? 0.7 + r() * 0.5 : 1.5 + (r() - 0.5) * 0.03;
    parts.push(bx(x, x + W, 0.02, h, -0.04, 0.0, 'wood', false));
  }
  // Kolize: souvislá deska (mezery mezi prkny 3 cm se neřeší), u poškozeného s otvorem.
  if (!damaged) parts.push({ ...bx(-2, 2, 0, 1.5, -0.04, 0.05, 'wood'), render: false });
  else {
    parts.push({ ...bx(-2, gapX[0], 0, 1.5, -0.04, 0.05, 'wood'), render: false }, { ...bx(gapX[1], 0.6, 0, 1.5, -0.04, 0.05, 'wood'), render: false }, { ...bx(0.6, 1.4, 0, 0.75, -0.04, 0.05, 'wood'), render: false }, { ...bx(1.4, 2, 0, 1.5, -0.04, 0.05, 'wood'), render: false });
    for (let i = 0; i < 4; i++) parts.push({ shape: 'box', pos: [-0.6 + (r() - 0.5) * 0.8, 0.03, -0.6 - r() * 0.6], rot: [0, r() * 3, 0], size: [W, 0.03, 1.2], material: 'wood' });
  }
  return parts;
}

regF(154, 'fenceWood', 'Dřevěný plot', {
  describe: () => '4 × 1,5 m, svislá prkna 14 cm, dvě vodorovné příčky, tři sloupky',
  generate(_p, seed) {
    return woodFence(seed, false);
  },
}, {
  target: [4, 0.17, 1.55],
  route: [{ p: [-1.6, 0, -1.0] }, { p: [1.6, 0, -1.0] }],
  walkableRoof: false,
  rays: [thru(0.5, 1.0, true, 'plot kryje vkleče (měkký kryt)')],
  notes: ['Kolize jedna deska (mezery mezi prkny nejsou průchozí ani průstřelné).'],
});

regF(155, 'fenceWoodDamaged', 'Poškozený dřevěný plot', {
  describe: () => '4 × 1,5 m, chybí prkna i příčky v šíři 1,0 m (průchod), vpravo ulomené horní konce',
  generate(_p, seed) {
    const parts = woodFence(seed, true);
    // Příčky v místě průchodu přeražené (visí dolů).
    return parts.filter((p) => !(p.material === 'woodDark' && p.size[0] > 3)).concat([
      bx(-2, -1.05, 0.31, 0.39, 0, 0.05, 'woodDark', false), bx(-0.05, 2, 0.31, 0.39, 0, 0.05, 'woodDark', false),
      bx(-2, -1.05, 1.16, 1.24, 0, 0.05, 'woodDark', false), bx(-0.05, 2, 1.16, 1.24, 0, 0.05, 'woodDark', false),
      { shape: 'box', pos: [-0.95, 0.9, 0.03], rot: [0, 0, 1.2], size: [0.6, 0.08, 0.05], material: 'woodDark' },
    ]);
  },
}, {
  target: [4, 1.3, 1.55],
  route: [{ p: [-0.55, 0, -1.4], note: 'před plotem' }, { p: [-0.55, 0, 0], note: 'mezera 1,0 m' }, { p: [-0.55, 0, 1.4], note: 'za plotem' }],
  walkableRoof: false,
  rays: [thru(-0.55, 1.0, false, 'mezera'), thru(1.0, 1.2, false, 'nad ulomenými prkny'), thru(1.0, 0.5, true, 'spodek ulomené části kryje')],
  notes: ['Průchod 1,0 m (prkna i příčky chybí), kolize podle skutečných zbytků prken.'],
});

// ---------------------------------------------------------------------------
// F156–F157 Kovové zábradlí
// ---------------------------------------------------------------------------
function railingRun(x0: number, x1: number, z: number, h = 1.0, endPosts = [true, true]): Part[] {
  const parts: Part[] = [];
  if (endPosts[0]) parts.push(bx(x0 - 0.03, x0 + 0.03, 0, h, z - 0.03, z + 0.03, STEEL, false));
  if (endPosts[1]) parts.push(bx(x1 - 0.03, x1 + 0.03, 0, h, z - 0.03, z + 0.03, STEEL, false));
  parts.push({ shape: 'cylinder', pos: [(x0 + x1) / 2, h, z], rot: [0, 0, Math.PI / 2], size: [0.05, x1 - x0, 0.05], material: STEEL });
  parts.push(bx(x0, x1, 0.12, 0.16, z - 0.015, z + 0.015, STEEL, false));
  for (let x = x0 + 0.4; x < x1 - 0.2; x += 0.4) parts.push(bx(x - 0.012, x + 0.012, 0.14, h, z - 0.012, z + 0.012, STEEL, false));
  parts.push({ ...bx(x0, x1, 0, h, z - 0.03, z + 0.03, STEEL), render: false, moveOnly: true });
  return parts;
}

regF(156, 'railing', 'Rovné kovové zábradlí', {
  describe: () => '2 × 1 m, dva krajní sloupky, trubkové madlo, spodní pás a řídké svislé výplně (průstřelné)',
  generate() {
    return railingRun(-1, 1, 0);
  },
}, {
  target: [2, 0.06, 1.03],
  route: [{ p: [-0.8, 0, -0.8] }, { p: [0.8, 0, -0.8] }],
  walkableRoof: false,
  rays: [thru(0.2, 0.6, false, 'střela projde')],
  notes: ['Kolize jen pro pohyb (hráč neprojde, nepřeleze bez skoku).'],
});

regF(157, 'railingCorner', 'Rohové kovové zábradlí', {
  describe: () => 'ramena 2 m, v rohu zkosené hlavní madlo (0,2 m), jinak stejné jako F156',
  generate() {
    const parts = railingRun(-0.8, 1.0, -1.0, 1.0, [false, true]);
    for (const p of railingRun(-0.8, 1.0, -1.0, 1.0, [false, true])) parts.push({ ...p, pos: [-1.0, p.pos[1], p.pos[0]] as V3, size: [p.size[2], p.size[1], p.size[0]] as V3, rot: p.shape === 'cylinder' ? [Math.PI / 2, 0, 0] : undefined });
    parts.push(bx(-1.03, -0.97, 0, 1.0, -1.03, -0.97, STEEL, false));
    parts.push(beam([-1.0, 1.0, -0.8], [-0.8, 1.0, -1.0], 0.05, STEEL));
    return parts;
  },
}, {
  target: [2, 2, 1.03],
  route: [{ p: [0.8, 0, -0.5], note: 'uvnitř' }, { p: [-0.5, 0, -0.5], note: 'roh' }, { p: [-0.5, 0, 0.8] }],
  walkableRoof: false,
  rays: [{ from: [-2, 0.6, 0.3], to: [0, 0.6, 0.3], hit: false, note: 'průstřelné' }],
  notes: ['Konce ramen bez sloupku navazují na F156 (sloupek dodá rovný díl).'],
});

// ---------------------------------------------------------------------------
// F158–F160 Posuvné brány (kolejnice zapuštěná – bez kolize)
// ---------------------------------------------------------------------------
function slidingGate(open: number, leafLen: number, mesh: boolean, mat: string, damaged: boolean, seed: number): Part[] {
  const parts: Part[] = [];
  const h = 2.0;
  // Zeď vpravo (−X) za průjezdem, podél ní je křídlo odsunuté (na vnitřní straně +Z).
  parts.push(...wallX(-open / 2 - leafLen - 0.6, -open / 2 - 0.3, 0, h, mat));
  parts.push(...wallX(open / 2 + 0.3, open / 2 + 1.5, 0, h, mat));
  for (const x of [-open / 2 - 0.15, open / 2 + 0.15]) parts.push(bx(x - 0.15, x + 0.15, 0, 2.5, -0.15, 0.15, mesh ? STEEL : CONC), bx(x - 0.17, x + 0.17, 2.5, 2.56, -0.17, 0.17, TRIM, false));
  // Kolejnice zapuštěná v úrovni terénu (vzhled), vodicí kladky nahoře.
  parts.push(bx(-open / 2 - leafLen - 0.4, open / 2 + 0.3, 0, 0.015, 0.25, 0.31, 'metal', false));
  const z = 0.35;
  if (!damaged) {
    const x1 = -open / 2 - 0.35, x0 = x1 - leafLen;
    parts.push(...gateLeaf(x0, z, x1, z, mesh ? 2.0 : 2.1, mesh ? 'chainLink' : 'metalSheet', mesh, STEEL, 0.06));
    for (const x of [x0 + 0.3, x1 - 0.3]) parts.push({ shape: 'cylinder', pos: [x, 0.05, z], rot: [0, 0, Math.PI / 2], size: [0.12, 0.05, 0.12], material: 'gunMetal' });
  } else {
    // Zkroucené křídlo vytlačené z kolejnice mimo průjezd, opřené šikmo o zeď.
    const r = rng(seed), x1 = -open / 2 - 0.5, x0 = x1 - leafLen, cx = (x0 + x1) / 2;
    // Dvě zkroucené poloviny křídla (různý sklon), opřené o zeď mimo průjezd; rám jako lem.
    for (const [a, b, tilt, yaw] of [[x0, cx + 0.1, 0.28, 0.05], [cx - 0.1, x1, 0.42, -0.12]] as const) {
      const c = (a + b) / 2, L = b - a;
      parts.push({ shape: 'box', pos: [c, 0.95, 0.75], rot: [tilt, yaw, (r() - 0.5) * 0.06], size: [L, 2.0, 0.04], material: 'metalSheetRust', collide: true });
      parts.push({ shape: 'box', pos: [c, 1.93, 0.75 - Math.sin(tilt) * 0.98], rot: [tilt, yaw, 0], size: [L, 0.07, 0.07], material: STEEL });
    }
  }
  return parts;
}

regF(158, 'gateSlideIndustrial', 'Průmyslová posuvná brána', {
  describe: () => 'průjezd 4 m mezi betonovými sloupy, plné plechové křídlo 4,2 m odsunuté podél sousední zdi, kolejnice zapuštěná',
  generate(_p, seed, mat) {
    return slidingGate(4, 4.2, false, mat, false, seed);
  },
}, {
  target: [10.6, 1.0, 2.56],
  route: [{ p: [0, 0, -2.0], note: 'před bránou' }, { p: [0, 0, 0.3], note: 'přes kolejnici' }, { p: [0, 0, 2.5], note: 'za bránou' }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průjezd volný'), thru(-4.5, 1.5, true, 'zeď + odsunuté křídlo')],
  notes: ['Kolejnice 1,5 cm, bez kolize (pohyb nezachytí).'],
});

regF(159, 'gateSlideMesh', 'Posuvná pletivová brána', {
  describe: () => 'průjezd 5 m, výrazné ocelové krajní sloupky, lehký rám s pletivem odsunutý podél zdi (otevřeno)',
  generate(_p, seed, mat) {
    return slidingGate(5, 5.2, true, mat, false, seed);
  },
}, {
  target: [12.6, 1.0, 2.56],
  route: [{ p: [0, 0, -2.0] }, { p: [0, 0, 0.3], note: 'průjezd 5 m' }, { p: [0, 0, 2.5] }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průjezd volný')],
  notes: ['Pletivo křídla průstřelné (kolize jen pro pohyb).'],
});

regF(160, 'gateSlideDamaged', 'Poškozená posuvná brána', {
  describe: () => 'průjezd 4 m, zkroucené křídlo vytlačené z kolejnice a opřené o zeď mimo průjezd',
  generate(_p, seed, mat) {
    return slidingGate(4, 4.2, false, mat, true, seed);
  },
}, {
  target: [10.6, 1.6, 2.56],
  route: [{ p: [0, 0, -2.0] }, { p: [0, 0, 0.3], note: 'průjezd volný' }, { p: [0, 0, 2.5] }],
  walkableRoof: false,
  rays: [thru(0, 1.5, false, 'průjezd volný')],
  notes: ['Křídlo leží mimo průjezd (x < −2,5 m), cesta skrz je čitelná a volná.'],
});

