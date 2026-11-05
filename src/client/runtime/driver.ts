import type { MapDocument, SpawnPoint, Team } from '../../shared/map/schema';
import type { PhysicsWorld } from '../../shared/physics/world';
import type { ConquestState } from '../../shared/sim/conquest';
import type { InputFrame } from '../../shared/sim/input';
import { MatchSim, dummyOffset, type SimEvent } from '../../shared/sim/match';
import { clonePlayerState, type PlayerState } from '../../shared/sim/player';
import type { WeaponState } from '../../shared/sim/weapon';
import type { LadderDef } from '../../world/parts';
import type { Faction } from '../../shared/config/arsenal';

/** Pohled prezentace na hráče (lokálního i vzdáleného). */
export interface PlayerView {
  id: string;
  name: string;
  team: Team;
  state: PlayerState;
  weapon: WeaponState;
  hp: number;
  alive: boolean;
  respawnAt: number;
  zone: { t: number; countdown: number } | null;
  kills: number;
  deaths: number;
}

/**
 * Zdroj herního stavu pro prezentaci. Offline = lokální MatchSim (autorita v prohlížeči);
 * síť = predikce + server (krok 8). Prezentace (Game) je pro oba stejná.
 */
export interface GameDriver {
  readonly localId: string;
  readonly mode: 'offline' | 'network';
  /** Jeden simulační tick s lokálním vstupem. */
  step(input: InputFrame): void;
  local(): PlayerView | null;
  remotes(): PlayerView[];
  conquest(): ConquestState | null;
  takeEvents(): SimEvent[];
  time(): number;
  spawnOptions(): SpawnPoint[];
  /** Žádost o spawn s volitelnou výbavou (zbraň z arzenálu); autorita ji ověří. */
  requestSpawn(spawnId: string | null, weaponId?: string | null): string | null;
  /** Frakce týmu lokálního hráče (výběr výbavy) – null = volný test, libovolná frakce. */
  faction(): Faction | null;
  dummies(): Array<{ id: string; offset: number; down: boolean }>;
  restart(): void;
  dispose(): void;
  /** Statistika sítě (RTT, korekce) – offline null. */
  netStats?(): { rtt: number; corrections: number; pending: number } | null;
}

export class OfflineDriver implements GameDriver {
  readonly localId = 'local';
  readonly mode = 'offline' as const;
  readonly sim: MatchSim;

  constructor(phys: PhysicsWorld, doc: MapDocument, opts: { conquest: boolean; scenarioId?: string; team: Team; weapon?: string }, ladders: LadderDef[]) {
    this.sim = new MatchSim(phys, doc, { conquest: opts.conquest, scenarioId: opts.scenarioId, freeRespawnDelay: 3 });
    this.sim.ladders = ladders;
    this.sim.addPlayer(this.localId, opts.team, 'Hráč');
    this.weapon = opts.weapon ?? null;
    if (!opts.conquest) this.sim.requestSpawn(this.localId, null, this.weapon);
  }
  private weapon: string | null;

  faction() {
    const p = this.sim.players.get(this.localId);
    return p && this.sim.conquest ? this.sim.factionOf(p.team) : null;
  }

  step(input: InputFrame) {
    this.sim.step(new Map([[this.localId, input]]));
  }

  private view(id: string): PlayerView | null {
    const p = this.sim.players.get(id);
    if (!p) return null;
    return { id: p.id, name: p.name, team: p.team, state: p.state, weapon: p.weapon, hp: p.hp, alive: p.alive, respawnAt: p.respawnAt, zone: p.zone, kills: p.kills, deaths: p.deaths };
  }

  local() {
    return this.view(this.localId);
  }
  remotes() {
    return [...this.sim.players.keys()].filter((k) => k !== this.localId).map((k) => this.view(k)!);
  }
  conquest() {
    return this.sim.conquest;
  }
  takeEvents() {
    const e = this.sim.events;
    this.sim.events = [];
    return e;
  }
  time() {
    return this.sim.time;
  }
  spawnOptions() {
    const p = this.sim.players.get(this.localId);
    return p ? this.sim.spawnOptions(p.team) : [];
  }
  requestSpawn(spawnId: string | null, weaponId?: string | null) {
    if (weaponId) this.weapon = weaponId;
    const p = this.sim.players.get(this.localId);
    // Výchozí zbraň z nastavení jiné frakce se v Conquestu nepoužije (server by ji odmítl).
    const w = weaponId ?? (p && this.weapon && !this.sim.checkWeapon(p.team, this.weapon) ? this.weapon : null);
    return this.sim.requestSpawn(this.localId, spawnId, w);
  }
  dummies() {
    const t = this.sim.time;
    return this.sim.dummies.map((d) => ({ id: d.id, offset: dummyOffset(t, d.amp, d.speed), down: d.downUntil > 0 }));
  }
  restart() {
    this.sim.restart();
    if (!this.sim.conquest) this.sim.requestSpawn(this.localId, null, this.weapon);
  }
  dispose() {
    this.sim.dispose();
  }
}

export { clonePlayerState };
