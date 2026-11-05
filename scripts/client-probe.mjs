// Vývojový nástroj: náklady klienta na referenční ulici (draw calls se stíny i bez nich, trojúhelníky,
// paměť textur, profil JS). Spuštění: node scripts/client-probe.mjs standard|low|high (běží npm run dev).
// Pozor: v prostředí bez GPU (SwiftShader) jsou časy nevypovídající – platí jen počty.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const q = process.argv[2] ?? 'standard';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('[pageerror]', e.message); });
await page.goto(`http://localhost:5173/?q=${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000, polling: 1000 });
page.on('crash', () => console.log('[crash] stránka spadla'));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
console.log('načteno');
await page.evaluate(() => { const a = window.__pf; a.openDoc(a.streetTemplate(), false); });
console.log('ulice otevřena');
await page.waitForTimeout(3000);
await page.evaluate(async () => {
  const a = window.__pf; a.forceFreeTest = true;
  void a.enterPlay();
  for (let i = 0; i < 120 && !a.session; i++) await new Promise((r) => setTimeout(r, 500));
  document.querySelector('#menu')?.classList.add('hidden');
});
await page.waitForTimeout(4000);
const r = await page.evaluate(() => {
  const a = window.__pf; const R = a.renderer; const scene = a.scene;
  R.info.autoReset = false; R.info.reset();
  // snímek s překreslením stínové mapy (nejhorší případ)
  R.shadowMap.needsUpdate = true;
  a.post.render(1 / 60);
  const main = { calls: R.info.render.calls, tris: R.info.render.triangles };
  // stínový průchod zvlášť: vypnout stíny a změřit rozdíl
  const sh = R.shadowMap.enabled; R.shadowMap.needsUpdate = true;
  R.info.reset(); R.shadowMap.enabled = false; a.post.render(1 / 60); const noShadow = { calls: R.info.render.calls, tris: R.info.render.triangles }; R.shadowMap.enabled = sh;
  R.info.autoReset = true;
  let meshes = 0, casters = 0, instanced = 0;
  const byName = new Map();
  const mats = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    meshes++; if (o.castShadow) casters++; if (o.isInstancedMesh) instanced++;
    mats.add(o.material);
    const g = o.geometry; const t = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    let p = o; let key = o.name || '';
    while (p && !p.userData?.objectId && p.parent) p = p.parent;
    key = p?.userData?.assetId || p?.name || o.type;
    const e = byName.get(key) ?? { n: 0, tris: 0 }; e.n++; e.tris += t; byName.set(key, e);
  });
  let texBytes = 0, texCount = 0; const seen = new Set();
  for (const m of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    const t = m?.[k]; if (!t || seen.has(t)) continue; seen.add(t); texCount++;
    const img = t.image; if (img?.width) texBytes += img.width * img.height * 4 * 1.33;
  }
  const top = [...byName.entries()].sort((x, y) => y[1].tris - x[1].tris).slice(0, 8).map(([k, v]) => `${k}: ${v.n} meshů, ${Math.round(v.tris)} tri`);

  return { main, noShadow, meshes, casters, instanced, materials: mats.size, programs: R.info.programs?.length, geometries: R.info.memory.geometries, textures: R.info.memory.textures, texCount, texMB: +(texBytes / 1048576).toFixed(1), shadowMap: a.env?.sun?.shadow?.mapSize?.x, dpr: R.getPixelRatio(), canvas: [R.domElement.width, R.domElement.height], ao: a.post.enabled, batches: a.world.batchStats, shadowRate: a.env.shadowRate, top };
});
console.log(q, JSON.stringify(r, null, 1));
// CPU profil JS (hlavní vlákno) – 4 s
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
await page.waitForTimeout(4000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas; const ids = profile.samples;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < ids.length; i++) {
  const n = byId.get(ids[i]); const f = n.callFrame;
  const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
  self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log('CPU top (self %):');
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${(100 * v / total).toFixed(1)}%  ${k}`);
await browser.close();
