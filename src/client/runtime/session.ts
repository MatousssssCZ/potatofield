import type * as THREE from 'three';
import type { MapDocument } from '../../shared/map/schema';
import type { PhysicsWorld } from '../../shared/physics/world';
import type { MaterialLibrary } from '../render/materials';
import { Game, type GameSettings } from './game';
import { InputSystem, type InputSettings } from './input';

/**
 * Jeden běh testovacího režimu. Pracuje s runtime kopií dokumentu – herní
 * dění nikdy nemění autorská data. `dispose()` odebere všechny listenery,
 * collider hráče i model zbraně (opakované přepínání nic nehromadí).
 */
export class PlaySession {
  readonly input: InputSystem;
  readonly game: Game;
  readonly runtimeDoc: MapDocument;

  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.PerspectiveCamera,
    phys: PhysicsWorld,
    mats: MaterialLibrary,
    doc: MapDocument,
    spawn: { position: [number, number, number]; yaw: number },
    inputSettings: InputSettings,
    gameSettings: GameSettings,
    radPerCount: number,
  ) {
    this.runtimeDoc = structuredClone(doc);
    this.input = new InputSystem(canvas);
    this.input.radPerCount = radPerCount;
    this.input.settings = { ...inputSettings };
    this.input.attach();
    this.game = new Game(camera, phys, this.input, mats);
    this.game.settings = { ...gameSettings };
    camera.add(this.game.viewModel.root);
    this.game.spawn(spawn.position, spawn.yaw);
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
