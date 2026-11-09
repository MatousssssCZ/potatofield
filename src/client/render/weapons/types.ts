import * as THREE from 'three';

/**
 * Společné typy programových zbraní. Konvence: metry, zbraň míří k −Z, +Y nahoru, +X pravá strana.
 * Každý model má vlastní kořen (popsaný v generátoru) a pojmenované body.
 */
export interface WeaponPoints {
  weaponRoot: THREE.Vector3;
  muzzle: THREE.Vector3;
  sightRear: THREE.Vector3;
  sightFront: THREE.Vector3;
  /** Poloha oka v ADS (u mechanických mířidel = hledí + odstup oka). */
  opticEye: THREE.Vector3;
  opticAxis: THREE.Vector3;
  gripRight: THREE.Vector3;
  gripLeft: THREE.Vector3;
  magazineSocket: THREE.Vector3;
  ejectionPort: THREE.Vector3;
  chargingHandle: THREE.Vector3;
  boltCatch: THREE.Vector3;
  /** Pásové zbraně: zadní konec podávacího víka (cíl ruky) a vstup pásu na podávací lůžko. */
  feedCover?: THREE.Vector3;
  feedEntry?: THREE.Vector3;
  /** Pumpovací brokovnice: úchop levé ruky na pumpě a nabíjecí otvor (spodní strana pouzdra). */
  pumpGrip?: THREE.Vector3;
  loadingPort?: THREE.Vector3;
}

export type WeaponMaterial = 'metal' | 'polymer';

export interface MovingPart {
  geometry: THREE.BufferGeometry;
  material: WeaponMaterial;
  pivot: THREE.Vector3;
  /** Směr a délka zdvihu natahovací páky (prostor zbraně). */
  travel?: THREE.Vector3;
}

export interface WeaponModel {
  id: string;
  name: string;
  /** Statické díly sloučené podle materiálu (dřevo = „polymer“ materiál s barvou vrcholů dřeva). */
  static: Record<WeaponMaterial, THREE.BufferGeometry>;
  /** feedCover: pivot = závěs víka vpředu, otevírá se rotací kolem X (zadní konec nahoru). */
  /** pump: posuvné předpažbí (travel = zdvih dozadu). U nabíjení po jednom je `magazine` volný náboj v ruce. */
  moving: { magazine: MovingPart; chargingHandle?: MovingPart; feedCover?: MovingPart; pump?: MovingPart };
  /**
   * Optika: kolimátor (Assault, bez zvětšení, tečka v nekonečnu) nebo puškohled (Sniper):
   * zvětšení `zoom`, záměrná osnova `reticle`; obraz v zaměřovači kreslí hra přes celou obrazovku.
   */
  optic?: { lensZ: number; axisY: number; innerR: number; glass: THREE.BufferGeometry; kind?: 'reddot' | 'scope'; zoom?: number; reticle?: 'mildot' | 'pso1' };
  sight: 'optic' | 'iron';
  points: WeaponPoints;
  /** Hip póza kořene zbraně v prostoru pohledu. */
  hipRoot: THREE.Vector3;
  hipRot: THREE.Euler;
  /** Přebití: zásobník se při vyjmutí naklápí dopředu (AK) místo rovného tahu (AR). */
  magRock: number;
  /** Prázdné přebití: záchyt závěru (AR) nebo natažení páky závěru (AK, bullpup). */
  emptyAction: 'boltCatch' | 'chargingHandle' | 'pump' | 'bolt';
  /** Způsob přebití: výměna zásobníku, nebo pás (otevřít víko → schránka → pás na lůžko → zavřít víko). */
  /** 'bolt' = opakovačka: otevřít závěr, náboje po jednom do okna, zavřít závěr. */
  reloadStyle: 'magazine' | 'belt' | 'single' | 'bolt';
  /** Cyklus po výstřelu: pumpa nebo závěr (ruční), jinak samočinně. */
  cycle: 'none' | 'pump' | 'bolt';
  /** Strana, kam odchází schránka/zásobník při přebití (+1 vpravo, −1 vlevo, 0 dolů). */
  magSide: number;
  /** Pistole: závěr (chargingHandle) při výstřelu cykluje a po posledním náboji zůstane vzadu. */
  slideCycle?: boolean;
  triangles: number;
}

/** Referenční úchop M4A1 v pohledu: ostatní modely kladou hip pózu tak, aby rukojeť ležela na stejném místě. */
export const REF_GRIP_VIEW = new THREE.Vector3(0.16, -0.228, -0.294);

export function hipFromGrip(gripRight: THREE.Vector3, adjust: [number, number, number] = [0, 0, 0]): THREE.Vector3 {
  return REF_GRIP_VIEW.clone().sub(gripRight).add(new THREE.Vector3(...adjust));
}

export function triCount(...gs: Array<THREE.BufferGeometry | undefined>) {
  let t = 0;
  for (const g of gs) if (g) t += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
  return Math.round(t);
}

/** Paleta sdílená napříč modely (tóny v rámci dvou materiálů). */
export const PAL = {
  metal: '#3b3d40',
  metalDark: '#2a2b2d',
  metalWorn: '#5a5c5e',
  blued: '#2c2e31',
  polymer: '#262626',
  polymerGrip: '#1f1f1f',
  polymerPla: '#2b2c29',
  mag: '#4b4c4a',
  magSteel: '#34363a',
  optic: '#1d1e1f',
  woodAkm: '#6a4128',
  woodAkmDark: '#57341f',
  woodT81: '#8a5530',
  woodT81Dark: '#744526',
  bakelite: '#5a2c1c',
};
