// Vývojový nástroj: cena kouře z dýmovnice (SwiftShader – poměry, ne absolutní GPU časy).
// Nasimuluje hořící dýmovnici 8 m před kamerou a pak kameru uprostřed oblaku; měří dobu snímku,
// počet vykreslovacích volání a částic. Použití: npx tsx scripts/smoke-cost.ts [url] [kvalita]
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
await page.waitForTimeout(3000);
const [a] = [...server.sim.players.values()];
a.ctrl.place(a.state, { x: 0, y: 0.1, z: 10 }, 0);
await page.waitForTimeout(3000);
const out = await page.evaluate(`(async () => {
  const A = window.__pf, R = A.renderer, G = A.session.game, N = G.nades;
  A.loop = () => {};
  const c2 = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const frame = () => { A.post.render(1 / 60); c2.drawImage(R.domElement, 0, 0, 1, 1); c2.getImageData(0, 0, 1, 1); };
  const time = () => { frame(); const ts = []; for (let i = 0; i < 9; i++) { const t = performance.now(); frame(); ts.push(performance.now() - t); } ts.sort((x, y) => x - y); return +ts[4].toFixed(1); };
  const calls = () => { R.info.autoReset = false; R.info.reset(); A.post.render(1 / 60); const c = R.info.render.calls; R.info.autoReset = true; return c; };
  const cam = A.camera;
  const dir = cam.getWorldDirection(new cam.position.constructor()).setY(0).normalize();
  const at = cam.position.clone().addScaledVector(dir, 8);
  at.y = cam.position.y - 1.6;
  const res = { bezKoure: time(), volaniBez: calls() };
  // 10 s hoření dýmovnice (simulace bez vykreslení).
  const g = [{ id: 'smk', kind: 'smoke', pos: { x: at.x, y: at.y, z: at.z }, smokeUntil: 1e9 }];
  for (let t = 0; t < 10; t += 1 / 30) { N.sync(g, t, 1 / 30); N.update(1 / 30, cam); }
  const live = () => (N.smoke?.count ?? 0) + N.particles.filter((p) => p.life > 0).length;
  res.castic = live();
  res.koure8m = time();
  res.volani8m = calls();
  window.__shot1 = R.domElement.toDataURL('image/jpeg', 0.8);
  const p0 = cam.position.clone();
  cam.position.set(at.x, at.y + 1.6, at.z); cam.updateMatrixWorld();
  for (let i = 0; i < 8; i++) { N.sync(g, 10 + i * 0.1, 0.1); N.update(0.1, cam); }
  res.uvnitrOblaku = time();
  window.__shot2 = R.domElement.toDataURL('image/jpeg', 0.8);
  cam.position.copy(p0); cam.updateMatrixWorld();
  return res;
})()`);
console.log(JSON.stringify(out, null, 1));
const dir = process.env.SHOTS;
if (dir) {
  const fs = await import('node:fs');
  for (const k of ['__shot1', '__shot2']) {
    const d: string = await page.evaluate((k: string) => (window as any)[k], k);
    if (d) fs.writeFileSync(`${dir}/smoke${k.slice(-1)}.jpg`, Buffer.from(d.split(',')[1], 'base64'));
  }
}
await browser.close();
await server.close?.();
process.exit(0);
