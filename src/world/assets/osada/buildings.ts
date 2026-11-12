import type { Part } from '../../parts';
import { registerAsset, type Params } from '../../registry';
import { facade, fbox, openingFrame, type Facade, type Side } from '../kit';
import { OPPOSITE, SIDE_LABELS, anchorOpening, bays, bool, num, osadaMeta, shift, str, wallBand, type WallOpening } from './common';

/**
 * Parametrické budovy Skladové osady (vertikální řez: B01 vesnický dům, B08 skladová hala).
 *
 * Pivot = levý přední roh půdorysu (x 0…délka, z 0…hloubka, čelo k −Z). Prodloužení domu tedy
 * nehýbe levým rohem ani dveřmi ukotvenými od levého rohu. Fasáda se dělí na pole v metrech:
 * delší stěna = víc polí, okna i dveře mají stálou velikost.
 */

const SIDES: Side[] = ['front', 'back', 'left', 'right'];

/** Pevné rozměry modulů (B19 dveře, B21 okno) – nemění se s velikostí domu. */
export const DOOR = { width: 1.2, height: 2.3 };
export const WINDOW = { width: 1.1, height: 1.3, sill: 0.9 };

function windowFill(f: Facade, o: WallOpening, t: number, fill: string): Part[] {
  const w = -t * 0.62;
  const size: [number, number, number] = [o.width, o.top - o.bottom, 0.04];
  const v = (o.top + o.bottom) / 2;
  if (fill === 'glass') return [fbox(f, o.u, v, w, size, 'glass', { collide: true })];
  if (fill === 'shutter') return [fbox(f, o.u, v, -0.06, [o.width, o.top - o.bottom, 0.05], 'shutter', { collide: true })];
  if (fill === 'bars') {
    const out: Part[] = [];
    const k = Math.max(3, Math.round(o.width / 0.14));
    for (let i = 1; i < k; i++) out.push(fbox(f, o.u - o.width / 2 + (i * o.width) / k, v, -0.08, [0.02, o.top - o.bottom, 0.02], 'metal'));
    out.push(fbox(f, o.u, v, -0.08, size, 'metal', { render: false, collide: true, moveOnly: true }));
    return out;
  }
  return [];
}

// ---------------------------------------------------------------- B01 vesnický dům

export interface HouseLayout {
  L: number;
  D: number;
  /** Otvory po stěnách (u od středu stěny). */
  openings: Record<Side, WallOpening[]>;
  doors: { side: Side; u: number }[];
  windows: number;
  conflicts: string[];
}

export function houseLayout(p: Params): HouseLayout {
  const L = num(p, 'length'), D = num(p, 'depth'), t = num(p, 'wall');
  const openings: Record<Side, WallOpening[]> = { front: [], back: [], left: [], right: [] };
  const conflicts: string[] = [];
  const doorSide = str(p, 'doorWall') as Side;
  const locked = bool(p, 'doorLock');
  const lenOf = (s: Side) => (s === 'front' || s === 'back' ? L : D);
  const doors: { side: Side; u: number }[] = [];
  const bayW = num(p, 'bay');
  const addDoor = (side: Side, from: number) => {
    const len = lenOf(side);
    const a = anchorOpening(len, from, DOOR.width, t + 0.35, locked, bays(len, bayW).centers);
    if (a.conflict) conflicts.push(`Dveře (${SIDE_LABELS.find((x) => x.value === side)!.label}): ${a.conflict}`);
    doors.push({ side, u: a.u });
    openings[side].push({ u: a.u, width: DOOR.width, bottom: 0, top: DOOR.height });
  };
  addDoor(doorSide, num(p, 'doorAt'));
  // Průchozí přízemí: druhé dveře naproti (zrcadlově, aby šla rovná cesta skrz).
  if (str(p, 'interior') === 'walk') {
    const opp = OPPOSITE[doorSide];
    addDoor(opp, lenOf(opp) - num(p, 'doorAt'));
  }
  let windows = 0;
  if (bool(p, 'windows'))
    for (const s of SIDES) {
      const len = lenOf(s);
      for (const c of bays(len, bayW).centers) {
        if (c - WINDOW.width / 2 < -len / 2 + t + 0.3 || c + WINDOW.width / 2 > len / 2 - t - 0.3) continue;
        if (openings[s].some((o) => o.bottom === 0 && Math.abs(o.u - c) < o.width / 2 + WINDOW.width / 2 + 0.35)) continue;
        openings[s].push({ u: c, width: WINDOW.width, bottom: WINDOW.sill, top: WINDOW.sill + WINDOW.height });
        windows++;
      }
    }
  const clear = num(p, 'height') - num(p, 'parapet') - 0.2;
  if (clear < 2.45) conflicts.push(`světlá výška interiéru ${clear.toFixed(2)} m je nižší než 2,45 m – zvyš výšku nebo sniž atiku`);
  return { L, D, openings, doors, windows, conflicts };
}

registerAsset({
  assetId: 'osada.house',
  label: osadaMeta('osada.house', 'B01', 'Vesnický dům', 'A'),
  category: 'osada',
  generatorVersion: 1,
  sizeParams: { x: 'length', z: 'depth', y: 'height' },
  params: [
    { key: 'length', label: 'Délka (X)', type: 'number', min: 5, max: 24, step: 0.5, unit: 'm', default: 8 },
    { key: 'depth', label: 'Hloubka (Z)', type: 'number', min: 4, max: 14, step: 0.5, unit: 'm', default: 7 },
    { key: 'height', label: 'Výška k hraně atiky', type: 'number', min: 3, max: 4.6, step: 0.1, unit: 'm', default: 3.5 },
    { key: 'parapet', label: 'Výška atiky', type: 'number', min: 0.2, max: 1.1, step: 0.05, unit: 'm', default: 0.5 },
    { key: 'wall', label: 'Tloušťka zdi', type: 'number', min: 0.2, max: 0.5, step: 0.05, unit: 'm', default: 0.3 },
    { key: 'bay', label: 'Cílová šířka fasádního pole', type: 'number', min: 2.2, max: 4.5, step: 0.1, unit: 'm', default: 3 },
    {
      key: 'interior',
      label: 'Interiér',
      type: 'enum',
      default: 'closed',
      options: [
        { value: 'closed', label: 'Uzavřená budova' },
        { value: 'walk', label: 'Průchozí přízemí' },
      ],
    },
    { key: 'doorWall', label: 'Stěna dveří', type: 'enum', default: 'front', options: SIDE_LABELS },
    { key: 'doorAt', label: 'Dveře od levého rohu (zvenku)', type: 'number', min: 0, max: 24, step: 0.05, unit: 'm', default: 4 },
    { key: 'doorLock', label: 'Zamknout polohu dveří', type: 'bool', default: false },
    { key: 'windows', label: 'Okna v polích', type: 'bool', default: true },
    {
      key: 'windowFill',
      label: 'Výplň oken',
      type: 'enum',
      default: 'glass',
      options: [
        { value: 'glass', label: 'Neprůhledné sklo (blokuje střely)' },
        { value: 'shutter', label: 'Okenice (blokuje vše)' },
        { value: 'bars', label: 'Mříž (střely projdou, hráč ne)' },
        { value: 'open', label: 'Otevřené' },
      ],
    },
  ],
  materials: ['plasterWarm', 'plaster', 'plasterWhite', 'plasterOchre', 'sandstone', 'brick'],
  defaultMaterial: 'plasterWarm',
  describe(p) {
    const l = houseLayout(p);
    const b = bays(l.L, num(p, 'bay'));
    return `${l.L} × ${l.D} × ${num(p, 'height')} m · čelo ${b.count} polí po ${b.width.toFixed(2)} m · ${l.windows} oken, ${l.doors.length} dveře · plochá střecha s atikou (nepřístupná)`;
  },
  validate: (p) => houseLayout(p).conflicts,
  generate(p, _seed, material) {
    const l = houseLayout(p);
    const { L, D } = l;
    const H = num(p, 'height'), t = num(p, 'wall'), par = num(p, 'parapet');
    const walk = str(p, 'interior') === 'walk';
    const fill = str(p, 'windowFill');
    const trim = 'concreteLight';
    const parts: Part[] = [];
    const plinth = 0.45;
    for (const s of SIDES) {
      const f = facade(s, L, D);
      const long = s === 'front' || s === 'back';
      const len = long ? L : D - 2 * t;
      const ops = l.openings[s];
      parts.push(...wallBand(f, len, 0, H, t, ops, material));
      // Sokl: tenký obklad zvenku, se stejnými otvory (render; kolize drží zeď).
      parts.push(...wallBand(f, long ? L + 0.08 : D, 0, plinth, 0.04, ops, 'concreteDark', { collide: false, castShadow: false }, 0.02));
      // Římsa v úrovni střechy a krycí deska atiky.
      parts.push(fbox(f, 0, H - par - 0.06, 0.025, [long ? L + 0.1 : D, 0.12, 0.05], trim));
      parts.push(fbox(f, 0, H + 0.04, -t / 2, [long ? L + 0.08 : D - 2 * t - 0.08 + 0.001, 0.08, t + 0.08], trim, { collide: true }));
      for (const o of ops) {
        parts.push(...openingFrame(f, { u: o.u, width: o.width, bottom: o.bottom, top: o.top }, t, trim, o.bottom > 0));
        if (o.bottom > 0) parts.push(...windowFill(f, o, t, fill));
        else if (!walk) {
          // Uzavřená budova: pevné dveře (BF2 – nevstupuje se), zapuštěné v ostění.
          parts.push(fbox(f, o.u, o.top / 2, -t * 0.55, [o.width, o.top, 0.06], 'woodDark', { collide: true }));
          parts.push(fbox(f, o.u + o.width * 0.32, 1.05, -t * 0.55 + 0.05, [0.05, 0.05, 0.06], 'metal'));
        } else {
          // Práh: nízký, aby nezasekával (0,04 m).
          parts.push(fbox(f, o.u, 0.02, -t / 2, [o.width, 0.04, t], trim));
        }
      }
    }
    // Střešní deska uvnitř atiky (spád do vpustí jen vizuálně), podlaha a strop interiéru.
    parts.push({ shape: 'box', pos: [0, H - par - 0.1, 0], size: [L - 2 * t, 0.2, D - 2 * t], material: 'concreteDark', collide: true });
    parts.push({ shape: 'box', pos: [0, H - par + 0.005, 0], size: [L - 2 * t, 0.01, D - 2 * t], material: 'roof', castShadow: false });
    if (walk) parts.push({ shape: 'box', pos: [0, 0.03, 0], size: [L - 2 * t, 0.06, D - 2 * t], material: 'concreteLight', collide: true, castShadow: false });
    // Střešní vpusť a chrlič na zadní stěně (silueta, žádná kolize).
    parts.push({ shape: 'box', pos: [L / 2 - t - 0.3, H - par + 0.03, D / 2 - t - 0.3], size: [0.3, 0.04, 0.3], material: 'metal' });
    parts.push({ shape: 'box', pos: [L / 2 - t - 0.3, H - par + 0.05, D / 2 + 0.2], size: [0.14, 0.1, 0.5], material: 'metal' });
    return shift(parts, L / 2, D / 2);
  },
});

// ---------------------------------------------------------------- B08 skladová hala

export interface HallLayout {
  L: number;
  W: number;
  eave: number;
  ridge: number;
  bayCount: number;
  bayWidth: number;
  openings: Record<Side, WallOpening[]>;
  gates: { side: Side; u: number }[];
  conflicts: string[];
}

export function hallLayout(p: Params): HallLayout {
  const L = num(p, 'length'), W = num(p, 'width'), E = num(p, 'eave');
  const ridge = E + (W / 2) * Math.tan((num(p, 'pitch') * Math.PI) / 180);
  const t = 0.25;
  const b = bays(L, num(p, 'bay'), 2);
  const openings: Record<Side, WallOpening[]> = { front: [], back: [], left: [], right: [] };
  const conflicts: string[] = [];
  const gates: { side: Side; u: number }[] = [];
  const gw = num(p, 'gateWidth'), gh = Math.min(num(p, 'gateHeight'), E - 0.6);
  if (gh < num(p, 'gateHeight') - 1e-6) conflicts.push(`vrata ${num(p, 'gateHeight')} m jsou vyšší než okap; omezena na ${gh.toFixed(2)} m`);
  const lenOf = (s: Side) => (s === 'front' || s === 'back' ? L : W);
  const gateSide = str(p, 'gateWall') as Side;
  const addGate = (side: Side, from: number) => {
    const len = lenOf(side);
    const centers = side === 'front' || side === 'back' ? b.centers : [0];
    const a = anchorOpening(len, from, gw, t + 0.45, bool(p, 'gateLock'), centers);
    if (a.conflict) conflicts.push(`Vrata (${SIDE_LABELS.find((x) => x.value === side)!.label}): ${a.conflict}`);
    gates.push({ side, u: a.u });
    openings[side].push({ u: a.u, width: gw, bottom: 0, top: gh });
  };
  addGate(gateSide, num(p, 'gateAt'));
  if (bool(p, 'through')) addGate(OPPOSITE[gateSide], lenOf(OPPOSITE[gateSide]) - num(p, 'gateAt'));
  // Boční dveře do štítu, který nemá vrata.
  if (bool(p, 'sideDoor')) {
    const s: Side = openings.left.length ? (openings.right.length ? 'front' : 'right') : 'left';
    const len = lenOf(s);
    const free = (s === 'front' ? [L / 4, -L / 4] : [W / 4, -W / 4, 0]).find((u) => !openings[s].some((o) => Math.abs(o.u - u) < o.width / 2 + DOOR.width / 2 + 0.4) && Math.abs(u) + DOOR.width / 2 < len / 2 - t - 0.4);
    if (free !== undefined) openings[s].push({ u: free, width: DOOR.width, bottom: 0, top: DOOR.height });
  }
  // Horní pás oken v každém poli dlouhých stěn (mimo pole s vraty).
  const winB = E - 1.75, winT = E - 0.75;
  for (const s of ['front', 'back'] as Side[])
    for (const c of b.centers) {
      if (openings[s].some((o) => o.top > winB - 0.3 && Math.abs(o.u - c) < o.width / 2 + 1.2)) continue;
      openings[s].push({ u: c, width: Math.min(2.4, b.width - 1.2), bottom: winB, top: winT });
    }
  return { L, W, eave: E, ridge, bayCount: b.count, bayWidth: b.width, openings, gates, conflicts };
}

registerAsset({
  assetId: 'osada.hall',
  label: osadaMeta('osada.hall', 'B08', 'Skladová hala', 'A'),
  category: 'osada',
  generatorVersion: 1,
  sizeParams: { x: 'length', z: 'width', y: 'eave' },
  params: [
    { key: 'length', label: 'Délka (X)', type: 'number', min: 12, max: 60, step: 0.5, unit: 'm', default: 24 },
    { key: 'width', label: 'Šířka (Z)', type: 'number', min: 8, max: 26, step: 0.5, unit: 'm', default: 14 },
    { key: 'eave', label: 'Výška okapu', type: 'number', min: 4.5, max: 9, step: 0.1, unit: 'm', default: 5.5 },
    { key: 'pitch', label: 'Sklon střechy', type: 'number', min: 6, max: 25, step: 0.5, unit: '°', default: 12 },
    { key: 'bay', label: 'Cílová šířka konstrukčního pole', type: 'number', min: 4, max: 8, step: 0.25, unit: 'm', default: 6 },
    { key: 'plinth', label: 'Výška betonového soklu', type: 'number', min: 0.4, max: 2, step: 0.1, unit: 'm', default: 1.1 },
    { key: 'gateWall', label: 'Stěna vrat', type: 'enum', default: 'front', options: SIDE_LABELS },
    { key: 'gateAt', label: 'Vrata od levého rohu (zvenku)', type: 'number', min: 0, max: 60, step: 0.05, unit: 'm', default: 9 },
    { key: 'gateLock', label: 'Zamknout polohu vrat', type: 'bool', default: false },
    { key: 'gateWidth', label: 'Šířka vrat', type: 'number', min: 3, max: 6, step: 0.1, unit: 'm', default: 3.5 },
    { key: 'gateHeight', label: 'Výška vrat', type: 'number', min: 3, max: 6, step: 0.1, unit: 'm', default: 4 },
    {
      key: 'gateState',
      label: 'Stav vrat',
      type: 'enum',
      default: 'open',
      options: [
        { value: 'open', label: 'Otevřená (křídla odsunutá)' },
        { value: 'closed', label: 'Zavřená (pevná kolize)' },
      ],
    },
    { key: 'through', label: 'Druhá vrata naproti (průjezd)', type: 'bool', default: true },
    { key: 'sideDoor', label: 'Boční dveře ve štítu', type: 'bool', default: true },
  ],
  materials: ['metalSheet', 'metalSheetRust', 'brick', 'concrete'],
  defaultMaterial: 'metalSheet',
  describe(p) {
    const l = hallLayout(p);
    return `${l.L} × ${l.W} m, okap ${l.eave} m, hřeben ${l.ridge.toFixed(2)} m · ${l.bayCount} polí po ${l.bayWidth.toFixed(2)} m · ${l.gates.length} vrata`;
  },
  validate: (p) => hallLayout(p).conflicts,
  generate(p, _seed, material) {
    const l = hallLayout(p);
    const { L, W, eave: E, ridge } = l;
    const t = 0.25, pl = Math.min(num(p, 'plinth'), E - 1);
    const pitch = (num(p, 'pitch') * Math.PI) / 180;
    const closed = str(p, 'gateState') === 'closed';
    const parts: Part[] = [];
    const steel = 'paintedMetal', blue = 'paintedMetalBlue';
    for (const s of SIDES) {
      const f = facade(s, L, W);
      const long = s === 'front' || s === 'back';
      const len = long ? L : W - 2 * t;
      const ops = l.openings[s];
      parts.push(...wallBand(f, len, 0, pl, t, ops, 'concrete'));
      parts.push(...wallBand(f, len, pl, E, t, ops, material));
      // Okapový lem soklu.
      parts.push(...wallBand(f, long ? L + 0.06 : W, pl - 0.04, pl + 0.04, 0.06, ops, 'concreteLight', { collide: false }, 0.03));
      for (const o of ops) {
        const h = o.top - o.bottom;
        if (o.bottom > 0) {
          // Horní okno: rám a neprůhledné drátosklo (blokuje střely).
          parts.push(fbox(f, o.u, (o.top + o.bottom) / 2, -t * 0.5, [o.width, h, 0.04], 'glass', { collide: true }));
          parts.push(fbox(f, o.u, o.top + 0.05, 0.02, [o.width + 0.12, 0.1, 0.08], steel));
          parts.push(fbox(f, o.u, o.bottom - 0.05, 0.04, [o.width + 0.12, 0.1, 0.12], steel));
          for (let i = 1; i < 3; i++) parts.push(fbox(f, o.u - o.width / 2 + (i * o.width) / 3, (o.top + o.bottom) / 2, -0.06, [0.05, h, 0.05], steel));
          continue;
        }
        const isGate = o.width > DOOR.width + 0.1;
        const frame = isGate ? blue : steel;
        // Ocelová zárubeň.
        for (const sg of [-1, 1]) parts.push(fbox(f, o.u + sg * (o.width / 2 + 0.08), h / 2, 0.04, [0.16, h, 0.16], frame, { collide: true }));
        parts.push(fbox(f, o.u, o.top + 0.1, 0.04, [o.width + 0.32, 0.2, 0.16], frame, { collide: true }));
        if (!isGate) {
          parts.push(fbox(f, o.u, h / 2, -t * 0.5, [o.width, h, 0.05], blue, { collide: true }));
          continue;
        }
        const leaf = (u: number, w: number, z: number) => {
          parts.push(fbox(f, u, h / 2 + 0.02, z, [w, h - 0.04, 0.06], blue, { collide: true }));
          const ribs = Math.max(2, Math.round(w / 0.5));
          for (let i = 0; i <= ribs; i++) parts.push(fbox(f, u - w / 2 + (i * w) / ribs, h / 2, z + 0.05, [0.06, h - 0.1, 0.04], frame));
          parts.push(fbox(f, u, h * 0.5, z + 0.05, [w, 0.08, 0.04], frame));
        };
        // Posuvná vrata: kolejnice nad otvorem; zavřená v otvoru, otevřená odsunutá podél stěny.
        parts.push(fbox(f, o.u, o.top + 0.3, 0.14, [o.width * 2 + 0.6, 0.12, 0.1], steel));
        if (closed) {
          leaf(o.u - o.width / 4, o.width / 2, 0.14);
          leaf(o.u + o.width / 4, o.width / 2, 0.14);
        } else {
          for (const sg of [-1, 1]) {
            const u = o.u + sg * (o.width * 0.75 + 0.1);
            if (Math.abs(u) + o.width / 4 < (long ? L : W) / 2 + 0.2) leaf(u, o.width / 2, 0.22);
          }
        }
      }
      if (long) {
        // Pilastry na hranicích polí (mimo otvory vrat) – opakovaná konstrukční sekce.
        for (let i = 0; i <= l.bayCount; i++) {
          const u = -L / 2 + i * l.bayWidth;
          if (ops.some((o) => o.bottom === 0 && Math.abs(o.u - u) < o.width / 2 + 0.45)) continue;
          parts.push(fbox(f, u, E / 2, 0.09, [0.36, E, 0.18], 'concrete', { collide: true }));
        }
        // Okapový žlab.
        parts.push(fbox(f, 0, E - 0.02, 0.5, [L + 0.7, 0.14, 0.16], 'metal'));
      }
    }
    // Štíty: trojúhelník nad okapem ze dvou klínů (pevná kolize).
    const rise = ridge - E;
    for (const sx of [-1, 1]) {
      const x = sx * (L / 2 - t / 2);
      parts.push({ shape: 'wedge', pos: [x, E + rise / 2, -W / 4], size: [t, rise, W / 2], material, collide: true });
      parts.push({ shape: 'wedge', pos: [x, E + rise / 2, W / 4], rot: [0, Math.PI, 0], size: [t, rise, W / 2], material, collide: true });
      // Větrací mřížka ve štítu.
      parts.push({ shape: 'box', pos: [sx * (L / 2 + 0.02), E + rise * 0.35, 0], size: [0.04, 0.6, 1.2], material: 'metal' });
    }
    // Střecha: dvě plochy plechu s přesahem, hřebenáč.
    const ovE = 0.5, ovG = 0.3, th = 0.12;
    const slope = W / 2 / Math.cos(pitch) + ovE / Math.cos(pitch);
    for (const sz of [-1, 1]) {
      const zMid = sz * ((W / 2 + ovE) / 2);
      const yMid = ridge - ((W / 2 + ovE) / 2) * Math.tan(pitch) + (th / 2) / Math.cos(pitch);
      parts.push({ shape: 'box', pos: [0, yMid, zMid], rot: [sz * pitch, 0, 0], size: [L + 2 * ovG, th, slope], material: 'roof', collide: true });
    }
    parts.push({ shape: 'box', pos: [0, ridge + th + 0.03, 0], size: [L + 2 * ovG + 0.04, 0.1, 0.5], material: 'metal' });
    // Uvnitř: podlaha a ocelové vazníky v hranicích polí (bez kolize – hráč pod nimi projde).
    parts.push({ shape: 'box', pos: [0, 0.025, 0], size: [L - 2 * t, 0.05, W - 2 * t], material: 'concreteLight', collide: true, castShadow: false });
    for (let i = 1; i < l.bayCount; i++) {
      const x = -L / 2 + i * l.bayWidth;
      parts.push({ shape: 'box', pos: [x, E - 0.2, 0], size: [0.2, 0.3, W - 2 * t], material: steel });
      for (const sz of [-1, 1]) {
        const zm = (sz * (W / 2 - t)) / 2;
        parts.push({ shape: 'box', pos: [x, E + rise / 2 - 0.15, zm], rot: [sz * pitch, 0, 0], size: [0.18, 0.25, (W / 2 - t) / Math.cos(pitch)], material: steel });
      }
    }
    return shift(parts, L / 2, W / 2);
  },
});
