import * as THREE from 'three';
import { worldWeapon } from '../render/weapons/worldModel';
import { isItemModel, itemGeometry } from '../render/weapons/items';

/**
 * Silueta předmětu z jeho skutečné geometrie (boční průmět, ústí vlevo) – pro panel výbavy,
 * HUD i overlay slotů. Výsledek se drží v mezipaměti (obrázek na předmět a velikost).
 * Předměty bez 3D modelu dodají vlastní geometrii přes `registerSilhouette`.
 */
const custom = new Map<string, () => THREE.BufferGeometry>();
const cache = new Map<string, HTMLCanvasElement>();

export function registerSilhouette(id: string, geo: () => THREE.BufferGeometry) {
  custom.set(id, geo);
}

function geometryOf(id: string): THREE.BufferGeometry | null {
  const c = custom.get(id);
  if (c) return c();
  if (isItemModel(id)) return itemGeometry(id);
  try {
    return worldWeapon(id, 'low').lods[0];
  } catch {
    return null;
  }
}

/** Nakreslí siluetu do plátna `w × h` (CSS px × dpr). Vrací false, když předmět nemá geometrii. */
export function drawSilhouette(cv: HTMLCanvasElement, id: string, w: number, h: number, color = 'rgba(229,231,216,0.88)') {
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const key = `${id}|${w}|${h}|${color}|${dpr}`;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  let src = cache.get(key);
  if (!src) {
    const geo = geometryOf(id);
    if (!geo) return false;
    src = document.createElement('canvas');
    src.width = cv.width;
    src.height = cv.height;
    const s = src.getContext('2d')!;
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const alongX = b.max.x - b.min.x > b.max.z - b.min.z;
    const lo = alongX ? b.min.x : b.min.z, len = Math.max(1e-3, alongX ? b.max.x - b.min.x : b.max.z - b.min.z);
    const W = src.width, H = src.height, m = 4 * dpr;
    const sc = Math.min((W - 2 * m) / len, (H - 2 * m) / Math.max(1e-3, b.max.y - b.min.y));
    const ox = (W - len * sc) / 2, oy = (H - (b.max.y - b.min.y) * sc) / 2;
    const X = (v: number) => W - ox - (v - lo) * sc;
    const A = (i: number) => (alongX ? p.getX(i) : p.getZ(i));
    const Y = (y: number) => H - oy - (y - b.min.y) * sc;
    s.fillStyle = color;
    const idx = geo.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b2 = idx ? idx.getX(i + 1) : i + 1, c2 = idx ? idx.getX(i + 2) : i + 2;
      s.beginPath();
      s.moveTo(X(A(a)), Y(p.getY(a)));
      s.lineTo(X(A(b2)), Y(p.getY(b2)));
      s.lineTo(X(A(c2)), Y(p.getY(c2)));
      s.closePath();
      s.fill();
    }
    cache.set(key, src);
  }
  g.drawImage(src, 0, 0);
  return true;
}
