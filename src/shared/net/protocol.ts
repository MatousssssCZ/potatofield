import type { MapDocument, Team } from '../map/schema';
import type { InputFrame } from '../sim/input';
import type { PlayerState } from '../sim/player';
import type { WeaponState } from '../sim/weapon';
import type { CPState } from '../sim/conquest';
import type { SimEvent } from '../sim/match';
import { WEAPON_IDS, type Faction, type Kit } from '../config/arsenal';

/**
 * Síťový protokol (JSON přes WebSocket). Klient posílá jen vstupy a žádosti;
 * server je autoritou pro pohyb, střelbu, poškození, spawny, body, tickety a týmové informace.
 */
/** v3: vyřazení a oživení (stav života, vzdát pomoc), pravidla serveru ve welcome, /info. */
export const PROTOCOL_VERSION = 3;
export const NET = {
  snapshotHz: 30,
  maxMessageBytes: 32 * 1024,
  maxInputsPerMessage: 8,
  maxMessagesPerSecond: 180,
  inputTimeoutMs: 250,
  interpolationDelayMs: 100,
  chat: { maxLength: 200, burst: 3, windowSec: 5 },
  radio: { globalCooldown: 1, sameCooldown: 5 },
  spot: { cooldown: 1, range: 200, coneDeg: 1.5, ttl: 6, suspectTtl: 4, maxSuspectPerPlayer: 3 },
  squad: { maxMembers: 6, maxPerTeam: 9, leaderTransferCooldown: 20 },
  /** Commander: UAV (dosah, trvání, obnova) a scan (obnova, platnost kontaktů). Návrhové hodnoty (N). */
  command: { uavRadius: 60, uavDuration: 20, uavCooldown: 90, uavRefresh: 1, scanCooldown: 60, scanTtl: 4 },
} as const;

export type ChatChannel = 'all' | 'team' | 'squad';
export const RADIO_IDS = ['enemy', 'medic', 'ammo', 'backup', 'followMe', 'goGoGo', 'roger', 'negative', 'thanks', 'sorry'] as const;
export type RadioId = (typeof RADIO_IDS)[number];
export type OrderKind = 'attack' | 'defend' | 'move';

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; mapHash?: string }
  | { t: 'input'; frames: InputFrame[] }
  | { t: 'spawn'; id: string | null; weapon?: string }
  | { t: 'giveup' }
  | { t: 'command'; op: 'apply' | 'resign' }
  | { t: 'ability'; kind: 'uav' | 'scan'; pos?: [number, number, number] }
  | { t: 'team'; team: Team }
  | { t: 'chat'; ch: ChatChannel; text: string }
  | { t: 'radio'; id: RadioId }
  | { t: 'spot' }
  | { t: 'squad'; op: 'create' | 'join' | 'leave' | 'lock' | 'unlock' | 'kick' | 'promote'; squad?: string; target?: string }
  | { t: 'order'; kind: OrderKind; cp?: string; pos?: [number, number, number]; squad?: string }
  | { t: 'ping'; c: number };

/** Kompaktní stav vzdáleného hráče (interpolovaný na klientovi). */
export interface RemoteState {
  id: string;
  name: string;
  team: Team;
  alive: boolean;
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  bodyYaw: number;
  height: number;
  stance: PlayerState['stance'];
  grounded: boolean;
  sprinting: boolean;
  ads: number;
  action: WeaponState['action'];
  actionStart: number;
  actionEnd: number;
  shotSeq: number;
  ladder: string | null;
  squad: string | null;
  /** Zbraň z arzenálu (world model a efekty). */
  weapon: string;
  /** Stav života: živý, vyřazený (tělo leží, lze oživit), mrtvý. */
  life: 'alive' | 'downed' | 'dead';
}

export interface SquadInfo {
  id: string;
  team: Team;
  name: string;
  leader: string;
  members: string[];
  locked: boolean;
  version: number;
}

export interface OrderInfo {
  id: string;
  squad: string;
  kind: OrderKind;
  target: { cp?: string; pos: [number, number, number] };
  status: 'active' | 'completed' | 'superseded' | 'cancelled';
  author: string;
  time: number;
}

export interface ContactInfo {
  id: string;
  kind: 'confirmed' | 'suspect';
  pos: [number, number, number];
  expires: number;
  source: string;
}

/** Velení týmu (jen vlastní tým; nepřítel nedostane nic). */
export interface CommandInfo {
  commander: string | null;
  uavReadyAt: number;
  scanReadyAt: number;
  uav: { pos: [number, number, number]; until: number } | null;
}

export interface SelfState {
  state: PlayerState;
  weapon: WeaponState;
  hp: number;
  alive: boolean;
  respawnAt: number;
  zone: { t: number; countdown: number } | null;
  kills: number;
  deaths: number;
  team: Team;
  squad: string | null;
  canSquadSpawn: boolean;
  /** Vyřazení: zbývající čas okna pro oživení (s), jinak 0. */
  downed: boolean;
  downedLeft: number;
  /** Medik: průběh oživování 0–1 (0 = neoživuje). */
  reviveProgress: number;
  revives: number;
}

/** Pravidla serveru pro UI (čte je klient, nevymýšlí je). */
export interface ServerRules {
  name: string;
  pilot: boolean;
  teamSize: number;
  friendlyFire: boolean;
  kits: Kit[];
  respawnDelay: number;
  downedTime: number;
}

export type ServerMsg =
  | {
      t: 'welcome';
      v: number;
      id: string;
      map: MapDocument;
      mapHash: string;
      generators: Record<string, number>;
      tick: number;
      scenarioId: string;
      team: Team;
      conquest: boolean;
      factions: Record<Team, Faction>;
      rules: ServerRules;
    }
  | {
      t: 'snap';
      tick: number;
      time: number;
      ack: number;
      me: SelfState;
      others: RemoteState[];
      /** Kompaktní forma others na drátě (klient ji rozbalí do `others`). */
      o?: RemoteTuple[];
      cps: Array<Pick<CPState, 'id' | 'owner' | 'p' | 'activity'>> | null;
      tickets: Record<Team, number> | null;
      cqTime: number;
      ended: boolean;
      winner: Team | 'draw' | null;
      dummies: Array<{ id: string; down: boolean }>;
      squads: SquadInfo[];
      order: OrderInfo | null;
      contacts: ContactInfo[];
      command: CommandInfo;
      spawns: string[];
      scores: Array<{ id: string; name: string; team: Team; kills: number; deaths: number; revives: number; ping: number; squad: string | null }>;
    }
  | { t: 'events'; list: SimEvent[] }
  | { t: 'chat'; id: string; from: string; name: string; ch: ChatChannel | 'system'; text: string; time: number }
  | { t: 'radio'; id: string; from: string; name: string; radio: RadioId; pos: [number, number, number] | null; time: number }
  | { t: 'reject'; what: string; reason: string }
  | { t: 'ack'; what: string; detail?: string }
  | { t: 'pong'; c: number; s: number }
  | { t: 'bye'; reason: string };

/** Stabilní hash mapy (handshake: klient s jinou mapou/verzí se nepřipojí). */
export function mapHash(doc: MapDocument): string {
  const s = JSON.stringify(doc);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
}

/** Bezpečný parse zprávy klienta s kontrolou tvaru (neznámé typy se odmítnou). */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > NET.maxMessageBytes) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hello':
      return typeof o.v === 'number' && typeof o.name === 'string' ? (o as ClientMsg) : null;
    case 'input':
      return Array.isArray(o.frames) && o.frames.length <= NET.maxInputsPerMessage && o.frames.every((f) => f && typeof f === 'object' && typeof (f as InputFrame).seq === 'number') ? (o as ClientMsg) : null;
    case 'spawn':
      return (o.id === null || typeof o.id === 'string') && (o.weapon === undefined || (typeof o.weapon === 'string' && WEAPON_IDS.includes(o.weapon))) ? (o as ClientMsg) : null;
    case 'team':
      return o.team === 'teamA' || o.team === 'teamB' ? (o as ClientMsg) : null;
    case 'chat':
      return (o.ch === 'all' || o.ch === 'team' || o.ch === 'squad') && typeof o.text === 'string' ? (o as ClientMsg) : null;
    case 'radio':
      return (RADIO_IDS as readonly string[]).includes(o.id as string) ? (o as ClientMsg) : null;
    case 'spot':
    case 'giveup':
      return o as ClientMsg;
    case 'squad':
      return ['create', 'join', 'leave', 'lock', 'unlock', 'kick', 'promote'].includes(o.op as string) ? (o as ClientMsg) : null;
    case 'order':
      return ['attack', 'defend', 'move'].includes(o.kind as string) && (o.squad === undefined || typeof o.squad === 'string') ? (o as ClientMsg) : null;
    case 'command':
      return o.op === 'apply' || o.op === 'resign' ? (o as ClientMsg) : null;
    case 'ability':
      return (o.kind === 'uav' || o.kind === 'scan') && (o.pos === undefined || (Array.isArray(o.pos) && o.pos.length === 3 && o.pos.every((v) => typeof v === 'number' && Number.isFinite(v)))) ? (o as ClientMsg) : null;
    case 'ping':
      return typeof o.c === 'number' ? (o as ClientMsg) : null;
  }
  return null;
}

export const RADIO_TEXT: Record<RadioId, string> = {
  enemy: 'Nepřítel spatřen!',
  medic: 'Potřebuji medika!',
  ammo: 'Potřebuji munici!',
  backup: 'Potřebuji posily!',
  followMe: 'Za mnou!',
  goGoGo: 'Vpřed, vpřed!',
  roger: 'Rozumím.',
  negative: 'Negativní.',
  thanks: 'Díky!',
  sorry: 'Promiň!',
};

/** Kompaktní n-tice vzdáleného hráče (pořadí polí = verze protokolu). */
export type RemoteTuple = [string, string, 0 | 1, 0 | 1, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, string | null, string | null];
const STANCES = ['stand', 'crouch', 'prone'] as const;
const ACTIONS = ['equip', 'idle', 'reload', 'sprintOut'] as const;
const LIFE = ['alive', 'downed', 'dead'] as const;

export function encodeRemote(r: RemoteState): RemoteTuple {
  return [
    r.id, r.name, r.team === 'teamA' ? 0 : 1, r.alive ? 1 : 0,
    r.pos[0], r.pos[1], r.pos[2], r.vel[0], r.vel[1], r.vel[2],
    r.yaw, r.pitch, r.bodyYaw, r.height,
    STANCES.indexOf(r.stance), (r.grounded ? 1 : 0) | (r.sprinting ? 2 : 0), r.ads,
    ACTIONS.indexOf(r.action), r.actionStart, r.actionEnd, r.shotSeq, Math.max(0, WEAPON_IDS.indexOf(r.weapon)), LIFE.indexOf(r.life),
    r.ladder, r.squad,
  ];
}

export function decodeRemote(t: RemoteTuple): RemoteState {
  return {
    id: t[0], name: t[1], team: t[2] === 0 ? 'teamA' : 'teamB', alive: t[3] === 1,
    pos: [t[4], t[5], t[6]], vel: [t[7], t[8], t[9]],
    yaw: t[10], pitch: t[11], bodyYaw: t[12], height: t[13],
    stance: STANCES[t[14]] ?? 'stand', grounded: (t[15] & 1) !== 0, sprinting: (t[15] & 2) !== 0, ads: t[16],
    action: ACTIONS[t[17]] ?? 'idle', actionStart: t[18], actionEnd: t[19], shotSeq: t[20],
    ladder: t[23], squad: t[24], weapon: WEAPON_IDS[t[21]] ?? 'm4a1', life: LIFE[t[22]] ?? (t[3] === 1 ? 'alive' : 'dead'),
  };
}
