// Vývojový nástroj: snímky mapy Skladová osada z editoru (přehled + pohledy z očí) a kontrola načtení.
// Použití: node scripts/osada-map-shots.mjs [url] <složka>   (běží npm run dev)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const dir = process.argv[3] ?? '.';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
let errors = 0;
p.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
await p.goto(`${url}?editor&q=low`);
await p.waitForFunction(() => window.__pf && window.__pf.editor, null, { timeout: 240000 });
await p.waitForTimeout(1500);
const t0 = Date.now();
const n = await p.evaluate(async () => { const { buildOsadaMap } = await import('/src/world/maps/osada.ts'); const d = buildOsadaMap(); window.__pf.openDoc(d, false); return d.objects.length; });
await p.waitForTimeout(4000);
console.log(`mapa načtena: ${n} objektů za ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await p.evaluate(() => { document.querySelector('#tb-vis-vol')?.click(); });
const views = { 'osada-prehled': [0, 150, 120, 0, -0.9], 'osada-naves': [-64, 1.7, 4, 0, -0.02], 'osada-dvur': [6, 1.7, -50, -1.3, 0], 'osada-dilna': [-70, 1.7, 46, -1.2, 0.02], 'osada-vodojem': [62, 1.7, 60, 0.2, 0.05], 'osada-obchvat': [-60, 1.7, 84, -1.5, 0.03], 'osada-sklady': [-40, 30, 60, -0.6, -0.5], 'osada-zakladna': [-110, 14, 96, -0.5, -0.45] };
for (const [name, [x, y, z, yaw, pitch]] of Object.entries(views)) {
  await p.evaluate(([x, y, z, yaw, pitch]) => { const a = window.__pf; a.editor.restoreCamera({ pos: new a.camera.position.constructor(x, y, z), yaw, pitch, fov: 70 }); }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${dir}/${name}.png`, clip: { x: 248, y: 40, width: 828, height: 690 } });
}
const info = await p.evaluate(() => { const R = window.__pf.renderer.info; return { calls: R.render.calls, tris: R.render.triangles }; });
console.log('poslední snímek (editor, nízká kvalita):', JSON.stringify(info), 'chyb stránky:', errors);
await b.close();
