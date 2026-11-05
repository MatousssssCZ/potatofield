import * as THREE from 'three';
import { bevelBox, crossProfile, curvedMag, fwd, lathe, merge, plainBox, sideProfile, transform, tube, type P2 } from './meshkit';
import { buildOptic } from './optic';
import { PAL as C, hipFromGrip, triCount, type WeaponModel, type WeaponPoints } from './types';

/**
 * Rodina AK (MEC) a konvenční Type 81 (PLA). Kořen: z = 0 u zadní hrany šachty zásobníku,
 * osa vývrtu y = 0. Rozměry jsou umělecký odhad (docs/weapons/*.md), ne výkresové míry.
 *
 * AK-101: černý polymer, lisované tělo, úsťová brzda, boční montáž kolimátoru.
 * AKM: dřevo, žebrované víko, šikmý kompenzátor, výrazněji zahnutý ocelový zásobník.
 * Type 81: vlastní proporce – delší štíhlé předpažbí s průduchy, regulátor plynu,
 * vysoký sloupek mušky blíž k plynovému bloku, dlouhé ústí pro nástřelné granáty,
 * přímější dřevěná pažba, selektor vlevo.
 */

type Seg = (n: number) => number;
type Variant = 'ak101' | 'akm' | 't81' | 'saiga';

interface AkLook {
  furniture: string;
  furnitureDark: string;
  mag: string;
}

const LOOK: Record<Variant, AkLook> = {
  ak101: { furniture: C.polymer, furnitureDark: C.polymerGrip, mag: '#2a2a2b' },
  akm: { furniture: C.woodAkm, furnitureDark: C.woodAkmDark, mag: C.magSteel },
  t81: { furniture: C.woodT81, furnitureDark: C.woodT81Dark, mag: '#3a3d38' },
  saiga: { furniture: C.polymer, furnitureDark: C.polymerGrip, mag: '#252526' },
};

/** Výška záměrné přímky nad osou vývrtu. */
const SY = 0.044;

/** Hledí s výřezem (skutečná mezera) na desce v rovině z = zn. */
function notchPlate(metal: THREE.BufferGeometry[], zn: number, base: number, gap = 0.0036) {
  const h = SY - base;
  const side = 0.008;
  for (const sx of [-1, 1]) metal.push(bevelBox(side, h, 0.003, 0.0006, C.blued, [sx * (gap / 2 + side / 2), base + h / 2, zn]));
  const bh = h - 0.0032;
  metal.push(bevelBox(gap + 0.001, bh, 0.003, 0.0004, C.blued, [0, base + bh / 2, zn]));
}

/** Tunel krytu mušky (prstenec) kolem sloupku. */
function hoodRing(metal: THREE.BufferGeometry[], zc: number, S: Seg, open = false) {
  if (!open) {
    metal.push(lathe([[0.0092, zc - 0.007], [0.011, zc - 0.007], [0.011, zc + 0.007], [0.0092, zc + 0.007], [0.0092, zc - 0.007]], S(20), C.blued, 0, SY - 0.002));
    return;
  }
  for (const sx of [-1, 1]) metal.push(bevelBox(0.0022, 0.016, 0.012, 0.0006, C.blued, [sx * 0.0085, SY - 0.004, zc]));
}

function build(variant: Variant, segScale: number): WeaponModel {
  const S: Seg = (n) => Math.max(8, Math.round(n * segScale));
  const L = LOOK[variant];
  const t81 = variant === 't81';
  /** Saiga-12: samonabíjecí brokovnice z rodiny AK – robustnější zásobník a hlaveň, muška na plynovém bloku. */
  const sg = variant === 'saiga';
  const poly101 = variant === 'ak101' || sg;
  const metal: THREE.BufferGeometry[] = [];
  const furn: THREE.BufferGeometry[] = [];

  // --- Pouzdro: lisovaný plech, víko nahoře; Type 81 má delší pouzdro se zaobleným zadkem. ---
  const rearZ = t81 ? 0.14 : 0.13;
  const recv: P2[] = t81
    ? [[rearZ, 0.004], [rearZ - 0.006, 0.012], [-0.125, 0.012], [-0.125, -0.033], [0.1, -0.033], [0.125, -0.028], [rearZ, -0.016]]
    : [[rearZ, 0.012], [rearZ, -0.02], [rearZ - 0.016, -0.035], [-0.12, -0.035], [-0.12, 0.012]];
  metal.push(sideProfile(recv, 0.033, 0.0015, C.blued));
  // Víko pouzdra (oblý průřez).
  const coverEnd = t81 ? rearZ - 0.004 : rearZ + 0.004;
  metal.push(crossProfile([[-0.0168, 0.008], [0.0168, 0.008], [0.0168, 0.018], [0.0125, 0.0265], [0.006, 0.0305], [-0.006, 0.0305], [-0.0125, 0.0265], [-0.0168, 0.018]], coverEnd, -0.118, 0.0012, C.blued));
  if (variant === 'akm') for (const z of [0.1, 0.075, 0.05]) metal.push(bevelBox(0.02, 0.0024, 0.006, 0.0008, C.blued, [0, 0.031, z]));
  if (variant === 'ak101') metal.push(bevelBox(0.018, 0.002, 0.16, 0.0008, C.blued, [0, 0.0305, 0.03]));
  metal.push(bevelBox(0.008, 0.006, 0.008, 0.0015, C.metalWorn, [0, 0.012, coverEnd + 0.004])); // západka víka
  // Okno vyhazování vpravo, nýty po stranách.
  metal.push(plainBox(0.0015, 0.011, 0.085, C.metalDark, [0.0168, 0.004, 0.005]));
  for (const sx of [-1, 1]) for (const [z, y] of [[0.045, -0.026], [0.06, -0.026], [-0.09, -0.024], [-0.105, -0.024], [-0.1, -0.004]] as const) metal.push(plainBox(0.0016, 0.004, 0.004, C.metalWorn, [sx * 0.0168, y, z]));

  // --- Hledí: blok na předním čepu, sklopné hledí s posuvem, deska s výřezem. ---
  const rsZ0 = t81 ? -0.13 : -0.122;
  metal.push(sideProfile([[rsZ0, 0.0], [rsZ0, 0.024], [rsZ0 - 0.012, 0.031], [rsZ0 - 0.07, 0.028], [rsZ0 - 0.082, 0.016], [rsZ0 - 0.082, 0.0]], 0.026, 0.0015, C.blued));
  metal.push(bevelBox(0.016, 0.003, 0.064, 0.0008, C.blued, [0, 0.0325, rsZ0 - 0.038], [-0.03, 0, 0]));
  metal.push(bevelBox(0.02, 0.006, 0.01, 0.0012, C.metalWorn, [0, 0.033, rsZ0 - 0.03])); // posuv
  notchPlate(metal, rsZ0 - 0.006, 0.03);

  // --- Plynová trubice, horní a dolní předpažbí, plynový blok, hlaveň. ---
  const gasZ0 = rsZ0 - 0.082;
  const gasEnd = sg ? -0.37 : -0.335;
  metal.push(tube(0.0105, gasZ0, gasEnd, S(16), C.blued, 0, 0.026));
  const uhEnd = t81 ? gasZ0 - 0.085 : gasZ0 - 0.11;
  furn.push(crossProfile([[-0.016, 0.014], [0.016, 0.014], [0.0175, 0.024], [0.012, 0.032], [0.0, 0.035], [-0.012, 0.032], [-0.0175, 0.024]], gasZ0 - 0.002, uhEnd, 0.003, L.furniture));
  if (t81) {
    // Kovový tepelný kryt plynové trubice za horním předpažbím s průduchy.
    metal.push(crossProfile([[-0.0125, 0.016], [0.0125, 0.016], [0.0128, 0.028], [0.0, 0.0385], [-0.0128, 0.028]], uhEnd, gasEnd + 0.004, 0.001, C.metal));
    for (let z = uhEnd - 0.012; z > gasEnd + 0.012; z -= 0.016) for (const sx of [-1, 1]) metal.push(plainBox(0.0012, 0.005, 0.008, C.metalDark, [sx * 0.0125, 0.025, z]));
  }
  // Dolní předpažbí (průřez U). Type 81 delší a štíhlejší, s průduchy.
  const lhZ0 = t81 ? -0.127 : -0.122;
  const lhZ1 = t81 ? -0.345 : -0.32;
  const lh: P2[] = t81
    ? [[-0.0195, 0.014], [-0.021, -0.004], [-0.017, -0.022], [-0.008, -0.027], [0.008, -0.027], [0.017, -0.022], [0.021, -0.004], [0.0195, 0.014]]
    : [[-0.022, 0.014], [-0.0245, -0.004], [-0.02, -0.024], [-0.01, -0.03], [0.01, -0.03], [0.02, -0.024], [0.0245, -0.004], [0.022, 0.014]];
  furn.push(crossProfile(lh, lhZ0, lhZ1, 0.004, L.furniture));
  if (poly101) for (const y of [-0.006, -0.016]) for (const sx of [-1, 1]) furn.push(bevelBox(0.0018, 0.0035, 0.15, 0.0006, L.furnitureDark, [sx * 0.0238, y, -0.225]));
  if (variant === 'akm') for (const sx of [-1, 1]) furn.push(bevelBox(0.004, 0.02, 0.07, 0.0018, L.furnitureDark, [sx * 0.0225, -0.008, -0.235])); // prohmaty
  if (t81) for (const z of [-0.2, -0.235, -0.27]) for (const sx of [-1, 1]) metal.push(plainBox(0.0015, 0.008, 0.016, C.metalDark, [sx * 0.0203, -0.006, z]));
  // Kovové objímky předpažbí.
  metal.push(crossProfile(lh.map(([x, y]) => [x * 1.06, y * 1.06] as P2), lhZ1 + 0.004, lhZ1 - 0.006, 0.001, C.blued));
  metal.push(bevelBox(0.03, 0.012, 0.008, 0.002, C.blued, [0, 0.018, gasZ0 - 0.004]));

  // Plynový blok (u Type 81 s regulátorem vpředu).
  const gb0 = gasEnd;
  metal.push(sideProfile([[gb0, -0.011], [gb0, 0.038], [gb0 - 0.012, 0.038], [gb0 - 0.034, 0.012], [gb0 - 0.034, -0.011]], 0.024, 0.0015, C.blued));
  if (t81 || sg) metal.push(lathe(fwd([[0.0, -gb0 + 0.03], [0.0085, -gb0 + 0.03], [0.0085, -gb0 + 0.05], [0.007, -gb0 + 0.052], [0, -gb0 + 0.052]]), S(14), C.metal, 0, 0.026));

  // Hlaveň a čisticí tyč.
  const barrelEnd = t81 ? -0.5 : sg ? -0.53 : -0.47;
  const [br0, br1] = sg ? [0.0128, 0.0122] : [0.0092, 0.0082];
  metal.push(lathe(fwd([[0, 0.11], [br0, 0.11], [br0, 0.3], [br1, 0.305], [br1, -barrelEnd], [0, -barrelEnd]]), S(18), C.blued, 0, 0));
  if (!t81 && !sg) metal.push(tube(0.0028, gb0 - 0.03, barrelEnd + 0.012, S(8), C.metal, 0, -0.016));

  // --- Muška: AK na bloku u ústí s prstencovým krytem; Type 81 vysoký sloupek blíž k bloku. ---
  const fsZ = t81 ? gb0 - 0.068 : sg ? gb0 - 0.014 : barrelEnd + 0.016;
  if (t81) {
    metal.push(sideProfile([[fsZ + 0.014, -0.012], [fsZ + 0.014, 0.012], [fsZ + 0.008, SY - 0.012], [fsZ - 0.008, SY - 0.012], [fsZ - 0.014, 0.012], [fsZ - 0.014, -0.012]], 0.02, 0.0015, C.blued));
    metal.push(bevelBox(0.012, 0.014, 0.024, 0.002, C.blued, [0, -0.018, fsZ])); // úchyt bajonetu
  } else if (!sg) {
    metal.push(sideProfile([[fsZ + 0.015, -0.012], [fsZ + 0.015, 0.012], [fsZ + 0.01, 0.03], [fsZ - 0.01, 0.03], [fsZ - 0.015, 0.012], [fsZ - 0.015, -0.012]], 0.022, 0.0015, C.blued));
  }
  const postBase = t81 ? SY - 0.013 : sg ? 0.037 : 0.029;
  metal.push(bevelBox(0.0022, SY - postBase, 0.0022, 0.0005, C.metalDark, [0, (SY + postBase) / 2, fsZ]));
  hoodRing(metal, fsZ, S, t81);

  // --- Ústí ---
  let muzzleZ: number;
  if (variant === 'akm') {
    // Šikmý kompenzátor (seříznutá hrana vlevo nahoře).
    metal.push(lathe(fwd([[0, -barrelEnd], [0.0108, -barrelEnd], [0.0108, -barrelEnd + 0.03], [0.006, -barrelEnd + 0.031], [0, -barrelEnd + 0.031]]), S(16), C.blued, 0, 0));
    metal.push(bevelBox(0.008, 0.006, 0.014, 0.001, C.metalDark, [-0.004, 0.008, barrelEnd - 0.022], [0.3, 0, 0.4]));
    muzzleZ = barrelEnd - 0.031;
  } else if (variant === 'ak101') {
    // Úsťová brzda: válcové tělo s drážkou, dvě boční okna, komora vpředu.
    metal.push(lathe(fwd([[0, -barrelEnd], [0.0118, -barrelEnd], [0.0118, -barrelEnd + 0.018], [0.0102, -barrelEnd + 0.02], [0.0102, -barrelEnd + 0.024], [0.0122, -barrelEnd + 0.026], [0.0122, -barrelEnd + 0.07], [0.0105, -barrelEnd + 0.072], [0, -barrelEnd + 0.072]]), S(18), C.blued, 0, 0));
    for (const sx of [-1, 1]) metal.push(plainBox(0.0016, 0.007, 0.016, C.metalDark, [sx * 0.0118, 0.0, barrelEnd - 0.05]));
    metal.push(plainBox(0.006, 0.0016, 0.022, C.metalDark, [0, 0.0121, barrelEnd - 0.048]));
    muzzleZ = barrelEnd - 0.072;
  } else if (sg) {
    // Saiga-12: krytka závitu místo úsťového zařízení.
    metal.push(lathe(fwd([[0, -barrelEnd], [0.0134, -barrelEnd], [0.0134, -barrelEnd + 0.018], [0.0125, -barrelEnd + 0.02], [0, -barrelEnd + 0.02]]), S(18), C.blued, 0, 0));
    muzzleZ = barrelEnd - 0.02;
  } else {
    // Dlouhé ústí s kroužky pro nástřelné granáty.
    const prof: Array<[number, number]> = [[0, -barrelEnd], [0.0112, -barrelEnd]];
    for (let k = 0; k < 3; k++) {
      const z = -barrelEnd + 0.008 + k * 0.018;
      prof.push([0.0112, z], [0.0125, z + 0.002], [0.0125, z + 0.008], [0.0112, z + 0.01]);
    }
    prof.push([0.0112, -barrelEnd + 0.068], [0.0098, -barrelEnd + 0.072], [0, -barrelEnd + 0.072]);
    metal.push(lathe(fwd(prof), S(18), C.blued, 0, 0));
    for (const sx of [-1, 1]) metal.push(plainBox(0.0016, 0.004, 0.012, C.metalDark, [sx * 0.0112, 0.002, barrelEnd - 0.062]));
    muzzleZ = barrelEnd - 0.072;
  }

  // --- Lučík, spoušť, pistolová rukojeť, selektor ---
  metal.push(sideProfile([[0.0, -0.033], [-0.002, -0.06], [0.062, -0.06], [0.064, -0.033], [0.058, -0.033], [0.058, -0.054], [0.004, -0.054], [0.006, -0.033]], 0.01, 0.0012, C.blued));
  metal.push(sideProfile([[0.026, -0.034], [0.03, -0.05], [0.024, -0.054], [0.02, -0.036]], 0.005, 0.0008, C.metalWorn));
  metal.push(bevelBox(0.014, 0.006, 0.01, 0.0015, C.metalWorn, [0, -0.05, -0.0])); // záchyt zásobníku
  const gripCol = variant === 'akm' ? C.bakelite : L.furnitureDark;
  const grip: P2[] = [[0.06, -0.033], [0.094, -0.033], [0.128, -0.128], [0.121, -0.137], [0.094, -0.134], [0.083, -0.1], [0.072, -0.058]];
  furn.push(sideProfile(grip, 0.03, 0.004, gripCol));
  if (!t81) {
    // Velká páka selektoru vpravo (zároveň kryt prachu).
    metal.push(sideProfile([[0.118, 0.004], [0.118, -0.004], [-0.025, -0.006], [-0.04, -0.012], [-0.046, -0.007], [-0.032, 0.003]], 0.0022, 0.0006, C.blued, 0.0182));
  } else {
    // Type 81: malý selektor vlevo nad rukojetí.
    metal.push(transform(lathe([[0, 0], [0.006, 0], [0.006, 0.003], [0, 0.0035]], S(12), C.metalWorn), [-0.0175, -0.02, 0.08], [0, -Math.PI / 2, 0]));
    metal.push(bevelBox(0.003, 0.004, 0.022, 0.001, C.metalWorn, [-0.019, -0.02, 0.07], [0.25, 0, 0]));
  }

  // --- Pažba ---
  if (variant === 'akm') {
    furn.push(sideProfile([[rearZ, 0.01], [0.375, -0.018], [0.383, -0.02], [0.383, -0.128], [0.375, -0.134], [0.27, -0.088], [0.18, -0.046], [rearZ, -0.035]], 0.038, 0.006, L.furniture));
    metal.push(bevelBox(0.04, 0.112, 0.006, 0.002, C.blued, [0, -0.075, 0.386]));
  } else if (poly101) {
    // Plná polymerová pažba (pevně rozložená) s hřbetem a vybráním.
    furn.push(sideProfile([[rearZ, 0.012], [0.4, -0.006], [0.408, -0.008], [0.408, -0.124], [0.4, -0.13], [0.3, -0.1], [0.2, -0.06], [rearZ, -0.036]], 0.036, 0.006, L.furniture));
    for (const sx of [-1, 1]) furn.push(sideProfile([[0.21, -0.018], [0.36, -0.03], [0.36, -0.08], [0.24, -0.052]], 0.002, 0.0008, L.furnitureDark, sx * 0.018));
    furn.push(bevelBox(0.04, 0.122, 0.01, 0.003, L.furnitureDark, [0, -0.067, 0.412]));
    metal.push(bevelBox(0.012, 0.02, 0.016, 0.002, C.blued, [-0.02, -0.015, rearZ + 0.01])); // závěs skládání
  } else {
    // Type 81: přímější dřevěná pažba, výraznější krk, kovová botka a poutko na boku.
    furn.push(sideProfile([[rearZ - 0.004, 0.004], [0.4, -0.01], [0.408, -0.012], [0.408, -0.13], [0.398, -0.136], [0.31, -0.104], [0.22, -0.05], [0.17, -0.034], [rearZ - 0.004, -0.02]], 0.036, 0.006, L.furniture));
    metal.push(bevelBox(0.04, 0.12, 0.006, 0.002, C.blued, [0, -0.071, 0.411]));
    metal.push(bevelBox(0.004, 0.006, 0.03, 0.0015, C.blued, [-0.019, -0.06, 0.3]));
  }

  // --- Montáž kolimátoru (jen AK-101): boční lišta vlevo, rameno přes víko, tubus nahoře. ---
  let optic: WeaponModel['optic'];
  const axisY = 0.0775;
  const oz0 = 0.03, oz1 = -0.087;
  if (variant === 'ak101') {
    metal.push(bevelBox(0.004, 0.016, 0.1, 0.001, C.blued, [-0.0185, -0.004, -0.02])); // boční lišta (rybina)
    metal.push(bevelBox(0.008, 0.026, 0.07, 0.002, C.optic, [-0.024, 0.0, -0.02]));
    metal.push(sideProfile([[0.012, 0.006], [0.012, 0.05], [-0.052, 0.05], [-0.052, 0.006], [-0.032, 0.006], [-0.03, 0.03], [-0.006, 0.03], [-0.004, 0.006]], 0.008, 0.0015, C.optic, -0.024));
    metal.push(bevelBox(0.036, 0.007, 0.064, 0.0018, C.optic, [-0.008, 0.053, -0.02]));
    metal.push(bevelBox(0.004, 0.012, 0.012, 0.001, C.metalWorn, [-0.03, -0.004, -0.004])); // upínací páčka
    const o = buildOptic(axisY, oz0, oz1, S);
    metal.push(...o.metal);
    optic = { lensZ: o.lensZ, axisY, innerR: o.innerR, glass: o.glass };
  }

  // --- Pohyblivé díly ---
  const magLen = sg ? 0.16 : variant === 'ak101' ? 0.19 : 0.2;
  const magCurve = variant === 'akm' ? 0.062 : variant === 'ak101' ? 0.036 : sg ? 0.012 : 0.05;
  const magDepth = sg ? 0.085 : 0.062;
  const magParts = [curvedMag(magLen, magDepth, sg ? 0.036 : 0.024, magCurve, L.mag)];
  magParts.push(bevelBox(sg ? 0.036 : 0.026, 0.008, 0.012, 0.002, L.mag, [0, -0.004, -magDepth / 2])); // přední háček
  if (sg) {
    magParts.push(bevelBox(0.04, 0.01, 0.09, 0.003, '#1b1b1b', [0, -magLen, -magCurve * 0.9])); // dno
    for (const sx of [-1, 1]) magParts.push(bevelBox(0.002, 0.11, 0.05, 0.0008, '#1c1c1d', [sx * 0.0185, -0.075, -0.004])); // boční prolisy
    metal.push(bevelBox(0.042, 0.01, 0.094, 0.002, C.blued, [0, -0.036, -0.043])); // rozšířená šachta
  }
  if (variant === 'ak101') for (const sx of [-1, 1]) magParts.push(curvedMag(magLen * 0.8, 0.012, 0.002, magCurve * 0.75, '#222223').translate(sx * 0.0125, -0.02, 0.0));
  const magGeo = merge(magParts);
  const handle = merge([
    bevelBox(0.016, 0.006, 0.008, 0.0015, C.blued, [0.008, 0, 0]),
    transform(lathe([[0, 0], [0.0065, 0], [0.0065, 0.01], [0.005, 0.012], [0, 0.012]], S(12), C.blued), [0.014, 0, 0], [0, Math.PI / 2, 0]),
  ]);

  const rear = new THREE.Vector3(0, SY, rsZ0 - 0.006);
  const eye = new THREE.Vector3(0, SY, rear.z + (t81 ? 0.33 : 0.31));
  const points: WeaponPoints = {
    weaponRoot: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, 0, muzzleZ),
    sightRear: optic ? new THREE.Vector3(0, axisY, oz0) : rear,
    sightFront: optic ? new THREE.Vector3(0, axisY, oz1) : new THREE.Vector3(0, SY, fsZ),
    opticEye: optic ? new THREE.Vector3(0, axisY, oz0 + 0.095) : eye,
    opticAxis: new THREE.Vector3(0, 0, -1),
    gripRight: new THREE.Vector3(0, -0.078, 0.093),
    gripLeft: new THREE.Vector3(0, t81 ? -0.024 : -0.028, t81 ? -0.25 : -0.225),
    magazineSocket: new THREE.Vector3(0, -0.033, sg ? -0.043 : -0.034),
    ejectionPort: new THREE.Vector3(0.017, 0.006, 0.01),
    chargingHandle: new THREE.Vector3(0.0168, 0.008, -0.045),
    boltCatch: new THREE.Vector3(0.03, 0.008, -0.045),
  };
  const m = merge(metal), p = merge(furn);
  const name = variant === 'ak101' ? 'AK-101' : variant === 'akm' ? 'AKM' : sg ? 'Saiga-12' : 'Type 81';
  return {
    id: variant,
    name,
    static: { metal: m, polymer: p },
    moving: {
      magazine: { geometry: magGeo, material: 'polymer', pivot: points.magazineSocket.clone() },
      chargingHandle: { geometry: handle, material: 'metal', pivot: points.chargingHandle.clone(), travel: new THREE.Vector3(0, 0, 0.12) },
    },
    optic,
    sight: optic ? 'optic' : 'iron',
    points,
    hipRoot: hipFromGrip(points.gripRight, [0, 0.01, 0]),
    hipRot: new THREE.Euler(0.02, 0.05, 0),
    magRock: 0.9,
    emptyAction: 'chargingHandle',
    reloadStyle: 'magazine',
    cycle: 'none',
    magSide: 0,
    triangles: triCount(m, p, magGeo, handle, optic?.glass),
  };
}

export const buildAK101 = (segScale = 1) => build('ak101', segScale);
export const buildAKM = (segScale = 1) => build('akm', segScale);
export const buildType81 = (segScale = 1) => build('t81', segScale);
export const buildSaiga12 = (segScale = 1) => build('saiga', segScale);
