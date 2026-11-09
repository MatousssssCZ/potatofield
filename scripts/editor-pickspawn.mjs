// Vývojová kontrola: Test z editoru s výběrem místa + načtení přehledové mapy sady 300.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const shot = process.argv[3];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${url}?editor&q=low`);
await p.waitForFunction(() => window.__pf && window.__pf.editor, null, { timeout: 240000 });
await p.waitForTimeout(1500);
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
// Přehledová mapa.
const t0 = Date.now();
const info = await p.evaluate(async () => {
  const { buildShowcaseMap } = await import('/src/world/maps/showcase.ts');
  const d = buildShowcaseMap();
  window.__pf.openDoc(d, false);
  return { n: d.objects.length, spawn: d.testSpawn.position };
});
await p.waitForTimeout(3000);
ok(info.n === 611, `přehledová mapa načtena: ${info.n} objektů za ${((Date.now() - t0) / 1000).toFixed(1)} s`);
// Kamera nad první řadou, klik na Test, klik do scény.
await p.evaluate(() => { const a = window.__pf; a.editor.restoreCamera({ pos: new a.camera.position.constructor(-120, 25, -330), yaw: Math.PI, pitch: -0.6, fov: 60 }); });
await p.waitForTimeout(800);
if (shot) await p.screenshot({ path: shot });
await p.click('#tb-play');
await p.waitForTimeout(300);
const hint = await p.evaluate(() => document.querySelector('.ed-hint, [class*=hint]')?.textContent ?? '');
const r = await p.evaluate(() => document.querySelector('#view').getBoundingClientRect().toJSON());
const cx = r.left + r.width / 2, cy = r.top + r.height * 0.7;
await p.mouse.move(cx, cy);
await p.waitForTimeout(200);
const expected = await p.evaluate(([x, y]) => { const e = window.__pf.editor; const pt = e['spawnPointAt'](x, y); return pt && [pt.x, pt.y, pt.z]; }, [cx, cy]);
await p.mouse.click(cx, cy);
await p.waitForTimeout(2500);
const st = await p.evaluate(() => ({ mode: window.__pf.mode, spawn: window.__pf.ed.doc.testSpawn.position }));
ok(st.mode === 'play', `po kliknutí se spustil test (režim ${st.mode})`);
ok(expected && Math.hypot(st.spawn[0] - expected[0], st.spawn[2] - expected[2]) < 0.05, `spawn = kliknuté místo ${JSON.stringify(st.spawn)} ~ ${JSON.stringify(expected?.map((v) => +v.toFixed(2)))}`);
// Zpět do editoru, Test a Esc = zrušeno.
await p.evaluate(() => window.__pf.exitPlay());
await p.waitForTimeout(1500);
await p.click('#tb-play');
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
ok((await p.evaluate(() => window.__pf.mode)) === 'editor', 'Esc výběr zruší (zůstává editor)');
await b.close();
