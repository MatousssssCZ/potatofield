import { t } from './i18n';
import { button, h } from './kit';
import { TacticalMap, type MapBounds } from './tactical';

/**
 * Taktická mapa shora (sever nahoru) pro nasazení, squad a mapu v boji. Podklad je jednou
 * předkreslený obraz z herních dat (TacticalMap); značky se kreslí ve světových souřadnicích
 * přes stejný převod jako podklad, takže drží místo při změně velikosti, zoomu i posunu.
 * Zoom kolečkem jen nad mapou a tlačítky +/−, posun tažením (práh 5 px odliší tah od kliku),
 * „Celá mapa“ vrátí výchozí výřez. Klik vybírá jen značky (klikací plocha ≥ 36 × 36 px),
 * nikdy terén; u překrývajících se značek nabídne seznam názvů. Překresluje se jen při změně.
 */
export type MarkerKind = 'cp' | 'base' | 'leader' | 'ally' | 'squadmate' | 'me' | 'test';
export type Rel = 'own' | 'enemy' | 'neutral';

export interface MapMarker {
  id: string;
  kind: MarkerKind;
  x: number;
  z: number;
  label?: string;
  letter?: string;
  rel: Rel;
  /** Klikatelná značka (body, základny, leader); spojenci ne. */
  selectable?: boolean;
  available?: boolean;
  /** Text do bubliny: vlastník, dostupnost, důvod. */
  info?: string;
  radius?: number;
  /** Postup zabírání (−1…1) pro kroužek u bodu. */
  progress?: number;
}

const HIT = 18; // poloměr klikací plochy (CSS px) → 36 × 36

export class MapView {
  readonly root: HTMLElement;
  private canvas = h('canvas', { class: 'pf-map-canvas', tabindex: '0', 'aria-label': 'map' }) as HTMLCanvasElement;
  private tip = h('div', { class: 'pf-map-tip hidden' });
  private picker = h('div', { class: 'pf-map-picker hidden' });
  private map: TacticalMap | null = null;
  private win: MapBounds | null = null;
  private cx = 0;
  private cz = 0;
  private scale = 1;
  private fitScale = 1;
  private markers: MapMarker[] = [];
  private markersKey = '';
  private selected: string | null = null;
  private hover: string | null = null;
  private dirty = true;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private colors: Record<string, string> = {};
  onSelect: (id: string) => void = () => {};

  constructor(opts: { controls?: boolean } = {}) {
    const zoomIn = button('+', () => this.zoom(1.4), 'pf-btn small', { title: t('map.zoomIn'), 'aria-label': t('map.zoomIn') });
    const zoomOut = button('−', () => this.zoom(1 / 1.4), 'pf-btn small', { title: t('map.zoomOut'), 'aria-label': t('map.zoomOut') });
    const all = button(t('map.whole'), () => this.fitAll(), 'pf-btn small');
    this.root = h('div', { class: 'pf-map' }, this.canvas, this.tip, this.picker, opts.controls === false ? null : h('div', { class: 'pf-map-ctl' }, zoomIn, zoomOut, all));
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const [mx, my] = this.local(e);
      this.zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, mx, my);
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false };
      this.picker.classList.add('hidden');
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
        if (d.moved) {
          this.cx = d.cx - dx / this.scale;
          this.cz = d.cz - dy / this.scale;
          this.clamp();
          this.dirty = true;
          this.draw();
        }
        return;
      }
      const [mx, my] = this.local(e);
      const hit = this.hits(mx, my)[0] ?? null;
      const id = hit?.id ?? null;
      this.canvas.style.cursor = hit?.selectable ? 'pointer' : 'grab';
      if (id !== this.hover) {
        this.hover = id;
        this.dirty = true;
        this.draw();
      }
      this.showTip(hit, mx, my);
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.tip.classList.add('hidden');
      this.dirty = true;
      this.draw();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved) return;
      const [mx, my] = this.local(e);
      const hits = this.hits(mx, my);
      if (!hits.length) return; // terén nikdy není cíl
      const sel = hits.filter((m) => m.selectable);
      // Překryv: více značek blízko u sebe → malý seznam názvů.
      if (sel.length > 1 && Math.hypot(...this.toScreen(sel[0]).map((v, i) => v - this.toScreen(sel[1])[i]) as [number, number]) < 14) return this.showPicker(sel, mx, my);
      this.onSelect((sel[0] ?? hits[0]).id);
    });
    this.canvas.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') this.zoom(1.25);
      else if (e.key === '-') this.zoom(0.8);
      else if (e.key === '0') this.fitAll();
      else return;
      e.preventDefault();
    });
    new ResizeObserver(() => {
      this.dirty = true;
      this.fitIfFresh();
      this.draw();
    }).observe(this.canvas);
  }

  /** Podklad a herní okno mapy (výchozí výřez). */
  setMap(map: TacticalMap | null, win?: MapBounds) {
    if (map === this.map && win === this.win) return;
    this.map = map;
    this.win = win ?? map?.bounds ?? null;
    this.fresh = true;
    this.fitIfFresh();
    this.dirty = true;
  }
  private fresh = true;

  private fitIfFresh() {
    if (!this.fresh || !this.map || !this.win || !this.canvas.clientWidth) return;
    this.fresh = false;
    this.fitAll();
  }

  fitAll() {
    if (!this.map || !this.win) return;
    const W = this.canvas.clientWidth || 600, H = this.canvas.clientHeight || 400;
    this.fitScale = this.map.fit(W, H, 28, this.win);
    this.scale = this.fitScale;
    this.cx = (this.win.x0 + this.win.x1) / 2;
    this.cz = (this.win.z0 + this.win.z1) / 2;
    this.dirty = true;
    this.draw();
  }

  zoom(f: number, mx?: number, my?: number) {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    mx ??= W / 2;
    my ??= H / 2;
    // Bod pod kurzorem zůstane na místě.
    const wx = this.cx + (mx - W / 2) / this.scale, wz = this.cz + (my - H / 2) / this.scale;
    this.scale = Math.min(this.fitScale * 8, Math.max(this.fitScale * 0.8, this.scale * f));
    this.cx = wx - (mx - W / 2) / this.scale;
    this.cz = wz - (my - H / 2) / this.scale;
    this.clamp();
    this.dirty = true;
    this.draw();
  }

  private clamp() {
    const b = this.map?.bounds;
    if (!b) return;
    this.cx = Math.min(b.x1, Math.max(b.x0, this.cx));
    this.cz = Math.min(b.z1, Math.max(b.z0, this.cz));
  }

  setMarkers(list: MapMarker[], selected: string | null) {
    const key = JSON.stringify(list.map((m) => [m.id, m.rel, m.available, Math.round(m.x * 2), Math.round(m.z * 2), m.label, m.info, Math.round((m.progress ?? 0) * 20)])) + `|${selected}`;
    this.markers = list;
    if (key !== this.markersKey || selected !== this.selected) {
      this.markersKey = key;
      this.selected = selected;
      this.dirty = true;
    }
    this.draw();
  }

  private local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private toScreen(m: { x: number; z: number }): [number, number] {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    return [W / 2 + (m.x - this.cx) * this.scale, H / 2 + (m.z - this.cz) * this.scale];
  }

  /** Značky pod bodem, nejbližší první (výběrové před ostatními). */
  private hits(mx: number, my: number) {
    return this.markers
      .filter((m) => m.kind !== 'me')
      .map((m) => ({ m, d: Math.hypot(...((p) => [p[0] - mx, p[1] - my])(this.toScreen(m)) as [number, number]) }))
      .filter((x) => x.d <= (x.m.selectable ? HIT : 8))
      .sort((a, b) => Number(!!b.m.selectable) - Number(!!a.m.selectable) || a.d - b.d)
      .map((x) => x.m);
  }

  private showTip(m: MapMarker | null, mx: number, my: number) {
    if (!m || (!m.label && !m.info)) return this.tip.classList.add('hidden');
    this.tip.replaceChildren(h('b', {}, m.label ?? ''));
    if (m.info) this.tip.append(h('div', {}, m.info));
    this.tip.style.left = `${mx + 14}px`;
    this.tip.style.top = `${my + 10}px`;
    this.tip.classList.remove('hidden');
  }

  private showPicker(list: MapMarker[], mx: number, my: number) {
    this.picker.replaceChildren(...list.map((m) => button(m.label ?? m.id, () => {
      this.picker.classList.add('hidden');
      this.onSelect(m.id);
    }, 'pf-btn small')));
    this.picker.style.left = `${mx}px`;
    this.picker.style.top = `${my}px`;
    this.picker.classList.remove('hidden');
    (this.picker.firstElementChild as HTMLElement | null)?.focus();
  }

  /** Překreslení jen při změně (značky, výřez, velikost). */
  draw() {
    if (!this.dirty || !this.map || !this.canvas.isConnected) return;
    this.dirty = false;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#151b1b';
    g.fillRect(0, 0, W, H);
    this.map.draw(g, this.cx, this.cz, W / 2, H / 2, this.scale);
    // Mimo hrací plochu červené šrafování (BF2): vše za hranicí bodů a základen.
    if (this.win && this.win !== this.map.bounds) {
      const tl = this.toScreen({ x: this.win.x0, z: this.win.z0 } as MapMarker), br = this.toScreen({ x: this.win.x1, z: this.win.z1 } as MapMarker);
      g.save();
      g.beginPath();
      g.rect(0, 0, W, H);
      g.rect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
      g.clip('evenodd');
      g.fillStyle = 'rgba(120,30,20,0.38)';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(190,60,40,0.55)';
      g.lineWidth = 3;
      g.beginPath();
      for (let k = -H; k < W + H; k += 12) {
        g.moveTo(k, 0);
        g.lineTo(k + H, H);
      }
      g.stroke();
      g.restore();
      g.strokeStyle = 'rgba(40,30,15,0.7)';
      g.lineWidth = 2;
      g.strokeRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
    }
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => (this.colors[n] ??= css.getPropertyValue(n).trim());
    this.colors = {};
    const relCol = (r: Rel) => (r === 'own' ? col('--pf-team') : r === 'enemy' ? col('--pf-enemy') : col('--pf-neutral'));
    const accent = col('--pf-accent');
    g.textBaseline = 'middle';
    // Oblasti bodů (poloměr zabírání) pod značkami.
    for (const m of this.markers) {
      if (m.kind !== 'cp' && m.kind !== 'base') continue;
      const [x, y] = this.toScreen(m);
      const r = Math.max(10, (m.radius ?? 8) * this.scale);
      g.fillStyle = relCol(m.rel) + '26';
      g.strokeStyle = relCol(m.rel) + '99';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (m.progress && Math.abs(m.progress) < 1) {
        g.strokeStyle = m.progress > 0 === (m.rel === 'own') ? col('--pf-team') : col('--pf-enemy');
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.abs(m.progress) * Math.PI * 2);
        g.stroke();
      }
    }
    const labels: Array<[number, number, number, number]> = [];
    for (const m of this.markers) {
      const [x, y] = this.toScreen(m);
      const sel = m.id === this.selected, hov = m.id === this.hover;
      const color = m.kind === 'leader' || m.kind === 'squadmate' ? col('--pf-squad') : relCol(m.rel);
      if (m.kind === 'ally' || m.kind === 'squadmate') {
        g.fillStyle = color;
        g.fillRect(x - 3, y - 3, 6, 6);
        continue;
      }
      if (m.kind === 'me') {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.strokeRect(x - 5, y - 5, 10, 10);
        continue;
      }
      if (sel || hov) {
        g.strokeStyle = sel ? accent : 'rgba(229,231,216,0.6)';
        g.lineWidth = sel ? 3 : 1.5;
        g.beginPath();
        g.arc(x, y, 15, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = color;
      if (m.kind === 'base') baseIcon(g, x, y, color);
      else if (m.kind === 'leader') star(g, x, y, 9);
      else flagIcon(g, x, y, color);
      if (m.selectable && m.available === false) noEntry(g, x + 9, y - 9);
      const name = [m.letter, m.label].filter(Boolean).join(' · ');
      if (name) {
        g.font = `${sel ? 700 : 600} 12px "Barlow Semi Condensed", sans-serif`;
        // Popisky se nepřekrývají: posun dolů, dokud nekoliduje s již položeným.
        const w = g.measureText(name).width;
        let ly = y;
        for (let k = 0; k < 6 && labels.some(([lx, lyy, lw, lh]) => x + 14 < lx + lw && x + 14 + w > lx && ly - 7 < lyy + lh && ly + 7 > lyy); k++) ly += 15;
        labels.push([x + 14, ly - 7, w, 14]);
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(21,27,27,0.85)';
        g.strokeText(name, x + 14, ly);
        g.fillStyle = sel ? accent : '#e5e7d8';
        g.fillText(name, x + 14, ly);
      }
    }
    // Měřítko (50 m) vlevo dole.
    const px = 50 * this.scale;
    g.strokeStyle = '#e5e7d8';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(12, H - 14);
    g.lineTo(12 + px, H - 14);
    g.stroke();
    g.font = '600 11px "Barlow Semi Condensed", sans-serif';
    g.fillStyle = '#e5e7d8';
    g.fillText('50 m', 16 + px, H - 14);
    g.fillText('N ↑', 12, 16);
  }
}

function flagIcon(g: CanvasRenderingContext2D, x: number, y: number, color: string) {
  g.strokeStyle = '#151b1b';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x - 4, y + 8);
  g.lineTo(x - 4, y - 9);
  g.stroke();
  g.strokeStyle = '#d6d8ce';
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - 3, y - 9);
  g.lineTo(x + 8, y - 5);
  g.lineTo(x - 3, y - 1);
  g.closePath();
  g.fill();
  g.strokeStyle = '#151b1b';
  g.lineWidth = 1;
  g.stroke();
}

function baseIcon(g: CanvasRenderingContext2D, x: number, y: number, color: string) {
  g.fillStyle = color;
  g.strokeStyle = '#151b1b';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, y - 10);
  g.lineTo(x + 9, y - 4);
  g.lineTo(x + 9, y + 8);
  g.lineTo(x - 9, y + 8);
  g.lineTo(x - 9, y - 4);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#151b1b';
  g.fillRect(x - 3, y + 1, 6, 7);
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = '#151b1b';
  g.lineWidth = 1;
  g.stroke();
}

function noEntry(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = '#d0574c';
  g.beginPath();
  g.arc(x, y, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.fillRect(x - 3.5, y - 1, 7, 2);
}

export { TacticalMap };
