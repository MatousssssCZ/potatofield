// End-to-end: dva prohlížeče na skutečném serveru (render, predikce, interpolace, týmové UI).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, ws, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pages = [];
for (const name of ['Alfa', 'Bravo']) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => console.log(name, '[pageerror]', e.message));
  await p.goto(`${url}?q=low&dev`);
  await p.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000 });
  await p.evaluate(([ws, name]) => window.__pf.connectTo(ws, name), [ws, name]);
  pages.push(p);
}
const st = (p) => p.evaluate(() => { const g = window.__pf.session?.game; const d = g?.driver; const me = d?.local(); return { id: d?.localId, team: d?.net.welcome?.team, alive: me?.alive, others: d?.remotes().length, spawns: d?.spawnOptions().map((s) => s.id), net: d?.netStats() }; });
console.log('A', JSON.stringify(await st(pages[0])));
console.log('B', JSON.stringify(await st(pages[1])));
// Nasazení na první dostupný spawn.
for (const p of pages) await p.evaluate(() => { const d = window.__pf.session.game.driver; const s = d.spawnOptions()[0]; d.requestSpawn(s?.id ?? null); });
await pages[0].waitForTimeout(3000);
console.log('A', JSON.stringify(await st(pages[0])));
// Hráč A: týmový chat a rádio.
await pages[0].evaluate(() => { const d = window.__pf.session.game.driver; d.net.send({ t: 'chat', ch: 'team', text: 'Jdeme na tržiště' }); d.net.send({ t: 'radio', id: 'goGoGo' }); d.net.send({ t: 'squad', op: 'create' }); });
// Přiblížit hráče B do zorného pole A přes serverovou mapu nejde – jen pohled; uložit snímky.
await pages[0].waitForTimeout(2500);
await pages[0].evaluate(() => { document.querySelector('#menu').classList.add('hidden'); document.querySelector('#hud').classList.remove('hidden'); });
await pages[0].screenshot({ path: `${out}/mp-alfa.png`, timeout: 240000 });
await pages[1].evaluate(() => { document.querySelector('#menu').classList.add('hidden'); document.querySelector('#hud').classList.remove('hidden'); });
await pages[1].screenshot({ path: `${out}/mp-bravo.png`, timeout: 240000 });
console.log('A chat', await pages[0].evaluate(() => document.querySelector('.tui-log')?.textContent));
console.log('B chat', await pages[1].evaluate(() => document.querySelector('.tui-log')?.textContent));
console.log('B', JSON.stringify(await st(pages[1])));
await browser.close();
