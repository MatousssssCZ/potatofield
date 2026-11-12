// Vývojová kontrola vertikálního řezu Skladové osady v reálném editoru:
// otevřít scénu, vložit B01, změnit parametr, undo/redo, uložit, znovu načíst, Test (hra) a snímky.
// Použití: node scripts/osada-slice.mjs [url] [složka-na-snímky]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const dir = process.argv[3];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
p.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
await p.goto(`${url}?editor&q=low`);
await p.waitForFunction(() => window.__pf && window.__pf.editor, null, { timeout: 240000 });
await p.waitForTimeout(1500);
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const n0 = await p.evaluate(async () => {
  const { buildOsadaSliceMap } = await import('/src/world/maps/osadaSlice.ts');
  const d = buildOsadaSliceMap();
  window.__pf.openDoc(d, false);
  return d.objects.length;
});
await p.waitForTimeout(2500);
const cam = (x, y, z, yaw, pitch) => p.evaluate(([x, y, z, yaw, pitch]) => { const a = window.__pf; a.editor.restoreCamera({ pos: new a.camera.position.constructor(x, y, z), yaw, pitch, fov: 60 }); }, [x, y, z, yaw, pitch]);
const snap = async (name) => { if (dir) { await p.waitForTimeout(900); await p.screenshot({ path: `${dir}/${name}.png` }); } };
await cam(-38, 22, 26, -0.75, -0.45); await snap('osada-01-prehled');
await cam(-20, 4, 4, 0, -0.12); await snap('osada-02-domy');
await cam(20, 9, -6, 0.15, -0.3); await snap('osada-03-hala');
await cam(-26, 7, 9, -1.2, -0.5); await snap('osada-06-prechod-asfalt-hlina');
await cam(6, 7, 9, -0.7, -0.55); await snap('osada-07-krizovatka-T');
await cam(28, 6, 7, -0.9, -0.5); await snap('osada-08-beton-dlazba');
await cam(-31, 6, 42, 0, -0.25); await snap('osada-04-svah-zed');
await cam(6, 5, 52, 0, -0.2); await snap('osada-04b-balvany-hlina');
// Vložit B01 z katalogu, undo/redo.
await cam(30, 12, 30, 0.4, -0.6);
const ins = await p.evaluate(() => { const a = window.__pf; a.editor.insertAsset('osada.house'); return { n: a.ed.doc.objects.length, sel: [...a.editor.selection][0] }; });
ok(ins.n === n0 + 1, `vložen B01 (${ins.n} objektů)`);
const undo1 = await p.evaluate(() => { const a = window.__pf; a.editor.undo(); const n1 = a.ed.doc.objects.length; a.editor.redo(); return [n1, a.ed.doc.objects.length]; });
ok(undo1[0] === n0 && undo1[1] === n0 + 1, `undo/redo vložení: ${undo1.join(' → ')}`);
// Změna délky přes panel vlastností (jedno pole = jeden krok historie).
await p.evaluate((id) => window.__pf.editor.select([id]), ins.sel);
await p.waitForTimeout(400);
const changed = await p.evaluate(async (id) => {
  const a = window.__pf;
  const row = [...document.querySelectorAll('.prop')].find((r) => r.textContent.includes('Délka (X)'));
  const input = row?.querySelector('input');
  if (!input) return { err: 'pole Délka nenalezeno' };
  const before = a.world.objects.get(id).children.length;
  input.value = '14';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const o = a.ed.getObject(id);
  const after = a.world.objects.get(id).children.length;
  a.editor.undo();
  const len1 = a.ed.getObject(id).params.length;
  a.editor.redo();
  return { len: o.params.length, before, after, len1, len2: a.ed.getObject(id).params.length };
}, ins.sel);
ok(changed.len === 14 && changed.len1 === 8 && changed.len2 === 14, `délka 8 → 14 m, undo 8, redo 14 (${JSON.stringify(changed)})`);
// Uložit a znovu načíst z úložiště prohlížeče.
const rt = await p.evaluate(async () => {
  const a = window.__pf;
  await a.store.save(a.ed.doc);
  const l = await a.store.load(a.ed.doc.id);
  const strip = (d) => JSON.stringify({ o: d.objects, c: d.controlPoints, s: d.spawnPoints, t: d.terrain.heights.length });
  const same = strip(l.doc) === strip(a.ed.doc);
  a.openDoc(l.doc, false);
  return { same, n: l.doc.objects.length };
});
ok(rt.same, `uložení a načtení: shodná data (${rt.n} objektů)`);
await p.waitForTimeout(2000);
// Test ve hře: postava u návsi, projde průchozím domem (chůze řízená hrou).
await p.evaluate(() => { const a = window.__pf; a.ed.doc.testSpawn = { position: [-7, 0.1, -3], rotation: [0, 0, 0] }; a.editor.updateSpawnMarker(); });
await p.click('#tb-play');
await p.waitForTimeout(200);
await p.keyboard.press('Enter');
await p.waitForTimeout(800);
// Mapa má vlajky → dialog režimu testu; zvolit volný test.
await p.getByRole('button', { name: 'Volný test od markeru' }).click({ timeout: 5000 }).catch(() => {});
await p.waitForFunction(() => window.__pf.mode === 'play', null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(1500);
console.log('dialog:', await p.evaluate(() => [...document.querySelectorAll('.modal, dialog, [class*=modal]')].map((t) => t.textContent.slice(0, 400)).join(' | ')));
ok((await p.evaluate(() => window.__pf.mode)) === 'play', 'Test: hra běží na mapě řezu');
await snap('osada-05-hra');
await p.evaluate(() => window.__pf.exitPlay());
await p.waitForTimeout(1200);
ok((await p.evaluate(() => window.__pf.mode)) === 'editor', 'návrat do editoru');
const hist = await p.evaluate(() => { const a = window.__pf; const id = a.ed.doc.objects.at(-1).id; return a.ed.getObject(id)?.params.length; });
ok(hist === 14, `editace zachována po návratu ze hry (délka ${hist})`);
ok(errors.length === 0, `bez chyb stránky (${errors.length})`);
await b.close();
