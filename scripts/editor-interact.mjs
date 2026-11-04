// Vývojový nástroj: interakce myší a klávesnicí v editoru (skutečné události prohlížeče).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}?q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 180000 });
const ok = (c, m) => console.log(c ? 'OK  ' : 'FAIL', m);
// Nová prázdná mapa, kamera shora
await page.evaluate(async () => {
  const a = window.__pf;
  const { buildEmptyMap } = await import('/src/world/maps/empty.ts');
  a.openDoc(buildEmptyMap('Test'), false);
  a.editor.restoreCamera({ pos: new a.camera.position.constructor(0, 12, 14), yaw: 0, pitch: -0.7, fov: 60 });
  a.editor.insertAsset('prim.box');
});
await page.waitForTimeout(800);
const proj = (x, y, z) => page.evaluate(([x, y, z]) => {
  const a = window.__pf; const v = new a.camera.position.constructor(x, y, z).project(a.camera);
  const r = document.querySelector('#view').getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}, [x, y, z]);
const st = () => page.evaluate(() => { const a = window.__pf; const id = [...a.editor.selection][0]; const o = a.ed.getObject(id); return { id, sel: a.editor.selection.size, pos: o?.transform.position, n: a.ed.doc.objects.length, undo: a.history.undoLabel, w: o?.params.width }; });
let s0 = await st();
ok(s0.sel === 1, `vložený objekt je vybraný ${JSON.stringify(s0)}`);
// Najít šipku osy X gizma: posun po ose X od pivotu, dokud hover nenastaví axis
const p = s0.pos;
let found = null;
for (let k = 0.3; k < 4 && !found; k += 0.1) {
  const q = await proj(p[0] + k, p[1], p[2]);
  await page.mouse.move(q.x, q.y);
  await page.waitForTimeout(30);
  const axis = await page.evaluate(() => window.__pf.editor['tc'].axis);
  if (axis === 'X') found = q;
}
ok(!!found, `hover nad šipkou X nastaví osu gizma ${JSON.stringify(found)}`);
if (found) {
  await page.mouse.down(); await page.mouse.move(found.x + 40, found.y, { steps: 5 }); await page.mouse.move(found.x + 90, found.y, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const s1 = await st();
  ok(s1.pos[0] > p[0] + 0.4 && Math.abs((s1.pos[0] / 0.5) - Math.round(s1.pos[0] / 0.5)) < 1e-6 && s1.pos[2] === p[2], `tažení posunulo po X s přichycením na 0,5 m ${JSON.stringify(s1.pos)}; historie: ${s1.undo}`);
  ok(s1.sel === 1 && s1.id === s0.id, 'klik na gizmo nezměnil výběr');
}
// Ctrl+Z vrátí pozici
await page.keyboard.press('Control+KeyZ'); await page.waitForTimeout(200);
let s2 = await st();
ok(JSON.stringify(s2.pos) === JSON.stringify(p), `Ctrl+Z vrátil pozici ${JSON.stringify(s2.pos)}`);
await page.keyboard.press('Control+Shift+KeyZ'); await page.waitForTimeout(200);
// Ctrl+D duplikuje, Delete maže
await page.keyboard.press('Control+KeyD'); await page.waitForTimeout(300);
let s3 = await st();
ok(s3.n === 2 && s3.id !== s0.id, `Ctrl+D duplikoval (${s3.n} objektů, nové ID ${s3.id})`);
await page.keyboard.press('Delete'); await page.waitForTimeout(300);
let s4 = await st();
ok(s4.n === 1 && s4.sel === 0, `Delete smazal (${s4.n} objektů)`);
// Klik do prázdna zruší výběr, klik na objekt vybere
const cur = (await page.evaluate(() => window.__pf.ed.doc.objects[0].transform.position));
p[0] = cur[0]; p[1] = cur[1]; p[2] = cur[2];
await page.mouse.click(10 + (await proj(p[0] - 6, 0, p[2] + 3)).x, (await proj(p[0] - 6, 0, p[2] + 3)).y);
const c = await proj(p[0], p[1] + 1, p[2]);
await page.mouse.click(c.x, c.y); await page.waitForTimeout(200);
let s5 = await st();
ok(s5.sel === 1, 'klik na objekt ho vybral');
const e = await proj(p[0] - 6, 0, p[2] + 3);
await page.mouse.click(e.x, e.y); await page.waitForTimeout(200);
ok((await st()).sel === 0, 'klik do prázdna zrušil výběr');
// Rámeček
await page.mouse.move(c.x - 120, c.y - 120); await page.mouse.down(); await page.mouse.move(c.x + 120, c.y + 120, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
ok((await st()).sel === 1, 'výběr rámečkem');
// Psaní do inspektoru nehýbe kamerou ani nemaže
const camBefore = await page.evaluate(() => window.__pf.camera.position.toArray().join());
const inp = page.locator('#inspector .prop input[type=number]').nth(4); // šířka
await inp.click(); await inp.fill('5'); await page.keyboard.press('KeyW'); await page.keyboard.press('Delete');
await page.keyboard.press('Enter'); await page.waitForTimeout(300);
const s6 = await st();
const camAfter = await page.evaluate(() => window.__pf.camera.position.toArray().join());
ok(s6.n === 1 && camBefore === camAfter, 'psaní do pole nemaže objekt a nehýbe kamerou');
ok(s6.w === 5, `změna parametru v inspektoru (šířka ${s6.w}, historie: ${s6.undo})`);
// Rozměrový handle R: změna parametrů, ne mesh.scale
await page.mouse.click(e.x, e.y); await page.mouse.click(c.x, c.y); await page.keyboard.press('KeyR'); await page.waitForTimeout(200);
let fx = null;
for (let k = 0.3; k < 6 && !fx; k += 0.1) { const q = await proj(p[0] + k, p[1], p[2]); await page.mouse.move(q.x, q.y); await page.waitForTimeout(25); if ((await page.evaluate(() => window.__pf.editor['tc'].axis)) === 'X') fx = q; }
if (fx) {
  await page.mouse.down(); await page.mouse.move(fx.x + 60, fx.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
  const s7 = await st();
  const sc = await page.evaluate((id) => window.__pf.world.objects.get(id).scale.toArray().join(), s7.id);
  ok(s7.w !== 5 && sc === '1,1,1', `rozměrový handle změnil parametr šířky na ${s7.w}, mesh bez natažení (${sc}); historie: ${s7.undo}`);
} else ok(false, 'handle X pro rozměry nenalezen');
await page.screenshot({ path: `${out}/interact.png` });
await browser.close();
