import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import { crate } from './bk';
import { bx, thru } from './modules';
import { beam, eulerYX, pipe } from './industrial';
import { reg, type SetMeta } from './residential';

/**
 * Sada 300 · I Uliční mobiliář a doplňky (položky 211–245).
 * Volně stojící: pivot = střed půdorysu u paty, přední strana −Z.
 * Nástěnné doplňky (klimatizace, markýzy, okenice, parabola, cedule, kabely): zadní plocha v z = 0,
 * vystupují do −Z, pata v y = 0 (mount wall – v editoru se přilepí na fasádu).
 * Střešní doplňky (nádrže, anténa, solární panel): mount top.
 * Povrchy cedulí a značek jsou prázdné (grafiku dodá hra), bez textu a symbolů.
 */
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regI = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, 'I');
const STEEL = 'paintedMetal';
const CONC = 'concreteLight';
const WALL = { kind: 'wall' as const, back: 0 };
const TOP = { kind: 'top' as const };
const walkAround = (r: number): SetMeta['route'] => [{ p: [-r, 0, -r] }, { p: [r, 0, -r], note: 'kolem předmětu' }];
const cyl = (x: number, y0: number, y1: number, z: number, d: number, material: string, collide = true): Part => ({ shape: 'cylinder', pos: [x, (y0 + y1) / 2, z], size: [d, y1 - y0, d], material, collide });

// ---------------------------------------------------------------------------
// I211–I214 Lampy a sloupy
// ---------------------------------------------------------------------------
function lamp(arms: number, h: number): Part[] {
  const parts: Part[] = [cyl(0, 0, 0.6, 0, 0.32, STEEL), cyl(0, 0.6, h, 0, 0.14, STEEL), cyl(0, h, h + 0.08, 0, 0.16, STEEL, false)];
  for (let i = 0; i < arms; i++) {
    const s = arms === 1 ? -1 : i ? 1 : -1;
    // Mírně zahnuté rameno ze tří úseků, svítidlo na konci (vzhled).
    const pts: V3[] = [[0, h - 0.3, 0], [0, h + 0.05, s * 0.6], [0, h + 0.15, s * 1.2], [0, h + 0.1, s * 1.6]];
    for (let k = 0; k + 1 < pts.length; k++) parts.push(pipe(pts[k], pts[k + 1], 0.07, STEEL, false));
    parts.push(bx(-0.18, 0.18, h - 0.05, h + 0.1, s * 1.6 - 0.32, s * 1.6 + 0.32, STEEL, false), bx(-0.15, 0.15, h - 0.08, h - 0.05, s * 1.6 - 0.28, s * 1.6 + 0.28, 'lamp', false));
  }
  return parts;
}

regI(211, 'lampSingle', 'Lampa s jedním ramenem', {
  describe: () => 'výška 7 m, stožár Ø 0,14 m, silnější patka, zahnuté rameno 1,6 m, svítidlo',
  generate() {
    return lamp(1, 7);
  },
}, {
  target: [0.4, 2.0, 7.2],
  route: walkAround(1.0),
  walkableRoof: false,
  rays: [thru(0, 1.2, true, 'stožár zastaví střelu', -2, 2)],
  notes: ['Kolize jen stožár a patka; rameno a svítidlo jsou vysoko (vzhled).'],
});

regI(212, 'lampDouble', 'Lampa se dvěma rameny', {
  describe: () => 'výška 8 m, dvě symetrická ramena 1,6 m, dvě svítidla',
  generate() {
    return lamp(2, 8);
  },
}, {
  target: [0.4, 3.6, 8.2],
  route: walkAround(1.0),
  walkableRoof: false,
  notes: [],
});

regI(213, 'poleWood', 'Dřevěný elektrický sloup', {
  describe: () => 'výška 8 m, mírně nepravidelný kmen Ø 0,26 m, horní příčník 1,8 m, 6 velkých izolátorů',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    // Kmen ze tří mírně vychýlených úseků (nepravidelnost).
    let prev: V3 = [0, 0, 0];
    for (let i = 1; i <= 3; i++) {
      const next: V3 = [(r() - 0.5) * 0.06, (8 * i) / 3, (r() - 0.5) * 0.06];
      parts.push(pipe(prev, next, 0.28 - i * 0.02, 'wood', true));
      prev = next;
    }
    for (const y of [7.4, 6.6]) {
      parts.push(bx(-0.9, 0.9, y - 0.06, y + 0.06, -0.06, 0.06, 'woodDark', false));
      for (const x of [-0.8, -0.35, 0.35, 0.8].slice(0, y > 7 ? 4 : 2)) parts.push(cyl(x, y + 0.06, y + 0.24, 0, 0.1, 'plasterWhite', false), cyl(x, y + 0.13, y + 0.16, 0, 0.14, 'plasterWhite', false));
    }
    parts.push(beam([0, 6.0, 0], [0.7, 7.34, 0], 0.05, 'woodDark'));
    return parts;
  },
}, {
  target: [1.8, 0.3, 8.2],
  route: walkAround(1.0),
  walkableRoof: false,
  notes: ['Dlouhé vedení není součástí modelu (připojí se zvlášť).'],
});

regI(214, 'poleConcrete', 'Betonový elektrický sloup', {
  describe: () => 'výška 9 m, zužující se hranatý profil 0,3 → 0,16 m, dva příčníky, patka',
  generate() {
    const parts: Part[] = [bx(-0.35, 0.35, 0, 0.3, -0.35, 0.35, CONC)];
    for (let i = 0; i < 4; i++) {
      const y0 = 0.3 + i * 2.175, y1 = y0 + 2.175, w = 0.3 - i * 0.035;
      parts.push(bx(-w / 2, w / 2, y0, y1, -w / 2, w / 2, CONC));
    }
    for (const y of [8.6, 7.6]) {
      parts.push(bx(-1.1, 1.1, y - 0.08, y + 0.08, -0.08, 0.08, 'concreteDark', false));
      for (const x of [-0.95, 0.95]) parts.push(cyl(x, y + 0.08, y + 0.3, 0, 0.12, 'gunMetal', false));
    }
    return parts;
  },
}, {
  target: [2.2, 0.7, 9],
  route: walkAround(1.0),
  walkableRoof: false,
  notes: [],
});

// ---------------------------------------------------------------------------
// I215–I219 Tabule a značky (prázdné plochy)
// ---------------------------------------------------------------------------
const signPost = (h: number): Part[] => [cyl(0, 0, h, 0, 0.07, 'metal'), cyl(0, h, h + 0.03, 0, 0.08, 'metal', false)];

regI(215, 'signSmall', 'Malá směrová tabule', {
  describe: () => 'sloupek 2,5 m, deska 1,2 × 0,4 m bez textu',
  generate() {
    return [...signPost(2.5), bx(-0.05, 1.15, 2.0, 2.4, -0.06, -0.04, 'plasterWhite', false), bx(-0.06, 1.16, 1.99, 2.41, -0.04, -0.03, 'metal', false)];
  },
}, {
  target: [1.2, 0.1, 2.5],
  route: walkAround(1.0),
  walkableRoof: false,
  notes: ['Prázdná plocha pro grafiku hry.'],
});

regI(216, 'signLarge', 'Velká směrová tabule', {
  describe: () => 'dvě podpěry, deska 3 × 1,5 m (spodní hrana 2,2 m), zadní výztuhy 3 nosníky',
  generate() {
    const parts: Part[] = [];
    for (const x of [-1.0, 1.0]) parts.push(cyl(x, 0, 3.7, 0.12, 0.12, STEEL), bx(x - 0.25, x + 0.25, 0, 0.2, -0.13, 0.37, CONC));
    parts.push(bx(-1.5, 1.5, 2.2, 3.7, -0.04, 0.0, 'plasterWhite', false), bx(-1.53, 1.53, 2.17, 3.73, 0.0, 0.04, 'metal', false));
    for (const y of [2.5, 2.95, 3.4]) parts.push(bx(-1.45, 1.45, y - 0.04, y + 0.04, 0.04, 0.1, STEEL, false));
    parts.push({ ...bx(-1.5, 1.5, 2.2, 3.7, -0.04, 0.04, 'metal'), render: false });
    return parts;
  },
}, {
  target: [3, 0.5, 3.7],
  route: [{ p: [0, 0, -1.5] }, { p: [0, 0, 1.5], note: 'pod tabulí mezi podpěrami' }],
  walkableRoof: false,
  notes: ['Pod deskou 2,2 m volné výšky – dá se projít mezi podpěrami.'],
});

regI(217, 'signRound', 'Kruhová značka', {
  describe: () => 'deska Ø 0,6 m (16 segmentů), sloupek 2,2 m, bez symbolů',
  generate() {
    return [...signPost(2.2), { shape: 'cylinder', pos: [0, 1.95, -0.05], rot: [Math.PI / 2, 0, 0], size: [0.6, 0.02, 0.6], material: 'plasterWhite' }, { shape: 'cylinder', pos: [0, 1.95, -0.035], rot: [Math.PI / 2, 0, 0], size: [0.62, 0.01, 0.62], material: 'metal' }];
  },
}, {
  target: [0.6, 0.1, 2.25],
  route: walkAround(0.8),
  walkableRoof: false,
  notes: [],
});

regI(218, 'signTriangle', 'Trojúhelníková značka', {
  describe: () => 'trojúhelník 0,7 m (dva klíny), sloupek 2,2 m, bez symbolů',
  generate() {
    const s = 0.7, h = s * 0.866, y0 = 1.7;
    return [...signPost(2.2), { shape: 'wedge', pos: [-s / 4, y0 + h / 2, -0.05], rot: [0, Math.PI / 2, 0], size: [0.02, h, s / 2], material: 'plasterWhite' }, { shape: 'wedge', pos: [s / 4, y0 + h / 2, -0.05], rot: [0, -Math.PI / 2, 0], size: [0.02, h, s / 2], material: 'plasterWhite' }];
  },
}, {
  target: [0.7, 0.1, 2.3],
  route: walkAround(0.8),
  walkableRoof: false,
  notes: ['Zaoblení rohů vynecháno (rozpočet).'],
});

regI(219, 'signRect', 'Obdélníková značka', {
  describe: () => 'deska 0,6 × 0,9 m, samostatný sloupek 2,4 m, prázdný povrch',
  generate() {
    return [...signPost(2.4), bx(-0.3, 0.3, 1.5, 2.4, -0.06, -0.04, 'plasterWhite', false), bx(-0.31, 0.31, 1.49, 2.41, -0.04, -0.035, 'metal', false)];
  },
}, {
  target: [0.6, 0.1, 2.4],
  route: walkAround(0.8),
  walkableRoof: false,
  notes: [],
});

// ---------------------------------------------------------------------------
// I220–I224 Lavičky a koše
// ---------------------------------------------------------------------------
regI(220, 'benchWood', 'Dřevěná lavička', {
  describe: () => 'délka 1,8 m, sedák 0,45 m ze 3 prken, opěradlo 2 prkna, dvě betonové podpěry',
  generate() {
    const parts: Part[] = [];
    for (const x of [-0.75, 0.75]) parts.push(bx(x - 0.06, x + 0.06, 0, 0.42, -0.25, 0.2, CONC), bx(x - 0.05, x + 0.05, 0.42, 0.85, 0.15, 0.22, CONC, false));
    for (let i = 0; i < 3; i++) parts.push(bx(-0.9, 0.9, 0.42, 0.46, -0.24 + i * 0.15, -0.12 + i * 0.15, 'wood', false));
    for (const y of [0.6, 0.76]) parts.push({ shape: 'box', pos: [0, y, 0.2], rot: [-0.15, 0, 0], size: [1.8, 0.11, 0.04], material: 'wood' });
    parts.push({ ...bx(-0.9, 0.9, 0, 0.46, -0.25, 0.22, 'wood'), render: false });
    return parts;
  },
}, {
  target: [1.8, 0.5, 0.85],
  route: walkAround(1.2),
  walkableRoof: false,
  notes: ['Kolize jeden nízký kvádr (překážka, kryt vleže).'],
});

regI(221, 'benchMetal', 'Kovová lavička', {
  describe: () => 'délka 1,8 m, trubkový rám, lamelový sedák (4 lamely) a opěradlo',
  generate() {
    const parts: Part[] = [];
    for (const x of [-0.8, 0.8]) parts.push(beam([x, 0, -0.22], [x, 0.44, -0.2], 0.04, STEEL), beam([x, 0, 0.18], [x, 0.85, 0.24], 0.04, STEEL), beam([x, 0.44, -0.24], [x, 0.44, 0.2], 0.04, STEEL));
    for (let i = 0; i < 4; i++) parts.push(bx(-0.9, 0.9, 0.44, 0.47, -0.22 + i * 0.11, -0.15 + i * 0.11, STEEL, false));
    for (let i = 0; i < 3; i++) parts.push({ shape: 'box', pos: [0, 0.58 + i * 0.1, 0.21 + i * 0.01], rot: [-0.1, 0, 0], size: [1.8, 0.06, 0.02], material: STEEL });
    parts.push({ ...bx(-0.9, 0.9, 0, 0.47, -0.24, 0.24, STEEL), render: false, moveOnly: true });
    return parts;
  },
}, {
  target: [1.8, 0.5, 0.85],
  route: walkAround(1.2),
  walkableRoof: false,
  rays: [thru(0, 0.25, false, 'pod lamelami střela projde', -1.5, 1.5)],
  notes: ['Lamely bez kolize pro střely (jen pohyb).'],
});

regI(222, 'binSmall', 'Malý odpadkový koš', {
  describe: () => 'výška 0,8 m, kulaté tělo Ø 0,45 m na sloupku, horní otvor (tmavá dutina nahoře)',
  generate() {
    return [cyl(0, 0, 0.8, 0.12, 0.06, STEEL), cyl(0, 0.3, 0.8, -0.1, 0.45, STEEL), cyl(0, 0.78, 0.8, -0.1, 0.38, 'concreteDark', false), { shape: 'cylinder', pos: [0, 0.81, -0.1], size: [0.47, 0.03, 0.47], material: 'metal' }];
  },
}, {
  target: [0.5, 0.6, 0.82],
  route: walkAround(0.8),
  walkableRoof: false,
  notes: [],
});

regI(223, 'binMetal', 'Kovová popelnice', {
  describe: () => 'výška 1 m, válcové tělo Ø 0,55 m, nakloněné víko, dvě hranatá madla',
  generate() {
    return [cyl(0, 0, 0.92, 0, 0.55, 'metal'), { shape: 'cylinder', pos: [0.05, 0.97, 0.1], rot: [0.35, 0, 0.1], size: [0.6, 0.05, 0.6], material: 'metal' }, cyl(0, 0.88, 0.92, 0, 0.5, 'concreteDark', false), bx(-0.34, -0.28, 0.6, 0.7, -0.06, 0.06, 'metal', false), bx(0.28, 0.34, 0.6, 0.7, -0.06, 0.06, 'metal', false)];
  },
}, {
  target: [0.6, 0.6, 1.0],
  route: walkAround(0.8),
  walkableRoof: false,
  rays: [thru(0, 0.5, true, 'kryje vleže', -1, 1)],
  notes: [],
});

regI(224, 'dumpster', 'Velký odpadový kontejner', {
  describe: () => '2 × 1,2 × 1,3 m, šikmé boky (dole užší), dvě horní víka (jedno otevřené), 4 kolečka',
  generate() {
    const parts: Part[] = [];
    parts.push(bx(-1.0, 1.0, 0.15, 1.25, -0.55, 0.6, 'containerGreen'));
    parts.push({ shape: 'box', pos: [0, 0.7, -0.6], rot: [0.12, 0, 0], size: [2.0, 1.1, 0.05], material: 'containerGreen' });
    parts.push(bx(-0.98, 0, 1.25, 1.3, -0.62, 0.62, 'paintedMetal', false), { shape: 'box', pos: [0.5, 1.6, 0.66], rot: [-1.3, 0, 0], size: [1.0, 0.05, 0.75], material: 'paintedMetal' });
    for (const x of [-0.8, 0.8]) for (const z of [-0.4, 0.45]) parts.push({ shape: 'cylinder', pos: [x, 0.08, z], rot: [0, 0, Math.PI / 2], size: [0.16, 0.06, 0.16], material: 'rubber' });
    parts.push(bx(-1.05, -1.0, 0.6, 1.0, -0.3, 0.3, 'metal', false), bx(1.0, 1.05, 0.6, 1.0, -0.3, 0.3, 'metal', false));
    return parts;
  },
}, {
  target: [2.1, 1.3, 1.3],
  route: walkAround(1.6),
  walkableRoof: false,
  rays: [thru(0, 0.9, true, 'kryje vkleče', -2, 0)],
  notes: [],
});

// ---------------------------------------------------------------------------
// I225–I230 Budka, zastávka, hydrant, sloupek, květináče
// ---------------------------------------------------------------------------
regI(225, 'phoneBooth', 'Telefonní budka', {
  describe: () => '1,2 × 1,2 × 2,4 m, otevřený vstup vpředu, rám, část skel, přístroj uvnitř',
  generate() {
    const parts: Part[] = [bx(-0.6, 0.6, 0, 0.08, -0.6, 0.6, CONC), bx(-0.62, 0.62, 2.3, 2.4, -0.62, 0.62, STEEL)];
    for (const x of [-0.57, 0.57]) for (const z of [-0.57, 0.57]) parts.push(bx(x - 0.04, x + 0.04, 0.08, 2.3, z - 0.04, z + 0.04, STEEL));
    // Skla: zadní a boky (spodní polovina plná), jedno chybí; průstřelné, pohyb blokují.
    for (const [x0, x1, z0, z1, ok] of [[-0.53, 0.53, 0.55, 0.59, true], [-0.59, -0.55, -0.53, 0.53, true], [0.55, 0.59, -0.53, 0.53, false]] as const) {
      parts.push(bx(x0, x1, 0.08, 0.9, z0, z1, STEEL));
      if (ok) parts.push({ ...bx(x0, x1, 0.9, 2.25, z0, z1, 'glass', true), moveOnly: true });
      else parts.push({ ...bx(x0, x1, 0.9, 2.25, z0, z1, 'glass', false), render: false }, { ...bx(x0, x1, 0.9, 2.25, z0, z1, STEEL), render: false, moveOnly: true });
    }
    parts.push(bx(-0.2, 0.2, 1.2, 1.65, 0.45, 0.55, 'gunMetal', false), { shape: 'box', pos: [0.12, 1.35, 0.42], rot: [0, 0, 0.2], size: [0.06, 0.25, 0.06], material: 'gunPolymer' });
    return parts;
  },
}, {
  target: [1.24, 1.24, 2.4],
  route: [{ p: [0, 0, -1.4] }, { p: [0, 0.08, 0.05], note: 'v budce' }],
  walkableRoof: false,
  rays: [{ from: [-2, 1.6, 0], to: [2, 1.6, 0], hit: false, note: 'skla střelu propustí' }],
  notes: ['Bez textu a log; sklo blokuje pohyb, ne střelu.'],
});

regI(226, 'busStop', 'Autobusová zastávka', {
  describe: () => '4 × 1,8 × 2,6 m, střecha na 3 sloupcích, zadní stěna (sklo + plný pruh), lavička 1,6 m, prázdný panel',
  generate() {
    const parts: Part[] = [bx(-2, 2, 0, 0.06, -0.9, 0.9, 'paving')];
    for (const x of [-1.9, 0, 1.9]) parts.push(bx(x - 0.05, x + 0.05, 0.06, 2.5, 0.72, 0.82, STEEL));
    parts.push({ shape: 'box', pos: [0, 2.55, 0.0], rot: [0.06, 0, 0], size: [4.1, 0.08, 1.9], material: 'metalSheet', collide: true });
    parts.push(bx(-1.85, 1.85, 0.06, 0.5, 0.76, 0.8, STEEL), { ...bx(-1.85, 1.85, 0.5, 2.4, 0.76, 0.8, 'glass', true), moveOnly: true });
    parts.push(bx(1.05, 1.85, 0.8, 2.2, 0.7, 0.75, 'plasterWhite', false));
    parts.push(bx(-1.6, 0, 0.42, 0.46, 0.3, 0.7, 'wood'), bx(-1.55, -1.45, 0.06, 0.42, 0.4, 0.6, STEEL, false), bx(-0.15, -0.05, 0.06, 0.42, 0.4, 0.6, STEEL, false));
    return parts;
  },
}, {
  target: [4.1, 1.9, 2.6],
  route: [{ p: [-1.0, 0, -1.6], note: 'chodník' }, { p: [-1.0, 0.06, 0.0], note: 'pod střechou' }, { p: [1.2, 0.06, 0.0] }],
  walkableRoof: false,
  rays: [thru(-0.9, 1.5, false, 'zadní sklo střelu propustí', -1.5, 1.5)],
  notes: ['Panel jízdního řádu prázdný (plasterWhite).'],
});

regI(227, 'hydrant', 'Hydrant', {
  describe: () => 'výška 0,8 m, válcové tělo, dvě boční vývodky, horní víko, bez značek',
  generate() {
    return [cyl(0, 0, 0.08, 0, 0.32, 'paintedMetalRed'), cyl(0, 0.08, 0.66, 0, 0.22, 'paintedMetalRed'), cyl(0, 0.66, 0.74, 0, 0.26, 'paintedMetalRed', false), cyl(0, 0.74, 0.82, 0, 0.12, 'paintedMetalRed', false),
      { shape: 'cylinder', pos: [0.17, 0.45, 0], rot: [0, 0, Math.PI / 2], size: [0.1, 0.14, 0.1], material: 'paintedMetalRed' }, { shape: 'cylinder', pos: [-0.17, 0.45, 0], rot: [0, 0, Math.PI / 2], size: [0.1, 0.14, 0.1], material: 'paintedMetalRed' }];
  },
}, {
  target: [0.45, 0.32, 0.82],
  route: walkAround(0.7),
  walkableRoof: false,
  notes: [],
});

regI(228, 'bollard', 'Ochranný sloupek', {
  describe: () => 'výška 0,9 m, Ø 0,15 m, patka, zaoblený vršek',
  generate() {
    return [cyl(0, 0, 0.05, 0, 0.24, STEEL), cyl(0, 0.05, 0.85, 0, 0.15, STEEL), { shape: 'blob', pos: [0, 0.86, 0], size: [0.15, 0.1, 0.15], material: STEEL, seed: 3, rough: 0, detail: 1 }, cyl(0, 0.7, 0.75, 0, 0.16, 'plasterWhite', false)];
  },
}, {
  target: [0.24, 0.24, 0.9],
  route: walkAround(0.6),
  walkableRoof: false,
  notes: [],
});

regI(229, 'planterRound', 'Kulatý květináč', {
  describe: () => 'Ø 0,8 × 0,7 m, silný lem, viditelná vnitřní stěna, zemina uvnitř (bez rostliny)',
  generate() {
    return [cyl(0, 0, 0.62, 0, 0.8, CONC), cyl(0, 0.62, 0.7, 0, 0.86, CONC, false), cyl(0, 0.6, 0.705, 0, 0.66, 'concreteDark', false), cyl(0, 0.58, 0.62, 0, 0.64, 'dirt', false)];
  },
}, {
  target: [0.86, 0.86, 0.7],
  route: walkAround(0.9),
  walkableRoof: false,
  rays: [thru(0, 0.4, true, 'kryje vleže', -1, 1)],
  notes: ['Vnitřní stěna = tmavý prstenec nad zeminou (zemina 8 cm pod lemem).'],
});

regI(230, 'planterRect', 'Obdélníkový květináč', {
  describe: () => '1,8 × 0,6 × 0,7 m, betonové tělo, horní lem, nepravidelná zemina',
  generate(_p, seed) {
    const parts: Part[] = [bx(-0.9, 0.9, 0, 0.64, -0.3, 0.3, CONC), bx(-0.94, 0.94, 0.64, 0.7, -0.34, 0.34, CONC, false), bx(-0.8, 0.8, 0.6, 0.705, -0.2, 0.2, 'concreteDark', false)];
    parts.push({ shape: 'blob', pos: [0, 0.6, 0], size: [1.58, 0.08, 0.38], material: 'dirt', seed, rough: 0.4, detail: 1 });
    return parts;
  },
}, {
  target: [1.88, 0.68, 0.7],
  route: walkAround(1.2),
  walkableRoof: false,
  rays: [thru(0, 0.4, true, 'kryje vleže')],
  notes: [],
});

// ---------------------------------------------------------------------------
// I231–I240 Nástěnné doplňky (zadní plocha z = 0, mount wall)
// ---------------------------------------------------------------------------
/** Klimatizace: skříň, mřížka ventilátoru, lamely, držáky. */
function acUnit(W: number, H: number, D: number, fans: number): Part[] {
  const parts: Part[] = [bx(-W / 2, W / 2, 0.05, 0.05 + H, -D - 0.02, -0.02, 'acUnit')];
  for (let i = 0; i < fans; i++) {
    const x = -W / 2 + (W / fans) * (i + 0.5) - (fans === 1 ? W * 0.12 : 0);
    const d = Math.min(H * 0.78, (W / fans) * 0.78);
    parts.push({ shape: 'cylinder', pos: [x, 0.05 + H / 2, -D - 0.025], rot: [Math.PI / 2, 0, 0], size: [d, 0.012, d], material: 'concreteDark' });
    parts.push({ shape: 'cylinder', pos: [x, 0.05 + H / 2, -D - 0.03], rot: [Math.PI / 2, 0, 0], size: [d * 0.2, 0.012, d * 0.2], material: 'metal' });
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) parts.push({ shape: 'box', pos: [x, 0.05 + H / 2, -D - 0.033], rot: [0, 0, a], size: [d, 0.012, 0.006], material: 'metal' });
  }
  if (fans === 1) for (let k = 0; k < 5; k++) parts.push(bx(W / 2 - 0.22, W / 2 - 0.04, 0.12 + k * (H - 0.14) / 5, 0.14 + k * (H - 0.14) / 5, -D - 0.035, -D - 0.02, 'metal', false));
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) parts.push(bx(x - 0.02, x + 0.02, 0, 0.06, -D - 0.05, 0, 'metal', false), beam([x, 0.03, -D], [x, 0.55, -0.01], 0.03, 'metal'));
  parts.push(pipe([-W / 2 + 0.05, 0.3, -0.05], [-W / 2 - 0.15, 0.3, -0.05], 0.04, 'plasterWhite', false));
  return parts;
}

regI(231, 'acUnitA', 'Klimatizace A (pilot)', {
  describe: () => '0,88 × 0,7 × 0,44 m, ventilátor s mřížkou, lamely, dva držáky; pivot na zadní ploše',
  mount: WALL,
  generate() {
    return acUnit(0.88, 0.62, 0.42, 1);
  },
}, {
  target: [0.88, 0.5, 0.7],
  route: walkAround(1.0),
  walkableRoof: false,
  notes: ['Podle pilotu wall_ac_a (0,88 × 0,68 × 0,44 m, kolize jeden kvádr, pivot na zadní ploše); úprava: ventilátor se 3 lopatkami a lamely.'],
});

regI(232, 'acUnitB', 'Klimatizace B', {
  describe: () => '1,2 × 0,6 × 0,45 m, širší nízká jednotka se dvěma ventilátory',
  mount: WALL,
  generate() {
    return acUnit(1.2, 0.55, 0.43, 2);
  },
}, {
  target: [1.2, 0.5, 0.6],
  route: walkAround(1.2),
  walkableRoof: false,
  notes: ['Odlišná silueta od pilotu: široká a nízká, dvě ventilační zóny.'],
});

/** Markýza: rám z trubek, plachta (prověšená), lem. */
function awning(W: number, out: number, drop: number, mat: string, torn: boolean, seed: number): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const a = Math.atan2(drop, out), L = Math.hypot(out, drop), top = drop + 0.1;
  parts.push(bx(-W / 2, W / 2, top - 0.05, top + 0.05, -0.06, 0, STEEL, false));
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) parts.push(beam([x, top, -0.03], [x, 0.1, -out], 0.035, STEEL), beam([x, top - 0.55, -0.02], [x, 0.1 + drop * 0.3, -out * 0.7], 0.03, STEEL));
  parts.push(pipe([-W / 2, 0.1, -out], [W / 2, 0.1, -out], 0.045, STEEL, false));
  if (!torn) {
    for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [(s * W) / 4, (top + 0.1) / 2 - 0.03, -out / 2], rot: [a, 0, s * 0.02], size: [W / 2 + 0.02, 0.015, L], material: mat });
    parts.push(bx(-W / 2, W / 2, -0.12, 0.1, -out - 0.01, -out + 0.005, mat, false));
  } else {
    // Levá polovina drží, pravý přední roh chybí, zbytek pravé půlky visí dolů.
    parts.push({ shape: 'box', pos: [-W / 4, (top + 0.1) / 2 - 0.03, -out / 2], rot: [a, 0, 0], size: [W / 2, 0.015, L], material: mat });
    parts.push({ shape: 'box', pos: [W / 4, top - 0.55, -0.15], rot: [0.25, 0, (r() - 0.5) * 0.2], size: [W / 2 - 0.1, 1.1, 0.015], material: mat });
    parts.push({ shape: 'box', pos: [W / 4 + 0.2, top - 0.25, -0.55], rot: [a + 0.4, 0.3, 0.2], size: [W * 0.25, 0.015, L * 0.45], material: mat });
    parts.push(bx(-W / 2, 0, -0.12, 0.1, -out - 0.01, -out + 0.005, mat, false));
  }
  // Kolize: tenká šikmá deska (pohyb – lze na ni skočit? ne: jen moveOnly, střely projdou).
  parts.push({ shape: 'box', pos: [0, (top + 0.1) / 2, -out / 2], rot: [a, 0, 0], size: [torn ? W / 2 : W, 0.05, L], material: mat, collide: true, render: false, moveOnly: true });
  if (torn) parts[parts.length - 1].pos = [-W / 4, (top + 0.1) / 2, -out / 2];
  return parts;
}

regI(233, 'awningFlat', 'Rovná markýza', {
  describe: () => 'šířka 3 m, vyložení 1,5 m, téměř vodorovná látka (pokles 0,15 m) na trubkovém rámu',
  mount: WALL,
  generate(_p, seed) {
    return awning(3, 1.5, 0.15, ['awningRed', 'awningBlue', 'awningGreen', 'awningSand'][seed % 4], false, seed);
  },
}, {
  target: [3, 1.5, 0.35],
  route: walkAround(1.8),
  walkableRoof: false,
  notes: ['Pata (y = 0) = přední hrana; v editoru se přilepí do výšky kliknutí (typicky 2,4–2,8 m).'],
});

regI(234, 'awningSloped', 'Šikmá markýza', {
  describe: () => 'šířka 4 m, vyložení 2 m, klesající plachta (0,8 m), přední příčka, dva boční držáky',
  mount: WALL,
  generate(_p, seed) {
    return awning(4, 2, 0.8, ['awningRed', 'awningBlue', 'awningGreen', 'awningSand'][(seed + 1) % 4], false, seed);
  },
}, {
  target: [4, 2, 1.0],
  route: walkAround(2.4),
  walkableRoof: false,
  notes: [],
});

regI(235, 'awningTorn', 'Utržená markýza', {
  describe: () => 'šikmá markýza 4 m: pravý přední roh chybí, zbytek pravé půlky visí dolů',
  mount: WALL,
  generate(_p, seed) {
    return awning(4, 2, 0.8, ['awningRed', 'awningBlue', 'awningGreen', 'awningSand'][(seed + 2) % 4], true, seed);
  },
}, {
  target: [4, 2, 1.0],
  route: walkAround(2.4),
  walkableRoof: false,
  notes: ['Trhliny řešené siluetou dílů (alfa třepení nepoužito – žádná vhodná textura).'],
});

/** Okenice: dvě křídla otevřená o úhel `open` (rad) od roviny okna, otvor 1,2 × 1,3 m. */
function shutters(metal: boolean): Part[] {
  const parts: Part[] = [], w = 0.6, h = 1.3, y0 = 0.02, open = 2.1; // ~120°
  for (const s of [-1, 1]) {
    const hx = s * 0.62; // závěs u ostění
    // Křídlo vytočené o `open` z roviny okna ven a do strany (směr od závěsu: (s·cos60°, −sin60°)).
    const cx = hx + s * (w / 2) * Math.cos(Math.PI - open), cz = -(w / 2) * Math.sin(Math.PI - open) - 0.03;
    const rot: V3 = [0, s > 0 ? Math.PI - open : open, 0];
    parts.push({ shape: 'box', pos: [cx, y0 + h / 2, cz], rot, size: [w, h, 0.04], material: metal ? 'paintedMetal' : 'woodDark', collide: true });
    // Rám / prolisy (vzhled).
    if (!metal) for (let k = 0; k < 6; k++) parts.push({ shape: 'box', pos: [cx, y0 + 0.2 + k * 0.18, cz - 0.02 * Math.cos(rot[1])], rot: [0.5, rot[1], 0], size: [w - 0.1, 0.08, 0.015], material: 'wood' });
    else for (const v of [0.35, 0.95]) parts.push({ shape: 'box', pos: [cx, y0 + v, cz], rot, size: [w - 0.08, 0.06, 0.06], material: 'metal' });
    parts.push(bx(hx - 0.02, hx + 0.02, y0 + 0.15, y0 + 0.25, -0.05, 0, 'metal', false), bx(hx - 0.02, hx + 0.02, y0 + h - 0.25, y0 + h - 0.15, -0.05, 0, 'metal', false));
  }
  return parts;
}

regI(236, 'shuttersWood', 'Dřevěné okenice', {
  describe: () => 'dvojice křídel 0,6 × 1,3 m pro okno 1,2 × 1,3 m, otevřené o ~120°, 6 lamel, silný rám',
  mount: WALL,
  generate() {
    return shutters(false);
  },
}, {
  target: [2.2, 0.5, 1.3],
  route: walkAround(1.5),
  walkableRoof: false,
  notes: ['Pata = spodní hrana okna (parapet); přilepit k oknu B31 / A-domům.'],
});

regI(237, 'shuttersMetal', 'Kovové okenice', {
  describe: () => 'dvojice plechových křídel se 2 prolisy, stejné měřítko jako I236',
  mount: WALL,
  generate() {
    return shutters(true);
  },
}, {
  target: [2.2, 0.5, 1.3],
  route: walkAround(1.5),
  walkableRoof: false,
  notes: [],
});

regI(238, 'satDish', 'Satelitní parabola', {
  describe: () => 'mělká miska Ø 0,9 m, rameno s přijímačem, nástěnný držák',
  mount: WALL,
  generate() {
    const rot = eulerYX(Math.PI, Math.PI / 2 - 0.35);
    return [
      bx(-0.08, 0.08, 0, 0.3, -0.03, 0, 'metal', false), pipe([0, 0.15, -0.02], [0, 0.35, -0.3], 0.04, 'metal', false),
      { shape: 'cylinder', pos: [0, 0.45, -0.32], rot, size: [0.9, 0.05, 0.9], material: 'plasterWhite', collide: true },
      { shape: 'cylinder', pos: [0, 0.47, -0.31], rot, size: [0.6, 0.06, 0.6], material: 'plasterWhite' },
      pipe([0, 0.3, -0.38], [0, 0.55, -0.85], 0.025, 'metal', false), bx(-0.04, 0.04, 0.52, 0.62, -0.92, -0.84, 'gunPolymer', false),
    ];
  },
}, {
  target: [0.9, 0.95, 0.9],
  route: walkAround(1.0),
  walkableRoof: false,
  notes: ['Kolize jen miska (malý kvádr pro zásah).'],
});

regI(239, 'shopSign', 'Prázdná obchodní cedule', {
  describe: () => '2,5 × 0,1 × 0,7 m, obdélníkový rám s prázdnou plochou, dva zadní držáky',
  mount: WALL,
  generate() {
    return [bx(-1.25, 1.25, 0, 0.7, -0.14, -0.06, 'paintedMetal'), bx(-1.2, 1.2, 0.05, 0.65, -0.145, -0.14, 'plasterWhite', false), bx(-1.0, -0.9, 0.2, 0.5, -0.06, 0, 'metal', false), bx(0.9, 1.0, 0.2, 0.5, -0.06, 0, 'metal', false)];
  },
}, {
  target: [2.5, 0.15, 0.7],
  route: walkAround(1.6),
  walkableRoof: false,
  notes: ['Plocha 2,4 × 0,6 m pro text hry.'],
});

regI(240, 'junctionBox', 'Kabely a rozvodná krabice', {
  describe: () => 'krabice 0,4 × 0,2 × 0,6 m a tři silné kabelové trasy (nahoru, do boku, dolů)',
  mount: WALL,
  generate() {
    return [
      bx(-0.2, 0.2, 0.6, 1.2, -0.2, 0, 'paintedMetal'), bx(-0.18, 0.18, 0.62, 1.18, -0.205, -0.2, 'metal', false),
      bx(-0.05, 0.05, 1.2, 2.6, -0.06, -0.02, 'gunPolymer', false), bx(0.2, 1.6, 0.9, 0.96, -0.06, -0.02, 'gunPolymer', false), bx(-0.12, -0.06, 0, 0.6, -0.06, -0.02, 'gunPolymer', false),
      bx(-0.07, 0.07, 2.6, 2.7, -0.08, 0, 'metal', false),
    ];
  },
}, {
  target: [1.8, 0.2, 2.7],
  route: walkAround(1.2),
  walkableRoof: false,
  notes: ['Drobné svorky a vodiče vynechány; kolize jen krabice.'],
});

// ---------------------------------------------------------------------------
// I241–I245 Střešní doplňky a sušák
// ---------------------------------------------------------------------------
regI(241, 'roofTankA', 'Střešní nádrž A (pilot)', {
  describe: () => 'válcová nádrž Ø 1,3 × 1,56 m na 4 nohách 0,56 m, víko, výstupní trubka',
  mount: TOP,
  generate() {
    const parts: Part[] = [cyl(-0.12, 0.56, 2.04, 0, 1.3, 'paintedMetal'), cyl(-0.12, 2.04, 2.12, 0, 0.5, 'metal', false), cyl(-0.12, 2.04, 2.06, 0, 1.26, 'metal', false)];
    for (const x of [-0.6, 0.36]) for (const z of [-0.48, 0.48]) parts.push(bx(x - 0.04, x + 0.04, 0, 0.6, z - 0.04, z + 0.04, 'metal'));
    parts.push(bx(-0.62, 0.38, 0.52, 0.6, -0.5, 0.5, 'metal', false), pipe([-0.77, 0.7, 0], [-0.77, 0.05, 0], 0.08, 'metal', false), pipe([-0.6, 0.7, 0], [-0.8, 0.7, 0], 0.08, 'metal', false));
    return parts;
  },
}, {
  target: [1.6, 1.35, 2.12],
  route: walkAround(1.2),
  walkableRoof: false,
  rays: [{ from: [-2, 1.3, 0], to: [0, 1.3, 0], hit: true, note: 'nádrž kryje' }],
  notes: ['Podle pilotu roof_tank_a (Ø 1,3 m, nohy 0,6 m, kolize 2 kvádry → zde válec + nohy). Pata = spodek nohou, mount top: sedí na střeše bez mezery.'],
});

regI(242, 'roofTankB', 'Střešní nádrž B', {
  describe: () => 'nižší širší nádrž Ø 1,8 × 1,1 m na betonovém podstavci 0,25 m, kopulovité víko, boční potrubí',
  mount: TOP,
  generate() {
    return [bx(-0.95, 0.95, 0, 0.25, -0.95, 0.95, CONC), cyl(0, 0.25, 1.35, 0, 1.8, 'plasterWhite'), cyl(0, 1.35, 1.45, 0, 1.4, 'plasterWhite', false), cyl(0, 1.45, 1.5, 0, 0.6, 'plasterWhite', false),
      pipe([0.85, 0.5, 0], [1.15, 0.5, 0], 0.07, 'metal', false), pipe([1.15, 0.5, 0], [1.15, 0.05, 0.0], 0.07, 'metal', false), pipe([0.85, 1.1, 0.3], [1.1, 1.1, 0.3], 0.05, 'metal', false), cyl(1.1, 1.05, 1.15, 0.3, 0.12, 'paintedMetalRed', false)];
  },
}, {
  target: [2.2, 1.9, 1.5],
  route: walkAround(1.4),
  walkableRoof: false,
  rays: [{ from: [-2, 0.8, 0], to: [0, 0.8, 0], hit: true, note: 'nádrž kryje' }],
  notes: ['Odlišná silueta od A: nízká, široká, na podstavci místo nohou.'],
});

regI(243, 'tvAntenna', 'Televizní anténa', {
  describe: () => 'stožárek 2 m na patce, vodorovné rameno 1,2 m, 6 příčných prvků (bez kolize)',
  mount: TOP,
  generate() {
    const parts: Part[] = [bx(-0.15, 0.15, 0, 0.04, -0.15, 0.15, 'metal'), cyl(0, 0.04, 2.0, 0, 0.04, 'metal', false), pipe([0, 1.9, -0.5], [0, 1.9, 0.7], 0.025, 'metal', false)];
    for (let i = 0; i < 6; i++) parts.push(bx(-0.35 + i * 0.04, 0.35 - i * 0.04, 1.89, 1.91, -0.4 + i * 0.2 - 0.008, -0.4 + i * 0.2 + 0.008, 'metal', false));
    parts.push(beam([0.3, 0.04, 0.3], [0, 1.2, 0], 0.015, 'metal'));
    return parts;
  },
}, {
  target: [0.7, 1.2, 2],
  route: walkAround(0.8),
  walkableRoof: false,
  notes: ['Tenké díly bez kolize, kolize jen nízká patka.'],
});

regI(244, 'solarPanel', 'Solární panel', {
  describe: () => 'deska 1 × 1,7 m na šikmém kovovém stojanu (30°), články řešené materiálem',
  mount: TOP,
  generate() {
    const a = 0.52;
    const parts: Part[] = [{ shape: 'box', pos: [0, 0.75, 0], rot: [a, 0, 0], size: [1.0, 0.04, 1.7], material: 'glassShop', collide: true }, { shape: 'box', pos: [0, 0.73, 0.01], rot: [a, 0, 0], size: [1.04, 0.03, 1.74], material: 'metal' }];
    for (const x of [-0.45, 0.45]) parts.push(beam([x, 0, -0.75], [x, 0.32, -0.7], 0.04, 'metal'), beam([x, 0, 0.75], [x, 1.16, 0.7], 0.04, 'metal'), beam([x, 0, -0.75], [x, 0, 0.75], 0.04, 'metal'));
    return parts;
  },
}, {
  target: [1.04, 1.6, 1.2],
  route: walkAround(1.2),
  walkableRoof: false,
  notes: ['Panel natočený k −Z (jih ve výchozím natočení); členění článků jen materiálem.'],
});

regI(245, 'clothesline', 'Sušák s prádlem', {
  describe: () => 'dvě podpěry 3 m od sebe, 3 šňůry, 4 velké kusy prádla (mírně prohnuté, bez fyziky)',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    for (const x of [-1.5, 1.5]) parts.push(cyl(x, 0, 1.9, 0, 0.05, 'metal'), bx(x - 0.02, x + 0.02, 1.8, 1.84, -0.4, 0.4, 'metal', false));
    for (const z of [-0.35, 0, 0.35]) parts.push(pipe([-1.5, 1.82, z], [1.5, 1.82, z], 0.008, 'plasterWhite', false));
    const cloth = ['fabricSand', 'awningBlue', 'plasterWhite', 'awningRed'];
    for (let i = 0; i < 4; i++) {
      const x = -1.05 + i * 0.7, z = [-0.35, 0, 0.35][i % 3], h = 0.6 + r() * 0.35;
      parts.push({ shape: 'box', pos: [x, 1.82 - h / 2, z], rot: [(r() - 0.5) * 0.08, (r() - 0.5) * 0.1, 0], size: [0.55, h, 0.01], material: cloth[i] });
    }
    parts.push(...crate(1.2, 0.9, 0, 0.4).map((p) => ({ ...p, material: 'wood' })));
    return parts;
  },
}, {
  target: [3, 0.8, 1.9],
  route: [{ p: [0, 0, -1.2] }, { p: [0, 0, 1.4], note: 'pod šňůrami (prádlo bez kolize)' }],
  walkableRoof: false,
  rays: [thru(-0.35, 1.5, false, 'prádlo střelu nezastaví', -1.5, 1.5)],
  notes: ['Prádlo bez kolize (zakrývá výhled, ne střelbu).'],
});
