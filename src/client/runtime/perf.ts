/**
 * Lehká diagnostika výkonu klienta (audit, docs/perf-audit). Vypnutá = jedna kontrola příznaku na úsek.
 * Zapnutí: `?perf` v adrese nebo `__pf.perf.enable()`; výsledky `__pf.perf.report()`.
 *
 * Měří:
 * - interval mezi snímky (rAF) a CPU čas hlavní smyčky,
 * - CPU čas úseků (simulace, vojáci, HUD, odeslání vykreslení…) – `performance.now()`, ne GPU,
 * - GPU čas vykreslení přes EXT_disjoint_timer_query_webgl2 (jen když ho prohlížeč nabízí),
 * - počet volání renderer.render (průchody), draw calls, trojúhelníky, překreslení stínové mapy,
 * - JS heap (performance.memory, jen Chromium) jednou za sekundu.
 * Nic nevypisuje do konzole; data drží v kruhových polích pevné délky (bez alokací za snímek).
 */
import type * as THREE from 'three';

const CAP = 1 << 14; // ~4,5 min při 60 FPS

export type PerfSection = 'sim' | 'events' | 'soldiers' | 'camera' | 'tags' | 'sounds' | 'effects' | 'hud' | 'ui' | 'env' | 'grass' | 'render' | 'other';
const SECTIONS: PerfSection[] = ['sim', 'events', 'soldiers', 'camera', 'tags', 'sounds', 'effects', 'hud', 'ui', 'env', 'grass', 'render', 'other'];

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class PerfProbe {
  on = false;
  /**
   * Diagnostické A/B přepínače z adresy (`?perf&ab=noshadow,noanim`), jen pro řízené experimenty auditu:
   * noshadow (bez stínové mapy), noanim (vzdálení vojáci bez animace kostry), noeffects (bez částic,
   * stop a nábojnic), nohud (HUD se nepřekresluje), nograss (bez trávy), half (poloviční rozlišení renderu).
   */
  readonly ab: Set<string> = new Set(typeof location === 'undefined' ? [] : (new URLSearchParams(location.search).get('ab') ?? '').split(',').filter(Boolean));
  private n = 0;
  private interval = new Float32Array(CAP);
  private cpu = new Float32Array(CAP);
  private gpu = new Float32Array(CAP).fill(-1);
  private calls = new Uint32Array(CAP);
  private tris = new Uint32Array(CAP);
  private passes = new Uint8Array(CAP);
  private shadow = new Uint8Array(CAP);
  private sec = new Map<PerfSection, Float32Array>(SECTIONS.map((s) => [s, new Float32Array(CAP)]));
  private cur = new Map<PerfSection, number>(SECTIONS.map((s) => [s, 0]));
  private t0 = new Map<PerfSection, number>();
  private frameStart = 0;
  private lastStart = 0;
  private passCount = 0;
  private heap: Array<[number, number]> = [];
  private heapAt = 0;
  private gl: WebGL2RenderingContext | null = null;
  private ext: TimerExt | null = null;
  private pending: Array<{ q: WebGLQuery; i: number }> = [];
  private query: WebGLQuery | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private origRender: THREE.WebGLRenderer['render'] | null = null;
  /** Popisky událostí (první výstřel, výbuch…) s indexem snímku. */
  marks: Array<{ frame: number; label: string; t: number }> = [];

  attach(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.gl = renderer.getContext() as WebGL2RenderingContext;
  }

  enable() {
    if (this.on || !this.renderer) return;
    this.on = true;
    this.reset();
    this.ext = (this.gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null) ?? null;
    const r = this.renderer;
    this.origRender = r.render;
    const orig = r.render.bind(r);
    const skip = this.ab.has('norender');
    r.render = (s, c) => {
      this.passCount++;
      if (!skip) orig(s, c);
    };
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    if (this.renderer && this.origRender) this.renderer.render = this.origRender;
    this.origRender = null;
  }

  reset() {
    this.n = 0;
    this.heap = [];
    this.marks = [];
    this.gpu.fill(-1);
    this.pending = [];
  }

  mark(label: string) {
    if (this.on) this.marks.push({ frame: this.n, label, t: performance.now() });
  }

  begin(s: PerfSection) {
    if (this.on) this.t0.set(s, performance.now());
  }

  end(s: PerfSection) {
    if (!this.on) return;
    const t = this.t0.get(s);
    if (t !== undefined) this.cur.set(s, this.cur.get(s)! + performance.now() - t);
  }

  frameBegin(now: number) {
    if (!this.on) return;
    this.frameStart = performance.now();
    this.interval[this.n % CAP] = this.lastStart ? now - this.lastStart : 0;
    this.lastStart = now;
    for (const s of SECTIONS) this.cur.set(s, 0);
    this.passCount = 0;
    this.pollGpu();
  }

  /** Kolem vykreslení: GPU dotaz (když je k dispozici) a stav stínové mapy před vykreslením. */
  renderBegin() {
    if (!this.on) return;
    this.shadow[this.n % CAP] = this.renderer?.shadowMap.autoUpdate || this.renderer?.shadowMap.needsUpdate ? 1 : 0;
    this.begin('render');
    if (this.ext && this.gl && !this.query) {
      const q = this.gl.createQuery();
      if (q) {
        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
        this.query = q;
      }
    }
  }

  renderEnd() {
    if (!this.on) return;
    if (this.query && this.ext && this.gl) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push({ q: this.query, i: this.n });
      this.query = null;
    }
    this.end('render');
  }

  frameEnd() {
    if (!this.on) return;
    const i = this.n % CAP;
    const total = performance.now() - this.frameStart;
    let known = 0;
    for (const s of SECTIONS) {
      if (s === 'other') continue;
      const v = this.cur.get(s)!;
      known += v;
      this.sec.get(s)![i] = v;
    }
    this.sec.get('other')![i] = Math.max(0, total - known);
    this.cpu[i] = total;
    const info = this.renderer?.info.render;
    this.calls[i] = info?.calls ?? 0;
    this.tris[i] = info?.triangles ?? 0;
    this.passes[i] = Math.min(255, this.passCount);
    this.gpu[i] = -1;
    this.n++;
    const now = performance.now();
    if (now - this.heapAt > 1000) {
      this.heapAt = now;
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (m) this.heap.push([now, m.usedJSHeapSize]);
    }
  }

  private pollGpu() {
    const gl = this.gl, ext = this.ext;
    if (!gl || !ext || !this.pending.length) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const p = this.pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number;
      if (!disjoint && this.n - p.i < CAP) this.gpu[p.i % CAP] = ns / 1e6;
      gl.deleteQuery(p.q);
      this.pending.shift();
    }
  }

  /** Souhrn od snímku `from` (výchozí: vše zaznamenané v kruhovém poli). */
  report(from = 0) {
    const end = this.n, start = Math.max(from, end - CAP, 1);
    const pick = (a: ArrayLike<number>) => {
      const out: number[] = [];
      for (let k = start; k < end; k++) out.push(a[k % CAP]);
      return out;
    };
    const iv = pick(this.interval), cpu = pick(this.cpu);
    const gpu = pick(this.gpu).filter((v) => v >= 0);
    const sections: Record<string, ReturnType<typeof stats>> = {};
    for (const s of SECTIONS) sections[s] = stats(pick(this.sec.get(s)!));
    const sumMs = iv.reduce((a, b) => a + b, 0);
    return {
      frames: iv.length,
      seconds: sumMs / 1000,
      interval: stats(iv),
      hitches: { over25: iv.filter((v) => v > 25).length, over33: iv.filter((v) => v > 33.4).length, over50: iv.filter((v) => v > 50).length, over100: iv.filter((v) => v > 100).length },
      cpu: stats(cpu),
      gpu: gpu.length ? stats(gpu) : null,
      gpuTimer: !!this.ext,
      sections,
      calls: stats(pick(this.calls)),
      triangles: stats(pick(this.tris)),
      passes: stats(pick(this.passes)),
      shadowFrames: pick(this.shadow).reduce((a, b) => a + b, 0),
      heap: this.heap.map(([t, b]) => [Math.round(t), b]),
      marks: this.marks.filter((m) => m.frame >= start),
      /** Nejdelší snímky s rozpadem (pro záseky). */
      worst: [...Array(end - start).keys()]
        .map((k) => k + start)
        .sort((a, b) => this.interval[b % CAP] - this.interval[a % CAP])
        .slice(0, 8)
        .map((k) => ({ frame: k, interval: r2(this.interval[k % CAP]), cpu: r2(this.cpu[k % CAP]), top: SECTIONS.map((s) => [s, r2(this.sec.get(s)![k % CAP])] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 3) })),
    };
  }

  get frame() {
    return this.n;
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function stats(a: number[]) {
  if (!a.length) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => r2(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
  return { mean: r2(a.reduce((x, y) => x + y, 0) / a.length), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: r2(s[s.length - 1]) };
}

export const perf = new PerfProbe();
