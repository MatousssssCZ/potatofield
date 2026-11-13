import { NET, PROTOCOL_VERSION, decodeRemote, type ClientMsg, type ServerMsg, SLOW_SNAP_FIELDS } from './protocol';
import type { InputFrame } from '../sim/input';

/** Minimální rozhraní WebSocketu (prohlížeč i knihovna ws). */
export interface WsLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface NetConditions {
  /** Jednosměrné zpoždění = RTT / 2 (ms). */
  latencyMs: number;
  jitterMs: number;
  /** Ztráta zpráv se vstupy a snapshotů (TCP doručí vše – simuluje se zahozením). */
  lossPct: number;
}

/**
 * Síťové jádro klienta: handshake, odesílání vstupů s redundancí, příjem zpráv,
 * měření RTT a simulace síťových podmínek. Bez renderu – používá ho prohlížeč i boti.
 */
export class NetClient {
  id = '';
  welcome: Extract<ServerMsg, { t: 'welcome' }> | null = null;
  lastSnap: Extract<ServerMsg, { t: 'snap' }> | null = null;
  readonly inbox: ServerMsg[] = [];
  rtt = 0;
  bytesIn = 0;
  bytesOut = 0;
  closed = false;
  closeReason = '';
  private pending: InputFrame[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  onSnapshot: (s: Extract<ServerMsg, { t: 'snap' }>) => void = () => {};
  onMessage: (m: ServerMsg) => void = () => {};

  constructor(
    private ws: WsLike,
    private name: string,
    public cond: NetConditions = { latencyMs: 0, jitterMs: 0, lossPct: 0 },
  ) {
    ws.onopen = () => {
      this.sendNow({ t: 'hello', v: PROTOCOL_VERSION, name: this.name });
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: Date.now() }), 1000);
    };
    ws.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.bytesIn += raw.length;
      let m: ServerMsg;
      try {
        m = JSON.parse(raw) as ServerMsg;
      } catch {
        return;
      }
      this.delay(() => this.receive(m), m.t === 'snap' && this.lost());
    };
    ws.onclose = () => {
      this.closed = true;
      if (this.pingTimer) clearInterval(this.pingTimer);
    };
    ws.onerror = () => {};
  }

  private lost() {
    return this.cond.lossPct > 0 && Math.random() * 100 < this.cond.lossPct;
  }

  private delay(fn: () => void, drop = false) {
    if (drop) return;
    const d = this.cond.latencyMs + (Math.random() * 2 - 1) * this.cond.jitterMs;
    if (d <= 0) fn();
    else setTimeout(fn, d);
  }

  private slow: Record<string, unknown> = {};

  private receive(m: ServerMsg) {
    if (m.t === 'welcome') {
      this.welcome = m;
      this.id = m.id;
    } else if (m.t === 'snap') {
      if (m.o) {
        m.others = m.o.map(decodeRemote);
        delete m.o;
      }
      // Zprávy mimo pořadí (jitter) – starší snapshot zahodit.
      if (this.lastSnap && m.tick <= this.lastSnap.tick) return;
      // Pole posílaná jen při změně: chybějící se převezmou z posledního snapshotu.
      const prev = this.slow as Record<string, unknown>, cur = m as unknown as Record<string, unknown>;
      for (const k of SLOW_SNAP_FIELDS) {
        if (cur[k] === undefined) cur[k] = prev[k] ?? (k === 'order' || k === 'cps' ? null : k === 'command' ? { commander: null, uavReadyAt: 0, scanReadyAt: 0, uav: null } : []);
        else prev[k] = cur[k];
      }
      // Inventář (sloty a počty) stejně: chybí-li, platí poslední.
      const me = m.me as unknown as Record<string, unknown>;
      if (me.inv === undefined) me.inv = prev['me.inv'] ?? null;
      else prev['me.inv'] = me.inv;
      this.lastSnap = m;
      this.onSnapshot(m);
    } else if (m.t === 'pong') this.rtt = Date.now() - m.c;
    else if (m.t === 'bye') this.closeReason = m.reason;
    this.inbox.push(m);
    if (this.inbox.length > 500) this.inbox.splice(0, this.inbox.length - 500);
    this.onMessage(m);
  }

  private sendNow(m: ClientMsg) {
    if (this.ws.readyState !== 1) return;
    const s = JSON.stringify(m);
    this.bytesOut += s.length;
    this.ws.send(s);
  }

  send(m: ClientMsg) {
    this.delay(() => this.sendNow(m));
  }

  /** Vstup ticku: posílá se s posledními 3 předchozími (redundance proti ztrátám). */
  sendInput(f: InputFrame) {
    this.pending.push(f);
    if (this.pending.length > 4) this.pending.shift();
    const msg: ClientMsg = { t: 'input', frames: [...this.pending].slice(-Math.min(4, NET.maxInputsPerMessage)) };
    this.delay(() => this.sendNow(msg), this.lost());
  }

  close() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws.close();
  }
}
