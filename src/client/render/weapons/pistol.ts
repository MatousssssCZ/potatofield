import * as THREE from 'three';
import { bevelBox, crossProfile, lathe, merge, plainBox, sideProfile, transform, type P2 } from './meshkit';
import { PAL as C, hipFromGrip, triCount, type WeaponModel, type WeaponPoints } from './types';

/**
 * Pistole (slot 2): M9 (USMC) a PM (MEC). Kořen: osa vývrtu y = 0, z = 0 u zadní hrany
 * závěru, ústí k −Z. Rozměry jsou umělecký odhad. Závěr je pohyblivý díl: při výstřelu
 * cykluje, po posledním náboji zůstane vzadu (záchyt), při přebití ho levá ruka uvolní.
 * M9: otevřený vrch závěru s odkrytou hlaví, hranatý lučík, rovná rukojeť s rýhováním.
 * PM: kompaktní zaoblený závěr, pevná hlaveň, hnědé bakelitové střenky, kulatý lučík.
 */
type Seg = (n: number) => number;
type Variant = 'm9' | 'pm';

function build(variant: Variant, segScale: number): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const pm = variant === 'pm';
  const metal: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];
  const L = pm ? 0.158 : 0.212; // délka závěru
  const W = pm ? 0.027 : 0.031; // šířka závěru
  const SY = pm ? 0.021 : 0.023; // záměrná přímka nad vývrtem
  const slideCol = pm ? '#2f3133' : '#2a2b2d';

  // --- Rám: prachový kryt pod závěrem, lučík, spoušť, kohout, pojistka. ---
  const frame: P2[] = pm
    ? [[0.0, -0.012], [-0.115, -0.012], [-0.118, -0.024], [-0.04, -0.026], [0.0, -0.026]]
    : [[0.004, -0.012], [-0.17, -0.012], [-0.172, -0.026], [-0.12, -0.03], [-0.04, -0.03], [0.004, -0.028]];
  metal.push(sideProfile(frame, W - 0.004, 0.0015, C.metalDark));
  if (pm) {
    // Oblý lučík: vnější a vnitřní oblouk jako jeden obrys (U).
    const outer: P2[] = [], inner: P2[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (i / 8);
      outer.push([-0.056 - Math.cos(a) * 0.028, -0.028 - Math.sin(a) * 0.026]);
      inner.push([-0.056 - Math.cos(a) * 0.022, -0.028 - Math.sin(a) * 0.02]);
    }
    metal.push(sideProfile([...outer, ...inner.reverse()], 0.008, 0.001, C.metalDark));
  } else metal.push(sideProfile([[-0.03, -0.028], [-0.035, -0.058], [-0.088, -0.058], [-0.09, -0.028], [-0.082, -0.028], [-0.08, -0.05], [-0.042, -0.05], [-0.038, -0.028]], 0.009, 0.0012, C.metalDark));
  metal.push(sideProfile([[-0.052, -0.03], [-0.054, -0.044], [-0.06, -0.05], [-0.064, -0.048], [-0.06, -0.03]], 0.005, 0.0008, C.metalWorn)); // spoušť
  metal.push(sideProfile([[0.012, -0.004], [0.022, 0.006], [0.026, 0.002], [0.018, -0.012], [0.008, -0.014]], 0.007, 0.0008, C.metalWorn)); // kohout
  metal.push(bevelBox(0.006, 0.008, 0.012, 0.0015, C.metalWorn, [pm ? -0.0165 : -0.018, 0.004, -0.012])); // pojistka
  // --- Rukojeť: kostra + střenky (M9 rovná s rýhami, PM oblá hnědá). ---
  const grip: P2[] = pm
    ? [[0.004, -0.026], [-0.03, -0.026], [-0.036, -0.06], [-0.034, -0.104], [-0.026, -0.112], [0.012, -0.112], [0.02, -0.1], [0.016, -0.05], [0.01, -0.03]]
    : [[0.006, -0.028], [-0.03, -0.03], [-0.034, -0.07], [-0.03, -0.124], [-0.022, -0.13], [0.022, -0.13], [0.026, -0.12], [0.02, -0.06], [0.012, -0.034]];
  metal.push(sideProfile(grip, W - 0.006, 0.002, C.metalDark));
  const panelCol = pm ? '#5b3220' : '#1e1e1e';
  for (const sx of [-1, 1]) {
    const inset = grip.map(([z, y]) => [z * 0.92 - 0.002, y * 0.94 - 0.004] as P2);
    poly.push(sideProfile(inset, 0.004, 0.0015, panelCol, sx * ((W - 0.006) / 2 + 0.0015)));
    if (!pm) for (let y = -0.05; y > -0.115; y -= 0.008) poly.push(plainBox(0.0015, 0.0014, 0.03, '#141414', [sx * ((W - 0.006) / 2 + 0.0037), y, -0.006 + (y + 0.05) * 0.18]));
    else poly.push(transform(lathe([[0, 0], [0.006, 0], [0.006, 0.001], [0, 0.0012]], S(10), '#7a5a2a'), [sx * ((W - 0.006) / 2 + 0.0035), -0.07, -0.006], [0, sx * Math.PI / 2, 0])); // hvězda/medailon
  }
  metal.push(bevelBox(W - 0.004, 0.006, 0.046, 0.0015, C.metalDark, [0, pm ? -0.112 : -0.13, -0.004])); // pata zásobníku (pevná část rámu)

  // --- Hlaveň (M9 viditelná v otevřeném závěru). ---
  metal.push(lathe([[0, 0.0], [0.0065, 0.0], [0.0065, -L + 0.004], [0.0045, -L + 0.002], [0.0045, -L], [0, -L]].map(([r, z]) => [r, z - 0.004] as [number, number]), S(14), C.blued, 0, 0));

  // --- Závěr (pohyblivý díl, pivot = zadní hrana). ---
  const slideParts: THREE.BufferGeometry[] = [];
  const sec: P2[] = pm
    ? [[-W / 2, -0.012], [W / 2, -0.012], [W / 2, 0.006], [W / 2 - 0.004, 0.014], [0.006, 0.0175], [-0.006, 0.0175], [-W / 2 + 0.004, 0.014], [-W / 2, 0.006]]
    : [[-W / 2, -0.012], [W / 2, -0.012], [W / 2, 0.012], [W / 2 - 0.003, 0.016], [-W / 2 + 0.003, 0.016], [-W / 2, 0.012]];
  if (pm) slideParts.push(crossProfile(sec, 0, -L, 0.002, slideCol));
  else {
    // Otevřený vrch: zadní a přední část plné, uprostřed jen boční stěny.
    slideParts.push(crossProfile(sec, 0, -0.07, 0.002, slideCol));
    slideParts.push(crossProfile(sec, -0.175, -L, 0.002, slideCol));
    for (const sx of [-1, 1]) slideParts.push(bevelBox(0.0055, 0.022, 0.108, 0.001, slideCol, [sx * (W / 2 - 0.00275), -0.001, -0.122]));
    slideParts.push(bevelBox(W - 0.004, 0.006, 0.108, 0.001, slideCol, [0, -0.009, -0.122]));
  }
  // Rýhování závěru vzadu, okno vyhazování (M9 je otevřené).
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) slideParts.push(plainBox(0.0012, 0.018, 0.0018, '#1a1b1c', [sx * (W / 2 + 0.0002), 0.002, -0.008 - i * 0.0045]));
  if (pm) slideParts.push(plainBox(0.0014, 0.009, 0.022, '#161617', [W / 2 + 0.0002, 0.006, -0.04]));
  // Mířidla: hledí s výřezem vzadu, muška vpředu (vrchol = záměrná přímka).
  const top = pm ? 0.0175 : 0.016;
  for (const sx of [-1, 1]) slideParts.push(bevelBox(0.006, SY - top + 0.001, 0.006, 0.0008, C.blued, [sx * 0.0048, (SY + top) / 2, -0.012]));
  slideParts.push(bevelBox(0.0028, SY - top, 0.004, 0.0006, C.blued, [0, (SY + top) / 2, -L + 0.008]));
  // Bílé body mířidel (M9).
  if (!pm) for (const x of [-0.0048, 0.0048]) slideParts.push(plainBox(0.0016, 0.0016, 0.0005, '#d8d8d0', [x, SY - 0.003, -0.0089]));
  const slide = merge(slideParts);

  // --- Zásobník (pohyblivý, v rukojeti). ---
  const magH = pm ? 0.085 : 0.105;
  const mag = merge([
    sideProfile([[0.008, 0.0], [-0.024, 0.0], [-0.03, -magH], [0.014, -magH]], W - 0.012, 0.001, C.magSteel),
    bevelBox(W - 0.008, 0.007, 0.044, 0.0015, '#151515', [0, -magH - 0.003, -0.006]),
  ]);

  const rear = new THREE.Vector3(0, SY, -0.012);
  const points: WeaponPoints = {
    weaponRoot: new THREE.Vector3(),
    muzzle: new THREE.Vector3(0, 0, -L - 0.004),
    sightRear: rear,
    sightFront: new THREE.Vector3(0, SY, -L + 0.008),
    // Oko při míření pistolí: natažené paže (~0,45 m za hledím).
    opticEye: rear.clone().add(new THREE.Vector3(0, 0, 0.45)),
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.06, -0.004),
    // Podpůrná ruka obejme rukojeť zespodu zleva (dvouruční držení).
    gripLeft: new THREE.Vector3(0, -0.07, -0.03),
    magazineSocket: new THREE.Vector3(0, pm ? -0.026 : -0.028, 0.0),
    ejectionPort: new THREE.Vector3(W / 2, 0.012, -0.05),
    chargingHandle: new THREE.Vector3(0, 0, 0),
    boltCatch: new THREE.Vector3(-0.017, -0.006, -0.05),
  };
  const m = merge(metal), p = merge(poly);
  return {
    id: variant,
    name: pm ? 'PM' : 'M9',
    static: { metal: m, polymer: p },
    moving: {
      magazine: { geometry: mag, material: 'metal', pivot: points.magazineSocket.clone() },
      chargingHandle: { geometry: slide, material: 'metal', pivot: new THREE.Vector3(0, 0, 0), travel: new THREE.Vector3(0, 0, pm ? 0.032 : 0.04) },
    },
    sight: 'iron',
    points,
    hipRoot: hipFromGrip(points.gripRight, [-0.06, 0.1, -0.12]),
    hipRot: new THREE.Euler(0.03, 0.02, 0),
    magRock: 0,
    emptyAction: 'chargingHandle',
    reloadStyle: 'magazine',
    cycle: 'none',
    magSide: 0,
    slideCycle: true,
    triangles: triCount(m, p, mag, slide),
  };
}

export const buildM9 = (segScale = 1) => build('m9', segScale);
export const buildPM = (segScale = 1) => build('pm', segScale);
