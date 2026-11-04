import * as THREE from 'three';
import { bevelBox, crossProfile, curvedMag, fwd, lathe, merge, plainBox, roundedRect, sideProfile, transform, tube, type P2 } from './meshkit';

/**
 * M4A1 (USMC Assault) – programový model v pevné sestavě: pevná pažba v jedné poloze,
 * kulaté předpažbí, blok přední mušky, tubusový kolimátor na nízké montáži horní lišty.
 * Rozměry: umělecký odhad podle veřejně známých proporcí (viz docs/weapons/M4A1.md),
 * ne ověřené výkresové míry.
 *
 * Kořen zbraně: z = 0 u zadní hrany šachty zásobníku, y = 0 na dělicí rovině pouzder.
 */
export interface WeaponPoints {
  weaponRoot: THREE.Vector3;
  muzzle: THREE.Vector3;
  sightRear: THREE.Vector3;
  sightFront: THREE.Vector3;
  opticEye: THREE.Vector3;
  opticAxis: THREE.Vector3;
  gripRight: THREE.Vector3;
  gripLeft: THREE.Vector3;
  magazineSocket: THREE.Vector3;
  ejectionPort: THREE.Vector3;
  chargingHandle: THREE.Vector3;
  boltCatch: THREE.Vector3;
}

export interface WeaponModel {
  name: string;
  /** Statické díly sloučené podle materiálu. */
  static: Record<'metal' | 'polymer', THREE.BufferGeometry>;
  /** Pohyblivé díly (vlastní mesh). */
  moving: Record<string, { geometry: THREE.BufferGeometry; material: 'metal' | 'polymer'; pivot: THREE.Vector3 }>;
  optic?: { lensZ: number; axisY: number; innerR: number; glass: THREE.BufferGeometry };
  points: WeaponPoints;
  triangles: number;
}

const C = {
  metal: '#3b3d40',
  metalDark: '#2a2b2d',
  metalWorn: '#5a5c5e',
  polymer: '#262626',
  polymerGrip: '#1f1f1f',
  mag: '#4b4c4a',
  optic: '#1d1e1f',
};

export const OPTIC_AXIS_Y = 0.118;

export function buildM4A1(segScale = 1): WeaponModel {
  const S = (n: number) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];

  // --- Horní pouzdro (profil z boku) ---
  const upper: P2[] = [
    [0.088, 0.0], [0.088, 0.03], [0.082, 0.05], [0.07, 0.054], [-0.165, 0.054], [-0.168, 0.05], [-0.168, 0.0],
  ];
  metal.push(sideProfile(upper, 0.024, 0.0025, C.metal));
  // Výstupek nad ejection portem (brass deflector) vpravo.
  metal.push(bevelBox(0.008, 0.02, 0.022, 0.002, C.metal, [0.014, 0.032, 0.012]));
  // Forward assist vpravo vzadu.
  metal.push(transform(lathe([[0, 0.0], [0.0065, 0.0], [0.0065, 0.018], [0.0075, 0.02], [0.0075, 0.028], [0, 0.03]], S(12), C.metalDark), [0.016, 0.034, 0.05], [0, -0.5, 0]));
  // Ejection port (tmavé zahloubení) a krytka.
  metal.push(bevelBox(0.002, 0.022, 0.06, 0.0008, C.metalDark, [0.0125, 0.026, -0.038]));
  // Horní lišta (Picatinny) s příčnými žebry – jeden sloučený celek.
  metal.push(crossProfile([[-0.0105, 0.054], [0.0105, 0.054], [0.0105, 0.058], [0.0085, 0.061], [0.0105, 0.064], [-0.0105, 0.064], [-0.0085, 0.061], [-0.0105, 0.058]], 0.086, -0.166, 0.0006, C.metal));
  for (let z = 0.078; z > -0.16; z -= 0.01) metal.push(plainBox(0.022, 0.0035, 0.0045, C.metalDark, [0, 0.0645, z]));
  // Natahovací páka (pohyblivá).
  const charging = merge([
    bevelBox(0.008, 0.006, 0.05, 0.0015, C.metal, [0, 0.0, 0.0]),
    bevelBox(0.05, 0.007, 0.012, 0.002, C.metal, [0, 0.0, 0.026]),
  ]);

  // --- Dolní pouzdro ---
  const lower: P2[] = [
    [0.084, 0.0], [0.084, -0.012], [0.07, -0.028], [0.045, -0.03], [0.04, -0.034], [0.0, -0.034], [-0.004, -0.07], [-0.008, -0.078], [-0.07, -0.078], [-0.074, -0.07], [-0.076, -0.028], [-0.095, -0.022], [-0.105, -0.012], [-0.105, 0.0],
  ];
  metal.push(sideProfile(lower, 0.023, 0.0025, C.metal));
  // Lem šachty (rozšířené ústí).
  metal.push(bevelBox(0.027, 0.006, 0.07, 0.0015, C.metal, [0, -0.077, -0.039]));
  // Lučík a spoušť.
  metal.push(sideProfile([[0.046, -0.03], [0.046, -0.058], [0.0, -0.058], [0.0, -0.052], [0.04, -0.052], [0.04, -0.03]], 0.012, 0.0015, C.metalDark));
  metal.push(sideProfile([[0.022, -0.034], [0.026, -0.048], [0.02, -0.052], [0.016, -0.036]], 0.005, 0.0008, C.metalWorn));
  // Pojistka (selektor) vlevo, záchyt závěru vlevo (bolt catch).
  metal.push(bevelBox(0.003, 0.008, 0.016, 0.001, C.metalDark, [-0.0125, -0.014, 0.05]));
  metal.push(bevelBox(0.003, 0.014, 0.008, 0.001, C.metalDark, [-0.0125, -0.012, -0.012]));
  // Uvolňovač zásobníku vpravo.
  metal.push(transform(lathe([[0, 0], [0.004, 0], [0.004, 0.004], [0, 0.0045]], S(10), C.metalDark), [0.0125, -0.022, -0.008], [0, Math.PI / 2, 0]));

  // --- Pistolová rukojeť (polymer, s prstovým žlábkem) ---
  const grip: P2[] = [
    [0.036, -0.032], [0.072, -0.032], [0.106, -0.122], [0.1, -0.132], [0.072, -0.13], [0.062, -0.1], [0.058, -0.088], [0.052, -0.08], [0.046, -0.062],
  ];
  poly.push(sideProfile(grip, 0.03, 0.004, C.polymerGrip));

  // --- Trubka nárazníku, matice, pažba (pevná poloha) ---
  metal.push(lathe([[0.0145, 0.085], [0.0145, 0.3], [0.012, 0.302], [0, 0.302]], S(20), C.metal, 0, 0.026));
  metal.push(lathe([[0.0175, 0.086], [0.0175, 0.096], [0.015, 0.098]], S(16), C.metalDark, 0, 0.026));
  const stock: P2[] = [
    [0.2, 0.044], [0.33, 0.052], [0.352, 0.056], [0.358, 0.05], [0.358, -0.078], [0.35, -0.082], [0.33, -0.07], [0.27, -0.028], [0.22, 0.0], [0.2, 0.008],
  ];
  poly.push(sideProfile(stock, 0.042, 0.005, C.polymer));
  poly.push(bevelBox(0.046, 0.136, 0.012, 0.004, C.polymerGrip, [0, -0.012, 0.36]));
  poly.push(bevelBox(0.012, 0.012, 0.05, 0.003, C.polymerGrip, [0, -0.002, 0.25]));

  // --- Přední část: delta kroužek, předpažbí, hlaveň, blok mušky, tlumič plamene ---
  metal.push(lathe([[0.016, -0.164], [0.026, -0.166], [0.027, -0.172], [0.026, -0.178], [0.016, -0.18]], S(24), C.metal, 0, 0.026));
  const hg: Array<[number, number]> = [[0.0185, 0.181]];
  for (let z = 0.184; z < 0.35; z += 0.012) hg.push([0.0215, z], [0.0215, z + 0.009], [0.0204, z + 0.0095], [0.0204, z + 0.0115]);
  hg.push([0.0215, 0.352], [0.019, 0.356]);
  const handguard = lathe(fwd(hg), S(24), C.polymer, 0, 0);
  handguard.applyMatrix4(new THREE.Matrix4().makeScale(1, 1.1, 1));
  handguard.translate(0, 0.026, 0);
  poly.push(handguard);
  metal.push((lathe(fwd([[0.019, 0.355], [0.0195, 0.366], [0.012, 0.368]]), S(20), C.metal, 0, 0.026)));
  // Hlaveň se stupni (M4 profil se zápichem pro granátomet je zjednodušený).
  metal.push((lathe(fwd([[0.0, 0.2], [0.0105, 0.2], [0.0105, 0.375], [0.0095, 0.378], [0.0095, 0.43], [0.0082, 0.433], [0.0082, 0.528], [0.0, 0.528]]), S(20), C.metalDark, 0, 0.026)));
  // Plynový blok a blok přední mušky (trojúhelníkový sloup s ochrannými uchy).
  const fsb: P2[] = [
    [-0.372, 0.012], [-0.372, 0.04], [-0.378, 0.06], [-0.384, 0.075], [-0.394, 0.075], [-0.4, 0.06], [-0.406, 0.04], [-0.41, 0.012], [-0.41, 0.0], [-0.372, 0.0],
  ];
  metal.push(sideProfile(fsb, 0.016, 0.002, C.metal));
  metal.push(bevelBox(0.03, 0.026, 0.04, 0.003, C.metal, [0, 0.022, -0.391]));
  for (const sx of [-1, 1]) metal.push(bevelBox(0.003, 0.02, 0.012, 0.001, C.metal, [sx * 0.0065, 0.083, -0.389]));
  metal.push(bevelBox(0.0028, 0.016, 0.0028, 0.0006, C.metalDark, [0, 0.082, -0.389])); // muška
  metal.push(bevelBox(0.012, 0.012, 0.022, 0.002, C.metal, [0, 0.01, -0.398])); // úchyt bajonetu
  // Tlumič plamene A2 (birdcage): kroužky = viditelné štěrbiny bez stovek dílů.
  const fh: Array<[number, number]> = [[0.0, 0.528], [0.0112, 0.528]];
  for (let k = 0; k < 4; k++) {
    const z = 0.532 + k * 0.01;
    fh.push([0.0112, z], [0.0098, z + 0.001], [0.0098, z + 0.005], [0.0112, z + 0.006]);
  }
  fh.push([0.0112, 0.574], [0.0085, 0.576], [0.0085, 0.566], [0.0, 0.566]);
  metal.push((lathe(fwd(fh), S(20), C.metal, 0, 0.026)));

  // --- Kolimátor na nízké montáži horní lišty ---
  const axisY = OPTIC_AXIS_Y;
  const z0 = -0.005, z1 = -0.122;
  // Montáž: objímka lišty + sloupek + kroužky.
  metal.push(bevelBox(0.032, 0.012, 0.05, 0.002, C.optic, [0, 0.07, -0.06]));
  // Sloupek končí pod vnějším pláštěm tubusu (nesmí zasahovat do průhledu).
  metal.push(bevelBox(0.016, axisY - 0.0195 - 0.074, 0.044, 0.002, C.optic, [0, (axisY - 0.0195 + 0.074) / 2, -0.06]));
  metal.push(bevelBox(0.006, 0.01, 0.03, 0.0015, C.metalDark, [0.018, 0.07, -0.06]));
  // Tubus: dutý (vnitřní tunel s tloušťkou stěny) + mírně rozšířené čelo.
  const tubeProf: Array<[number, number]> = [
    [0.0155, -z0], [0.0195, -z0], [0.0195, -z0 + 0.004], [0.0188, -z0 + 0.006], [0.0188, -z1 - 0.012], [0.021, -z1 - 0.006], [0.021, -z1], [0.017, -z1], [0.017, -z1 - 0.008], [0.0155, -z1 - 0.01], [0.0155, -z0],
  ];
  metal.push((lathe(fwd(tubeProf), S(28), C.optic, 0, axisY)));
  for (const zr of [-0.04, -0.082]) metal.push((lathe(fwd([[0.019, -zr - 0.006], [0.0215, -zr - 0.005], [0.0215, zr * -1 + 0.005], [0.019, -zr + 0.006]]), S(24), C.optic, 0, axisY)));
  // Věžičky nastavení (nahoře a vpravo).
  metal.push(transform(lathe([[0, 0], [0.008, 0], [0.008, 0.012], [0.006, 0.014], [0, 0.014]], S(14), C.optic), [0, axisY + 0.018, -0.062], [-Math.PI / 2, 0, 0]));
  metal.push(transform(lathe([[0, 0], [0.008, 0], [0.008, 0.012], [0.006, 0.014], [0, 0.014]], S(14), C.optic), [0.018, axisY, -0.062], [0, Math.PI / 2, 0]));
  const glass = new THREE.CircleGeometry(0.0156, S(28));
  glass.translate(0, axisY, z1 + 0.012);

  // --- Zásobník (pohyblivý), STANAG 30, mírně zakřivený, matnější a světlejší ---
  const mag = merge([
    curvedMag(0.19, 0.062, 0.021, 0.024, C.mag),
    bevelBox(0.026, 0.012, 0.072, 0.002, C.metalDark, [0, -0.19, -0.032]),
  ]);

  const points: WeaponPoints = {
    weaponRoot: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, 0.026, -0.576),
    sightRear: new THREE.Vector3(0, axisY, z0),
    sightFront: new THREE.Vector3(0, axisY, z1),
    opticEye: new THREE.Vector3(0, axisY, z0 + 0.09),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.075, 0.075),
    gripLeft: new THREE.Vector3(0, 0.0, -0.27),
    magazineSocket: new THREE.Vector3(0, -0.035, -0.04),
    ejectionPort: new THREE.Vector3(0.014, 0.026, -0.038),
    chargingHandle: new THREE.Vector3(0, 0.05, 0.075),
    boltCatch: new THREE.Vector3(-0.014, -0.012, -0.012),
  };

  const m = merge(metal), p = merge(poly);
  const tris = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3;
  return {
    name: 'M4A1',
    static: { metal: m, polymer: p },
    moving: {
      magazine: { geometry: mag, material: 'polymer', pivot: points.magazineSocket.clone() },
      chargingHandle: { geometry: charging, material: 'metal', pivot: points.chargingHandle.clone() },
    },
    optic: { lensZ: z1 + 0.012, axisY, innerR: 0.0155, glass },
    points,
    triangles: tris(m) + tris(p) + tris(mag) + tris(charging) + tris(glass),
  };
}

void roundedRect;
void tube;
