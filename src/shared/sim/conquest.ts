import type { ControlPoint, MapDocument, Scenario, Team, TeamOwner } from '../map/schema';

/**
 * Pravidla Conquestu jako stavový automat (čistá data, testovatelné).
 * Bod má hodnotu p ∈ [−1, 1]: +1 = drží tým A, −1 = tým B, 0 = neutrální.
 * Vlastník se mění jen na stabilních hodnotách: dosažení 0 = neutralizace,
 * dosažení ±1 = zabrání. Hodnoty jsou laditelné návrhy, ne změřený standard BF2.
 */
export interface CPState {
  id: string;
  name: string;
  pos: [number, number, number];
  radius: number;
  height: number;
  owner: TeamOwner;
  p: number;
  capturable: boolean;
  spawnEnabled: boolean;
  countsForBleed: boolean;
  /** Kdo právě postupuje ('teamA'/'teamB'), sporný stav, nebo nic. */
  activity: Team | 'contested' | null;
}

export interface ConquestState {
  scenarioId: string;
  cps: CPState[];
  tickets: Record<Team, number>;
  time: number;
  timeLimit: number;
  captureTime: number;
  neutralizeTime: number;
  bleedInterval: number;
  respawnDelay: number;
  bleedAcc: Record<Team, number>;
  ended: boolean;
  winner: Team | 'draw' | null;
  zoneIds: string[];
}

export type ConquestEvent =
  | { type: 'neutralized'; cp: string; from: Team }
  | { type: 'captured'; cp: string; by: Team }
  | { type: 'bleed'; team: Team }
  | { type: 'end'; winner: Team | 'draw' };

const other = (t: Team): Team => (t === 'teamA' ? 'teamB' : 'teamA');
const sign = (t: Team) => (t === 'teamA' ? 1 : -1);

/** Efektivní konfigurace bodů = základ mapy + přepsání scénáře (vypnuté body vynechány). */
export function createConquest(doc: MapDocument, scenarioId?: string): ConquestState {
  const sc: Scenario | undefined = doc.scenarios.find((s) => s.id === scenarioId) ?? doc.scenarios[0];
  const cps: CPState[] = [];
  for (const c of doc.controlPoints) {
    const ov = sc?.overrides.find((o) => o.controlPointId === c.id);
    if (ov?.disabled) continue;
    const owner = ov?.defaultOwner ?? c.defaultOwner;
    cps.push({
      id: c.id,
      name: c.name,
      pos: [...c.position] as [number, number, number],
      radius: c.radius,
      height: c.height,
      owner,
      p: owner === 'teamA' ? 1 : owner === 'teamB' ? -1 : 0,
      capturable: ov?.capturable ?? c.capturable,
      spawnEnabled: ov?.spawnEnabled ?? c.spawnEnabled,
      countsForBleed: ov?.countsForBleed ?? c.countsForBleed,
      activity: null,
    });
  }
  return {
    scenarioId: sc?.id ?? '',
    cps,
    tickets: { teamA: sc?.tickets.teamA ?? 100, teamB: sc?.tickets.teamB ?? 100 },
    time: 0,
    timeLimit: sc?.timeLimit ?? 1200,
    captureTime: sc?.captureTime ?? 10,
    neutralizeTime: sc?.neutralizeTime ?? 10,
    bleedInterval: sc?.bleedInterval ?? 5,
    respawnDelay: sc?.respawnDelay ?? 10,
    bleedAcc: { teamA: 0, teamB: 0 },
    ended: false,
    winner: null,
    zoneIds: sc?.zoneIds ?? [],
  };
}

/** Je hráč uvnitř objemu bodu (válec s podstavou u markeru)? Bez testu viditelnosti. */
export function insideCP(cp: Pick<CPState, 'pos' | 'radius' | 'height'>, p: { x: number; y: number; z: number }) {
  const dx = p.x - cp.pos[0], dz = p.z - cp.pos[2];
  return dx * dx + dz * dz <= cp.radius * cp.radius && p.y >= cp.pos[1] - 0.5 && p.y <= cp.pos[1] + cp.height;
}

/** Stabilní = vlastník drží bod bez rozpracovaného postupu a bez sporu. */
export function cpStable(cp: CPState) {
  if (cp.activity === 'contested') return false;
  if (cp.owner === 'neutral') return cp.p === 0;
  return cp.p === sign(cp.owner as Team);
}

/**
 * Jeden krok zabírání a ticketů. `presence` = počty živých hráčů v objemu bodu.
 * Více hráčů zatím nezrychluje. Po konci zápasu se nic nemění.
 */
export function stepConquest(s: ConquestState, presence: Map<string, Record<Team, number>>, dt: number): ConquestEvent[] {
  const ev: ConquestEvent[] = [];
  if (s.ended) return ev;
  s.time += dt;
  for (const cp of s.cps) {
    const pr = presence.get(cp.id) ?? { teamA: 0, teamB: 0 };
    const a = pr.teamA > 0, b = pr.teamB > 0;
    if (!cp.capturable) {
      cp.activity = null;
      continue;
    }
    if (a && b) {
      cp.activity = 'contested';
      continue; // oba týmy = postup stojí
    }
    if (!a && !b) {
      cp.activity = null;
      continue; // rozpracovaný postup se zachová
    }
    const team: Team = a ? 'teamA' : 'teamB';
    const dir = sign(team);
    // Rychlost: u vlastněného bodu se neutralizace i její vracení děje rychlostí neutralizace;
    // rozpracované zabrání neutrálního bodu se zabírá i vrací rychlostí zabrání.
    const towardZero = cp.p !== 0 && Math.sign(cp.p) !== dir;
    const ownedPhase = cp.owner !== 'neutral';
    const rate = ((towardZero && ownedPhase) || (!towardZero && ownedPhase && sign(cp.owner as Team) === dir) ? 1 / s.neutralizeTime : 1 / s.captureTime) * dt;
    const before = cp.p;
    if (cp.p === dir) {
      cp.activity = null;
      continue; // už drží
    }
    let next = cp.p + dir * rate;
    // Přechod přes nulu se zastaví na neutrálu (stabilní stav) – vlastník padá jen tady.
    if (before !== 0 && Math.sign(before) !== dir && Math.sign(next) !== Math.sign(before)) next = 0;
    if (Math.abs(next) >= 1) next = dir;
    cp.p = Math.round(next * 1e9) / 1e9;
    cp.activity = team;
    if (cp.p === 0 && before !== 0 && cp.owner !== 'neutral') {
      ev.push({ type: 'neutralized', cp: cp.id, from: cp.owner as Team });
      cp.owner = 'neutral';
    }
    if (cp.p === dir && cp.owner !== team) {
      cp.owner = team;
      ev.push({ type: 'captured', cp: cp.id, by: team });
    }
  }
  // Bleed: tým držící víc než polovinu počítaných bodů → soupeř ztrácí ticket každých N s.
  const counted = s.cps.filter((c) => c.countsForBleed);
  if (counted.length) {
    for (const t of ['teamA', 'teamB'] as Team[]) {
      const held = counted.filter((c) => c.owner === t).length;
      if (held * 2 > counted.length) {
        const o = other(t);
        s.bleedAcc[o] += dt;
        while (s.bleedAcc[o] >= s.bleedInterval - 1e-9) {
          s.bleedAcc[o] -= s.bleedInterval;
          s.tickets[o] = Math.max(0, s.tickets[o] - 1);
          ev.push({ type: 'bleed', team: o });
        }
      } else s.bleedAcc[other(t)] = 0;
    }
  }
  checkEnd(s, ev);
  return ev;
}

/** Odečet ticketu při dokončení smrti (jednou, nikoli až při respawnu). */
export function ticketForDeath(s: ConquestState, team: Team): ConquestEvent[] {
  const ev: ConquestEvent[] = [];
  if (s.ended) return ev;
  s.tickets[team] = Math.max(0, s.tickets[team] - 1);
  checkEnd(s, ev);
  return ev;
}

function checkEnd(s: ConquestState, ev: ConquestEvent[]) {
  if (s.ended) return;
  const a = s.tickets.teamA, b = s.tickets.teamB;
  let w: Team | 'draw' | null = null;
  if (a <= 0 && b <= 0) w = 'draw';
  else if (a <= 0) w = 'teamB';
  else if (b <= 0) w = 'teamA';
  else if (s.time >= s.timeLimit) w = a > b ? 'teamA' : b > a ? 'teamB' : 'draw';
  if (w) {
    s.ended = true;
    s.winner = w;
    ev.push({ type: 'end', winner: w });
  }
}

/** Je bod pro tým použitelný ke spawnu (vlastní, povolený, stabilní)? */
export function cpSpawnable(cp: CPState, team: Team) {
  return cp.owner === team && cp.spawnEnabled && cpStable(cp);
}

export function cpConfig(doc: MapDocument, id: string): ControlPoint | undefined {
  return doc.controlPoints.find((c) => c.id === id);
}
