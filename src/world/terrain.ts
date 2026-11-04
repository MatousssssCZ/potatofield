import type { TerrainData } from '../shared/map/schema';

/**
 * Štětce terénu (čisté funkce nad výškovým polem – testovatelné, sdílené).
 * Síla je v metrech za sekundu (u malování v podílu za sekundu) → tah nezávisí na FPS.
 */
export type BrushKind = 'raise' | 'lower' | 'smooth' | 'flatten' | 'paintDirt' | 'paintUrban' | 'paintErase';

export interface Brush {
  kind: BrushKind;
  radius: number;
  strength: number;
  /** Cílová výška pro „srovnat“. */
  target?: number;
}

export interface Region {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function sampleIndex(t: TerrainData, ix: number, iz: number) {
  return iz * t.samplesX + ix;
}

export function heightAt(t: TerrainData, x: number, z: number): number | null {
  const gx = (x - t.origin[0]) / t.spacing, gz = (z - t.origin[1]) / t.spacing;
  if (gx < 0 || gz < 0 || gx > t.samplesX - 1 || gz > t.samplesZ - 1) return null;
  const x0 = Math.min(t.samplesX - 2, Math.floor(gx)), z0 = Math.min(t.samplesZ - 2, Math.floor(gz));
  const fx = gx - x0, fz = gz - z0;
  const h = (i: number, j: number) => t.heights[j * t.samplesX + i];
  // Stejná triangulace jako render i kolize (diagonála (x,z)→(x+1,z+1)).
  if (fx >= fz) return h(x0, z0) + (h(x0 + 1, z0) - h(x0, z0)) * fx + (h(x0 + 1, z0 + 1) - h(x0 + 1, z0)) * fz;
  return h(x0, z0) + (h(x0 + 1, z0 + 1) - h(x0, z0 + 1)) * fx + (h(x0, z0 + 1) - h(x0, z0)) * fz;
}

/** Oblast vzorků, kterou štětec v bodě ovlivní. */
export function brushRegion(t: TerrainData, x: number, z: number, radius: number): Region | null {
  const x0 = Math.max(0, Math.floor((x - radius - t.origin[0]) / t.spacing));
  const z0 = Math.max(0, Math.floor((z - radius - t.origin[1]) / t.spacing));
  const x1 = Math.min(t.samplesX - 1, Math.ceil((x + radius - t.origin[0]) / t.spacing));
  const z1 = Math.min(t.samplesZ - 1, Math.ceil((z + radius - t.origin[1]) / t.spacing));
  if (x1 < x0 || z1 < z0) return null;
  return { x0, z0, x1, z1 };
}

export const unionRegion = (a: Region | null, b: Region | null): Region | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) };

/** Aplikuje štětec za čas dt; vrací ovlivněnou oblast. Výšky omezeny na ±1000 m. */
export function applyBrush(t: TerrainData, b: Brush, x: number, z: number, dt: number): Region | null {
  const reg = brushRegion(t, x, z, b.radius);
  if (!reg) return null;
  const isPaint = b.kind.startsWith('paint');
  if (b.kind === 'paintDirt' && !t.dirt) t.dirt = new Array(t.heights.length).fill(0);
  if ((b.kind === 'paintUrban' || b.kind === 'paintErase') && !t.urban) t.urban = new Array(t.heights.length).fill(0);
  if (b.kind === 'paintErase' && !t.dirt) t.dirt = new Array(t.heights.length).fill(0);
  const src = b.kind === 'smooth' ? t.heights.slice() : t.heights;
  for (let iz = reg.z0; iz <= reg.z1; iz++)
    for (let ix = reg.x0; ix <= reg.x1; ix++) {
      const wx = t.origin[0] + ix * t.spacing, wz = t.origin[1] + iz * t.spacing;
      const d = Math.hypot(wx - x, wz - z);
      if (d > b.radius) continue;
      // Hladký útlum k okraji (kosinus).
      const fall = 0.5 + 0.5 * Math.cos((Math.PI * d) / b.radius);
      const k = b.strength * dt * fall;
      const i = sampleIndex(t, ix, iz);
      if (isPaint) {
        if (b.kind === 'paintDirt') t.dirt![i] = r2(Math.min(1, t.dirt![i] + k));
        else if (b.kind === 'paintUrban') t.urban![i] = r2(Math.min(1, t.urban![i] + k));
        else {
          t.dirt![i] = r2(Math.max(0, t.dirt![i] - k));
          t.urban![i] = r2(Math.max(0, t.urban![i] - k));
        }
        continue;
      }
      let h = t.heights[i];
      if (b.kind === 'raise') h += k;
      else if (b.kind === 'lower') h -= k;
      else if (b.kind === 'flatten') {
        const tg = b.target ?? h;
        h += (tg - h) * Math.min(1, k);
      } else {
        let sum = 0, cnt = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const jx = ix + dx, jz = iz + dz;
            if (jx < 0 || jz < 0 || jx >= t.samplesX || jz >= t.samplesZ) continue;
            sum += src[sampleIndex(t, jx, jz)];
            cnt++;
          }
        h += (sum / cnt - h) * Math.min(1, k);
      }
      t.heights[i] = Math.max(-999, Math.min(999, Math.round(h * 10000) / 10000));
    }
  return reg;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Kopie hodnot oblasti (pro undo). */
export function readRegion(t: TerrainData, r: Region) {
  const out: { heights: number[]; dirt?: number[]; urban?: number[] } = { heights: [] };
  if (t.dirt) out.dirt = [];
  if (t.urban) out.urban = [];
  for (let iz = r.z0; iz <= r.z1; iz++)
    for (let ix = r.x0; ix <= r.x1; ix++) {
      const i = sampleIndex(t, ix, iz);
      out.heights.push(t.heights[i]);
      out.dirt?.push(t.dirt![i]);
      out.urban?.push(t.urban![i]);
    }
  return out;
}

export function writeRegion(t: TerrainData, r: Region, v: ReturnType<typeof readRegion>) {
  let k = 0;
  if (v.dirt && !t.dirt) t.dirt = new Array(t.heights.length).fill(0);
  if (v.urban && !t.urban) t.urban = new Array(t.heights.length).fill(0);
  for (let iz = r.z0; iz <= r.z1; iz++)
    for (let ix = r.x0; ix <= r.x1; ix++, k++) {
      const i = sampleIndex(t, ix, iz);
      t.heights[i] = v.heights[k];
      if (v.dirt) t.dirt![i] = v.dirt[k];
      if (v.urban) t.urban![i] = v.urban[k];
    }
}

/** Sklon v daném vzorku (stupně) – pro debug zobrazení příliš prudkých svahů. */
export function slopeDeg(t: TerrainData, ix: number, iz: number) {
  const h = (a: number, b: number) => t.heights[sampleIndex(t, Math.max(0, Math.min(t.samplesX - 1, a)), Math.max(0, Math.min(t.samplesZ - 1, b)))];
  const gx = (h(ix + 1, iz) - h(ix - 1, iz)) / (2 * t.spacing);
  const gz = (h(ix, iz + 1) - h(ix, iz - 1)) / (2 * t.spacing);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
}
