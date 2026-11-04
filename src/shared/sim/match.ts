import { MOVEMENT, type MovementConfig } from '../config/movement';
import { PF_RIFLE, type WeaponConfig } from '../config/weapon';
import type { MapDocument, SpawnPoint, Team, Zone } from '../map/schema';
import type { V3 } from '../math';
import type { PhysicsWorld } from '../physics/world';
import type { LadderDef } from '../../world/parts';
import { hitboxOf, stepProjectiles, type Hitbox, type ImpactEvent, type Projectile } from './ballistics';
import { cpSpawnable, createConquest, insideCP, stepConquest, ticketForDeath, type ConquestEvent, type ConquestState } from './conquest';
import { emptyInput, sanitizeInput, type InputFrame } from './input';
import { PlayerController, createPlayerState, type PlayerState } from './player';
import { createWeaponState, stepWeapon, type WeaponState } from './weapon';

/**
 * Autoritativní simulace zápasu: hráči, zbraně, projektily, figuríny, smrt a respawn,
 * zakázané zóny a Conquest. Stejný kód běží offline v prohlížeči i na serveru.
 */
export const MAX_HP = 100;

export interface SimPlayer {
  id: string;
  name: string;
  team: Team;
  ctrl: PlayerController;
  state: PlayerState;
  weapon: WeaponState;
  hp: number;
  alive: boolean;
  lifeId: number;
  diedAt: number;
  respawnAt: number;
  /** Zóna, ve které hráč je, a uplynulý čas odpočtu. */
  zone: { id: string; t: number; countdown: number } | null;
  kills: number;
  deaths: number;
  lastInputTick: number;
  seed: number;
}

export interface DummyDef {
  id: string;
  base: V3;
  yaw: number;
  amp: number;
  speed: number;
}

export interface Dummy extends DummyDef {
  hp: number;
  downUntil: number;
}

export type SimEvent =
  | { type: 'shot'; key: string; owner: string; origin: V3; dir: V3 }
  | ({ type: 'impact' } & ImpactEvent)
  | { type: 'hit'; owner: string; target: string; damage: number; zone: string; hp: number }
  | { type: 'death'; id: string; killer: string | null; cause: 'weapon' | 'zone' | 'fall'; lifeId: number }
  | { type: 'spawn'; id: string; lifeId: number; spawnId: string | null }
  | { type: 'dummyDown'; id: string }
  | ({ kind: 'conquest' } & ConquestEvent & { type2?: never });

export interface MatchOptions {
  conquest: boolean;
  scenarioId?: string;
  friendlyFire?: boolean;
  seed?: number;
  /** Respawn bez Conquestu (střelnice). */
  freeRespawnDelay?: number;
}

/** Pohyb figuríny: konstantní rychlost tam a zpět (deterministicky z času). */
export function dummyOffset(simTime: number, amp: number, speed: number): number {
  if (amp <= 0 || speed <= 0) return 0;
  const period = (4 * amp) / speed;
  const ph = (simTime % period) / period;
  return (ph < 0.5 ? -1 + 4 * ph : 3 - 4 * ph) * amp;
}

export function dummiesFromMap(doc: MapDocument): DummyDef[] {
  return doc.objects
    .filter((o) => o.assetId === 'range.target' && !o.gameHidden)
    .map((o) => ({
      id: o.id,
      base: { x: o.transform.position[0], y: o.transform.position[1], z: o.transform.position[2] },
      yaw: o.transform.rotation[1],
      amp: o.params.moving ? Number(o.params.amplitude ?? 4) : 0,
      speed: o.params.moving ? Number(o.params.speed ?? 2) : 0,
    }));
}

export class MatchSim {
  readonly cfg: MovementConfig = MOVEMENT;
  readonly weaponCfg: WeaponConfig = PF_RIFLE;
  tick = 0;
  readonly players = new Map<string, SimPlayer>();
  readonly dummies: Dummy[];
  readonly projectiles: Projectile[] = [];
  conquest: ConquestState | null;
  events: SimEvent[] = [];
  private seed: number;
  ladders: LadderDef[] = [];

  constructor(
    readonly phys: PhysicsWorld,
    readonly doc: MapDocument,
    readonly opts: MatchOptions,
  ) {
    this.seed = opts.seed ?? 0x5eed;
    this.conquest = opts.conquest ? createConquest(doc, opts.scenarioId) : null;
    this.dummies = dummiesFromMap(doc).map((d) => ({ ...d, hp: MAX_HP, downUntil: -1 }));
  }

  get time() {
    return this.tick / this.cfg.tickRate;
  }

  addPlayer(id: string, team: Team, name = id): SimPlayer {
    const ctrl = new PlayerController(this.phys, this.cfg);
    ctrl.ladders = this.ladders;
    const state = createPlayerState(this.cfg, { x: 0, y: -1000, z: 0 });
    state.tick = this.tick;
    const p: SimPlayer = {
      id,
      name,
      team,
      ctrl,
      state,
      weapon: createWeaponState(this.weaponCfg, this.time),
      hp: 0,
      alive: false,
      lifeId: 0,
      diedAt: -1e9,
      respawnAt: this.time,
      zone: null,
      kills: 0,
      deaths: 0,
      lastInputTick: this.tick,
      seed: (this.seed ^ hash(id)) >>> 0,
    };
    ctrl.place(state, state.pos, 0);
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.ctrl.dispose();
    this.players.delete(id);
  }

  /** Spawny dostupné pro tým právě teď (základny + vlastní stabilní body s povoleným spawnem). */
  spawnOptions(team: Team): SpawnPoint[] {
    const doc = this.doc;
    if (!this.conquest) return [];
    const cps = new Map(this.conquest.cps.map((c) => [c.id, c]));
    return doc.spawnPoints.filter((s) => {
      if (!s.teams.includes(team)) return false;
      if (!s.controlPointId) return true;
      const cp = cps.get(s.controlPointId);
      return !!cp && cpSpawnable(cp, team);
    });
  }

  /** Žádost o spawn: server ověřuje oprávnění, prodlevu a volné místo. Vrací důvod odmítnutí. */
  requestSpawn(id: string, spawnId: string | null): string | null {
    const p = this.players.get(id);
    if (!p) return 'neznámý hráč';
    if (p.alive) return 'hráč žije';
    if (this.time < p.respawnAt - 1e-9) return 'respawn ještě neuplynul';
    if (this.conquest?.ended) return 'zápas skončil';
    let pos: V3, yaw = 0;
    if (this.conquest) {
      const opts = this.spawnOptions(p.team);
      const sp = opts.find((s) => s.id === spawnId) ?? (spawnId === null ? undefined : null);
      if (sp === null) return 'spawn není pro tým dostupný';
      if (!sp) return 'zvolte spawn';
      // Vybrat volný bod skupiny (stejný bod/základna), kontrola kolize a obsazení.
      const group = opts.filter((s) => (s.controlPointId ?? `base:${s.teams.join()}`) === (sp.controlPointId ?? `base:${sp.teams.join()}`));
      const ordered = [sp, ...group.filter((s) => s !== sp)];
      const free = ordered.find((s) => this.spawnFree({ x: s.position[0], y: s.position[1], z: s.position[2] }, p));
      if (!free) return 'všechna místa obsazená – zkuste jiný bod nebo počkejte';
      pos = { x: free.position[0], y: free.position[1], z: free.position[2] };
      yaw = free.yaw;
      spawnId = free.id;
    } else {
      const t = this.doc.testSpawn ?? { position: [0, 0, 0], rotation: [0, 0, 0] };
      pos = { x: t.position[0], y: t.position[1], z: t.position[2] };
      yaw = t.rotation[1];
      if (!this.spawnFree(pos, p)) pos = { ...pos, x: pos.x + 1.2 };
    }
    p.state = createPlayerState(this.cfg, pos, yaw);
    p.state.tick = this.tick;
    p.ctrl.place(p.state, pos, yaw);
    p.weapon = createWeaponState(this.weaponCfg, this.time);
    p.hp = MAX_HP;
    p.alive = true;
    p.lifeId++;
    p.zone = null;
    this.events.push({ type: 'spawn', id, lifeId: p.lifeId, spawnId });
    return null;
  }

  private spawnFree(pos: V3, self: SimPlayer) {
    for (const o of this.players.values()) {
      if (o === self || !o.alive) continue;
      if (Math.hypot(o.state.pos.x - pos.x, o.state.pos.z - pos.z) < 0.8 && Math.abs(o.state.pos.y - pos.y) < 1.8) return false;
    }
    return self.ctrl.fits(this.cfg.stances.stand.height, 0, { ...pos, y: pos.y + 0.03 });
  }

  private kill(p: SimPlayer, killer: string | null, cause: 'weapon' | 'zone' | 'fall') {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.deaths++;
    p.diedAt = this.time;
    p.respawnAt = this.time + (this.conquest?.respawnDelay ?? this.opts.freeRespawnDelay ?? 3);
    p.state.vel = { x: 0, y: 0, z: 0 };
    p.ctrl.place(p.state, { x: p.state.pos.x, y: -1000, z: p.state.pos.z }, p.state.yaw);
    if (killer && killer !== p.id) {
      const k = this.players.get(killer);
      if (k) k.kills++;
    }
    this.events.push({ type: 'death', id: p.id, killer, cause, lifeId: p.lifeId });
    // Ticket se odečte jednou při dokončení smrti (ne až při respawnu).
    if (this.conquest) for (const e of ticketForDeath(this.conquest, p.team)) this.events.push({ kind: 'conquest', ...e } as SimEvent);
  }

  /** Jeden simulační tick se vstupy hráčů (chybějící vstup = neutrální, bez držené střelby). */
  step(inputs: Map<string, InputFrame>) {
    const dt = 1 / this.cfg.tickRate;
    const ended = !!this.conquest?.ended;
    for (const p of this.players.values()) {
      const raw = inputs.get(p.id);
      if (raw) p.lastInputTick = this.tick;
      // Timeout vstupu (> 0,25 s): server zruší držené akce (střelba, sprint).
      const input = raw ? sanitizeInput(raw) : emptyInput(this.tick);
      if (!p.alive) continue;
      p.state.tick = this.tick;
      p.ctrl.step(p.state, input);
      if (p.state.pos.y < -50) {
        this.kill(p, null, 'fall');
        continue;
      }
      const shots = ended ? [] : stepWeapon(this.weaponCfg, this.cfg, p.state, p.weapon, input, { playerId: p.id, lifeId: p.lifeId, team: p.team, seed: p.seed, phys: this.phys });
      for (const s of shots) {
        this.projectiles.push(s);
        const l = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
        this.events.push({ type: 'shot', key: s.key, owner: p.id, origin: { ...s.origin }, dir: { x: s.vel.x / l, y: s.vel.y / l, z: s.vel.z / l } });
      }
    }
    this.tick++;
    const t = this.time;
    // Figuríny (pohyb z času, sražené se po 3 s zvednou).
    for (const d of this.dummies) if (d.downUntil > 0 && t >= d.downUntil) {
      d.downUntil = -1;
      d.hp = MAX_HP;
    }
    // Projektily proti světu, hráčům a figurínám.
    const hbs: Hitbox[] = [];
    for (const p of this.players.values()) if (p.alive) hbs.push(hitboxOf(p.id, p.state, this.cfg, p.team));
    for (const d of this.dummies) {
      if (d.downUntil > 0) continue;
      const off = dummyOffset(t, d.amp, d.speed);
      const x = d.base.x + Math.cos(d.yaw) * off, z = d.base.z - Math.sin(d.yaw) * off;
      hbs.push({ id: `dummy:${d.id}`, a: { x, y: d.base.y + 0.55, z }, b: { x, y: d.base.y + 1.62, z }, r: 0.22, kind: 'vertical', feetY: d.base.y + 0.3, height: 1.45 });
    }
    const impacts = stepProjectiles(this.projectiles, dt, this.weaponCfg, this.phys, hbs, this.opts.friendlyFire ?? false);
    for (const im of impacts) {
      this.events.push({ type: 'impact', ...im });
      if (!im.target || !im.damage || ended) continue;
      if (im.target.startsWith('dummy:')) {
        const d = this.dummies.find((x) => `dummy:${x.id}` === im.target);
        if (!d || d.downUntil > 0) continue;
        d.hp -= im.damage;
        this.events.push({ type: 'hit', owner: im.owner, target: im.target, damage: im.damage, zone: im.zone!, hp: Math.max(0, d.hp) });
        if (d.hp <= 0) {
          d.downUntil = t + 3;
          this.events.push({ type: 'dummyDown', id: d.id });
        }
        continue;
      }
      const v = this.players.get(im.target);
      if (!v || !v.alive) continue;
      v.hp = Math.max(0, v.hp - im.damage);
      this.events.push({ type: 'hit', owner: im.owner, target: v.id, damage: im.damage, zone: im.zone!, hp: v.hp });
      if (v.hp <= 0) this.kill(v, im.owner, 'weapon');
    }
    // Zakázané zóny: odpočet jen během pobytu, po návratu reset.
    if (this.conquest && !ended) {
      const zones = this.doc.zones.filter((z) => this.conquest!.zoneIds.includes(z.id));
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const z = zones.find((zz) => zz.appliesTo.includes(p.team) && insideZone(zz, p.state.pos));
        if (!z) p.zone = null;
        else {
          if (!p.zone || p.zone.id !== z.id) p.zone = { id: z.id, t: 0, countdown: z.countdown };
          p.zone.t += dt;
          if (p.zone.t >= z.countdown) this.kill(p, null, 'zone');
        }
      }
      // Conquest: přítomnost živých hráčů v objemech bodů.
      const presence = new Map<string, Record<Team, number>>();
      for (const cp of this.conquest.cps) {
        const pr = { teamA: 0, teamB: 0 };
        for (const p of this.players.values()) if (p.alive && insideCP(cp, p.state.pos)) pr[p.team]++;
        presence.set(cp.id, pr);
      }
      for (const e of stepConquest(this.conquest, presence, dt)) this.events.push({ kind: 'conquest', ...e } as SimEvent);
    }
  }

  /** Restart: obnoví scénář, HP, munici, tickety a body (autorská data se nemění). */
  restart() {
    this.conquest = this.opts.conquest ? createConquest(this.doc, this.opts.scenarioId) : null;
    this.projectiles.length = 0;
    for (const d of this.dummies) {
      d.hp = MAX_HP;
      d.downUntil = -1;
    }
    for (const p of this.players.values()) {
      p.alive = false;
      p.hp = 0;
      p.respawnAt = this.time;
      p.kills = p.deaths = 0;
      p.ctrl.place(p.state, { x: 0, y: -1000, z: 0 }, 0);
    }
    this.events = [];
  }

  dispose() {
    for (const p of this.players.values()) p.ctrl.dispose();
    this.players.clear();
  }
}

export function insideZone(z: Zone, p: V3) {
  const dx = p.x - z.center[0], dz = p.z - z.center[2];
  const c = Math.cos(-z.yaw), s = Math.sin(-z.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= z.halfExtents[0] && Math.abs(lz) <= z.halfExtents[2] && Math.abs(p.y + 0.9 - z.center[1]) <= z.halfExtents[1];
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
