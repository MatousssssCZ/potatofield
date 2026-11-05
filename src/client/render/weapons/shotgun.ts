import * as THREE from 'three';
import { bevelBox, crossProfile, fwd, lathe, merge, plainBox, sideProfile, transform, type P2 } from './meshkit';
import { PAL as C, hipFromGrip, triCount, type WeaponModel, type WeaponPoints } from './types';

/**
 * Pumpovací brokovnice (Engineer): Remington 870 (USMC) a Hawk Type 97 (PLA).
 * Trubicový zásobník pod hlavní, posuvné předpažbí (pumpa) jako pohyblivý díl, nabíjecí otvor
 * zespodu pouzdra, pevná pažba, mechanická mířidla. Pohyblivý „zásobník“ je volný náboj v ruce
 * (viditelný jen ve fázi vkládání). Kořen: osa vývrtu y = 0, z = 0 u čela lučíku.
 *
 * Hawk Type 97 je **neověřený výtvarný návrh**: přesná varianta a její reference nebyly v tomto
 * prostředí dostupné (viz docs/weapons/Hawk97.md) – model se nevydává za věrnou předlohu.
 */

type Seg = (n: number) => number;
type Variant = 'r870' | 'hawk97';

function shellGeometry(S: Seg) {
  // Brokový náboj 12/70: plastová nábojnice + mosazná hlavička, osa podél −Z.
  return merge([
    lathe([[0, 0.032], [0.0108, 0.032], [0.0108, 0.02], [0.0102, 0.019], [0, 0.019]], S(12), '#b08a3e'),
    lathe([[0.0102, 0.019], [0.0102, -0.033], [0.006, -0.0335], [0, -0.0335]], S(12), '#8e2a22'),
  ]);
}

function build(variant: Variant, segScale: number): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const hawk = variant === 'hawk97';
  const metal: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];
  const recvTop = hawk ? 0.026 : 0.022;

  // --- Pouzdro ---
  const recv: P2[] = hawk
    ? [[0.05, 0.012], [0.04, recvTop], [-0.172, recvTop], [-0.178, 0.014], [-0.178, -0.036], [-0.03, -0.046], [0.05, -0.042]]
    : [[0.045, 0.016], [0.04, recvTop], [-0.17, recvTop], [-0.175, 0.012], [-0.175, -0.034], [-0.02, -0.045], [0.045, -0.04]];
  metal.push(sideProfile(recv, 0.034, 0.003, C.blued));
  if (hawk) metal.push(bevelBox(0.012, 0.004, 0.2, 0.001, C.blued, [0, recvTop + 0.004, -0.065])); // plochá lišta nahoře
  else metal.push(plainBox(0.006, 0.0012, 0.19, C.metalDark, [0, recvTop + 0.0028, -0.065])); // drážka
  metal.push(plainBox(0.0016, 0.022, 0.066, C.metalDark, [0.0185, 0.0, -0.078])); // okno vyhazování vpravo
  metal.push(plainBox(0.026, 0.002, 0.085, C.metalDark, [0, -0.0445, -0.072])); // nabíjecí otvor zespodu
  metal.push(bevelBox(0.003, 0.008, 0.014, 0.001, C.metalWorn, [-0.0185, -0.03, -0.01])); // uvolnění závěru
  metal.push(transform(lathe([[0, -0.022], [0.0045, -0.022], [0.0045, 0.022], [0, 0.022]], S(10), C.metalWorn), [0, -0.036, 0.034], [0, Math.PI / 2, 0])); // příčná pojistka

  // --- Lučík a spoušť ---
  metal.push(sideProfile([[-0.005, -0.042], [-0.008, -0.07], [0.05, -0.072], [0.055, -0.042], [0.048, -0.042], [0.044, -0.064], [0.0, -0.064], [0.002, -0.042]], 0.012, 0.0015, C.blued));
  metal.push(sideProfile([[0.016, -0.043], [0.02, -0.058], [0.014, -0.062], [0.01, -0.045]], 0.005, 0.0008, C.metalWorn));

  // --- Pažba (pevná, polymer) ---
  const stock: P2[] = hawk
    ? [[0.05, 0.02], [0.4, 0.0], [0.408, -0.002], [0.408, -0.15], [0.395, -0.156], [0.22, -0.1], [0.14, -0.1], [0.1, -0.13], [0.078, -0.128], [0.07, -0.09], [0.06, -0.046], [0.05, -0.042]]
    : [[0.045, 0.018], [0.075, 0.016], [0.4, -0.008], [0.408, -0.01], [0.408, -0.155], [0.395, -0.16], [0.2, -0.1], [0.11, -0.075], [0.08, -0.062], [0.06, -0.045], [0.045, -0.04]];
  poly.push(sideProfile(stock, 0.04, 0.006, C.polymer));
  poly.push(bevelBox(0.044, hawk ? 0.15 : 0.146, 0.016, 0.005, '#171717', [0, hawk ? -0.075 : -0.082, 0.415]));
  metal.push(bevelBox(0.008, 0.006, 0.02, 0.0015, C.metalDark, [0, hawk ? -0.15 : -0.153, 0.36])); // poutko

  // --- Hlaveň, trubicový zásobník, objímka ---
  const B = hawk ? 0.66 : 0.64;
  metal.push(lathe(fwd([[0, 0.17], [0.0118, 0.17], [0.0118, B - 0.004], [0.0105, B], [0, B]]), S(18), C.blued, 0, 0));
  const tubeEnd = hawk ? 0.5 : 0.58;
  metal.push(lathe(fwd([[0, 0.175], [0.0112, 0.175], [0.0112, tubeEnd], [0, tubeEnd]]), S(14), C.blued, 0, -0.025));
  metal.push(lathe(fwd([[0, tubeEnd], [0.0125, tubeEnd], [0.0125, tubeEnd + 0.016], [0.009, tubeEnd + 0.019], [0, tubeEnd + 0.019]]), S(14), C.metal, 0, -0.025));
  metal.push(sideProfile([[-(tubeEnd - 0.06), -0.04], [-(tubeEnd - 0.06), 0.012], [-(tubeEnd - 0.04), 0.012], [-(tubeEnd - 0.04), -0.04]], 0.03, 0.003, C.blued));

  // --- Mířidla ---
  // 870: hledí s výřezem na hlavni a muška na rampě u ústí. Hawk 97 (návrh): výřez vzadu na pouzdře, kuličková muška.
  const SY = hawk ? 0.036 : 0.03;
  const zn = hawk ? 0.03 : -0.205;
  if (hawk) {
    metal.push(bevelBox(0.02, SY - recvTop - 0.006, 0.012, 0.0015, C.blued, [0, (SY + recvTop + 0.006) / 2 - 0.003, zn]));
  } else {
    metal.push(bevelBox(0.016, 0.007, 0.022, 0.0015, C.blued, [0, 0.0138, zn - 0.006]));
  }
  const base = hawk ? SY - 0.008 : 0.017, gap = 0.0038, side = 0.0075;
  for (const sx of [-1, 1]) metal.push(bevelBox(side, SY - base, 0.003, 0.0006, C.blued, [sx * (gap / 2 + side / 2), (SY + base) / 2, zn]));
  metal.push(bevelBox(gap + 0.001, SY - base - 0.0032, 0.003, 0.0004, C.blued, [0, base + (SY - base - 0.0032) / 2, zn]));
  const zf = -(B - 0.01);
  if (hawk) {
    metal.push(bevelBox(0.003, SY - 0.0118 - 0.002, 0.004, 0.0006, C.blued, [0, (SY + 0.0118) / 2 - 0.001, zf]));
    metal.push(lathe([[0, -0.0022], [0.0022, -0.0022], [0.0022, 0.0022], [0, 0.0022]], S(10), C.metalWorn, 0, SY - 0.002).translate(0, 0, zf));
  } else {
    // Rampa se svislou zadní hranou čepele (zadní hrana = záměrný bod).
    metal.push(sideProfile([[zf + 0.03, 0.0105], [zf, 0.0105], [zf, SY], [zf + 0.006, SY], [zf + 0.006, 0.021], [zf + 0.03, 0.0135]], 0.004, 0.0008, C.blued));
  }

  // --- Pohyblivé díly: pumpa (předpažbí + vodicí lišty), náboj v ruce ---
  const pumpZ = hawk ? -0.335 : -0.33;
  const pumpLen = hawk ? 0.2 : 0.17;
  const pumpParts: THREE.BufferGeometry[] = [];
  const sec: P2[] = hawk
    ? [[-0.021, 0.012], [0.021, 0.012], [0.024, -0.004], [0.021, -0.02], [0.0, -0.028], [-0.021, -0.02], [-0.024, -0.004]]
    : [[-0.022, 0.012], [0.022, 0.012], [0.025, -0.006], [0.02, -0.02], [0.0, -0.026], [-0.02, -0.02], [-0.025, -0.006]];
  pumpParts.push(crossProfile(sec, pumpLen / 2, -pumpLen / 2, 0.004, '#202020'));
  if (hawk) for (const z of [-0.05, -0.02, 0.01, 0.04]) pumpParts.push(bevelBox(0.05, 0.004, 0.012, 0.0015, '#161616', [0, -0.018, z])); // prohmaty
  else for (let z = -pumpLen / 2 + 0.014; z < pumpLen / 2 - 0.01; z += 0.013) pumpParts.push(plainBox(0.052, 0.012, 0.0035, '#151515', [0, -0.004, z])); // žebra
  for (const sx of [-1, 1]) pumpParts.push(plainBox(0.003, 0.004, 0.11, C.metalDark, [sx * 0.012, 0.004, pumpLen / 2 + 0.05]));
  const pump = merge(pumpParts);
  const shell = shellGeometry(S);

  const loadingPort = new THREE.Vector3(0, -0.043, -0.075);
  const rear = new THREE.Vector3(0, SY, zn);
  const points: WeaponPoints = {
    weaponRoot: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, 0, -B),
    sightRear: rear,
    sightFront: new THREE.Vector3(0, SY, hawk ? zf : zf + 0.006),
    opticEye: rear.clone().add(new THREE.Vector3(0, 0, hawk ? 0.1 : 0.34)),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.062, 0.072),
    gripLeft: new THREE.Vector3(0, -0.051, pumpZ),
    magazineSocket: loadingPort.clone(),
    ejectionPort: new THREE.Vector3(0.019, 0.002, -0.078),
    chargingHandle: new THREE.Vector3(0, -0.025, pumpZ),
    boltCatch: new THREE.Vector3(-0.019, -0.03, -0.01),
    pumpGrip: new THREE.Vector3(0, -0.051, pumpZ),
    loadingPort,
  };
  const m = merge(metal), p = merge(poly);
  return {
    id: variant,
    name: hawk ? 'Hawk Type 97 (návrh)' : 'Remington 870',
    static: { metal: m, polymer: p },
    moving: {
      magazine: { geometry: shell, material: 'metal', pivot: loadingPort.clone() },
      pump: { geometry: pump, material: 'polymer', pivot: new THREE.Vector3(0, -0.025, pumpZ), travel: new THREE.Vector3(0, 0, 0.09) },
    },
    sight: 'iron',
    points,
    hipRoot: hipFromGrip(points.gripRight, [0.0, 0.01, 0.0]),
    hipRot: new THREE.Euler(0.02, 0.05, 0),
    magRock: 0,
    emptyAction: 'pump',
    reloadStyle: 'single',
    cycle: 'pump',
    magSide: 0,
    triangles: triCount(m, p, pump, shell),
  };
}

export const buildR870 = (segScale = 1) => build('r870', segScale);
export const buildHawk97 = (segScale = 1) => build('hawk97', segScale);
