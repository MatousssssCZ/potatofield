/**
 * Procedurální zvuky (WebAudio, žádné nahrávky → bez licenčních závislostí).
 * Kontext se vytvoří až po uživatelské interakci (autoplay omezení prohlížečů).
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.6;

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
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.0;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  suspend() {
    void this.ctx?.suspend();
  }

  private burst(opts: { gain: number; decay: number; lp: number; hp?: number; delay?: number; rate?: number; pan?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
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
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + opts.decay);
    const pan = ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    src.connect(lp).connect(hp).connect(g).connect(pan).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + opts.decay + 0.05);
  }

  private thump(freq: number, gain: number, decay: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /** Vlastní výstřel: ostrý třesk + nízký úder + krátký dozvuk. */
  shot(kind: 'rifle' | 'mg' | 'shotgun' = 'rifle') {
    const r = 0.95 + Math.random() * 0.1;
    if (kind === 'shotgun') {
      // Brokovnice: tupější, hlubší a delší třesk; pumpa je samostatný mechanický zvuk.
      this.burst({ gain: 1.0, decay: 0.14, lp: 5000, hp: 140, rate: r * 0.75 });
      this.thump(52, 0.95, 0.24);
      this.burst({ gain: 0.26, decay: 0.7, lp: 1000, hp: 90, delay: 0.025, rate: 0.5 });
      return;
    }
    this.burst({ gain: kind === 'mg' ? 0.8 : 0.9, decay: 0.09, lp: kind === 'mg' ? 7500 : 9000, hp: 300, rate: r * (kind === 'mg' ? 0.92 : 1) });
    this.thump(kind === 'mg' ? 62 : 70, 0.7, 0.16);
    this.burst({ gain: 0.18, decay: 0.45, lp: 1400, hp: 120, delay: 0.02, rate: 0.6 });
  }

  /** Mechanika: pumpa, vložení náboje, víko (krátké kovové cvaknutí). */
  mech(kind: 'pump' | 'shell' | 'cover' | 'bolt') {
    if (kind === 'bolt') {
      this.burst({ gain: 0.18, decay: 0.035, lp: 5200, hp: 900, rate: 1.1 });
      this.burst({ gain: 0.22, decay: 0.05, lp: 3800, hp: 500, rate: 0.85, delay: 0.12 });
    } else if (kind === 'pump') {
      this.burst({ gain: 0.22, decay: 0.05, lp: 4000, hp: 600, rate: 0.8 });
      this.burst({ gain: 0.26, decay: 0.05, lp: 4500, hp: 700, rate: 0.9, delay: 0.16 });
    } else if (kind === 'shell') this.burst({ gain: 0.14, decay: 0.04, lp: 5000, hp: 1200, rate: 1.2 });
    else this.burst({ gain: 0.2, decay: 0.06, lp: 3500, hp: 500, rate: 0.7 });
  }

  /** Vzdálený výstřel: tlumenější, se zpožděním podle vzdálenosti (rychlost zvuku). */
  distantShot(distance: number, pan: number) {
    const att = Math.max(0.03, Math.min(0.6, 18 / (distance + 10)));
    this.burst({ gain: att, decay: 0.25, lp: Math.max(900, 6000 - distance * 25), hp: 150, delay: Math.min(0.6, distance / 343), pan });
  }

  impact(surface: string, distance: number) {
    if (distance > 80) return;
    const g = Math.max(0.02, 0.25 - distance * 0.003);
    const lp = surface === 'metal' ? 7000 : surface === 'wood' ? 2500 : surface === 'sand' || surface === 'dirt' ? 1200 : 3500;
    this.burst({ gain: g, decay: surface === 'metal' ? 0.12 : 0.06, lp, hp: 400 });
  }

  click() {
    this.burst({ gain: 0.25, decay: 0.03, lp: 6000, hp: 1500 });
  }

  hitmarker() {
    this.burst({ gain: 0.15, decay: 0.04, lp: 5000, hp: 2500 });
  }
}
