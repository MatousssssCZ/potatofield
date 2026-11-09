import { rng } from '../../../shared/math';
import type { Part } from '../../parts';
import { eulerYXZ, foliage, limb, palmParts } from '../nature';
import { bx } from './modules';
import { reg, type SetMeta } from './residential';

/**
 * Sada 300 · K Příroda (položky 276–300): palmy, olivovníky, akácie, suché stromy, keře,
 * agáve, tráva, balvany a skalní stěny. Kolidují jen kmeny, kameny a nádoby; listí a tráva
 * hráče ani střely nezastaví (jako v BF2 – zakrývá výhled).
 */
type Meta = Omit<SetMeta, 'item'>;
type V3 = [number, number, number];
const regK = (item: number, id: string, label: string, def: Parameters<typeof reg>[3], meta: Meta) => reg(item, id, label, def, meta, 'K');
const around = (r: number): SetMeta['route'] => [{ p: [-r, 0, -r] }, { p: [r, 0, -r], note: 'kolem' }];
const throughLeaves = (y: number, r = 3) => ({ from: [-r, y, 0.2] as V3, to: [r, y, 0.2] as V3, hit: false, note: 'listí střelu propustí' });
/** Malá formální kolize (patka) pro rostliny bez kmene – editor potřebuje půdorys. */
const stem = (d = 0.12, h = 0.2): Part => ({ shape: 'cylinder', pos: [0, h / 2, 0], size: [d, h, d], material: 'bark', collide: true });

// ---------------------------------------------------------------------------
// K276–K280 Palmy
// ---------------------------------------------------------------------------
regK(276, 'palmDateSmall', 'Menší datlová palma (pilot)', {
  describe: () => 'datlovník, kmen 6 m, koruna 22 listů s přirozeným obloukem, suché listy pod korunou',
  generate(_p, seed) {
    return palmParts({ kind: 'date', height: 6, lean: 0.05, leanDir: 0, fronds: 24, droop: 0.55, dead: true }, seed);
  },
}, {
  target: [4.76, 4.26, 6.9],
  route: around(1.2),
  walkableRoof: false,
  rays: [{ from: [-3, 1.0, 0], to: [3, 1.0, 0], hit: true, note: 'kmen zastaví střelu' }, { from: [-4, 6.4, 1.6], to: [4, 6.4, 1.6], hit: false, note: 'koruna střelu propustí' }],
  notes: ['Podle pilotu tree_palm_a (kmen 6 m, výška 6,9 m, kolize kmene 3 úseky). Listy jsou prohnuté listové plochy (frond) místo plochých karet – čitelný oblouk.'],
});

regK(277, 'palmDateLeaning', 'Vyšší nakloněná palma (pilot)', {
  describe: () => 'datlovník 9 m s prohnutým kmenem (náklon ~13°), kolize kmene sleduje náklon',
  generate(_p, seed) {
    return palmParts({ kind: 'date', height: 9, lean: 0.23, leanDir: 0, fronds: 26, droop: 0.55, dead: true }, seed);
  },
}, {
  target: [4.76, 4.26, 9.9],
  route: around(1.2),
  walkableRoof: false,
  rays: [{ from: [-3, 1.0, 0], to: [3, 1.0, 0], hit: true, note: 'kmen u paty' }],
  notes: ['Podle pilotu tree_palm_b; kolize = válcové úseky kmene podél oblouku (spodních 60 %), listy bez kolize.'],
});

regK(278, 'palmDateTall', 'Vysoká datlová palma', {
  describe: () => 'datlovník 12 m, štíhlý téměř rovný kmen, široká koruna s dlouhými svěšenými listy',
  generate(_p, seed) {
    return palmParts({ kind: 'date', height: 12, lean: 0.03, leanDir: 0.5, fronds: 30, droop: 0.85, dead: true }, seed);
  },
}, {
  target: [5.5, 5.5, 13],
  route: around(1.2),
  walkableRoof: false,
  notes: [],
});

regK(279, 'palmCurved', 'Palma s prohnutým kmenem', {
  describe: () => 'štíhlá palma 8 m, plynule prohnutý kmen, koruna posunutá ~2 m do strany',
  generate(_p, seed) {
    return palmParts({ kind: 'slender', height: 8, lean: 0.29, leanDir: 0, fronds: 20, droop: 0.7, dead: true }, seed);
  },
}, {
  target: [6, 5, 9],
  route: around(1.2),
  walkableRoof: false,
  notes: ['Prohnutí roste s výškou (mocnina 1,5) – žádný zlom.'],
});

regK(280, 'palmStump', 'Pahýl palmy', {
  describe: () => 'kmen 3,6 m s nepravidelně ulomeným vrškem, bez koruny; odlomený kus kmene leží vedle',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    parts.push(limb([0, 0, 0], [0.05, 1.8, 0], 0.72, 0.62, 'palmBarkDate', true), limb([0.05, 1.8, 0], [0.12, 3.3, 0.04], 0.62, 0.56, 'palmBarkDate', true));
    parts.push({ shape: 'cylinder', pos: [0, 0.15, 0], size: [1.0, 0.3, 1.0], taper: 0.7, material: 'palmBarkDate' });
    // Ulomený vršek: třísky různé výšky.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      parts.push({ shape: 'box', pos: [0.12 + Math.cos(a) * 0.2, 3.3 + r() * 0.3, 0.04 + Math.sin(a) * 0.2], rot: [(r() - 0.5) * 0.4, a, (r() - 0.5) * 0.4], size: [0.12, 0.25 + r() * 0.45, 0.08], material: 'bark' });
    }
    parts.push(limb([1.2, 0.28, 0.6], [3.0, 0.25, 1.4], 0.55, 0.5, 'palmBarkDate', true), { shape: 'cylinder', pos: [3.0, 0.25, 1.4], rot: eulerYXZ(1.15, Math.PI / 2), size: [0.5, 0.05, 0.5], material: 'wood' });
    return parts;
  },
}, {
  target: [3.6, 2, 3.6],
  route: [{ p: [-1.5, 0, -1.5] }, { p: [1.5, 0, -1.5] }, { p: [2.2, 0, -0.4] }],
  walkableRoof: false,
  rays: [{ from: [-3, 1.0, 0], to: [3, 1.0, 0], hit: true, note: 'kmen kryje' }],
  notes: ['Odlomený kus (2 m) má kolizi – nízký kryt vleže.'],
});

// ---------------------------------------------------------------------------
// K281–K286 Stromy
// ---------------------------------------------------------------------------
interface TreeSpec { H: number; C: number; d: number; forkAt: number; branches: number; crownH: number; crownMat: string; leafMat: string; dry?: number; split?: boolean; flat?: boolean; cardSize?: number; cards?: number }

function tree(s: TreeSpec, seed: number): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const fork = s.H * s.forkAt;
  const tops: V3[] = [];
  if (s.split) {
    // Mohutný nízký kmen rozdělený na dvě části.
    for (const k of [-1, 1]) {
      const top: V3 = [k * 0.45 + (r() - 0.5) * 0.2, fork, (r() - 0.5) * 0.3];
      parts.push(limb([k * 0.18, 0, 0], top, s.d * 0.75, s.d * 0.55, 'bark', true));
      tops.push(top);
    }
  } else {
    const top: V3 = [(r() - 0.5) * 0.4, fork, (r() - 0.5) * 0.4];
    parts.push(limb([0, 0, 0], [top[0] * 0.5, fork * 0.5, top[2] * 0.5], s.d, s.d * 0.85, 'bark', true), limb([top[0] * 0.5, fork * 0.5, top[2] * 0.5], top, s.d * 0.85, s.d * 0.7, 'bark', true));
    tops.push(top);
  }
  parts.push({ shape: 'cylinder', pos: [0, 0.12, 0], size: [s.d * 1.6, 0.24, s.d * 1.6], taper: 0.7, material: 'bark' });
  const crownY = s.H - s.crownH * 0.5;
  const ends: V3[] = [];
  for (let i = 0; i < s.branches; i++) {
    const base = tops[i % tops.length];
    const az = (i / s.branches) * Math.PI * 2 + r() * 0.6;
    const reach = s.C * (s.flat ? 0.38 : 0.26) * (0.8 + r() * 0.4);
    const end: V3 = [base[0] + Math.sin(az) * reach, crownY - (s.flat ? 0.2 : 0) + (r() - 0.5) * 0.5, base[2] + Math.cos(az) * reach];
    // Větev ve dvou úsecích (zalomení) – silnější u kmene.
    const mid: V3 = [(base[0] + end[0]) / 2 + (r() - 0.5) * 0.3, base[1] + (end[1] - base[1]) * 0.6, (base[2] + end[2]) / 2 + (r() - 0.5) * 0.3];
    parts.push(limb(base, mid, s.d * 0.55, s.d * 0.4, 'bark'), limb(mid, end, s.d * 0.4, s.d * 0.18, 'bark'));
    ends.push(end);
  }
  // Koruna: skupiny listí nad konci větví (volné prostory mezi nimi).
  const groups = Math.max(2, Math.round(s.branches * (s.flat ? 1.2 : 0.8)));
  for (let g = 0; g < groups; g++) {
    const e = ends[g % ends.length];
    const sz: V3 = s.flat ? [s.C * 0.42, s.crownH * 0.9, s.C * 0.42] : [s.C * 0.5, s.crownH * 0.8, s.C * 0.5];
    parts.push(...foliage([e[0] * (s.flat ? 1.0 : 0.8), e[1] + sz[1] * 0.25, e[2] * (s.flat ? 1.0 : 0.8)], sz, Math.floor(r() * 1e6), s.crownMat, s.leafMat, s.flat ? 2 : 2, s.cards ?? 12, s.cardSize ?? Math.max(0.9, s.C * 0.22)));
  }
  for (let i = 0; i < (s.dry ?? 0); i++) {
    const base = tops[i % tops.length];
    const az = r() * Math.PI * 2;
    const end: V3 = [base[0] + Math.sin(az) * s.C * 0.45, s.H * (0.75 + r() * 0.2), base[2] + Math.cos(az) * s.C * 0.45];
    parts.push(limb(base, end, s.d * 0.25, 0.03, 'bark'));
  }
  return parts;
}

regK(281, 'oliveSmall', 'Malý olivovník', {
  describe: () => 'výška 3,5 m, nízký rozvětvený kmen, široká nepravidelná šedozelená koruna (skupiny karet)',
  generate(_p, seed) {
    return tree({ H: 3.5, C: 3.6, d: 0.26, forkAt: 0.35, branches: 4, crownH: 1.8, crownMat: 'crownOlive', leafMat: 'leafOlive', cardSize: 0.9 }, seed);
  },
}, {
  target: [3.6, 3.6, 3.5],
  route: around(2.0),
  walkableRoof: false,
  rays: [throughLeaves(2.8)],
  notes: [],
});

regK(282, 'oliveLarge', 'Velký olivovník', {
  describe: () => 'výška 6 m, koruna 7 m, silnější kmen, 4 hlavní větve, mezery mezi skupinami listí',
  generate(_p, seed) {
    return tree({ H: 6, C: 7, d: 0.45, forkAt: 0.35, branches: 4, crownH: 2.8, crownMat: 'crownOlive', leafMat: 'leafOlive', cardSize: 1.3, cards: 16 }, seed);
  },
}, {
  target: [7, 7, 6],
  route: around(2.5),
  walkableRoof: false,
  rays: [{ from: [-3, 1.0, 0], to: [3, 1.0, 0], hit: true, note: 'kmen' }],
  notes: [],
});

regK(283, 'oliveOld', 'Starý olivovník', {
  describe: () => 'nízký mohutný kmen rozdělený na dvě části, asymetrická koruna, 3 suché větve',
  generate(_p, seed) {
    return tree({ H: 4.8, C: 5.5, d: 0.75, forkAt: 0.3, branches: 3, crownH: 2.2, crownMat: 'crownOlive', leafMat: 'leafOlive', dry: 3, split: true, cardSize: 1.1 }, seed + 7);
  },
}, {
  target: [5.5, 5.5, 4.8],
  route: around(2.5),
  walkableRoof: false,
  rays: [{ from: [-3, 0.8, 0], to: [3, 0.8, 0], hit: true, note: 'mohutný kmen kryje' }],
  notes: [],
});

regK(284, 'acaciaSmall', 'Menší akácie', {
  describe: () => 'výška 4 m, subtilní kmen, nízko se rozbíhající větve, plochá koruna',
  generate(_p, seed) {
    return tree({ H: 4, C: 4.5, d: 0.18, forkAt: 0.22, branches: 4, crownH: 0.9, crownMat: 'crownGreen', leafMat: 'leafDry', flat: true, cardSize: 1.0 }, seed);
  },
}, {
  target: [4.5, 4.5, 4],
  route: around(2.2),
  walkableRoof: false,
  rays: [throughLeaves(3.6)],
  notes: [],
});

regK(285, 'treeUmbrella', 'Strom s deštníkovitou korunou', {
  describe: () => 'výška 8 m, koruna 10 m (plochá vodorovná silueta), silná rozvětvení pod korunou',
  generate(_p, seed) {
    return tree({ H: 8, C: 10, d: 0.55, forkAt: 0.45, branches: 6, crownH: 1.6, crownMat: 'crownGreen', leafMat: 'leafGreen', flat: true, cardSize: 1.8, cards: 14 }, seed);
  },
}, {
  target: [10, 10, 8],
  route: around(3),
  walkableRoof: false,
  notes: [],
});

regK(286, 'treeDead', 'Suchý strom', {
  describe: () => 'výška 5 m bez listí, jeden kmen, 5 pokroucených větví s ulomenými konci',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [limb([0, 0, 0], [0.15, 2.4, 0.05], 0.4, 0.32, 'bark', true), limb([0.15, 2.4, 0.05], [0.05, 4.2, -0.1], 0.32, 0.2, 'bark', true)];
    parts.push({ shape: 'cylinder', pos: [0, 0.12, 0], size: [0.6, 0.24, 0.6], taper: 0.7, material: 'bark' });
    for (let i = 0; i < 5; i++) {
      const az = (i / 5) * Math.PI * 2 + r();
      const y = 1.8 + i * 0.55;
      const base: V3 = [0.1, y, 0];
      const mid: V3 = [Math.sin(az) * 0.9, y + 0.5 + r() * 0.4, Math.cos(az) * 0.9];
      const end: V3 = [Math.sin(az + 0.4) * (1.6 + r()), y + 0.6 + r() * 0.8, Math.cos(az + 0.4) * (1.6 + r())];
      parts.push(limb(base, mid, 0.14, 0.1, 'bark'), limb(mid, end, 0.1, 0.05, 'bark'));
      parts.push({ shape: 'cylinder', pos: end, rot: eulerYXZ(az, 0.6), size: [0.07, 0.04, 0.07], material: 'wood' });
    }
    return parts;
  },
}, {
  target: [5, 5, 5],
  route: around(2.0),
  walkableRoof: false,
  rays: [{ from: [-3, 1.0, 0], to: [3, 1.0, 0], hit: true, note: 'kmen' }],
  notes: ['Drobné větvičky vynechány, větve bez kolize.'],
});

// ---------------------------------------------------------------------------
// K287–K294 Keře, agáve, tráva
// ---------------------------------------------------------------------------
regK(287, 'bushOlive', 'Nízký olivově zelený keř (pilot)', {
  describe: () => '1,15 × 1,2 × 0,8 m, souvislá nepravidelná koruna z karet s maskou + 3 objemy',
  generate(_p, seed) {
    return [stem(0.18, 0.24), ...foliage([0, 0.4, 0], [1.15, 0.8, 1.2], seed, 'crownOlive', 'leafOlive', 3, 18, 0.7)];
  },
}, {
  target: [1.14, 1.2, 0.8],
  route: [{ p: [0, 0, -1.2] }, { p: [0, 0, 1.2], note: 'skrz keř (bez kolize listí)' }],
  walkableRoof: false,
  rays: [throughLeaves(0.5, 2)],
  notes: ['Podle pilotu bush_a (1,14 × 0,8 × 1,2 m, kolize jen pahýl 0,18 m). Karty jsou tečné k povrchu koruny – nevidět obdélníky.'],
});

regK(288, 'bushDry', 'Rozložitý suchý keř (pilot)', {
  describe: () => '1,05 × 1,66 × 1,18 m, širší suchá silueta, větve a karty bez kolize',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [stem(0.18, 0.24)];
    for (let i = 0; i < 7; i++) {
      const az = (i / 7) * Math.PI * 2 + r() * 0.4;
      parts.push(limb([0, 0.1, 0], [Math.sin(az) * 0.45, 0.6 + r() * 0.5, Math.cos(az) * 0.75], 0.05, 0.02, 'bark'));
    }
    parts.push(...foliage([0, 0.6, 0], [1.05, 1.1, 1.6], seed, 'crownGreen', 'leafDry', 0, 20, 0.75));
    return parts;
  },
}, {
  target: [1.04, 1.66, 1.18],
  route: [{ p: [0, 0, -1.4] }, { p: [0, 0, 1.4], note: 'skrz keř' }],
  walkableRoof: false,
  notes: ['Podle pilotu bush_b; suchý keř bez objemů – jen větve a karty.'],
});

regK(289, 'bushDense', 'Hustý zelený keř', {
  describe: () => '1,5 × 1,5 × 1,2 m, zaoblená nepravidelná silueta, několik výhonů přesahujících objem',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [stem(0.2, 0.24), ...foliage([0, 0.6, 0], [1.5, 1.2, 1.5], seed, 'crownGreen', 'leafGreen', 4, 20, 0.75)];
    for (let i = 0; i < 4; i++) {
      const az = r() * Math.PI * 2;
      parts.push({ shape: 'card', pos: [Math.sin(az) * 0.85, 0.9 + r() * 0.4, Math.cos(az) * 0.85], rot: eulerYXZ(az, -0.6 - r() * 0.5, 0), size: [0.6, 0.9, 0], material: 'leafGreen', castShadow: true });
    }
    return parts;
  },
}, {
  target: [1.5, 1.5, 1.2],
  route: [{ p: [0, 0, -1.4] }, { p: [0, 0, 1.4], note: 'skrz keř' }],
  walkableRoof: false,
  rays: [throughLeaves(0.6, 2)],
  notes: [],
});

regK(290, 'bushDesert', 'Šedozelený pouštní keř', {
  describe: () => '2 × 1,5 × 0,8 m, nízký rozložitý, řidší střed, větve do stran',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [stem(0.14, 0.2)];
    for (let i = 0; i < 6; i++) {
      const az = (i / 6) * Math.PI * 2 + r() * 0.4;
      const end: V3 = [Math.sin(az) * 0.95, 0.35 + r() * 0.3, Math.cos(az) * 0.7];
      parts.push(limb([0, 0.05, 0], end, 0.05, 0.02, 'bark'));
      parts.push(...foliage(end, [0.8, 0.5, 0.7], Math.floor(r() * 1e6), 'crownOlive', 'leafOlive', 1, 4, 0.55));
    }
    return parts;
  },
}, {
  target: [2, 1.5, 0.8],
  route: [{ p: [0, 0, -1.4] }, { p: [0, 0, 1.4], note: 'skrz keř' }],
  walkableRoof: false,
  notes: ['Řidší střed: listí jen na koncích 6 větví.'],
});

regK(291, 'palmOrnamental', 'Nízká okrasná palma', {
  describe: () => 'výška 1,5 m, krátký robustní střed, vějířovitě rozložené listy (14 karet)',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [{ shape: 'cylinder', pos: [0, 0.3, 0], size: [0.38, 0.6, 0.38], taper: 0.75, material: 'palmBark', collide: true }];
    for (let i = 0; i < 14; i++) {
      const az = i * 2.39996 + r() * 0.2;
      parts.push({ shape: 'frond', pos: [0, 0.6, 0], rot: eulerYXZ(az, 0.55 + r() * 0.5, 0), size: [0.75, 1.1 + r() * 0.3, 0], bend: 0.25, fold: 0.7, twist: (r() - 0.5) * 0.4, material: 'palmFrond' });
    }
    return parts;
  },
}, {
  target: [2.4, 2.4, 1.5],
  route: around(1.4),
  walkableRoof: false,
  notes: [],
});

regK(292, 'agave', 'Agáve', {
  describe: () => 'růžice Ø 1,5 m, výška 1 m, 18 silných špičatých listů (zúžené válce, bez alfa)',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [stem(0.3, 0.15)];
    for (let i = 0; i < 18; i++) {
      const az = i * 2.39996;
      const ring = i / 18;
      const L = 0.6 + (1 - ring) * 0.35 + r() * 0.1;
      const el = 0.25 + ring * 0.9;
      parts.push({ shape: 'cylinder', pos: [Math.sin(az) * Math.sin(el) * L / 2, 0.12 + Math.cos(el) * L / 2, Math.cos(az) * Math.sin(el) * L / 2], rot: eulerYXZ(az, el), size: [0.15, L, 0.06], taper: 0.05, material: 'crownOlive' });
    }
    return parts;
  },
}, {
  target: [1.5, 1.5, 1],
  route: around(1.1),
  walkableRoof: false,
  notes: ['Listy bez kolize (nepřekáží), jen nízký střed.'],
});

function grass(h: number, w: number, n: number, seed: number): Part[] {
  const r = rng(seed), parts: Part[] = [{ ...stem(0.05, 0.01), render: false, moveOnly: true }];
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI + r() * 0.3;
    parts.push({ shape: 'card', pos: [(r() - 0.5) * w * 0.3, h / 2, (r() - 0.5) * w * 0.3], rot: eulerYXZ(az, (r() - 0.5) * 0.3, 0), size: [w * (0.8 + r() * 0.4), h * (0.85 + r() * 0.3), 0], material: 'leafDry' });
  }
  return parts;
}

regK(293, 'grassLow', 'Nízký trs suché trávy', {
  describe: () => '0,6 × 0,6 × 0,3 m, 4 křížené karty, bez kolize',
  generate(_p, seed) {
    return grass(0.3, 0.6, 4, seed);
  },
}, {
  target: [0.6, 0.6, 0.3],
  route: [{ p: [0, 0, -0.8] }, { p: [0, 0, 0.8], note: 'přes trs' }],
  walkableRoof: false,
  notes: ['Formální kolize 1 cm (jen pro editor), pohybu nepřekáží.'],
});

regK(294, 'grassTall', 'Vyšší trs trávy', {
  describe: () => 'výška 0,7 m, nepravidelný obrys, 6 karet s delšími stébly (materiál)',
  generate(_p, seed) {
    return grass(0.7, 0.8, 6, seed);
  },
}, {
  target: [0.8, 0.8, 0.7],
  route: [{ p: [0, 0, -0.9] }, { p: [0, 0, 0.9], note: 'přes trs' }],
  walkableRoof: false,
  notes: [],
});

// ---------------------------------------------------------------------------
// K295–K299 Balvany a skalní stěny
// ---------------------------------------------------------------------------
const rock = (x: number, y: number, z: number, s: V3, seed: number, rough = 0.35, mat = 'rock', rot?: V3): Part => ({ shape: 'blob', pos: [x, y, z], size: s, seed, rough, material: mat, collide: true, rot });

regK(295, 'boulderSmall', 'Malý balvan', {
  describe: () => 'největší rozměr 1 m, hranatě zaoblený, široká základna (spodek zapuštěný)',
  generate(_p, seed) {
    return [rock(0, 0.22, 0, [1.0, 0.65, 0.8], seed, 0.45), bx(-0.4, 0.4, -0.05, 0.08, -0.3, 0.3, 'rock')];
  },
}, {
  target: [1, 0.8, 0.55],
  route: around(1.0),
  walkableRoof: false,
  rays: [{ from: [-2, 0.3, 0], to: [0, 0.3, 0], hit: true, note: 'kryje vleže' }],
  notes: [],
});

regK(296, 'boulderMedium', 'Střední balvan', {
  describe: () => 'největší rozměr 2,5 m, jedna téměř svislá strana (kryt, −Z), druhá šikmá',
  generate(_p, seed) {
    return [rock(0.1, 0.55, 0.15, [2.5, 1.6, 1.7], seed, 0.35), { shape: 'box', pos: [0, 0.75, -0.55], rot: [0.08, 0.1, 0.03], size: [1.9, 1.5, 0.5], material: 'rock', collide: true }, rock(0.6, 0.25, 0.75, [1.2, 0.7, 1.0], seed + 3, 0.4)];
  },
}, {
  target: [2.5, 2, 1.5],
  route: [{ p: [-2, 0, -1.6], note: 'u svislé strany' }, { p: [2, 0, -1.6] }],
  walkableRoof: false,
  rays: [thru2(0, 1.2, true, 'svislá strana kryje stojícího')],
  notes: [],
});
function thru2(x: number, y: number, hit: boolean, note: string) {
  return { from: [x, y, -3] as V3, to: [x, y, 0] as V3, hit, note };
}

regK(297, 'boulderLarge', 'Velký balvan', {
  describe: () => 'největší rozměr 5 m, členitá silueta ze 4 objemů (konvexní kolize každého), široký spodek',
  generate(_p, seed) {
    return [rock(0, 0.8, 0, [4.6, 2.4, 3.2], seed, 0.3), rock(1.4, 1.6, 0.4, [2.2, 2.0, 2.0], seed + 1, 0.4), rock(-1.6, 0.6, -0.6, [2.0, 1.4, 1.8], seed + 2, 0.4), rock(0.2, 2.2, -0.3, [1.8, 1.2, 1.6], seed + 3, 0.45, 'rockWarm')];
  },
}, {
  target: [5, 3.5, 2.8],
  route: around(3.2),
  walkableRoof: false,
  rays: [thru2(0, 1.5, true, 'kryje stojícího')],
  notes: ['4 konvexní objemy místo jedné velké krabice.'],
});

/** Skalní stěna podél X: řada svislých bloků (lomové plochy) na širší základně. */
function rockWall(heights: number[], seed: number, protrude?: number, notch?: number): Part[] {
  const r = rng(seed), parts: Part[] = [];
  const L = 8, n = heights.length, seg = L / n;
  parts.push(rock(0, 0.5, 0.1, [L + 0.2, 1.4, 2.6], seed, 0.25));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + seg * (i + 0.5), h = heights[i];
    const out = i === protrude ? -0.9 : 0;
    // Svislý blok – mírně natočený, přesahuje sousedy (žádné úzké mezery).
    parts.push({ shape: 'box', pos: [x, h / 2, -0.2 + out / 2 + (r() - 0.5) * 0.15], rot: [(r() - 0.5) * 0.08, (r() - 0.5) * 0.12, (r() - 0.5) * 0.06], size: [seg + 0.35, h, 1.5 - out], material: i % 3 === 1 ? 'rockWarm' : 'rock', collide: true });
    parts.push(rock(x + (r() - 0.5) * 0.4, h - 0.2, 0.0, [seg * 0.9, 0.7, 1.4], seed + i, 0.4));
    if (i !== notch) parts.push(rock(x, h * 0.45, 0.65, [seg * 0.8, h * 0.8, 0.9], seed + 20 + i, 0.4));
  }
  return parts;
}

regK(298, 'rockWallStraight', 'Rovná skalní stěna', {
  describe: () => 'modul 8 × 2 × 5 m, svislé lomové plochy (−Z), širší základna, rovné konce pro skládání',
  generate(_p, seed) {
    return rockWall([4.8, 5.1, 4.9, 5.0], seed);
  },
}, {
  target: [8, 2, 5],
  route: [{ p: [-3.6, 0, -1.8], note: 'podél stěny' }, { p: [3.6, 0, -1.8] }],
  walkableRoof: false,
  rays: [thru2(0, 3, true, 'stěna kryje'), thru2(3.9, 3, true, 'až ke konci')],
  notes: ['Konce v x = ±4,2 m mírně přesahují – dva moduly vedle sebe se překryjí bez spáry.'],
});

regK(299, 'rockWallRugged', 'Členitá skalní stěna', {
  describe: () => 'délka 8 m, výška 3–6 m, výrazný výstupek (0,9 m), široký zářez; bez úzkých mezer',
  generate(_p, seed) {
    return rockWall([3.2, 6.0, 4.2, 3.0, 5.4], seed, 1, 3);
  },
}, {
  target: [8, 2.9, 6],
  route: [{ p: [-3.6, 0, -2.5], note: 'podél stěny' }, { p: [3.6, 0, -2.5] }],
  walkableRoof: false,
  rays: [thru2(-2.4, 4, true, 'výstupek kryje'), thru2(1.6, 3.6, false, 'zářez – nad ním volno')],
  notes: ['Bloky se překrývají o 0,35 m – hráč nikam nezapadne.'],
});

// ---------------------------------------------------------------------------
// K300 Palma v květináči
// ---------------------------------------------------------------------------
regK(300, 'palmPot', 'Palma v květináči', {
  describe: () => 'celková výška 2,5 m, nádoba Ø 0,8 × 0,7 m, krátký kmen 1 m, malá koruna 12 listů; kolize nádoba a kmen',
  generate(_p, seed) {
    const r = rng(seed), parts: Part[] = [];
    parts.push({ shape: 'cylinder', pos: [0, 0.35, 0], size: [0.8, 0.7, 0.8], taper: 1.15, material: 'concreteLight', collide: true }, { shape: 'cylinder', pos: [0, 0.71, 0], size: [0.9, 0.06, 0.9], material: 'concreteLight' }, { shape: 'cylinder', pos: [0, 0.66, 0], size: [0.72, 0.03, 0.72], material: 'dirt' });
    parts.push(limb([0, 0.65, 0], [0.04, 1.7, 0.02], 0.2, 0.16, 'palmBarkDate', true));
    for (let i = 0; i < 12; i++) {
      const az = i * 2.39996 + r() * 0.2, age = i / 12;
      parts.push({ shape: 'frond', pos: [0.04, 1.7 - age * 0.15, 0.02], rot: eulerYXZ(az, Math.PI / 2 - (0.9 - age * 1.2), 0), size: [0.55, 0.9 + age * 0.3, 0], bend: 0.12 + age * 0.25, fold: 0.7, twist: (r() - 0.5) * 0.5, material: 'palmFrondDate' });
    }
    return parts;
  },
}, {
  target: [2, 2, 2.5],
  route: around(1.3),
  walkableRoof: false,
  rays: [{ from: [-2, 0.4, 0], to: [0, 0.4, 0], hit: true, note: 'nádoba kryje vleže' }, throughLeaves(2.1)],
  notes: ['Listy bez kolize.'],
});
