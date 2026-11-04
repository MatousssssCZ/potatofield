// Vývojový nástroj: skutečné screenshoty z běžící aplikace (headless Chromium).
// Použití: node scripts/shot.mjs <url> <outDir> [quality]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out, q = 'standard'] = process.argv.slice(2);
const views = JSON.parse(process.env.VIEWS ?? '[]');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}?q=${q}&dev`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden') || /Chyba|neprošla/.test(document.querySelector('#loading .status')?.textContent ?? ''), null, { timeout: 180000 });
const st = await page.textContent('#loading .status');
console.log('status:', st);
await page.evaluate(() => { document.querySelector('#menu').classList.add('hidden'); document.querySelector('#hud').classList.remove('hidden'); });
for (const v of views) {
  await page.evaluate((v) => {
    const pf = window.__pf; pf.game.spawn(v.pos, v.yaw * Math.PI / 180); pf.game.state.pitch = (v.pitch ?? 0) * Math.PI / 180;
    if (v.stance) { pf.game.state.stance = v.stance; pf.game.state.height = { stand: 1.8, crouch: 1.2, prone: 0.5 }[v.stance]; pf.game.state.proneToggle = v.stance === 'prone'; }
  }, v);
  await page.waitForTimeout(v.wait ?? 2500);
  const t0 = Date.now(); await page.screenshot({ path: `${out}/${v.name}.png`, timeout: 180000 }); console.log('fps-ish', await page.evaluate(() => document.querySelector('#dev').textContent.split('\n')[0]), 'shot ms', Date.now() - t0);
  console.log('shot', v.name);
}
await browser.close();
