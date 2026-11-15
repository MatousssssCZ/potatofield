// Vývojový nástroj: snímky ze hry na serveru v procesu (ulice) pro ladění světla a barev.
// Použití: npx tsx scripts/look-shots.ts <url klienta> <složka> [kvalita]   (běží npm run dev)
import { createRequire } from 'node:module';
import { GameServer } from '../server/gameServer';
import { buildStreetMap } from '../src/world/maps/street';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url = 'http://localhost:5173/', out = '.', q = 'standard'] = process.argv.slice(2);
const server = await GameServer.create(buildStreetMap(), { conquest: false });
const port = await server.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e: Error) => { if (!/pointer lock/i.test(e.message)) console.log('[pageerror]', e.message); });
await page.goto(`${url}?q=${q}`);
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000 });
await page.evaluate(([ws]: string[]) => (window as any).__pf.connectTo(ws, 'Foto'), [`ws://127.0.0.1:${port}`]);
await page.waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 120000 });
await page.evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
await page.waitForTimeout(2500);
const [a] = [...server.sim.players.values()];
const views: Array<[string, number, number, number, number]> = [['ulice', 0, 10, 0, -0.05], ['bok', -4, -5, 2.1, -0.14], ['zpet', 2, -20, Math.PI, -0.05]];
for (const [name, x, z, yaw, pitch] of views) {
  a.ctrl.place(a.state, { x, y: 0.1, z }, yaw);
  a.state.pitch = pitch;
  await page.evaluate(`(() => { document.querySelectorAll('#pf-menu, .pf-deploy, #h-deploy').forEach((e) => e.classList.add('hidden')); window.__pf.session.game.hud.deploy.close(); })()`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });
  console.log('shot', name);
}
await browser.close();
await server.close();
process.exit(0);
