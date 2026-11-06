import type { StringKey } from './strings';

/**
 * Záměr nasazení (oddělený od UI, testovatelný). Stavy:
 *  - idle: jen návrh výběru (classa + cíl), nic se neodesílá,
 *  - armed: hráč potvrdil Nasadit během odpočtu → klient drží záměr a odešle ho JEDNOU,
 *    jakmile server dovolí (čas vypršel, hráč je definitivně mrtvý, cíl je platný),
 *  - sending: požadavek odeslán, čeká se na výsledek (nová postava / odmítnutí / timeout).
 * Server rozhoduje o všem (čas, kit, cíl, místo); klient jen nepouští duplicitní požadavky.
 * Změna výběru, ztráta cíle, oživení, nové kolo i odpojení záměr zruší – nikdy tiché přesměrování.
 */
export interface DeployTarget {
  id: string;
  kind: 'cp' | 'base' | 'leader' | 'test';
  name: string;
  x: number;
  z: number;
  rel: 'own' | 'enemy' | 'neutral';
  /** Lze sem nasadit (podle serveru). */
  available: boolean;
  /** Proč ne (vlastní bod bez místa, nepřátelský bod…). */
  reason?: StringKey;
  /** ID spawnu, který se pošle serveru (ten vybere bezpečné místo v oblasti). */
  spawnId: string | null;
  letter?: string;
}

export interface IntentInput {
  now: number;
  life: 'alive' | 'downed' | 'dead';
  lifeId: number;
  /** Zbývá do nejbližšího povoleného nasazení (s, ze stavu serveru). */
  waitLeft: number;
  /** Aktuální podoba vybraného cíle (null = cíl už neexistuje / nevybrán). */
  target: DeployTarget | null;
  /** Vybraná classa je platná pro server. */
  kitOk: boolean;
  /** Klíč kola (mapa + scénář + start) – změna = nové kolo. */
  roundKey: string;
  ended: boolean;
}

export type IntentPhase = 'idle' | 'armed' | 'sending';
export interface IntentNote {
  key: StringKey;
  vars?: Record<string, string | number>;
  kind: 'info' | 'warn';
}

export class DeployIntent {
  phase: IntentPhase = 'idle';
  note: IntentNote | null = null;
  /** Pořadové číslo požadavku (odpovědi starších požadavků se ignorují). */
  reqId = 0;
  private armedTarget: string | null = null;
  private sentAt = 0;
  private sentLifeId = -1;
  private roundKey = '';
  /** Počet skutečně odeslaných požadavků (testy). */
  sent = 0;
  /** Odeslání požadavku; vrací okamžité odmítnutí (offline) nebo null. */
  onSend: (target: DeployTarget, reqId: number) => string | null = () => null;

  /** Výběr se změnil (classa / cíl): potvrzené čekání se ruší, nový souhlas je nutný. */
  selectionChanged() {
    if (this.phase === 'armed') {
      this.phase = 'idle';
      this.armedTarget = null;
      this.note = { key: 'deploy.changedCancel', kind: 'warn' };
    }
  }

  cancel() {
    if (this.phase === 'armed') {
      this.phase = 'idle';
      this.armedTarget = null;
      this.note = null;
    }
  }

  /** Hráč stiskl Nasadit. */
  confirm(inp: IntentInput) {
    if (this.phase === 'sending' || inp.life !== 'dead' || inp.ended) return; // zaživa ani ve vyřazení se nepotvrzuje
    if (!inp.target || !inp.target.available || !inp.kitOk) return;
    this.note = null;
    this.armedTarget = inp.target.id;
    this.phase = 'armed';
    this.update(inp);
  }

  /** Server nasazení odmítl (jen pokud právě čekáme na odpověď). */
  reject(reason: string) {
    if (this.phase !== 'sending') return;
    this.phase = 'idle';
    this.armedTarget = null;
    this.note = { key: 'deploy.rejected', vars: { reason }, kind: 'warn' };
  }

  /** Každý snímek UI: zneplatnění, odeslání po dosažení způsobilosti, výsledek požadavku. */
  update(inp: IntentInput) {
    if (inp.roundKey !== this.roundKey) {
      const first = this.roundKey === '';
      this.roundKey = inp.roundKey;
      if (!first) this.reset(this.phase !== 'idle' ? { key: 'deploy.roundCancel', kind: 'warn' } : null);
    }
    if (this.phase === 'sending') {
      if (inp.life === 'alive' && inp.lifeId !== this.sentLifeId) {
        // Server postavu vytvořil – vítězí skutečný herní stav.
        this.reset(null);
      } else if (inp.now - this.sentAt > 6) this.reset({ key: 'deploy.timeout', kind: 'warn' });
      return;
    }
    if (this.phase !== 'armed') return;
    if (inp.life === 'alive') return this.reset(null); // oživen / nasazen jinak → záměr končí
    if (inp.ended) return this.reset(null);
    const t = inp.target;
    if (!t || t.id !== this.armedTarget) return this.reset({ key: this.armedTarget?.startsWith('squad:') ? 'deploy.leaderLost' : 'deploy.targetLost', kind: 'warn' });
    if (!t.available) return this.reset({ key: t.kind === 'leader' ? 'deploy.leaderLost' : 'deploy.targetLost', kind: 'warn' });
    if (!inp.kitOk) return this.reset({ key: 'deploy.kitInvalid', kind: 'warn' });
    if (inp.life === 'downed' || inp.waitLeft > 0) return; // čeká na definitivní smrt / odpočet
    this.phase = 'sending';
    this.sentAt = inp.now;
    this.sentLifeId = inp.lifeId;
    this.sent++;
    const err = this.onSend(t, ++this.reqId);
    if (err) this.reject(err);
  }

  private reset(note: IntentNote | null) {
    this.phase = 'idle';
    this.armedTarget = null;
    this.note = note;
  }

  get armedFor() {
    return this.armedTarget;
  }
}
