import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import { bx, thru } from './modules';
import { beam, eulerYX } from './industrial';
import { reg, type SetMeta } from './residential';

/**
 * Sada 300 · J Rekvizity a interiér (položky 246–275): bedny, sudy, palety, pneumatiky,
 * kanystry, nábytek, spotřebiče a interiérová suť. Pivot = střed půdorysu u paty.
 * Drobné rekvizity mají jednu jednoduchou kolizi (kryt / překážka); ploché věci (koberec,
 * papíry) bez kolize. Bez log, nápisů a značek.
 */
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regJ = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, 'J');
const WOOD = 'wood', DARKW = 'woodDark';
const around = (r: number): SetMeta['route'] => [{ p: [-r, 0, -r] }, { p: [r, 0, -r], note: 'kolem' }];
const cyl = (x: number, y0: number, y1: number, z: number, d: number, material: string, collide = false): Part => ({ shape: 'cylinder', pos: [x, (y0 + y1) / 2, z], size: [d, y1 - y0, d], material, collide });

// ---------------------------------------------------------------------------
// J246–J250 Bedny
// ---------------------------------------------------------------------------
/** Prkenná bedna: tělo (kolize), prkna na bocích (spáry), hrany, volitelně diagonály a pásy. */
function crateBox(W: number, D: number, H: number, o: { diag?: boolean; straps?: boolean; seed: number }): Part[] {
  const parts: Part[] = [{ ...bx(-W / 2, W / 2, 0, H, -D / 2, D / 2, WOOD), collide: true }];
  // Spáry mezi prkny (tmavé linky na všech stranách) – prkna ~0,15 m.
  const n = Math.max(2, Math.round(H / 0.15));
  for (let i = 1; i < n; i++) {
    const y = (H * i) / n;
    parts.push(bx(-W / 2 - 0.004, W / 2 + 0.004, y - 0.006, y + 0.006, -D / 2 - 0.004, D / 2 + 0.004, DARKW, false));
  }
  // Rámové lišty na hranách (vzhled), víko s přesahem 1 cm – bez překrývajících se ploch (jiná výška).
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(bx(sx * W / 2 - (sx > 0 ? 0.05 : -0.0) - (sx < 0 ? 0.01 : 0), sx * W / 2 + (sx < 0 ? 0.05 : 0) + (sx > 0 ? 0.01 : 0), 0, H, sz * D / 2 - (sz > 0 ? 0.05 : 0) - (sz < 0 ? 0.01 : 0), sz * D / 2 + (sz < 0 ? 0.05 : 0) + (sz > 0 ? 0.01 : 0), DARKW, false));
  parts.push(bx(-W / 2 - 0.01, W / 2 + 0.01, H, H + 0.025, -D / 2 - 0.01, D / 2 + 0.01, WOOD, false));
  if (o.diag) {
    // Diagonální výztuhy na čelech ±Z a bocích ±X.
    const a = Math.atan2(H - 0.1, W - 0.1), L = Math.hypot(H - 0.1, W - 0.1);
    for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [0, H / 2, s * (D / 2 + 0.012)], rot: [0, 0, s * a], size: [L, 0.09, 0.022], material: DARKW });
    const b = Math.atan2(H - 0.1, D - 0.1), Lb = Math.hypot(H - 0.1, D - 0.1);
    for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [s * (W / 2 + 0.012), H / 2, 0], rot: [s * b, 0, 0], size: [0.022, 0.09, Lb], material: DARKW });
  }
  if (o.straps) for (const x of [-W * 0.3, W * 0.3]) {
    parts.push(bx(x - 0.04, x + 0.04, -0.002, H + 0.03, -D / 2 - 0.014, -D / 2 - 0.004, 'metal', false), bx(x - 0.04, x + 0.04, -0.002, H + 0.03, D / 2 + 0.004, D / 2 + 0.014, 'metal', false), bx(x - 0.04, x + 0.04, H + 0.025, H + 0.035, -D / 2 - 0.014, D / 2 + 0.014, 'metal', false));
  }
  return parts;
}

regJ(246, 'crateSmall', 'Malá dřevěná bedna (pilot)', {
  describe: () => '0,65 × 0,55 × 0,6 m, 4 prkna na výšku, rámové lišty, zavřené víko',
  generate(_p, seed) {
    return crateBox(0.65, 0.55, 0.6, { seed });
  },
}, {
  target: [0.68, 0.605, 0.6],
  route: around(0.7),
  walkableRoof: true,
  rays: [thru(0, 0.4, true, 'kryje vleže', -1, 1)],
  notes: ['Podle pilotu prop_crate_a (0,65 × 0,6 × 0,55 m, jedna kolize). Víko o 2,5 cm výš než tělo – žádné překrývající se plochy (bez blikání).'],
});

regJ(247, 'crateLarge', 'Velká bedna s diagonální výztuhou (pilot)', {
  describe: () => '1,2 × 0,8 × 0,9 m, diagonální výztuhy na všech bocích, plochý spodek',
  generate(_p, seed) {
    return crateBox(1.2, 0.8, 0.9, { diag: true, seed });
  },
}, {
  target: [1.23, 0.905, 0.9],
  route: around(1.0),
  walkableRoof: true,
  rays: [thru(0, 0.7, true, 'kryje vkleče', -1, 1)],
  notes: ['Podle pilotu prop_crate_b (1,2 × 0,9 × 0,8 m); hřebíky nemodelovány.'],
});

regJ(248, 'crateStrapped', 'Bedna s kovovými pásy (pilot)', {
  describe: () => '0,9 × 0,55 × 0,65 m, dřevěné tělo, dva široké kovové pásy (materiál metal)',
  generate(_p, seed) {
    return crateBox(0.9, 0.55, 0.65, { straps: true, seed });
  },
}, {
  target: [0.93, 0.605, 0.65],
  route: around(0.8),
  walkableRoof: true,
  notes: ['Podle pilotu prop_crate_c; kov odlišen materiálem, 3 desky na pás.'],
});

/** Otevřená bedna: dno, 4 stěny s viditelnou tloušťkou, víko (odklopené / opřené). */
function openCrate(W: number, D: number, H: number, o: { lid: 'back' | 'side'; inner?: boolean; mat: string }): Part[] {
  const t = 0.025, parts: Part[] = [];
  parts.push(bx(-W / 2, W / 2, 0, 0.03, -D / 2, D / 2, o.mat));
  parts.push(bx(-W / 2, W / 2, 0, H, -D / 2, -D / 2 + t, o.mat), bx(-W / 2, W / 2, 0, H, D / 2 - t, D / 2, o.mat), bx(-W / 2, -W / 2 + t, 0, H, -D / 2 + t, D / 2 - t, o.mat), bx(W / 2 - t, W / 2, 0, H, -D / 2 + t, D / 2 - t, o.mat));
  if (o.lid === 'back') parts.push({ shape: 'box', pos: [0, H + D / 2 * 0.9, D / 2 + 0.06], rot: [-1.35, 0, 0], size: [W, 0.025, D], material: o.mat });
  else parts.push({ shape: 'box', pos: [W / 2 + 0.12, D / 2 * 0.9, 0], rot: [0, 0, 1.35], size: [W * 0.95, 0.025, D], material: o.mat });
  if (o.inner) {
    // Uzavřené vnitřní schránky (bez nábojů a značek).
    for (const x of [-W / 4, W / 4]) parts.push(bx(x - W / 4 + 0.04, x + W / 4 - 0.04, 0.03, H * 0.7, -D / 2 + 0.06, D / 2 - 0.06, 'paintedMetal'), bx(x - 0.05, x + 0.05, H * 0.7, H * 0.72, -0.03, 0.03, 'metal', false));
  }
  return parts;
}

regJ(249, 'crateMilitaryOpen', 'Otevřená vojenská bedna', {
  describe: () => '1 × 0,6 × 0,6 m, víko odklopené dozadu, dvě uzavřené vnitřní schránky, bez značek',
  generate() {
    return openCrate(1, 0.6, 0.6, { lid: 'back', inner: true, mat: 'paintedMetal' });
  },
}, {
  target: [1, 1.0, 1.2],
  route: around(1.0),
  walkableRoof: false,
  rays: [thru(0, 0.4, true, 'kryje vleže', -1, 0)],
  notes: [],
});

regJ(250, 'crateEmptyOpen', 'Otevřená prázdná bedna', {
  describe: () => '0,8 × 0,6 × 0,6 m, viditelná tloušťka prken (2,5 cm), dno, víko opřené vedle',
  generate() {
    return openCrate(0.8, 0.6, 0.6, { lid: 'side', mat: WOOD });
  },
}, {
  target: [1.1, 0.6, 0.6],
  route: around(1.0),
  walkableRoof: false,
  notes: [],
});

// ---------------------------------------------------------------------------
// J251–J254 Sudy
// ---------------------------------------------------------------------------
function drum(o: { plastic?: boolean; dent?: boolean; holes?: boolean }): Part[] {
  const H = 0.9, D = 0.6, mat = o.plastic ? 'paintedMetalBlue' : 'paintedMetalRed', parts: Part[] = [];
  if (o.plastic) {
    parts.push(cyl(0, 0, 0.06, 0, D * 0.92, mat, false), cyl(0, 0.06, H - 0.06, 0, D, mat, true), cyl(0, H - 0.06, H, 0, D * 0.9, mat, false), cyl(0, H - 0.02, H + 0.02, 0, D * 0.96, mat, false));
    for (const x of [-0.17, 0.17]) parts.push(cyl(x, H, H + 0.035, 0.05, 0.07, 'gunPolymer', false));
  } else {
    parts.push(cyl(0, 0, H, 0, D, mat, true));
    for (const y of [0.3, 0.6]) parts.push(cyl(0, y - 0.02, y + 0.02, 0, D + 0.025, mat, false));
    parts.push(cyl(0, H - 0.005, H + 0.01, 0, D - 0.04, 'metal', false), cyl(0.17, H, H + 0.025, 0, 0.06, 'metal', false));
  }
  if (o.dent) parts.push({ shape: 'box', pos: [D / 2 - 0.04, 0.45, 0.05], rot: [0, 0.3, 0.15], size: [0.06, 0.32, 0.26], material: 'metalSheetRust' });
  if (o.holes) parts.push({ shape: 'cylinder', pos: [-0.27, 0.55, -0.1], rot: [0, 0, Math.PI / 2], size: [0.1, 0.08, 0.1], material: 'concreteDark' }, { shape: 'cylinder', pos: [-0.1, 0.35, -0.29], rot: [Math.PI / 2, 0, 0], size: [0.14, 0.05, 0.11], material: 'concreteDark' });
  return parts;
}

regJ(251, 'drumMetal', 'Stojící kovový sud', {
  describe: () => 'Ø 0,6 × 0,9 m, dva výztužné prstence, horní víko se zátkou',
  generate() {
    return drum({});
  },
}, {
  target: [0.63, 0.63, 0.92],
  route: around(0.7),
  walkableRoof: false,
  rays: [thru(0, 0.5, true, 'kryje vleže / vkleče', -1, 1)],
  notes: ['Kolize válec.'],
});

regJ(252, 'drumPlastic', 'Plastový sud', {
  describe: () => 'Ø 0,6 × 0,9 m, zaoblenější boky, výrazný horní lem, dvě zátky',
  generate() {
    return drum({ plastic: true });
  },
}, {
  target: [0.6, 0.6, 0.94],
  route: around(0.7),
  walkableRoof: false,
  notes: [],
});

/** Ležící sud: postavený sud otočený na bok (kolize se otáčí), mírně promáčklý. */
function lying(parts: Part[], yaw = 0): Part[] {
  const rot = eulerYX(yaw, Math.PI / 2);
  // Otočení kolem X o 90°: (x, y, z) → (x, −z, y), sud pak leží na zemi (posun o poloměr).
  return parts.map((p) => {
    const [x, y, z] = p.pos;
    const ny = 0.3 - z, nz = y - 0.45;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { ...p, pos: [c * x + s * nz, ny, -s * x + c * nz] as V3, rot: p.shape === 'cylinder' ? (p.rot ? eulerYX(yaw, Math.PI / 2 + p.rot[0]) : rot) : [Math.PI / 2 + (p.rot?.[0] ?? 0), yaw + (p.rot?.[1] ?? 0), p.rot?.[2] ?? 0] };
  });
}

regJ(253, 'drumLying', 'Ležící kovový sud', {
  describe: () => 'sud Ø 0,6 × 0,9 m ležící na boku, mírně promáčklý, pivot u země',
  generate() {
    return lying(drum({ dent: true }), 0.4);
  },
}, {
  target: [0.9, 0.6, 0.6],
  route: around(0.8),
  walkableRoof: false,
  rays: [thru(0, 0.3, true, 'kryje vleže', -1, 1)],
  notes: ['Kolize (válec) leží s ním.'],
});

regJ(254, 'drumShot', 'Prostřelený sud', {
  describe: () => 'stojící sud s velkým deformovaným otvorem a promáčklým bokem (menší zásahy materiálem)',
  generate() {
    return drum({ dent: true, holes: true });
  },
}, {
  target: [0.63, 0.63, 0.92],
  route: around(0.7),
  walkableRoof: false,
  notes: [],
});

// ---------------------------------------------------------------------------
// J255–J261 Palety, pneumatiky, kanystr, láhev, pytel
// ---------------------------------------------------------------------------
function pallet(y: number, dx = 0, dz = 0, yaw = 0, collide = true): Part[] {
  const parts: Part[] = [];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (x: number, z: number): [number, number] => [dx + c * x + s * z, dz - s * x + c * z];
  const box = (x: number, yy: number, z: number, sx: number, sy: number, sz: number, mat: string, col = false): Part => {
    const [px, pz] = P(x, z);
    return { shape: 'box', pos: [px, y + yy, pz], rot: [0, yaw, 0], size: [sx, sy, sz], material: mat, collide: col };
  };
  for (let i = 0; i < 5; i++) parts.push(box(-0.5 + i * 0.25, 0.135, 0, 0.12, 0.025, 0.8, WOOD));
  for (const z of [-0.35, 0, 0.35]) parts.push(box(0, 0.105, z, 1.2, 0.03, 0.1, DARKW));
  for (const x of [-0.55, 0, 0.55]) for (const z of [-0.35, 0, 0.35]) parts.push(box(x, 0.05, z, 0.1, 0.075, 0.1, DARKW));
  for (const z of [-0.35, 0, 0.35]) parts.push(box(0, 0.0075, z, 1.2, 0.015, 0.1, WOOD));
  if (collide) parts.push({ ...box(0, 0.075, 0, 1.2, 0.15, 0.8, WOOD, true), render: false });
  return parts;
}

regJ(255, 'pallet', 'Dřevěná paleta', {
  describe: () => '1,2 × 0,8 × 0,15 m, 5 horních prken, 3 ližiny, 9 špalíků',
  generate() {
    return pallet(0);
  },
}, {
  target: [1.2, 0.8, 0.15],
  route: [{ p: [0, 0, -0.9] }, { p: [0, 0.15, 0], note: 'na paletě' }, { p: [0, 0, 0.9] }],
  walkableRoof: true,
  notes: ['Paleta je nízká – dá se přejít (schod 0,15 m).'],
});

regJ(256, 'palletStack', 'Stoh palet', {
  describe: () => '5 palet na sobě, mírně posunuté (±4 cm, ±4°), kolize jeden blok 0,75 m',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    for (let i = 0; i < 5; i++) parts.push(...pallet(i * 0.15, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08, (r() - 0.5) * 0.14, false));
    parts.push({ ...bx(-0.6, 0.6, 0, 0.75, -0.4, 0.4, WOOD), render: false });
    return parts;
  },
}, {
  target: [1.25, 0.85, 0.75],
  route: around(1.0),
  walkableRoof: true,
  rays: [thru(0, 0.5, true, 'kryje vleže', -1, 1)],
  notes: [],
});

/** Pneumatika (prstenec z 12 segmentů – otevřený střed); kolize válec bez středu = 4 kvádry. */
function tire(x: number, y: number, z: number, tilt = 0, collide = true): Part[] {
  const R = 0.35, w = 0.22, parts: Part[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const px = Math.cos(a) * (R - 0.08), pz = Math.sin(a) * (R - 0.08);
    parts.push({ shape: 'box', pos: [x + px, y + w / 2 + Math.sin(tilt) * px, z + pz], rot: [0, -a, tilt], size: [0.17, w, (2 * Math.PI * (R - 0.05)) / 12 + 0.02], material: 'rubber' });
  }
  if (collide) parts.push({ shape: 'cylinder', pos: [x, y + w / 2, z], rot: [0, 0, tilt], size: [2 * R, w, 2 * R], material: 'rubber', collide: true, render: false });
  return parts;
}

regJ(257, 'tireSingle', 'Samostatná pneumatika', {
  describe: () => 'Ø 0,7 × 0,22 m, otevřený střed, hrubý profil (12 segmentů)',
  generate() {
    return tire(0, 0, 0);
  },
}, {
  target: [0.7, 0.7, 0.22],
  route: around(0.7),
  walkableRoof: false,
  notes: [],
});

regJ(258, 'tireStack', 'Stoh pneumatik', {
  describe: () => '4 pneumatiky nad sebou, třetí lehce vychýlená, rovný spodek',
  generate() {
    const parts = [...tire(0, 0, 0, 0, false), ...tire(0.03, 0.22, 0.02, 0, false), ...tire(0.07, 0.45, -0.02, 0.06, false), ...tire(0.02, 0.68, 0.03, 0, false)];
    parts.push({ shape: 'cylinder', pos: [0, 0.45, 0], size: [0.72, 0.9, 0.72], material: 'rubber', collide: true, render: false });
    return parts;
  },
}, {
  target: [0.78, 0.75, 0.92],
  route: around(0.8),
  walkableRoof: false,
  rays: [thru(0, 0.5, true, 'kryje vkleče', -1, 1)],
  notes: [],
});

regJ(259, 'jerrycan', 'Kanystr', {
  describe: () => 'výška 0,47 m, hranaté tělo 0,35 × 0,17 m, horní rukojeť, hrdlo, prolisy na bocích',
  generate() {
    return [bx(-0.175, 0.175, 0, 0.42, -0.085, 0.085, 'containerGreen', true), bx(-0.12, 0.08, 0.42, 0.47, -0.02, 0.02, 'containerGreen', false), bx(-0.1, 0.06, 0.38, 0.42, -0.06, 0.06, 'concreteDark', false), cyl(0.12, 0.42, 0.47, 0, 0.05, 'metal'),
      { shape: 'box', pos: [0, 0.21, -0.087], rot: [0, 0, 0.7], size: [0.38, 0.04, 0.01], material: 'paintedMetal' }, { shape: 'box', pos: [0, 0.21, -0.087], rot: [0, 0, -0.7], size: [0.38, 0.04, 0.01], material: 'paintedMetal' },
      { shape: 'box', pos: [0, 0.21, 0.087], rot: [0, 0, 0.7], size: [0.38, 0.04, 0.01], material: 'paintedMetal' }, { shape: 'box', pos: [0, 0.21, 0.087], rot: [0, 0, -0.7], size: [0.38, 0.04, 0.01], material: 'paintedMetal' }];
  },
}, {
  target: [0.35, 0.17, 0.5],
  route: around(0.5),
  walkableRoof: false,
  notes: [],
});

regJ(260, 'gasBottle', 'Plynová láhev', {
  describe: () => 'výška 1,2 m, Ø 0,3 m, zaoblená ramena, ochranný límec, spodní patka',
  generate() {
    return [cyl(0, 0, 0.08, 0, 0.28, 'paintedMetal'), cyl(0, 0.08, 1.0, 0, 0.3, 'paintedMetalRed', true), { shape: 'blob', pos: [0, 1.0, 0], size: [0.3, 0.16, 0.3], material: 'paintedMetalRed', seed: 1, rough: 0, detail: 1 }, cyl(0, 1.05, 1.18, 0, 0.17, 'paintedMetal'), cyl(0, 1.05, 1.1, 0, 0.06, 'metal'), cyl(0, 1.1, 1.2, 0, 0.04, 'metal')];
  },
}, {
  target: [0.3, 0.3, 1.2],
  route: around(0.5),
  walkableRoof: false,
  notes: [],
});

regJ(261, 'sack', 'Pytel s moukou / cementem', {
  describe: () => '0,6 × 0,4 × 0,2 m, měkký stlačený tvar, přehnuté konce, bez značek',
  generate(_p, seed) {
    return [{ shape: 'box', pos: [0, 0.08, 0], size: [0.52, 0.12, 0.34], material: 'fabricSand', collide: true }, { shape: 'blob', pos: [0, 0.1, 0], size: [0.6, 0.2, 0.4], material: 'fabricSand', seed, rough: 0.1, detail: 1 }, bx(0.24, 0.31, 0.05, 0.13, -0.17, 0.17, 'fabricSand', false), bx(-0.31, -0.24, 0.05, 0.13, -0.17, 0.17, 'fabricSand', false)];
  },
}, {
  target: [0.62, 0.4, 0.2],
  route: around(0.5),
  walkableRoof: false,
  notes: [],
});

// ---------------------------------------------------------------------------
// J262–J270 Nábytek
// ---------------------------------------------------------------------------
regJ(262, 'tableWood', 'Dřevěný stůl', {
  describe: () => 'deska 1,4 × 0,8 m ve 0,75 m, 4 nohy, obvodová luby',
  generate() {
    const parts: Part[] = [bx(-0.7, 0.7, 0.71, 0.75, -0.4, 0.4, WOOD)];
    for (const x of [-0.64, 0.64]) for (const z of [-0.34, 0.34]) parts.push(bx(x - 0.03, x + 0.03, 0, 0.71, z - 0.03, z + 0.03, DARKW));
    parts.push(bx(-0.62, 0.62, 0.62, 0.71, -0.34, -0.32, DARKW, false), bx(-0.62, 0.62, 0.62, 0.71, 0.32, 0.34, DARKW, false));
    return parts;
  },
}, {
  target: [1.4, 0.8, 0.75],
  route: around(1.0),
  walkableRoof: false,
  rays: [thru(0, 0.3, false, 'pod stolem průstřel', -1, 1)],
  notes: [],
});

regJ(263, 'chairWood', 'Dřevěná židle', {
  describe: () => 'sedák ve 0,45 m, výška 0,9 m, opěradlo ze 3 příček',
  generate() {
    const parts: Part[] = [bx(-0.21, 0.21, 0.42, 0.45, -0.2, 0.2, WOOD)];
    for (const x of [-0.18, 0.18]) {
      for (const z of [-0.17, 0.17]) parts.push(bx(x - 0.02, x + 0.02, 0, 0.42, z - 0.02, z + 0.02, DARKW, false));
      parts.push(bx(x - 0.02, x + 0.02, 0.45, 0.9, 0.15, 0.19, DARKW, false));
    }
    for (const y of [0.6, 0.72, 0.84]) parts.push(bx(-0.17, 0.17, y - 0.025, y + 0.025, 0.155, 0.185, WOOD, false));
    parts.push({ ...bx(-0.21, 0.21, 0, 0.45, -0.2, 0.2, WOOD), render: false, moveOnly: true });
    return parts;
  },
}, {
  target: [0.42, 0.4, 0.9],
  route: around(0.5),
  walkableRoof: false,
  notes: [],
});

regJ(264, 'chairPlastic', 'Plastová židle', {
  describe: () => 'skořepina (sedák + prohnuté opěradlo se 2 velkými otvory), 4 nohy',
  generate() {
    const mat = 'plasterWhite', parts: Part[] = [{ shape: 'box', pos: [0, 0.44, 0], rot: [0.05, 0, 0], size: [0.44, 0.04, 0.42], material: mat }];
    for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]] as const) parts.push(beam([x * 1.15, 0, z * 1.15], [x, 0.43, z], 0.04, mat));
    // Opěradlo: dva sloupky + dvě vodorovné části (mezi nimi velké otvory), prohnuté dozadu.
    for (const x of [-0.19, 0.19]) parts.push({ shape: 'box', pos: [x, 0.66, 0.24], rot: [-0.18, 0, 0], size: [0.06, 0.44, 0.03], material: mat });
    for (const y of [0.56, 0.84]) parts.push({ shape: 'box', pos: [0, y, 0.22 + (y - 0.56) * 0.18], rot: [-0.18, 0, 0], size: [0.44, 0.09, 0.03], material: mat });
    parts.push({ ...bx(-0.22, 0.22, 0, 0.46, -0.21, 0.21, mat), render: false, moveOnly: true });
    return parts;
  },
}, {
  target: [0.48, 0.48, 0.9],
  route: around(0.5),
  walkableRoof: false,
  notes: [],
});

regJ(265, 'shelfMetal', 'Kovový regál', {
  describe: () => '1,5 × 0,5 × 2 m, 5 polic, 4 nosné sloupky (úhelníky), bez šroubů',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    for (const x of [-0.73, 0.73]) for (const z of [-0.23, 0.23]) parts.push(bx(x - 0.02, x + 0.02, 0, 2.0, z - 0.02, z + 0.02, 'metal'));
    for (let i = 0; i < 5; i++) {
      const y = 0.1 + i * 0.45;
      parts.push(bx(-0.75, 0.75, y - 0.015, y + 0.015, -0.25, 0.25, 'metal', i === 0 || i === 4));
      if (i < 4 && r() < 0.7) parts.push(bx(-0.5 + r() * 0.5, -0.1 + r() * 0.5, y + 0.015, y + 0.2 + r() * 0.15, -0.18, 0.18, ['crateFruitA', 'wood', 'paintedMetalBlue'][Math.floor(r() * 3)], false));
    }
    parts.push({ ...bx(-0.75, 0.75, 0, 2.0, -0.25, 0.25, 'metal'), render: false, moveOnly: true });
    return parts;
  },
}, {
  target: [1.5, 0.5, 2.0],
  route: around(1.0),
  walkableRoof: false,
  rays: [thru(0, 1.3, false, 'regál střelu propustí (mezi policemi)', -1, 1)],
  notes: ['Kolize pro pohyb celý objem, pro střely jen spodní a horní police.'],
});

regJ(266, 'wardrobe', 'Dřevěná skříň', {
  describe: () => '1,2 × 0,6 × 1,9 m, pravé křídlo otevřené (~100°), uvnitř 3 police',
  generate() {
    const W = 1.2, D = 0.6, H = 1.9, t = 0.025, parts: Part[] = [];
    parts.push(bx(-W / 2, W / 2, 0, 0.08, -D / 2, D / 2, DARKW), bx(-W / 2, W / 2, H - t, H, -D / 2, D / 2, WOOD), bx(-W / 2, W / 2, 0.08, H - t, D / 2 - t, D / 2, WOOD));
    parts.push(bx(-W / 2, -W / 2 + t, 0.08, H - t, -D / 2, D / 2 - t, WOOD), bx(W / 2 - t, W / 2, 0.08, H - t, -D / 2, D / 2 - t, WOOD));
    for (const y of [0.55, 1.0, 1.45]) parts.push(bx(-W / 2 + t, W / 2 - t, y - 0.012, y + 0.012, -D / 2 + 0.03, D / 2 - t, WOOD, false));
    parts.push(bx(-W / 2 + t, 0, 0.08, H - t, -D / 2, -D / 2 + t, WOOD), bx(-0.06, -0.04, 0.9, 1.1, -D / 2 - 0.02, -D / 2, 'metal', false));
    parts.push({ shape: 'box', pos: [W / 2 + 0.06, (H + 0.08) / 2, -D / 2 - 0.28], rot: [0, -1.75, 0], size: [W / 2 - t, H - 0.12, t], material: WOOD, collide: true });
    return parts;
  },
}, {
  target: [1.75, 0.95, 1.9],
  route: around(1.2),
  walkableRoof: false,
  rays: [thru(-0.3, 1.2, true, 'zavřená polovina kryje', -1, 1)],
  notes: [],
});

regJ(267, 'bed', 'Jednoduchá postel', {
  describe: () => '2 × 0,9 m, nízký kovový rám, matrace 0,15 m, malý polštář',
  generate(_p, seed) {
    const parts: Part[] = [];
    for (const x of [-0.42, 0.42]) parts.push(bx(x - 0.02, x + 0.02, 0.25, 0.3, -1.0, 1.0, 'paintedMetal', false));
    for (const z of [-0.98, 0.98]) parts.push(bx(-0.44, 0.44, 0, z > 0 ? 0.8 : 0.55, z - 0.02, z + 0.02, 'paintedMetal', false));
    for (const x of [-0.42, 0.42]) for (const z of [-0.98, 0.98]) parts.push(bx(x - 0.02, x + 0.02, 0, 0.3, z - 0.02, z + 0.02, 'paintedMetal', false));
    parts.push({ shape: 'blob', pos: [0, 0.37, 0], size: [0.86, 0.16, 1.92], material: 'fabricSand', seed, rough: 0.05, detail: 1 }, bx(-0.42, 0.42, 0.3, 0.42, -0.95, 0.95, 'fabricSand', false));
    parts.push({ shape: 'blob', pos: [0, 0.48, 0.75], size: [0.55, 0.12, 0.32], material: 'plasterWhite', seed: seed + 1, rough: 0.1, detail: 1 });
    parts.push({ ...bx(-0.45, 0.45, 0, 0.45, -1.0, 1.0, 'fabricSand'), render: false });
    return parts;
  },
}, {
  target: [0.9, 2, 0.8],
  route: around(1.2),
  walkableRoof: true,
  notes: [],
});

regJ(268, 'mattressFloor', 'Matrace na zemi', {
  describe: () => '1,9 × 0,9 × 0,15 m, mírně zaoblené a nepravidelné hrany, bez švů',
  generate(_p, seed) {
    return [bx(-0.42, 0.42, 0, 0.12, -0.92, 0.92, 'fabricSand', false), { shape: 'blob', pos: [0, 0.08, 0], rot: [0, 0.05, 0], size: [0.9, 0.15, 1.9], material: 'fabricSand', seed, rough: 0.12, detail: 1 }, { ...bx(-0.45, 0.45, 0, 0.15, -0.95, 0.95, 'fabricSand'), render: false }];
  },
}, {
  target: [0.9, 1.9, 0.15],
  route: [{ p: [0, 0, -1.4] }, { p: [0, 0.15, 0], note: 'přes matraci' }, { p: [0, 0, 1.4] }],
  walkableRoof: true,
  notes: ['Nízká – dá se přejít.'],
});

regJ(269, 'sofa', 'Opotřebovaný gauč', {
  describe: () => '2 × 0,85 × 0,9 m, dva propadlé sedáky, nízké područky, opěradlo; trhliny materiálem',
  generate(_p, seed) {
    const parts: Part[] = [bx(-1, 1, 0.08, 0.38, -0.42, 0.42, 'fabricSand'), bx(-1, 1, 0.38, 0.9, 0.2, 0.42, 'fabricSand')];
    for (const s of [-1, 1]) parts.push(bx(s < 0 ? -1 : 0.86, s < 0 ? -0.86 : 1, 0.38, 0.6, -0.42, 0.2, 'fabricSand'));
    for (const x of [-0.42, 0.42]) parts.push({ shape: 'blob', pos: [x, 0.44, -0.06], rot: [0.04, 0, x * 0.1], size: [0.8, 0.17, 0.56], material: 'fabricSand', seed: seed + Math.round(x * 10), rough: 0.15, detail: 1 });
    for (const x of [-0.5, 0.5]) for (const z of [-0.36, 0.36]) parts.push(cyl(x * 1.8, 0, 0.08, z, 0.06, DARKW));
    return parts;
  },
}, {
  target: [2, 0.85, 0.9],
  route: around(1.3),
  walkableRoof: false,
  rays: [thru(0, 0.6, true, 'kryje vkleče (měkký kryt)', -1, 1)],
  notes: [],
});

regJ(270, 'rugLarge', 'Koberec', {
  describe: () => '2 × 3 m, téměř plochý, jeden roh lehce zvednutý; bez kolize',
  generate() {
    return [bx(-1, 1, 0.003, 0.013, -1.5, 1.2, 'fabricSand', false), { shape: 'box', pos: [0.6, 0.04, 1.33], rot: [-0.35, 0, 0.15], size: [0.8, 0.01, 0.3], material: 'fabricSand' }, bx(-1, 0.2, 0.003, 0.013, 1.2, 1.5, 'fabricSand', false), { ...bx(-0.05, 0.05, 0, 0.01, -0.05, 0.05, 'fabricSand'), render: false, moveOnly: true }];
  },
}, {
  target: [2, 3, 0.1],
  route: [{ p: [0, 0, -2] }, { p: [0, 0, 2], note: 'přes koberec (bez kolize)' }],
  walkableRoof: false,
  notes: ['Bez kolize – nic nezachytí pohyb (formálně 1 cm uprostřed pro editor).'],
});

// ---------------------------------------------------------------------------
// J271–J275 Spotřebiče a suť
// ---------------------------------------------------------------------------
regJ(271, 'fridge', 'Stará lednice', {
  describe: () => '0,65 × 0,65 × 1,65 m, hranaté tělo se zaoblenou horní hranou, madlo, bez log',
  generate() {
    return [bx(-0.325, 0.325, 0.04, 1.58, -0.325, 0.325, 'plasterWhite', true), { shape: 'cylinder', pos: [0, 1.58, 0], rot: [0, 0, Math.PI / 2], size: [0.14, 0.65, 0.65], material: 'plasterWhite' }, bx(-0.3, 0.3, 0, 0.04, -0.3, 0.3, 'gunPolymer', false), bx(-0.326, 0.326, 1.12, 1.13, -0.327, -0.32, 'concreteDark', false), bx(0.22, 0.25, 0.8, 1.4, -0.36, -0.33, 'metal', false)];
  },
}, {
  target: [0.65, 0.68, 1.65],
  route: around(0.7),
  walkableRoof: false,
  rays: [thru(0, 1.2, true, 'kryje', -1, 1)],
  notes: [],
});

regJ(272, 'stove', 'Starý sporák', {
  describe: () => '0,6 × 0,6 × 0,85 m, varná plocha se 4 hořáky, dvířka trouby, 4 velké knoflíky',
  generate() {
    const parts: Part[] = [bx(-0.3, 0.3, 0, 0.85, -0.3, 0.3, 'plasterWhite', true), bx(-0.29, 0.29, 0.85, 0.86, -0.29, 0.29, 'gunMetal', false), bx(-0.25, 0.25, 0.15, 0.6, -0.305, -0.3, 'glass', false), bx(-0.2, 0.2, 0.58, 0.61, -0.33, -0.3, 'metal', false), bx(-0.3, 0.3, 0.66, 0.78, -0.31, -0.3, 'concreteDark', false)];
    for (const x of [-0.14, 0.14]) for (const z of [-0.13, 0.13]) parts.push(cyl(x, 0.86, 0.88, z, x < 0 ? 0.18 : 0.14, 'gunMetal'));
    for (let i = 0; i < 4; i++) parts.push({ shape: 'cylinder', pos: [-0.21 + i * 0.14, 0.72, -0.32], rot: [Math.PI / 2, 0, 0], size: [0.05, 0.03, 0.05], material: 'gunPolymer' });
    return parts;
  },
}, {
  target: [0.6, 0.63, 0.88],
  route: around(0.7),
  walkableRoof: false,
  notes: [],
});

regJ(273, 'crtTv', 'Stará televize', {
  describe: () => '0,6 × 0,45 × 0,5 m, hluboké CRT tělo se zúženou zadní částí, vypouklé sklo, ovládání',
  generate() {
    return [bx(-0.3, 0.3, 0, 0.45, -0.25, 0.05, 'gunPolymer', true), bx(-0.2, 0.2, 0.06, 0.38, 0.05, 0.25, 'gunPolymer', false), { shape: 'blob', pos: [-0.04, 0.24, -0.25], size: [0.42, 0.32, 0.05], material: 'glass', seed: 2, rough: 0, detail: 1 }, bx(0.2, 0.27, 0.08, 0.4, -0.255, -0.25, 'concreteDark', false), cyl(0.235, 0.3, 0.33, -0.26, 0.04, 'metal')];
  },
}, {
  target: [0.6, 0.5, 0.45],
  route: around(0.6),
  walkableRoof: false,
  notes: [],
});

regJ(274, 'radio', 'Stolní rádio', {
  describe: () => '0,35 × 0,15 × 0,22 m, tělo, dva velké ovladače, mřížka reproduktoru materiálem',
  generate() {
    return [bx(-0.175, 0.175, 0, 0.22, -0.075, 0.075, 'woodDark', true), bx(-0.16, 0.0, 0.03, 0.19, -0.077, -0.075, 'chainLink', false), bx(0.02, 0.16, 0.14, 0.19, -0.077, -0.075, 'glass', false),
      { shape: 'cylinder', pos: [0.06, 0.07, -0.085], rot: [Math.PI / 2, 0, 0], size: [0.05, 0.02, 0.05], material: 'metal' }, { shape: 'cylinder', pos: [0.13, 0.07, -0.085], rot: [Math.PI / 2, 0, 0], size: [0.05, 0.02, 0.05], material: 'metal' }];
  },
}, {
  target: [0.35, 0.15, 0.22],
  route: around(0.4),
  walkableRoof: false,
  notes: ['Malé: v editoru postav na stůl (J262) – „Položit na zem“ ho posadí na desku.'],
});

regJ(275, 'debrisInterior', 'Interiérová suť a papíry', {
  describe: () => 'plocha 2 × 2 m, výška do 0,15 m: větší úlomky omítky a cihel, ploché listy papíru; bez kolize',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    for (let i = 0; i < 9; i++) parts.push({ shape: 'box', pos: [(r() - 0.5) * 1.8, 0.04, (r() - 0.5) * 1.8], rot: [(r() - 0.5) * 0.4, r() * 3, (r() - 0.5) * 0.4], size: [0.15 + r() * 0.2, 0.05 + r() * 0.06, 0.1 + r() * 0.15], material: r() < 0.6 ? 'plasterWarm' : 'brick' });
    for (let i = 0; i < 12; i++) parts.push({ shape: 'box', pos: [(r() - 0.5) * 1.9, 0.004 + i * 0.0015, (r() - 0.5) * 1.9], rot: [(r() - 0.5) * 0.06, r() * 3, (r() - 0.5) * 0.06], size: [0.21, 0.002, 0.3], material: 'plasterWhite' });
    parts.push({ shape: 'blob', pos: [0.2, 0.02, -0.3], size: [1.0, 0.05, 0.7], material: 'concreteLight', seed, rough: 0.4, detail: 1 });
    parts.push({ ...bx(-0.05, 0.05, 0, 0.01, -0.05, 0.05, 'concreteDark'), render: false, moveOnly: true });
    return parts;
  },
}, {
  target: [2, 2, 0.15],
  route: [{ p: [0, 0, -1.4] }, { p: [0, 0, 1.4], note: 'přes suť (bez kolize)' }],
  walkableRoof: false,
  notes: ['Bez pohybové kolize (formálně jen 1 cm pro editor).'],
});
