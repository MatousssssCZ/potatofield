import * as THREE from 'three';
import { bevelBox, crossProfile, fwd, lathe, merge, plainBox, sideProfile, transform, tube, type P2 } from './meshkit';
import { PAL as C, hipFromGrip, triCount, type WeaponModel, type WeaponPoints } from './types';

/**
 * Pásové kulomety (Support): M249 (USMC) a PKM (MEC). Mechanická mířidla, složená dvojnožka,
 * podávací víko na závěsu vpředu (pohyblivý díl), schránka s krátkým úsekem pásu.
 * Pás je jeden sloučený celek se schránkou: při otevřeném víku leží na podávacím lůžku,
 * při zavřeném je pod víkem (nikdy jím neprochází). Kořen: osa vývrtu y = 0, z = 0 u lůžka.
 * Rozměry jsou umělecký odhad (docs/weapons/*.md).
 */

type Seg = (n: number) => number;

/** Náboje pásu podél cesty (x, y) v rovině průřezu, osa náboje podél −Z. */
function beltRounds(path: Array<[number, number]>, len: number, r: number, rim: boolean, S: Seg) {
  const parts: THREE.BufferGeometry[] = [];
  const zr = len * 0.45;
  for (const [x, y] of path) {
    const prof: Array<[number, number]> = [[0, zr]];
    if (rim) prof.push([r * 1.18, zr], [r * 1.18, zr - 0.002], [r, zr - 0.003]);
    else prof.push([r, zr]);
    prof.push([r * 0.96, zr - len * 0.58], [r * 0.72, zr - len * 0.66], [r * 0.72, zr - len * 0.7]);
    parts.push(lathe(prof, S(8), '#a8823e', x, y));
    parts.push(lathe([[r * 0.72, zr - len * 0.7], [r * 0.6, zr - len * 0.86], [0.0008, zr - len], [0, zr - len]], S(8), '#8a5a33', x, y));
  }
  // Články pásu (tmavé spony mezi náboji).
  for (let i = 0; i + 1 < path.length; i++) {
    const [x0, y0] = path[i], [x1, y1] = path[i + 1];
    const g = plainBox(0.003, Math.hypot(x1 - x0, y1 - y0) + 0.002, len * 0.32, C.metalDark, [0, 0, 0]);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.atan2(x1 - x0, y1 - y0)));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, zr - len * 0.22);
    parts.push(g);
  }
  return parts;
}

/** Podávací víko v lokálních souřadnicích závěsu: z dozadu 0..len, y 0..h. */
function coverGeometry(len: number, h: number, w: number, color: string, ribs: boolean) {
  const parts = [sideProfile([[0, 0], [0, h * 0.75], [0.012, h], [len - 0.01, h], [len, h * 0.8], [len, 0]], w, 0.002, color)];
  parts.push(bevelBox(w * 0.5, 0.008, 0.012, 0.002, C.metalWorn, [0, h * 0.6, len + 0.004])); // západka
  if (ribs) for (const z of [len * 0.35, len * 0.65]) parts.push(plainBox(w * 0.8, 0.0025, 0.006, C.metalDark, [0, h + 0.001, z]));
  return merge(parts);
}

function frontSight(metal: THREE.BufferGeometry[], z: number, SY: number, tall: number) {
  metal.push(sideProfile([[z + 0.012, -0.012], [z + 0.012, 0.012], [z + 0.007, SY - tall], [z - 0.007, SY - tall], [z - 0.012, 0.012], [z - 0.012, -0.012]], 0.022, 0.0015, C.blued));
  metal.push(bevelBox(0.0022, tall, 0.0022, 0.0005, C.metalDark, [0, SY - tall / 2, z]));
  for (const sx of [-1, 1]) metal.push(bevelBox(0.0024, 0.017, 0.012, 0.0006, C.blued, [sx * 0.0085, SY - tall + 0.008, z]));
}

/**
 * M249 (USMC Support): široké tělo, víko se závěsem vpředu, pevná pažba, nosná rukojeť sklopená
 * vlevo, schránka pod tělem a pás zleva, dvojnožka složená dopředu, výhoz dolů.
 */
export function buildM249(segScale = 1): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];
  const SY = 0.072;
  const W = 0.052;
  // Tělo s vybráním lůžka pod víkem.
  metal.push(sideProfile([[0.13, 0.03], [0.13, -0.03], [0.115, -0.045], [-0.19, -0.045], [-0.19, 0.03], [-0.13, 0.03], [-0.13, 0.012], [0.09, 0.012], [0.09, 0.03]], W, 0.002, C.metal));
  metal.push(bevelBox(0.03, 0.002, 0.2, 0.0006, C.metalWorn, [0, 0.0125, -0.02])); // lůžko
  for (const sx of [-1, 1]) metal.push(plainBox(0.0015, 0.008, 0.25, C.metalDark, [sx * (W / 2), -0.02, -0.03]));
  // Šachta zásobníku vlevo dole (krytka) a lem pro schránku.
  metal.push(bevelBox(0.016, 0.03, 0.05, 0.002, C.metal, [-0.032, -0.03, -0.055]));
  // Hledí vzadu na pouzdře: clona s otvorem, sloupek a křidélka.
  const zA = 0.112;
  metal.push(lathe([[0.003, zA - 0.002], [0.0075, zA - 0.002], [0.0075, zA + 0.002], [0.003, zA + 0.002], [0.003, zA - 0.002]], S(18), C.metalDark, 0, SY, true));
  metal.push(bevelBox(0.014, SY - 0.0075 - 0.03, 0.006, 0.0012, C.metal, [0, (SY - 0.0075 + 0.03) / 2, zA]));
  for (const sx of [-1, 1]) metal.push(bevelBox(0.003, 0.05, 0.016, 0.0008, C.metal, [sx * 0.0105, 0.055, zA]));

  // Pistolová rukojeť a lučík (rodina AR, posunuté).
  const sh = (pts: P2[], dz: number, dy: number) => pts.map(([z, y]) => [z + dz, y + dy] as P2);
  poly.push(sideProfile(sh([[0.036, -0.032], [0.072, -0.032], [0.106, -0.122], [0.1, -0.132], [0.072, -0.13], [0.062, -0.1], [0.058, -0.088], [0.052, -0.08], [0.046, -0.062]], 0.03, -0.013), 0.03, 0.004, C.polymerGrip));
  metal.push(sideProfile(sh([[0.046, -0.03], [0.046, -0.058], [-0.004, -0.058], [-0.004, -0.052], [0.04, -0.052], [0.04, -0.03]], 0.03, -0.015), 0.012, 0.0015, C.metalDark));
  metal.push(sideProfile(sh([[0.022, -0.034], [0.026, -0.048], [0.02, -0.052], [0.016, -0.036]], 0.03, -0.012), 0.005, 0.0008, C.metalWorn));

  // Pevná pažba s hřbetem a botkou.
  poly.push(sideProfile([[0.13, 0.026], [0.3, 0.032], [0.352, 0.028], [0.36, 0.02], [0.36, -0.11], [0.35, -0.118], [0.29, -0.104], [0.2, -0.06], [0.16, -0.048], [0.13, -0.04]], 0.044, 0.007, C.polymer));
  poly.push(bevelBox(0.048, 0.136, 0.012, 0.004, C.polymerGrip, [0, -0.045, 0.364]));

  // Hlaveň, plynový blok, předpažbí, tlumič plamene.
  metal.push(lathe(fwd([[0, 0.17], [0.0118, 0.17], [0.0118, 0.21], [0.011, 0.212], [0.011, 0.665], [0, 0.665]]), S(18), C.blued, 0, 0));
  metal.push(tube(0.0075, -0.2, -0.48, S(12), C.blued, 0, -0.022));
  metal.push(sideProfile([[-0.47, -0.034], [-0.47, 0.012], [-0.5, 0.012], [-0.505, -0.034]], 0.03, 0.002, C.blued));
  poly.push(crossProfile([[-0.024, -0.002], [0.024, -0.002], [0.026, -0.02], [0.02, -0.04], [0.0, -0.046], [-0.02, -0.04], [-0.026, -0.02]], -0.195, -0.37, 0.004, C.polymer));
  for (const sx of [-1, 1]) for (const y of [-0.016, -0.028]) poly.push(bevelBox(0.002, 0.004, 0.15, 0.0006, C.polymerGrip, [sx * 0.026, y, -0.282]));
  const fh: Array<[number, number]> = [[0, 0.665], [0.0118, 0.665]];
  for (let k = 0; k < 3; k++) {
    const z = 0.67 + k * 0.011;
    fh.push([0.0118, z], [0.0102, z + 0.001], [0.0102, z + 0.006], [0.0118, z + 0.007]);
  }
  fh.push([0.0118, 0.705], [0.009, 0.707], [0, 0.707]);
  metal.push(lathe(fwd(fh), S(18), C.blued, 0, 0));
  frontSight(metal, -0.628, SY, 0.016);

  // Nosná rukojeť sklopená vlevo, dvojnožka složená dopředu pod hlavní.
  metal.push(lathe(fwd([[0.0125, 0.258], [0.0155, 0.26], [0.0155, 0.282], [0.0125, 0.284]]), S(16), C.blued, 0, 0));
  metal.push(bevelBox(0.03, 0.01, 0.014, 0.002, C.blued, [-0.024, 0.0, -0.27]));
  poly.push(transform(lathe([[0, -0.06], [0.0085, -0.058], [0.0085, 0.058], [0, 0.06]], S(12), C.polymerGrip), [-0.043, 0.0, -0.27]));
  metal.push(bevelBox(0.032, 0.012, 0.02, 0.002, C.blued, [0, -0.04, -0.49]));
  for (const sx of [-1, 1]) {
    metal.push(tube(0.0035, -0.495, -0.665, S(8), C.metalDark, sx * 0.011, -0.045));
    metal.push(bevelBox(0.012, 0.006, 0.02, 0.0015, C.metalDark, [sx * 0.011, -0.045, -0.672]));
  }

  // Pohyblivé díly: víko (závěs vpředu), schránka s pásem (zleva), natahovací páka vpravo.
  const coverPivot = new THREE.Vector3(0, 0.012, -0.13);
  const cover = coverGeometry(0.22, 0.04, W, C.metal, false);
  const socket = new THREE.Vector3(0, -0.045, -0.055);
  const beltPath: Array<[number, number]> = [];
  for (const [x, wy] of [[-0.034, -0.038], [-0.0355, -0.028], [-0.0355, -0.018], [-0.0345, -0.008], [-0.031, 0.002], [-0.024, 0.01], [-0.013, 0.0165], [-0.002, 0.0168], [0.009, 0.0168]] as const) beltPath.push([x, wy - socket.y]);
  const box = merge([
    bevelBox(0.072, 0.1, 0.112, 0.006, '#4c4f36', [-0.012, -0.05, 0]),
    bevelBox(0.05, 0.006, 0.07, 0.002, '#3c3f2a', [-0.012, 0.002, 0]),
    bevelBox(0.004, 0.06, 0.08, 0.002, '#3c3f2a', [-0.049, -0.05, 0]),
    ...beltRounds(beltPath, 0.057, 0.0048, false, S),
  ]);
  const handle = merge([bevelBox(0.03, 0.009, 0.012, 0.002, C.blued, [0.015, 0, 0]), transform(lathe([[0, 0], [0.007, 0], [0.007, 0.012], [0, 0.013]], S(10), C.blued), [0.028, 0, 0], [0, Math.PI / 2, 0])]);

  const rear = new THREE.Vector3(0, SY, zA);
  const points: WeaponPoints = {
    weaponRoot: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, 0, -0.707),
    sightRear: rear,
    sightFront: new THREE.Vector3(0, SY, -0.628),
    opticEye: rear.clone().add(new THREE.Vector3(0, 0, 0.1)),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.088, 0.105),
    gripLeft: new THREE.Vector3(0, -0.044, -0.3),
    magazineSocket: socket,
    ejectionPort: new THREE.Vector3(0.0, -0.046, -0.02),
    chargingHandle: new THREE.Vector3(W / 2, -0.008, -0.1),
    boltCatch: new THREE.Vector3(0.03, -0.008, -0.1),
    feedCover: new THREE.Vector3(0, 0.052, 0.09),
    feedEntry: new THREE.Vector3(-0.012, 0.017, 0.0),
  };
  return finish('m249', 'M249', metal, poly, points, { cover, coverPivot, box, boxMaterial: 'polymer', handle, magSide: -1 });
}

/**
 * PKM (MEC Support): dlouhé štíhlé tělo, kostrová pažba, víko se závěsem vpředu, pás zprava
 * z ocelové schránky, žlábkovaná hlaveň, plynový válec pod hlavní, vysoká muška u ústí,
 * dvojnožka složená dozadu, rukojeť na hlavni sklopená vlevo.
 */
export function buildPKM(segScale = 1): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const metal: THREE.BufferGeometry[] = [];
  const furn: THREE.BufferGeometry[] = [];
  const SY = 0.058;
  const W = 0.04;
  metal.push(sideProfile([[0.14, 0.025], [0.14, -0.028], [0.125, -0.042], [-0.18, -0.042], [-0.18, 0.025], [-0.125, 0.025], [-0.125, 0.008], [0.085, 0.008], [0.085, 0.025]], W, 0.0015, C.blued));
  metal.push(bevelBox(0.026, 0.002, 0.19, 0.0006, C.metalWorn, [0, 0.0085, -0.02]));
  for (const sx of [-1, 1]) for (const [z, y] of [[0.1, -0.03], [-0.15, -0.03], [-0.16, 0.0], [0.11, 0.0]] as const) metal.push(plainBox(0.0016, 0.004, 0.004, C.metalWorn, [sx * (W / 2), y, z]));
  // Okno vstupu pásu vpravo.
  metal.push(plainBox(0.0016, 0.016, 0.085, C.metalDark, [W / 2, 0.0, -0.01]));
  // Hledí (sklopné, výřez) na předním čepu před víkem.
  const zn = -0.135;
  metal.push(sideProfile([[-0.127, 0.02], [-0.127, 0.036], [-0.14, 0.04], [-0.18, 0.036], [-0.185, 0.025], [-0.185, 0.02]], 0.026, 0.0015, C.blued));
  metal.push(bevelBox(0.016, 0.003, 0.05, 0.0008, C.blued, [0, 0.041, -0.16], [-0.04, 0, 0]));
  const base = 0.039, gap = 0.0036, side = 0.008;
  for (const sx of [-1, 1]) metal.push(bevelBox(side, SY - base, 0.003, 0.0006, C.blued, [sx * (gap / 2 + side / 2), (SY + base) / 2, zn]));
  metal.push(bevelBox(gap + 0.001, SY - base - 0.0032, 0.003, 0.0004, C.blued, [0, base + (SY - base - 0.0032) / 2, zn]));

  // Rukojeť, lučík, spoušť.
  furn.push(sideProfile([[0.06, -0.042], [0.094, -0.042], [0.128, -0.137], [0.121, -0.146], [0.094, -0.143], [0.083, -0.109], [0.072, -0.067]], 0.03, 0.004, C.bakelite));
  metal.push(sideProfile([[0.0, -0.042], [-0.002, -0.069], [0.062, -0.069], [0.064, -0.042], [0.058, -0.042], [0.058, -0.063], [0.004, -0.063], [0.006, -0.042]], 0.01, 0.0012, C.blued));
  metal.push(sideProfile([[0.026, -0.043], [0.03, -0.059], [0.024, -0.063], [0.02, -0.045]], 0.005, 0.0008, C.metalWorn));
  // Kostrová pažba: hřbet, spodní vzpěra, blok botky (otvor mezi nimi).
  const stock = '#5b2f20';
  furn.push(sideProfile([[0.138, 0.022], [0.41, 0.002], [0.41, -0.022], [0.138, -0.006]], 0.034, 0.005, stock));
  furn.push(sideProfile([[0.138, -0.04], [0.395, -0.1], [0.395, -0.126], [0.138, -0.066]], 0.032, 0.005, stock));
  furn.push(sideProfile([[0.385, 0.004], [0.425, 0.004], [0.425, -0.132], [0.385, -0.128]], 0.036, 0.006, stock));
  metal.push(bevelBox(0.038, 0.14, 0.006, 0.002, C.blued, [0, -0.064, 0.429]));

  // Hlaveň se žlábky, plynový válec, plynový blok, muška, tlumič plamene.
  metal.push(lathe(fwd([[0, 0.16], [0.0118, 0.16], [0.0118, 0.2], [0.0105, 0.202], [0.0105, 0.75], [0, 0.75]]), S(18), C.blued, 0, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const g = plainBox(0.0024, 0.0016, 0.2, C.metalDark, [0, 0, 0]);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a - Math.PI / 2));
    g.translate(Math.cos(a) * 0.0104, Math.sin(a) * 0.0104, -0.32);
    metal.push(g);
  }
  metal.push(tube(0.0085, -0.18, -0.6, S(12), C.blued, 0, -0.024));
  metal.push(sideProfile([[-0.598, -0.036], [-0.598, 0.012], [-0.628, 0.012], [-0.632, -0.036]], 0.026, 0.002, C.blued));
  frontSight(metal, -0.722, SY, 0.018);
  const fh: Array<[number, number]> = [[0, 0.75], [0.0115, 0.75], [0.013, 0.79], [0.0115, 0.805], [0, 0.805]];
  metal.push(lathe(fwd(fh), S(18), C.blued, 0, 0));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    metal.push(plainBox(0.0018, 0.0035, 0.04, C.metalDark, [Math.cos(a) * 0.0125, Math.sin(a) * 0.0125, -0.785]));
  }
  // Rukojeť na hlavni sklopená vlevo, dvojnožka složená dozadu pod plynovým válcem.
  metal.push(lathe(fwd([[0.0125, 0.25], [0.015, 0.252], [0.015, 0.27], [0.0125, 0.272]]), S(16), C.blued, 0, 0));
  metal.push(bevelBox(0.03, 0.01, 0.014, 0.002, C.blued, [-0.022, 0.0, -0.261]));
  furn.push(transform(lathe([[0, -0.055], [0.0085, -0.052], [0.0085, 0.052], [0, 0.055]], S(12), stock), [-0.04, 0.0, -0.261]));
  metal.push(bevelBox(0.026, 0.012, 0.018, 0.002, C.blued, [0, -0.04, -0.61]));
  for (const sx of [-1, 1]) {
    metal.push(tube(0.0035, -0.61, -0.4, S(8), C.metalDark, sx * 0.01, -0.044));
    metal.push(bevelBox(0.01, 0.005, 0.016, 0.0015, C.metalDark, [sx * 0.01, -0.044, -0.395]));
  }

  // Pohyblivé díly: víko, ocelová schránka s pásem zprava, natahovací páka vpravo.
  const coverPivot = new THREE.Vector3(0, 0.008, -0.125);
  const cover = coverGeometry(0.21, 0.034, W, C.blued, true);
  const socket = new THREE.Vector3(0.012, -0.042, -0.064);
  const beltPath: Array<[number, number]> = [];
  for (const [x, wy] of [[0.034, -0.05], [0.0345, -0.037], [0.034, -0.024], [0.032, -0.011], [0.026, 0.002], [0.016, 0.012], [0.004, 0.0145], [-0.008, 0.0145]] as const) beltPath.push([x - socket.x, wy - socket.y]);
  const box = merge([
    bevelBox(0.066, 0.112, 0.128, 0.004, '#4f5640', [0.012, -0.058, 0]),
    bevelBox(0.07, 0.006, 0.132, 0.002, '#434a35', [0.012, -0.002, 0]),
    bevelBox(0.03, 0.006, 0.01, 0.002, C.metalDark, [0.012, 0.004, 0.05]),
    ...beltRounds(beltPath, 0.077, 0.0062, true, S),
  ]);
  const handle = merge([bevelBox(0.026, 0.008, 0.012, 0.002, C.blued, [0.013, 0, 0]), transform(lathe([[0, 0], [0.007, 0], [0.007, 0.012], [0, 0.013]], S(10), C.blued), [0.024, 0, 0], [0, Math.PI / 2, 0])]);

  const rear = new THREE.Vector3(0, SY, zn);
  const points: WeaponPoints = {
    weaponRoot: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, 0, -0.805),
    sightRear: rear,
    sightFront: new THREE.Vector3(0, SY, -0.722),
    opticEye: rear.clone().add(new THREE.Vector3(0, 0, 0.35)),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.087, 0.093),
    gripLeft: new THREE.Vector3(0, -0.034, -0.24),
    magazineSocket: socket,
    ejectionPort: new THREE.Vector3(-0.0, -0.043, 0.02),
    chargingHandle: new THREE.Vector3(W / 2, -0.026, -0.06),
    boltCatch: new THREE.Vector3(0.03, -0.026, -0.06),
    feedCover: new THREE.Vector3(0, 0.042, 0.085),
    feedEntry: new THREE.Vector3(0.012, 0.0145, -0.05),
  };
  return finish('pkm', 'PKM', metal, furn, points, { cover, coverPivot, box, boxMaterial: 'metal', handle, magSide: 1 });
}

function finish(
  id: string,
  name: string,
  metal: THREE.BufferGeometry[],
  poly: THREE.BufferGeometry[],
  points: WeaponPoints,
  o: { cover: THREE.BufferGeometry; coverPivot: THREE.Vector3; box: THREE.BufferGeometry; boxMaterial: 'metal' | 'polymer'; handle: THREE.BufferGeometry; magSide: number },
): WeaponModel {
  const m = merge(metal), p = merge(poly);
  return {
    id,
    name,
    static: { metal: m, polymer: p },
    moving: {
      magazine: { geometry: o.box, material: o.boxMaterial, pivot: points.magazineSocket.clone() },
      chargingHandle: { geometry: o.handle, material: 'metal', pivot: points.chargingHandle.clone(), travel: new THREE.Vector3(0, 0, 0.13) },
      feedCover: { geometry: o.cover, material: 'metal', pivot: o.coverPivot },
    },
    sight: 'iron',
    points,
    hipRoot: hipFromGrip(points.gripRight, [0.005, 0.005, 0.01]),
    hipRot: new THREE.Euler(0.02, 0.05, 0),
    magRock: 0.15,
    emptyAction: 'chargingHandle',
    reloadStyle: 'belt',
    cycle: 'none',
    magSide: o.magSide,
    triangles: triCount(m, p, o.box, o.handle, o.cover),
  };
}
