/**
 * Hledání rostoucích GPU textur při respawnu / reconnectu (audit): obalí gl.createTexture / deleteTexture
 * a vypíše zásobníky vytvoření textur, které nebyly smazány. Běží proti vývojovému serveru (čitelné zásobníky).
 * npx tsx scripts/perf/texleak.ts [url=http://127.0.0.1:5173/] [respawny=6]
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { GameServer } from '../../server/gameServer';
import { parseMapJson } from '../../src/shared/map/validate';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url = 'http://127.0.0.1:5173/', nStr = '6'] = process.argv.slice(2);
const doc = parseMapJson(readFileSync('maps/street_reference.json', 'utf8')).doc!;
const server = await GameServer.create(doc, { conquest: true, scenarioId: doc.scenarios[0]?.id });
const port = await server.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`${url}?q=standard&ab=half`);
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 300000 });
const spawn = async () => {
  await page.evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
  await page.waitForTimeout(2500);
};
await page.evaluate((ws: string) => (window as any).__pf.connectTo(ws, 'Mereni'), `ws://127.0.0.1:${port}`);
await page.waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 180000 });
await spawn();
await page.evaluate(async () => {
  const T = await import('/node_modules/.vite/deps/three.js' as string);
  const born = new Map<any, string>();
  (window as any).__born = born;
  const d = Object.getOwnPropertyDescriptor(T.Texture.prototype, 'needsUpdate')!;
  Object.defineProperty(T.Texture.prototype, 'needsUpdate', {
    configurable: true,
    set(v: boolean) {
      if (v && !born.has(this)) born.set(this, (new Error().stack ?? '').split('\n').slice(2, 7).map((l: string) => l.trim().replace(/\?[vt]=[0-9a-f]+/g, '').replace(/https?:\/\/[^/]+\//, '').replace(/^at /, '')).filter((l: string) => !l.includes('.vite/deps')).join(' < '));
      d.set!.call(this, v);
    },
    get() { return d.get!.call(this); },
  });
});
const me = [...server.sim.players.values()][0] as any;
const N = Number(nStr);
for (let i = 0; i < N; i++) {
  (server.sim as any).kill(me, null, 'redeploy');
  await page.waitForTimeout(1500);
  await spawn();
}
await page.evaluate(() => (window as any).__pf.exitPlay());
await page.waitForTimeout(800);
await page.evaluate((ws: string) => (window as any).__pf.connectTo(ws, 'Mereni'), `ws://127.0.0.1:${port}`);
await page.waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 180000 });
await spawn();
const out = await page.evaluate(() => {
  const R = (window as any).__pf.renderer;
  const agg = new Map<string, number>();
  for (const [t, st] of (window as any).__born) if (R.properties.get(t).__webglInit) agg.set(`${t.constructor.name} ${t.image?.width ?? '?'}×${t.image?.height ?? '?'} | ${st}`, (agg.get(`${t.constructor.name} ${t.image?.width ?? '?'}×${t.image?.height ?? '?'} | ${st}`) ?? 0) + 1);
  return [...agg.entries()].sort((a, b) => b[1] - a[1]);
});
console.log(`textur vytvořených a nesmazaných po ${N}× respawnu + 1× reconnectu:`, out.reduce((a, b) => a + b[1], 0));
for (const [s, n] of out) console.log(n, '×', s);
await browser.close();
await server.close();
process.exit(0);
