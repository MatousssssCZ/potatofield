// Vývojový nástroj: snímek obrazovky nasazení (připojení k místnímu serveru, bez nasazení).
// Použití: npx tsx scripts/deploy-shot.ts <soubor.png> [šířka] [výška]
import { createRequire } from 'node:module';
import { GameServer } from '../server/gameServer';
import { buildStreetMap } from '../src/world/maps/street';
const { chromium } = createRequire(import.meta.url)('playwright');
const [out = 'deploy.png', w = '1920', hgt = '1040'] = process.argv.slice(2);
const server = await GameServer.create(buildStreetMap(), { conquest: true, scenarioId: 'sc_bases' });
const port = await server.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(hgt) }, locale: 'cs-CZ' });
page.on('pageerror', (e: Error) => { if (!/pointer lock/i.test(e.message)) console.log('[pageerror]', e.message); });
await page.goto('http://127.0.0.1:5173/?q=low');
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000 });
await page.evaluate(([ws]: string[]) => (window as any).__pf.connectTo(ws, 'Hrac'), [`ws://127.0.0.1:${port}`]);
await page.waitForFunction(() => document.querySelector('.pf-deploy:not(.hidden)'), null, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
if (process.env.HUD) {
  // Po nasazení: výřez HUD (zdraví, výdrž, zásobník).
  await page.evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: process.env.HUD });
}
await browser.close();
process.exit(0);
