import * as THREE from 'three';
import { CAMERA, vFovFromH16x9 } from '../../shared/config/camera';
import { MOVEMENT, type MovementConfig } from '../../shared/config/movement';
import { clamp, lerp } from '../../shared/math';
import type { PhysicsWorld } from '../../shared/physics/world';
import { PlayerController, clonePlayerState, createPlayerState, eyePosition, type PlayerState } from '../../shared/sim/player';
import type { InputSystem } from './input';
import { ViewModel } from '../render/viewModel';
import type { MaterialLibrary } from '../render/materials';

export interface GameSettings {
  hFov: number;
  bob: number;
  landingKick: boolean;
}

/**
 * Lokální herní běh: pevný simulační krok 60 Hz, interpolovaný render.
 * Simulace je sdílená se serverem (PlayerController), render jen prezentuje.
 */
export class Game {
  readonly cfg: MovementConfig = MOVEMENT;
  readonly ctrl: PlayerController;
  state: PlayerState;
  private prev: PlayerState;
  private acc = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private kickT = 1;
  private kickAmp = 0;
  private lastLandSeen = -1;
  readonly viewModel: ViewModel;
  stats = { simSteps: 0, droppedSteps: 0 };
  settings: GameSettings = { hFov: CAMERA.hFovDeg16x9, bob: 1, landingKick: true };
  active = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    phys: PhysicsWorld,
    private input: InputSystem,
    mats: MaterialLibrary,
  ) {
    this.ctrl = new PlayerController(phys, this.cfg);
    this.state = createPlayerState(this.cfg, { x: 0, y: 0, z: 0 });
    this.prev = clonePlayerState(this.state);
    this.viewModel = new ViewModel(mats);
  }

  spawn(pos: [number, number, number], yaw: number) {
    this.state = createPlayerState(this.cfg, { x: pos[0], y: pos[1], z: pos[2] }, yaw);
    this.ctrl.place(this.state, this.state.pos, yaw);
    this.prev = clonePlayerState(this.state);
    this.acc = 0;
    this.lastLandSeen = -1;
  }

  get simTime() {
    return this.state.tick / this.cfg.tickRate;
  }

  /** Posune simulaci o reálný čas snímku; omezený backlog (žádné nekonečné dohánění). */
  update(frameDt: number) {
    const dt = 1 / this.cfg.tickRate;
    this.acc += Math.min(frameDt, 0.25);
    let steps = 0;
    while (this.acc >= dt) {
      if (steps >= this.cfg.maxCatchUpSteps) {
        this.stats.droppedSteps += Math.floor(this.acc / dt);
        this.acc = 0;
        break;
      }
      this.prev = clonePlayerState(this.state);
      const input = this.active ? this.input.consumeTick(this.state.tick) : { ...this.input.consumeTick(this.state.tick), held: 0, pressed: 0, moveX: 0, moveZ: 0 };
      this.ctrl.step(this.state, input);
      this.acc -= dt;
      steps++;
      this.stats.simSteps++;
    }
    this.updateCamera(frameDt, this.acc / dt);
  }

  private updateCamera(frameDt: number, alpha: number) {
    const s = this.state, p = this.prev;
    const eyeA = eyePosition(this.cfg, p), eyeB = eyePosition(this.cfg, s);
    const eye = new THREE.Vector3(lerp(eyeA.x, eyeB.x, alpha), lerp(eyeA.y, eyeB.y, alpha), lerp(eyeA.z, eyeB.z, alpha));

    // Kosmetický bob (nemění simulaci ani původ střel).
    const hs = Math.hypot(s.vel.x, s.vel.z);
    const moving = s.grounded && hs > 0.3;
    const sprint = s.sprinting;
    const amp = (sprint ? CAMERA.bob.sprintAmp : CAMERA.bob.walkAmp) * clamp(hs / this.cfg.speedForward, 0, 1.5) * this.settings.bob;
    const ads = 1 + (CAMERA.bob.adsScale - 1) * s.adsProgress;
    this.bobAmp = lerp(this.bobAmp, moving ? amp * ads : 0, 1 - Math.exp(-frameDt * 10));
    this.bobPhase += frameDt * (sprint ? CAMERA.bob.sprintFreq : CAMERA.bob.walkFreq) * Math.PI * 2;
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * this.bobAmp * 0.6;

    // Kick při dopadu: max 0,025 m na 0,12 s.
    if (s.lastLandAt !== this.lastLandSeen) {
      if (this.lastLandSeen >= 0 && this.settings.landingKick) {
        this.kickAmp = Math.min(CAMERA.landingKick.maxOffset, s.lastLandSpeed * 0.004);
        this.kickT = 0;
      }
      this.lastLandSeen = s.lastLandAt;
    }
    this.kickT += frameDt / CAMERA.landingKick.duration;
    const kick = this.kickT < 1 ? Math.sin(Math.PI * this.kickT) * this.kickAmp : 0;

    const yaw = s.yaw + this.input.pendingYaw;
    const pitch = clamp(s.pitch + this.input.pendingPitch, -(89 * Math.PI) / 180, (89 * Math.PI) / 180);
    const cam = this.camera;
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    cam.position.copy(eye).addScaledVector(right, bobX);
    cam.position.y += bobY - kick;

    // FOV: zadáno jako horizontální při 16:9 → zachovat vertikální při jiném poměru stran.
    const vfov = THREE.MathUtils.radToDeg(vFovFromH16x9(this.settings.hFov));
    if (Math.abs(cam.fov - vfov) > 1e-4) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
    this.viewModel.update(frameDt, s, this.bobPhase, this.bobAmp, this.input.pendingYaw, this.input.pendingPitch);
  }

  dispose() {
    this.ctrl.dispose();
    this.viewModel.dispose();
  }
}
