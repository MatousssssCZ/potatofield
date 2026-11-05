// Vývojový nástroj: kontrolní obrázky zbraně z prohlížeče assetů (skutečný renderer).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out] = process.argv.slice(2);
const shots = JSON.parse(process.env.SHOTS ?? '[]');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await page.goto(`${url}/viewer.html`);
await page.waitForFunction(() => window.__viewer, null, { timeout: 120000 });
for (const s of shots) {
  await page.evaluate((s) => {
    const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('change')); };
    if (s.weapon) set('#weapon', s.weapon);
    if (s.view) set('#view', s.view);
    if (s.light) set('#light', s.light);
    if (s.q) set('#q', s.q);
    if (s.fov) set('#fov', s.fov);
    if (s.hands) set('#hands', s.hands);
    if (s.reload !== undefined) window.__viewer.reload(s.reload === 'empty');
    if (s.phase !== undefined) {
      // Deterministická fáze přebití (nezávislá na rychlosti softwarového rendereru).
      const v = window.__viewer;
      v.reload(!!s.empty);
      const d = v.ws.actionEnd - v.ws.actionStart;
      v.ws.actionStart -= s.phase * d;
      v.ws.actionEnd -= s.phase * d;
    }
  }, s);
  await page.waitForTimeout(s.wait ?? 1500);
  await page.screenshot({ path: `${out}/${s.name}.png`, timeout: 120000 });
  console.log('shot', s.name, await page.textContent('#stats'));
}
await browser.close();
