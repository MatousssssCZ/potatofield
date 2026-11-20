/**
 * Exportuje referenční mapy (šablony z kódu) do přenosných JSON souborů v maps/.
 * Pozor: maps/street_reference.json je mapa serveru upravená v editoru – existující soubor se
 * přepíše jen s --force (jinak by se ručně upravená mapa nahradila šablonou).
 */
import { existsSync, writeFileSync } from 'node:fs';
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
  if (existsSync(file) && !process.argv.includes('--force')) {
    console.log(file, 'existuje – přeskočeno (přepsat šablonou: --force)');
    continue;
  }
  writeFileSync(file, JSON.stringify(doc));
  console.log(file, doc.objects.length, 'objektů');
}
