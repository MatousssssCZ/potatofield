// Vývojový nástroj: autosave, obnovení po zavření, chybný import, plné úložiště.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, tmp] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const ok = (c, m) => console.log(c ? 'OK  ' : 'FAIL', m);
const load = async (page) => { await page.goto(`${url}?q=low`); await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 180000 }); };
let page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await load(page);
const id = await page.evaluate(async () => {
  const a = window.__pf;
  const { buildEmptyMap } = await import('/src/world/maps/empty.ts');
  a.openDoc(buildEmptyMap('Persistence'), true);
  a.editor.insertAsset('cover.crate');
  a.editor.insertAsset('prim.box');
  await new Promise((r) => setTimeout(r, 1500));
  return { id: a.ed.doc.id, n: a.ed.doc.objects.length, state: a.saver.state };
});
ok(id.state === 'saved', `autosave po operacích: ${id.state}`);
await page.close();
page = await ctx.newPage();
await load(page);
const r = await page.evaluate(() => ({ id: window.__pf.ed.doc.id, n: window.__pf.ed.doc.objects.length, name: window.__pf.ed.doc.name }));
ok(r.id === id.id && r.n === 2, `po zavření a otevření se obnovila poslední mapa ${JSON.stringify(r)}`);
// Chybný import
writeFileSync(`${tmp}/bad.json`, '{"schemaVersion": 99, "id": "x"}');
await page.evaluate(() => document.querySelector('#file-import').classList.remove('hidden'));
await page.setInputFiles('#file-import', `${tmp}/bad.json`);
await page.waitForTimeout(500);
const modalText = await page.textContent('#modal');
const after = await page.evaluate(() => ({ id: window.__pf.ed.doc.id, n: window.__pf.ed.doc.objects.length }));
ok(/Import selhal/.test(modalText) && /novější formát/.test(modalText) && after.id === id.id && after.n === 2, `chybný import odmítnut, mapa beze změny: "${modalText.slice(0, 120)}"`);
await page.click('#modal .modal-buttons button');
// Plné úložiště: simulace QuotaExceededError
const q = await page.evaluate(async () => {
  const a = window.__pf;
  const orig = a.store.save.bind(a.store);
  a.store.save = async () => { const { QuotaError } = await import('/src/client/editor/persistence.ts'); throw new QuotaError('plné'); };
  a.editor.insertAsset('cover.barrel');
  await a.saver.flush();
  const res = { state: a.saver.state, msg: a.saver.message, status: document.querySelector('#st-save').textContent };
  a.store.save = orig;
  return res;
});
ok(q.state === 'error' && /export/i.test(q.msg), `plné úložiště ohlášeno s nabídkou exportu: ${q.status}`);
// Export obsahuje vše potřebné (soběstačný JSON)
const exp = await page.evaluate(() => { const d = window.__pf.ed.doc; const t = JSON.stringify(d); return { bytes: t.length, http: /https?:\/\//.test(t) }; });
ok(!exp.http, `export bez externích URL (${exp.bytes} B)`);
await browser.close();
