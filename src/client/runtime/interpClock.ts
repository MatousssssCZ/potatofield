/**
 * Hodiny pro interpolaci vzdálených hráčů.
 *
 * Dřív se čas serveru přepisoval při každém příchozím snímku – kolísání příchodu paketů (síť,
 * přibrzděný server na sdíleném CPU) pak posouvalo vykreslovaný čas skokem dopředu a dozadu
 * a vzdálení hráči trhaně poskakovali. Tady:
 * - posun hodin (čas serveru − čas klienta) se odhaduje z nejrychleji doručených snímků,
 * - zpoždění interpolace se přizpůsobí naměřenému kolísání (klidná síť ~80 ms, horší až 350 ms),
 * - vykreslovaný čas běží plynule a jen mírně zrychluje / zpomaluje k cíli (nikdy necouvá).
 */
export class InterpClock {
  private offset = 0;
  private inited = false;
  private lastWall = 0;
  /** Zpoždění snímku proti nejrychlejšímu (s), klouzavě: rychle nahoru, pomalu dolů. */
  jitter = 0;
  /** Aktuální zpoždění interpolace (s). */
  delay = 0.1;
  private rt = 0;
  private rtWall = -1;

  constructor(private readonly snapInterval = 1 / 30) {}

  /** Příchozí snímek: čas serveru (s) a čas příchodu u klienta (s). */
  onSnap(serverTime: number, wall: number) {
    const sample = serverTime - wall;
    if (!this.inited) {
      this.offset = sample;
      this.inited = true;
      this.lastWall = wall;
      return;
    }
    // Odhad sleduje nejrychlejší doručení; pomalu klesá, aby dohnal případné zpomalení serveru.
    this.offset = Math.max(sample, this.offset - 0.03 * Math.max(0, wall - this.lastWall));
    this.lastWall = wall;
    const late = this.offset - sample;
    this.jitter += (late - this.jitter) * (late > this.jitter ? 0.3 : 0.02);
    const want = Math.min(0.35, Math.max(0.08, this.snapInterval + 0.03 + 2 * this.jitter));
    this.delay += (want - this.delay) * (want > this.delay ? 0.2 : 0.03);
  }

  /** Odhad současného času serveru. */
  serverNow(wall: number) {
    return wall + this.offset;
  }

  /** Čas, ve kterém se vzdálení hráči vykreslí (plynulý, neklesající). */
  renderTime(wall: number) {
    const target = wall + this.offset - this.delay;
    if (this.rtWall < 0 || Math.abs(target - this.rt) > 0.5) {
      this.rt = target;
    } else {
      const dt = Math.max(0, wall - this.rtWall);
      // Rychlost 0,8–1,25×: rozdíl 100 ms se dorovná zhruba za půl sekundy bez viditelného skoku.
      this.rt += dt * Math.min(1.25, Math.max(0.8, 1 + (target - this.rt) * 2.5));
    }
    this.rtWall = wall;
    return this.rt;
  }
}
