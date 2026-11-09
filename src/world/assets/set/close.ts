import type { Part } from '../../parts';
import { surfaceOf } from '../../parts';

/**
 * Uzavřené budovy (styl BF2) a slučování kolizí.
 *
 * Budova s více nadzemními podlažími je zvenku plná: okna mají sklo, dveře jsou zavřené,
 * interiér se nevytváří. Otevřené zůstávají jen prostory, které slouží jako kryt nebo průchod
 * (výklenek vstupu, podloubí, průjezd) – ty se zadávají jako „díry“ v plném objemu.
 * Kolize uzavřené budovy = plné kvádry objemu (pár kusů) + vnější prvky (atiky, balkony…).
 */

/** Kvádr [x0, y0, z0, x1, y1, z1] v lokálních souřadnicích budovy. */
export type B6 = [number, number, number, number, number, number];

export interface ClosedSpec {
  /** Plné objemy budovy (hmoty). */
  solids: B6[];
  /** Otevřené prostory uvnitř hmot (výklenek, podloubí, průjezd). */
  holes?: B6[];
}

/** Režim generování: při `closed` dají stěny do otvorů sklo / zavřené dveře. Nastavuje reg(). */
export const MODE = { closed: false };

const inside = (p: [number, number, number], b: B6, padH: number, padYLo: number, padYHi: number) =>
  p[0] > b[0] + padH && p[0] < b[3] - padH && p[2] > b[2] + padH && p[2] < b[5] - padH && p[1] > b[1] + padYLo && p[1] < b[4] - padYHi;

/** Plný objem minus díry jako sada kvádrů (rozklad na buňky + sloučení). */
export function decompose(solids: B6[], holes: B6[] = []): B6[] {
  const xs = [...new Set([...solids, ...holes].flatMap((b) => [b[0], b[3]]))].sort((a, b) => a - b);
  const ys = [...new Set([...solids, ...holes].flatMap((b) => [b[1], b[4]]))].sort((a, b) => a - b);
  const zs = [...new Set([...solids, ...holes].flatMap((b) => [b[2], b[5]]))].sort((a, b) => a - b);
  const cells: B6[] = [];
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < ys.length; j++)
      for (let k = 0; k + 1 < zs.length; k++) {
        const c: [number, number, number] = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, (zs[k] + zs[k + 1]) / 2];
        if (!solids.some((b) => inside(c, b, 0, 0, 0))) continue;
        if (holes.some((h) => inside(c, h, 0, 0, 0))) continue;
        cells.push([xs[i], ys[j], zs[k], xs[i + 1], ys[j + 1], zs[k + 1]]);
      }
  return mergeBoxes(cells);
}

/** Hladově slučuje kvádry, které se shodují ve dvou rozměrech a dotýkají se ve třetím. */
export function mergeBoxes(list: B6[]): B6[] {
  const b = list.map((x) => [...x] as B6);
  const eq = (u: number, v: number) => Math.abs(u - v) < 1e-4;
  const canMerge = (A: B6, B: B6): number => {
    for (const ax of [0, 1, 2]) {
      const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
      if (!eq(A[o1], B[o1]) || !eq(A[o1 + 3], B[o1 + 3]) || !eq(A[o2], B[o2]) || !eq(A[o2 + 3], B[o2 + 3])) continue;
      if (A[ax + 3] < B[ax] - 1e-3 || B[ax + 3] < A[ax] - 1e-3) continue;
      return ax;
    }
    return -1;
  };
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const ax = canMerge(b[i], b[j]);
        if (ax < 0) continue;
        b[i][ax] = Math.min(b[i][ax], b[j][ax]);
        b[i][ax + 3] = Math.max(b[i][ax + 3], b[j][ax + 3]);
        b.splice(j, 1);
        j = i; // A se zvětšil – projít zbytek znovu
        merged = true;
      }
  }
  return b;
}

const boxPart = (b: B6, material: string): Part => ({
  shape: 'box',
  pos: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2],
  size: [b[3] - b[0], b[4] - b[1], b[5] - b[2]],
  material,
  collide: true,
  render: false,
});

/**
 * Uzavření budovy: díly uvnitř plného objemu (příčky, schody, nábytek, stropy) se vynechají,
 * díly v obvodovém pásu zdí zůstanou jen jako vzhled, kolize nahradí plné kvádry objemu.
 */
export function closeParts(parts: Part[], spec: ClosedSpec, wallMat: string): Part[] {
  const holes = spec.holes ?? [];
  const out: Part[] = [];
  for (const p of parts) {
    const c = p.pos;
    const inHole = holes.some((h) => inside(c, [h[0] - 0.05, h[1] - 0.05, h[2] - 0.05, h[3] + 0.05, h[4] + 0.05, h[5] + 0.05], 0, 0, 0));
    // Vnitřek: dál než 0,31 m od líce a pod střešní deskou.
    // Stropní desky zůstanou jako vzhled: jejich hrany tvoří pás mezi podlažími (jinak by mezi
    // zdmi pater prosvítala spára).
    const slabLike = p.shape === 'box' && p.size[1] <= 0.25 && (p.size[0] > 1.5 || p.size[2] > 1.5) && !p.rot;
    const interior = !slabLike && !inHole && spec.solids.some((b) => inside(c, b, 0.31, -0.01, 0.25));
    if (interior) continue;
    const inSolid = !inHole && spec.solids.some((b) => inside(c, b, -0.02, -0.02, -0.02));
    out.push(p.collide && inSolid ? { ...p, collide: false } : p);
  }
  for (const b of decompose(spec.solids, holes)) out.push(boxPart(b, wallMat));
  return out;
}

/**
 * Sloučení kolizí: z každého kolizního kvádru bez natočení se oddělí čistě kolizní díl
 * (vzhled zůstane beze změny) a kolizní díly se stejným povrchem a chováním se sloučí.
 */
export function mergeColliders(parts: Part[]): Part[] {
  const keep: Part[] = [];
  const groups = new Map<string, { mat: string; boxes: B6[] }>();
  for (const p of parts) {
    const plainBox = p.shape === 'box' && p.collide && (!p.rot || p.rot.every((v) => Math.abs(v) < 1e-9));
    if (!plainBox) {
      keep.push(p);
      continue;
    }
    if (p.render !== false) keep.push({ ...p, collide: false });
    const key = `${surfaceOf(p.material)}|${p.bulletOnly ? 1 : 0}|${p.moveOnly ? 1 : 0}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { mat: p.material, boxes: [] }));
    const [x, y, z] = p.pos, [w, h, d] = p.size;
    g.boxes.push([x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2]);
  }
  for (const [key, g] of groups) {
    const [, bo, mo] = key.split('|');
    for (const b of mergeBoxes(g.boxes)) keep.push({ ...boxPart(b, g.mat), bulletOnly: bo === '1' || undefined, moveOnly: mo === '1' || undefined });
  }
  return keep;
}
