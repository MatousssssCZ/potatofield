import { MOVEMENT, type MovementConfig } from '../src/shared/config/movement';
import { PhysicsWorld } from '../src/shared/physics/world';
import { BTN, emptyInput, type InputFrame } from '../src/shared/sim/input';
import { PlayerController, createPlayerState, type PlayerState } from '../src/shared/sim/player';
import type { ColliderDef } from '../src/world/parts';
import { quatFromEuler } from '../src/shared/math';
import { makeFlatTerrain } from '../src/shared/map/schema';

export async function makeWorld(extra: ColliderDef[] = [], terrain = makeFlatTerrain(400, 400, 2)) {
  const phys = await PhysicsWorld.create();
  // Rovný terén 400×400 m (výškové pole jako ve skutečných mapách), y = 0.
  phys.setTerrain(terrain);
  phys.addColliders(extra);
  return phys;
}

export function box(center: [number, number, number], size: [number, number, number], rotY = 0, rotX = 0): ColliderDef {
  return {
    kind: 'box',
    center: { x: center[0], y: center[1], z: center[2] },
    rotation: quatFromEuler(rotX, rotY, 0),
    half: { x: size[0] / 2, y: size[1] / 2, z: size[2] / 2 },
    surface: 'concrete',
    objectId: 'test',
  };
}

export class Sim {
  ctrl: PlayerController;
  s: PlayerState;
  private prevHeld = 0;
  constructor(phys: PhysicsWorld, pos = { x: 0, y: 0, z: 0 }, yaw = 0, cfg: MovementConfig = MOVEMENT) {
    this.ctrl = new PlayerController(phys, cfg);
    this.s = createPlayerState(cfg, pos, yaw);
    this.ctrl.place(this.s, pos, yaw);
  }
  /** Provede n ticků se stejným drženým vstupem; stisky (edge) se generují ze změny held. */
  run(n: number, f: Partial<InputFrame> = {}) {
    for (let i = 0; i < n; i++) {
      const held = f.held ?? 0;
      const input: InputFrame = {
        ...emptyInput(this.s.tick),
        ...f,
        held,
        pressed: (held & ~this.prevHeld) | (i === 0 ? (f.pressed ?? 0) : 0),
      };
      this.prevHeld = held;
      this.ctrl.step(this.s, input);
    }
  }
  /** Dopadne na zem. */
  settle() {
    this.run(30);
  }
  release() {
    this.run(1);
  }
}

export { BTN };
