/**
 * Zvuk hry (WebAudio). Kroky, dopady, mechanika a výbuchy jsou nahrávky CC0 (Kenney – viz
 * ASSET_CREDITS.md), výstřely se syntetizují podle druhu zbraně. Zdroje ve světě jdou přes
 * PannerNode (směr a vzdálenost vůči posluchači = kameře); zdroj za zdí je ztlumený a zastřený.
 * Kontext se vytvoří až po uživatelské interakci (autoplay omezení prohlížečů).
 */
export type ShotKind = 'rifle' | 'mg' | 'shotgun' | 'sniper' | 'pistol';
export type V3Like = { x: number; y: number; z: number };

/** Sady nahrávek: klíč → soubory v public/audio (bez přípony). */
const BANK: Record<string, string[]> = {
  stepConcrete: [0, 1, 2, 3, 4].map((i) => `footstep_concrete_00${i}`),
  stepGrass: [0, 1, 2, 3, 4].map((i) => `footstep_grass_00${i}`),
  stepWood: [0, 1, 2, 3, 4].map((i) => `footstep_wood_00${i}`),
  stepSand: [0, 1, 2, 3, 4].map((i) => `footstep_snow_00${i}`),
  stepMetal: [0, 1, 2].map((i) => `impactMetal_light_00${i}`),
  hitHard: [0, 1, 2, 3].map((i) => `impactGeneric_light_00${i}`),
  hitMetal: [0, 1, 2].map((i) => `impactMetal_medium_00${i}`),
  hitWood: [0, 1, 2].map((i) => `impactWood_medium_00${i}`),
  hitSoft: [0, 1, 2].map((i) => `impactSoft_medium_00${i}`),
  hitFlesh: [0, 1, 2].map((i) => `impactPunch_medium_00${i}`),
  plate: ['impactPlate_light_000', 'impactPlate_light_001'],
  boom: [0, 1, 2].map((i) => `explosionCrunch_00${i}`),
  boomLow: ['lowFrequency_explosion_000'],
  click: ['metalClick'],
  latch: ['metalLatch'],
  belt: ['beltHandle1', 'beltHandle2'],
  cloth: ['cloth1', 'cloth2', 'cloth3'],
  knifeDraw: ['drawKnife1', 'drawKnife2'],
  knife: ['knifeSlice'],
  pouch: ['handleSmallLeather'],
};

const STEP_BANK: Record<string, string> = { concrete: 'stepConcrete', plaster: 'stepConcrete', brick: 'stepConcrete', asphalt: 'stepConcrete', metal: 'stepMetal', wood: 'stepWood', sand: 'stepSand', dirt: 'stepGrass', fabric: 'stepGrass', flesh: 'stepGrass' };
const HIT_BANK: Record<string, string> = { concrete: 'hitHard', plaster: 'hitHard', brick: 'hitHard', asphalt: 'hitHard', metal: 'hitMetal', wood: 'hitWood', sand: 'hitSoft', dirt: 'hitSoft', fabric: 'hitSoft', flesh: 'hitFlesh' };

interface PlayOpts {
  gain?: number;
  /** Poloha ve světě; bez ní zní zvuk „v hlavě“ (vlastní zbraň, UI). */
  pos?: V3Like | null;
  /** Vzdálenost, do které zvuk neslábne (m). */
  ref?: number;
  /** Zdroj je za zdí: tišší a zastřený. */
  occluded?: boolean;
  rate?: number;
  delay?: number;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = false;
  private last = new Map<string, number>();
  private ear: V3Like = { x: 0, y: 0, z: 0 };
  volume = 0.6;
  /** Kvalitnější prostorový zvuk pro sluchátka (HRTF); vypnuto = levnější stereo. */
  hrtf = true;
  /** Kořen souborů (Vite BASE_URL). */
  base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Zavolat z obsluhy kliknutí/klávesy. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // Jemný limiter: dávka kulometu ani výbuch nepřebudí výstup.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.0;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    void this.load();
  }

  /** Nahrávky se stahují na pozadí; dokud nejsou, hraje syntetická náhrada. */
  private async load() {
    if (this.loading || !this.ctx) return;
    this.loading = true;
    const names = [...new Set(Object.values(BANK).flat())];
    await Promise.all(
      names.map(async (n) => {
        try {
          const r = await fetch(`${this.base}audio/${n}.ogg`);
          if (!r.ok) return;
          this.buffers.set(n, await this.ctx!.decodeAudioData(await r.arrayBuffer()));
        } catch {
          /* soubor chybí nebo nejde dekódovat → syntetická náhrada */
        }
      }),
    );
  }

  get loaded() {
    return this.buffers.size;
  }

  suspend() {
    void this.ctx?.suspend();
  }

  /** Posluchač = kamera (volat každý snímek). */
  setListener(pos: V3Like, forward: V3Like, up: V3Like = { x: 0, y: 1, z: 0 }) {
    this.ear = { x: pos.x, y: pos.y, z: pos.z };
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = forward.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  private dist(p?: V3Like | null) {
    return p ? Math.hypot(p.x - this.ear.x, p.y - this.ear.y, p.z - this.ear.z) : 0;
  }

  /** Výstupní řetězec zdroje: [zastření] → [prostor] → master. Vrací uzel, do kterého se zdroj připojí. */
  private out(o: PlayOpts): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    let node: AudioNode = this.master;
    if (o.pos) {
      const p = ctx.createPanner();
      p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = o.ref ?? 3;
      p.rolloffFactor = 1.1;
      p.maxDistance = 400;
      p.positionX.value = o.pos.x;
      p.positionY.value = o.pos.y;
      p.positionZ.value = o.pos.z;
      p.connect(node);
      node = p;
    }
    if (o.occluded) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0.45;
      lp.connect(g).connect(node);
      node = lp;
    }
    return node;
  }

  /** Nahrávka ze sady (náhodná varianta, mírná změna výšky). Vrací false, když ještě není načtená. */
  private sample(set: string, o: PlayOpts = {}): boolean {
    const ctx = this.ctx;
    const list = BANK[set];
    if (!ctx || !list) return false;
    const buf = this.buffers.get(list[Math.floor(Math.random() * list.length)]);
    if (!buf) return false;
    const dst = this.out(o);
    if (!dst) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    src.connect(g).connect(dst);
    src.start(ctx.currentTime + (o.delay ?? 0));
    return true;
  }

  private burst(opts: { gain: number; decay: number; lp: number; hp?: number; delay?: number; rate?: number }, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const dst = this.out(o);
    if (!dst) return;
    const t = ctx.currentTime + (opts.delay ?? 0) + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = opts.rate ?? 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opts.lp;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = opts.hp ?? 40;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain * (o.gain ?? 1), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + opts.decay);
    src.connect(lp).connect(hp).connect(g).connect(dst);
    src.start(t, Math.random() * 0.5);
    src.stop(t + opts.decay + 0.05);
  }

  private thump(freq: number, gain: number, decay: number, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const dst = this.out(o);
    if (!dst) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 2, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * (o.gain ?? 1), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    osc.connect(g).connect(dst);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  private tone(freq: number, gain: number, decay: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.03);
  }

  /** Syntéza výstřelu podle druhu zbraně: třesk, úder těla a dozvuk. */
  private gun(kind: ShotKind, o: PlayOpts) {
    const r = 0.95 + Math.random() * 0.1;
    if (kind === 'shotgun') {
      this.burst({ gain: 1.0, decay: 0.14, lp: 5000, hp: 140, rate: r * 0.75 }, o);
      this.thump(52, 0.95, 0.24, o);
      this.burst({ gain: 0.26, decay: 0.7, lp: 1000, hp: 90, delay: 0.025, rate: 0.5 }, o);
    } else if (kind === 'sniper') {
      this.burst({ gain: 1.0, decay: 0.11, lp: 9500, hp: 220, rate: r * 0.9 }, o);
      this.thump(58, 1.0, 0.28, o);
      this.burst({ gain: 0.32, decay: 1.1, lp: 1200, hp: 80, delay: 0.03, rate: 0.45 }, o);
    } else if (kind === 'pistol') {
      this.burst({ gain: 0.75, decay: 0.06, lp: 8000, hp: 500, rate: r * 1.15 }, o);
      this.thump(95, 0.5, 0.1, o);
      this.burst({ gain: 0.12, decay: 0.3, lp: 1800, hp: 200, delay: 0.02, rate: 0.7 }, o);
    } else {
      const mg = kind === 'mg';
      this.burst({ gain: mg ? 0.8 : 0.9, decay: 0.09, lp: mg ? 7500 : 9000, hp: 300, rate: r * (mg ? 0.92 : 1) }, o);
      this.thump(mg ? 62 : 70, 0.7, 0.16, o);
      this.burst({ gain: 0.18, decay: 0.45, lp: 1400, hp: 120, delay: 0.02, rate: 0.6 }, o);
    }
  }

  /** Vlastní výstřel (bez prostoru – zbraň je u hlavy). */
  shot(kind: ShotKind = 'rifle') {
    this.gun(kind, {});
  }

  /** Cizí výstřel ve světě: směr, útlum a zpoždění podle vzdálenosti, za zdí zastřený. */
  shotAt(kind: ShotKind, pos: V3Like, occluded = false) {
    const d = this.dist(pos);
    if (d > 380) return;
    this.gun(kind, { pos, ref: kind === 'pistol' ? 9 : 14, occluded, delay: Math.min(1, d / 343) });
  }

  /** Výbuch granátu. */
  explosionAt(pos: V3Like, occluded = false) {
    const d = this.dist(pos);
    const o: PlayOpts = { pos, ref: 16, occluded, delay: Math.min(0.9, d / 343) };
    const ok = this.sample('boom', { ...o, gain: 1.6, rate: 0.8 });
    this.sample('boomLow', { ...o, gain: 1.3 });
    if (!ok) this.burst({ gain: 1, decay: 0.35, lp: 4200, hp: 40, rate: 0.55 }, o);
    this.thump(38, 1.1, 0.6, o);
    this.burst({ gain: 0.35, decay: 1.6, lp: 600, hp: 40, rate: 0.35, delay: 0.05 }, o);
  }

  /** Syčení dýmovnice. */
  hissAt(pos: V3Like) {
    this.burst({ gain: 0.5, decay: 1.2, lp: 6000, hp: 1800, rate: 1.3 }, { pos, ref: 3 });
  }

  /** Dopad střely na povrch. */
  impactAt(surface: string, pos: V3Like) {
    const d = this.dist(pos);
    if (d > 90) return;
    const o: PlayOpts = { pos, ref: 2.5, gain: surface === 'flesh' ? 0.9 : 0.7 };
    if (this.sample(HIT_BANK[surface] ?? 'hitHard', o)) return;
    const lp = surface === 'metal' ? 7000 : surface === 'wood' ? 2500 : surface === 'sand' || surface === 'dirt' ? 1200 : 3500;
    this.burst({ gain: 0.5, decay: surface === 'metal' ? 0.12 : 0.06, lp, hp: 400 }, o);
  }

  /**
   * Krok. `pos` = null pro vlastní kroky (bez prostoru). `loud` 0–1: sprint 1, chůze ~0,6, dřep ~0,3.
   * Vleže se místo kroku ozve šustění látky.
   */
  footstep(surface: string, pos: V3Like | null, loud: number, prone = false) {
    if (pos && this.dist(pos) > 40) return;
    const o: PlayOpts = { pos, ref: 2, gain: (pos ? 0.9 : 0.45) * (0.25 + 0.75 * loud) };
    if (prone) {
      if (!this.sample('cloth', { ...o, gain: (o.gain ?? 1) * 0.7 })) this.burst({ gain: 0.08, decay: 0.12, lp: 1800, hp: 300 }, o);
      return;
    }
    if (!this.sample(STEP_BANK[surface] ?? 'stepConcrete', o)) this.burst({ gain: 0.12, decay: 0.05, lp: surface === 'sand' || surface === 'dirt' ? 900 : 2200, hp: 120 }, o);
  }

  /** Dopad po skoku / pádu. */
  land(surface: string, pos: V3Like | null, hard = false) {
    const o: PlayOpts = { pos, ref: 2.5, gain: hard ? 1.2 : 0.6, rate: 0.8 };
    this.sample(STEP_BANK[surface] ?? 'stepConcrete', o);
    if (hard) this.thump(60, 0.5, 0.18, { pos, ref: 2.5 });
  }

  /** Mechanika zbraně: pumpa, vložení náboje, víko, závěr; `pos` pro cizího hráče. */
  mech(kind: 'pump' | 'shell' | 'cover' | 'bolt' | 'magOut' | 'magIn' | 'rack', pos: V3Like | null = null) {
    const o: PlayOpts = { pos, ref: 1.5, gain: pos ? 0.9 : 0.6 };
    if (kind === 'magOut') {
      if (!this.sample('latch', o)) this.burst({ gain: 0.2, decay: 0.05, lp: 3500, hp: 500, rate: 0.8 }, o);
    } else if (kind === 'magIn') {
      if (!this.sample('click', { ...o, rate: 0.85 })) this.burst({ gain: 0.24, decay: 0.05, lp: 4200, hp: 600 }, o);
    } else if (kind === 'rack' || kind === 'bolt') {
      const ok = this.sample('latch', { ...o, rate: 1.25 });
      this.sample('click', { ...o, delay: 0.13, rate: 1.1 });
      if (!ok) {
        this.burst({ gain: 0.18, decay: 0.035, lp: 5200, hp: 900, rate: 1.1 }, o);
        this.burst({ gain: 0.22, decay: 0.05, lp: 3800, hp: 500, rate: 0.85, delay: 0.12 }, o);
      }
    } else if (kind === 'pump') {
      const ok = this.sample('latch', { ...o, rate: 0.9 });
      this.sample('latch', { ...o, delay: 0.16, rate: 1.05 });
      if (!ok) {
        this.burst({ gain: 0.22, decay: 0.05, lp: 4000, hp: 600, rate: 0.8 }, o);
        this.burst({ gain: 0.26, decay: 0.05, lp: 4500, hp: 700, rate: 0.9, delay: 0.16 }, o);
      }
    } else if (kind === 'shell') {
      if (!this.sample('click', { ...o, rate: 1.3, gain: (o.gain ?? 1) * 0.8 })) this.burst({ gain: 0.14, decay: 0.04, lp: 5000, hp: 1200, rate: 1.2 }, o);
    } else if (!this.sample('belt', o)) this.burst({ gain: 0.2, decay: 0.06, lp: 3500, hp: 500, rate: 0.7 }, o);
  }

  /** Přehození výbavy (látka / popruh), tasení nože, sek, sáhnutí do brašny. */
  handle(kind: 'switch' | 'knifeDraw' | 'knife' | 'pouch', pos: V3Like | null = null) {
    const o: PlayOpts = { pos, ref: 1.5, gain: pos ? 0.8 : 0.5 };
    const set = kind === 'switch' ? 'cloth' : kind === 'knifeDraw' ? 'knifeDraw' : kind === 'knife' ? 'knife' : 'pouch';
    if (!this.sample(set, o)) this.burst({ gain: 0.1, decay: 0.08, lp: 2500, hp: 400 }, o);
  }

  click() {
    if (!this.sample('click', { gain: 0.5, rate: 1.4 })) this.burst({ gain: 0.25, decay: 0.03, lp: 6000, hp: 1500 });
  }

  /** Potvrzení zásahu střelci: tělo (tik), hlava (vyšší cinknutí), vyřazení (dvojitý tón). */
  hitmarker(kind: 'body' | 'head' | 'kill' = 'body') {
    const now = performance.now();
    if (kind === 'body' && now - (this.last.get('hm') ?? 0) < 40) return;
    this.last.set('hm', now);
    if (kind === 'kill') {
      this.sample('plate', { gain: 0.55, rate: 1.1 });
      this.tone(660, 0.16, 0.12);
      this.tone(990, 0.16, 0.2, 0.08);
    } else if (kind === 'head') {
      this.burst({ gain: 0.16, decay: 0.04, lp: 7000, hp: 3000 });
      this.tone(1500, 0.18, 0.14);
    } else this.burst({ gain: 0.16, decay: 0.04, lp: 5000, hp: 2500 });
  }

  /** Vlastní zranění: tupý úder do těla. */
  hurt(amount: number) {
    const g = Math.min(1, 0.35 + amount / 80);
    if (!this.sample('hitFlesh', { gain: g })) this.thump(90, g * 0.6, 0.12);
  }
}
