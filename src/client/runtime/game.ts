import * as THREE from 'three';
import { CAMERA, adsVFov, vFovFromH16x9 } from '../../shared/config/camera';
import { MOVEMENT, type MovementConfig } from '../../shared/config/movement';
import { PF_RIFLE } from '../../shared/config/weapon';
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
  readonly fp: FPWeapon;
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

  constructor(
    private camera: THREE.PerspectiveCamera,
    readonly input: InputSystem,
    readonly driver: GameDriver,
    private world: WorldView,
    private scene: THREE.Scene,
    private doc: MapDocument,
    private audio: GameAudio,
    quality: QualityProfile,
  ) {
    this.fp = new FPWeapon('usmcAssault', quality.id);
    this.fp.showCasings = quality.id !== 'low';
    this.fp.onShot = () => this.audio.shot();
    camera.add(this.fp.root);
    this.effects = new Effects(quality.maxDecals);
    scene.add(this.effects.root);
    this.soldiers = new SoldierPool(quality.id);
    scene.add(this.soldiers.root);
    this.hud = new Hud();
    this.hud.reset();
    this.hud.onSpawn = (id) => {
      const err = this.driver.requestSpawn(id);
      if (err) this.hud.feed(`Spawn odmítnut: ${err}`, this.now);
      else this.onSpawned();
    };
    this.hud.onRestart = () => this.driver.restart();
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
    this.soldiers.update(this.driver.remotes(), frameDt, this.simTime);
    this.updateCamera(frameDt, this.acc / dt);
    this.effects.update(frameDt);
    this.hudT += frameDt;
    if (this.hudT > 0.05) {
      this.hudT = 0;
      const me = this.driver.local();
      this.hud.update(this.now, me, this.driver.conquest(), this.doc, this.simTime, me && !me.alive ? this.driver.spawnOptions() : []);
    }
  }

  private processEvents() {
    const me = this.driver.local();
    const eye = this.camera.position;
    for (const e of this.driver.takeEvents()) {
      if (e.type === 'shot') {
        if (e.owner === this.driver.localId) {
          /* vlastní zvuk/záblesk už přehrála predikce (FPWeapon.onShot) */
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
      } else if (e.type === 'hit') {
        if (e.owner === this.driver.localId) {
          this.hud.hitmarker(this.now);
          this.audio.hitmarker();
        }
      } else if (e.type === 'death') {
        const victim = e.id === this.driver.localId ? 'Ty' : e.id;
        const killer = e.killer ? (e.killer === this.driver.localId ? 'Ty' : e.killer) : e.cause === 'zone' ? 'zóna' : 'pád';
        this.hud.feed(`${killer} ✕ ${victim}`, this.now);
        if (e.id === this.driver.localId) {
          this.input.clear();
          this.onDeath();
        }
      } else if (e.type === 'dummyDown') {
        if (me) this.hud.feed('Figurína zasažena ✕', this.now);
      } else if ('kind' in e && e.kind === 'conquest') {
        const ce = e as unknown as { type: string; cp?: string; by?: string; winner?: string };
        if (ce.type === 'captured') this.hud.feed(`Bod ${this.cpName(ce.cp!)} zabral ${ce.by === 'teamA' ? 'tým A' : 'tým B'}`, this.now);
        if (ce.type === 'neutralized') this.hud.feed(`Bod ${this.cpName(ce.cp!)} neutralizován`, this.now);
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
      return;
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
    const vHip = vFovFromH16x9(this.settings.hFov);
    const vfov = THREE.MathUtils.radToDeg(lerp(vHip, adsVFov(vHip, CAMERA.adsZoom), ads));
    if (Math.abs(cam.fov - vfov) > 1e-4) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
    this.input.adsSensScale = lerp(1, CAMERA.adsSensitivity, ads);
    // Dynamický zaměřovač z rozptylu (v ADS skrytý).
    const spread = spreadOf(PF_RIFLE, this.cfg, s, w, this.simTime).total;
    const h = this.camera.userData.viewportHeight ?? window.innerHeight;
    const radius = (h / 2) * (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    this.hud.setCrosshair(radius, ads < 0.5 && !s.sprinting && !s.ladder);
    this.fp.update(frameDt, s, w, this.simTime, this.bobPhase, this.bobAmp, this.input.pendingYaw, this.input.pendingPitch);
    void BTN;
  }

  dispose() {
    this.fp.dispose();
    this.effects.dispose();
    this.soldiers.dispose();
    this.driver.dispose();
    this.world.updateDummies([]);
    void this.scene;
  }
}
