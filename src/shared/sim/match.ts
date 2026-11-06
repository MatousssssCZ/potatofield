import { MOVEMENT, type MovementConfig } from '../config/movement';
import { PF_RIFLE, type WeaponConfig } from '../config/weapon';
import { DEFAULT_FACTIONS, PILOT, arsenalEntry, fallDamage, isGun, rulesOf, weaponFor, type Faction, type Kit } from '../config/arsenal';
import { activeItem, createInventory, resolveRequest, switchTo, type Inventory } from './inventory';
import { stepItem, type ItemHooks } from './items';
import { itemHooksFor } from './matchItems';
import type { MapDocument, SpawnPoint, Team, Zone } from '../map/schema';
import type { V3 } from '../math';
import type { PhysicsWorld } from '../physics/world';
import type { LadderDef } from '../../world/parts';
import { hitboxOf, stepProjectiles, type Hitbox, type ImpactEvent, type Projectile } from './ballistics';
import { cpSpawnable, createConquest, insideCP, stepConquest, ticketForDeath, type ConquestEvent, type ConquestState } from './conquest';
import { BTN, emptyInput, sanitizeInput, type InputFrame } from './input';
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
  /** Zbraň z arzenálu potvrzená serverem při spawnu (vzhled + pravidla). */
  weaponId: string;
  /** Vyřazen (čeká na oživení): tělo leží, žádné akce; definitivní smrt po `downedUntil`. */
  downed: boolean;
  downedUntil: number;
  downedBy: string | null;
  downedCause: 'weapon' | 'fall';
  /** Čas posledního zpracovaného dopadu (poškození pádem jednou na dopad). */
  landSeen: number;
  /** Inventář kitu (sloty); `weapon` je stav aktivního slotu. Null před prvním nasazením. */
  inv: Inventory | null;
  /** Medik: koho právě oživuje a jak dlouho drží (s). */
  reviveTarget: string | null;
  reviveHeld: number;
  revives: number;
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
  | { type: 'shot'; key: string; owner: string; origin: V3; dir: V3; pellet?: number }
  | ({ type: 'impact' } & ImpactEvent)
  | { type: 'hit'; owner: string; target: string; damage: number; zone: string; hp: number }
  | { type: 'death'; id: string; killer: string | null; cause: 'weapon' | 'zone' | 'fall' | 'giveup'; lifeId: number }
  | { type: 'downed'; id: string; killer: string | null; lifeId: number }
  | { type: 'fall'; id: string; damage: number; hp: number }
  | { type: 'revive'; id: string; by: string; lifeId: number }
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
  /** Frakce týmů pro kontrolu výbavy (výchozí USMC × MEC). Bez Conquestu je volná. */
  factions?: Record<Team, Faction>;
  /** Povolené classy (pilot: Assault/Medic/Support/Sniper). Bez omezení = všechny. */
  allowedKits?: Kit[];
  /** Vyřazení s oknem pro oživení (výchozí zapnuto); false = okamžitá smrt. */
  downed?: boolean;
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
  /** Výchozí pravidla (projektily bez vlastních pravidel). Hráč má pravidla podle své zbraně. */
  readonly weaponCfg: WeaponConfig = PF_RIFLE;
  tick = 0;
  readonly players = new Map<string, SimPlayer>();
  readonly dummies: Dummy[];
  readonly projectiles: Projectile[] = [];
  conquest: ConquestState | null;
  events: SimEvent[] = [];
  private seed: number;
  ladders: LadderDef[] = [];
  /** Spawn u velitele čety (řeší server): vrací pozici nebo důvod odmítnutí. */
  squadSpawn?: (p: SimPlayer, leaderId: string) => { pos: V3; yaw: number } | string;

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

  factionOf(team: Team): Faction {
    return (this.opts.factions ?? DEFAULT_FACTIONS)[team];
  }

  /**
   * Ověření volby výbavy: zbraň musí existovat a v Conquestu patřit frakci týmu.
   * Vrací důvod odmítnutí nebo null.
   */
  checkWeapon(team: Team, weaponId: string): string | null {
    const e = arsenalEntry(weaponId);
    if (!e) return 'neznámá zbraň';
    if (e.available === false) return 'zbraň této classy zatím není hotová';
    if (this.opts.allowedKits && !this.opts.allowedKits.includes(e.kit)) return 'classa není v tomto režimu povolena';
    if (this.conquest && e.faction !== this.factionOf(team)) return 'zbraň nepatří frakci týmu';
    return null;
  }

  addPlayer(id: string, team: Team, name = id): SimPlayer {
    const weaponId = weaponFor(this.factionOf(team), 'assault').id;
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
      weapon: createWeaponState(rulesOf(weaponId), this.time, weaponId),
      weaponId,
      downed: false,
      downedUntil: 0,
      downedBy: null,
      downedCause: 'weapon',
      landSeen: -1e9,
      inv: null,
      reviveTarget: null,
      reviveHeld: 0,
      revives: 0,
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
  requestSpawn(id: string, spawnId: string | null, weaponId?: string | null): string | null {
    const p = this.players.get(id);
    if (!p) return 'neznámý hráč';
    if (p.alive) return 'hráč žije';
    if (p.downed) return 'jsi vyřazen – čekej na oživení, nebo vzdej pomoc';
    if (weaponId) {
      const err = this.checkWeapon(p.team, weaponId);
      if (err) return err;
    } else if (this.checkWeapon(p.team, p.weaponId)) weaponId = weaponFor(this.factionOf(p.team), 'assault').id;
    if (this.time < p.respawnAt - 1e-9) return 'respawn ještě neuplynul';
    if (this.conquest?.ended) return 'zápas skončil';
    let pos: V3, yaw = 0;
    if (spawnId?.startsWith('squad:') && this.squadSpawn) {
      const r = this.squadSpawn(p, spawnId.slice(6));
      if (typeof r === 'string') return r;
      pos = r.pos;
      yaw = r.yaw;
    } else if (this.conquest) {
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
    if (weaponId) p.weaponId = weaponId;
    // Kit podle frakce a classy primární zbraně: sloty 1 nůž, 2 pistole, 3 primární, 4+ výbava.
    const ent = arsenalEntry(p.weaponId);
    p.inv = createInventory(this.conquest ? this.factionOf(p.team) : (ent?.faction ?? this.factionOf(p.team)), ent?.kit ?? 'assault', this.time);
    p.weapon = p.inv.states[3];
    p.hp = MAX_HP;
    p.alive = true;
    p.lifeId++;
    p.zone = null;
    p.landSeen = p.state.lastLandAt;
    this.events.push({ type: 'spawn', id, lifeId: p.lifeId, spawnId });
    return null;
  }

  spawnFree(pos: V3, self: SimPlayer) {
    for (const o of this.players.values()) {
      if (o === self || !o.alive) continue;
      if (Math.hypot(o.state.pos.x - pos.x, o.state.pos.z - pos.z) < 0.8 && Math.abs(o.state.pos.y - pos.y) < 1.8) return false;
    }
    return self.ctrl.fits(this.cfg.stances.stand.height, 0, { ...pos, y: pos.y + 0.03 });
  }

  /**
   * Vyřazení zásahem: tělo zůstává, hráč je mimo boj po dobu okna pro oživení. Zabití se
   * připíše hned (vyřazení je výsledek zásahu), smrt a ticket až při definitivní smrti.
   */
  down(p: SimPlayer, killer: string | null, cause: 'weapon' | 'fall' = 'weapon') {
    if (!p.alive) return;
    if (this.opts.downed === false) return this.kill(p, killer, cause);
    p.downedCause = cause;
    p.alive = false;
    p.downed = true;
    p.hp = 0;
    p.downedUntil = this.time + PILOT.downedTime;
    p.downedBy = killer;
    p.state.vel = { x: 0, y: 0, z: 0 };
    p.weapon.action = 'idle';
    p.weapon.adsToggle = false;
    p.weapon.adsProgress = 0;
    p.zone = null;
    if (killer && killer !== p.id) {
      const k = this.players.get(killer);
      if (k) k.kills++;
    }
    this.events.push({ type: 'downed', id: p.id, killer, lifeId: p.lifeId });
  }

  /** Vzdát pomoc (žádost vyřazeného hráče) – okamžitá definitivní smrt. */
  giveUp(id: string): string | null {
    const p = this.players.get(id);
    if (!p?.downed) return 'nejsi vyřazen';
    this.finalizeDowned(p, 'giveup');
    return null;
  }

  private finalizeDowned(p: SimPlayer, cause: 'weapon' | 'giveup') {
    p.downed = false;
    p.alive = true; // kill() vyžaduje živého – dokončí smrt jedinou cestou (ticket jednou)
    this.kill(p, p.downedBy, cause === 'weapon' ? p.downedCause : cause, true);
  }

  /** Oživení medikem: stejný život (lifeId), HP podle pravidel pilotu, pozice těla. */
  private revive(v: SimPlayer, by: SimPlayer) {
    v.downed = false;
    v.alive = true;
    v.hp = PILOT.reviveHp;
    v.downedBy = null;
    const pos = { ...v.state.pos };
    v.ctrl.place(v.state, pos, v.state.yaw);
    // Bezpečný postoj: dřep (při nízkém stropu leh).
    if (!v.ctrl.fits(this.cfg.stances.stand.height, v.state.yaw, pos)) v.state.proneToggle = !v.ctrl.fits(this.cfg.stances.crouch.height, v.state.yaw, pos);
    v.weapon.action = 'idle';
    by.revives++;
    this.events.push({ type: 'revive', id: v.id, by: by.id, lifeId: v.lifeId });
  }

  kill(p: SimPlayer, killer: string | null, cause: 'weapon' | 'zone' | 'fall' | 'giveup', fromDowned = false) {
    if (!p.alive) return;
    p.alive = false;
    p.downed = false;
    p.hp = 0;
    p.deaths++;
    p.diedAt = this.time;
    p.respawnAt = this.time + (this.conquest?.respawnDelay ?? this.opts.freeRespawnDelay ?? 3);
    p.state.vel = { x: 0, y: 0, z: 0 };
    p.ctrl.place(p.state, { x: p.state.pos.x, y: -1000, z: p.state.pos.z }, p.state.yaw);
    // Zabití se připisuje při vyřazení; po vyřazení už ne podruhé.
    if (!fromDowned && killer && killer !== p.id) {
      const k = this.players.get(killer);
      if (k) k.kills++;
    }
    this.events.push({ type: 'death', id: p.id, killer, cause, lifeId: p.lifeId });
    // Ticket se odečte jednou při dokončení smrti (ne až při respawnu).
    if (this.conquest) for (const e of ticketForDeath(this.conquest, p.team)) this.events.push({ kind: 'conquest', ...e } as SimEvent);
  }

  /** Akce nestřelných položek hráče (nůž, granáty, nástroje) – doplňují je další etapy. */
  protected itemHooks(p: SimPlayer): ItemHooks | null {
    return itemHooksFor(this, p);
  }

  /** Jeden simulační tick se vstupy hráčů (chybějící vstup = neutrální, bez držené střelby). */
  step(inputs: Map<string, InputFrame>) {
    const dt = 1 / this.cfg.tickRate;
    const ended = !!this.conquest?.ended;
    for (const p of this.players.values()) {
      const raw = inputs.get(p.id);
      if (raw) p.lastInputTick = this.tick;
      // Timeout vstupu (> 0,25 s): server zruší držené akce (střelba, sprint).
      let input = raw ? sanitizeInput(raw) : emptyInput(this.tick);
      if (p.downed && this.time >= p.downedUntil - 1e-9) this.finalizeDowned(p, 'weapon');
      if (!p.alive) continue;
      // Oživení: medik drží E u vyřazeného spoluhráče (E se pak nepředá žebříku).
      const target = this.reviveCandidate(p, input);
      if (target) {
        if (p.reviveTarget !== target.id) p.reviveHeld = 0;
        p.reviveTarget = target.id;
        p.reviveHeld += 1 / this.cfg.tickRate;
        input = { ...input, held: input.held & ~BTN.USE, pressed: input.pressed & ~BTN.USE };
        if (p.reviveHeld >= PILOT.reviveHold - 1e-9) {
          this.revive(target, p);
          p.reviveTarget = null;
          p.reviveHeld = 0;
        }
      } else {
        p.reviveTarget = null;
        p.reviveHeld = 0;
      }
      p.state.tick = this.tick;
      p.ctrl.step(p.state, input);
      if (p.state.pos.y < -50) {
        this.kill(p, null, 'fall');
        continue;
      }
      // Poškození pádem: jednou na dopad, z rychlosti dopadu (žebřík a malé výšky bez zranění).
      if (p.state.lastLandAt !== p.landSeen) {
        p.landSeen = p.state.lastLandAt;
        const dmg = ended ? 0 : fallDamage(p.state.lastLandSpeed, this.cfg.gravity);
        if (dmg > 0) {
          p.hp = Math.max(0, p.hp - dmg);
          this.events.push({ type: 'fall', id: p.id, damage: dmg, hp: p.hp });
          if (p.hp <= 0) {
            this.down(p, null, 'fall');
            continue;
          }
        }
      }
      // Výbava: požadavek na slot (číslo / kolečko) – přepnutí s tasením, bez obcházení pravidel.
      if (p.inv && input.slot) {
        const target = resolveRequest(p.inv, input.slot);
        if (target !== null && switchTo(p.inv, target, p.state.tick / this.cfg.tickRate)) p.weapon = p.inv.states[target];
      }
      let shots: ReturnType<typeof stepWeapon> = [];
      if (ended) shots = [];
      else if (isGun(p.weapon.weaponId)) shots = stepWeapon(rulesOf(p.weapon.weaponId), this.cfg, p.state, p.weapon, input, { playerId: p.id, lifeId: p.lifeId, team: p.team, seed: p.seed, phys: this.phys });
      else if (p.inv) stepItem(activeItem(p.inv).kind, this.cfg, p.state, p.weapon, input, this.itemHooks(p));
      for (const s of shots) {
        this.projectiles.push(s);
        const l = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
        this.events.push({ type: 'shot', key: s.key, owner: p.id, origin: { ...s.origin }, dir: { x: s.vel.x / l, y: s.vel.y / l, z: s.vel.z / l }, pellet: s.pellet ?? 0 });
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
      if (v.hp <= 0) this.down(v, im.owner);
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
      p.kills = p.deaths = p.revives = 0;
      p.downed = false;
      p.reviveTarget = null;
      p.reviveHeld = 0;
      p.ctrl.place(p.state, { x: 0, y: -1000, z: 0 }, 0);
    }
    this.events = [];
  }

  /** Vyřazený spoluhráč v dosahu medika, který drží E (jinak null). */
  private reviveCandidate(p: SimPlayer, input: InputFrame): SimPlayer | null {
    if (!(input.held & BTN.USE) || arsenalEntry(p.weaponId)?.kit !== 'medic') return null;
    let best: SimPlayer | null = null, bd: number = PILOT.reviveRange;
    for (const o of this.players.values()) {
      if (!o.downed || o.team !== p.team || o === p) continue;
      const d = Math.hypot(o.state.pos.x - p.state.pos.x, o.state.pos.y - p.state.pos.y, o.state.pos.z - p.state.pos.z);
      if (d <= bd) {
        bd = d;
        best = o;
      }
    }
    return best;
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
