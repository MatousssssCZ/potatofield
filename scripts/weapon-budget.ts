// Vývojový nástroj: pro každou zbraň najde nejjemnější stupeň detailu v rozpočtu trojúhelníků
// (FP 3 000–3 500, world 1 000–1 300) a zapíše tabulku src/client/render/weapons/budgetTable.ts.
// Spuštění: npx tsx scripts/weapon-budget.ts [--write]
import { writeFileSync } from 'node:fs';
import { SIDEARM_DEFS, WEAPON_DEFS } from '../src/client/render/weapons/catalog';
import { WEAPON_BUDGET } from '../src/client/render/weapons/budget';
import { withDetail, type Detail } from '../src/client/render/weapons/meshkit';

function search(build: (s: number) => { triangles: number }, grid: Detail[], min: number, max: number) {
  let best: { d: Detail; t: number } | null = null;
  let fallback: { d: Detail; t: number } | null = null;
  for (const d of grid) {
    const t = withDetail(d, () => build(1)).triangles;
    if (t <= max && (!best || t > best.t)) best = { d, t };
    if (!fallback || t < fallback.t) fallback = { d, t };
  }
  const r = best ?? fallback!;
  return { ...r, inRange: r.t >= min && r.t <= max };
}

const fpGrid: Detail[] = [];
for (const bevelSegments of [3, 2, 1, 0]) for (const corner of [3, 2, 1, 0]) for (const latheScale of [1.4, 1.2, 1, 0.85, 0.7, 0.6, 0.5, 0.42]) for (const latheMin of [6, 8, 10])
  fpGrid.push({ bevelSegments, corner, latheScale, latheMin, magSegs: [5, 8, 10, 12][bevelSegments], minPart: 0, eyeSegs: 20 });
const worldGrid: Detail[] = [];
for (const minPart of [0, 0.006, 0.01, 0.014, 0.02, 0.03]) for (const bevelSegments of [1, 0]) for (const latheScale of [0.7, 0.6, 0.5, 0.4, 0.33, 0.25, 0.2]) for (const latheMin of [4, 5, 6, 8])
  worldGrid.push({ bevelSegments, corner: 0, latheScale, latheMin, magSegs: 4, minPart, eyeSegs: 0 });

const table: Record<string, { fp: Detail; world: Detail; fpTris: number; worldTris: number }> = {};
for (const def of [...WEAPON_DEFS, ...SIDEARM_DEFS]) {
  const pis = SIDEARM_DEFS.includes(def);
  const fpB = pis ? WEAPON_BUDGET.pistolFirstPerson : WEAPON_BUDGET.firstPerson, wB = pis ? WEAPON_BUDGET.pistolWorld : WEAPON_BUDGET.world;
  const fp = search(def.build!, fpGrid, fpB.min, fpB.max);
  const wd = search(def.build!, worldGrid, wB.min, wB.max);
  table[def.id] = { fp: fp.d, world: wd.d, fpTris: fp.t, worldTris: wd.t };
  console.log(`${def.id.padEnd(7)} FP ${String(fp.t).padStart(5)}${fp.inRange ? '' : ' (mimo rozsah)'}   world ${String(wd.t).padStart(5)}${wd.inRange ? '' : ' (mimo rozsah)'}`);
}
if (process.argv.includes('--write')) {
  const body = Object.entries(table)
    .map(([id, v]) => `  ${id}: { fp: ${JSON.stringify(v.fp)}, world: ${JSON.stringify(v.world)}, fpTris: ${v.fpTris}, worldTris: ${v.worldTris} },`)
    .join('\n');
  writeFileSync(
    'src/client/render/weapons/budgetTable.ts',
    `// Vygenerováno: npx tsx scripts/weapon-budget.ts --write (needitovat ručně).\nimport type { Detail } from './meshkit';\n\nexport const BUDGET_TABLE: Record<string, { fp: Detail; world: Detail; fpTris: number; worldTris: number }> = {\n${body}\n};\n`,
  );
  console.log('zapsáno: src/client/render/weapons/budgetTable.ts');
}
