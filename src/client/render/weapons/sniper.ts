import * as THREE from 'three';
import { bevelBox, crossProfile, curvedMag, fwd, lathe, merge, plainBox, sideProfile, transform, tube, type P2 } from './meshkit';
import { PAL as C, hipFromGrip, triCount, type WeaponModel, type WeaponPoints } from './types';

/**
 * Odstřelovací pušky (Sniper): M24 (USMC) a SVD (MEC). Rozměry jsou umělecký odhad
 * (docs/weapons/M24.md, SVD.md), ne výkresové míry. Kořen: osa vývrtu y = 0, z = 0 u zadní
 * hrany šachty zásobníku / čela lučíku. Obě mají puškohled se zvětšením: tubus je dutý
 * (osa průhledu volná), okulár nese tmavé sklo; zaměřovací obraz kreslí hra přes celou obrazovku.
 *
 * M24: opakovací (otočný závěr Remington 700), kompozitní pažba s nastavitelnou botkou,
 * těžká hlaveň, sklopená dvojnožka, puškohled 10× na dvou kroužcích. Nabíjí se po jednom
 * nábojem do otevřeného závěru (pevná schránka 5 nábojů).
 * SVD: samonabíjecí, pouzdro z rodiny AK, dřevěná pažba s průchodem pro palec a lícnicí,
 * větrané předpažbí, štěrbinový tlumič plamene, zásobník 10 nábojů, PSO-1 4× na boční montáži.
 */

type Seg = (n: number) => number;

const OD = '#3d4234';
const OD_DARK = '#30352a';
const RUBBER = '#161616';
const SCOPE = '#1b1c1d';
const WOOD = '#7a4a2a';
const WOOD_DARK = '#643b20';

/** Dutý tubus puškohledu: profil [poloměr, z] (z kladně dozadu), vnitřní stěna `inner`. */
function scopeBody(outer: Array<[number, number]>, inner: number, axisY: number, S: Seg) {
  const zRear = outer[0][1], zFront = outer[outer.length - 1][1];
  const prof: Array<[number, number]> = [[inner, zRear], ...outer, [inner, zFront], [inner, zRear]];
  // lathe() bere světové z (− dopředu).
  return lathe(prof, S(28), SCOPE, 0, axisY, true);
}

/** Věžička (elevace / náměr) jako krátký rotační díl s rýhováním. */
function turret(r: number, h: number, S: Seg) {
  return lathe([[0, 0], [r, 0], [r, h * 0.7], [r * 1.08, h * 0.72], [r * 1.08, h], [r * 0.5, h * 1.05], [0, h * 1.05]], S(16), SCOPE);
}

function cartridge(S: Seg, len = 0.071, r = 0.0060) {
  // Náboj (mosazná nábojnice + střela), osa podél −Z, dno vzadu.
  return merge([
    lathe([[0, 0.0], [r, 0.0], [r, -len * 0.62], [r * 0.62, -len * 0.7], [r * 0.62, -len * 0.74], [0, -len * 0.74]], S(10), '#b08d45'),
    lathe([[0, -len * 0.74], [r * 0.6, -len * 0.74], [r * 0.5, -len * 0.92], [0, -len]], S(10), '#9a6a3a'),
  ]);
}

export function buildM24(segScale = 1): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];

  // --- Pouzdro (válcové, Remington 700) se zadním krytem závěru a otvorem pro nabíjení. ---
  const rR = 0.0168;
  metal.push(lathe([[0, -0.118], [0.0175, -0.118], [rR, -0.112], [rR, 0.104], [0.0145, 0.112], [0, 0.112]], S(24), C.blued, 0, 0));
  metal.push(lathe([[0, 0.112], [0.0135, 0.112], [0.0135, 0.15], [0.009, 0.16], [0, 0.16]], S(18), C.blued, 0, 0)); // kryt závěru
  metal.push(plainBox(0.0012, 0.014, 0.075, C.metalDark, [0.0165, 0.007, 0.0])); // okno vyhazování / nabíjení vpravo nahoře
  metal.push(plainBox(0.012, 0.0012, 0.075, C.metalDark, [0.006, 0.0168, 0.0]));
  metal.push(bevelBox(0.006, 0.006, 0.012, 0.0012, C.metalWorn, [0.012, -0.004, 0.122])); // pojistka vpravo za závěrem
  // Základna pro kroužky (dvoudílná montáž) – přišroubovaná na pouzdře.
  for (const z of [-0.075, 0.07]) metal.push(bevelBox(0.016, 0.006, 0.03, 0.0015, C.blued, [0, 0.0185, z]));
  // Lučík, spoušť, dno schránky (kovové).
  metal.push(sideProfile([[0.0, -0.05], [-0.004, -0.075], [0.074, -0.077], [0.078, -0.05], [0.07, -0.05], [0.066, -0.069], [0.006, -0.069], [0.008, -0.05]], 0.012, 0.0015, C.blued));
  metal.push(sideProfile([[0.03, -0.051], [0.034, -0.065], [0.028, -0.069], [0.024, -0.053]], 0.005, 0.0008, C.metalWorn));
  metal.push(bevelBox(0.024, 0.004, 0.095, 0.0012, C.blued, [0, -0.0535, -0.05])); // dno schránky

  // --- Hlaveň: těžký profil se zúžením, korunka ústí. ---
  const B = 0.74;
  metal.push(lathe(fwd([[0, 0.118], [0.0168, 0.118], [0.0168, 0.16], [0.0148, 0.2], [0.0128, 0.42], [0.0112, B - 0.004], [0.0098, B], [0.004, B], [0, B]]), S(20), C.blued, 0, 0));

  // --- Kompozitní pažba (OD), stupňovitý polopistolový krk, nastavitelná botka. ---
  const stock: P2[] = [
    [-0.43, -0.004], [-0.15, 0.003], [-0.118, 0.006], [0.11, 0.006], [0.16, 0.002], [0.2, 0.012], [0.42, 0.018], [0.43, 0.016],
    [0.43, -0.135], [0.41, -0.14], [0.27, -0.1], [0.19, -0.088], [0.15, -0.125], [0.115, -0.135], [0.095, -0.118], [0.085, -0.075], [0.078, -0.05],
    [-0.012, -0.05], [-0.03, -0.054], [-0.4, -0.046], [-0.43, -0.036],
  ];
  poly.push(sideProfile(stock, 0.05, 0.008, OD));
  // Rýhovaná (stipplovaná) místa úchopu – tenké destičky na bocích.
  for (const sx of [-1, 1]) {
    poly.push(sideProfile([[0.09, -0.06], [0.14, -0.064], [0.155, -0.11], [0.12, -0.12], [0.1, -0.1]], 0.002, 0.0006, OD_DARK, sx * 0.0255));
    poly.push(sideProfile([[-0.34, -0.012], [-0.17, -0.008], [-0.17, -0.04], [-0.34, -0.04]], 0.002, 0.0006, OD_DARK, sx * 0.0255));
  }
  // Botka s distančními vložkami a pryžová opěrka.
  for (let i = 0; i < 2; i++) poly.push(bevelBox(0.048, 0.152, 0.006, 0.002, i ? '#22251e' : RUBBER, [0, -0.06, 0.434 + i * 0.006]));
  poly.push(bevelBox(0.05, 0.158, 0.018, 0.006, RUBBER, [0, -0.06, 0.452]));
  // Poutka a čep dvojnožky.
  metal.push(bevelBox(0.008, 0.008, 0.022, 0.002, C.metalDark, [0, -0.142, 0.36]));
  metal.push(bevelBox(0.008, 0.008, 0.022, 0.002, C.metalDark, [0, -0.052, -0.39]));

  // --- Sklopená dvojnožka pod předpažbím. ---
  metal.push(bevelBox(0.05, 0.014, 0.03, 0.003, C.metalDark, [0, -0.064, -0.4]));
  for (const sx of [-1, 1]) {
    metal.push(tube(0.0055, -0.39, -0.16, S(10), C.metal, sx * 0.016, -0.07));
    metal.push(tube(0.0042, -0.16, -0.12, S(10), C.metalDark, sx * 0.016, -0.07));
    metal.push(bevelBox(0.012, 0.006, 0.012, 0.0015, RUBBER, [sx * 0.016, -0.07, -0.112]));
  }

  // --- Puškohled 10× (umělecký odhad tvaru, ne konkrétní výrobek): okulár, tubus 1", objektiv. ---
  const axisY = 0.056;
  const z0 = 0.205, z1 = -0.175;
  metal.push(scopeBody([
    [0.0185, z0], [0.0205, z0 - 0.004], [0.0205, z0 - 0.05], [0.0175, z0 - 0.06], [0.0135, z0 - 0.085],
    [0.0128, z0 - 0.095], [0.0128, -0.085], [0.0145, -0.1], [0.0235, z1 + 0.04], [0.0245, z1 + 0.036], [0.0245, z1 + 0.004], [0.0232, z1],
  ], 0.0112, axisY, S));
  // Kroužky (horní půlka + matice) na základně.
  for (const z of [-0.075, 0.07]) {
    metal.push(lathe(fwd([[0.0129, -z - 0.008], [0.0158, -z - 0.008], [0.0158, -z + 0.008], [0.0129, -z + 0.008], [0.0129, -z - 0.008]]), S(20), C.blued, 0, axisY));
    metal.push(bevelBox(0.02, axisY - 0.0215 - 0.012, 0.014, 0.0015, C.blued, [0, (axisY - 0.012 + 0.0215) / 2, z]));
    metal.push(bevelBox(0.008, 0.008, 0.01, 0.0015, C.metalWorn, [0.016, 0.026, z]));
  }
  // Věže: elevace nahoře, náměr vpravo, paralaxa vlevo.
  metal.push(transform(turret(0.0118, 0.022, S), [0, axisY + 0.011, -0.004], [-Math.PI / 2, 0, 0]));
  metal.push(transform(turret(0.0118, 0.02, S), [0.011, axisY, -0.004], [0, Math.PI / 2, 0]));
  metal.push(transform(turret(0.009, 0.012, S), [-0.011, axisY, -0.004], [0, -Math.PI / 2, 0]));
  metal.push(lathe([[0.0122, -0.019], [0.0168, -0.019], [0.0172, -0.015], [0.0172, 0.007], [0.0168, 0.011], [0.0122, 0.011], [0.0122, -0.019]], S(22), SCOPE, 0, axisY)); // sedlo věží (dutý prstenec)
  // Okulárové sklo (tmavé).
  const glass = new THREE.CircleGeometry(0.0112, S(24));
  glass.translate(0, axisY, z0 - 0.012);

  // --- Pohyblivé díly: závěr (tělo + páka s kulovou hlavicí), náboj v ruce. ---
  const boltPivot = new THREE.Vector3(0, 0, 0.08);
  // Páka: z pravého boku závěru šikmo dolů ven, na konci kulová hlavice (osa páky = lokální +Z → +X, sklon 0,4 rad).
  const arm = (g: THREE.BufferGeometry, x: number) => g.rotateY(Math.PI / 2).rotateZ(-0.4).translate(x * Math.cos(0.4), -x * Math.sin(0.4), boltPivot.z);
  const bolt = merge([
    lathe([[0, -0.06], [0.0092, -0.06], [0.0092, 0.12], [0, 0.12]], S(14), C.metalWorn, 0, 0), // tělo závěru (v pouzdře)
    arm(lathe([[0, 0], [0.0042, 0], [0.0042, 0.044], [0, 0.044]], S(10), C.metalWorn), 0.008),
    arm(lathe([[0, -0.009], [0.0062, -0.0075], [0.0088, -0.003], [0.0088, 0.003], [0.0062, 0.0075], [0, 0.009]], S(12), C.blued), 0.056),
  ]);
  bolt.translate(0, 0, -boltPivot.z);
  const round = cartridge(S);
  const port = new THREE.Vector3(0.006, 0.02, -0.005);

  const P: WeaponPoints = {
    weaponRoot: new THREE.Vector3(),
    muzzle: new THREE.Vector3(0, 0, -B),
    sightRear: new THREE.Vector3(0, axisY, z0),
    sightFront: new THREE.Vector3(0, axisY, z1),
    opticEye: new THREE.Vector3(0, axisY, z0 + 0.085),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.09, 0.118),
    gripLeft: new THREE.Vector3(0, -0.048, -0.27),
    magazineSocket: port.clone(),
    ejectionPort: new THREE.Vector3(0.018, 0.01, 0.0),
    chargingHandle: new THREE.Vector3(0.056 * Math.cos(0.4), -0.056 * Math.sin(0.4), boltPivot.z),
    boltCatch: new THREE.Vector3(0.012, -0.004, 0.122),
    loadingPort: port,
  };
  const m = merge(metal), p = merge(poly);
  return {
    id: 'm24',
    name: 'M24',
    static: { metal: m, polymer: p },
    moving: {
      magazine: { geometry: round, material: 'metal', pivot: port.clone() },
      chargingHandle: { geometry: bolt, material: 'metal', pivot: boltPivot, travel: new THREE.Vector3(0, 0, 0.1) },
    },
    optic: { lensZ: z0 - 0.012, axisY, innerR: 0.0112, glass, kind: 'scope', zoom: 10, reticle: 'mildot' },
    sight: 'optic',
    points: P,
    hipRoot: hipFromGrip(P.gripRight, [0, 0.0, 0.02]),
    hipRot: new THREE.Euler(0.02, 0.05, 0),
    magRock: 0,
    emptyAction: 'bolt',
    reloadStyle: 'bolt',
    cycle: 'bolt',
    magSide: 0,
    triangles: triCount(m, p, round, bolt, glass),
  };
}

export function buildSVD(segScale = 1): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const wood: THREE.BufferGeometry[] = [];
  const SY = 0.046;

  // --- Pouzdro (frézované, delší než AK), víko, okno vyhazování, páka závěru vpravo. ---
  const rearZ = 0.135;
  metal.push(sideProfile([[rearZ, 0.012], [rearZ, -0.022], [rearZ - 0.02, -0.036], [-0.13, -0.036], [-0.13, 0.012]], 0.033, 0.0015, C.blued));
  metal.push(crossProfile([[-0.0168, 0.008], [0.0168, 0.008], [0.0168, 0.018], [0.0125, 0.0265], [0.006, 0.0305], [-0.006, 0.0305], [-0.0125, 0.0265], [-0.0168, 0.018]], rearZ + 0.004, -0.122, 0.0012, C.blued));
  metal.push(bevelBox(0.008, 0.006, 0.008, 0.0015, C.metalWorn, [0, 0.012, rearZ + 0.008]));
  metal.push(plainBox(0.0015, 0.011, 0.07, C.metalDark, [0.0168, 0.004, 0.0]));
  // Pojistka (velká páka vpravo) a boční lišta montáže vlevo.
  metal.push(sideProfile([[0.12, 0.004], [0.12, -0.004], [-0.02, -0.006], [-0.035, -0.012], [-0.04, -0.007], [-0.028, 0.003]], 0.0022, 0.0006, C.blued, 0.0182));
  metal.push(bevelBox(0.004, 0.018, 0.13, 0.001, C.blued, [-0.0185, -0.006, 0.01]));
  // Lučík, spoušť, záchyt zásobníku.
  metal.push(sideProfile([[0.0, -0.035], [-0.002, -0.062], [0.064, -0.062], [0.066, -0.035], [0.06, -0.035], [0.06, -0.056], [0.004, -0.056], [0.006, -0.035]], 0.01, 0.0012, C.blued));
  metal.push(sideProfile([[0.028, -0.036], [0.032, -0.052], [0.026, -0.056], [0.022, -0.038]], 0.005, 0.0008, C.metalWorn));
  metal.push(bevelBox(0.014, 0.006, 0.01, 0.0015, C.metalWorn, [0, -0.052, 0.0]));

  // --- Hledí (záložní mechanická mířidla), plynová trubice, předpažbí, hlaveň. ---
  const rsZ = -0.125;
  metal.push(sideProfile([[rsZ, 0.0], [rsZ, 0.026], [rsZ - 0.012, 0.034], [rsZ - 0.07, 0.03], [rsZ - 0.08, 0.016], [rsZ - 0.08, 0.0]], 0.026, 0.0015, C.blued));
  metal.push(bevelBox(0.016, 0.003, 0.06, 0.0008, C.blued, [0, 0.0345, rsZ - 0.036], [-0.03, 0, 0]));
  const gasEnd = -0.42;
  metal.push(tube(0.0098, rsZ - 0.08, gasEnd, S(16), C.blued, 0, 0.027));
  // Předpažbí: dvě dřevěné poloviny s větracími otvory (SVD má charakteristické podélné průduchy).
  const hgZ0 = rsZ - 0.085, hgZ1 = -0.395;
  const hg: P2[] = [[-0.021, 0.032], [0.021, 0.032], [0.0245, 0.016], [0.0245, -0.006], [0.02, -0.022], [0.0, -0.028], [-0.02, -0.022], [-0.0245, -0.006], [-0.0245, 0.016]];
  wood.push(crossProfile(hg, hgZ0, hgZ1, 0.004, WOOD));
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) wood.push(plainBox(0.0014, 0.0075, 0.022, '#1d1410', [sx * 0.0246, 0.006, hgZ0 - 0.02 - i * 0.032]));
  metal.push(crossProfile(hg.map(([x, y]) => [x * 1.07, y * 1.07] as P2), hgZ1 + 0.002, hgZ1 - 0.01, 0.001, C.blued)); // objímka
  metal.push(crossProfile(hg.map(([x, y]) => [x * 1.05, y * 1.05] as P2), hgZ0 + 0.008, hgZ0 - 0.002, 0.001, C.blued));
  // Plynový blok s regulátorem.
  metal.push(sideProfile([[gasEnd, -0.012], [gasEnd, 0.04], [gasEnd - 0.012, 0.04], [gasEnd - 0.036, 0.014], [gasEnd - 0.036, -0.012]], 0.024, 0.0015, C.blued));
  metal.push(transform(lathe([[0, 0], [0.0075, 0], [0.0075, 0.016], [0, 0.016]], S(12), C.metalWorn), [0.012, 0.027, gasEnd - 0.02], [0, Math.PI / 2, 0]));
  const barrelEnd = -0.66;
  metal.push(lathe(fwd([[0, 0.13], [0.0102, 0.13], [0.0102, 0.32], [0.0092, 0.33], [0.0088, -barrelEnd], [0, -barrelEnd]]), S(18), C.blued, 0, 0));
  // Muška v krytu na bloku u ústí.
  const fsZ = barrelEnd + 0.02;
  metal.push(sideProfile([[fsZ + 0.018, -0.012], [fsZ + 0.018, 0.012], [fsZ + 0.012, 0.033], [fsZ - 0.01, 0.033], [fsZ - 0.016, 0.012], [fsZ - 0.016, -0.012]], 0.022, 0.0015, C.blued));
  metal.push(bevelBox(0.0022, SY - 0.032, 0.0022, 0.0005, C.metalDark, [0, (SY + 0.032) / 2, fsZ]));
  for (const sx of [-1, 1]) metal.push(bevelBox(0.0022, 0.016, 0.014, 0.0006, C.blued, [sx * 0.0085, SY - 0.004, fsZ]));
  // Štěrbinový tlumič plamene (5 podélných štěrbin).
  const fh0 = barrelEnd, fhLen = 0.075;
  metal.push(lathe(fwd([[0, -fh0], [0.0112, -fh0], [0.0112, -fh0 + fhLen], [0.0094, -fh0 + fhLen + 0.003], [0.0075, -fh0 + fhLen + 0.003], [0.0075, -fh0 + 0.01], [0, -fh0 + 0.01]]), S(18), C.blued, 0, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    metal.push(transform(plainBox(0.0028, 0.0018, 0.05, C.metalDark, [0, 0, 0]), [Math.cos(a) * 0.0108, Math.sin(a) * 0.0108, fh0 - 0.045], [0, 0, a - Math.PI / 2]));
  }

  // --- Pažba s průchodem pro palec (skeletová), lícnice, pryžová botka. ---
  // Horní rám (hřbet a lícnice) a spodní rám s rukojetí jako dva profily – mezi nimi otvor.
  wood.push(sideProfile([[rearZ, 0.012], [0.17, 0.006], [0.25, 0.004], [0.42, -0.002], [0.43, -0.004], [0.43, -0.05], [0.33, -0.042], [0.2, -0.036], [0.15, -0.03], [rearZ, -0.022]], 0.036, 0.006, WOOD));
  wood.push(sideProfile([[0.21, 0.032], [0.37, 0.03], [0.38, 0.016], [0.37, -0.004], [0.21, 0.0], [0.2, 0.018]], 0.03, 0.006, WOOD_DARK)); // lícnice
  wood.push(sideProfile([[0.062, -0.036], [0.1, -0.036], [0.15, -0.06], [0.33, -0.1], [0.43, -0.13], [0.43, -0.145], [0.41, -0.152], [0.27, -0.13], [0.15, -0.135], [0.122, -0.14], [0.098, -0.11], [0.08, -0.07]], 0.034, 0.006, WOOD));
  wood.push(sideProfile([[0.43, -0.004], [0.44, -0.004], [0.44, -0.145], [0.43, -0.145]], 0.036, 0.003, WOOD_DARK)); // zadní sloupek
  wood.push(bevelBox(0.04, 0.152, 0.012, 0.004, RUBBER, [0, -0.073, 0.448]));
  metal.push(bevelBox(0.008, 0.008, 0.02, 0.002, C.metalDark, [0, -0.15, 0.38]));

  // --- PSO-1 4× na boční montáži vlevo (umělecký odhad tvaru). ---
  const axisY = 0.088;
  const z0 = 0.14, z1 = -0.24;
  // Rameno montáže: boční deska na liště, most přes víko, sedlo pod tubusem.
  metal.push(bevelBox(0.008, 0.028, 0.11, 0.002, SCOPE, [-0.025, -0.002, 0.01]));
  metal.push(sideProfile([[0.06, 0.008], [0.06, 0.062], [-0.05, 0.062], [-0.05, 0.008], [-0.03, 0.008], [-0.026, 0.036], [0.036, 0.036], [0.04, 0.008]], 0.008, 0.0015, SCOPE, -0.024));
  metal.push(bevelBox(0.03, 0.01, 0.11, 0.002, SCOPE, [-0.008, 0.066, 0.005]));
  metal.push(bevelBox(0.006, 0.014, 0.012, 0.0015, C.metalWorn, [-0.031, -0.004, 0.03])); // upínací páka
  metal.push(scopeBody([
    [0.016, z0 - 0.068], [0.0185, z0 - 0.07], [0.0185, -0.12], [0.0205, -0.15], [0.0215, z1 + 0.05], [0.0215, z1],
  ], 0.0125, axisY, S));
  // Pryžová očnice (dlouhá, PSO-1) – samostatný dutý díl za okulárem.
  metal.push(lathe([[0.0165, z0 - 0.07], [0.0205, z0 - 0.07], [0.0215, z0 - 0.02], [0.0235, z0], [0.0205, z0], [0.0175, z0 - 0.03], [0.0165, z0 - 0.07]], S(22), RUBBER, 0, axisY, true));
  // Sluneční clona objektivu.
  metal.push(lathe(fwd([[0.0205, -z1], [0.0225, -z1], [0.0225, -z1 + 0.06], [0.0205, -z1 + 0.06], [0.0205, -z1]]), S(22), SCOPE, 0, axisY));
  // Věže (elevace nahoře, náměr vpravo) a pouzdro baterie osvětlení vlevo.
  metal.push(lathe([[0.0135, -0.057], [0.0182, -0.057], [0.0188, -0.052], [0.0188, -0.018], [0.0182, -0.013], [0.0135, -0.013], [0.0135, -0.057]], S(22), SCOPE, 0, axisY)); // sedlo věží (dutý prstenec)
  metal.push(transform(turret(0.012, 0.018, S), [0, axisY + 0.015, -0.035], [-Math.PI / 2, 0, 0]));
  metal.push(transform(turret(0.012, 0.018, S), [0.015, axisY, -0.035], [0, Math.PI / 2, 0]));
  metal.push(transform(lathe([[0, 0], [0.007, 0], [0.007, 0.022], [0, 0.022]], S(12), SCOPE), [-0.015, axisY - 0.006, -0.035], [0, -Math.PI / 2, 0]));
  const glass = new THREE.CircleGeometry(0.0125, S(24));
  glass.translate(0, axisY, z0 - 0.08);

  // --- Pohyblivé díly: zásobník 10 nábojů 7,62×54R (mírně zahnutý), páka závěru. ---
  const magLen = 0.135, magDepth = 0.082;
  const magGeo = merge([
    curvedMag(magLen, magDepth, 0.026, 0.018, '#2b2c2b'),
    bevelBox(0.028, 0.008, 0.012, 0.002, '#2b2c2b', [0, -0.004, -magDepth / 2]),
    bevelBox(0.03, 0.008, magDepth + 0.006, 0.002, '#1e1f1e', [0, -magLen, -0.016]),
    ...[-1, 1].map((sx) => bevelBox(0.0018, 0.09, 0.05, 0.0006, '#232423', [sx * 0.0135, -0.06, -0.004])),
  ]);
  const handle = merge([
    bevelBox(0.016, 0.006, 0.008, 0.0015, C.blued, [0.008, 0, 0]),
    transform(lathe([[0, 0], [0.0065, 0], [0.0065, 0.01], [0.005, 0.012], [0, 0.012]], S(12), C.blued), [0.014, 0, 0], [0, Math.PI / 2, 0]),
  ]);

  const P: WeaponPoints = {
    weaponRoot: new THREE.Vector3(),
    muzzle: new THREE.Vector3(0, 0, barrelEnd - fhLen - 0.003),
    sightRear: new THREE.Vector3(0, axisY, z0 - 0.068),
    sightFront: new THREE.Vector3(0, axisY, z1),
    opticEye: new THREE.Vector3(0, axisY, z0 + 0.045),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.088, 0.105),
    gripLeft: new THREE.Vector3(0, -0.026, -0.28),
    magazineSocket: new THREE.Vector3(0, -0.036, -0.04),
    ejectionPort: new THREE.Vector3(0.017, 0.006, 0.01),
    chargingHandle: new THREE.Vector3(0.0168, 0.008, -0.05),
    boltCatch: new THREE.Vector3(0.03, 0.008, -0.05),
  };
  const m = merge(metal), w = merge(wood);
  return {
    id: 'svd',
    name: 'SVD',
    static: { metal: m, polymer: w },
    moving: {
      magazine: { geometry: magGeo, material: 'polymer', pivot: P.magazineSocket.clone() },
      chargingHandle: { geometry: handle, material: 'metal', pivot: P.chargingHandle.clone(), travel: new THREE.Vector3(0, 0, 0.13) },
    },
    optic: { lensZ: z0 - 0.08, axisY, innerR: 0.0125, glass, kind: 'scope', zoom: 4, reticle: 'pso1' },
    sight: 'optic',
    points: P,
    hipRoot: hipFromGrip(P.gripRight, [0, 0.0, 0.01]),
    hipRot: new THREE.Euler(0.02, 0.05, 0),
    magRock: 0.6,
    emptyAction: 'chargingHandle',
    reloadStyle: 'magazine',
    cycle: 'none',
    magSide: 0,
    triangles: triCount(m, w, magGeo, handle, glass),
  };
}
