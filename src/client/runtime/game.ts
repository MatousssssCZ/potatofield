import * as THREE from 'three';
import { CAMERA, adsVFov, vFovFromH16x9 } from '../../shared/config/camera';
import { MOVEMENT, type MovementConfig } from '../../shared/config/movement';
import { PF_MG, PF_PISTOL, PF_SNIPER } from '../../shared/config/weapon';
import { PILOT, SIDEARMS, arsenalEntry, rulesOf, type Kit } from '../../shared/config/arsenal';
import type { PhysicsWorld } from '../../shared/physics/world';
import { TacticalMap, type Footprint } from '../ui/tactical';
import { resolveView } from '../../shared/sim/inventory';
import { ScopeView } from '../ui/scope';
import { t } from '../ui/i18n';
import type { NetDriver } from './netDriver';
import type { MapDocument } from '../../shared/map/schema';
import { clamp, lerp } from '../../shared/math';
import { BTN } from '../../shared/sim/input';
import { clonePlayerState, eyePosition, type PlayerState } from '../../shared/sim/player';
import { aimAngles, spreadOf } from '../../shared/sim/weapon';
import { Effects } from '../render/effects';
import type { QualityProfile } from '../render/quality';
import { FPWeapon } from '../render/weapons/fpWeapon';
import { weaponDef } from '../render/weapons/catalog';
import { FPItem } from '../render/weapons/fpItem';
import { isItemModel } from '../render/weapons/items';
import type { WorldView } from '../render/worldView';
import { Hud } from '../ui/hud';
import type { GameAudio, ShotKind } from './audio';
import type { GameDriver, PlayerView } from './driver';
import type { InputSystem } from './input';
import { SoldierPool } from '../render/soldier';
import { NameTags } from '../ui/nameTags';
import { GrenadeRenderer } from '../render/grenades';

export interface GameSettings {
  hFov: number;
  bob: number;
  landingKick: boolean;
  /** Vzhled zbraně (pravidla střelby zůstávají PF-Rifle). */
  weapon?: string;
  /** Násobek citlivosti při míření. */
  adsSens?: number;
}

/**
 * Prezentace hry: pevný simulační krok 60 Hz přes driver (offline / síť), interpolovaný render.
 * Kosmetika (bob, kick, sway) nikdy nemění simulaci ani původ střel.
 */
export class Game {
  readonly cfg: MovementConfig = MOVEMENT;
  private prev: PlayerState | null = null;
  private acc = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private kickT = 1;
  private kickAmp = 0;
  private lastLandSeen = -1;
  fp: FPWeapon | FPItem;
  private fpId: string;
  readonly effects: Effects;
  readonly hud: Hud;
  readonly soldiers: SoldierPool;
  readonly nades: GrenadeRenderer;
  /** Otřes kamery (výbuch v blízkosti) 0–1. */
  private shake = 0;
  stats = { simSteps: 0, droppedSteps: 0 };
  settings: GameSettings = { hFov: CAMERA.hFovDeg16x9, bob: 1, landingKick: true };
  active = false;
  private hudT = 0;
  private now = 0;
  private lastEye = new THREE.Vector3();
  onDeath: () => void = () => {};
  onSpawned: () => void = () => {};
  onLeave: () => void = () => {};
  /** Fyzika pro viditelnost (identifikace nepřítele ne přes zeď). */
  phys: PhysicsWorld | null = null;
  /** Taktická mapa (podklad z půdorysů objektů; jednou na hru). */
  map: TacticalMap | null = null;
  private identT = 0;
  private identId: string | null = null;
  private callMedicAt = -10;
  /** Puškohled: prolnutí pohledu do zaměřovače (0 = zbraň, 1 = obraz puškohledu). */
  private scopeBlend = 0;
  private scope: ScopeView | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    readonly input: InputSystem,
    readonly driver: GameDriver,
    private world: WorldView,
    private scene: THREE.Scene,
    private doc: MapDocument,
    private audio: GameAudio,
    private quality: QualityProfile,
    weaponId = 'm4a1',
  ) {
    this.fpId = weaponId;
    this.fp = this.makeFp(weaponId);
    this.effects = new Effects(quality.maxDecals);
    scene.add(this.effects.root);
    this.soldiers = new SoldierPool(quality.id);
    scene.add(this.soldiers.root);
    this.nades = new GrenadeRenderer(quality.id === 'low' ? 220 : 420);
    scene.add(this.nades.root);
    this.hud = new Hud();
    this.hud.reset();
    this.hud.onSpawn = (id, weaponId) => {
      const err = this.driver.requestSpawn(id, weaponId);
      if (!err) this.onSpawned();
      return err;
    };
    this.hud.onRestart = () => this.driver.restart();
    // Prostorový zvuk HRTF je náročnější – na nízké kvalitě levnější stereo.
    this.audio.hrtf = this.quality.id !== 'low';
    this.hud.onGiveUp = () => this.driver.giveUp();
    this.hud.onLeave = () => this.onLeave();
    this.hud.onCallMedic = () => {
      // Volání medika = rádiová zpráva (jen síť; offline nejsou spoluhráči). Omezeno na 1× za 5 s.
      if (this.now - this.callMedicAt < 5) return;
      this.callMedicAt = this.now;
      const nd = this.net;
      if (nd) nd.net.send({ t: 'radio', id: 'medic' });
      this.hud.system(t('downed.called'), this.now);
    };
    const nd = this.net;
    if (nd) {
      const prev = nd.onReject;
      nd.onReject = (what, reason) => {
        prev(what, reason);
        if (what === 'spawn') {
          this.input.releaseLock();
          this.hud.deploy.reject(reason);
        }
      };
    }
  }

  private get net(): NetDriver | null {
    return this.driver.mode === 'network' ? (this.driver as unknown as NetDriver) : null;
  }

  /** Taktická mapa z půdorysů viditelných objektů (sdílí nasazení, minimapa, velitel). */
  buildMap(footprints: Footprint[]) {
    this.map = new TacticalMap(this.doc, footprints);
  }

  private kits(): Kit[] {
    const r = this.net?.net.welcome?.rules;
    if (r) return r.kits;
    return this.driver.conquest() ? PILOT.kits : PILOT.kits;
  }

  /** Kontextová interakce: medik u vyřazeného spoluhráče. */
  /** Popisek klávesy slotu (přemapování se projeví i v nápovědě). */
  slotKey: (slot: number) => string = (s) => String(s);

  /**
   * Kontextová výzva podle aktivní položky: medik u vyřazeného spolubojovníka (defibrilátor /
   * jak ho vzít), léčení a zásobování – jen nápověda, výsledek rozhoduje server.
   */
  private interaction() {
    const me = this.driver.local();
    if (!me?.alive || !me.inv) return null;
    const active = me.inv.items.find((i) => i.slot === me.inv!.active);
    const near = (pred: (r: PlayerView) => boolean, range = 2.4) => {
      let best: { name: string; d: number } | null = null;
      for (const r of this.driver.remotes()) {
        if (r.team !== me.team || !pred(r)) continue;
        const d = Math.hypot(r.state.pos.x - me.state.pos.x, r.state.pos.z - me.state.pos.z);
        if (d <= range && Math.abs(r.state.pos.y - me.state.pos.y) < 1.5 && (!best || d < best.d)) best = { name: r.name, d };
      }
      return best;
    };
    const defib = me.inv.items.find((i) => i.kind === 'defib');
    if (defib) {
      const down = near((r) => r.life === 'downed');
      if (down) return { text: active?.kind === 'defib' ? t('hud.revive', { name: down.name }) : t('hud.defibHint', { key: this.slotKey(defib.slot), name: down.name }), progress: 0 };
    }
    if (active?.kind === 'medkit') {
      const hurt = near((r) => r.alive && r.hp < 100);
      return { text: hurt ? t('hud.heal', { name: hurt.name }) : me.hp < 100 ? t('hud.healSelf') : t('hud.healNone'), progress: 0 };
    }
    if (active?.kind === 'ammo') {
      const mate = near((r) => r.alive);
      return { text: mate ? t('hud.resupply', { name: mate.name }) : t('hud.resupplySelf'), progress: 0 };
    }
    return null;
  }

  /** Identifikace nepřítele: po 0,6 s souvislého zamíření, jen při přímé viditelnosti. */
  private identify(dt: number): string | null {
    const me = this.driver.local();
    if (!me?.alive) {
      this.identId = null;
      return null;
    }
    const eye = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const smokes = this.driver.grenades().filter((n) => n.kind === 'smoke' && n.smokeUntil > this.simTime).map((n) => new THREE.Vector3(n.pos.x, n.pos.y + 1.6, n.pos.z));
    let best: { id: string; name: string; d: number } | null = null;
    for (const r of this.driver.remotes()) {
      if (!r.alive || r.team === me.team) continue;
      const c = new THREE.Vector3(r.state.pos.x, r.state.pos.y + r.state.height * 0.6, r.state.pos.z).sub(eye);
      const d = c.length();
      if (d > 120 || d < 0.5) continue;
      const along = c.dot(fwd);
      if (along <= 0) continue;
      const off = Math.sqrt(Math.max(0, d * d - along * along));
      if (off > 0.5 + d * 0.01) continue;
      if (this.phys) {
        const hit = this.phys.castRay({ x: eye.x, y: eye.y, z: eye.z }, { x: c.x / d, y: c.y / d, z: c.z / d }, d - 0.6);
        if (hit) continue;
      }
      // Kouřová clona zakryje identifikaci (úsečka oko → cíl prochází koulí kouře).
      if (smokes.some((s) => segmentHitsSphere(eye, c, d, s, 4.5))) continue;
      if (!best || d < best.d) best = { id: r.id, name: r.name, d };
    }
    if (!best || best.id !== this.identId) {
      this.identId = best?.id ?? null;
      this.identT = 0;
      return null;
    }
    this.identT += dt;
    return this.identT >= 0.6 ? best.name : null;
  }

  /** Zbraň v první osobě podle výbavy (přestaví se, když server potvrdí jinou zbraň). */
  private makeFp(weaponId: string) {
    // Ruce podle nositele (frakce + classa primární zbraně), ne podle aktivní položky.
    const prim = this.driver.local()?.primary;
    const hands = prim ? weaponDef(prim).hands : null;
    // Nestřelné položky (nůž, granáty, nástroje) mají vlastní zobrazení s rukama.
    if (isItemModel(weaponId)) {
      const it = new FPItem(weaponId, hands ?? 'usmcAssault', this.quality.id);
      it.onMech = (k) => (weaponId === 'knife' ? this.audio.handle('knife') : this.audio.mech(k));
      this.camera.add(it.root);
      return it;
    }
    const fp = new FPWeapon(weaponId, hands, this.quality.id);
    fp.showCasings = this.quality.id !== 'low';
    fp.onMech = (k) => this.audio.mech(k);
    fp.onShot = () => this.audio.shot(shotKind(weaponId));
    this.camera.add(fp.root);
    return fp;
  }

  get simTime() {
    return this.driver.time();
  }

  /** Posune simulaci o reálný čas snímku; omezený backlog (žádné nekonečné dohánění). */
  update(frameDt: number) {
    this.now += frameDt;
    const dt = 1 / this.cfg.tickRate;
    this.acc += Math.min(frameDt, 0.25);
    let steps = 0;
    while (this.acc >= dt) {
      if (steps >= this.cfg.maxCatchUpSteps) {
        this.stats.droppedSteps += Math.floor(this.acc / dt);
        this.acc = 0;
        break;
      }
      const me = this.driver.local();
      this.prev = me ? clonePlayerState(me.state) : null;
      const raw = this.input.consumeTick(me?.state.tick ?? 0);
      // V menu / mrtvý: žádné bojové akce, jen pohled zůstává.
      if (me?.spectator && this.active) {
        if (raw.pressed & BTN.FIRE) this.specIndex++;
        if (raw.pressed & BTN.ADS) this.specIndex--;
      }
      // Stisk spouště naprázdno: cvaknutí a drobné škubnutí zbraně (munice se sama nedoplní).
      if (this.active && me?.alive && raw.pressed & BTN.FIRE && me.weapon.mag <= 0 && me.weapon.action === 'idle' && this.fp instanceof FPWeapon) {
        this.fp.dryFire();
        this.audio.click();
      }
      const input = this.active && me?.alive ? raw : { ...raw, held: 0, pressed: 0, slot: 0, moveX: 0, moveZ: 0, lookDYaw: me?.alive ? raw.lookDYaw : 0, lookDPitch: me?.alive ? raw.lookDPitch : 0 };
      // Volba výbavy: overlay hned ukáže požadovanou položku, server přechod potvrdí.
      if (input.slot && me?.inv) this.hud.slots.request(resolveView(me.inv, input.slot), this.now);
      this.driver.step(input);
      this.acc -= dt;
      steps++;
      this.stats.simSteps++;
    }
    this.processEvents();
    this.world.updateDummies(this.driver.dummies());
    this.soldiers.update(this.driver.remotes(), frameDt, this.simTime, this.camera.position, this.camera);
    this.updateCamera(frameDt, this.acc / dt);
    this.soldiers.fullRate = this.scopeBlend > 0.5;
    {
      const me = this.driver.local();
      const sq = this.net?.squads.find((s) => me && s.members.includes(me.id));
      this.tags.update(
        this.driver.remotes().filter((r) => r.team === me?.team).map((r) => ({ id: r.id, name: r.name, alive: r.alive, x: r.state.pos.x, y: r.state.pos.y, z: r.state.pos.z, height: r.state.height, squad: !!sq?.members.includes(r.id) })),
        this.camera,
        this.now,
        !!me?.alive && !me.spectator,
      );
    }
    this.updateSounds();
    this.effects.update(frameDt);
    this.nades.sync(this.driver.grenades(), this.simTime, frameDt);
    this.nades.update(frameDt);
    this.hudT += frameDt;
    if (this.hudT > 0.05) {
      const hdt = this.hudT;
      this.hudT = 0;
      const me = this.driver.local();
      const nd = this.net;
      this.hud.update({
        now: this.now,
        me,
        team: me?.team ?? 'teamA',
        cq: this.driver.conquest(),
        doc: this.doc,
        simTime: this.simTime,
        spawns: me ? this.driver.spawnOptions() : [],
        faction: this.driver.faction(),
        kits: this.kits(),
        remotes: this.driver.remotes(),
        map: this.map,
        squads: nd?.squads ?? [],
        contacts: nd?.contacts ?? [],
        order: nd?.order ?? null,
        interaction: this.interaction(),
        identified: this.identify(hdt),
        extraTabs: this.extraTabs,
        network: !!nd,
        nextRound: nd?.nextRound ?? 0,
        spectating: this.specName,
      });
    }
  }

  /** Doplňkové záložky nasazení (četa, velitel) – nastavuje aplikace. */
  extraTabs: Array<{ id: string; label: string; view: () => HTMLElement; full?: boolean }> = [];

  // ---------------- zvuk ve světě ----------------

  private fwd = new THREE.Vector3();
  private tags = new NameTags(document.getElementById('hud') ?? document.body, () => this.phys);
  private punchPitch = 0;
  private punchRoll = 0;
  private steps = new Map<string, { x: number; z: number; acc: number; air: boolean }>();
  private reloadCue = { key: '', done: 0 };
  private lastItem = '';

  /** Zdroj zvuku je za zdí (přímka od kamery ke zdroji narazí na svět). */
  private occluded(p: { x: number; y: number; z: number }): boolean {
    if (!this.phys) return false;
    const e = this.camera.position;
    const v = { x: p.x - e.x, y: p.y - e.y, z: p.z - e.z };
    const d = Math.hypot(v.x, v.y, v.z);
    if (d < 1.5) return false;
    return !!this.phys.castRay({ x: e.x, y: e.y, z: e.z }, { x: v.x / d, y: v.y / d, z: v.z / d }, d - 0.8);
  }

  private posOf(id: string) {
    const r = this.driver.remotes().find((x) => x.id === id);
    return r ? { x: r.state.pos.x, y: r.state.pos.y + 1, z: r.state.pos.z } : null;
  }

  /** Povrch pod nohama (materiál kolize nebo terén). */
  private surfaceUnder(p: { x: number; y: number; z: number }): string {
    const hit = this.phys?.castRay({ x: p.x, y: p.y + 0.4, z: p.z }, { x: 0, y: -1, z: 0 }, 1.2);
    return hit?.surface ?? 'sand';
  }

  /** Kroky podle ujeté dráhy a povrchu (vlastní i cizí do 40 m), posluchač a zvuky přebíjení. */
  private updateSounds() {
    this.camera.getWorldDirection(this.fwd);
    this.audio.setListener(this.camera.position, this.fwd);
    const me = this.driver.local();
    const seen = new Set<string>();
    const walk = (id: string, v: PlayerView, own: boolean) => {
      seen.add(id);
      const s = v.state;
      let st = this.steps.get(id);
      if (!st) this.steps.set(id, (st = { x: s.pos.x, z: s.pos.z, acc: 0, air: false }));
      const d = Math.hypot(s.pos.x - st.x, s.pos.z - st.z);
      st.x = s.pos.x;
      st.z = s.pos.z;
      if (!v.alive || d > 3) {
        st.acc = 0;
        return;
      }
      const pos = own ? null : { x: s.pos.x, y: s.pos.y + 0.1, z: s.pos.z };
      if (!s.grounded && !s.ladder) {
        st.air = true;
        return;
      }
      if (st.air) {
        st.air = false;
        const surf = this.surfaceUnder(s.pos);
        this.audio.land(surf, pos);
        this.effects.dust(s.pos, surf, 3);
        st.acc = 0;
      }
      st.acc += d;
      const speed = Math.hypot(s.vel.x, s.vel.z);
      const prone = s.stance === 'prone';
      const stride = prone ? 0.9 : s.stance === 'crouch' ? 0.8 : speed > 5 ? 1.35 : 1.0;
      if (st.acc < stride) return;
      st.acc = 0;
      const loud = s.stance === 'crouch' ? 0.3 : speed > 5 ? 1 : 0.6;
      const surface = s.ladder ? 'metal' : this.surfaceUnder(s.pos);
      this.audio.footstep(surface, pos, loud, prone);
      // Prach od nohou při sprintu (u cizích vojáků; vlastní by jen clonil výhled).
      if (!own && speed > 5 && !s.ladder) this.effects.dust(s.pos, surface, 1);
    };
    if (me) walk(this.driver.localId, me, true);
    for (const r of this.driver.remotes()) walk(r.id, r, false);
    for (const id of this.steps.keys()) if (!seen.has(id)) this.steps.delete(id);
    if (!me?.alive) return;
    // Přehození výbavy.
    const item = me.weapon.weaponId ?? '';
    if (item !== this.lastItem) {
      if (this.lastItem) this.audio.handle(item === 'knife' ? 'knifeDraw' : item === 'medkit' || item === 'ammo' ? 'pouch' : 'switch');
      this.lastItem = item;
    }
    // Přebíjení ze zásobníku / pásu: vyjmutí, zasunutí, natažení závěru (ostatní styly hlásí model sám).
    const w = me.weapon;
    if (w.action === 'reload' && !isItemModel(item)) {
      const rr = rulesOf(item);
      const style = rr.pellets || item === 'm24' ? 'own' : rr === PF_MG ? 'belt' : 'magazine';
      if (style === 'magazine' || style === 'belt') {
        const key = `${item}:${w.actionStart}`;
        if (this.reloadCue.key !== key) this.reloadCue = { key, done: 0 };
        const k = (this.simTime - w.actionStart) / Math.max(0.01, w.actionEnd - w.actionStart);
        const cues: Array<[number, 'magOut' | 'magIn' | 'rack' | 'cover']> = style === 'belt' ? [[0.12, 'cover'], [0.55, 'magIn'], [0.82, 'cover'], [0.93, 'rack']] : [[0.2, 'magOut'], [0.62, 'magIn'], ...(w.reloadEmpty ? ([[0.86, 'rack']] as Array<[number, 'rack']>) : [])];
        while (this.reloadCue.done < cues.length && k >= cues[this.reloadCue.done][0]) this.audio.mech(cues[this.reloadCue.done++][1]);
      }
    }
  }

  // ---------------- pozorovatel ----------------

  private specIndex = 0;
  private specName = '';

  /** Kamera za sledovaným hráčem (živí hráči obou týmů, pořadí podle jména). */
  private updateSpectator(frameDt: number): boolean {
    const list = this.driver.remotes().filter((r) => r.alive).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) {
      this.specName = '';
      return false;
    }
    const tg = list[((this.specIndex % list.length) + list.length) % list.length];
    this.specName = tg.name;
    const s = tg.state;
    const head = new THREE.Vector3(s.pos.x, s.pos.y + s.height * 0.9, s.pos.z);
    const back = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const off = back.multiplyScalar(2.8).add(new THREE.Vector3(0, 0.7, 0));
    const len = off.length();
    if (this.phys) {
      const d = off.clone().normalize();
      const hit = this.phys.castRay({ x: head.x, y: head.y, z: head.z }, { x: d.x, y: d.y, z: d.z }, len + 0.3);
      if (hit) off.setLength(Math.max(0.2, hit.distance - 0.3));
    }
    const want = head.clone().add(off);
    this.camera.position.lerp(want, 1 - Math.exp(-frameDt * 10));
    const q = this.camera.quaternion.clone();
    this.camera.lookAt(head.x - Math.sin(s.yaw) * 6, head.y + Math.sin(s.pitch) * 6, head.z - Math.cos(s.yaw) * 6);
    const tq = this.camera.quaternion.clone();
    this.camera.quaternion.copy(q).slerp(tq, 1 - Math.exp(-frameDt * 10));
    return true;
  }

  // ---------------- kamera po vyřazení ----------------

  private killcam: { killer: string; at: number; target: THREE.Vector3; named: boolean } | null = null;

  private startKillcam(killer: string | null) {
    if (!killer || killer === this.driver.localId) {
      this.killcam = null;
      return;
    }
    if (this.killcam?.killer === killer && this.now - this.killcam.at < 20) return; // vyřazení → smrt: kamera pokračuje
    const r = this.driver.remotes().find((x) => x.id === killer);
    this.killcam = { killer, at: this.now, named: false, target: r ? new THREE.Vector3(r.state.pos.x, r.state.pos.y + 1.2, r.state.pos.z) : this.lastEye.clone().add(new THREE.Vector3(0, 0, -5)) };
    this.nameKiller();
  }

  /** Jméno a zbraň přemožitele – server ho oběti odhalí až s dalším snímkem, proto se zkouší opakovaně. */
  private nameKiller() {
    const k = this.killcam;
    if (!k || k.named) return;
    const r = this.driver.remotes().find((x) => x.id === k.killer);
    const name = r?.name ?? this.net?.scores.find((x) => x.id === k.killer)?.name ?? '';
    if (!name) return;
    if (!r && this.now - k.at < 0.5) return; // chvíli počkat na zbraň
    const item = r?.weapon.weaponId ?? r?.primary;
    this.hud.killedBy(this.now, name, item ? (arsenalEntry(item)?.name ?? SIDEARMS[item]?.name ?? '') : '');
    k.named = true;
  }

  /** Kamera se zvedne za místo vyřazení a otočí se na přemožitele (server ho na pár sekund odhalí). */
  private updateKillcam(frameDt: number): boolean {
    const k = this.killcam;
    if (!k || this.now - k.at > 6) return false;
    this.nameKiller();
    const r = this.driver.remotes().find((x) => x.id === k.killer);
    if (r) k.target.lerp(new THREE.Vector3(r.state.pos.x, r.state.pos.y + 1.2, r.state.pos.z), 1 - Math.exp(-frameDt * 8));
    const e = Math.min(1, (this.now - k.at) / 0.9);
    const ease = e * e * (3 - 2 * e);
    const away = this.lastEye.clone().sub(k.target).setY(0);
    if (away.lengthSq() < 0.01) away.set(0, 0, 1);
    away.normalize();
    const off = away.multiplyScalar(2.4 * ease).add(new THREE.Vector3(0, 1.1 * ease, 0));
    // Kamera nesmí projet zdí: zkrátit odstup podle kolize.
    const len = off.length();
    if (this.phys && len > 0.05) {
      const d = off.clone().normalize();
      const hit = this.phys.castRay({ x: this.lastEye.x, y: this.lastEye.y, z: this.lastEye.z }, { x: d.x, y: d.y, z: d.z }, len + 0.3);
      if (hit) off.setLength(Math.max(0, hit.distance - 0.3));
    }
    this.camera.position.copy(this.lastEye).add(off);
    const q = this.camera.quaternion.clone();
    this.camera.lookAt(k.target);
    const want = this.camera.quaternion.clone();
    this.camera.quaternion.copy(q).slerp(want, 1 - Math.exp(-frameDt * 6));
    return true;
  }

  private processEvents() {
    const me = this.driver.local();
    const eye = this.camera.position;
    for (const e of this.driver.takeEvents()) {
      if (e.type === 'shot') {
        if (e.owner === this.driver.localId) {
          /* vlastní zvuk/záblesk už přehrála predikce (FPWeapon.onShot) */
        } else if ((e.pellet ?? 0) > 0) {
          /* další broky téhož výstřelu: jen občas stopovka, zvuk a záblesk jednou */
          if (Math.random() < 0.15) this.effects.tracer(new THREE.Vector3(e.origin.x, e.origin.y, e.origin.z), new THREE.Vector3(e.origin.x + e.dir.x * 25, e.origin.y + e.dir.y * 25, e.origin.z + e.dir.z * 25));
        } else {
          const shooter = this.driver.remotes().find((r) => r.id === e.owner);
          this.audio.shotAt(shotKind(shooter?.weapon.weaponId ?? shooter?.primary), e.origin, this.occluded(e.origin));
          this.soldiers.flash(e.owner);
          // Kouř z hlavně a vyhozená nábojnice do ~45 m (dál nejsou vidět).
          if (Math.hypot(e.origin.x - eye.x, e.origin.z - eye.z) < 45) {
            this.effects.muzzleSmoke(e.origin, e.dir);
            if (shotKind(shooter?.weapon.weaponId ?? shooter?.primary) !== 'shotgun' && this.quality.id !== 'low') this.effects.casing(e.origin, e.dir);
          }
          if (Math.random() < 0.35) this.effects.tracer(new THREE.Vector3(e.origin.x, e.origin.y, e.origin.z), new THREE.Vector3(e.origin.x + e.dir.x * 60, e.origin.y + e.dir.y * 60, e.origin.z + e.dir.z * 60));
        }
      } else if (e.type === 'impact') {
        const p = new THREE.Vector3(e.point.x, e.point.y, e.point.z);
        this.effects.impact(p, new THREE.Vector3(e.normal.x, e.normal.y, e.normal.z), e.surface);
        this.audio.impactAt(e.surface, p);
      } else if (e.type === 'explosion') {
        const p = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
        this.nades.explode(p);
        const d = p.distanceTo(eye);
        this.audio.explosionAt(p, this.occluded(p));
        this.shake = Math.max(this.shake, clamp(1 - d / 22, 0, 1));
      } else if (e.type === 'smoke') {
        this.audio.hissAt(e.pos);
      } else if (e.type === 'defib') {
        if (e.id === this.driver.localId || e.target === this.driver.localId) this.audio.mech(e.target ? 'bolt' : 'shell');
        else this.audio.mech('bolt', this.posOf(e.id));
        if (e.target && e.id === this.driver.localId) this.hud.system(t('sys.revived', { name: this.driver.remotes().find((r) => r.id === e.target)?.name ?? '' }), this.now);
      } else if (e.type === 'throw') {
        this.audio.mech('cover', e.id === this.driver.localId ? null : this.posOf(e.id));
      } else if (e.type === 'fall') {
        // Tvrdý dopad: tupý zvuk a krátké zčervenání okraje obrazu (poškození pádem).
        if (e.id === this.driver.localId) {
          this.audio.land(this.surfaceUnder(me?.state.pos ?? eye), null, true);
          this.audio.hurt(e.damage);
          this.hud.damage(this.now, e.damage);
        }
      } else if (e.type === 'hit') {
        if (e.target === this.driver.localId) {
          this.hud.damage(this.now, e.damage);
          this.audio.hurt(e.damage);
          let side = 0;
          if (e.from && e.owner !== this.driver.localId) {
            this.camera.getWorldDirection(this.fwd);
            const vx = e.from[0] - eye.x, vz = e.from[2] - eye.z;
            const ang = Math.atan2(vx * -this.fwd.z + vz * this.fwd.x, vx * this.fwd.x + vz * this.fwd.z);
            this.hud.damageFrom(this.now, ang);
            side = Math.sin(ang);
          }
          // Škubnutí pohledu po zásahu: krátké, malé (do ~1°), jen kosmetické – míření v simulaci nemění.
          const k = Math.min(1, e.damage / 40);
          this.punchPitch += THREE.MathUtils.degToRad(0.9) * k;
          this.punchRoll += THREE.MathUtils.degToRad(1.1) * k * (side || (Math.random() < 0.5 ? -0.6 : 0.6));
        }
        // Vzdálený voják sebou po zásahu škubne směrem od střelce.
        if (e.target !== this.driver.localId) this.soldiers.hit(e.target, e.from ? { x: e.from[0], z: e.from[2] } : null, Math.min(1, e.damage / 50));
        if (e.owner === this.driver.localId && e.target !== this.driver.localId) {
          const kind = e.hp <= 0 ? 'kill' : e.zone === 'head' ? 'head' : 'body';
          this.hud.hitmarker(this.now, kind);
          this.audio.hitmarker(kind);
        }
      } else if (e.type === 'death') {
        // Jména i hráčů, které zrovna nevidím (server je neposílá) – ze skóre.
        const nm = (id: string) => (id === this.driver.localId ? t('common.you') : (this.driver.remotes().find((r) => r.id === id)?.name ?? this.net?.scores.find((r) => r.id === id)?.name ?? id));
        const victim = nm(e.id);
        const killer = e.killer ? nm(e.killer) : e.cause === 'zone' ? '⚠' : '↓';
        // Jména zbarvená podle týmu (naši modře, nepřátelé červeně), jako kill feed v BF2.
        const teamOf = (id: string | null) => (!id ? null : id === this.driver.localId ? this.driver.local()?.team : (this.driver.remotes().find((r) => r.id === id)?.team ?? this.net?.scores.find((r) => r.id === id)?.team));
        const myTeam = this.driver.local()?.team;
        const span = (text: string, id: string | null) => {
          const s = document.createElement('span');
          s.textContent = text;
          const tm = teamOf(id);
          if (tm && myTeam) s.className = tm === myTeam ? 'own' : 'enemy';
          return s;
        };
        const line = document.createElement('span');
        line.append(span(killer, e.killer), document.createTextNode(' ✕ '), span(victim, e.id));
        this.hud.feed(line, this.now);
        if (e.id === this.driver.localId) {
          this.input.clear();
          this.onDeath();
          this.startKillcam(e.killer);
        }
      } else if (e.type === 'downed') {
        if (e.id === this.driver.localId) this.startKillcam(e.killer);
      } else if (e.type === 'dummyDown') {
        if (me) this.hud.feed('Figurína zasažena ✕', this.now);
      } else if ('kind' in e && e.kind === 'conquest') {
        const ce = e as unknown as { type: string; cp?: string; by?: string; winner?: string };
        const mine = ce.by === this.driver.local()?.team;
        if (ce.type === 'captured') this.hud.system(t(mine ? 'sys.captured' : 'sys.lost', { cp: this.cpName(ce.cp!) }), this.now);
        if (ce.type === 'neutralized') this.hud.system(t('sys.neutral', { cp: this.cpName(ce.cp!) }), this.now);
      }
    }
  }

  private cpName(id: string) {
    return this.doc.controlPoints.find((c) => c.id === id)?.name ?? id;
  }

  private updateCamera(frameDt: number, alpha: number) {
    const me = this.driver.local();
    if (!me) return;
    const s = me.state, w = me.weapon;
    if (!me.alive) {
      // Po smrti: kamera zůstane na posledním místě, zbraň skrytá.
      if (me.spectator ? !this.updateSpectator(frameDt) : !this.updateKillcam(frameDt)) this.camera.position.copy(this.lastEye);
      this.fp.root.visible = false;
      this.hud.setCrosshair(0, false);
      this.scopeBlend = 0;
      this.scope?.update(null, 0, 0);
      return;
    }
    if (w.weaponId !== this.fpId) {
      this.fp.dispose();
      this.fpId = w.weaponId;
      this.fp = this.makeFp(w.weaponId);
    }
    this.fp.root.visible = true;
    const p = this.prev && this.prev.tick < s.tick ? this.prev : s;
    const eyeA = eyePosition(this.cfg, p), eyeB = eyePosition(this.cfg, s);
    const eye = new THREE.Vector3(lerp(eyeA.x, eyeB.x, alpha), lerp(eyeA.y, eyeB.y, alpha), lerp(eyeA.z, eyeB.z, alpha));
    this.lastEye.copy(eye);

    const hs = Math.hypot(s.vel.x, s.vel.z);
    const moving = s.grounded && hs > 0.3;
    const amp = (s.sprinting ? CAMERA.bob.sprintAmp : CAMERA.bob.walkAmp) * clamp(hs / this.cfg.speedForward, 0, 1.5) * this.settings.bob;
    const ads = w.adsProgress;
    const adsBob = 1 + (CAMERA.bob.adsScale - 1) * ads;
    this.bobAmp = lerp(this.bobAmp, moving ? amp * adsBob : 0, 1 - Math.exp(-frameDt * 10));
    this.bobPhase += frameDt * (s.sprinting ? CAMERA.bob.sprintFreq : CAMERA.bob.walkFreq) * Math.PI * 2;
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * this.bobAmp * 0.6;
    if (s.lastLandAt !== this.lastLandSeen) {
      if (this.lastLandSeen >= 0 && this.settings.landingKick) {
        this.kickAmp = Math.min(CAMERA.landingKick.maxOffset, s.lastLandSpeed * 0.004);
        this.kickT = 0;
      }
      this.lastLandSeen = s.lastLandAt;
    }
    this.kickT += frameDt / CAMERA.landingKick.duration;
    const kick = this.kickT < 1 ? Math.sin(Math.PI * this.kickT) * this.kickAmp : 0;

    // Pohled = herní zamíření (myš + zbývající recoil) + ještě nespotřebované delty myši.
    const aim = aimAngles(s, w);
    const yaw = aim.yaw + this.input.pendingYaw;
    const lim = (CAMERA.pitchLimitDeg * Math.PI) / 180;
    const pitch = clamp(aim.pitch + this.input.pendingPitch, -lim, lim);
    const cam = this.camera;
    // Doznění škubnutí po zásahu (pružné, ~0,25 s).
    this.punchPitch *= Math.exp(-frameDt * 11);
    this.punchRoll *= Math.exp(-frameDt * 11);
    cam.rotation.set(pitch + this.punchPitch, yaw, this.punchRoll, 'YXZ');
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    cam.position.copy(eye).addScaledVector(right, bobX);
    cam.position.y += bobY - kick;
    // Otřes po výbuchu: krátké chvění, rychle doznívá (kosmetika, simulaci nemění).
    if (this.shake > 0.001) {
      const a = this.shake * this.shake;
      cam.position.x += (Math.random() - 0.5) * 0.05 * a;
      cam.position.y += (Math.random() - 0.5) * 0.05 * a;
      cam.rotation.z += (Math.random() - 0.5) * 0.03 * a;
      this.shake *= Math.exp(-frameDt * 5);
    }

    // FOV: H@16:9 → vertikální; ADS = optické přiblížení 1,35× (prezentace, ne optika kolimátoru).
    // Puškohled: po dokončení ADS se obraz přepne do zaměřovače se zvětšením optiky; během
    // cyklu závěru, přebití nebo sprintu se vrátí ke zbrani (ruka je na páce).
    const optic = this.fp.model.optic;
    const scoped = optic?.kind === 'scope' && ads > 0.92 && !this.fp.busy && !s.sprinting && w.action !== 'reload';
    this.scopeBlend = THREE.MathUtils.clamp(this.scopeBlend + (scoped ? frameDt / 0.09 : -frameDt / 0.07), 0, 1);
    const zoom = optic?.kind === 'scope' ? lerp(CAMERA.adsZoom, optic.zoom ?? CAMERA.adsZoom, this.scopeBlend) : CAMERA.adsZoom;
    const vHip = vFovFromH16x9(this.settings.hFov);
    const vfov = THREE.MathUtils.radToDeg(lerp(vHip, adsVFov(vHip, zoom), ads));
    this.fp.root.visible = this.scopeBlend < 0.5;
    if (optic?.kind === 'scope') {
      this.scope ??= new ScopeView(document.getElementById('viewport') ?? document.body);
      this.scope.update(optic.reticle ?? 'mildot', this.scopeBlend, vfov);
    } else this.scope?.update(null, 0, 0);
    if (Math.abs(cam.fov - vfov) > 1e-4) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
    // Citlivost klesá se zvětšením (stejný pohyb myši = stejný posun obrazu v puškohledu).
    this.input.adsSensScale = lerp(1, CAMERA.adsSensitivity * (this.settings.adsSens ?? 1) * (CAMERA.adsZoom / zoom), ads);
    // Dynamický zaměřovač z rozptylu (v ADS skrytý).
    const spread = spreadOf(rulesOf(w.weaponId), this.cfg, s, w, this.simTime).total;
    const h = this.camera.userData.viewportHeight ?? window.innerHeight;
    const radius = (h / 2) * (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    this.hud.setCrosshair(radius, ads < 0.5 && !s.sprinting && !s.ladder && this.scopeBlend === 0);
    this.fp.update(frameDt, s, w, this.simTime, this.bobPhase, this.bobAmp, this.input.pendingYaw, this.input.pendingPitch);
    void BTN;
  }

  dispose() {
    this.fp.dispose();
    this.tags.dispose();
    this.effects.dispose();
    this.soldiers.dispose();
    this.nades.dispose();
    this.scope?.dispose();
    this.hud.dispose();
    this.driver.dispose();
    this.world.updateDummies([]);
    void this.scene;
  }
}

/** Prochází úsečka z `a` ve směru `dir` (délka `len`) koulí? */
function segmentHitsSphere(a: THREE.Vector3, dir: THREE.Vector3, len: number, c: THREE.Vector3, r: number) {
  const d = dir.clone().normalize();
  const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(d), 0, len);
  return a.clone().addScaledVector(d, t).distanceToSquared(c) < r * r;
}

/** Druh výstřelu pro zvuk podle zbraně. */
function shotKind(weaponId: string | undefined | null): ShotKind {
  const r = rulesOf(weaponId);
  if (r.pellets) return 'shotgun';
  if (r === PF_MG) return 'mg';
  if (r === PF_SNIPER) return 'sniper';
  if (r === PF_PISTOL) return 'pistol';
  return 'rifle';
}
