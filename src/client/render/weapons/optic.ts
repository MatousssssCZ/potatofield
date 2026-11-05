import * as THREE from 'three';
import { fwd, lathe, transform } from './meshkit';
import { PAL } from './types';

/**
 * Sdílený generátor kompaktního tubusového kolimátoru (bez zvětšení). Montáž si dodává
 * každá zbraň sama (USMC lišta, MEC boční montáž, PLA nosná rukojeť).
 * z0 = zadní čelo (u oka), z1 = přední čelo; osa na výšce axisY.
 */
export function buildOptic(axisY: number, z0: number, z1: number, S: (n: number) => number) {
  const metal: THREE.BufferGeometry[] = [];
  const prof: Array<[number, number]> = [
    [0.0155, -z0], [0.0195, -z0], [0.0195, -z0 + 0.004], [0.0188, -z0 + 0.006], [0.0188, -z1 - 0.012], [0.021, -z1 - 0.006], [0.021, -z1], [0.017, -z1], [0.017, -z1 - 0.008], [0.0155, -z1 - 0.01], [0.0155, -z0],
  ];
  metal.push(lathe(fwd(prof), S(28), PAL.optic, 0, axisY, true));
  const len = z0 - z1;
  for (const f of [0.3, 0.66]) {
    const zr = z0 - len * f;
    metal.push(lathe(fwd([[0.019, -zr - 0.006], [0.0215, -zr - 0.005], [0.0215, -zr + 0.005], [0.019, -zr + 0.006]]), S(24), PAL.optic, 0, axisY, true));
  }
  const zt = (z0 + z1) / 2;
  const turret = (): THREE.BufferGeometry => lathe([[0, 0], [0.008, 0], [0.008, 0.012], [0.006, 0.014], [0, 0.014]], S(14), PAL.optic);
  metal.push(transform(turret(), [0, axisY + 0.018, zt], [-Math.PI / 2, 0, 0]));
  metal.push(transform(turret(), [0.018, axisY, zt], [0, Math.PI / 2, 0]));
  const glass = new THREE.CircleGeometry(0.0156, S(28));
  glass.translate(0, axisY, z1 + 0.012);
  return { metal, glass, lensZ: z1 + 0.012, innerR: 0.0155, outerR: 0.0215 };
}
