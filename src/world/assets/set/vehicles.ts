import { quatFromEuler, quatMul, rng, rotate, type Q } from '../../../shared/math';
import type { Part } from '../../parts';
import { bx, rubble } from './modules';
import { beam, eulerYX } from './industrial';
import { reg, type SetMeta } from './residential';

/**
 * Sada 300 · H Vraky vozidel (položky 191–210). Délka vozidla podél Z, předek −Z (jako pilot
 * wreck_pickup_a), pivot = střed půdorysu u země. Bez značek, log a registračních údajů.
 * Okna jsou prázdné otvory (průstřel); karoserie dole je kryt. Kolize zjednodušené (kvádry),
 * drobné díly (zrcátka, výfuky, rotory) bez kolize.
 */
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regH = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, 'H');
const BURNT = 'burntMetal';
const DARK = 'concreteDark';
const RUST = 'metalSheetRust';
const PAINTS = ['paintedMetalBlue', 'paintedMetalRed', 'plasterWhite', 'paintedMetal', 'containerSand'];

// ---------------------------------------------------------------------------
// Tuhá transformace dílů (převrácení, položení na bok)
// ---------------------------------------------------------------------------
/** Kvaternion → Eulerovy úhly XYZ (jako Three.js / quatFromEuler). */
function eulerOf(q: Q): V3 {
  const { x, y, z, w } = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x), m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), ey, 0];
}

/** Otočí díly kolem počátku (euler XYZ) a posune; nakonec je postaví nejnižším bodem na zem. */
function pose(parts: Part[], rot: V3, shift: V3 = [0, 0, 0], ground = true): Part[] {
  const q = quatFromEuler(rot[0], rot[1], rot[2]);
  const out = parts.map((p) => {
    const v = rotate(q, { x: p.pos[0], y: p.pos[1], z: p.pos[2] });
    const pq = p.rot ? quatFromEuler(p.rot[0], p.rot[1], p.rot[2]) : { x: 0, y: 0, z: 0, w: 1 };
    return { ...p, pos: [v.x + shift[0], v.y + shift[1], v.z + shift[2]] as V3, rot: eulerOf(quatMul(q, pq)) };
  });
  if (!ground) return out;
  // Nejnižší bod (rohy kvádrů po natočení) → y = 0.
  let minY = Infinity;
  for (const p of out) {
    const pq = quatFromEuler(p.rot![0], p.rot![1], p.rot![2]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const c = rotate(pq, { x: (sx * p.size[0]) / 2, y: (sy * p.size[1]) / 2, z: (sz * p.size[2]) / 2 });
      if (p.collide) minY = Math.min(minY, p.pos[1] + c.y);
    }
  }
  return out.map((p) => ({ ...p, pos: [p.pos[0], p.pos[1] - minY, p.pos[2]] as V3 }));
}

/** Kolo s osou X (pneumatika + ráfek); `burnt` = jen ráfek, `flat` = splasklé. */
function wheel(x: number, y: number, z: number, r: number, w: number, o: { burnt?: boolean; flat?: boolean; steer?: number } = {}): Part[] {
  const rot = eulerYX(Math.PI / 2 + (o.steer ?? 0), Math.PI / 2);
  const parts: Part[] = [];
  if (!o.burnt) parts.push({ shape: 'cylinder', pos: [x, o.flat ? y - 0.06 : y, z], rot, size: [2 * r, w, o.flat ? 2 * r * 0.85 : 2 * r], material: 'rubber' });
  parts.push({ shape: 'cylinder', pos: [x + Math.sign(x) * 0.01, o.flat ? y - 0.06 : o.burnt ? y - 0.08 : y, z], rot, size: [2 * r * 0.6, w + 0.02, 2 * r * 0.6], material: o.burnt ? BURNT : 'metal' });
  return parts;
}

// ---------------------------------------------------------------------------
// Osobní auta (sedan, malé auto)
// ---------------------------------------------------------------------------
interface CarSpec {
  L: number; W: number; belt: number; roof: number; bottom: number;
  hoodL: number; trunkL: number; wheelR: number; wheelbase: number;
  color: string; burnt?: boolean; flatTire?: number; missingDoor?: boolean; crumple?: number; steer?: number; roofDent?: boolean; hatch?: boolean; hoodUp?: boolean;
}

/** Karoserie osobního auta: skořepina (vzhled) + 1 kolizní kvádr spodku, sloupky a střecha. */
function car(s: CarSpec, seed: number): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const hw = s.W / 2, z0 = -s.L / 2 + (s.crumple ?? 0), z1 = s.L / 2;
  const mat = s.burnt ? BURNT : s.color;
  const lb = s.bottom, ub = s.belt;
  // Spodek (kolize) a skořepina: boky, čela, podlaha, tmavý interiér pod linií oken.
  parts.push({ ...bx(-hw, hw, lb, ub, z0, z1, mat), render: false });
  parts.push(bx(-hw, -hw + 0.05, lb, ub, z0, z1, mat, false), bx(hw - 0.05, hw, lb, ub, z0, z1, mat, false));
  parts.push(bx(-hw, hw, lb, ub, z0, z0 + 0.06, mat, false), bx(-hw, hw, lb, ub, z1 - 0.06, z1, mat, false));
  parts.push(bx(-hw + 0.05, hw - 0.05, lb, lb + 0.05, z0, z1, DARK, false));
  const cz0 = z0 + s.hoodL, cz1 = z1 - s.trunkL; // kabina
  parts.push(bx(-hw + 0.05, hw - 0.05, ub - 0.35, ub - 0.3, cz0, cz1, DARK, false));
  // Kapota a kufr (desky navrch), u ohořelého zdeformovaná kapota.
  const hoodTilt = s.hoodUp ? -0.35 : (s.crumple ? -0.25 : 0);
  parts.push({ shape: 'box', pos: [0, ub + 0.03 + (s.hoodUp ? 0.12 : 0), (z0 + cz0) / 2], rot: [hoodTilt + (s.burnt ? (r() - 0.5) * 0.1 : 0), 0, s.burnt ? (r() - 0.5) * 0.06 : 0], size: [s.W - 0.06, 0.05, s.hoodL - 0.02], material: mat });
  if (!s.hatch) parts.push(bx(-hw + 0.03, hw - 0.03, ub, ub + 0.05, cz1, z1, mat, false));
  // Sloupky A/B/C a střecha (průstřelná okna = otvory).
  const rz0 = cz0 + 0.55, rz1 = s.hatch ? z1 - 0.08 : cz1 - 0.4;
  const roofY = s.roof - (s.roofDent ? 0.12 : 0);
  for (const x of [-hw + 0.08, hw - 0.08]) {
    parts.push(beam([x, ub, cz0], [x * 0.97, roofY, rz0], 0.08, mat, true));
    parts.push(beam([x, ub, (rz0 + rz1) / 2], [x * 0.97, roofY, (rz0 + rz1) / 2], 0.08, mat, true));
    parts.push(beam([x, ub, s.hatch ? z1 - 0.05 : cz1], [x * 0.97, roofY, rz1], 0.1, mat, true));
  }
  parts.push({ shape: 'box', pos: [0, roofY - 0.03, (rz0 + rz1) / 2], rot: [s.roofDent ? 0.06 : 0, 0, 0], size: [s.W - 0.14, 0.06, rz1 - rz0 + 0.06], material: mat, collide: true });
  if (s.roofDent) parts.push({ shape: 'box', pos: [0.2, roofY - 0.08, (rz0 + rz1) / 2 + 0.2], rot: [0.2, 0, 0.15], size: [0.8, 0.04, 0.7], material: mat });
  // Sedadla (opěradla nad linií oken), volant.
  const seat = s.burnt ? 'gunMetal' : 'fabricSand';
  for (const x of [-hw * 0.48, hw * 0.48]) parts.push(bx(x - 0.24, x + 0.24, ub - 0.3, ub + 0.25, (cz0 + rz0) / 2 + 0.35, (cz0 + rz0) / 2 + 0.45, seat, false));
  parts.push(bx(-hw + 0.15, hw - 0.15, ub - 0.3, ub + 0.2, cz1 - 0.15, cz1 - 0.05, seat, false));
  parts.push({ shape: 'cylinder', pos: [-hw * 0.48, ub + 0.08, cz0 + 0.2], rot: [-1.1, 0, 0], size: [0.36, 0.04, 0.36], material: 'gunMetal' });
  // Chybějící přední dveře vlevo (+X): v boku otvor (vzhled), dveře leží vedle.
  if (s.missingDoor) {
    parts.push(bx(hw - 0.06, hw + 0.002, lb + 0.1, ub - 0.02, cz0 + 0.05, cz0 + 1.0, DARK, false));
    parts.push({ shape: 'box', pos: [hw + 0.9, 0.04, cz0 + 0.6], rot: [Math.PI / 2, 0.3, 0], size: [1.0, 0.95, 0.05], material: mat });
  }
  // Nárazníky, světla (prázdné), kola.
  parts.push(bx(-hw - 0.02, hw + 0.02, lb + 0.05, lb + 0.25, z0 - 0.06, z0, s.burnt ? BURNT : 'gunPolymer', false), bx(-hw - 0.02, hw + 0.02, lb + 0.05, lb + 0.25, z1, z1 + 0.06, s.burnt ? BURNT : 'gunPolymer', false));
  for (const x of [-hw + 0.25, hw - 0.25]) parts.push(bx(x - 0.18, x + 0.18, ub - 0.18, ub - 0.06, z0 - 0.005, z0, DARK, false), bx(x - 0.15, x + 0.15, ub - 0.18, ub - 0.06, z1, z1 + 0.005, s.burnt ? DARK : 'paintedMetalRed', false));
  if (s.crumple) {
    // Zmačkaná příď: zvlněné plechy vpředu, motorový prostor odkrytý.
    for (let i = 0; i < 3; i++) parts.push({ shape: 'box', pos: [(r() - 0.5) * 0.6, ub - 0.1 + i * 0.08, z0 + 0.1 + i * 0.12], rot: [0.5 + r() * 0.4, (r() - 0.5) * 0.4, (r() - 0.5) * 0.4], size: [s.W * 0.7, 0.04, 0.5], material: mat });
  }
  const wf = z0 + (s.L - (s.crumple ?? 0) - s.wheelbase) / 2 + (s.crumple ?? 0) * 0.3, wr = wf + s.wheelbase - (s.crumple ?? 0) * 0.3;
  for (const [i, z] of [[0, wf], [1, wr]] as const) for (const [k, x] of [[0, -hw + 0.12], [1, hw - 0.12]] as const)
    parts.push(...wheel(x, s.wheelR + (s.burnt ? 0 : 0), z, s.wheelR, 0.2, { burnt: s.burnt, flat: s.flatTire === i * 2 + k, steer: i === 0 && k === 1 ? s.steer : 0 }));
  // Podvozek: výfuk a nápravy (vidět u převráceného).
  parts.push({ shape: 'cylinder', pos: [hw * 0.4, lb - 0.05, (z0 + z1) / 2], rot: [Math.PI / 2, 0, 0], size: [0.07, s.L * 0.7, 0.07], material: s.burnt ? BURNT : 'metal' });
  parts.push(bx(-hw + 0.3, hw - 0.3, lb - 0.12, lb, wf - 0.1, wf + 0.1, DARK, false), bx(-hw + 0.3, hw - 0.3, lb - 0.12, lb, wr - 0.1, wr + 0.1, DARK, false));
  parts.push(bx(-0.2, 0.2, lb - 0.1, lb, z0 + 0.3, z1 - 0.3, DARK, false));
  if (s.burnt) parts.push(...rubble(0, 0, 3, [s.W, s.L * 0.6], seed, 0.2).map((p) => ({ ...p, material: DARK })));
  return parts;
}

const SEDAN = (color: string): CarSpec => ({ L: 4.5, W: 1.8, belt: 0.88, roof: 1.42, bottom: 0.3, hoodL: 1.25, trunkL: 0.95, wheelR: 0.31, wheelbase: 2.65, color });
const SMALL = (color: string): CarSpec => ({ L: 3.5, W: 1.62, belt: 0.86, roof: 1.45, bottom: 0.28, hoodL: 0.75, trunkL: 0.15, wheelR: 0.28, wheelbase: 2.3, color, hatch: true });
const color = (seed: number) => PAINTS[seed % PAINTS.length];

const carRays = (W: number, wz = -0.15) => [
  { from: [-W / 2 - 2, 0.6, 0] as V3, to: [0, 0.6, 0] as V3, hit: true, note: 'karoserie kryje vkleče' },
  { from: [-W / 2 - 2, 1.15, wz] as V3, to: [W / 2 + 2, 1.15, wz] as V3, hit: false, note: 'prázdná okna – průstřel kabinou' },
];

regH(191, 'sedanBurnt', 'Ohořelý sedan', {
  describe: () => '4,5 × 1,8 × 1,4 m, ohořelá karoserie bez značek, prázdná okna, sedadla, zdeformovaná kapota, ráfky bez pneumatik',
  generate(_p, seed) {
    return car({ ...SEDAN(BURNT), burnt: true }, seed);
  },
}, {
  target: [4.5, 1.8, 1.4],
  route: [{ p: [-2.2, 0, -3] }, { p: [-2.2, 0, 3], note: 'podél vraku' }],
  walkableRoof: false,
  rays: carRays(1.8),
  notes: ['Saze řešené materiálem burntMetal; vrak je o 8 cm níž na ráfcích.'],
});

regH(192, 'sedanAbandoned', 'Opuštěný sedan', {
  describe: () => '4,5 × 1,8 × 1,4 m, zachovalý lak, chybějící přední dveře (leží vedle), prázdná pneumatika, bez log a SPZ',
  generate(_p, seed) {
    return car({ ...SEDAN(color(seed)), missingDoor: true, flatTire: 1 }, seed);
  },
}, {
  target: [4.5, 1.8, 1.4],
  route: [{ p: [-2.2, 0, -3] }, { p: [-2.2, 0, 3] }],
  walkableRoof: false,
  rays: carRays(1.8),
  notes: ['Barva laku podle semínka (5 generických odstínů).'],
});

regH(193, 'sedanFlipped', 'Převrácený sedan', {
  describe: () => 'sedan na střeše, viditelný hrubý podvozek, nápravy a výfuk',
  generate(_p, seed) {
    return pose(car({ ...SEDAN(color(seed + 1)), roofDent: true }, seed), [0, 0, Math.PI]);
  },
}, {
  target: [4.5, 1.8, 1.4],
  route: [{ p: [-2.2, 0, -3] }, { p: [-2.2, 0, 3] }],
  walkableRoof: false,
  rays: [{ from: [-3, 0.9, 0], to: [0, 0.9, 0], hit: true, note: 'převrácená karoserie kryje' }],
  notes: ['Kolize se otáčí s vozem (střecha dole, spodek nahoře).'],
});

regH(194, 'smallBurnt', 'Ohořelé malé auto', {
  describe: () => 'délka 3,5 m, krátká kapota, téměř svislá záď, otevřené okenní otvory, promáčknutá střecha',
  generate(_p, seed) {
    return car({ ...SMALL(BURNT), burnt: true, roofDent: true }, seed);
  },
}, {
  target: [3.5, 1.62, 1.45],
  route: [{ p: [-2.0, 0, -2.5] }, { p: [-2.0, 0, 2.5] }],
  walkableRoof: false,
  rays: carRays(1.62, 0.45),
  notes: [],
});

regH(195, 'smallCrashed', 'Havarované malé auto', {
  describe: () => 'malé auto 3,5 m se stlačenou přídí (−0,6 m), zadní část zachovalá, vychýlené přední kolo',
  generate(_p, seed) {
    return car({ ...SMALL(color(seed + 2)), crumple: 0.6, steer: 0.35, hoodUp: true }, seed);
  },
}, {
  target: [2.9, 1.62, 1.45],
  route: [{ p: [-2.0, 0, -2.5] }, { p: [-2.0, 0, 2.5] }],
  walkableRoof: false,
  rays: carRays(1.62, 0.45),
  notes: ['Zavěšení nemodelováno; kolo jen natočené.'],
});

// ---------------------------------------------------------------------------
// Pickupy (H196 podle pilotu wreck_pickup_a), dodávky
// ---------------------------------------------------------------------------
function pickup(seed: number, o: { bed: boolean; burnt: boolean }): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const W = 1.85, hw = W / 2, mat = o.burnt ? BURNT : color(seed);
  // Rám a spodek (kolize podle pilotu: 1,85 × 0,8 × 4,55 m).
  parts.push({ ...bx(-hw, hw, 0, 0.8, -2.28, 2.27, mat), render: false });
  for (const x of [-0.45, 0.45]) parts.push(bx(x - 0.07, x + 0.07, 0.38, 0.56, -2.2, 2.3, DARK, false));
  // Kapota a motorový prostor vpředu (−Z), zdeformovaná.
  parts.push(bx(-hw, hw, 0.5, 1.0, -2.3, -0.85, mat, false));
  parts.push({ shape: 'box', pos: [0, 1.06, -1.56], rot: [-0.08 + (r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08], size: [1.76, 0.06, 1.25], material: mat, collide: true });
  // Otevřená kabina: boky do 1,25 m, sloupky, střecha 1,91 m, bez dveří a oken.
  parts.push(bx(-hw, -hw + 0.05, 0.5, 1.25, -0.85, 0.45, mat, false), bx(hw - 0.05, hw, 0.5, 1.25, -0.85, 0.45, mat, false));
  for (const x of [-hw + 0.06, hw - 0.06]) {
    parts.push(beam([x, 1.2, -0.85], [x, 1.88, -0.55], 0.08, mat, true), beam([x, 1.2, 0.4], [x, 1.88, 0.35], 0.09, mat, true));
  }
  parts.push({ ...bx(-0.78, 0.78, 1.87, 1.95, -0.65, 0.43, mat), collide: true });
  parts.push(bx(-hw + 0.05, hw - 0.05, 0.55, 1.6, 0.38, 0.46, mat, false));
  for (const x of [-0.45, 0.45]) parts.push(bx(x - 0.25, x + 0.25, 0.6, 1.25, 0.0, 0.12, o.burnt ? 'gunMetal' : 'fabricSand', false));
  parts.push({ shape: 'cylinder', pos: [-0.45, 1.25, -0.55], rot: [-1.1, 0, 0], size: [0.36, 0.04, 0.36], material: 'gunMetal' });
  if (o.bed) {
    // Korba 1,8 m: bočnice a víko (pilotní kolize), podlaha.
    parts.push(bx(-hw, -hw + 0.08, 0.76, 1.28, 0.45, 2.2, mat), bx(hw - 0.08, hw, 0.76, 1.28, 0.45, 2.2, mat), bx(-hw, hw, 0.76, 1.28, 2.12, 2.2, mat));
    parts.push(bx(-hw + 0.08, hw - 0.08, 0.76, 0.8, 0.45, 2.12, o.burnt ? RUST : DARK, false));
    if (o.burnt) parts.push({ shape: 'box', pos: [0.3, 0.86, 1.4], rot: [0.1, 0.5, 0.05], size: [0.6, 0.12, 0.4], material: RUST });
  } else {
    // Bez korby: odkrytý zadní rám, zadní náprava, nádrž.
    parts.push(bx(-0.6, 0.6, 0.42, 0.5, 1.55, 1.65, DARK, false), { shape: 'cylinder', pos: [0, 0.38, 1.6], rot: [0, 0, Math.PI / 2], size: [0.1, 1.6, 0.1], material: DARK });
    parts.push(bx(-0.35, 0.35, 0.4, 0.62, 0.8, 1.2, 'gunMetal', false), bx(-0.55, 0.55, 0.5, 0.56, 2.15, 2.25, DARK, false));
  }
  for (const z of [-1.5, 1.6]) for (const x of [-hw + 0.1, hw - 0.1]) parts.push(...wheel(x, 0.36, z, 0.38, 0.24, { burnt: o.burnt }));
  parts.push(bx(-hw - 0.02, hw + 0.02, 0.4, 0.62, -2.36, -2.28, o.burnt ? BURNT : 'metal', false));
  return parts;
}

regH(196, 'pickupBurnt', 'Ohořelý pickup (pilot)', {
  describe: () => '4,6 × 1,9 × 1,95 m, otevřená kabina bez dveří a oken, korba 1,8 m, ohořelý, zdeformovaná kapota',
  generate(_p, seed) {
    return pickup(seed, { bed: true, burnt: true });
  },
}, {
  target: [2.36, 4.73, 1.985],
  route: [{ p: [-1.8, 0, -3] }, { p: [-1.8, 0, 3] }],
  walkableRoof: false,
  rays: [{ from: [-3, 0.6, 1.3], to: [0, 0.6, 1.3], hit: true, note: 'korba kryje' }, { from: [-3, 1.5, -0.2], to: [3, 1.5, -0.2], hit: false, note: 'otevřená kabina průstřelná' }],
  notes: ['Podle pilotu wreck_pickup_a: rozměry a kolize (spodek 1,85 × 0,8 × 4,55 m, střecha 1,91 m, bočnice korby). Úprava: čitelnější deformace kapoty, sloupky kabiny, sedadla, ráfky bez pneumatik.'],
});

regH(197, 'pickupNoBed', 'Pickup bez korby', {
  describe: () => 'zachovaná kabina, odkrytý zadní rám (2 podélníky), zadní náprava a kola, bez detailního motoru',
  generate(_p, seed) {
    return pickup(seed + 3, { bed: false, burnt: false });
  },
}, {
  target: [1.9, 4.6, 1.95],
  route: [{ p: [-1.8, 0, -3] }, { p: [-1.8, 0, 3] }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.0, 1.4], to: [3, 1.0, 1.4], hit: false, note: 'nad rámem volno' }],
  notes: ['Kolize spodku: jeden kvádr 0,8 m po celé délce (rám a kola kryjí vleže).'],
});

function van(seed: number, o: { burnt: boolean }): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const W = 2.0, hw = W / 2, L = 5.0, H = 2.3, z0 = -L / 2, z1 = L / 2, mat = o.burnt ? BURNT : color(seed);
  const floor = 0.55, t = 0.05;
  // Kolize: spodek do podlahy + boky, střecha, kabina vpředu (prostor uvnitř prázdný).
  parts.push(bx(-hw, hw, 0.3, floor, z0, z1, mat));
  parts.push(bx(-hw, -hw + t, floor, H - 0.05, z0 + 1.2, z1, mat), bx(hw - t, hw, floor, H - 0.05, z0 + 1.2, z1, mat));
  parts.push(bx(-hw + t, hw - t, floor, H - 0.6, z0 + 1.2, z0 + 1.27, mat));
  // Kabina: čelo s prázdným oknem, nízká kapota, sloupky.
  parts.push(bx(-hw, hw, floor, 1.1, z0, z0 + 1.2, mat), { shape: 'box', pos: [0, 1.05, z0 + 0.25], rot: [-0.3, 0, 0], size: [W, 0.05, 0.6], material: mat });
  for (const x of [-hw + 0.05, hw - 0.05]) parts.push(beam([x, 1.1, z0 + 0.45], [x, H - 0.05, z0 + 1.0], 0.09, mat, true), beam([x, 1.1, z0 + 1.2], [x, H - 0.05, z0 + 1.2], 0.08, mat, true));
  // Střecha: zadní část propadlá (dvě desky, jedna nakloněná dovnitř).
  parts.push(bx(-hw, hw, H - 0.05, H, z0 + 1.0, z0 + 3.0, mat));
  parts.push({ shape: 'box', pos: [0, H - 0.3, z0 + 4.0], rot: [0.32, 0, 0.12], size: [W - 0.1, 0.05, 1.9], material: mat, collide: true });
  parts.push(bx(-hw + 0.05, hw - 0.05, floor, floor + 0.03, z0 + 1.27, z1, o.burnt ? RUST : DARK, false));
  // Zadní dveře otevřené o 90° ven (do stran).
  for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [s * (hw + 0.47), (floor + H - 0.1) / 2, z1 + 0.04], rot: [0, s * 0.15, 0], size: [0.95, H - 0.1 - floor, 0.05], material: mat, collide: true });
  for (const x of [-0.45, 0.45]) parts.push(bx(x - 0.24, x + 0.24, floor, 1.45, z0 + 0.95, z0 + 1.05, o.burnt ? 'gunMetal' : 'fabricSand', false));
  for (const z of [z0 + 0.8, z1 - 0.9]) for (const x of [-hw + 0.12, hw - 0.12]) parts.push(...wheel(x, 0.34, z, 0.34, 0.22, { burnt: o.burnt }));
  if (o.burnt) for (let i = 0; i < 3; i++) parts.push({ shape: 'box', pos: [(r() - 0.5) * 1.2, floor + 0.08, z0 + 2.4 + r() * 1.6], rot: [0, r() * 3, 0.1], size: [0.5, 0.15, 0.4], material: RUST });
  return parts;
}

regH(198, 'vanBurnt', 'Ohořelá dodávka', {
  describe: () => '5 × 2 × 2,3 m, prázdný nákladový prostor, otevřené zadní dveře, propadlá zadní část střechy',
  generate(_p, seed) {
    return van(seed, { burnt: true });
  },
}, {
  target: [3.0, 5.1, 2.3],
  route: [{ p: [-2.4, 0, -3] }, { p: [-2.4, 0, 3.6] }, { p: [0, 0, 3.6], note: 'za otevřenými dveřmi' }],
  walkableRoof: false,
  rays: [{ from: [0, 1.3, 5], to: [0, 1.3, -1.0], hit: false, note: 'otevřenými dveřmi do nákladového prostoru' }, { from: [-3, 1.3, 0.5], to: [0, 1.3, 0.5], hit: true, note: 'bok dodávky kryje' }],
  notes: ['Podlaha nákladového prostoru 0,55 m – vylézt se dá skokem; uvnitř se dá krýt.'],
});

regH(199, 'vanSide', 'Převrácená dodávka', {
  describe: () => 'dodávka na boku, odhalený podvozek, velký otvor (propadlá střecha) do nákladového prostoru',
  generate(_p, seed) {
    return pose(van(seed + 1, { burnt: true }), [0, 0, Math.PI / 2]);
  },
}, {
  target: [2.3, 5.1, 2.0],
  route: [{ p: [-2.2, 0, -3] }, { p: [-2.2, 0, 3.4] }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.0, 0], to: [0, 1.0, 0], hit: true, note: 'položená karoserie kryje' }],
  notes: ['Kolize se otáčí s vozem (bok na zemi).'],
});

// ---------------------------------------------------------------------------
// Autobus (průchozí)
// ---------------------------------------------------------------------------
regH(200, 'busWalkthrough', 'Průchozí autobus', {
  describe: () => '10 × 2,5 × 3 m, chybějící přední a zadní dveře, schody 2 × 0,2 m, ulička 0,9 m, zbylá sedadla, prázdná okna',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    const W = 2.5, hw = W / 2, L = 10, z0 = -L / 2, z1 = L / 2, floor = 0.6, roof = 2.85, mat = 'containerSand';
    parts.push(bx(-hw, hw, 0.35, floor, z0, z1, mat), bx(-hw + 0.05, hw - 0.05, floor, floor + 0.02, z0, z1, 'rubber', false));
    // Boky: spodní plech do 1,3 m (kryt), sloupky po 1,25 m, okna prázdná; dveře na pravém boku (−X).
    const doors: [number, number][] = [[z0 + 0.3, z0 + 1.4], [z1 - 3.4, z1 - 2.3]];
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -hw : hw - 0.06, x1 = s < 0 ? -hw + 0.06 : hw;
      let cur = z0;
      for (const [a, b] of s < 0 ? doors : []) {
        parts.push(bx(x0, x1, floor, 1.3, cur, a, mat));
        cur = b;
      }
      parts.push(bx(x0, x1, floor, 1.3, cur, z1, mat));
      for (let z = z0 + 0.05; z <= z1; z += 1.25) if (!(s < 0 && doors.some(([a, b]) => z > a - 0.05 && z < b + 0.05))) parts.push(bx(x0, x1, 1.3, roof, z - 0.05, z + 0.05, mat, false));
    }
    parts.push(bx(-hw, hw, roof, roof + 0.12, z0, z1, mat), bx(-hw, hw, 1.3, roof, z1 - 0.06, z1, mat, false), bx(-hw, hw, floor, 1.2, z1 - 0.06, z1, mat), bx(-hw, hw, floor, 1.1, z0, z0 + 0.06, mat));
    // Schody u dveří (venku, 2 × 0,2 m).
    for (const [a, b] of doors) parts.push(bx(-hw - 0.55, -hw, 0, 0.2, a, b, 'metal'), bx(-hw - 0.28, -hw, 0.2, 0.4, a, b, 'metal'));
    // Sedadla: dvojice u levé strany, jednotlivá u pravé, ulička 0,9 m; část chybí.
    for (let z = z0 + 2.0; z < z1 - 0.8; z += 0.85) {
      if (r() < 0.75) parts.push(bx(hw - 0.95, hw - 0.1, floor, floor + 0.45, z - 0.25, z + 0.2, 'fabricSand'), bx(hw - 0.95, hw - 0.1, floor + 0.45, floor + 1.0, z + 0.2, z + 0.28, 'fabricSand', false));
      if (r() < 0.6 && !doors.some(([a, b]) => z > a - 0.6 && z < b + 0.6)) parts.push(bx(-hw + 0.1, -hw + 0.6, floor, floor + 0.45, z - 0.25, z + 0.2, 'fabricSand'), bx(-hw + 0.1, -hw + 0.6, floor + 0.45, floor + 1.0, z + 0.2, z + 0.28, 'fabricSand', false));
    }
    parts.push(bx(-0.9, 0.2, floor, floor + 1.1, z0 + 0.1, z0 + 0.7, 'gunMetal'), { shape: 'cylinder', pos: [-0.35, floor + 1.1, z0 + 0.6], rot: [-0.6, 0, 0], size: [0.5, 0.05, 0.5], material: 'gunMetal' });
    for (const z of [z0 + 2.0, z1 - 2.2]) for (const x of [-hw + 0.15, hw - 0.15]) parts.push(...wheel(x, 0.48, z, 0.5, 0.3, { flat: r() < 0.3 }));
    return parts;
  },
}, {
  target: [2.5, 10, 3],
  route: [
    { p: [-2.3, 0, -4.15], note: 'u předních dveří' },
    { p: [-0.8, 0.6, -4.15], note: 'vstup po schodech' },
    { p: [0.15, 0.6, -2.5] },
    { p: [0.15, 0.6, 1.6], note: 'ulička' },
    { p: [-0.6, 0.6, 2.15] },
    { p: [-2.3, 0, 2.15], note: 'ven zadními dveřmi' },
  ],
  walkableRoof: false,
  rays: [{ from: [3.5, 1.9, 0.6], to: [-3.5, 1.9, 0.6], hit: false, note: 'okny průstřel skrz' }, { from: [3.5, 0.9, 0.6], to: [0, 0.9, 0.6], hit: true, note: 'spodní plech kryje vkleče' }],
  notes: ['Podlaha 0,6 m, schody 0,2 m venku u obou dveří (pravý bok −X). Ulička 0,9 m mezi sedadly.', 'Okenní sloupky bez kolize (okny nelze projít – spodní plech 1,3 m), střecha a boky ano.'],
});

// ---------------------------------------------------------------------------
// Nákladní auta a cisterna
// ---------------------------------------------------------------------------
function truckCab(z0: number, W: number, mat: string, burnt: boolean): Part[] {
  const hw = W / 2, parts: Part[] = [];
  parts.push(bx(-hw, hw, 0.5, 1.5, z0, z0 + 2.0, mat), bx(-hw, hw, 0.5, 1.0, z0 - 0.2, z0, mat, false));
  // Horní část kabiny s prázdnými okny (sloupky), střecha.
  for (const x of [-hw + 0.06, hw - 0.06]) parts.push(beam([x, 1.5, z0 + 0.05], [x, 2.7, z0 + 0.2], 0.1, mat, true), beam([x, 1.5, z0 + 1.95], [x, 2.7, z0 + 1.95], 0.1, mat, true));
  parts.push(bx(-hw, hw, 2.7, 2.85, z0 + 0.15, z0 + 2.0, mat), bx(-hw + 0.06, hw - 0.06, 1.5, 2.7, z0 + 1.9, z0 + 2.0, mat, false));
  for (const x of [-0.5, 0.5]) parts.push(bx(x - 0.25, x + 0.25, 1.5, 2.1, z0 + 1.6, z0 + 1.7, burnt ? 'gunMetal' : 'fabricSand', false));
  parts.push(bx(-hw - 0.03, hw + 0.03, 0.45, 0.75, z0 - 0.3, z0 - 0.2, burnt ? BURNT : 'metal', false));
  return parts;
}
function truckChassis(L: number, W: number, z0: number): Part[] {
  const parts: Part[] = [];
  for (const x of [-0.5, 0.5]) parts.push(bx(x - 0.1, x + 0.1, 0.5, 0.8, z0, z0 + L, DARK, false));
  parts.push({ ...bx(-W / 2, W / 2, 0.2, 0.8, z0, z0 + L, DARK), render: false });
  for (const z of [z0 + 0.9, z0 + L - 1.6, z0 + L - 0.5]) for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) parts.push(...wheel(x, 0.5, z, 0.5, 0.3));
  return parts;
}

function canvasTruck(seed: number, damaged: boolean): Part[] {
  const r = rng(seed), W = 2.4, hw = W / 2, L = 7, z0 = -L / 2, mat = 'containerGreen', parts: Part[] = [];
  parts.push(...truckChassis(L, W, z0), ...truckCab(z0 + 0.2, W, mat, false));
  // Korba 4,6 m: podlaha 1,2 m, bočnice 0,6 m, oblouky a plachta; zadní plachta vyhrnutá.
  const b0 = z0 + 2.3, b1 = z0 + L;
  parts.push(bx(-hw, hw, 0.8, 1.2, b0, b1, 'wood'), bx(-hw, hw, 1.2, 1.8, b0, b0 + 0.08, 'wood'));
  for (const s of [-1, 1]) {
    const fold = damaged && s > 0;
    if (!fold) parts.push(bx(s < 0 ? -hw : hw - 0.06, s < 0 ? -hw + 0.06 : hw, 1.2, 1.8, b0, b1, 'wood'));
    else parts.push({ shape: 'box', pos: [hw + 0.3, 0.95, (b0 + b1) / 2], rot: [0, 0, -1.35], size: [0.06, 0.6, b1 - b0], material: 'wood' });
  }
  const top = 3.1;
  for (let i = 0; i < 5; i++) {
    const z = b0 + 0.15 + (i * (b1 - b0 - 0.3)) / 4;
    for (const s of [-1, 1]) parts.push(bx(s * hw - 0.03, s * hw + 0.03, 1.8, top - 0.1, z - 0.03, z + 0.03, 'paintedMetal', false));
    parts.push(bx(-hw, hw, top - 0.13, top - 0.07, z - 0.03, z + 0.03, 'paintedMetal', false));
  }
  // Plachta: střecha a boky; u poškozené chybí střední úsek (odhalené oblouky) a kus boku.
  const tarp = 'fabricSand';
  const segs: [number, number][] = damaged ? [[b0, b0 + 1.4], [b0 + 3.1, b1 - 0.3]] : [[b0, b1 - 0.3]];
  for (const [a, b] of segs) {
    parts.push({ ...bx(-hw - 0.02, hw + 0.02, top - 0.05, top, a, b, tarp), collide: false });
    for (const s of [-1, 1]) parts.push({ ...bx(s < 0 ? -hw - 0.03 : hw, s < 0 ? -hw : hw + 0.03, 1.8, top - 0.05, a, b, tarp), collide: true, moveOnly: true });
  }
  parts.push({ shape: 'cylinder', pos: [0, top - 0.35, b1 - 0.25], rot: [0, 0, Math.PI / 2], size: [0.3, W, 0.3], material: tarp });
  if (damaged) parts.push({ shape: 'box', pos: [-hw - 0.4, 0.05, b0 + 2.2], rot: [0, 0.3, 0], size: [1.4, 0.05, 1.8], material: tarp }, ...rubble(hw + 0.8, b0 + 3, 2, [0.6, 1.0], seed, 0.3));
  void r;
  return parts;
}

regH(201, 'truckCanvas', 'Nákladní auto s plachtou', {
  describe: () => 'délka 7 m, šířka 2,4 m, kabina s prázdnými okny, korba s plachtou na 5 obloucích, zadní plachta vyhrnutá',
  generate(_p, seed) {
    return canvasTruck(seed, false);
  },
}, {
  target: [2.4, 7, 3.1],
  route: [{ p: [-2.0, 0, -4] }, { p: [-2.0, 0, 4.2], note: 'podél vozu' }, { p: [0, 0, 4.2], note: 'za otevřenou korbou' }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.0, 1.5], to: [0, 1.0, 1.5], hit: true, note: 'rám a korba kryjí' }, { from: [-3, 2.4, 1.5], to: [3, 2.4, 1.5], hit: false, note: 'plachta střelu nezastaví' }],
  notes: ['Plachta: kolize jen pro pohyb; bočnice korby a kabina kryjí.'],
});

regH(202, 'truckCanvasDamaged', 'Nákladní auto s poškozenou plachtou', {
  describe: () => 'nákladní auto 7 m, chybí střední část plachty (odhalené oblouky), bočnice vyklopená ven (+X)',
  generate(_p, seed) {
    return canvasTruck(seed, true);
  },
}, {
  target: [3.3, 7, 3.1],
  route: [{ p: [-2.0, 0, -4] }, { p: [-2.0, 0, 4.2] }],
  walkableRoof: false,
  rays: [{ from: [3, 1.5, 1.7], to: [0, 1.5, 1.7], hit: false, note: 'vyklopená bočnice – korba odkrytá' }],
  notes: ['Vyklopená bočnice leží šikmo podél boku, mimo průchod u druhého boku.'],
});

regH(203, 'tankerTruck', 'Silniční cisterna', {
  describe: () => 'délka 8 m, kabina, válcová nádrž Ø 2,2 × 5,4 m s promáčknutým a protrženým bokem, potrubí a ventily',
  generate(_p, seed) {
    const r = rng(seed), W = 2.4, L = 8, z0 = -L / 2, parts: Part[] = [];
    parts.push(...truckChassis(L, W, z0), ...truckCab(z0 + 0.2, W, 'plasterWhite', false));
    const zc = z0 + 2.4 + 2.7, R = 1.1, yc = 0.85 + R;
    parts.push({ shape: 'cylinder', pos: [0, yc, zc], rot: [Math.PI / 2, 0, 0], size: [2 * R, 5.4, 2 * R], material: 'metal', collide: true });
    for (const s of [-1, 1]) parts.push({ shape: 'cylinder', pos: [0, yc, zc + s * 2.75], rot: [Math.PI / 2, 0, 0], size: [2 * R * 0.85, 0.12, 2 * R * 0.85], material: 'metal' });
    // Promáčklý bok s tmavou trhlinou.
    parts.push({ shape: 'box', pos: [R - 0.05, yc - 0.1, zc + 0.6], rot: [0, 0.1, 0.2], size: [0.06, 0.9, 1.4], material: RUST }, bx(R - 0.02, R + 0.005, yc - 0.3, yc + 0.1, zc + 0.3, zc + 0.9, DARK, false));
    // Lávka nahoře, průlezy, potrubí dole, ventily.
    parts.push(bx(-0.25, 0.25, yc + R, yc + R + 0.04, zc - 2.5, zc + 2.5, 'metal', false));
    for (const z of [-1.6, 0, 1.6]) parts.push({ shape: 'cylinder', pos: [0, yc + R + 0.08, zc + z], size: [0.5, 0.16, 0.5], material: 'metal' });
    parts.push({ shape: 'cylinder', pos: [-0.7, 0.75, zc], rot: [Math.PI / 2, 0, 0], size: [0.16, 5.0, 0.16], material: 'paintedMetal' });
    for (const z of [-1.5, 0.5, 2.2]) parts.push({ shape: 'cylinder', pos: [-0.7, 0.55, zc + z], size: [0.14, 0.4, 0.14], material: 'paintedMetal' }, { shape: 'cylinder', pos: [-0.7, 0.35, zc + z], size: [0.3, 0.06, 0.3], material: 'paintedMetalRed' });
    void r;
    return parts;
  },
}, {
  target: [2.4, 8, 3.0],
  route: [{ p: [-2.0, 0, -4.5] }, { p: [-2.0, 0, 4.5] }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.9, 1.5], to: [0, 1.9, 1.5], hit: true, note: 'nádrž kryje' }],
  notes: ['Nádrž = jeden válcový kolizní tvar; potrubí a ventily vzhled.'],
});

// ---------------------------------------------------------------------------
// Tanky a transportéry (generické, bez funkční výzbroje)
// ---------------------------------------------------------------------------
function tankHull(o: { burnt: boolean; brokenTrack?: boolean; hole?: boolean; seed: number }): Part[] {
  const r = rng(o.seed), parts: Part[] = [];
  const L = 6.8, W = 3.4, hw = W / 2, mat = o.burnt ? BURNT : 'containerGreen';
  // Korba: vana mezi pásy, horní deska (s otvorem po věži), šikmý čelní plát.
  parts.push(bx(-1.15, 1.15, 0.45, 1.25, -L / 2 + 0.6, L / 2, mat));
  const top = 1.25, hr = 1.0;
  if (o.hole) {
    parts.push(bx(-hw + 0.1, hw - 0.1, top, top + 0.15, -L / 2 + 0.9, -hr, mat), bx(-hw + 0.1, hw - 0.1, top, top + 0.15, hr, L / 2, mat), bx(-hw + 0.1, -hr, top, top + 0.15, -hr, hr, mat), bx(hr, hw - 0.1, top, top + 0.15, -hr, hr, mat));
    parts.push({ shape: 'cylinder', pos: [0, top + 0.1, 0], size: [2.1, 0.1, 2.1], material: DARK }, bx(-0.9, 0.9, 0.5, 0.55, -0.9, 0.9, DARK, false));
    for (let i = 0; i < 4; i++) parts.push({ shape: 'box', pos: [(r() - 0.5) * 1.2, 0.7, (r() - 0.5) * 1.2], rot: [r(), r() * 3, r()], size: [0.4, 0.2, 0.3], material: RUST });
  } else parts.push(bx(-hw + 0.1, hw - 0.1, top, top + 0.15, -L / 2 + 0.9, L / 2, mat));
  parts.push({ shape: 'box', pos: [0, 0.95, -L / 2 + 0.55], rot: [0.95, 0, 0], size: [W - 0.2, 0.15, 1.1], material: mat, collide: true });
  parts.push(bx(-hw + 0.1, hw - 0.1, 0.6, top + 0.15, L / 2 - 0.12, L / 2, mat));
  // Pásy (kolize = kvádr), pojezdová kola, blatníky (poškozené).
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.3), broken = o.brokenTrack && s > 0;
    parts.push({ ...bx(x - 0.3, x + 0.3, 0, 1.0, -L / 2 + 0.2, L / 2 - 0.1, 'rubber'), render: false });
    for (let i = 0; i < 6; i++) parts.push({ shape: 'cylinder', pos: [x, 0.42, -L / 2 + 1.0 + i * 0.95], rot: [0, 0, Math.PI / 2], size: [0.72, 0.5, 0.72], material: o.burnt ? BURNT : 'gunMetal' });
    for (const z of [-L / 2 + 0.35, L / 2 - 0.25]) parts.push({ shape: 'cylinder', pos: [x, 0.65, z], rot: [0, 0, Math.PI / 2], size: [0.6, 0.5, 0.6], material: 'gunMetal' });
    if (!broken) {
      parts.push(bx(x - 0.3, x + 0.3, 0, 0.08, -L / 2 + 0.4, L / 2 - 0.3, 'gunMetal', false), bx(x - 0.3, x + 0.3, 0.82, 0.9, -L / 2 + 0.3, L / 2 - 0.2, 'gunMetal', false));
      parts.push({ shape: 'box', pos: [x, 0.5, -L / 2 + 0.25], rot: [0.9, 0, 0], size: [0.6, 0.06, 0.65], material: 'gunMetal' });
    } else {
      // Roztržený pás leží natažený vedle vozu.
      parts.push(bx(x - 0.3, x + 0.3, 0, 0.08, -L / 2 + 2.4, L / 2 - 0.3, 'gunMetal', false));
      parts.push({ shape: 'box', pos: [x + 1.1, 0.04, -L / 2 + 0.4], rot: [0, 0.25, 0], size: [0.6, 0.08, 3.2], material: 'gunMetal' });
    }
    // Blatník: u poškozeného ohnutý / chybí kus.
    if (o.brokenTrack && s > 0) parts.push({ shape: 'box', pos: [x + 0.1, 1.05, -1.0], rot: [0.3, 0, -0.4], size: [0.7, 0.04, 1.6], material: mat });
    else parts.push(bx(x - 0.35, x + 0.35, 1.0, 1.04, -L / 2 + 0.3, L / 2 - 0.1, mat, false));
  }
  return parts;
}
function turret(mat: string): Part[] {
  return [
    { shape: 'cylinder', pos: [0, 0.4, 0], size: [2.2, 0.8, 2.2], material: mat, collide: true },
    bx(-0.9, 0.9, 0.1, 0.75, -1.5, -0.8, mat),
    { shape: 'cylinder', pos: [0, 0.85, 0.3], size: [0.7, 0.18, 0.7], material: mat },
    { shape: 'cylinder', pos: [0, 0.45, -3.3], rot: [Math.PI / 2, 0, 0], size: [0.18, 3.6, 0.18], material: 'gunMetal' },
  ];
}

regH(204, 'tankNoTurret', 'Tank s odtrženou věží', {
  describe: () => 'generický pásový vrak 6,8 × 3,4 m, ohořelá korba se skutečným otvorem po věži (bez interiéru), věž leží vedle',
  generate(_p, seed) {
    const parts = tankHull({ burnt: true, hole: true, seed });
    // Věž vedle korby, překlopená na bok.
    parts.push(...pose(turret(BURNT), [0.35, 1.9, 1.35], [3.7, 0, 1.0]));
    return parts;
  },
}, {
  target: [8, 6.8, 1.4],
  route: [{ p: [-2.6, 0, -4] }, { p: [-2.6, 0, 4], note: 'podél korby' }],
  walkableRoof: true,
  rays: [{ from: [-4, 0.7, 0], to: [0, 0.7, 0], hit: true, note: 'korba a pás kryjí' }],
  notes: ['Otvor po věži Ø 2 m je skutečný (do tmavé vany, bez interiéru); věž leží vedle na boku.'],
});

regH(205, 'tankBrokenTrack', 'Tank s poškozenými pásy', {
  describe: () => 'tank 6,8 m, pravý pás roztržený a ležící vedle, věž odsunutá šikmo na korbě, ohnuté blatníky',
  generate(_p, seed) {
    const parts = tankHull({ burnt: false, brokenTrack: true, seed });
    parts.push(...pose(turret('containerGreen'), [0.06, 0.55, 0.04], [0.35, 1.38, 0.3], false));
    return parts;
  },
}, {
  target: [4.5, 6.8, 2.3],
  route: [{ p: [-2.6, 0, -4] }, { p: [-2.6, 0, 4] }],
  walkableRoof: true,
  rays: [{ from: [-4, 0.7, 0], to: [0, 0.7, 0], hit: true, note: 'korba kryje' }],
  notes: ['Pojezdová kola zjednodušená (6 válců na stranu), pás jako deska.'],
});

function apc(burnt: boolean, seed: number): Part[] {
  const r = rng(seed), L = 7, W = 2.9, hw = W / 2, mat = burnt ? BURNT : 'containerSand', parts: Part[] = [];
  // Hranatá korba s šikmými boky nahoře a šikmou přídí.
  parts.push(bx(-hw, hw, 0.6, 1.6, -L / 2 + 0.9, L / 2, mat));
  for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [s * (hw - 0.22), 1.85, 0.4], rot: [0, 0, -s * 0.45], size: [0.08, 0.6, L - 1.8], material: mat, collide: true });
  parts.push(bx(-hw + 0.45, hw - 0.45, 2.08, 2.16, -L / 2 + 1.4, L / 2, mat));
  parts.push({ shape: 'box', pos: [0, 1.15, -L / 2 + 0.5], rot: [0.75, 0, 0], size: [W - 0.1, 0.1, 1.25], material: mat, collide: true });
  // Otevřený zadní vstup: rampa sklopená k zemi, prázdný prostor (tmavý) za ní.
  parts.push(bx(-0.75, 0.75, 0.6, 1.9, L / 2 - 0.08, L / 2 + 0.002, DARK, false));
  parts.push({ shape: 'box', pos: [0, 0.32, L / 2 + 0.65], rot: [-0.45, 0, 0], size: [1.5, 0.08, 1.45], material: mat, collide: true });
  // 8 velkých kol, poklopy, prázdný držák zbraně (bez zbraně).
  for (let i = 0; i < 4; i++) for (const x of [-hw + 0.2, hw - 0.2]) parts.push(...wheel(x, 0.6, -L / 2 + 1.3 + i * 1.45, 0.6, 0.4, { burnt }));
  parts.push({ shape: 'cylinder', pos: [0, 2.25, -0.6], size: [0.9, 0.18, 0.9], material: mat }, { shape: 'cylinder', pos: [-0.6, 2.2, 1.6], size: [0.6, 0.08, 0.6], material: mat });
  if (burnt) parts.push(...rubble(0, L / 2 + 1.5, 3, [1.2, 0.8], seed, 0.3).map((p) => ({ ...p, material: DARK })));
  void r;
  return parts;
}

regH(206, 'apcBurnt', 'Ohořelý obrněný transportér', {
  describe: () => 'generický kolový transportér 7 × 2,9 m (8 kol), hranatá korba, sklopená zadní rampa, bez výzbroje',
  generate(_p, seed) {
    return apc(true, seed);
  },
}, {
  target: [2.9, 8.2, 2.3],
  route: [{ p: [-2.4, 0, -4.2] }, { p: [-2.4, 0, 4.6] }, { p: [0, 0, 5.2], note: 'u sklopené rampy' }],
  walkableRoof: true,
  rays: [{ from: [-3.5, 1.2, 0], to: [0, 1.2, 0], hit: true, note: 'korba kryje stojícího' }],
  notes: ['Výtvarný směr: kola (jednotně pro E/H). Prostor uvnitř je jen tmavý otvor (bez interiéru).'],
});

regH(207, 'apcSide', 'Převrácený transportér', {
  describe: () => 'transportér ležící na boku, viditelný podvozek a kola, poškozená střešní část',
  generate(_p, seed) {
    const parts = apc(true, seed + 2).filter((p) => !(p.pos[1] > 2.0 && p.shape === 'cylinder'));
    parts.push({ shape: 'box', pos: [0.5, 2.0, 1.2], rot: [0.3, 0, 0.5], size: [1.0, 0.06, 1.2], material: BURNT });
    return pose(parts, [0, 0, -Math.PI / 2]);
  },
}, {
  target: [2.5, 8.2, 3.0],
  route: [{ p: [-3.2, 0, -4.2] }, { p: [-3.2, 0, 4.6] }],
  walkableRoof: false,
  rays: [{ from: [-4.5, 1.5, 0], to: [3.5, 1.5, 0], hit: true, note: 'položená korba kryje' }],
  notes: ['Kolize se otáčí s vozem.'],
});

// ---------------------------------------------------------------------------
// Vrtulník, motorka, kolo
// ---------------------------------------------------------------------------
regH(208, 'heliWreck', 'Vrak vrtulníku', {
  describe: () => 'trup 8 m (kabina + odlomená ocasní trubka vedle), tři velké listy rotoru na zemi, ližiny; kolize jen hlavních částí',
  generate(_p, seed) {
    const r = rng(seed), mat = 'containerGreen', parts: Part[] = [];
    // Trup: kabina se zaobleným nosem, prázdná okna, otevřený boční vstup.
    parts.push(bx(-1.0, 1.0, 0.45, 2.3, -1.5, 2.2, mat), { shape: 'cylinder', pos: [0, 1.35, -1.6], rot: [Math.PI / 2, 0, 0], size: [2.0, 0.6, 1.8], material: mat, collide: true });
    parts.push(bx(-0.95, 0.95, 1.4, 2.25, -2.2, -1.8, 'burntMetal', false), bx(1.0, 1.005, 0.6, 2.0, -0.6, 1.0, DARK, false));
    parts.push(bx(-0.6, 0.6, 2.3, 2.7, -0.5, 1.6, mat), { shape: 'cylinder', pos: [0, 2.85, 0.4], size: [0.4, 0.3, 0.4], material: 'gunMetal' });
    // Zadní část trupu zúžená, ocasní trubka odlomená (leží šikmo vedle).
    parts.push({ shape: 'box', pos: [0, 1.6, 2.9], rot: [0.12, 0, 0], size: [1.4, 1.3, 1.5], material: mat, collide: true });
    parts.push({ shape: 'cylinder', pos: [2.0, 0.35, 5.2], rot: eulerYX(0.5, Math.PI / 2 - 0.08), size: [0.6, 4.2, 0.6], material: mat, collide: true });
    parts.push({ shape: 'box', pos: [3.0, 0.9, 7.1], rot: [0.2, 0.5, 0.1], size: [0.1, 1.4, 0.9], material: mat });
    // Ližiny, listy rotoru (tenké, bez kolize).
    for (const s of [-1, 1]) parts.push({ shape: 'cylinder', pos: [s * 1.1, 0.06, 0.2], rot: [Math.PI / 2, 0, 0], size: [0.1, 3.4, 0.1], material: 'metal' }, bx(s * 1.1 - 0.04, s * 1.1 + 0.04, 0.06, 0.5, -0.8, -0.7, 'metal', false), bx(s * 1.1 - 0.04, s * 1.1 + 0.04, 0.06, 0.5, 1.0, 1.1, 'metal', false));
    for (let i = 0; i < 3; i++) {
      const a = r() * 6.28;
      parts.push({ shape: 'box', pos: [-2.5 + i * 1.6 + Math.cos(a) * 0.5, 0.04 + i * 0.03, -3.5 + i * 1.8], rot: [0, a, (r() - 0.5) * 0.15], size: [0.35, 0.05, 3.5 + r()], material: 'gunMetal' });
    }
    parts.push(...rubble(1.2, 3.6, 4, [1.0, 1.0], seed, 0.3).map((p) => ({ ...p, material: DARK })));
    return parts;
  },
}, {
  target: [6, 10.5, 3],
  route: [{ p: [-2.2, 0, -3.5] }, { p: [-2.2, 0, 4.0], note: 'podél trupu' }],
  walkableRoof: false,
  rays: [{ from: [-3.5, 1.2, 0.5], to: [0, 1.2, 0.5], hit: true, note: 'trup kryje' }],
  notes: ['Listy rotoru a ližiny bez kolize (žádné drobné ostré překážky); kolizi mají trup, nos a ocasní trubka.'],
});

regH(209, 'motorbikeWreck', 'Vrak motorky', {
  describe: () => 'délka 2 m, leží na boku: rám, nádrž, motor, dvě kola, ohnutá přední vidlice',
  generate() {
    const parts: Part[] = [];
    // Stavba ve stoje (osa podél Z, předek −Z), pak položit na bok.
    parts.push(...wheel(0, 0.32, -0.7, 0.32, 0.1), ...wheel(0, 0.32, 0.7, 0.32, 0.12));
    parts.push(beam([0, 0.32, -0.7], [0, 0.95, -0.42], 0.05, 'metal', false), beam([0, 0.95, -0.42], [0, 0.6, 0.55], 0.06, 'paintedMetalRed', false), beam([0, 0.45, -0.1], [0, 0.32, 0.7], 0.05, 'metal', false));
    parts.push(bx(-0.16, 0.16, 0.75, 0.95, -0.35, 0.05, 'paintedMetalRed'), bx(-0.15, 0.15, 0.3, 0.6, -0.2, 0.2, 'gunMetal'), bx(-0.12, 0.12, 0.8, 0.88, 0.1, 0.6, 'gunPolymer', false));
    parts.push({ shape: 'box', pos: [0, 1.0, -0.45], rot: [0, 0.35, 0], size: [0.65, 0.04, 0.04], material: 'metal' });
    parts.push({ shape: 'cylinder', pos: [0.12, 0.32, 0.25], rot: [Math.PI / 2 - 0.2, 0, 0], size: [0.07, 0.7, 0.07], material: 'metal' });
    // Kolize: jeden nízký kvádr přes celý vrak (po položení).
    parts.push({ ...bx(-0.2, 0.2, 0, 1.0, -1.0, 1.0, 'metal'), render: false });
    return pose(parts, [0, 0, Math.PI / 2 - 0.08]);
  },
}, {
  target: [1.0, 2, 0.4],
  route: [{ p: [-1.2, 0, -1.4] }, { p: [-1.2, 0, 1.4] }],
  walkableRoof: false,
  notes: ['Kabely vynechány. Nízká překážka (lze překročit skokem).'],
});

regH(210, 'bicycleBroken', 'Poškozené jízdní kolo', {
  describe: () => 'leží na zemi: rám z trubek, dvě nízkopolygonová kola (výplně = materiál pletiva), ohnutá řídítka',
  generate() {
    const parts: Part[] = [];
    for (const z of [-0.52, 0.52]) {
      parts.push({ shape: 'cylinder', pos: [0, 0.34, z], rot: [0, 0, Math.PI / 2], size: [0.66, 0.025, 0.66], material: 'chainLink' });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push({ shape: 'box', pos: [0, 0.34 + Math.sin(a) * 0.32, z + Math.cos(a) * 0.32], rot: [a + Math.PI / 2, 0, 0], size: [0.035, 0.035, 0.26], material: 'rubber' });
      }
    }
    parts.push(beam([0, 0.34, 0.52], [0, 0.62, -0.05], 0.03, 'paintedMetalBlue'), beam([0, 0.34, 0.52], [0, 0.34, -0.05], 0.03, 'paintedMetalBlue'), beam([0, 0.34, -0.05], [0, 0.66, -0.35], 0.03, 'paintedMetalBlue'), beam([0, 0.62, -0.05], [0, 0.66, -0.35], 0.03, 'paintedMetalBlue'), beam([0, 0.66, -0.35], [0, 0.34, -0.52], 0.03, 'metal'));
    parts.push(beam([0, 0.66, -0.35], [0, 0.85, -0.42], 0.03, 'metal'), { shape: 'box', pos: [0.05, 0.86, -0.45], rot: [0, 0.6, 0.3], size: [0.5, 0.025, 0.025], material: 'metal' });
    parts.push(bx(-0.05, 0.05, 0.62, 0.68, 0.0, 0.18, 'gunPolymer', false));
    parts.push({ ...bx(-0.1, 0.1, 0, 0.9, -0.85, 0.85, 'metal'), render: false, moveOnly: true });
    return pose(parts, [0, 0.3, Math.PI / 2 - 0.05]);
  },
}, {
  target: [1.0, 1.7, 0.2],
  route: [{ p: [-1.0, 0, -1.2] }, { p: [-1.0, 0, 1.2] }],
  walkableRoof: false,
  notes: ['Řetěz a dráty jen materiálem; kolize jen pro pohyb (nízká).'],
});

