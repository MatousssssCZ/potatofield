// Vývojový nástroj: cena výměny zbraně v ruce. Pro každou položku výbavy změří stavbu zobrazení
// (makeFp) a první snímek po výměně, plus nově přeložené shadery. Časy SwiftShaderu jsou orientační.
// Použití: npx tsx scripts/switch-probe.ts [url] [kvalita]
import { createRequire } from 'node:module';
import { GameServer } from '../server/gameServer';
import { buildStreetMap } from '../src/world/maps/street';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url = 'http://127.0.0.1:5173/', q = 'standard'] = process.argv.slice(2);
const server = await GameServer.create(buildStreetMap(), { conquest: false });
const port = await server.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e: Error) => { if (!/pointer lock/i.test(e.message)) console.log('[pageerror]', e.message); });
await page.goto(`${url}?q=${q}`);
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000 });
await page.evaluate(([ws]: string[]) => (window as any).__pf.connectTo(ws, 'Mereni'), [`ws://127.0.0.1:${port}`]);
await page.waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 120000 });
await page.evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
await page.waitForTimeout(4000);
const out = await page.evaluate(`(async () => {
  const A = window.__pf, R = A.renderer, G = A.session.game;
  A.loop = () => {};
  const c2 = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const frame = () => { A.post.render(1 / 60); c2.drawImage(R.domElement, 0, 0, 1, 1); c2.getImageData(0, 0, 1, 1); };
  const ids = (G.driver.local().inv?.items ?? []).map((i) => i.id);
  // Po nasazení běží představba zobrazení (pár snímků na položku).
  for (let i = 0; i < 20; i++) { G.prebuildFp(); frame(); }
  const base = []; for (let i = 0; i < 5; i++) { const t = performance.now(); frame(); base.push(performance.now() - t); } base.sort((a, b) => a - b);
  const res = { polozky: ids, bezny_snimek: +base[2].toFixed(0), vymeny: [] };
  for (const round of [1, 2]) for (const id of ids) {
    const p0 = R.info.programs.length;
    const t0 = performance.now();
    G.fp.root.visible = false; G.fpId = id; G.fp = G.fpFor(id); G.fp.root.visible = true;
    const t1 = performance.now();
    frame();
    const t2 = performance.now();
    res.vymeny.push({ kolo: round, id, stavba_ms: +(t1 - t0).toFixed(1), prvni_snimek_ms: +(t2 - t1).toFixed(0), nove_shadery: R.info.programs.length - p0 });
  }
  return res;
})()`);
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(0);
