import type { Team } from '../map/schema';
import type { V3 } from '../math';
import { NET, type ChatChannel, type ContactInfo, type OrderInfo, type OrderKind, type RadioId, type SquadInfo } from './protocol';

/**
 * Týmová vrstva serveru: čety, rozkazy, chat, rádio a kontakty (spotování).
 * Oprávnění a příjemce odvozuje server ze session, nikdy z tvrzení klienta.
 * Hodnoty limitů jsou návrhy PF (viz NET), ne konstanty BF2.
 */
export interface Member {
  id: string;
  name: string;
  team: Team;
  squad: string | null;
  /** Vstoupil do čety během smrti → první spawn musí být běžný (ne na leaderovi). */
  joinedWhileDead: boolean;
  chatTimes: number[];
  radioAt: number;
  radioSame: Map<RadioId, number>;
  spotAt: number;
  suspects: string[];
}

export class TeamLayer {
  readonly members = new Map<string, Member>();
  readonly squads = new Map<string, SquadInfo>();
  readonly orders = new Map<string, OrderInfo>();
  readonly contacts: Record<Team, ContactInfo[]> = { teamA: [], teamB: [] };
  private seq = 0;
  private lastLeaderChange = new Map<string, number>();
  /** Commander týmu (jeden z hráčů týmu, ne pátá classa) a stav schopností. */
  readonly command: Record<Team, { commander: string | null; uavReadyAt: number; scanReadyAt: number; uav: { pos: [number, number, number]; until: number } | null }> = {
    teamA: { commander: null, uavReadyAt: 0, scanReadyAt: 0, uav: null },
    teamB: { commander: null, uavReadyAt: 0, scanReadyAt: 0, uav: null },
  };

  // ---------------- commander ----------------

  applyCommander(id: string): string | null {
    const m = this.members.get(id);
    if (!m) return 'neznámý hráč';
    const c = this.command[m.team];
    if (c.commander === id) return null;
    if (c.commander) return 'místo commandera je obsazené';
    c.commander = id;
    return null;
  }

  resignCommander(id: string) {
    for (const t of ['teamA', 'teamB'] as Team[]) if (this.command[t].commander === id) this.command[t].commander = null;
  }

  isCommander(id: string) {
    const m = this.members.get(id);
    return !!m && this.command[m.team].commander === id;
  }

  /** Schopnost commandera: vrací důvod odmítnutí nebo null (efekt řeší server). */
  useAbility(id: string, kind: 'uav' | 'scan', now: number, pos?: [number, number, number]): string | null {
    const m = this.members.get(id);
    if (!m || !this.isCommander(id)) return 'jen commander týmu';
    const c = this.command[m.team];
    if (kind === 'uav') {
      if (!pos) return 'UAV: chybí cíl';
      if (now < c.uavReadyAt) return `UAV: obnova ${Math.ceil(c.uavReadyAt - now)} s`;
      c.uav = { pos, until: now + NET.command.uavDuration };
      c.uavReadyAt = now + NET.command.uavCooldown;
    } else {
      if (now < c.scanReadyAt) return `scan: obnova ${Math.ceil(c.scanReadyAt - now)} s`;
      c.scanReadyAt = now + NET.command.scanCooldown;
    }
    return null;
  }

  addMember(id: string, name: string, team: Team) {
    this.members.set(id, { id, name, team, squad: null, joinedWhileDead: false, chatTimes: [], radioAt: -1e9, radioSame: new Map(), spotAt: -1e9, suspects: [] });
  }

  removeMember(id: string) {
    this.resignCommander(id);
    this.leaveSquad(id);
    this.members.delete(id);
  }

  setTeam(id: string, team: Team) {
    const m = this.members.get(id);
    if (!m) return;
    this.leaveSquad(id); // změna týmu zruší členství a oprávnění ve staré četě
    this.resignCommander(id);
    m.team = team;
  }

  private nextId(p: string) {
    return `${p}${++this.seq}`;
  }

  // ---------------- čety ----------------

  createSquad(id: string, alive: boolean): string | null {
    const m = this.members.get(id);
    if (!m) return 'neznámý hráč';
    const teamSquads = [...this.squads.values()].filter((s) => s.team === m.team);
    if (teamSquads.length >= NET.squad.maxPerTeam) return 'tým má maximální počet čet';
    this.leaveSquad(id);
    const names = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'];
    const used = new Set(teamSquads.map((s) => s.name));
    const s: SquadInfo = { id: this.nextId('sq'), team: m.team, name: names.find((n) => !used.has(n)) ?? `Četa ${this.seq}`, leader: id, members: [id], locked: false, version: 1 };
    this.squads.set(s.id, s);
    m.squad = s.id;
    m.joinedWhileDead = !alive;
    return null;
  }

  /** Atomické přijetí (kapacita se ověří v jednom kroku – dvě žádosti nevytvoří sedmého člena). */
  joinSquad(id: string, squadId: string, alive: boolean): string | null {
    const m = this.members.get(id);
    const s = this.squads.get(squadId);
    if (!m || !s) return 'četa neexistuje';
    if (s.team !== m.team) return 'četa patří jinému týmu';
    if (s.locked) return 'četa je uzamčená';
    if (s.members.length >= NET.squad.maxMembers) return 'četa je plná';
    if (m.squad === squadId) return null;
    this.leaveSquad(id);
    s.members.push(id);
    s.version++;
    m.squad = s.id;
    m.joinedWhileDead = !alive;
    return null;
  }

  leaveSquad(id: string) {
    const m = this.members.get(id);
    if (!m || !m.squad) return;
    const s = this.squads.get(m.squad);
    m.squad = null;
    if (!s) return;
    s.members = s.members.filter((x) => x !== id);
    s.version++;
    if (!s.members.length) {
      this.squads.delete(s.id);
      for (const [oid, o] of this.orders) if (o.squad === s.id) this.orders.delete(oid);
      return;
    }
    // Nástupnictví: první další člen podle pořadí příchodu (nikdy dva leadeři).
    if (s.leader === id) s.leader = s.members[0];
  }

  squadOp(id: string, op: 'lock' | 'unlock' | 'kick' | 'promote', target: string | undefined, now: number): string | null {
    const m = this.members.get(id);
    const s = m?.squad ? this.squads.get(m.squad) : undefined;
    if (!m || !s) return 'nejste v četě';
    if (s.leader !== id) return 'jen velitel čety';
    if (op === 'lock' || op === 'unlock') {
      s.locked = op === 'lock';
      s.version++;
      return null;
    }
    if (!target || !s.members.includes(target) || target === id) return 'neplatný člen';
    if (op === 'kick') {
      this.leaveSquad(target);
      return null;
    }
    const last = this.lastLeaderChange.get(s.id) ?? -1e9;
    if (now - last < NET.squad.leaderTransferCooldown) return 'předání velení je na cooldownu';
    s.leader = target;
    s.version++;
    this.lastLeaderChange.set(s.id, now);
    return null;
  }

  // ---------------- rozkazy ----------------

  issueOrder(id: string, kind: OrderKind, target: { cp?: string; pos: [number, number, number] }, now: number, squadId?: string): string | null {
    const m = this.members.get(id);
    let s = m?.squad ? this.squads.get(m.squad) : undefined;
    if (squadId) {
      // Commander rozkazuje libovolné četě vlastního týmu; jiný hráč jen své četě jako velitel.
      const t = this.squads.get(squadId);
      if (!m || !t || t.team !== m.team) return 'neznámá četa';
      if (!this.isCommander(id) && !(t.leader === id)) return 'rozkaz cizí četě vydává jen commander';
      s = t;
    } else if (!m || !s) return 'nejste v četě';
    else if (s.leader !== id) return 'rozkaz vydává jen velitel čety';
    if (!s) return 'nejste v četě';
    for (const o of this.orders.values()) if (o.squad === s.id && o.status === 'active') o.status = 'superseded';
    const o: OrderInfo = { id: this.nextId('ord'), squad: s.id, kind, target, status: 'active', author: id, time: now };
    for (const [k, x] of this.orders) if (x.squad === s.id) this.orders.delete(k);
    this.orders.set(o.id, o);
    return null;
  }

  orderFor(squad: string | null): OrderInfo | null {
    if (!squad) return null;
    for (const o of this.orders.values()) if (o.squad === squad) return o;
    return null;
  }

  /** Dokončení rozkazů: Attack po obsazení bodu, Move po dosažení oblasti leaderem nebo 2 členy. */
  updateOrders(cpOwner: (cp: string) => string | undefined, posOf: (id: string) => V3 | null) {
    for (const o of this.orders.values()) {
      if (o.status !== 'active') continue;
      const s = this.squads.get(o.squad);
      if (!s) continue;
      if (o.kind === 'attack' && o.target.cp && cpOwner(o.target.cp) === s.team) o.status = 'completed';
      if (o.kind === 'move') {
        const inside = s.members.filter((id) => {
          const p = posOf(id);
          return p && Math.hypot(p.x - o.target.pos[0], p.z - o.target.pos[2]) <= 10;
        });
        if (inside.includes(s.leader) || inside.length >= 2) o.status = 'completed';
      }
    }
  }

  // ---------------- chat a rádio ----------------

  /** Vrací příjemce (ID) nebo důvod odmítnutí. Uživatelský text se nikdy nevykresluje jako HTML. */
  chat(id: string, ch: ChatChannel, text: string, now: number): { to: string[]; text: string } | string {
    const m = this.members.get(id);
    if (!m) return 'neznámý hráč';
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NET.chat.maxLength);
    if (!clean) return 'prázdná zpráva';
    m.chatTimes = m.chatTimes.filter((t) => now - t < NET.chat.windowSec);
    if (m.chatTimes.length >= NET.chat.burst) return 'příliš mnoho zpráv – chvíli počkejte';
    if (ch === 'squad' && !m.squad) return 'nejste v četě';
    m.chatTimes.push(now);
    const to = [...this.members.values()]
      .filter((x) => ch === 'all' || (ch === 'team' && x.team === m.team) || (ch === 'squad' && x.squad === m.squad && x.team === m.team))
      .map((x) => x.id);
    return { to, text: clean };
  }

  radio(id: string, radioId: RadioId, now: number): { to: string[] } | string {
    const m = this.members.get(id);
    if (!m) return 'neznámý hráč';
    if (now - m.radioAt < NET.radio.globalCooldown) return 'rádio: cooldown';
    if (now - (m.radioSame.get(radioId) ?? -1e9) < NET.radio.sameCooldown) return 'rádio: stejná žádost příliš brzy';
    m.radioAt = now;
    m.radioSame.set(radioId, now);
    // Rádio slyší vlastní tým (ne nepřítel).
    return { to: [...this.members.values()].filter((x) => x.team === m.team).map((x) => x.id) };
  }

  // ---------------- spotování ----------------

  addContact(team: Team, c: Omit<ContactInfo, 'id'>, targetKey?: string): ContactInfo {
    const list = this.contacts[team];
    // Více spotů stejného cíle = jedna značka (aktualizace).
    const existing = targetKey ? list.find((x) => (x as ContactInfo & { key?: string }).key === targetKey) : undefined;
    if (existing) {
      existing.pos = c.pos;
      existing.expires = c.expires;
      return existing;
    }
    const n = { ...c, id: this.nextId('ct'), key: targetKey } as ContactInfo & { key?: string };
    list.push(n);
    return n;
  }

  expireContacts(now: number) {
    for (const t of ['teamA', 'teamB'] as Team[]) this.contacts[t] = this.contacts[t].filter((c) => c.expires > now);
  }

  /** Squady pro hráče: jen vlastní tým (cizí čety se neposílají). */
  squadsFor(team: Team) {
    return [...this.squads.values()].filter((s) => s.team === team);
  }
}
