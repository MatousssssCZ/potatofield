import type { MapDocument } from '../../shared/map/schema';

/**
 * Taktická mapa z mapových dat: jednorázově vykreslený podklad (terén podle výšek a sklonu,
 * půdorysy objektů) + překryvné značky. Sdílí ji nasazení, minimapa i obrazovka commandera –
 * žádná druhá 3D scéna, obraz se nepřekresluje každý snímek.
 */
export interface Footprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
}

export interface MapBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export class TacticalMap {
  readonly base: HTMLCanvasElement;
  readonly bounds: MapBounds;
  /** px podkladu na metr. */
  readonly ppm: number;

  constructor(doc: MapDocument, footprints: Footprint[], size = 2048) {
    const t = doc.terrain;
    const w = (t.samplesX - 1) * t.spacing, d = (t.samplesZ - 1) * t.spacing;
    this.bounds = { x0: t.origin[0], z0: t.origin[1], x1: t.origin[0] + w, z1: t.origin[1] + d };
    // Hustota podkladu: max 6 px/m (malé mapy ostré i při přiblížení), strana max `size` px.
    this.ppm = Math.min(6, size / Math.max(w, d));
    const c = document.createElement('canvas');
    c.width = Math.round(w * this.ppm);
    c.height = Math.round(d * this.ppm);
    this.base = c;
    const g = c.getContext('2d')!;
    // Terén: výška a sklon (stínování ze severozápadu), jemná mřížka po 50 m.
    const img = g.createImageData(c.width, c.height);
    const hAt = (x: number, z: number) => {
      const fx = Math.min(t.samplesX - 1.001, Math.max(0, (x - t.origin[0]) / t.spacing));
      const fz = Math.min(t.samplesZ - 1.001, Math.max(0, (z - t.origin[1]) / t.spacing));
      const x0 = Math.floor(fx), z0 = Math.floor(fz), ax = fx - x0, az = fz - z0;
      const H = (i: number, j: number) => t.heights[j * t.samplesX + i] ?? 0;
      return (H(x0, z0) * (1 - ax) + H(x0 + 1, z0) * ax) * (1 - az) + (H(x0, z0 + 1) * (1 - ax) + H(x0 + 1, z0 + 1) * ax) * az;
    };
    let hMin = Infinity, hMax = -Infinity;
    for (const v of t.heights) {
      hMin = Math.min(hMin, v);
      hMax = Math.max(hMax, v);
    }
    const span = Math.max(1, hMax - hMin);
    for (let py = 0; py < c.height; py++)
      for (let px = 0; px < c.width; px++) {
        const x = this.bounds.x0 + px / this.ppm, z = this.bounds.z0 + py / this.ppm;
        const hh = hAt(x, z);
        const sh = (hAt(x - t.spacing, z - t.spacing) - hAt(x + t.spacing, z + t.spacing)) * 0.6;
        const k = (hh - hMin) / span;
        const i = (py * c.width + px) * 4;
        // Letecký snímek pouště (BF2): teplý písek, hnědé svahy, světlé hřbety.
        img.data[i] = 176 + k * 40 + sh * 26;
        img.data[i + 1] = 148 + k * 34 + sh * 24;
        img.data[i + 2] = 102 + k * 22 + sh * 18;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(60,45,25,0.12)';
    g.lineWidth = 1;
    for (let x = Math.ceil(this.bounds.x0 / 50) * 50; x < this.bounds.x1; x += 50) {
      g.beginPath();
      g.moveTo((x - this.bounds.x0) * this.ppm, 0);
      g.lineTo((x - this.bounds.x0) * this.ppm, c.height);
      g.stroke();
    }
    for (let z = Math.ceil(this.bounds.z0 / 50) * 50; z < this.bounds.z1; z += 50) {
      g.beginPath();
      g.moveTo(0, (z - this.bounds.z0) * this.ppm);
      g.lineTo(c.width, (z - this.bounds.z0) * this.ppm);
      g.stroke();
    }
    // Půdorysy objektů (vyšší = světlejší, aby budovy vystoupily).
    for (const f of footprints) {
      const a = Math.min(1, f.h / 12);
      g.fillStyle = `rgba(${112 - a * 28},${104 - a * 26},${92 - a * 22},0.92)`;
      g.fillRect((f.x0 - this.bounds.x0) * this.ppm, (f.z0 - this.bounds.z0) * this.ppm, Math.max(1, (f.x1 - f.x0) * this.ppm), Math.max(1, (f.z1 - f.z0) * this.ppm));
      g.strokeStyle = 'rgba(30,24,16,0.75)';
      g.strokeRect((f.x0 - this.bounds.x0) * this.ppm, (f.z0 - this.bounds.z0) * this.ppm, Math.max(1, (f.x1 - f.x0) * this.ppm), Math.max(1, (f.z1 - f.z0) * this.ppm));
    }
  }

  /**
   * Vykreslí podklad do kontextu tak, aby světový bod (cx, cz) byl ve středu (sx, sy)
   * s měřítkem `scale` px/m a natočením `rot` (rad; 0 = sever nahoru).
   */
  draw(g: CanvasRenderingContext2D, cx: number, cz: number, sx: number, sy: number, scale: number, rot = 0) {
    g.save();
    g.translate(sx, sy);
    g.rotate(rot);
    g.scale(scale / this.ppm, scale / this.ppm);
    g.translate(-(cx - this.bounds.x0) * this.ppm, -(cz - this.bounds.z0) * this.ppm);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0);
    g.restore();
  }

  /** Transformace svět → obrazovka odpovídající `draw`. */
  static w2s(cx: number, cz: number, sx: number, sy: number, scale: number, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return (x: number, z: number): [number, number] => {
      const dx = (x - cx) * scale, dz = (z - cz) * scale;
      return [sx + dx * c - dz * s, sy + dx * s + dz * c];
    };
  }

  /** Měřítko, které celou mapu (nebo zadané okno) vejde do w × h. */
  fit(w: number, h: number, margin = 16, win?: MapBounds) {
    const b = win ?? this.bounds;
    return Math.min((w - margin * 2) / (b.x1 - b.x0), (h - margin * 2) / (b.z1 - b.z0));
  }
}

/** Herní okno mapy: obal bodů, spawnů a zón (mapa bývá větší než hrací plocha). */
export function playArea(doc: MapDocument, pad = 30): MapBounds | undefined {
  const pts = [...doc.controlPoints.map((c) => c.position), ...doc.spawnPoints.map((s) => s.position)];
  if (!pts.length) return undefined;
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]);
  return { x0: Math.min(...xs) - pad, z0: Math.min(...zs) - pad, x1: Math.max(...xs) + pad, z1: Math.max(...zs) + pad };
}
