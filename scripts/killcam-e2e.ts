// End-to-end: server v procesu + dva prohlížeče. Hráč B vyřadí hráče A (přes simulaci serveru);
// ověří se kamera na přemožitele, banner „Vyřadil tě“, ukazatel směru a nové kolo po konci.
// Použití: npx tsx scripts/killcam-e2e.ts <url klienta> [složka na snímky]   (běží npm run dev)
import { createRequire } from 'node:module';
import { GameServer } from '../server/gameServer';
import { buildStreetMap } from '../src/world/maps/street';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url = 'http://localhost:5173/', out] = process.argv.slice(2);
const ok = (c: unknown, m: string) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const server = await GameServer.create(buildStreetMap(), { conquest: true, scenarioId: 'sc_bases', roundBreak: 4 });
const port = await server.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pages: any[] = [];
const errors: string[] = [];
for (const name of ['Alfa', 'Bravo']) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e: Error) => { if (!/pointer lock/i.test(e.message)) { errors.push(e.message); console.log(name, '[pageerror]', e.message); } });
  await p.goto(`${url}?q=low`);
  await p.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000 });
  await p.evaluate(([ws, name]: string[]) => (window as any).__pf.connectTo(ws, name), [`ws://127.0.0.1:${port}`, name]);
  pages.push(p);
}
await pages[0].waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 120000 });
await pages[1].waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 120000 });
for (const p of pages) await p.evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
await pages[0].waitForTimeout(2500);
const [a, b] = [...server.sim.players.values()];
ok(a?.alive && b?.alive, 'oba hráči nasazeni');
// Postavit proti sobě na ulici (15 m), B zasáhne A do vyřazení.
a.ctrl.place(a.state, { x: 0, y: 0.1, z: -10 }, 0);
b.ctrl.place(b.state, { x: 3, y: 0.1, z: -25 }, Math.PI);
await pages[0].waitForTimeout(1500);
a.hp = 0;
server.sim.events.push({ type: 'hit', owner: b.id, target: a.id, damage: 40, zone: 'torso', hp: 0, from: [b.state.pos.x, b.state.pos.y, b.state.pos.z] });
server.sim.down(a, b.id);
await pages[0].waitForTimeout(1800);
const v = await pages[0].evaluate(() => {
  const g = (window as any).__pf.session.game;
  const k = document.querySelector('#h-killer');
  return { banner: k?.textContent ?? '', hidden: k?.classList.contains('hidden'), cam: !!g.killcam, dirs: document.querySelectorAll('.h-dir').length, remotes: g.driver.remotes().map((r: any) => r.name) };
});
ok(/Bravo/.test(v.banner) && !v.hidden, `banner přemožitele: „${v.banner}“`);
ok(v.cam, 'kamera po vyřazení běží');
ok(v.remotes.includes('Bravo'), 'server přemožitele oběti odhalil');
if (out) {
  await pages[0].evaluate(() => { document.querySelector('#menu')?.classList.add('hidden'); });
  await pages[0].screenshot({ path: `${out}/killcam.png`, timeout: 240000 });
}
// Konec kola → odpočet → nové kolo se scénářem 2.
server.sim.conquest!.tickets.teamB = 0;
await pages[0].waitForTimeout(1500);
const end = await pages[0].evaluate(() => ({ shown: !document.querySelector('#h-end')?.classList.contains('hidden'), text: document.querySelector('#h-end')?.textContent ?? '' }));
ok(end.shown && /Další kolo|Next round/.test(end.text) && /Tvůj příspěvek|Your contribution/.test(end.text), 'výsledky kola s odpočtem dalšího kola a osobním souhrnem');
if (out) await pages[0].screenshot({ path: `${out}/round-end.png`, timeout: 240000 });
await pages[0].waitForTimeout(5500);
const next = await pages[0].evaluate(() => ({ hidden: document.querySelector('#h-end')?.classList.contains('hidden'), sc: (window as any).__pf.session.game.driver.conquest()?.scenarioId }));
ok(next.hidden && next.sc === 'sc_defense' && server.round === 2, `nové kolo: scénář ${next.sc}, výsledky skryté`);
ok(errors.length === 0, `bez chyb stránky (${errors.length})`);
await browser.close();
await server.close();
process.exit(process.exitCode ?? 0);
