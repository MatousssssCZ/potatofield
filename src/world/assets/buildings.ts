import { rng } from '../../shared/math';
import type { Part } from '../parts';
import { registerAsset, type AssetDef, type ParamSpec, type Params } from '../registry';
import { facade, fbox, type Side } from './kit';

/**
 * Parametrické uzavřené budovy (bez interiéru). Rozměry v modulech: rozšíření
 * přidá okenní osu, další patro přidá řadu oken a posune střechu. Okna, římsy
 * a dveře se nedeformují – jen opakují. Tělo je pevné; vstupy jsou dekorativní
 * a zavřené (žádné otvory do neexistujícího interiéru). Střecha je pochozí
 * a má skutečnou kolizi včetně atiky.
 */

type Family = 'residential' | 'commercial' | 'industrial' | 'hotel';

const n = (p: Params, k: string) => p[k] as number;

function commonParams(d: { w: number; d: number; floors: number; fh: number; mod: number; windows: string; parapet: boolean }): ParamSpec[] {
  return [
    { key: 'widthMod', label: 'Šířka', type: 'int', min: 1, max: 16, step: 1, unit: 'mod', default: d.w },
    { key: 'depthMod', label: 'Hloubka', type: 'int', min: 1, max: 12, step: 1, unit: 'mod', default: d.d },
    { key: 'floors', label: 'Patra', type: 'int', min: 1, max: 12, step: 1, default: d.floors },
    { key: 'module', label: 'Šířka modulu', type: 'number', min: 2.4, max: 4.5, step: 0.1, unit: 'm', default: d.mod },
    { key: 'floorHeight', label: 'Výška patra', type: 'number', min: 2.6, max: 6, step: 0.1, unit: 'm', default: d.fh },
    {
      key: 'windows',
      label: 'Okna',
      type: 'enum',
      default: d.windows,
      options: [
        { value: 'plain', label: 'Jednoduchá' },
        { value: 'shutters', label: 'S okenicemi' },
        { value: 'balcony', label: 'Balkony' },
        { value: 'tall', label: 'Vysoká' },
        { value: 'strip', label: 'Pásová (hala)' },
      ],
    },
    { key: 'parapet', label: 'Střešní atika', type: 'bool', default: d.parapet },
    {
      key: 'blank',
      label: 'Slepá štítová stěna',
      type: 'enum',
      default: 'none',
      options: [
        { value: 'none', label: 'Žádná' },
        { value: 'left', label: 'Vlevo' },
        { value: 'right', label: 'Vpravo' },
        { value: 'both', label: 'Obě' },
      ],
    },
    { key: 'details', label: 'Klimatizace a detaily', type: 'bool', default: true },
  ];
}

function dims(p: Params) {
  const mod = n(p, 'module');
  return { W: n(p, 'widthMod') * mod, D: n(p, 'depthMod') * mod, H: n(p, 'floors') * n(p, 'floorHeight'), mod, fh: n(p, 'floorHeight'), floors: n(p, 'floors') };
}

interface Style {
  wall: string;
  trim: string;
  base: string;
  shutter: string;
  door: string;
}

function buildingParts(family: Family, p: Params, seed: number, wall: string): Part[] {
  const { W, D, H, mod, fh, floors } = dims(p);
  const r = rng(seed);
  const style: Style =
    family === 'industrial'
      ? { wall, trim: 'concreteLight', base: 'concreteDark', shutter: 'shutter', door: 'shutter' }
      : { wall, trim: wall === 'brick' ? 'sandstone' : 'concreteLight', base: 'concreteDark', shutter: ['woodDark', 'paintedMetalBlue', 'paintedMetal'][Math.floor(r() * 3)], door: 'woodDark' };
  const parts: Part[] = [];
  // Pevné tělo – jedna kolize, render po plochách (dělení zajišťuje geometrie).
  parts.push({ shape: 'box', pos: [0, H / 2, 0], size: [W, H, D], material: wall, collide: true });
  parts.push({ shape: 'box', pos: [0, 0.3, 0], size: [W + 0.08, 0.6, D + 0.08], material: style.base, collide: true });
  if (family !== 'industrial') {
    for (let f = 1; f < floors; f++) parts.push({ shape: 'box', pos: [0, f * fh, 0], size: [W + 0.1, 0.14, D + 0.1], material: style.trim });
    // Nárožní pilastry.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ shape: 'box', pos: [(sx * W) / 2, H / 2, (sz * D) / 2], size: [0.32, H, 0.32], material: style.trim });
  }
  // Střecha: hlavní římsa, krytina a atika (pochozí, s kolizí).
  const parapet = p.parapet as boolean;
  parts.push({ shape: 'box', pos: [0, H + 0.1, 0], size: [W + 0.3, 0.2, D + 0.3], material: style.trim, collide: true });
  parts.push({ shape: 'box', pos: [0, H + 0.21, 0], size: [W - 0.4, 0.02, D - 0.4], material: 'roof', collide: false });
  const ph = family === 'hotel' ? 1.1 : family === 'industrial' ? 0.5 : 0.95;
  if (parapet) {
    const t = 0.25;
    parts.push({ shape: 'box', pos: [0, H + 0.2 + ph / 2, -D / 2 + t / 2], size: [W, ph, t], material: wall, collide: true });
    parts.push({ shape: 'box', pos: [0, H + 0.2 + ph / 2, D / 2 - t / 2], size: [W, ph, t], material: wall, collide: true });
    parts.push({ shape: 'box', pos: [-W / 2 + t / 2, H + 0.2 + ph / 2, 0], size: [t, ph, D - 2 * t], material: wall, collide: true });
    parts.push({ shape: 'box', pos: [W / 2 - t / 2, H + 0.2 + ph / 2, 0], size: [t, ph, D - 2 * t], material: wall, collide: true });
    parts.push({ shape: 'box', pos: [0, H + 0.2 + ph + 0.04, 0], size: [W + 0.06, 0.08, D + 0.06], material: style.trim });
    // krycí lišta jen po obvodu (vnitřek přeložen krytinou)
    parts.pop();
    for (const [x, z, sx, sz] of [
      [0, -D / 2 + t / 2, W + 0.06, t + 0.08],
      [0, D / 2 - t / 2, W + 0.06, t + 0.08],
      [-W / 2 + t / 2, 0, t + 0.08, D],
      [W / 2 - t / 2, 0, t + 0.08, D],
    ] as const)
      parts.push({ shape: 'box', pos: [x, H + 0.2 + ph + 0.04, z], size: [sx, 0.08, sz], material: style.trim });
  }
  // Výlez na střechu a technika.
  if (p.details) {
    parts.push({ shape: 'box', pos: [W / 4, H + 0.55, D / 4], size: [1.0, 0.7, 1.0], material: 'concreteLight', collide: true });
    parts.push({ shape: 'box', pos: [W / 4, H + 0.93, D / 4], size: [1.1, 0.06, 1.1], material: 'paintedMetal' });
    if (r() > 0.3) parts.push({ shape: 'cylinder', pos: [-W / 4, H + 1.0, -D / 5], size: [1.2, 1.6, 1.2], material: 'metal', collide: true });
    if (family === 'industrial') {
      for (let i = 0; i < Math.max(1, Math.floor(W / 6)); i++) {
        parts.push({ shape: 'box', pos: [-W / 2 + 3 + i * 6, H + 0.6, 0], size: [1.4, 0.8, 1.4], material: 'metal', collide: true });
      }
    }
  }

  const blank = p.blank as string;
  const sides: Side[] = ['front', 'back', 'left', 'right'];
  for (const side of sides) {
    if ((side === 'left' && (blank === 'left' || blank === 'both')) || (side === 'right' && (blank === 'right' || blank === 'both'))) continue;
    const f = facade(side, W, D);
    const mods = Math.round(f.len / mod);
    for (let m = 0; m < mods; m++) {
      const u = -f.len / 2 + (m + 0.5) * mod;
      for (let fl = 0; fl < floors; fl++) {
        const base = fl * fh;
        const isGround = fl === 0;
        const centerMod = m === Math.floor(mods / 2);
        if (isGround && side === 'front') {
          if (family === 'commercial' || family === 'hotel') {
            shopfront(parts, f, u, mod, fh, r, family === 'hotel' && centerMod);
            continue;
          }
          if (family === 'industrial') {
            if (centerMod) {
              rollerDoor(parts, f, u, Math.min(mod * 1.4, 4.5), Math.min(fh - 0.6, 4.2), r);
              continue;
            }
          } else if (centerMod) {
            entranceDoor(parts, f, u, style);
            continue;
          }
        }
        if (family === 'industrial') {
          if (fl === floors - 1) stripWindow(parts, f, u, mod, base + fh - 1.6);
          continue;
        }
        windowModule(parts, f, u, base, fh, p.windows as string, style, r, isGround, Boolean(p.details), m, fl);
      }
    }
    if (family === 'industrial' && side !== 'front') {
      // Svislé lišty plechového pláště každý modul.
      for (let m = 0; m <= mods; m++) parts.push(fbox(f, -f.len / 2 + m * mod, H / 2, 0.03, [0.1, H, 0.06], 'metal'));
    }
  }
  if (family === 'commercial' || family === 'hotel') {
    // Pás pro vývěsní štít nad obchody.
    const f = facade('front', W, D);
    parts.push(fbox(f, 0, fh - 0.25, 0.08, [W, 0.5, 0.16], style.trim));
    const text = String(p.signText ?? '');
    if (text) parts.push({ shape: 'label', pos: f.pos(0, fh - 0.25, 0.17), rot: f.rot, size: [Math.min(W - 1, text.length * 0.42), 0.42, 0], material: 'label', text });
  }
  if (family === 'hotel') {
    // Střešní nápis hotelu na nosné konstrukci.
    const name = String(p.hotelName ?? 'HOTEL');
    const sw = Math.min(W - 1, Math.max(4, name.length * 1.1));
    const y = H + 0.2 + ph + 1.6;
    for (const s of [-1, 1]) parts.push({ shape: 'box', pos: [(s * sw) / 2.4, H + 0.2 + ph + 0.7, -D / 2 + 0.6], size: [0.12, 1.6, 0.12], material: 'metal' });
    parts.push({ shape: 'box', pos: [0, y, -D / 2 + 0.6], size: [sw + 0.3, 1.5, 0.14], material: 'paintedMetalRed' });
    parts.push({ shape: 'label', pos: [0, y, -D / 2 + 0.52], rot: [0, Math.PI, 0], size: [sw, 1.2, 0], material: 'labelHotel', text: name });
    // Markýza nad vstupem.
    const f = facade('front', W, D);
    parts.push(fbox(f, 0, 3.0, 1.0, [Math.min(W * 0.4, 6), 0.18, 2.0], 'paintedMetal', { collide: true }));
    for (const s of [-1, 1]) parts.push(fbox(f, (s * Math.min(W * 0.4, 6)) / 2.3, 1.5, 1.85, [0.12, 3.0, 0.12], 'metal', { collide: true }));
  }
  return parts;
}

function windowModule(parts: Part[], f: ReturnType<typeof facade>, u: number, base: number, fh: number, variant: string, style: Style, r: () => number, ground: boolean, details: boolean, m: number, fl: number) {
  const tall = variant === 'tall' || (variant === 'balcony' && !ground && m % 2 === 0);
  const w = tall ? 1.1 : 1.25;
  const h = tall ? Math.min(2.3, fh - 0.6) : Math.min(1.5, fh - 1.2);
  const bottom = base + (tall ? 0.15 : 0.9) + (ground ? 0.2 : 0);
  const cy = bottom + h / 2;
  // Sklo mírně uvnitř rámu – stín nadpraží dává oknu hloubku.
  parts.push(fbox(f, u, cy, 0.004, [w, h, 0.02], 'glass'));
  parts.push(fbox(f, u, cy, 0.03, [0.05, h, 0.05], style.trim === 'sandstone' ? 'woodDark' : 'paintedMetal'));
  if (!tall) parts.push(fbox(f, u, cy + h * 0.18, 0.03, [w, 0.05, 0.05], style.trim === 'sandstone' ? 'woodDark' : 'paintedMetal'));
  parts.push(fbox(f, u, bottom + h + 0.09, 0.07, [w + 0.3, 0.18, 0.14], style.trim));
  parts.push(fbox(f, u, bottom - 0.05, 0.09, [w + 0.3, 0.09, 0.2], style.trim));
  for (const s of [-1, 1]) parts.push(fbox(f, u + (s * (w + 0.1)) / 2, cy, 0.04, [0.1, h, 0.08], style.trim));
  if (variant === 'shutters') {
    const open = r() > 0.25;
    if (open) for (const s of [-1, 1]) parts.push(fbox(f, u + s * (w * 0.75 + 0.12), cy, 0.06, [w / 2, h, 0.04], style.shutter));
    else parts.push(fbox(f, u, cy, 0.05, [w, h, 0.04], style.shutter));
  }
  if (variant === 'balcony' && !ground && m % 2 === 0) {
    parts.push(fbox(f, u, base + 0.06, 0.45, [w + 1.0, 0.12, 0.9], style.trim, { collide: true }));
    parts.push(fbox(f, u, base + 0.6, 0.86, [w + 1.0, 0.05, 0.05], 'metal'));
    for (let k = 0; k <= 6; k++) parts.push(fbox(f, u - (w + 1.0) / 2 + (k * (w + 1.0)) / 6, base + 0.36, 0.86, [0.03, 0.5, 0.03], 'metal'));
    for (const s of [-1, 1]) {
      parts.push(fbox(f, u + (s * (w + 1.0)) / 2, base + 0.6, 0.47, [0.05, 0.05, 0.8], 'metal'));
    }
    parts.push(fbox(f, u, base + 0.55, 0.86, [w + 1.0, 1.0, 0.05], 'metal', { collide: true, render: false, moveOnly: true }));
  }
  if (details && !ground && r() > 0.82 && variant !== 'balcony') {
    parts.push(fbox(f, u + w / 2 - 0.2, bottom - 0.42, 0.25, [0.7, 0.45, 0.45], 'acUnit'));
  }
  void fl;
}

function entranceDoor(parts: Part[], f: ReturnType<typeof facade>, u: number, style: Style) {
  parts.push(fbox(f, u, 1.15 + 0.6, 0.02, [1.3, 2.3, 0.06], style.door));
  parts.push(fbox(f, u, 1.15 + 0.6, 0.05, [0.05, 2.1, 0.03], 'metal'));
  parts.push(fbox(f, u, 2.45 + 0.6, 0.1, [1.8, 0.22, 0.2], style.trim));
  for (const s of [-1, 1]) parts.push(fbox(f, u + s * 0.75, 1.15 + 0.6, 0.05, [0.16, 2.3, 0.1], style.trim));
  // Schody ke dveřím (pochozí).
  parts.push(fbox(f, u, 0.3, 0.4, [2.0, 0.6, 0.8], 'concreteLight', { collide: true }));
  parts.push(fbox(f, u, 0.15, 0.95, [2.0, 0.3, 0.3], 'concreteLight', { collide: true }));
  parts.push(fbox(f, u, 2.2 + 0.6 + 0.35, 0.1, [0.4, 0.25, 0.14], 'lamp'));
}

function shopfront(parts: Part[], f: ReturnType<typeof facade>, u: number, mod: number, fh: number, r: () => number, lobby: boolean) {
  const w = mod - 0.35, h = Math.min(2.6, fh - 0.75);
  const closed = !lobby && r() > 0.55;
  parts.push(fbox(f, u, 0.3 + h / 2, 0.004, [w, h, 0.02], 'glassShop'));
  for (const s of [-1, 1]) parts.push(fbox(f, u + (s * (w + 0.1)) / 2, 0.3 + h / 2, 0.04, [0.1, h, 0.1], 'paintedMetal'));
  parts.push(fbox(f, u, 0.3 + h * 0.62, 0.03, [w, 0.05, 0.05], 'paintedMetal'));
  if (closed) {
    const sh = h * (0.55 + r() * 0.45);
    parts.push(fbox(f, u, 0.3 + h - sh / 2, 0.06, [w, sh, 0.04], 'shutter'));
  }
  parts.push(fbox(f, u, 0.3 + h + 0.12, 0.12, [w + 0.1, 0.24, 0.22], 'shutterBox'));
  if (!lobby && r() > 0.3) {
    const col = ['awningRed', 'awningBlue', 'awningGreen', 'awningSand'][Math.floor(r() * 4)];
    parts.push({ shape: 'wedge', pos: f.pos(u, 0.3 + h + 0.15, 0.7), rot: [0, f.rot[1] + Math.PI, 0], size: [w, 0.5, 1.3], material: col, castShadow: true });
  }
}

function rollerDoor(parts: Part[], f: ReturnType<typeof facade>, u: number, w: number, h: number, r: () => number) {
  parts.push(fbox(f, u, h / 2, 0.03, [w, h, 0.06], 'shutter'));
  parts.push(fbox(f, u, h + 0.25, 0.12, [w + 0.3, 0.5, 0.24], 'paintedMetal'));
  for (const s of [-1, 1]) parts.push(fbox(f, u + (s * (w + 0.15)) / 2, h / 2, 0.08, [0.15, h, 0.16], 'paintedMetal'));
  parts.push(fbox(f, u, 0.05, 1.0, [w + 1, 0.1, 2.0], 'concreteLight', { collide: true }));
  if (r() > 0.5) parts.push(fbox(f, u + w / 2 + 0.9, 1.0, 0.1, [0.5, 0.7, 0.18], 'paintedMetalRed'));
}

function stripWindow(parts: Part[], f: ReturnType<typeof facade>, u: number, mod: number, y: number) {
  parts.push(fbox(f, u, y, 0.004, [mod - 0.1, 1.1, 0.02], 'glass'));
  parts.push(fbox(f, u + mod / 2, y, 0.03, [0.08, 1.2, 0.06], 'paintedMetal'));
  parts.push(fbox(f, u, y + 0.6, 0.05, [mod, 0.1, 0.1], 'paintedMetal'));
  parts.push(fbox(f, u, y - 0.6, 0.06, [mod, 0.1, 0.14], 'paintedMetal'));
}

function describe(p: Params) {
  const { W, D, H } = dims(p);
  return `${W.toFixed(1)} × ${D.toFixed(1)} m, výška ${H.toFixed(1)} m (${n(p, 'widthMod')}×${n(p, 'depthMod')} modulů, ${n(p, 'floors')} pater)`;
}

const base = (family: Family, label: string, defaults: Parameters<typeof commonParams>[0], materials: string[], extra: ParamSpec[] = []): AssetDef => ({
  assetId: `build.${family}`,
  label,
  category: 'buildings',
  generatorVersion: 1,
  params: [...commonParams(defaults), ...extra],
  materials,
  defaultMaterial: materials[0],
  sizeParams: { x: 'widthMod', z: 'depthMod', y: 'floors' },
  describe,
  generate: (p, seed, material) => buildingParts(family, p, seed, material),
});

registerAsset(
  base('residential', 'Obytný dům', { w: 4, d: 3, floors: 3, fh: 3, mod: 3, windows: 'shutters', parapet: true }, ['plasterWarm', 'plaster', 'plasterWhite', 'plasterOchre', 'brick', 'sandstone']),
);
registerAsset(
  base('commercial', 'Obchodní dům', { w: 5, d: 3, floors: 2, fh: 3.4, mod: 3, windows: 'plain', parapet: true }, ['plaster', 'plasterWhite', 'plasterOchre', 'sandstone', 'brick'], [
    { key: 'signText', label: 'Vývěsní štít', type: 'string', default: 'BAZAR' },
  ]),
);
registerAsset(
  base('industrial', 'Průmyslová hala', { w: 6, d: 4, floors: 1, fh: 6, mod: 3, windows: 'strip', parapet: true }, ['metalSheet', 'metalSheetRust', 'concrete', 'brick']),
);
registerAsset(
  base('hotel', 'Hotel', { w: 6, d: 4, floors: 6, fh: 3.1, mod: 3, windows: 'balcony', parapet: true }, ['plasterWhite', 'plaster', 'sandstone', 'plasterOchre'], [
    { key: 'hotelName', label: 'Nápis hotelu', type: 'string', default: 'HOTEL MIRAGE' },
    { key: 'signText', label: 'Štít v přízemí', type: 'string', default: 'RECEPCE' },
  ]),
);
