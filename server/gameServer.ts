import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { MapDocument, Team } from '../src/shared/map/schema';
import { validateMap } from '../src/shared/map/validate';
import { PhysicsWorld } from '../src/shared/physics/world';
import { NET, PROTOCOL_VERSION, RADIO_TEXT, encodeRemote, mapHash, parseClientMsg, type ClientMsg, type RemoteState, type RemoteTuple, type ServerMsg } from '../src/shared/net/protocol';
import { TeamLayer } from '../src/shared/net/team';
import { PILOT, type Faction } from '../src/shared/config/arsenal';
import { MatchSim, type SimEvent, type SimPlayer } from '../src/shared/sim/match';
import { emptyInput, sanitizeInput, type InputFrame } from '../src/shared/sim/input';
import { eyePosition } from '../src/shared/sim/player';
import { aimAngles, dirFromAngles } from '../src/shared/sim/weapon';
import { hitboxOf, rayCapsule } from '../src/shared/sim/ballistics';
import { allAssets, collidersForMap, generateMap, laddersForMap } from '../src/world';

/**
 * Autoritativní server Potatofieldu. Simulace 60 Hz (MatchSim), snapshoty 30 Hz.
 * Klient posílá jen vstupy a žádosti; klientské tvrzení o zásahu/zabrání neexistuje
 * (neznámé typy zpráv se odmítnou a počítají).
 */
export interface ServerOptions {
  conquest: boolean;
  scenarioId?: string;
  /** Frakce týmů (kontrola výbavy při spawnu). */
  factions?: Record<Team, Faction>;
  /** Název serveru v seznamu serverů. */
  name?: string;
  /** Pilot: classy Assault/Medic/Support/Sniper, 8 proti 8 (výchozí zapnuto). */
  pilot?: boolean;
  /** Hráčů na tým (výchozí 8). */
  teamSize?: number;
  friendlyFire?: boolean;
  port?: number;
  /** Bez vlastního časovače (testy krokují ručně). */
  manualTick?: boolean;
  log?: (s: string) => void;
}

interface Client {
  id: string;
  ws: WebSocket;
  name: string;
  player: SimPlayer | null;
  inputs: InputFrame[];
  lastSeq: number;
  lastInputAt: number;
  lastHeld: number;
  msgTimes: number[];
  rejected: number;
  ping: number;
  bytesOut: number;
}

export interface ServerStats {
  ticks: number;
  tickMsAvg: number;
  tickMsP95: number;
  tickMsMax: number;
  bytesOutPerSec: number;
  msgsInPerSec: number;
  clients: number;
  queueMax: number;
}

export class GameServer {
  readonly sim: MatchSim;
  readonly team = new TeamLayer();
  readonly clients = new Map<string, Client>();
  readonly hash: string;
  private wss: WebSocketServer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private acc = 0;
  private last = 0;
  private seq = 0;
  private snapAcc = 0;
  private snapCount = 0;
  private remoteCache: Map<string, RemoteTuple> | null = null;
  private tickTimes: number[] = [];
  private bytesWindow: Array<[number, number]> = [];
  private msgsWindow: number[] = [];
  readonly generators: Record<string, number>;
  port = 0;

  private constructor(
    readonly doc: MapDocument,
    readonly phys: PhysicsWorld,
    readonly opts: ServerOptions,
  ) {
    this.sim = new MatchSim(phys, doc, { conquest: opts.conquest, scenarioId: opts.scenarioId, factions: opts.factions, friendlyFire: opts.friendlyFire ?? false, allowedKits: opts.pilot === false ? undefined : [...PILOT.kits] });
    const gen = generateMap(doc);
    this.sim.ladders = laddersForMap(gen);
    this.hash = mapHash(doc);
    this.generators = Object.fromEntries(allAssets().map((a) => [a.assetId, a.generatorVersion]));
    this.sim.squadSpawn = (p, leaderId) => this.squadSpawn(p, leaderId);
  }

  static async create(doc: MapDocument, opts: ServerOptions) {
    const v = validateMap(JSON.parse(JSON.stringify(doc)));
    if (!v.ok) throw new Error(`mapa neprošla validací: ${v.issues.filter((i) => i.severity === 'error').map((i) => i.path + ' ' + i.message).join('; ')}`);
    const phys = await PhysicsWorld.create();
    const gen = generateMap(doc);
    phys.setTerrain(doc.terrain);
    phys.addColliders(collidersForMap(gen.filter((g) => !g.object.gameHidden)));
    phys.sync();
    return new GameServer(doc, phys, opts);
  }

  get teamSize() {
    return this.opts.teamSize ?? PILOT.teamSize;
  }

  /** Pravidla pro UI klienta (welcome i /info). */
  rules() {
    return {
      name: this.opts.name ?? 'Potatofield',
      pilot: this.opts.pilot !== false,
      teamSize: this.teamSize,
      friendlyFire: this.opts.friendlyFire ?? false,
      kits: this.opts.pilot === false ? (['assault', 'medic', 'support', 'engineer', 'sniper'] as const).slice() : [...PILOT.kits],
      respawnDelay: this.sim.conquest?.respawnDelay ?? 3,
      downedTime: PILOT.downedTime,
    };
  }

  /** Veřejné údaje pro seznam serverů (GET /info, CORS povolen; jen skutečné hodnoty). */
  info() {
    return {
      ...this.rules(),
      protocol: PROTOCOL_VERSION,
      map: this.doc.name,
      mode: this.sim.conquest ? 'conquest' : 'free',
      players: this.sim.players.size,
      capacity: this.teamSize * 2,
      factions: { teamA: this.sim.factionOf('teamA'), teamB: this.sim.factionOf('teamB') },
    };
  }

  private http: HttpServer | null = null;

  listen(port = this.opts.port ?? 8787): Promise<number> {
    return new Promise((resolve) => {
      this.http = createServer((req, res) => {
        if (req.url?.split('?')[0] === '/info') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
          res.end(JSON.stringify(this.info()));
        } else {
          res.writeHead(404, { 'access-control-allow-origin': '*' });
          res.end();
        }
      });
      this.wss = new WebSocketServer({ server: this.http, maxPayload: NET.maxMessageBytes, perMessageDeflate: { threshold: 2048 } });
      this.http.listen(port);
      this.wss.on('connection', (ws) => this.onConnection(ws));
      this.http.on('listening', () => {
        this.port = (this.http!.address() as { port: number }).port;
        this.log(`server naslouchá na ${this.port}, mapa ${this.doc.name} (${this.hash})`);
        if (!this.opts.manualTick) this.startLoop();
        resolve(this.port);
      });
    });
  }

  private log(s: string) {
    this.opts.log?.(s);
  }

  private startLoop() {
    this.last = performance.now();
    // Časovač s dorovnáním driftu: pevný krok 60 Hz, omezené dohánění.
    this.timer = setInterval(() => {
      const now = performance.now();
      this.acc += Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      let n = 0;
      while (this.acc >= 1 / 60 && n < 6) {
        this.tick();
        this.acc -= 1 / 60;
        n++;
      }
      if (n >= 6) this.acc = 0;
    }, 4);
  }

  // ---------------- spojení ----------------

  private onConnection(ws: WebSocket) {
    const id = `p${++this.seq}`;
    const c: Client = { id, ws, name: id, player: null, inputs: [], lastSeq: 0, lastInputAt: performance.now(), lastHeld: 0, msgTimes: [], rejected: 0, ping: 0, bytesOut: 0 };
    this.clients.set(id, c);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return this.reject(c, 'zpráva', 'binární zprávy nejsou podporovány');
      const raw = data.toString();
      const now = performance.now();
      c.msgTimes = c.msgTimes.filter((t) => now - t < 1000);
      c.msgTimes.push(now);
      this.msgsWindow.push(now);
      if (c.msgTimes.length > NET.maxMessagesPerSecond) return this.reject(c, 'zpráva', 'příliš mnoho zpráv');
      const m = parseClientMsg(raw);
      if (!m) {
        c.rejected++;
        if (c.rejected > 50) ws.close(1008, 'neplatné zprávy');
        return this.reject(c, 'zpráva', 'neplatná nebo nepodporovaná zpráva');
      }
      this.onMessage(c, m);
    });
    ws.on('close', () => this.disconnect(c));
    ws.on('error', () => this.disconnect(c));
  }

  private disconnect(c: Client) {
    if (!this.clients.has(c.id)) return;
    this.clients.delete(c.id);
    // Odpojení odstraní hráče ze simulace (a tím i z capture objemů).
    this.sim.removePlayer(c.id);
    this.team.removeMember(c.id);
    this.broadcastSystem(`${c.name} se odpojil.`);
  }

  private send(c: Client, m: ServerMsg) {
    if (c.ws.readyState !== 1) return;
    const s = JSON.stringify(m);
    c.bytesOut += s.length;
    this.bytesWindow.push([performance.now(), s.length]);
    c.ws.send(s);
  }

  private reject(c: Client, what: string, reason: string) {
    this.send(c, { t: 'reject', what, reason });
  }

  /** Scan commandera: jednorázový snímek poloh všech živých nepřátel (jen vlastnímu týmu). */
  private scan(team: Team) {
    const now = this.sim.time;
    for (const o of this.sim.players.values()) {
      if (!o.alive || o.team === team) continue;
      this.team.addContact(team, { kind: 'confirmed', pos: [r3(o.state.pos.x), r3(o.state.pos.y), r3(o.state.pos.z)], expires: now + NET.command.scanTtl, source: 'scan' }, `scan:${o.id}`);
    }
  }

  private uavAcc = 0;
  /** UAV: po dobu trvání obnovuje kontakty nepřátel v dosahu (jen vlastnímu týmu). */
  private commandTick() {
    this.uavAcc += 1 / 60;
    if (this.uavAcc < NET.command.uavRefresh) return;
    this.uavAcc = 0;
    const now = this.sim.time;
    for (const team of ['teamA', 'teamB'] as Team[]) {
      const u = this.team.command[team].uav;
      if (!u) continue;
      if (now >= u.until) {
        this.team.command[team].uav = null;
        continue;
      }
      for (const o of this.sim.players.values()) {
        if (!o.alive || o.team === team) continue;
        if (Math.hypot(o.state.pos.x - u.pos[0], o.state.pos.z - u.pos[2]) > NET.command.uavRadius) continue;
        this.team.addContact(team, { kind: 'confirmed', pos: [r3(o.state.pos.x), r3(o.state.pos.y), r3(o.state.pos.z)], expires: now + NET.command.uavRefresh * 1.6, source: 'uav' }, `uav:${o.id}`);
      }
    }
  }

  private broadcastSystem(text: string, team?: Team) {
    for (const c of this.clients.values()) if (!team || c.player?.team === team) this.send(c, { t: 'chat', id: `sys${++this.seq}`, from: 'system', name: 'Server', ch: 'system', text, time: this.sim.time });
  }

  private autoTeam(): Team {
    let a = 0, b = 0;
    for (const p of this.sim.players.values()) p.team === 'teamA' ? a++ : b++;
    return a <= b ? 'teamA' : 'teamB';
  }

  private onMessage(c: Client, m: ClientMsg) {
    const now = this.sim.time;
    if (m.t === 'hello') {
      if (m.v !== PROTOCOL_VERSION) {
        this.send(c, { t: 'bye', reason: `nekompatibilní protokol (server ${PROTOCOL_VERSION}, klient ${m.v})` });
        c.ws.close(1008, 'protocol');
        return;
      }
      if (c.player) return;
      if (this.sim.players.size >= this.teamSize * 2) {
        this.send(c, { t: 'bye', reason: 'full' });
        c.ws.close(1013, 'full');
        return;
      }
      c.name = m.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || c.id;
      const team = this.autoTeam();
      c.player = this.sim.addPlayer(c.id, team, c.name);
      this.team.addMember(c.id, c.name, team);
      // Připojení během zápasu: úplný aktuální stav (mapa, tým, body) hned ve welcome + snapshotu.
      this.send(c, { t: 'welcome', v: PROTOCOL_VERSION, id: c.id, map: this.doc, mapHash: this.hash, generators: this.generators, tick: this.sim.tick, scenarioId: this.sim.conquest?.scenarioId ?? '', team, conquest: !!this.sim.conquest, factions: { teamA: this.sim.factionOf('teamA'), teamB: this.sim.factionOf('teamB') }, rules: this.rules() });
      // Po připojení se hráč nenasazuje sám – nasazení potvrzuje (zadání UI, kap. 6).
      this.broadcastSystem(`${c.name} se připojil (${team === 'teamA' ? 'tým A' : 'tým B'}).`);
      this.sendSnapshot(c);
      return;
    }
    const p = c.player;
    if (!p) return this.reject(c, m.t, 'nejprve hello');
    switch (m.t) {
      case 'input': {
        c.lastInputAt = performance.now();
        for (const f of m.frames) {
          if (f.seq <= c.lastSeq || c.inputs.some((x) => x.seq === f.seq)) continue; // duplicita (redundance)
          c.inputs.push(sanitizeInput(f));
        }
        c.inputs.sort((a, b) => a.seq - b.seq);
        // Krátká fronta (≤ 3 ticky): přebytečné vstupy se sloučí do následujícího –
        // stisky a pohyb myši se neztratí, pohybový krok ano (žádný speedhack hromaděním).
        while (c.inputs.length > 3) {
          const old = c.inputs.shift()!;
          const nx = c.inputs[0];
          nx.pressed |= old.pressed;
          nx.lookDYaw += old.lookDYaw;
          nx.lookDPitch += old.lookDPitch;
        }
        break;
      }
      case 'spawn': {
        const err = this.sim.requestSpawn(c.id, m.id, m.weapon);
        if (err) this.reject(c, 'spawn', err);
        else {
          const mem = this.team.members.get(c.id);
          if (mem && !m.id?.startsWith('squad:')) mem.joinedWhileDead = false;
        }
        break;
      }
      case 'giveup': {
        const err = this.sim.giveUp(c.id);
        if (err) this.reject(c, 'giveup', err);
        break;
      }
      case 'team': {
        if (p.alive || p.downed) return this.reject(c, 'team', 'tým lze změnit jen mrtvý / před nasazením');
        if (m.team !== p.team && [...this.sim.players.values()].filter((o) => o.team === m.team).length >= this.teamSize) return this.reject(c, 'team', 'tým je plný');
        p.team = m.team;
        this.team.setTeam(c.id, m.team);
        break;
      }
      case 'chat': {
        const r = this.team.chat(c.id, m.ch, m.text, now);
        if (typeof r === 'string') return this.reject(c, 'chat', r);
        const msg: ServerMsg = { t: 'chat', id: `ch${++this.seq}`, from: c.id, name: c.name, ch: m.ch, text: r.text, time: now };
        for (const to of r.to) {
          const tc = this.clients.get(to);
          if (tc) this.send(tc, msg);
        }
        break;
      }
      case 'radio': {
        const r = this.team.radio(c.id, m.id, now);
        if (typeof r === 'string') return this.reject(c, 'radio', r);
        const pos: [number, number, number] | null = p.alive && (m.id === 'medic' || m.id === 'ammo' || m.id === 'backup' || m.id === 'followMe') ? [p.state.pos.x, p.state.pos.y, p.state.pos.z] : null;
        const msg: ServerMsg = { t: 'radio', id: `rd${++this.seq}`, from: c.id, name: c.name, radio: m.id, pos, time: now };
        for (const to of r.to) {
          const tc = this.clients.get(to);
          if (tc) this.send(tc, msg);
        }
        if (m.id === 'enemy') this.spot(c);
        break;
      }
      case 'spot':
        this.spot(c);
        break;
      case 'squad': {
        let err: string | null = null;
        if (m.op === 'create') err = this.team.createSquad(c.id, p.alive);
        else if (m.op === 'join') err = m.squad ? this.team.joinSquad(c.id, m.squad, p.alive) : 'chybí četa';
        else if (m.op === 'leave') this.team.leaveSquad(c.id);
        else err = this.team.squadOp(c.id, m.op, m.target, now);
        if (err) this.reject(c, 'squad', err);
        break;
      }
      case 'order': {
        let target: { cp?: string; pos: [number, number, number] } | null = null;
        if (m.cp) {
          const cp = this.doc.controlPoints.find((x) => x.id === m.cp);
          if (cp) target = { cp: cp.id, pos: [...cp.position] as [number, number, number] };
        } else if (m.pos && m.pos.every((v) => Number.isFinite(v) && Math.abs(v) < 5000)) target = { pos: m.pos };
        if (!target) return this.reject(c, 'order', 'neplatný cíl');
        const err = this.team.issueOrder(c.id, m.kind, target, now, m.squad);
        if (err) this.reject(c, 'order', err);
        else this.send(c, { t: 'ack', what: 'order' });
        break;
      }
      case 'command': {
        if (m.op === 'resign') {
          this.team.resignCommander(c.id);
          this.send(c, { t: 'ack', what: 'command' });
          break;
        }
        const err = this.team.applyCommander(c.id);
        if (err) this.reject(c, 'command', err);
        else {
          this.send(c, { t: 'ack', what: 'command' });
          this.broadcastSystem(`${c.name} je commanderem týmu.`, p.team);
        }
        break;
      }
      case 'ability': {
        const err = this.team.useAbility(c.id, m.kind, now, m.pos);
        if (err) return this.reject(c, 'ability', err);
        if (m.kind === 'scan') this.scan(p.team);
        this.send(c, { t: 'ack', what: 'ability', detail: m.kind });
        break;
      }
      case 'ping':
        this.send(c, { t: 'pong', c: m.c, s: now });
        break;
    }
  }

  /** Ruční spot: server ověří živého odesílatele, cooldown, herní zamíření, dosah a viditelnost. */
  private spot(c: Client) {
    const p = c.player!;
    const mem = this.team.members.get(c.id)!;
    const now = this.sim.time;
    if (!p.alive) return this.reject(c, 'spot', 'jen živý hráč');
    if (now - mem.spotAt < NET.spot.cooldown) return this.reject(c, 'spot', 'cooldown');
    mem.spotAt = now;
    const eye = eyePosition(this.sim.cfg, p.state);
    const aim = aimAngles(p.state, p.weapon);
    const dir = dirFromAngles(aim.yaw, aim.pitch);
    const cosLim = Math.cos((NET.spot.coneDeg * Math.PI) / 180);
    let best: { o: SimPlayer; d: number } | null = null;
    for (const o of this.sim.players.values()) {
      if (!o.alive || o.team === p.team) continue;
      const hb = hitboxOf(o.id, o.state, this.sim.cfg);
      const c2 = { x: (hb.a.x + hb.b.x) / 2, y: (hb.a.y + hb.b.y) / 2, z: (hb.a.z + hb.b.z) / 2 };
      const v = { x: c2.x - eye.x, y: c2.y - eye.y, z: c2.z - eye.z };
      const d = Math.hypot(v.x, v.y, v.z);
      if (d > NET.spot.range) continue;
      const cosA = (v.x * dir.x + v.y * dir.y + v.z * dir.z) / d;
      const onRay = rayCapsule(eye, dir, NET.spot.range, hb.a, hb.b, hb.r + 0.3) !== null;
      if (cosA < cosLim && !onRay) continue;
      // Viditelnost: paprsek z očí k cíli nesmí narazit na svět.
      const hit = this.phys.castRay(eye, { x: v.x / d, y: v.y / d, z: v.z / d }, d - 0.3);
      if (hit) continue;
      if (!best || d < best.d) best = { o, d };
    }
    if (best) {
      const pos = best.o.state.pos;
      this.team.addContact(p.team, { kind: 'confirmed', pos: [pos.x, pos.y, pos.z], expires: now + NET.spot.ttl, source: c.id }, `p:${best.o.id}`);
      return;
    }
    // Nepotvrzená oblast na viditelném podkladu (stejná odpověď bez ohledu na skryté nepřátele).
    const hit = this.phys.castRay(eye, dir, NET.spot.range);
    if (!hit) return;
    mem.suspects = mem.suspects.filter((id) => this.team.contacts[p.team].some((x) => x.id === id));
    if (mem.suspects.length >= NET.spot.maxSuspectPerPlayer) return;
    const ct = this.team.addContact(p.team, { kind: 'suspect', pos: [hit.point.x, hit.point.y, hit.point.z], expires: now + NET.spot.suspectTtl, source: c.id });
    mem.suspects.push(ct.id);
  }

  /** Nasazení u velitele čety (návrh PF podle kap. 9 zadání týmových mechanik). */
  private squadSpawn(p: SimPlayer, leaderId: string): { pos: { x: number; y: number; z: number }; yaw: number } | string {
    const mem = this.team.members.get(p.id);
    const leaderMem = this.team.members.get(leaderId);
    if (!mem?.squad || !leaderMem || leaderMem.squad !== mem.squad) return 'nejste v četě tohoto velitele';
    const sq = this.team.squads.get(mem.squad);
    if (!sq || sq.leader !== leaderId) return 'hráč není velitelem čety';
    if (leaderId === p.id) return 'nelze se nasadit sám na sebe';
    if (mem.joinedWhileDead) return 'po vstupu do čety během smrti nejdřív běžné nasazení na bodě';
    const leader = this.sim.players.get(leaderId);
    if (!leader?.alive) return 'velitel čety není naživu';
    if (this.sim.conquest && !this.sim.conquest.cps.some((c) => c.owner === p.team)) return 'tým nedrží žádný bod';
    const base = leader.state.pos;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + leader.state.yaw + Math.PI;
      const r = 1.6 + (k % 3) * 0.6;
      const x = base.x + Math.sin(a) * r, z = base.z + Math.cos(a) * r;
      const ground = this.phys.castRay({ x, y: base.y + 1.2, z }, { x: 0, y: -1, z: 0 }, 3);
      if (!ground) continue;
      const pos = { x, y: ground.point.y + 0.03, z };
      // Žádné místo za zdí: přímá viditelnost od leadera.
      const v = { x: pos.x - base.x, y: 0, z: pos.z - base.z };
      const d = Math.hypot(v.x, v.z);
      if (this.phys.castRay({ x: base.x, y: base.y + 1, z: base.z }, { x: v.x / d, y: 0, z: v.z / d }, d)) continue;
      if (this.sim.spawnFree(pos, p)) return { pos, yaw: leader.state.yaw };
    }
    return 'u velitele není volné bezpečné místo';
  }

  // ---------------- simulace ----------------

  tick() {
    const t0 = performance.now();
    const inputs = new Map<string, InputFrame>();
    for (const c of this.clients.values()) {
      if (!c.player) continue;
      const f = c.inputs.shift();
      if (f) {
        c.lastSeq = f.seq;
        c.lastHeld = f.held;
        inputs.set(c.id, f);
      } else if (performance.now() - c.lastInputAt < NET.inputTimeoutMs) {
        // Krátký výpadek: držet poslední stav bez nových stisků.
        inputs.set(c.id, { ...emptyInput(this.sim.tick, c.lastSeq), held: c.lastHeld });
      }
      // Timeout: žádný vstup → neutrální (server zruší střelbu i sprint).
    }
    this.sim.step(inputs);
    const events = this.sim.events;
    this.sim.events = [];
    if (events.length) this.distributeEvents(events);
    this.team.expireContacts(this.sim.time);
    this.commandTick();
    if (this.sim.conquest) {
      const cq = this.sim.conquest;
      this.team.updateOrders((id) => cq.cps.find((x) => x.id === id)?.owner, (id) => {
        const pl = this.sim.players.get(id);
        return pl?.alive ? pl.state.pos : null;
      });
    }
    this.snapAcc += 1 / 60;
    if (this.snapAcc >= 1 / NET.snapshotHz - 1e-9) {
      this.snapAcc -= 1 / NET.snapshotHz;
      this.snapCount++;
      // Vzdálení hráči se kódují jednou pro všechny příjemce.
      this.remoteCache = new Map([...this.sim.players.values()].map((p) => [p.id, encodeRemote(this.remote(p))]));
      for (const c of this.clients.values()) if (c.player) this.sendSnapshot(c);
      this.remoteCache = null;
    }
    this.tickTimes.push(performance.now() - t0);
    if (this.tickTimes.length > 3600) this.tickTimes.shift();
  }

  /** Události: výstřely a dopady všem; zásahy jen střelci a oběti (hitmarker nesmí prozradit cizí). */
  private distributeEvents(events: SimEvent[]) {
    for (const c of this.clients.values()) {
      const list = events.filter((e) => {
        if (e.type === 'hit') return e.owner === c.id || e.target === c.id;
        return true;
      });
      if (list.length) this.send(c, { t: 'events', list });
    }
  }

  private remote(p: SimPlayer): RemoteState {
    const s = p.state, w = p.weapon;
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      alive: p.alive,
      pos: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)],
      vel: [r3(s.vel.x), r3(s.vel.y), r3(s.vel.z)],
      yaw: r4(s.yaw + w.recoilYaw),
      pitch: r4(s.pitch + w.recoilPitch),
      bodyYaw: r4(s.bodyYaw),
      height: r3(s.height),
      stance: s.stance,
      grounded: s.grounded,
      sprinting: s.sprinting,
      ads: r3(w.adsProgress),
      action: w.action,
      actionStart: r3(w.actionStart),
      actionEnd: r3(w.actionEnd),
      shotSeq: w.shotSeq,
      ladder: s.ladder,
      squad: this.team.members.get(p.id)?.squad ?? null,
      weapon: p.weaponId,
      life: p.alive ? 'alive' : p.downed ? 'downed' : 'dead',
    };
  }

  sendSnapshot(c: Client) {
    const p = c.player!;
    const mem = this.team.members.get(c.id);
    const cq = this.sim.conquest;
    const o: RemoteTuple[] = [];
    for (const pl of this.sim.players.values()) if (pl.id !== c.id) o.push(this.remoteCache?.get(pl.id) ?? encodeRemote(this.remote(pl)));
    const spawns = cq && !p.alive ? this.sim.spawnOptions(p.team).map((s) => s.id) : [];
    const sq = mem?.squad ? this.team.squads.get(mem.squad) : undefined;
    const canSquad = !!sq && sq.leader !== c.id && !mem!.joinedWhileDead && !!this.sim.players.get(sq.leader)?.alive && (!cq || cq.cps.some((x) => x.owner === p.team));
    this.send(c, {
      t: 'snap',
      tick: this.sim.tick,
      time: this.sim.time,
      ack: c.lastSeq,
      me: { state: { ...p.state, blocked: [] }, weapon: p.weapon, hp: p.hp, alive: p.alive, respawnAt: p.respawnAt, zone: p.zone, kills: p.kills, deaths: p.deaths, team: p.team, squad: mem?.squad ?? null, canSquadSpawn: canSquad, downed: p.downed, downedLeft: p.downed ? r3(Math.max(0, p.downedUntil - this.sim.time)) : 0, reviveProgress: p.reviveTarget ? r3(p.reviveHeld / PILOT.reviveHold) : 0, revives: p.revives },
      others: [],
      o,
      cps: cq ? cq.cps.map((x) => ({ id: x.id, owner: x.owner, p: r3(x.p), activity: x.activity })) : null,
      tickets: cq ? { ...cq.tickets } : null,
      cqTime: cq?.time ?? 0,
      ended: !!cq?.ended,
      winner: cq?.winner ?? null,
      dummies: this.sim.dummies.map((d) => ({ id: d.id, down: d.downUntil > 0 })),
      // Jen informace vlastního týmu/čety (nepřítel je nedostane vůbec).
      squads: this.team.squadsFor(p.team),
      order: this.team.orderFor(mem?.squad ?? null),
      contacts: this.team.contacts[p.team],
      command: { ...this.team.command[p.team], uav: this.team.command[p.team].uav },
      spawns,
      // Skóre stačí 1×/s (šetří přenos); ostatní data každý snapshot.
      scores: this.snapCount % NET.snapshotHz !== 1 ? [] : [...this.sim.players.values()].map((o) => ({ id: o.id, name: o.name, team: o.team, kills: o.kills, deaths: o.deaths, revives: o.revives, ping: this.clients.get(o.id)?.ping ?? 0, squad: o.team === p.team ? (this.team.members.get(o.id)?.squad ?? null) : null })),
    });
  }

  stats(): ServerStats {
    const now = performance.now();
    this.bytesWindow = this.bytesWindow.filter(([t]) => now - t < 5000);
    this.msgsWindow = this.msgsWindow.filter((t) => now - t < 5000);
    const sorted = [...this.tickTimes].sort((a, b) => a - b);
    return {
      ticks: this.sim.tick,
      tickMsAvg: sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length),
      tickMsP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      tickMsMax: sorted[sorted.length - 1] ?? 0,
      bytesOutPerSec: this.bytesWindow.reduce((a, [, b]) => a + b, 0) / 5,
      msgsInPerSec: this.msgsWindow.length / 5,
      clients: this.clients.size,
      queueMax: Math.max(0, ...[...this.clients.values()].map((c) => c.inputs.length)),
    };
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.clients.values()) c.ws.close();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
    this.sim.dispose();
    this.phys.free();
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
void RADIO_TEXT;
