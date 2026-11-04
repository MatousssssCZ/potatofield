import * as THREE from 'three';
import type { PlayerState } from '../../shared/sim/player';
import type { Part } from '../../world/parts';
import { buildObjectGeometry } from './geometry';
import type { MaterialLibrary } from './materials';

/**
 * DOČASNÝ placeholder pušky v první osobě (krok 1). Skutečná 3D geometrie
 * v metrech, ne sprite. Finální PF-Rifle s rukama, attachment body a ADS
 * přes mířidla přijde v kroku 6 podle zadání pohybu.
 */
export function placeholderRifleParts(): Part[] {
  const P = (shape: Part['shape'], pos: [number, number, number], size: [number, number, number], material: string, rot?: [number, number, number]): Part => ({
    shape,
    pos,
    size,
    material,
    rot,
    castShadow: false,
  });
  const barrelRot: [number, number, number] = [Math.PI / 2, 0, 0];
  return [
    P('box', [0, 0, 0], [0.058, 0.085, 0.3], 'gunMetal'), // tělo
    P('box', [0, 0.05, -0.02], [0.03, 0.016, 0.26], 'gunMetal'), // lišta
    P('box', [0, -0.002, -0.27], [0.064, 0.07, 0.24], 'gunPolymer'), // předpažbí
    P('cylinder', [0, 0.012, -0.5], [0.02, 0.26, 0.02], 'gunMetal', barrelRot), // hlaveň
    P('cylinder', [0, 0.012, -0.645], [0.03, 0.05, 0.03], 'gunMetal', barrelRot), // tlumič plamene
    P('box', [0, 0.065, -0.375], [0.008, 0.045, 0.012], 'gunMetal'), // muška
    P('box', [0, 0.045, -0.385], [0.03, 0.02, 0.02], 'gunMetal'), // základna mušky
    P('box', [-0.009, 0.072, 0.1], [0.006, 0.026, 0.02], 'gunMetal'), // hledí L
    P('box', [0.009, 0.072, 0.1], [0.006, 0.026, 0.02], 'gunMetal'), // hledí P
    P('box', [0, 0.062, 0.1], [0.03, 0.01, 0.024], 'gunMetal'),
    P('box', [0, -0.11, -0.07], [0.03, 0.15, 0.075], 'gunMetal', [-0.25, 0, 0]), // zásobník
    P('box', [0, -0.09, 0.09], [0.034, 0.11, 0.045], 'gunPolymer', [0.35, 0, 0]), // pažbička
    P('box', [0, -0.015, 0.29], [0.045, 0.095, 0.24], 'gunPolymer', [0.06, 0, 0]), // pažba
    P('box', [0, -0.03, 0.415], [0.05, 0.13, 0.025], 'gunMetal'), // botka
    P('box', [0.031, 0.015, 0.03], [0.004, 0.03, 0.07], 'gunMetal'), // okno vyhazování
  ];
}

export class ViewModel {
  readonly root = new THREE.Group();
  private rifle = new THREE.Group();
  private swayX = 0;
  private swayY = 0;
  private sprintBlend = 0;
  private stanceBlend = 0;

  constructor(mats: MaterialLibrary) {
    const geo = buildObjectGeometry(placeholderRifleParts());
    for (const [key, { geometry }] of geo.byMaterial) {
      const m = new THREE.Mesh(geometry, mats.get(key.split('|')[0]));
      m.castShadow = false;
      m.receiveShadow = false;
      this.rifle.add(m);
    }
    this.rifle.position.set(0.17, -0.19, -0.42);
    this.rifle.rotation.set(0.0, 0.035, 0);
    this.root.add(this.rifle);
    this.root.name = 'viewModel';
    this.root.renderOrder = 10;
  }

  update(dt: number, s: PlayerState, bobPhase: number, bobAmp: number, lookYaw: number, lookPitch: number) {
    const k = 1 - Math.exp(-dt * 12);
    // Sway z pohybu myši (kosmetický, nemění zamíření).
    this.swayX = THREE.MathUtils.lerp(this.swayX, THREE.MathUtils.clamp(lookYaw * 4, -0.05, 0.05), k);
    this.swayY = THREE.MathUtils.lerp(this.swayY, THREE.MathUtils.clamp(lookPitch * 4, -0.05, 0.05), k);
    this.sprintBlend = THREE.MathUtils.lerp(this.sprintBlend, s.sprinting ? 1 : 0, 1 - Math.exp(-dt * 10));
    this.stanceBlend = THREE.MathUtils.lerp(this.stanceBlend, s.height < 1 ? 1 : 0, 1 - Math.exp(-dt * 8));
    const r = this.rifle;
    r.position.set(
      0.17 + this.swayX * 0.4 + Math.cos(bobPhase) * bobAmp * 1.5 - this.sprintBlend * 0.06,
      -0.19 + this.swayY * 0.3 + Math.sin(bobPhase * 2) * bobAmp * 1.2 - this.sprintBlend * 0.04 + this.stanceBlend * 0.02,
      -0.42 + this.sprintBlend * 0.04,
    );
    r.rotation.set(-this.sprintBlend * 0.35 + this.swayY, 0.035 + this.sprintBlend * 0.75 + this.swayX, this.sprintBlend * 0.25 + this.stanceBlend * -0.08);
  }

  dispose() {
    this.root.traverse((c) => {
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    });
    this.root.removeFromParent();
  }
}
