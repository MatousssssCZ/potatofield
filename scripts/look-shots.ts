// Vývojový nástroj: snímky ze hry na serveru v procesu (ulice) pro ladění světla a barev.
// Použití: npx tsx scripts/look-shots.ts <url klienta> <složka> [kvalita]   (běží npm run dev)
import { createRequire } from 'node:module';
import { GameServer } from '../server/gameServer';
import { buildStreetMap } from '../src/world/maps/street';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url = 'http://localhost:5173/', out = '.', q = 'standard'] = process.argv.slice(2);
const doc = buildStreetMap();
// GRASS=1: namalovat vrstvu trávy (pruhy a ostrůvky kolem startu) pro kontrolu vzhledu.
if (process.env.GRASS) {
  const t = doc.terrain;
  t.grass = t.heights.map((_, i) => {
    const x = t.origin[0] + (i % t.samplesX) * t.spacing, z = t.origin[1] + Math.floor(i / t.samplesX) * t.spacing;
    const v = Math.max(0, 1 - Math.hypot(x - 3, z - 12) / 7) + Math.max(0, 1 - Math.hypot(x + 6, z - 6) / 5) + (Math.abs(x) > 16 ? 0.6 : 0);
    return Math.round(Math.min(1, v * 1.6) * 100) / 100;
  });
}
const server = await GameServer.create(doc, { conquest: false });
const port = await server.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e: Error) => { if (!/pointer lock/i.test(e.message)) console.log('[pageerror]', e.message); });
page.on('console', (m: any) => { if (/THREE|ERROR/.test(m.text())) console.log('[console]', m.text().slice(0, 1200)); });
await page.goto(`${url}?q=${q}`);
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000 });
await page.evaluate(([ws]: string[]) => (window as any).__pf.connectTo(ws, 'Foto'), [`ws://127.0.0.1:${port}`]);
await page.waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 120000 });
await page.evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
await page.waitForTimeout(2500);
const [a] = [...server.sim.players.values()];
// Volitelně jiný post-processing (např. FXAA místo MSAA): POST='{"antialias":false}'.
if (process.env.POST) await page.evaluate(`(async () => { const A = window.__pf; const { PostPipeline } = await import('/src/client/render/post.ts'); A.post = new PostPipeline(A.renderer, A.scene, A.camera, { ...A.quality, ...${process.env.POST} }, true); A.resize(); })()`);
// Pohledy: [název, x, z, otočení (rad), sklon]; vlastní přes VIEWS='[["n",x,z,yaw,pitch]]'.
const views: Array<[string, number, number, number, number]> = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : [['ulice', 0, 10, 0, -0.05], ['bok', -4, -5, 2.1, -0.14], ['zpet', 2, -20, Math.PI, -0.05]];
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
