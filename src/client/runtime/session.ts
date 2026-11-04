import type * as THREE from 'three';
import type { MapDocument, Team } from '../../shared/map/schema';
import type { PhysicsWorld } from '../../shared/physics/world';
import type { LadderDef } from '../../world/parts';
import type { QualityProfile } from '../render/quality';
import type { WorldView } from '../render/worldView';
import type { GameAudio } from './audio';
import { OfflineDriver, type GameDriver } from './driver';
import { Game, type GameSettings } from './game';
import { InputSystem, type InputSettings } from './input';

export interface SessionOptions {
  conquest: boolean;
  scenarioId?: string;
  team: Team;
  /** Hotový driver (síť); jinak offline. */
  driver?: GameDriver;
}

/**
 * Jeden běh testovacího režimu nad runtime kopií dokumentu – herní dění
 * nikdy nemění autorská data. `dispose()` odebere listenery, collidery hráčů,
 * zbraň, efekty i entity (opakované přepínání nic nehromadí).
 */
export class PlaySession {
  readonly input: InputSystem;
  readonly game: Game;
  readonly runtimeDoc: MapDocument;

  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    phys: PhysicsWorld,
    world: WorldView,
    doc: MapDocument,
    spawn: { position: [number, number, number]; yaw: number },
    ladders: LadderDef[],
    audio: GameAudio,
    quality: QualityProfile,
    inputSettings: InputSettings,
    gameSettings: GameSettings,
    radPerCount: number,
    opts: SessionOptions,
  ) {
    this.runtimeDoc = structuredClone(doc);
    // Testovací spawn může být nahrazen bezpečným bodem jen v runtime kopii.
    this.runtimeDoc.testSpawn = { position: spawn.position, rotation: [0, spawn.yaw, 0] };
    this.input = new InputSystem(canvas);
    this.input.radPerCount = radPerCount;
    this.input.settings = { ...inputSettings };
    this.input.attach();
    const driver = opts.driver ?? new OfflineDriver(phys, this.runtimeDoc, { conquest: opts.conquest, scenarioId: opts.scenarioId, team: opts.team }, ladders);
    this.game = new Game(camera, this.input, driver, world, scene, this.runtimeDoc, audio, quality);
    this.game.settings = { ...gameSettings };
    this.game.onDeath = () => this.input.releaseLock();
    this.game.onSpawned = () => this.input.requestLock();
  }

  update(dt: number) {
    this.game.update(dt);
  }

  dispose() {
    this.input.releaseLock();
    this.input.detach();
    this.game.dispose();
  }
}
