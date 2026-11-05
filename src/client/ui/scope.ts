/**
 * Pohled do puškohledu (celá obrazovka): kruhový průhled, ztmavený okraj a záměrná osnova
 * kreslená v úhlových jednotkách podle skutečného zorného pole kamery – rozměry osnovy
 * (mil-dot, šipky a dálkoměr PSO-1) tedy odpovídají úhlům ve scéně a dají se použít k odhadu
 * vzdálenosti. Střed osnovy = střed obrazu = směr střely (rozptyl řeší simulace).
 */
export type ReticleKind = 'mildot' | 'pso1';

export class ScopeView {
  readonly canvas: HTMLCanvasElement;
  private key = '';

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pf-scope';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.canvas);
  }

  /** `amount` 0–1 (prolnutí), `vfovDeg` aktuální svislé zorné pole kamery. */
  update(kind: ReticleKind | null, amount: number, vfovDeg: number) {
    const c = this.canvas;
    if (!kind || amount <= 0.01) {
      c.style.display = 'none';
      this.key = '';
      return;
    }
    c.style.display = '';
    c.style.opacity = String(Math.min(1, amount * 1.6));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    const key = `${kind}|${W}|${H}|${vfovDeg.toFixed(3)}`;
    if (key === this.key) return;
    this.key = key;
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.47;
    const pxPerRad = H / 2 / Math.tan(((vfovDeg * Math.PI) / 180) / 2);
    const mil = pxPerRad * 0.001;

    // Tubus: vše mimo průhled černé, měkký přechod okraje a jemná vinětace uvnitř.
    g.fillStyle = '#000';
    g.beginPath();
    g.rect(0, 0, W, H);
    g.arc(cx, cy, R, 0, Math.PI * 2, true);
    g.fill('evenodd');
    const v = g.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.85, 'rgba(0,0,0,0.45)');
    v.addColorStop(1, 'rgba(0,0,0,0.95)');
    g.fillStyle = v;
    g.beginPath();
    g.arc(cx, cy, R + 1, 0, Math.PI * 2);
    g.fill();
    // Tónování skla (Leupold-styl chladnější, PSO-1 teplejší) – velmi slabé.
    g.fillStyle = kind === 'pso1' ? 'rgba(255,200,120,0.035)' : 'rgba(120,170,255,0.03)';
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();

    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    g.strokeStyle = '#050505';
    g.fillStyle = '#050505';
    const lw = Math.max(1, dpr);
    if (kind === 'mildot') this.mildot(g, cx, cy, R, mil, lw);
    else this.pso1(g, cx, cy, R, mil, lw, dpr);
    g.restore();
  }

  /** Mil-dot: tenký kříž, silné sloupky od 5 mil, body po 1 mil (průměr 0,25 mil). */
  private mildot(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, mil: number, lw: number) {
    const post = 5 * mil;
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(cx - post, cy);
    g.lineTo(cx + post, cy);
    g.moveTo(cx, cy - post);
    g.lineTo(cx, cy + post);
    g.stroke();
    const tw = Math.max(lw * 3, mil * 0.6);
    g.fillRect(cx + post, cy - tw / 2, R, tw);
    g.fillRect(cx - post - R, cy - tw / 2, R, tw);
    g.fillRect(cx - tw / 2, cy + post, tw, R);
    g.fillRect(cx - tw / 2, cy - post - R, tw, R);
    const dr = Math.max(lw * 1.1, mil * 0.125);
    for (let i = 1; i <= 4; i++)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        g.beginPath();
        g.ellipse(cx + dx * i * mil, cy + dy * i * mil, dx ? dr * 0.8 : dr * 1.3, dx ? dr * 1.3 : dr * 0.8, 0, 0, Math.PI * 2);
        g.fill();
      }
  }

  /**
   * PSO-1: hlavní šipka (do 1 000 m), pod ní tři menší pro 1 100–1 300 m, boční stupnice po
   * 1 dílci (1/6000 kruhu ≈ 1,047 mrad) do 10, dálkoměrná křivka pro cíl výšky 1,7 m (200–1 000 m).
   */
  private pso1(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, mil: number, lw: number, dpr: number) {
    // Osnova v poměru k průhledu jako ve skutečném PSO-1 (zorné pole 6°): hra má při 4× širší
    // pole, proto se osnova zvětší poměrem polí – dílce pak neodpovídají úhlům ve hře 1 : 1.
    const fieldDeg = (2 * Math.atan(R / (mil * 1000)) * 180) / Math.PI;
    const d = mil * 1.0472 * Math.max(1, fieldDeg / 6); // dílec PSO (1/6000 kruhu)
    lw = Math.max(lw * 1.5, d * 0.09);
    g.lineWidth = lw * 1.4;
    const chevron = (y: number, s: number) => {
      g.beginPath();
      g.moveTo(cx - s, y + s * 1.6);
      g.lineTo(cx, y);
      g.lineTo(cx + s, y + s * 1.6);
      g.stroke();
    };
    chevron(cy, d * 1.0);
    for (let i = 1; i <= 3; i++) chevron(cy + i * d * 2.2, d * 0.55);
    g.lineWidth = lw;
    // Svislá čára pod šipkami.
    g.beginPath();
    g.moveTo(cx, cy + 3 * d * 2.2 + d * 1.2);
    g.lineTo(cx, cy + R);
    g.stroke();
    // Boční stupnice (náměr) s delšími dílky po 5 a čísly 10.
    g.beginPath();
    g.moveTo(cx - 10 * d, cy);
    g.lineTo(cx - 1.5 * d, cy);
    g.moveTo(cx + 1.5 * d, cy);
    g.lineTo(cx + 10 * d, cy);
    for (let i = 1; i <= 10; i++)
      for (const sx of [-1, 1]) {
        const x = cx + sx * i * d;
        const h = i % 5 === 0 ? d * 0.9 : d * 0.45;
        g.moveTo(x, cy);
        g.lineTo(x, cy - h);
      }
    g.stroke();
    g.font = `${Math.max(10, Math.round(d * 1.2))}px "Barlow Semi Condensed", sans-serif`;
    g.textAlign = 'center';
    for (const sx of [-1, 1]) g.fillText('10', cx + sx * 10 * d, cy - d * 1.4);
    // Dálkoměr: vodorovná základna a křivka, kde výška cíle 1,7 m odpovídá vzdálenosti.
    const x0 = cx - 9 * d, base = cy + 7.5 * d;
    g.beginPath();
    g.moveTo(x0, base);
    g.lineTo(x0 + 7 * d, base);
    const pts: Array<[number, number]> = [];
    for (let r = 200; r <= 1000; r += 100) {
      const hpx = (1.7 / r) * 1000 * (d / 1.0472); // výška 1,7 m ve vzdálenosti r (v měřítku osnovy)
      const x = x0 + ((r - 200) / 800) * 7 * d;
      pts.push([x, base - hpx]);
    }
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.font = `${Math.max(9, Math.round(d * 0.95))}px "Barlow Semi Condensed", sans-serif`;
    for (const [i, r] of [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]] as const) g.fillText(String(r), pts[i][0], base + d * 1.3 + dpr);
  }

  dispose() {
    this.canvas.remove();
  }
}
