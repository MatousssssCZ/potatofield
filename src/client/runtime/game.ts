import * as THREE from 'three';
import { CAMERA, adsVFov, vFovFromH16x9 } from '../../shared/config/camera';
import { MOVEMENT, type MovementConfig } from '../../shared/config/movement';
import { PF_MG } from '../../shared/config/weapon';
import { PILOT, arsenalEntry, rulesOf, type Kit } from '../../shared/config/arsenal';
import type { PhysicsWorld } from '../../shared/physics/world';
import { TacticalMap, type Footprint } from '../ui/tactical';
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
import type { WorldView } from '../render/worldView';
import { Hud } from '../ui/hud';
import type { GameAudio } from './audio';
import type { GameDriver } from './driver';
import type { InputSystem } from './input';
import { SoldierPool } from '../render/soldier';

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
  fp: FPWeapon;
  private fpId: string;
  readonly effects: Effects;
  readonly hud: Hud;
  readonly soldiers: SoldierPool;
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
    this.hud = new Hud();
    this.hud.reset();
    this.hud.onSpawn = (id, weaponId) => {
      const err = this.driver.requestSpawn(id, weaponId);
      if (!err) this.onSpawned();
      return err;
    };
    this.hud.onRestart = () => this.driver.restart();
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
  private interaction() {
    const me = this.driver.local();
    if (!me?.alive || arsenalEntry(me.weapon.weaponId)?.kit !== 'medic') return null;
    let best: { name: string; d: number } | null = null;
    for (const r of this.driver.remotes()) {
      if (r.team !== me.team || r.life !== 'downed') continue;
      const d = Math.hypot(r.state.pos.x - me.state.pos.x, r.state.pos.y - me.state.pos.y, r.state.pos.z - me.state.pos.z);
      if (d <= PILOT.reviveRange && (!best || d < best.d)) best = { name: r.name, d };
    }
    if (!best) return null;
    return { text: me.reviveProgress > 0 ? t('hud.reviving', { name: best.name }) : t('hud.revive', { name: best.name }), progress: me.reviveProgress };
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
    const fp = new FPWeapon(weaponId, null, this.quality.id);
    fp.showCasings = this.quality.id !== 'low';
    fp.onMech = (k) => this.audio.mech(k);
    fp.onShot = () => this.audio.shot(rulesOf(weaponId).pellets ? 'shotgun' : rulesOf(weaponId) === PF_MG ? 'mg' : 'rifle');
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
      const input = this.active && me?.alive ? raw : { ...raw, held: 0, pressed: 0, moveX: 0, moveZ: 0, lookDYaw: me?.alive ? raw.lookDYaw : 0, lookDPitch: me?.alive ? raw.lookDPitch : 0 };
      this.driver.step(input);
      this.acc -= dt;
      steps++;
      this.stats.simSteps++;
    }
    this.processEvents();
    this.world.updateDummies(this.driver.dummies());
    this.soldiers.update(this.driver.remotes(), frameDt, this.simTime, this.camera.position, this.camera);
    this.updateCamera(frameDt, this.acc / dt);
    this.effects.update(frameDt);
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
      });
    }
  }

  /** Doplňkové záložky nasazení (četa, velitel) – nastavuje aplikace. */
  extraTabs: Array<{ id: string; label: string; view: () => HTMLElement; full?: boolean }> = [];

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
          const d = Math.hypot(e.origin.x - eye.x, e.origin.y - eye.y, e.origin.z - eye.z);
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
          const dir = new THREE.Vector3(e.origin.x - eye.x, 0, e.origin.z - eye.z).normalize();
          this.audio.distantShot(d, clamp(dir.dot(right), -1, 1));
          this.soldiers.flash(e.owner);
          if (Math.random() < 0.35) this.effects.tracer(new THREE.Vector3(e.origin.x, e.origin.y, e.origin.z), new THREE.Vector3(e.origin.x + e.dir.x * 60, e.origin.y + e.dir.y * 60, e.origin.z + e.dir.z * 60));
        }
      } else if (e.type === 'impact') {
        const p = new THREE.Vector3(e.point.x, e.point.y, e.point.z);
        this.effects.impact(p, new THREE.Vector3(e.normal.x, e.normal.y, e.normal.z), e.surface);
        this.audio.impact(e.surface, p.distanceTo(eye));
      } else if (e.type === 'fall') {
        // Tvrdý dopad: tupý zvuk a krátké zčervenání okraje obrazu (poškození pádem).
        if (e.id === this.driver.localId) {
          this.audio.impact('dirt', 0);
          this.hud.damage(this.now, e.damage);
        }
      } else if (e.type === 'hit') {
        if (e.target === this.driver.localId) this.hud.damage(this.now, e.damage);
        if (e.owner === this.driver.localId) {
          this.hud.hitmarker(this.now);
          this.audio.hitmarker();
        }
      } else if (e.type === 'death') {
        const nm = (id: string) => (id === this.driver.localId ? t('common.you') : (this.driver.remotes().find((r) => r.id === id)?.name ?? id));
        const victim = nm(e.id);
        const killer = e.killer ? nm(e.killer) : e.cause === 'zone' ? '⚠' : '↓';
        this.hud.feed(`${killer} ✕ ${victim}`, this.now);
        if (e.id === this.driver.localId) {
          this.input.clear();
          this.onDeath();
        }
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
      this.camera.position.copy(this.lastEye);
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
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    cam.position.copy(eye).addScaledVector(right, bobX);
    cam.position.y += bobY - kick;

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
    this.effects.dispose();
    this.soldiers.dispose();
    this.scope?.dispose();
    this.hud.dispose();
    this.driver.dispose();
    this.world.updateDummies([]);
    void this.scene;
  }
}
