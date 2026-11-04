// Vývojový nástroj: skutečné screenshoty z aplikace pro zadané pohledy.
// VIEWS='[{"name":..,"map":"street","mode":"editor|play","pos":[x,y,z],"yaw":deg,"pitch":deg}]' node scripts/views.mjs <url> <outDir> [quality]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out, q = 'high'] = process.argv.slice(2);
const views = JSON.parse(process.env.VIEWS ?? '[]');
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 720);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto(`${url}?q=${q}${process.env.DEV ? '&dev' : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000 });
let lastMap = null;
for (const v of views) {
  if (v.map && v.map !== lastMap) {
    await page.evaluate(async (m) => { const a = window.__pf; if (a.mode === 'play') a.exitPlay(); a.openDoc(m === 'street' ? a.streetTemplate() : m === 'range' ? a['rangeTemplate']() : (await import('/src/world/maps/empty.ts')).buildEmptyMap(), false); if (window.__setupMap) await window.__setupMap(a); }, v.map);
    lastMap = v.map;
  }
  if (v.eval) await page.evaluate(v.eval);
  await page.evaluate(async (v) => {
    const a = window.__pf; const d2r = Math.PI / 180;
    if (v.mode === 'play') {
      if (a.mode !== 'play') { a.ed.doc.testSpawn = { position: v.pos, rotation: [0, v.yaw * d2r, 0] }; await a.enterPlay(); }
      const g = a.session.game; const pl = g.driver.sim.players.get('local');
      if (!v.keep) { pl.ctrl.place(pl.state, { x: v.pos[0], y: v.pos[1], z: v.pos[2] }, v.yaw * d2r); pl.state.pitch = (v.pitch ?? 0) * d2r; }
      if (v.stance) { pl.state.stance = v.stance; pl.state.height = { stand: 1.8, crouch: 1.2, prone: 0.5 }[v.stance]; pl.state.proneToggle = v.stance === 'prone'; }
      document.querySelector('#menu').classList.add('hidden'); document.querySelector('#hud').classList.remove('hidden');
      a.session.game.active = false;
    } else {
      if (a.mode === 'play') a.exitPlay();
      a.editor.restoreCamera({ pos: new a.camera.position.constructor(...v.pos), yaw: v.yaw * d2r, pitch: (v.pitch ?? 0) * d2r, fov: 60 });
      a.editor.select(v.select ?? []);
    }
  }, v);
  await page.waitForTimeout(v.wait ?? 2500);
  await page.screenshot({ path: `${out}/${v.name}.png`, timeout: 240000 });
  console.log('shot', v.name);
}
await browser.close();
