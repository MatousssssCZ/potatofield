// Vývojová kontrola: magnet budov v editoru (skutečné tažení myší).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}?editor&q=low`, { waitUntil: "load" });
await page.waitForFunction(() => window.__pf && window.__pf.editor, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
await page.evaluate(async () => {
  const a = window.__pf;
  const { buildEmptyMap } = await import('/src/world/maps/empty.ts');
  a.openDoc(buildEmptyMap('Test'), false);
  a.editor.restoreCamera({ pos: new a.camera.position.constructor(2, 14, 10), yaw: 0, pitch: -0.95, fov: 60 });
  a.editor.insertAsset('setB.facade4Blank');
  a.editor.insertAsset('setB.facade4Blank');
});
await page.waitForTimeout(800);
const ids = await page.evaluate(async () => {
  const a = window.__pf;
  const { cmds } = await import('/src/client/editor/editorDoc.ts');
  const [o1, o2] = a.ed.doc.objects;
  a.history.execute(cmds.update(a.ed, o1.id, (x) => { x.transform.position = [0, 0, 0]; x.transform.rotation = [0, 0, 0]; }));
  a.history.execute(cmds.update(a.ed, o2.id, (x) => { x.transform.position = [5.5, 0, 1.5]; x.transform.rotation = [0, Math.PI, 0]; }));
  a.editor.select?.([o2.id]);
  return [o1.id, o2.id];
});
await page.waitForTimeout(500);
const proj = (x, y, z) => page.evaluate(([x, y, z]) => {
  const a = window.__pf; a.camera.updateMatrixWorld(); const v = new a.camera.position.constructor(x, y, z).project(a.camera);
  const r = document.querySelector('#view').getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}, [x, y, z]);
const pos = () => page.evaluate((id) => window.__pf.ed.getObject(id).transform.position, ids[1]);
// Uchopit druhou fasádu za horní hranu stěny a táhnout tak, aby skončila ~ (4.35, 0.25).
const a0 = await proj(5.5 + 1.2, 0.05, 1.5);
const a1 = await proj(4.35 + 1.2, 0.05, 0.25);
await page.mouse.click(a0.x, a0.y);
await page.waitForTimeout(300);
await page.mouse.move(a0.x, a0.y);
await page.mouse.down();
await page.mouse.move((a0.x + a1.x) / 2, (a0.y + a1.y) / 2, { steps: 6 });
await page.mouse.move(a1.x, a1.y, { steps: 6 });
await page.waitForTimeout(200);
const hint = await page.evaluate(() => document.querySelector('.ed-hint, #ed-hint, [class*=hint]')?.textContent ?? '');
await page.mouse.up();
await page.waitForTimeout(300);
const p1 = await pos();
const label = await page.evaluate(() => window.__pf.history.undoLabel);
ok(Math.abs(p1[0] - 4) < 1e-3 && Math.abs(p1[2]) < 1e-3, `fasáda přilepena konec na konec: ${JSON.stringify(p1)} (${label})`);
ok(/Magnet/.test(hint), `nápověda u kurzoru ukazuje magnet: „${hint.replace(/\n/g, ' | ').slice(0, 120)}“`);
// S Altem magnet nepůsobí.
await page.keyboard.press('Control+KeyZ'); await page.waitForTimeout(300);
const b0 = await proj(5.5 + 1.2, 0.05, 1.5);
await page.mouse.move(b0.x, b0.y);
await page.keyboard.down('Alt');
await page.mouse.down();
await page.mouse.move(a1.x, a1.y, { steps: 10 });
await page.mouse.up();
await page.keyboard.up('Alt');
await page.waitForTimeout(300);
const p2 = await pos();
ok(Math.abs(p2[0] - 4) > 0.05 || Math.abs(p2[2]) > 0.05, `s Altem bez magnetu: ${JSON.stringify(p2)}`);
await browser.close();
