// Vývojový nástroj: screenshoty herního UI se skutečným lokálním serverem.
// Spuštění: npm run dev + npm run server, pak node scripts/ui-shots.mjs [šířka] [výška] [cs|en] [složka]
// Pozor: bez GPU (SwiftShader) je každý snímek pomalý; platí vzhled, ne výkon.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const [W = '1280', H = '720', LANG = 'cs', OUT = 'docs/screenshots/ui'] = process.argv.slice(2);
const out = `${OUT}/${W}x${H}-${LANG}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.addInitScript((l) => {
  localStorage.setItem('pf.lang', l);
  localStorage.setItem('pf.name', 'Brambor');
  localStorage.setItem('pf.servers', JSON.stringify([`ws://${location.hostname}:8787`]));
}, LANG);
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300000 });
  console.log('✓', name);
};

await page.goto('http://localhost:5173/?q=low');
await page.waitForSelector('#pf-menu', { timeout: 180000 });
await page.waitForTimeout(2500);
await shot('01-menu-hrat');
await page.evaluate(() => window.__pf.menu.show('servers'));
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('#pf-menu tbody tr')?.click());
await shot('02-menu-servery');

// Připojení přes skutečný server: fáze → nasazení.
await page.evaluate(() => void window.__pf.menu.connect(`ws://${location.hostname}:8787`));
await page.waitForFunction(() => window.__pf.session && !document.getElementById('pf-deploy')?.classList.contains('hidden'), null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const d = window.__pf.session.game.hud.deploy;
  d.spawn = window.__pf.session.game.driver.spawnOptions()[0]?.id ?? null;
  d.kit = 'medic';
  d.lastKey = '';
});
await page.waitForTimeout(800);
await shot('03-nasazeni');

// Četa (založená přes server) a velitel (role potvrzená serverem).
await page.evaluate(() => window.__pf.session.game.driver.net.send({ t: 'squad', op: 'create' }));
await page.evaluate(() => window.__pf.session.game.driver.net.send({ t: 'command', op: 'apply' }));
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const d = window.__pf.session.game.hud.deploy;
  d.tab = 'squad';
  d.lastKey = '';
});
await page.waitForTimeout(800);
await shot('04-nasazeni-ceta');
await page.evaluate(() => {
  const d = window.__pf.session.game.hud.deploy;
  d.tab = 'deploy';
  d.lastKey = '';
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.pf-deploy-bottom .pf-btn.primary')?.click());
await page.waitForFunction(() => window.__pf.session.game.driver.local()?.alive, null, { timeout: 30000 });
await page.evaluate(() => {
  document.getElementById('hud').classList.remove('hidden');
  window.__pf.session.game.active = true;
});
await page.waitForTimeout(1500);
await shot('05-hud');
await page.evaluate(() => window.__pf.pause.show(true, 'commander'));
await page.waitForTimeout(1200);
await page.evaluate(() => window.__pf.pause.show(true, 'commander'));
await page.waitForTimeout(800);
await shot('06-pauza-velitel');
await page.evaluate(() => window.__pf.pause.show(true, 'settings'));
await page.evaluate(() => [...document.querySelectorAll('.pf-settings .pf-tab')].at(-1)?.click());
await shot('07-nastaveni-rozhrani');
await page.evaluate(() => window.__pf.pause.show(false));
await page.keyboard.down('Tab');
await page.waitForTimeout(800);
await shot('08-skore');
await page.keyboard.up('Tab');
await page.evaluate(() => {
  const sim = window.__pf.session.game.driver;
  sim.giveUp();
});
await browser.close();
