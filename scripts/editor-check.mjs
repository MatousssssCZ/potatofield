// Vývojový nástroj: screenshot editoru + kontrola úniků při 20 přepnutích editor ↔ test.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}?q=${process.env.Q ?? 'standard'}&dev`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden') || /Chyba/.test(document.querySelector('#loading .status')?.textContent ?? ''), null, { timeout: 180000 });
console.log('status', await page.textContent('#loading .status'));
const shot = async (name) => { await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 }); console.log('shot', name); };
// Pohled na stanoviště a výběr objektu
await page.evaluate(() => { const a = window.__pf; a.camera.position.set(14, 9, 16); a.editor.restoreCamera({ pos: a.camera.position.clone(), yaw: 0.55, pitch: -0.42, fov: 60 }); a.editor.select(['obj_087']); });
await shot('editor-select');
// Vložení zdi z katalogu, posun a změna parametru přes historii
const res = await page.evaluate(() => {
  const a = window.__pf;
  a.editor.insertAsset('prim.box');
  const id = [...a.editor.selection][0];
  return { id, n: a.ed.doc.objects.length };
});
console.log('inserted', res);
await shot('editor-insert');
// 20 přepnutí
const before = await page.evaluate(async () => { const a = window.__pf; await a.enterPlay(); a.exitPlay(); return a.counts(); });
for (let i = 0; i < 19; i++) await page.evaluate(async () => { const a = window.__pf; await a.enterPlay(); a.session.update(0.1); a.exitPlay(); });
const after = await page.evaluate(() => window.__pf.counts());
const docSame = await page.evaluate(() => JSON.stringify(window.__pf.ed.doc).length);
console.log('counts po 1. přepnutí', JSON.stringify(before));
console.log('counts po 20 přepnutích', JSON.stringify(after), 'doc len', docSame);
// Herní pohled z testovacího režimu
await page.evaluate(async () => { const a = window.__pf; await a.enterPlay(); document.querySelector('#menu').classList.add('hidden'); document.querySelector('#hud').classList.remove('hidden'); });
await shot('play');
await page.evaluate(() => window.__pf.exitPlay());
await shot('editor-back');
await browser.close();
