import type { Part } from '../../parts';
import type { Params } from '../../registry';
import { fbox, type Facade } from '../kit';

/**
 * Společné nástroje sady „Skladová osada“ (katalog 84 typů, viz docs/SKLADOVA_OSADA.md).
 * Generátory jsou čisté funkce parametrů a seedu; rozměry v metrech, UV v metrech řeší renderer.
 */
export const num = (p: Params, k: string) => p[k] as number;
export const bool = (p: Params, k: string) => p[k] as boolean;
export const str = (p: Params, k: string) => String(p[k]);

/** Katalogové údaje typu (ID ze zadání, český název). Instance nesou jen assetId. */
export interface OsadaMeta {
  /** ID ze zadání (B01, R03 …). */
  code: string;
  name: string;
  /** Skupina katalogu zadání (A budovy … F herní prvky). */
  group: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}
export const OSADA_META: Record<string, OsadaMeta> = {};
export function osadaMeta(assetId: string, code: string, name: string, group: OsadaMeta['group']) {
  OSADA_META[assetId] = { code, name, group };
  return `${code} ${name}`;
}

/** Otvor ve stěně v souřadnicích fasády (u = střed podél stěny, od středu stěny). */
export interface WallOpening {
  u: number;
  width: number;
  bottom: number;
  top: number;
}

/**
 * Pás stěny mezi výškami v0–v1 s vyříznutými otvory (dveře, okna, vrata). Otvory jsou skutečně
 * prázdné – výplň (sklo, vrata) přidává volající zvlášť podle profilu průchodnosti.
 */
export function wallBand(f: Facade, len: number, v0: number, v1: number, thick: number, openings: WallOpening[], material: string, extra: Partial<Part> = {}, wOffset = -thick / 2): Part[] {
  const parts: Part[] = [];
  const seg = (u0: number, u1: number, a: number, b: number) => {
    a = Math.max(a, v0);
    b = Math.min(b, v1);
    u0 = Math.max(u0, -len / 2);
    u1 = Math.min(u1, len / 2);
    if (u1 - u0 < 1e-3 || b - a < 1e-3) return;
    parts.push(fbox(f, (u0 + u1) / 2, (a + b) / 2, wOffset, [u1 - u0, b - a, thick], material, { collide: true, ...extra }));
  };
  const ops = openings.filter((o) => o.top > v0 && o.bottom < v1).sort((a, b) => a.u - b.u);
  let cursor = -len / 2;
  for (const o of ops) {
    const a = o.u - o.width / 2, b = o.u + o.width / 2;
    seg(cursor, a, v0, v1);
    seg(a, b, v0, o.bottom);
    seg(a, b, o.top, v1);
    cursor = Math.max(cursor, b);
  }
  seg(cursor, len / 2, v0, v1);
  return parts;
}

/**
 * Rozdělení stěny na fasádní pole: počet polí podle cílové šířky, šířka pole se mírně přizpůsobí.
 * Prodloužení stěny pole přidá, velikost oken a dveří se nemění.
 */
export function bays(len: number, target: number, min = 1): { count: number; width: number; centers: number[] } {
  const count = Math.max(min, Math.round(len / target));
  const width = len / count;
  return { count, width, centers: Array.from({ length: count }, (_, i) => -len / 2 + (i + 0.5) * width) };
}

/**
 * Ukotvený otvor (dveře, vrata): uložená vzdálenost středu od levého rohu stěny (při pohledu zvenku).
 * Zamčený otvor drží přesnou polohu; nezamčený se přichytí ke středu nejbližšího fasádního pole.
 * Pokud se otvor na stěnu nevejde, vrátí konflikt – uložený parametr se nemění (po prodloužení se
 * otvor vrátí na své místo), vykreslí se na nejbližší platné pozici.
 */
export function anchorOpening(len: number, from: number, width: number, margin: number, locked: boolean, bayCenters: number[]): { u: number; conflict?: string } {
  const lo = -len / 2 + margin + width / 2, hi = len / 2 - margin - width / 2;
  if (hi < lo) return { u: 0, conflict: `otvor ${width.toFixed(1)} m se na stěnu ${len.toFixed(1)} m nevejde` };
  let u = from - len / 2;
  if (!locked) {
    const ok = bayCenters.filter((c) => c >= lo - 1e-6 && c <= hi + 1e-6);
    if (ok.length) u = ok.reduce((best, c) => (Math.abs(c - u) < Math.abs(best - u) ? c : best), ok[0]);
  }
  if (u < lo - 1e-6 || u > hi + 1e-6) {
    const c = Math.min(hi, Math.max(lo, u));
    return { u: c, conflict: `zamčený otvor na ${from.toFixed(2)} m je mimo stěnu (platné ${(lo + len / 2).toFixed(2)}–${(hi + len / 2).toFixed(2)} m); dočasně vykreslen na ${(c + len / 2).toFixed(2)} m – posuň ho nebo prodluž stěnu` };
  }
  return { u };
}

/** Posun všech dílů (pivot budovy v rohu půdorysu: generuje se kolem středu a posune). */
export function shift(parts: Part[], dx: number, dz: number): Part[] {
  for (const p of parts) {
    p.pos = [p.pos[0] + dx, p.pos[1], p.pos[2] + dz];
    if (p.path) p.path = p.path.map(([x, y, z]) => [x + dx, y, z + dz]);
  }
  return parts;
}

export const SIDE_LABELS = [
  { value: 'front', label: 'Čelo (−Z)' },
  { value: 'back', label: 'Zadní (+Z)' },
  { value: 'left', label: 'Levá (−X)' },
  { value: 'right', label: 'Pravá (+X)' },
];

export const OPPOSITE: Record<string, 'front' | 'back' | 'left' | 'right'> = { front: 'back', back: 'front', left: 'right', right: 'left' };
