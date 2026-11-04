import type { MapDocument, SpawnPoint, Team } from '../../shared/map/schema';
import type { PhysicsWorld } from '../../shared/physics/world';
import type { ConquestState } from '../../shared/sim/conquest';
import type { InputFrame } from '../../shared/sim/input';
import { MatchSim, dummyOffset, type SimEvent } from '../../shared/sim/match';
import { clonePlayerState, type PlayerState } from '../../shared/sim/player';
import type { WeaponState } from '../../shared/sim/weapon';
import type { LadderDef } from '../../world/parts';

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
  requestSpawn(spawnId: string | null): string | null;
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

  constructor(phys: PhysicsWorld, doc: MapDocument, opts: { conquest: boolean; scenarioId?: string; team: Team }, ladders: LadderDef[]) {
    this.sim = new MatchSim(phys, doc, { conquest: opts.conquest, scenarioId: opts.scenarioId, freeRespawnDelay: 3 });
    this.sim.ladders = ladders;
    this.sim.addPlayer(this.localId, opts.team, 'Hráč');
    if (!opts.conquest) this.sim.requestSpawn(this.localId, null);
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
  requestSpawn(spawnId: string | null) {
    return this.sim.requestSpawn(this.localId, spawnId);
  }
  dummies() {
    const t = this.sim.time;
    return this.sim.dummies.map((d) => ({ id: d.id, offset: dummyOffset(t, d.amp, d.speed), down: d.downUntil > 0 }));
  }
  restart() {
    this.sim.restart();
    if (!this.sim.conquest) this.sim.requestSpawn(this.localId, null);
  }
  dispose() {
    this.sim.dispose();
  }
}

export { clonePlayerState };
