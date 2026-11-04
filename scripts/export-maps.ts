/** Exportuje referenční mapy do přenosných JSON souborů v maps/. */
import { writeFileSync } from 'node:fs';
import { buildRangeMap } from '../src/world/maps/range';
import { validateMap } from '../src/shared/map/validate';

const doc = buildRangeMap();
const r = validateMap(JSON.parse(JSON.stringify(doc)));
if (!r.ok) {
  console.error(r.issues);
  process.exit(1);
}
writeFileSync('maps/range_technical.json', JSON.stringify(doc));
console.log('maps/range_technical.json', doc.objects.length, 'objektů');
