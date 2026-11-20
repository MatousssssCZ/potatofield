import * as THREE from 'three';
import { bevelBox, fwd, lathe, merge, plainBox, sideProfile, transform, tube, type P2 } from './meshkit';
import { PAL as C, hipFromGrip, triCount, type WeaponModel, type WeaponPoints } from './types';

/**
 * Odstřelovací pušky (Sniper), obě opakovačky: M24 (USMC) a SV-98 (MEC). Rozměry jsou umělecký
 * odhad (docs/weapons/M24.md, SV-98.md), ne výkresové míry. Kořen: osa vývrtu y = 0, z = 0 u zadní
 * hrany šachty zásobníku / čela lučíku. Obě mají puškohled se zvětšením: tubus je dutý
 * (osa průhledu volná), okulár nese tmavé sklo; zaměřovací obraz kreslí hra přes celou obrazovku.
 *
 * M24: opakovací (otočný závěr Remington 700), kompozitní pažba s nastavitelnou botkou,
 * těžká hlaveň, sklopená dvojnožka, puškohled 10× na dvou kroužcích. Nabíjí se po jednom
 * nábojem do otevřeného závěru (pevná schránka 5 nábojů).
 * SV-98: viz buildSV98.
 */

type Seg = (n: number) => number;

const OD = '#3d4234';
const OD_DARK = '#30352a';
const RUBBER = '#161616';
const SCOPE = '#1b1c1d';

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

const LAMINATE = '#6a5a47';
const LAMINATE_DARK = '#52463a';

/**
 * SV-98 (MEC): opakovací odstřelovací puška ruské konstrukce – válcové pouzdro s dlouhou lištou,
 * těžká volná hlaveň s úsťovým zařízením, vrstvená dřevěná pažba s průchodem pro palec,
 * nastavitelnou lícnicí a botkou, odnímatelný krátký zásobník, rovná páka závěru s kulovou hlavicí,
 * záložní mířidla a puškohled 7× v kroužcích na liště. Umělecký odhad tvaru (délka ~1,2 m,
 * hlaveň ~0,65 m), ne výkresové míry. Přebíjí se výměnou zásobníku, po výstřelu cykluje závěr.
 */
export function buildSV98(segScale = 1): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const wood: THREE.BufferGeometry[] = [];

  // --- Pouzdro (válcové) se zadním krytem závěru, okno vyhazování vpravo, lišta nahoře. ---
  const rR = 0.0172;
  metal.push(lathe([[0, -0.125], [0.018, -0.125], [rR, -0.118], [rR, 0.1], [0.0148, 0.108], [0, 0.108]], S(24), C.blued, 0, 0));
  metal.push(lathe([[0, 0.108], [0.013, 0.108], [0.013, 0.142], [0.0095, 0.152], [0, 0.152]], S(18), C.blued, 0, 0));
  metal.push(plainBox(0.0012, 0.015, 0.08, C.metalDark, [0.0168, 0.007, 0.0]));
  // Lišta (Picatinny) po celé délce pouzdra s příčnými drážkami.
  const railY = 0.0215;
  metal.push(bevelBox(0.021, 0.008, 0.27, 0.0012, C.metalDark, [0, railY, -0.005]));
  for (let i = 0; i < 18; i++) metal.push(plainBox(0.0215, 0.0022, 0.0045, '#1d1e1f', [0, railY + 0.0035, -0.135 + i * 0.0155]));
  // Pojistka (posuvná) za závěrem vpravo a záchyt zásobníku.
  metal.push(bevelBox(0.006, 0.007, 0.014, 0.0012, C.metalWorn, [0.013, -0.006, 0.118]));
  metal.push(bevelBox(0.008, 0.006, 0.012, 0.0015, C.metalWorn, [0, -0.06, -0.068]));
  // Lučík (široký, i pro rukavici) a spoušť.
  metal.push(sideProfile([[0.006, -0.05], [0.0, -0.082], [0.082, -0.084], [0.088, -0.05], [0.079, -0.05], [0.075, -0.075], [0.01, -0.075], [0.014, -0.05]], 0.013, 0.0015, C.blued));
  metal.push(sideProfile([[0.036, -0.051], [0.04, -0.067], [0.034, -0.071], [0.03, -0.053]], 0.005, 0.0008, C.metalWorn));

  // --- Hlaveň: těžký profil, úsťové zařízení s průduchy, muška v krytu, záložní hledí na liště. ---
  const B = 0.70;
  metal.push(lathe(fwd([[0, 0.125], [0.0162, 0.125], [0.0162, 0.17], [0.0142, 0.21], [0.0126, 0.45], [0.0114, B - 0.06], [0, B - 0.06]]), S(20), C.blued, 0, 0));
  const md0 = B - 0.065;
  metal.push(lathe(fwd([[0, md0], [0.0145, md0], [0.0145, B - 0.004], [0.0125, B], [0.006, B], [0, B]]), S(20), C.blued, 0, 0));
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) metal.push(plainBox(0.0025, 0.0065, 0.009, '#121314', [sx * 0.0137, 0, -(md0 + 0.012 + i * 0.016)]));
  const fsZ = -(md0 - 0.03);
  metal.push(sideProfile([[fsZ + 0.014, 0.008], [fsZ + 0.012, 0.03], [fsZ - 0.012, 0.03], [fsZ - 0.016, 0.008]], 0.014, 0.0015, C.blued));
  metal.push(bevelBox(0.0022, 0.016, 0.0022, 0.0005, C.metalDark, [0, 0.032, fsZ]));
  metal.push(lathe(fwd([[0.0118, -fsZ - 0.018], [0.0168, -fsZ - 0.018], [0.0168, -fsZ + 0.018], [0.0118, -fsZ + 0.018], [0.0118, -fsZ - 0.018]]), S(16), C.blued, 0, 0)); // objímka mušky
  metal.push(sideProfile([[0.135, railY + 0.004], [0.135, railY + 0.03], [0.118, railY + 0.03], [0.112, railY + 0.004]], 0.018, 0.0015, C.blued)); // dioptr vzadu (sklopený)

  // --- Vrstvená pažba: dlouhé předpažbí, krk s průchodem pro palec, lícnice, botka. ---
  // Předpažbí a lůžko pouzdra (plochý spodek, hlaveň volně nad ním).
  wood.push(sideProfile([[-0.46, 0.002], [-0.13, 0.008], [0.1, 0.008], [0.1, -0.05], [-0.01, -0.05], [-0.03, -0.056], [-0.44, -0.046], [-0.465, -0.03]], 0.05, 0.008, LAMINATE));
  // Horní rám pažby (hřbet) a spodní rám s pistolovou rukojetí – mezi nimi průchod pro palec.
  wood.push(sideProfile([[0.1, 0.008], [0.2, 0.0], [0.43, -0.006], [0.44, -0.012], [0.44, -0.05], [0.33, -0.045], [0.21, -0.04], [0.16, -0.032], [0.1, -0.03]], 0.04, 0.007, LAMINATE));
  wood.push(sideProfile([[0.085, -0.05], [0.115, -0.05], [0.165, -0.074], [0.33, -0.112], [0.44, -0.136], [0.44, -0.152], [0.42, -0.158], [0.28, -0.14], [0.16, -0.142], [0.13, -0.148], [0.104, -0.118], [0.092, -0.08]], 0.038, 0.007, LAMINATE));
  wood.push(sideProfile([[0.44, -0.004], [0.452, -0.004], [0.452, -0.152], [0.44, -0.152]], 0.04, 0.003, LAMINATE_DARK));
  // Pažba za průchodem pro palec je plná (otvor jen u rukojeti).
  wood.push(sideProfile([[0.24, -0.04], [0.44, -0.05], [0.44, -0.137], [0.33, -0.113], [0.24, -0.09]], 0.036, 0.004, LAMINATE));
  // Vrstvy laminátu (tenké tmavší pruhy na bocích předpažbí a pažby).
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    wood.push(plainBox(0.0008, 0.0016, 0.3, LAMINATE_DARK, [sx * 0.0253, -0.014 - i * 0.011, -0.29]));
    wood.push(plainBox(0.0008, 0.0016, 0.2, LAMINATE_DARK, [sx * 0.0203, -0.018 - i * 0.009, 0.33]));
  }
  // Nastavitelná lícnice na dvou čepech.
  wood.push(sideProfile([[0.21, 0.016], [0.38, 0.012], [0.39, 0.004], [0.38, -0.008], [0.21, -0.004], [0.2, 0.008]], 0.032, 0.005, LAMINATE_DARK));
  for (const z of [0.25, 0.35]) metal.push(bevelBox(0.007, 0.012, 0.007, 0.0015, C.metalWorn, [0, 0.0, z]));
  // Nastavitelná botka: kovové vložky a pryžová opěrka.
  metal.push(bevelBox(0.03, 0.12, 0.008, 0.002, C.metalDark, [0, -0.078, 0.457]));
  wood.push(bevelBox(0.044, 0.158, 0.02, 0.006, RUBBER, [0, -0.078, 0.472]));
  // Poutka.
  metal.push(bevelBox(0.008, 0.008, 0.022, 0.002, C.metalDark, [0, -0.156, 0.37]));
  metal.push(bevelBox(0.008, 0.008, 0.022, 0.002, C.metalDark, [0, -0.052, -0.4]));

  // --- Dvojnožka na čele předpažbí, sklopená dopředu pod hlaveň (levá ruka drží předpažbí). ---
  metal.push(bevelBox(0.046, 0.012, 0.026, 0.003, C.metalDark, [0, -0.04, -0.455]));
  for (const sx of [-1, 1]) {
    metal.push(tube(0.0052, -0.465, -0.66, S(10), C.metal, sx * 0.014, -0.03));
    metal.push(bevelBox(0.011, 0.006, 0.012, 0.0015, RUBBER, [sx * 0.014, -0.03, -0.665]));
  }

  // --- Puškohled 7× v kroužcích na liště (umělecký odhad tvaru, ne konkrétní výrobek). ---
  const axisY = 0.06;
  const z0 = 0.19, z1 = -0.17;
  metal.push(scopeBody([
    [0.019, z0], [0.0205, z0 - 0.004], [0.0205, z0 - 0.045], [0.017, z0 - 0.058], [0.0135, z0 - 0.08],
    [0.0128, z0 - 0.09], [0.0128, -0.075], [0.015, -0.095], [0.0215, z1 + 0.04], [0.0225, z1 + 0.034], [0.0225, z1 + 0.004], [0.0212, z1],
  ], 0.0112, axisY, S));
  for (const z of [-0.07, 0.065]) {
    metal.push(lathe(fwd([[0.0129, -z - 0.008], [0.0162, -z - 0.008], [0.0162, -z + 0.008], [0.0129, -z + 0.008], [0.0129, -z - 0.008]]), S(20), C.metalDark, 0, axisY));
    metal.push(bevelBox(0.024, axisY - 0.0129 - railY - 0.004, 0.016, 0.0015, C.metalDark, [0, (axisY - 0.0129 + railY + 0.004) / 2, z]));
    metal.push(bevelBox(0.006, 0.01, 0.012, 0.0015, C.metalWorn, [0.015, railY + 0.004, z])); // příčný šroub
  }
  metal.push(transform(turret(0.0115, 0.02, S), [0, axisY + 0.011, 0.0], [-Math.PI / 2, 0, 0]));
  metal.push(transform(turret(0.0115, 0.018, S), [0.011, axisY, 0.0], [0, Math.PI / 2, 0]));
  metal.push(lathe([[0.0122, -0.015], [0.0166, -0.015], [0.017, -0.011], [0.017, 0.011], [0.0166, 0.015], [0.0122, 0.015], [0.0122, -0.015]], S(22), SCOPE, 0, axisY));
  metal.push(lathe(fwd([[0.0212, -z1], [0.023, -z1], [0.023, -z1 + 0.05], [0.0212, -z1 + 0.05], [0.0212, -z1]]), S(22), SCOPE, 0, axisY)); // sluneční clona
  const glass = new THREE.CircleGeometry(0.0112, S(24));
  glass.translate(0, axisY, z0 - 0.012);

  // --- Pohyblivé díly: zásobník (krátký, 7,62×54R) a závěr s rovnou pákou. ---
  const magDepth = 0.07, magLen = 0.062;
  const magGeo = merge([
    bevelBox(0.03, magLen, magDepth, 0.003, '#232425', [0, -magLen / 2, -magDepth / 2 + 0.006]),
    bevelBox(0.033, 0.008, magDepth + 0.006, 0.002, '#191a1b', [0, -magLen - 0.002, -magDepth / 2 + 0.006]),
    ...[-1, 1].map((sx) => plainBox(0.0012, magLen * 0.6, magDepth * 0.55, '#1a1b1c', [sx * 0.0153, -magLen * 0.5, -magDepth / 2 + 0.006])),
  ]);
  const boltPivot = new THREE.Vector3(0, 0, 0.075);
  const arm = (g: THREE.BufferGeometry, x: number) => g.rotateY(Math.PI / 2).rotateZ(-0.62).translate(x * Math.cos(0.62), -x * Math.sin(0.62), boltPivot.z);
  const bolt = merge([
    lathe([[0, -0.06], [0.0094, -0.06], [0.0094, 0.115], [0, 0.115]], S(14), C.metalWorn, 0, 0),
    arm(lathe([[0, 0], [0.0045, 0], [0.0045, 0.05], [0, 0.05]], S(10), C.metalWorn), 0.008),
    arm(lathe([[0, -0.0095], [0.0068, -0.008], [0.0096, -0.003], [0.0096, 0.003], [0.0068, 0.008], [0, 0.0095]], S(12), C.blued), 0.063),
  ]);
  bolt.translate(0, 0, -boltPivot.z);

  const P: WeaponPoints = {
    weaponRoot: new THREE.Vector3(),
    muzzle: new THREE.Vector3(0, 0, -B),
    sightRear: new THREE.Vector3(0, axisY, z0),
    sightFront: new THREE.Vector3(0, axisY, z1),
    opticEye: new THREE.Vector3(0, axisY, z0 + 0.085),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.095, 0.124),
    gripLeft: new THREE.Vector3(0, -0.05, -0.29),
    magazineSocket: new THREE.Vector3(0, -0.05, -0.03),
    ejectionPort: new THREE.Vector3(0.018, 0.01, 0.0),
    chargingHandle: new THREE.Vector3(0.063 * Math.cos(0.62), -0.063 * Math.sin(0.62), boltPivot.z),
    boltCatch: new THREE.Vector3(0.013, -0.006, 0.118),
  };
  const m = merge(metal), w = merge(wood);
  return {
    id: 'svd',
    name: 'SV-98',
    static: { metal: m, polymer: w },
    moving: {
      magazine: { geometry: magGeo, material: 'polymer', pivot: P.magazineSocket.clone() },
      chargingHandle: { geometry: bolt, material: 'metal', pivot: boltPivot, travel: new THREE.Vector3(0, 0, 0.095) },
    },
    optic: { lensZ: z0 - 0.012, axisY, innerR: 0.0112, glass, kind: 'scope', zoom: 7, reticle: 'pso1' },
    sight: 'optic',
    points: P,
    hipRoot: hipFromGrip(P.gripRight, [0, 0.0, 0.02]),
    hipRot: new THREE.Euler(0.02, 0.05, 0),
    magRock: 0.3,
    emptyAction: 'bolt',
    reloadStyle: 'magazine',
    cycle: 'bolt',
    magSide: 0,
    triangles: triCount(m, w, magGeo, bolt, glass),
  };
}
