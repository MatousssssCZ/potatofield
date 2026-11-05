import * as THREE from 'three';
import { bevelBox, curvedMag, fwd, lathe, merge, plainBox, sideProfile, transform, type P2 } from './meshkit';
import { buildOptic } from './optic';
import { PAL as C, hipFromGrip, triCount, type WeaponModel, type WeaponPoints } from './types';

/**
 * Rodina 95 (PLA) – bullpup: zásobník za pistolovou rukojetí, integrovaná pažba a nosná
 * rukojeť, velký lučík pro celou ruku. QBZ-95: kolimátor na nízké montáži na nosné rukojeti.
 * Kořen: osa vývrtu y = 0, z = 0 přibližně u čela rukojeti. Rozměry = umělecký odhad.
 */

type Seg = (n: number) => number;

const HANDLE_TOP = 0.088;
/** Mechanická mířidla na rukojeti (pro QBB-95; u QBZ-95 jen jako součást rukojeti). */
const IRON_Y = 0.098;

export function buildQBZ95(segScale = 1, irons = false): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];
  const P = C.polymerPla;

  // --- Tělo (pouzdro + pažba + přední část v jednom polymerovém celku) ---
  const body: P2[] = [
    [0.345, 0.03], [0.345, -0.096], [0.332, -0.104], [0.25, -0.064], [0.2, -0.05], [0.09, -0.047], [-0.04, -0.047], [-0.07, -0.043],
    [-0.228, -0.03], [-0.236, -0.02], [-0.236, 0.012], [-0.2, 0.024], [-0.06, 0.034], [0.22, 0.034], [0.3, 0.033],
  ];
  poly.push(sideProfile(body, 0.046, 0.007, P));
  // Lícnice (mírně vyvýšená plocha na levé straně u oka) a pryžová botka.
  poly.push(sideProfile([[0.29, 0.03], [0.17, 0.03], [0.17, -0.02], [0.29, -0.03]], 0.004, 0.0015, C.polymerGrip, -0.024));
  poly.push(bevelBox(0.05, 0.13, 0.012, 0.004, C.polymerGrip, [0, -0.035, 0.348]));
  // Úchopové drážky na přední části.
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) poly.push(bevelBox(0.002, 0.004, 0.11, 0.0008, C.polymerGrip, [sx * 0.0232, -0.016 - k * 0.006, -0.155]));
  // Okno vyhazování vpravo vzadu a kryt.
  metal.push(plainBox(0.0016, 0.012, 0.05, C.metalDark, [0.0232, 0.006, 0.13]));
  // Selektor vlevo na pažbě za zásobníkem, záchyt zásobníku.
  metal.push(transform(lathe([[0, 0], [0.007, 0], [0.007, 0.003], [0, 0.0035]], S(12), C.metalWorn), [-0.0232, -0.02, 0.25], [0, -Math.PI / 2, 0]));
  metal.push(bevelBox(0.003, 0.004, 0.02, 0.001, C.metalWorn, [-0.025, -0.02, 0.24], [-0.4, 0, 0]));
  metal.push(bevelBox(0.016, 0.006, 0.012, 0.0015, C.metalWorn, [0, -0.052, 0.198]));
  // Lem šachty zásobníku.
  poly.push(bevelBox(0.034, 0.012, 0.074, 0.003, C.polymerGrip, [0, -0.052, 0.152]));

  // --- Nosná rukojeť s oknem (natahovací páka pod ní) ---
  poly.push(sideProfile([[0.13, 0.03], [0.118, HANDLE_TOP], [-0.098, HANDLE_TOP], [-0.115, 0.03], [-0.085, 0.03], [-0.078, 0.07], [0.088, 0.07], [0.098, 0.03]], 0.022, 0.003, P));
  // Hledí a muška na rukojeti (sklopné kryty, skutečný otvor).
  // U QBZ-95 jsou mechanická mířidla sklopená do rukojeti (nesmí zasahovat do průhledu kolimátoru).
  const zr = 0.108, zf = -0.094;
  if (irons) {
    metal.push(lathe([[0.0028, zr - 0.002], [0.0068, zr - 0.002], [0.0068, zr + 0.002], [0.0028, zr + 0.002], [0.0028, zr - 0.002]], S(18), C.metalDark, 0, IRON_Y));
    metal.push(bevelBox(0.01, 0.006, 0.01, 0.0015, C.metalDark, [0, HANDLE_TOP + 0.002, zr]));
    for (const sx of [-1, 1]) {
      metal.push(bevelBox(0.0025, 0.018, 0.012, 0.0006, C.metalDark, [sx * 0.009, HANDLE_TOP + 0.009, zr]));
      metal.push(bevelBox(0.0025, 0.018, 0.012, 0.0006, C.metalDark, [sx * 0.0075, HANDLE_TOP + 0.009, zf]));
    }
    metal.push(bevelBox(0.0024, IRON_Y - HANDLE_TOP, 0.0024, 0.0005, C.metalDark, [0, (IRON_Y + HANDLE_TOP) / 2, zf]));
  }

  // --- Hlaveň, tlumič plamene, úchyt bajonetu ---
  metal.push(lathe(fwd([[0, 0.2], [0.0095, 0.2], [0.0095, 0.3], [0.0085, 0.305], [0.0085, 0.385], [0, 0.385]]), S(18), C.blued, 0, 0));
  const fh: Array<[number, number]> = [[0, 0.385], [0.0112, 0.385], [0.0112, 0.418], [0.0095, 0.421], [0, 0.421]];
  metal.push(lathe(fwd(fh), S(18), C.blued, 0, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    metal.push(plainBox(0.0016, 0.004, 0.02, C.metalDark, [Math.cos(a) * 0.0112, Math.sin(a) * 0.0112, -0.408]));
  }
  metal.push(bevelBox(0.012, 0.016, 0.03, 0.002, C.blued, [0, -0.018, -0.25]));
  metal.push(lathe(fwd([[0.012, 0.236], [0.0135, 0.238], [0.0135, 0.25], [0.012, 0.252]]), S(16), C.blued, 0, 0));

  // --- Pistolová rukojeť a velký lučík ---
  const grip: P2[] = [[-0.022, -0.046], [0.012, -0.046], [0.04, -0.14], [0.033, -0.148], [0.006, -0.145], [-0.004, -0.11], [-0.014, -0.07]];
  poly.push(sideProfile(grip, 0.03, 0.004, C.polymerGrip));
  poly.push(sideProfile([[-0.064, -0.044], [-0.074, -0.074], [-0.064, -0.128], [-0.046, -0.142], [0.004, -0.146], [0.004, -0.136], [-0.04, -0.132], [-0.054, -0.122], [-0.062, -0.078], [-0.054, -0.046]], 0.016, 0.003, P));
  metal.push(sideProfile([[-0.03, -0.047], [-0.026, -0.064], [-0.032, -0.07], [-0.036, -0.05]], 0.005, 0.0008, C.metalWorn));

  // --- Kolimátor na nízké montáži na nosné rukojeti ---
  const base = HANDLE_TOP + 0.006;
  const axisY = base + 0.0215;
  const oz0 = 0.07, oz1 = -0.047;
  poly.push(bevelBox(0.026, 0.008, 0.07, 0.002, C.optic, [0, HANDLE_TOP + 0.002, 0.01]));
  metal.push(bevelBox(0.005, 0.01, 0.026, 0.0012, C.metalDark, [0.015, HANDLE_TOP + 0.002, 0.01]));
  const o = buildOptic(axisY, oz0, oz1, S);
  metal.push(...o.metal);

  // --- Pohyblivé díly ---
  const mag = merge([curvedMag(0.19, 0.06, 0.023, 0.03, '#2f302d'), bevelBox(0.025, 0.01, 0.066, 0.002, C.polymerGrip, [0, -0.19, -0.03])]);
  const handle = merge([bevelBox(0.004, 0.026, 0.012, 0.001, C.blued, [0, 0.013, 0]), bevelBox(0.024, 0.008, 0.012, 0.002, C.blued, [0, 0.028, 0])]);

  const points: WeaponPoints = {
    weaponRoot: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, 0, -0.421),
    sightRear: new THREE.Vector3(0, axisY, oz0),
    sightFront: new THREE.Vector3(0, axisY, oz1),
    opticEye: new THREE.Vector3(0, axisY, oz0 + 0.095),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.089, 0.012),
    gripLeft: new THREE.Vector3(0, -0.034, -0.165),
    magazineSocket: new THREE.Vector3(0, -0.046, 0.152),
    ejectionPort: new THREE.Vector3(0.024, 0.006, 0.13),
    chargingHandle: new THREE.Vector3(0, 0.034, -0.05),
    boltCatch: new THREE.Vector3(0, 0.06, -0.05),
  };
  const m = merge(metal), p = merge(poly);
  return {
    id: 'qbz95',
    name: 'QBZ-95',
    static: { metal: m, polymer: p },
    moving: {
      magazine: { geometry: mag, material: 'polymer', pivot: points.magazineSocket.clone() },
      chargingHandle: { geometry: handle, material: 'metal', pivot: points.chargingHandle.clone(), travel: new THREE.Vector3(0, 0, 0.1) },
    },
    optic: { lensZ: o.lensZ, axisY, innerR: o.innerR, glass: o.glass },
    sight: 'optic',
    points,
    hipRoot: hipFromGrip(points.gripRight, [0.01, -0.005, -0.05]),
    hipRot: new THREE.Euler(0.02, 0.05, 0),
    magRock: 0.25,
    emptyAction: 'chargingHandle',
    triangles: triCount(m, p, mag, handle, o.glass),
  };
}
