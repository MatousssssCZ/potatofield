// Vývojový nástroj: přibližná cena jednotlivých vrstev vykreslení (vypnutím jedné věci a změřením
// doby snímku). Běží v SwiftShaderu (CPU rasterizace) – absolutní časy neodpovídají GPU, ale poměry
// práce na pixelech a vrcholech ano. Použití: npx tsx scripts/gpu-cost.ts [url] [kvalita]
import { createRequire } from 'node:module';
import { GameServer } from '../server/gameServer';
import { buildStreetMap } from '../src/world/maps/street';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url = 'http://127.0.0.1:5173/', q = 'standard'] = process.argv.slice(2);
const server = await GameServer.create(buildStreetMap(), { conquest: false });
const port = await server.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m: any) => { if (/THREE/.test(m.text())) console.log(m.type(), m.text().slice(0, 2500)); });
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
// Smyčku aplikace zastavit (měří se jen ruční snímky) a připravit přepínače.
const out = await page.evaluate(`(async () => {
  const A = window.__pf, R = A.renderer, gl = R.getContext(), scene = A.scene;
  A.loop = () => {};
  const px = new Uint8Array(4);
  const T = await import('/node_modules/.vite/deps/three.js');
  // Synchronizace: přenos obsahu plátna do 2D plátna počká na dokončení snímku (readPixels z plátna s MSAA ANGLE odmítá).
  const c2 = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const frame = (shadow) => { if (shadow) R.shadowMap.needsUpdate = true; A.post.render(1 / 60); c2.drawImage(R.domElement, 0, 0, 1, 1); c2.getImageData(0, 0, 1, 1); };
  const time = (shadow = false) => { frame(shadow); const ts = []; for (let i = 0; i < 7; i++) { const t = performance.now(); frame(shadow); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[3]; };
  const find = (pred) => { const r = []; scene.traverse((o) => { if (pred(o)) r.push(o); }); return r; };
  const hide = (objs) => { const v = objs.map((o) => o.visible); objs.forEach((o) => (o.visible = false)); return () => objs.forEach((o, i) => (o.visible = v[i])); };
  const res = {};
  res.zaklad = time();
  res.zakladSeStiny = time(true);
  const test = (name, off) => { const undo = off(); res[name] = time(); undo(); };
  test('bez post-processingu', () => { const p = A.post; const c = p.composer; p.composer = null; return () => (p.composer = c); });
  test('bez terénu', () => hide(find((o) => o.name === '__terrain')));
  test('bez budov a objektů', () => hide(find((o) => o.parent?.name === 'world' && o.name !== '__terrain')));
  test('bez trávy', () => hide(A.grass ? [A.grass.mesh] : []));
  test('bez vojáků/zbraně v ruce', () => hide([A.session.game.soldiers.root, ...find((o) => o.isCamera).flatMap((c) => c.children)]));
  test('bez efektů (prach, kouř)', () => hide(find((o) => o.name === 'effects' || o.name === 'grenades')));
  test('bez oblohy a oparu', () => hide([A.env.sky, A.env.haze]));
  test('bez dalekého plánu (kopce)', () => hide(find((o) => o.name === 'surround' || o.userData?.surround)));
  test('bez odrazu oblohy (IBL)', () => { const e = scene.environment; scene.environment = null; return () => (scene.environment = e); });
  test('bez bodového světla výbuchu', () => { const L = find((o) => o.isPointLight); L.forEach((l) => l.removeFromParent()); return () => L.forEach((l) => A.session.game.nades.root.add(l)); });
  test('bez stínů (příjem ve shaderech)', () => { R.shadowMap.enabled = false; const ms = find((o) => o.material).flatMap((o) => [o.material].flat()); ms.forEach((m) => (m.needsUpdate = true)); return () => { R.shadowMap.enabled = true; ms.forEach((m) => (m.needsUpdate = true)); }; });
  // Podrobnosti materiálů (bez IBL, aby se nesčítalo).
  const env0 = scene.environment; scene.environment = null;
  res['bez IBL – nový základ'] = time();
  const mats = [...new Set(find((o) => o.isMesh && o.material).flatMap((o) => [o.material].flat()))];
  const swap = (pick, edit) => { const ch = []; for (const m of mats) if (pick(m)) { const c = {}; for (const k of Object.keys(edit)) c[k] = m[k]; ch.push([m, c]); Object.assign(m, edit); m.needsUpdate = true; } return () => ch.forEach(([m, c]) => { Object.assign(m, c); m.needsUpdate = true; }); };
  const t2 = (name, off) => { const undo = off(); res[name] = time(); undo(); };
  t2('  …bez normálových map (kromě terénu)', () => swap((m) => !!m.normalMap && !String(m.customProgramCacheKey?.()).startsWith('terrain'), { normalMap: null }));
  t2('  …bez ORM map (drsnost/AO)', () => swap((m) => !!m.roughnessMap, { roughnessMap: null, metalnessMap: null, aoMap: null }));
  t2('  …bez opotřebení/makro (onBeforeCompile)', () => { const ch = mats.filter((m) => m.onBeforeCompile && !String(m.customProgramCacheKey?.()).startsWith('terrain')).map((m) => [m, m.onBeforeCompile, m.customProgramCacheKey]); ch.forEach(([m]) => { m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => 'plain'; m.needsUpdate = true; }); return () => ch.forEach(([m, f, k]) => { m.onBeforeCompile = f; m.customProgramCacheKey = k; m.needsUpdate = true; }); });
  t2('  …terén jednoduchý (1 textura)', () => { const t = find((o) => o.name === '__terrain')[0]; const m0 = t.material; t.material = new m0.constructor({ map: m0.map, roughness: 1, metalness: 0 }); return () => (t.material = m0); });
  t2('  …bez terénu', () => hide(find((o) => o.name === '__terrain')));
  t2('  …bez budov', () => hide(find((o) => o.parent?.name === 'world' && o.name !== '__terrain')));
  t2('  …bez zbraně v ruce', () => hide(find((o) => o.isCamera).flatMap((c) => c.children)));
  t2('  …bez post-processingu', () => { const p = A.post; const c = p.composer; p.composer = null; return () => (p.composer = c); });
  scene.environment = env0;
  res['jen stínová mapa (rozdíl)'] = res.zakladSeStiny - res.zaklad;
  {
    const T = await import('/node_modules/.vite/deps/three.js');
    const cnt = new T.MeshBasicMaterial({ color: new T.Color(1 / 64, 1 / 64, 1 / 64), blending: T.AdditiveBlending, depthTest: true, depthWrite: true, toneMapped: false });
    const rt = new T.WebGLRenderTarget(R.domElement.width, R.domElement.height, { type: T.FloatType });
    const measure = (hidden) => {
      const undo = hide(hidden);
      scene.overrideMaterial = cnt;
      const bg = scene.background; scene.background = null;
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, A.camera); R.setRenderTarget(null);
      scene.overrideMaterial = null; scene.background = bg; undo();
      const W = rt.width, H = rt.height, buf = new Float32Array(W * H * 4);
      R.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      let sum = 0, covered = 0;
      for (let i = 0; i < W * H; i++) { const v = buf[i * 4] * 64; sum += v; if (v > 0.5) covered++; }
      return { perPixel: +(sum / (W * H)).toFixed(2), perCovered: +(sum / Math.max(1, covered)).toFixed(2) };
    };
    res['_overdraw vše'] = measure([]);
    res['_overdraw jen budovy'] = measure([...find((o) => o.name === '__terrain'), A.env.sky, A.env.haze, ...(A.grass ? [A.grass.mesh] : []), A.session.game.soldiers.root, ...find((o) => o.isCamera).flatMap((c) => c.children)]);
  }
  const info = { calls: R.info.render.calls, tris: R.info.render.triangles, size: [R.domElement.width, R.domElement.height], post: A.post.features, programs: R.info.programs.length };
  return { res, info };
})()`);
const r = out as any;
console.log('info', JSON.stringify(r.info));
const base = r.res.zaklad;
for (const [k, v] of Object.entries(r.res) as Array<[string, any]>) if (k.startsWith('_')) console.log(k, JSON.stringify(v)); else console.log(`${k.padEnd(36)} ${v.toFixed(0).padStart(6)} ms  ${k.startsWith('zaklad') || k.startsWith('jen') ? '' : `úspora ${(100 * (base - v) / base).toFixed(0)} %`}`);
await browser.close();
await server.close();
process.exit(0);
