import type { MapDocument, SpawnPoint } from '../../shared/map/schema';
import type { PhysicsWorld } from '../../shared/physics/world';
import { NetClient, type NetConditions, type WsLike } from '../../shared/net/client';
import type { ContactInfo, OrderInfo, RemoteState, ServerMsg, SquadInfo } from '../../shared/net/protocol';
import { createConquest, type ConquestState } from '../../shared/sim/conquest';
import type { InputFrame } from '../../shared/sim/input';
import { MOVEMENT } from '../../shared/config/movement';
import { PF_RIFLE } from '../../shared/config/weapon';
import type { SimEvent } from '../../shared/sim/match';
import { PlayerController, clonePlayerState, createPlayerState, type PlayerState } from '../../shared/sim/player';
import { createWeaponState, stepWeapon, type WeaponState } from '../../shared/sim/weapon';
import { angleDiff } from '../../shared/math';
import type { LadderDef } from '../../world/parts';
import type { GameDriver, PlayerView } from './driver';

/**
 * Síťový driver: predikce vlastního pohybu a akcí zbraně stejným kódem jako server,
 * při snapshotu korekce na autoritativní stav a přehrání nepotvrzených vstupů.
 * Vzdálení hráči se interpolují 100 ms zpět (tělo, zamíření i postoj ve stejném čase).
 */
export class NetDriver implements GameDriver {
  readonly mode = 'network' as const;
  readonly net: NetClient;
  private ctrl: PlayerController | null = null;
  private state: PlayerState | null = null;
  private weapon: WeaponState | null = null;
  private pending: InputFrame[] = [];
  private seq = 0;
  private corrections = 0;
  private events: SimEvent[] = [];
  private seenEvents = new Set<string>();
  private buffer: Array<{ time: number; recv: number; others: RemoteState[] }> = [];
  private cq: ConquestState | null = null;
  doc: MapDocument | null = null;
  squads: SquadInfo[] = [];
  order: OrderInfo | null = null;
  contacts: ContactInfo[] = [];
  chat: Array<{ id: string; name: string; ch: string; text: string; at: number; radio?: boolean }> = [];
  scores: Extract<ServerMsg, { t: 'snap' }>['scores'] = [];
  private serverTime = 0;
  private serverTimeAt = 0;
  onReject: (what: string, reason: string) => void = () => {};

  constructor(ws: WsLike, name: string, cond?: NetConditions) {
    this.net = new NetClient(ws, name, cond);
    this.net.onSnapshot = (s) => this.onSnap(s);
    this.net.onMessage = (m) => this.onMsg(m);
  }

  get localId() {
    return this.net.id || 'local';
  }

  /** Po welcome: sestavit predikci nad stejným fyzikálním světem jako server. */
  attachWorld(phys: PhysicsWorld, ladders: LadderDef[]) {
    this.ctrl = new PlayerController(phys, MOVEMENT);
    this.ctrl.ladders = ladders;
    this.phys = phys;
  }
  private phys: PhysicsWorld | null = null;

  private onMsg(m: ServerMsg) {
    if (m.t === 'welcome') {
      this.doc = m.map;
      this.cq = m.conquest ? createConquest(m.map, m.scenarioId) : null;
    } else if (m.t === 'events') {
      for (const e of m.list) {
        // Deduplikace jednorázových efektů (pozdní/duplicitní doručení).
        const key = e.type === 'shot' ? `s:${e.key}` : e.type === 'impact' ? `i:${e.key}` : e.type === 'hit' ? `h:${e.owner}:${e.target}:${e.damage}:${this.serverTime.toFixed(2)}` : e.type === 'death' ? `d:${e.id}:${e.lifeId}` : null;
        if (key) {
          if (this.seenEvents.has(key)) continue;
          this.seenEvents.add(key);
          if (this.seenEvents.size > 4000) this.seenEvents = new Set([...this.seenEvents].slice(-2000));
        }
        this.events.push(e);
      }
    } else if (m.t === 'chat') this.chat.push({ id: m.id, name: m.name, ch: m.ch, text: m.text, at: performance.now() });
    else if (m.t === 'radio') this.chat.push({ id: m.id, name: m.name, ch: 'radio', text: m.radio, at: performance.now(), radio: true });
    else if (m.t === 'reject') this.onReject(m.what, m.reason);
    if (this.chat.length > 80) this.chat.splice(0, this.chat.length - 80);
  }

  private onSnap(s: Extract<ServerMsg, { t: 'snap' }>) {
    this.serverTime = s.time;
    this.serverTimeAt = performance.now();
    this.buffer.push({ time: s.time, recv: performance.now(), others: s.others });
    if (this.buffer.length > 40) this.buffer.shift();
    if (this.cq && s.cps && s.tickets) {
      for (const c of s.cps) {
        const x = this.cq.cps.find((q) => q.id === c.id);
        if (x) Object.assign(x, c);
      }
      this.cq.tickets = s.tickets;
      this.cq.time = s.cqTime;
      this.cq.ended = s.ended;
      this.cq.winner = s.winner;
    }
    this.squads = s.squads;
    this.order = s.order;
    this.contacts = s.contacts;
    if (s.scores.length) this.scores = s.scores;
    if (!this.ctrl) return;
    // Korekce: autoritativní stav + přehrání vstupů, které server ještě nezpracoval.
    const before = this.state ? { ...this.state.pos } : null;
    this.state = clonePlayerState(s.me.state);
    this.weapon = { ...s.me.weapon };
    this.ctrl.place(this.state, this.state.pos, this.state.yaw);
    // place() nuluje rychlost a pitch – obnovit autoritativní hodnoty.
    this.state.vel = { ...s.me.state.vel };
    this.state.pitch = s.me.state.pitch;
    this.state.grounded = s.me.state.grounded;
    this.state.ladder = s.me.state.ladder;
    this.pending = this.pending.filter((f) => f.seq > s.ack);
    if (s.me.alive) for (const f of this.pending) this.predict(f);
    if (before && this.state && Math.hypot(before.x - this.state.pos.x, before.y - this.state.pos.y, before.z - this.state.pos.z) > 0.05) this.corrections++;
  }

  private predict(f: InputFrame) {
    if (!this.ctrl || !this.state || !this.weapon || !this.phys) return;
    this.ctrl.step(this.state, f);
    // Predikce akcí zbraně (projektily rozhoduje server; lokálně jen prezentace).
    stepWeapon(PF_RIFLE, MOVEMENT, this.state, this.weapon, f, { playerId: this.localId, lifeId: 0, seed: 0, phys: this.phys });
  }

  step(input: InputFrame) {
    const me = this.net.lastSnap?.me;
    const f = { ...input, seq: ++this.seq, tick: this.state?.tick ?? 0 };
    this.net.sendInput(f);
    if (!me?.alive || !this.state) return;
    this.pending.push(f);
    if (this.pending.length > 120) this.pending.shift();
    this.predict(f);
  }

  local(): PlayerView | null {
    const s = this.net.lastSnap;
    if (!s || !this.state || !this.weapon) {
      if (s && !this.state && this.ctrl) {
        this.state = clonePlayerState(s.me.state);
        this.weapon = { ...s.me.weapon };
        this.ctrl.place(this.state, this.state.pos, this.state.yaw);
      }
      if (!this.state) return null;
    }
    const me = s!.me;
    return { id: this.localId, name: 'Ty', team: me.team, state: this.state!, weapon: this.weapon!, hp: me.hp, alive: me.alive, respawnAt: me.respawnAt, zone: me.zone, kills: me.kills, deaths: me.deaths };
  }

  /** Interpolace vzdálených hráčů v čase (serverTime − 100 ms). */
  remotes(): PlayerView[] {
    if (this.buffer.length === 0) return [];
    const now = this.serverTime + (performance.now() - this.serverTimeAt) / 1000 - 0.1;
    let a = this.buffer[0], b = this.buffer[this.buffer.length - 1];
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].time <= now && this.buffer[i + 1].time >= now) {
        a = this.buffer[i];
        b = this.buffer[i + 1];
        break;
      }
    }
    const k = b.time > a.time ? Math.min(1, Math.max(0, (now - a.time) / (b.time - a.time))) : 1;
    const prev = new Map(a.others.map((o) => [o.id, o]));
    return b.others.map((o) => {
      const p = prev.get(o.id) ?? o;
      const L = (x: number, y: number) => x + (y - x) * k;
      const st = createPlayerState(MOVEMENT, { x: L(p.pos[0], o.pos[0]), y: L(p.pos[1], o.pos[1]), z: L(p.pos[2], o.pos[2]) }, p.yaw + angleDiff(o.yaw, p.yaw) * k);
      st.vel = { x: o.vel[0], y: o.vel[1], z: o.vel[2] };
      st.pitch = L(p.pitch, o.pitch);
      st.bodyYaw = p.bodyYaw + angleDiff(o.bodyYaw, p.bodyYaw) * k;
      st.height = L(p.height, o.height);
      st.stance = k < 0.5 ? p.stance : o.stance;
      st.grounded = o.grounded;
      st.sprinting = o.sprinting;
      st.ladder = o.ladder;
      const w = createWeaponState(PF_RIFLE, 0);
      w.adsProgress = L(p.ads, o.ads);
      w.action = o.action;
      w.actionStart = o.actionStart;
      w.actionEnd = o.actionEnd;
      w.shotSeq = o.shotSeq;
      return { id: o.id, name: o.name, team: o.team, state: st, weapon: w, hp: 100, alive: o.alive, respawnAt: 0, zone: null, kills: 0, deaths: 0 };
    });
  }

  conquest() {
    return this.cq;
  }
  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
  time() {
    return this.serverTime + (performance.now() - this.serverTimeAt) / 1000;
  }
  spawnOptions(): SpawnPoint[] {
    const ids = new Set(this.net.lastSnap?.spawns ?? []);
    const list = (this.doc?.spawnPoints ?? []).filter((s) => ids.has(s.id));
    const me = this.net.lastSnap?.me;
    const sq = this.squads.find((s) => s.id === me?.squad);
    if (me?.canSquadSpawn && sq) {
      const leader = this.net.lastSnap?.others.find((o) => o.id === sq.leader);
      if (leader) list.push({ id: `squad:${sq.leader}`, position: leader.pos, yaw: leader.yaw, teams: [me.team] });
    }
    return list;
  }
  requestSpawn(id: string | null) {
    this.net.send({ t: 'spawn', id });
    this.pending = [];
    this.state = null;
    return null;
  }
  dummies() {
    return (this.net.lastSnap?.dummies ?? []).map((d) => ({ id: d.id, offset: 0, down: d.down }));
  }
  restart() {
    /* restart řídí server/admin */
  }
  netStats() {
    return { rtt: this.net.rtt, corrections: this.corrections, pending: this.pending.length };
  }
  dispose() {
    this.ctrl?.dispose();
    this.net.close();
  }
}

export function weaponStateFrom(w: WeaponState) {
  return { ...w };
}
void createWeaponState;
