/** Exportuje referenční mapy do přenosných JSON souborů v maps/. */
import { writeFileSync } from 'node:fs';
import { buildStreetMap } from '../src/world/maps/street';
import '../src/world';
import { validateMap } from '../src/shared/map/validate';

for (const [file, doc] of [
  ['maps/street_reference.json', buildStreetMap()],
] as const) {
  const r = validateMap(JSON.parse(JSON.stringify(doc)));
  if (!r.ok) {
    console.error(file, r.issues);
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify(doc));
  console.log(file, doc.objects.length, 'objektů');
}
