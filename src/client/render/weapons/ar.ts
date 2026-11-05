import * as THREE from 'three';
import { bevelBox, crossProfile, curvedMag, fwd, lathe, merge, plainBox, sideProfile, transform, type P2 } from './meshkit';
import { buildOptic } from './optic';
import { PAL as C, hipFromGrip, triCount, type WeaponModel, type WeaponPoints } from './types';

export type { WeaponModel, WeaponPoints } from './types';

/**
 * Rodina AR (USMC): M4A1 (Assault, kolimátor) a M16A2 (Medic, mechanická mířidla).
 * Sdílené díly: dolní pouzdro, pistolová rukojeť, horní pouzdro, blok mušky, tlumič plamene,
 * zásobník STANAG. Rozměry jsou umělecký odhad (viz docs/weapons/*.md).
 *
 * Kořen zbraně: z = 0 u zadní hrany šachty zásobníku, y = 0 na dělicí rovině pouzder,
 * osa vývrtu na y = 0,026.
 */

export const OPTIC_AXIS_Y = 0.118;
const BORE_Y = 0.026;

type Seg = (n: number) => number;

/** Horní pouzdro (bez lišty / nosné rukojeti), deflektor, forward assist, ejection port. */
function arUpper(metal: THREE.BufferGeometry[], S: Seg) {
  const upper: P2[] = [
    [0.088, 0.0], [0.088, 0.03], [0.082, 0.05], [0.07, 0.054], [-0.165, 0.054], [-0.168, 0.05], [-0.168, 0.0],
  ];
  metal.push(sideProfile(upper, 0.024, 0.0025, C.metal));
  metal.push(bevelBox(0.008, 0.02, 0.022, 0.002, C.metal, [0.014, 0.032, 0.012]));
  metal.push(transform(lathe([[0, 0.0], [0.0065, 0.0], [0.0065, 0.018], [0.0075, 0.02], [0.0075, 0.028], [0, 0.03]], S(12), C.metalDark), [0.016, 0.034, 0.05], [0, -0.5, 0]));
  metal.push(bevelBox(0.002, 0.022, 0.06, 0.0008, C.metalDark, [0.0125, 0.026, -0.038]));
}

/** Dolní pouzdro, lučík, spoušť, ovladače a pistolová rukojeť A2. */
function arLower(metal: THREE.BufferGeometry[], poly: THREE.BufferGeometry[], S: Seg) {
  const lower: P2[] = [
    [0.084, 0.0], [0.084, -0.012], [0.07, -0.028], [0.045, -0.03], [0.04, -0.034], [0.0, -0.034], [-0.004, -0.07], [-0.008, -0.078], [-0.07, -0.078], [-0.074, -0.07], [-0.076, -0.028], [-0.095, -0.022], [-0.105, -0.012], [-0.105, 0.0],
  ];
  metal.push(sideProfile(lower, 0.023, 0.0025, C.metal));
  metal.push(bevelBox(0.027, 0.006, 0.07, 0.0015, C.metal, [0, -0.077, -0.039]));
  metal.push(sideProfile([[0.046, -0.03], [0.046, -0.058], [0.0, -0.058], [0.0, -0.052], [0.04, -0.052], [0.04, -0.03]], 0.012, 0.0015, C.metalDark));
  metal.push(sideProfile([[0.022, -0.034], [0.026, -0.048], [0.02, -0.052], [0.016, -0.036]], 0.005, 0.0008, C.metalWorn));
  // Selektor a záchyt závěru vlevo, uvolňovač zásobníku vpravo.
  metal.push(bevelBox(0.003, 0.008, 0.016, 0.001, C.metalDark, [-0.0125, -0.014, 0.05]));
  metal.push(bevelBox(0.003, 0.014, 0.008, 0.001, C.metalDark, [-0.0125, -0.012, -0.012]));
  metal.push(transform(lathe([[0, 0], [0.004, 0], [0.004, 0.004], [0, 0.0045]], S(10), C.metalDark), [0.0125, -0.022, -0.008], [0, Math.PI / 2, 0]));
  const grip: P2[] = [
    [0.036, -0.032], [0.072, -0.032], [0.106, -0.122], [0.1, -0.132], [0.072, -0.13], [0.062, -0.1], [0.058, -0.088], [0.052, -0.08], [0.046, -0.062],
  ];
  poly.push(sideProfile(grip, 0.03, 0.004, C.polymerGrip));
}

/** Blok přední mušky s ochrannými uchy; dz = posun vůči poloze na M4 (střed z = −0,391). */
function arFrontSight(metal: THREE.BufferGeometry[], dz: number) {
  const fsb: P2[] = [
    [-0.372, 0.012], [-0.372, 0.04], [-0.378, 0.06], [-0.384, 0.075], [-0.394, 0.075], [-0.4, 0.06], [-0.406, 0.04], [-0.41, 0.012], [-0.41, 0.0], [-0.372, 0.0],
  ];
  metal.push(sideProfile(fsb.map(([z, y]) => [z + dz, y] as P2), 0.016, 0.002, C.metal));
  metal.push(bevelBox(0.03, 0.026, 0.04, 0.003, C.metal, [0, 0.022, -0.391 + dz]));
  for (const sx of [-1, 1]) metal.push(bevelBox(0.003, 0.02, 0.012, 0.001, C.metal, [sx * 0.0065, 0.083, -0.389 + dz]));
  metal.push(bevelBox(0.0028, 0.016, 0.0028, 0.0006, C.metalDark, [0, 0.082, -0.389 + dz])); // muška, vrchol y = 0,09
  metal.push(bevelBox(0.012, 0.012, 0.022, 0.002, C.metal, [0, 0.01, -0.398 + dz])); // úchyt bajonetu
}

/** Tlumič plamene A2 (birdcage) od z0 dopředu; vrací z ústí. */
function birdcage(metal: THREE.BufferGeometry[], z0: number, S: Seg) {
  const fh: Array<[number, number]> = [[0.0, z0], [0.0112, z0]];
  for (let k = 0; k < 4; k++) {
    const z = z0 + 0.004 + k * 0.01;
    fh.push([0.0112, z], [0.0098, z + 0.001], [0.0098, z + 0.005], [0.0112, z + 0.006]);
  }
  fh.push([0.0112, z0 + 0.046], [0.0085, z0 + 0.048], [0.0085, z0 + 0.038], [0.0, z0 + 0.038]);
  metal.push(lathe(fwd(fh), S(20), C.metal, 0, BORE_Y));
  return -(z0 + 0.048);
}

/** Žebrované kulaté předpažbí mezi z0 a z1 (kladně dopředu). */
function ribbedHandguard(z0: number, z1: number, r: number, S: Seg) {
  const hg: Array<[number, number]> = [[r - 0.003, z0]];
  for (let z = z0 + 0.003; z < z1 - 0.006; z += 0.012) hg.push([r, z], [r, z + 0.009], [r - 0.0011, z + 0.0095], [r - 0.0011, z + 0.0115]);
  hg.push([r, z1 - 0.004], [r - 0.0025, z1]);
  const g = lathe(fwd(hg), S(24), C.polymer, 0, 0);
  g.applyMatrix4(new THREE.Matrix4().makeScale(1, 1.1, 1));
  g.translate(0, BORE_Y, 0);
  return g;
}

function stanagMag() {
  return merge([curvedMag(0.19, 0.062, 0.021, 0.024, C.mag), bevelBox(0.026, 0.012, 0.072, 0.002, C.metalDark, [0, -0.19, -0.032])]);
}

function chargingHandle() {
  return merge([bevelBox(0.008, 0.006, 0.05, 0.0015, C.metal, [0, 0.0, 0.0]), bevelBox(0.05, 0.007, 0.012, 0.002, C.metal, [0, 0.0, 0.026])]);
}

function finish(id: string, name: string, metal: THREE.BufferGeometry[], poly: THREE.BufferGeometry[], points: WeaponPoints, extra: Partial<WeaponModel> & { opticGlass?: THREE.BufferGeometry }): WeaponModel {
  const m = merge(metal), p = merge(poly);
  const mag = stanagMag();
  const ch = chargingHandle();
  return {
    id,
    name,
    static: { metal: m, polymer: p },
    moving: {
      magazine: { geometry: mag, material: 'polymer', pivot: points.magazineSocket.clone() },
      chargingHandle: { geometry: ch, material: 'metal', pivot: points.chargingHandle.clone(), travel: new THREE.Vector3(0, 0, 0.07) },
    },
    optic: extra.optic,
    sight: extra.optic ? 'optic' : 'iron',
    points,
    hipRoot: hipFromGrip(points.gripRight),
    hipRot: new THREE.Euler(0.02, 0.05, 0),
    magRock: 0.4,
    emptyAction: 'boltCatch',
    triangles: triCount(m, p, mag, ch, extra.optic?.glass),
  };
}

/** Společné body AR (úchop, šachta, závěr). */
function arPoints(muzzleZ: number, sightRear: THREE.Vector3, sightFront: THREE.Vector3, eye: THREE.Vector3, gripLeftZ: number): WeaponPoints {
  return {
    weaponRoot: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, BORE_Y, muzzleZ),
    sightRear,
    sightFront,
    opticEye: eye,
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.075, 0.075),
    gripLeft: new THREE.Vector3(0, 0.0, gripLeftZ),
    magazineSocket: new THREE.Vector3(0, -0.035, -0.04),
    ejectionPort: new THREE.Vector3(0.014, 0.026, -0.038),
    chargingHandle: new THREE.Vector3(0, 0.05, 0.075),
    boltCatch: new THREE.Vector3(-0.014, -0.012, -0.012),
  };
}

/**
 * M4A1 (USMC Assault) – pevná sestava: pevná pažba v jedné poloze, kulaté předpažbí,
 * blok přední mušky, tubusový kolimátor na nízké montáži horní lišty.
 */
export function buildM4A1(segScale = 1): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];
  arUpper(metal, S);
  // Horní lišta (Picatinny) s příčnými žebry.
  metal.push(crossProfile([[-0.0105, 0.054], [0.0105, 0.054], [0.0105, 0.058], [0.0085, 0.061], [0.0105, 0.064], [-0.0105, 0.064], [-0.0085, 0.061], [-0.0105, 0.058]], 0.086, -0.166, 0.0006, C.metal));
  for (let z = 0.078; z > -0.16; z -= 0.01) metal.push(plainBox(0.022, 0.0035, 0.0045, C.metalDark, [0, 0.0645, z]));
  arLower(metal, poly, S);

  // Trubka nárazníku, matice, teleskopická pažba (pevná poloha).
  metal.push(lathe([[0.0145, 0.085], [0.0145, 0.3], [0.012, 0.302], [0, 0.302]], S(20), C.metal, 0, BORE_Y));
  metal.push(lathe([[0.0175, 0.086], [0.0175, 0.096], [0.015, 0.098]], S(16), C.metalDark, 0, BORE_Y));
  const stock: P2[] = [
    [0.2, 0.044], [0.33, 0.052], [0.352, 0.056], [0.358, 0.05], [0.358, -0.078], [0.35, -0.082], [0.33, -0.07], [0.27, -0.028], [0.22, 0.0], [0.2, 0.008],
  ];
  poly.push(sideProfile(stock, 0.042, 0.005, C.polymer));
  poly.push(bevelBox(0.046, 0.136, 0.012, 0.004, C.polymerGrip, [0, -0.012, 0.36]));
  poly.push(bevelBox(0.012, 0.012, 0.05, 0.003, C.polymerGrip, [0, -0.002, 0.25]));

  // Delta kroužek, předpažbí, hlaveň, blok mušky, tlumič plamene.
  metal.push(lathe([[0.016, -0.164], [0.026, -0.166], [0.027, -0.172], [0.026, -0.178], [0.016, -0.18]], S(24), C.metal, 0, BORE_Y));
  poly.push(ribbedHandguard(0.181, 0.356, 0.0215, S));
  metal.push(lathe(fwd([[0.019, 0.355], [0.0195, 0.366], [0.012, 0.368]]), S(20), C.metal, 0, BORE_Y));
  metal.push(lathe(fwd([[0.0, 0.2], [0.0105, 0.2], [0.0105, 0.375], [0.0095, 0.378], [0.0095, 0.43], [0.0082, 0.433], [0.0082, 0.528], [0.0, 0.528]]), S(20), C.metalDark, 0, BORE_Y));
  arFrontSight(metal, 0);
  const muzzleZ = birdcage(metal, 0.528, S);

  // Kolimátor na nízké montáži horní lišty: objímka + sloupek pod tubusem.
  const axisY = OPTIC_AXIS_Y;
  const z0 = -0.005, z1 = -0.122;
  metal.push(bevelBox(0.032, 0.012, 0.05, 0.002, C.optic, [0, 0.07, -0.06]));
  metal.push(bevelBox(0.016, axisY - 0.0195 - 0.074, 0.044, 0.002, C.optic, [0, (axisY - 0.0195 + 0.074) / 2, -0.06]));
  metal.push(bevelBox(0.006, 0.01, 0.03, 0.0015, C.metalDark, [0.018, 0.07, -0.06]));
  const o = buildOptic(axisY, z0, z1, S);
  metal.push(...o.metal);

  const points = arPoints(muzzleZ, new THREE.Vector3(0, axisY, z0), new THREE.Vector3(0, axisY, z1), new THREE.Vector3(0, axisY, z0 + 0.095), -0.27);
  return finish('m4a1', 'M4A1', metal, poly, points, { optic: { lensZ: o.lensZ, axisY, innerR: o.innerR, glass: o.glass } });
}

/**
 * M16A2 (USMC Medic) – delší silueta, pevná pažba A2, dlouhé žebrované předpažbí,
 * integrovaná nosná rukojeť s průhledovým hledím (skutečný otvor) a přední muška.
 */
export const M16A2_SIGHT_Y = 0.09;

export function buildM16A2(segScale = 1): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];
  arUpper(metal, S);
  arLower(metal, poly, S);
  const SY = M16A2_SIGHT_Y;

  // Nosná rukojeť A2: dvě nohy, horní pas s oknem pod ním, zadní blok hledí.
  metal.push(sideProfile([[-0.112, 0.054], [-0.114, 0.066], [-0.124, 0.08], [-0.15, 0.08], [-0.152, 0.066], [-0.148, 0.054]], 0.018, 0.002, C.metal));
  metal.push(sideProfile([[0.068, 0.054], [0.068, 0.08], [-0.128, 0.08], [-0.128, 0.072], [0.03, 0.072], [0.04, 0.066], [0.04, 0.054]], 0.021, 0.0025, C.metal));
  // Vybrání horního pasu (tmavší dno žlábku) – drážka uprostřed rukojeti.
  metal.push(plainBox(0.006, 0.0015, 0.13, C.metalDark, [0, 0.0805, -0.05]));
  // Hledí: kruhová clona se skutečným otvorem, ochranná křidélka, buben stranové opravy vpravo.
  const zA = 0.052;
  metal.push(lathe([[0.0029, zA - 0.002], [0.0075, zA - 0.002], [0.0075, zA + 0.002], [0.0029, zA + 0.002], [0.0029, zA - 0.002]], S(20), C.metalDark, 0, SY));
  metal.push(bevelBox(0.012, 0.008, 0.012, 0.0015, C.metal, [0, 0.0815, zA]));
  for (const sx of [-1, 1]) metal.push(sideProfile([[zA + 0.012, 0.079], [zA + 0.01, 0.1], [zA + 0.004, 0.102], [zA - 0.008, 0.096], [zA - 0.01, 0.079]], 0.003, 0.0008, C.metal, sx * 0.0095));
  metal.push(transform(lathe([[0, 0], [0.0075, 0], [0.0075, 0.006], [0.006, 0.007], [0, 0.007]], S(14), C.metalDark), [0.011, 0.0845, zA], [0, Math.PI / 2, 0]));
  // Buben výškové opravy pod hledím (příčná osa).
  metal.push(transform(lathe([[0, -0.012], [0.0085, -0.012], [0.0085, 0.012], [0, 0.012]], S(16), C.metalDark), [0, 0.072, zA + 0.004], [0, Math.PI / 2, 0]));

  // Pevná pažba A2 s botkou a dvířky.
  const stock: P2[] = [
    [0.084, 0.052], [0.33, 0.044], [0.338, 0.046], [0.344, 0.04], [0.344, -0.098], [0.336, -0.104], [0.3, -0.092], [0.16, -0.04], [0.11, -0.026], [0.084, -0.016],
  ];
  poly.push(sideProfile(stock, 0.042, 0.006, C.polymer));
  poly.push(bevelBox(0.046, 0.15, 0.01, 0.003, C.polymerGrip, [0, -0.028, 0.348]));
  metal.push(bevelBox(0.004, 0.012, 0.02, 0.001, C.metalDark, [0, -0.1, 0.31]));

  // Delta kroužek, dlouhé kulaté předpažbí A2, čepička, hlaveň 20″, blok mušky, tlumič.
  metal.push(lathe([[0.017, -0.164], [0.029, -0.166], [0.03, -0.172], [0.029, -0.178], [0.017, -0.18]], S(24), C.metal, 0, BORE_Y));
  poly.push(ribbedHandguard(0.181, 0.472, 0.0245, S));
  metal.push(lathe(fwd([[0.021, 0.47], [0.0215, 0.482], [0.012, 0.485]]), S(20), C.metal, 0, BORE_Y));
  metal.push(lathe(fwd([[0.0, 0.2], [0.0105, 0.2], [0.0105, 0.49], [0.0095, 0.493], [0.0095, 0.56], [0.0085, 0.563], [0.0085, 0.676], [0.0, 0.676]]), S(20), C.metalDark, 0, BORE_Y));
  arFrontSight(metal, -0.14);
  const muzzleZ = birdcage(metal, 0.676, S);

  const rear = new THREE.Vector3(0, SY, zA);
  const points = arPoints(muzzleZ, rear, new THREE.Vector3(0, SY, -0.529), rear.clone().add(new THREE.Vector3(0, 0, 0.1)), -0.33);
  return finish('m16a2', 'M16A2', metal, poly, points, {});
}
