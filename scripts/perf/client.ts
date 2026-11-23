/**
 * Audit výkonu klienta: produkční build (vite preview), lokální server v tomto procesu, boti v samostatném
 * procesu, Chromium se SwiftShaderem (softwarová grafika – GPU časy a FPS NEODPOVÍDAJÍ skutečné grafice;
 * spolehlivé jsou CPU časy úseků hlavního vlákna, počty draw calls / trojúhelníků / průchodů, paměť a záseky).
 *
 * Předpoklad: `npx vite build && npx vite preview --port 4173 --strictPort` (běží zvlášť).
 * npx tsx scripts/perf/client.ts --scenario all --q standard --w 1280 --h 720 --out docs/perf-audit/data/client.json
 *
 * Scénáře (--scenario):
 *   idle      prázdná mapa (0 botů), nehybná kamera
 *   route     prázdná mapa, 6 pevných stanovišť kamery (pohled dolů ulicí = nejnáročnější místo)
 *   first     první výstřel, první dopad, první granát, otevření mapy nasazení a tabulky skóre
 *   fight8 / fight16 / fight32   souboj: boti se stahují k měřícímu hráči (shluk), ten střílí
 *   spread16 / spread32          stejný počet botů rozptýlených po mapě (bez střelby)
 *   lifecycle 10× smrt + respawn, 5× odpojení a nové připojení, nové kolo (změna scénáře)
 *   long      dlouhý běh se 16 boty (--long sekund, výchozí 600): paměť a postupné zhoršování
 * Měřící hráč je nesmrtelný (server ignoruje jeho poškození), aby scénář nepřerušila smrt.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { GameServer } from '../../server/gameServer';
import { parseMapJson } from '../../src/shared/map/validate';

const { chromium } = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL0 = arg('url', 'http://127.0.0.1:4173/');
const Q = arg('q', 'standard');
const W = Number(arg('w', '1280')), H = Number(arg('h', '720'));
const OUT = arg('out', 'docs/perf-audit/data/client.json');
const SEC = Number(arg('seconds', '30'));
const LONG = Number(arg('long', '600'));
const EXTRA = arg('extra', ''); // další parametry adresy (A/B: např. "&ab=noshadow")
const which = arg('scenario', 'all').split(',');
const want = (s: string) => which.includes('all') ? s !== 'long' : which.includes(s);

const doc = parseMapJson(readFileSync('maps/street_reference.json', 'utf8')).doc!;
const results: Record<string, unknown>[] = [];
const commit = execSync('git rev-parse --short HEAD').toString().trim();
const dirty = execSync('git status --porcelain').toString().trim().length > 0;

/** Pevná stanoviště: [x, z, yaw, popis]; yaw 0 = pohled k −z (dolů ulicí od základny A). */
const STATIONS: Array<[number, number, number, string]> = [
  [0, 9, 0, 'základna A, pohled celou ulicí'],
  [0, -10, 0, 'ulice, pohled ke křižovatce'],
  [0, -33.5, Math.PI / 2, 'křižovatka, pohled k −x'],
  [0, -33.5, -Math.PI / 2, 'křižovatka, pohled k +x'],
  [0, -60, Math.PI, 'základna B, pohled zpět ulicí'],
  [6, -20, Math.PI / 2, 'u fasády, pohled přes ulici'],
];

async function withServer<T>(bots: number, mode: 'fight' | 'spread', fn: (ctx: Ctx) => Promise<T>) {
  const server = await GameServer.create(doc, { conquest: true, scenarioId: doc.scenarios[0]?.id, teamSize: Math.max(8, Math.ceil((bots + 1) / 2)), roundBreak: 3 });
  const port = await server.listen(0);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message.slice(0, 200)); });
  const tLoad = Date.now();
  await page.goto(`${URL0}?q=${Q}&perf${EXTRA}`);
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 300000, polling: 200 });
  const loadMs = Date.now() - tLoad;
  const env = await page.evaluate(() => {
    const A = (window as any).__pf;
    A.settings.dynamicRes = false; // pevné rozlišení (jinak by se měnilo podle doby snímku)
    const gl = A.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { ua: navigator.userAgent, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), dpr: devicePixelRatio, pixelRatio: A.renderer.getPixelRatio(), buffer: [A.renderer.domElement.width, A.renderer.domElement.height], quality: A.quality.id, post: A.post.enabled ? A.post.features : 'žádný', timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
  });
  const tJoin = Date.now();
  await page.evaluate((ws: string) => (window as any).__pf.connectTo(ws, 'Mereni'), `ws://127.0.0.1:${port}`);
  await page.waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 180000 });
  const joinMs = Date.now() - tJoin;
  const warmMs = await page.evaluate(() => (window as any).__pf.warmMs);
  const me = [...server.sim.players.values()][0];
  // Nesmrtelnost měřícího hráče (testovací úprava jen v tomto skriptu).
  Object.defineProperty(me, 'hp', { get: () => 100, set: () => {}, configurable: true });
  await page.evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
  for (let i = 0; i < 100 && !me.alive; i++) await new Promise((r) => setTimeout(r, 100));
  const tSpawn = Date.now();
  await page.evaluate(() => {
    const A = (window as any).__pf;
    document.querySelector('#menu')?.classList.add('hidden');
    A.session.game.hud.deploy?.close?.();
    A.session.input.locked = true; // headless: zámek myši nahrazen příznakem (vstup z klávesnice a myši funguje)
  });
  let child: ChildProcess | null = null;
  if (bots > 0) {
    child = spawn(process.execPath, ['--import', 'tsx', 'scripts/perf/bots.ts', `ws://127.0.0.1:${port}`, String(bots), mode, String(100000), '3'], { stdio: 'ignore' });
    const t = Date.now();
    while (server.sim.players.size < bots + 1 && Date.now() - t < 60000) await new Promise((r) => setTimeout(r, 200));
  }
  const ctx: Ctx = { server, page, me, port, place: (x, z, yaw) => me.ctrl.place(me.state, { x, y: 0.1, z }, yaw) };
  try {
    const r = await fn(ctx);
    return { r, env, loadMs, joinMs, warmMs, spawnMs: Date.now() - tSpawn, errors };
  } finally {
    child?.kill();
    await browser.close();
    await server.close();
  }
}

interface Ctx {
  server: GameServer;
  page: any;
  me: any;
  port: number;
  place: (x: number, z: number, yaw: number) => void;
}

/** Měření okna `sec` sekund (diagnostika vynulovaná na začátku). */
async function measure(ctx: Ctx, sec: number, during?: () => Promise<void>) {
  await ctx.page.evaluate(() => (window as any).__pf.perf.reset());
  const metrics0 = await cdpHeap(ctx.page);
  if (during) await during();
  else await ctx.page.waitForTimeout(sec * 1000);
  const rep = await ctx.page.evaluate(() => (window as any).__pf.perf.report());
  const counts = await ctx.page.evaluate(() => { const A = (window as any).__pf; return { ...A.counts(), soldiersVisible: A.session?.game?.soldiers?.visibleCount ?? 0, soldiers: A.session?.game?.soldiers?.count ?? 0, programs: A.renderer.info.programs?.length ?? 0, buffer: [A.renderer.domElement.width, A.renderer.domElement.height] }; });
  const metrics1 = await cdpHeap(ctx.page);
  return { ...rep, heap: undefined, heapStart: metrics0, heapEnd: metrics1, heapSamples: rep.heap, counts };
}

const cdp = new WeakMap<object, any>();
async function cdpHeap(page: any) {
  let s = cdp.get(page);
  if (!s) {
    s = await page.context().newCDPSession(page);
    await s.send('Performance.enable').catch(() => {});
    cdp.set(page, s);
  }
  const { metrics } = await s.send('Performance.getMetrics').catch(() => ({ metrics: [] }));
  const m = Object.fromEntries(metrics.map((x: any) => [x.name, x.value]));
  return { jsHeapUsedMB: +((m.JSHeapUsedSize ?? 0) / 1e6).toFixed(1), jsHeapTotalMB: +((m.JSHeapTotalSize ?? 0) / 1e6).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, layoutCount: m.LayoutCount, recalcStyleCount: m.RecalcStyleCount, layoutMs: +((m.LayoutDuration ?? 0) * 1000).toFixed(1), styleMs: +((m.RecalcStyleDuration ?? 0) * 1000).toFixed(1), scriptMs: +((m.ScriptDuration ?? 0) * 1000).toFixed(0), taskMs: +((m.TaskDuration ?? 0) * 1000).toFixed(0) };
}

function push(name: string, data: Record<string, unknown>) {
  const rec = { scenario: name, date: new Date().toISOString(), commit, dirty, machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 1e9), os: `${os.platform()} ${os.release()}` }, view: { w: W, h: H, q: Q, extra: EXTRA }, ...data };
  results.push(rec);
  const s = rec as any;
  const f = s.frame ?? s.stations?.[0]?.frame;
  console.log(`${name}: ${f ? `interval p50 ${f.interval.p50} p95 ${f.interval.p95} ms, CPU p50 ${f.cpu.p50} ms, draw ${f.calls.p50}` : 'hotovo'}`);
}

if (want('idle'))
  push('idle', await withServer(0, 'fight', async (c) => {
    c.place(0, 9, 0);
    await c.page.waitForTimeout(4000);
    return { frame: await measure(c, SEC) };
  }).then((x) => ({ ...x.r, env: x.env, loadMs: x.loadMs, joinMs: x.joinMs, warmMs: x.warmMs, errors: x.errors })));

if (want('route'))
  push('route', await withServer(0, 'fight', async (c) => {
    const stations = [];
    for (const [x, z, yaw, label] of STATIONS) {
      c.place(x, z, yaw);
      await c.page.waitForTimeout(2500);
      stations.push({ label, x, z, yaw, frame: await measure(c, Math.max(6, SEC / 4)) });
    }
    return { stations };
  }).then((x) => x.r));

if (want('first'))
  push('first', await withServer(0, 'fight', async (c) => {
    c.place(0, -10, 0);
    await c.page.waitForTimeout(3000);
    const ev = async (label: string, act: () => Promise<void>) => {
      const before = await c.page.evaluate(() => { const A = (window as any).__pf; A.perf.reset(); return A.renderer.info.programs?.length ?? 0; });
      await act();
      await c.page.waitForTimeout(1500);
      const rep = await c.page.evaluate(() => (window as any).__pf.perf.report());
      const after = await c.page.evaluate(() => (window as any).__pf.renderer.info.programs?.length ?? 0);
      return { label, newPrograms: after - before, worstInterval: rep.interval.max, worst: rep.worst.slice(0, 3), p50: rep.interval.p50 };
    };
    const out = [];
    out.push(await ev('klid (srovnání)', async () => {}));
    out.push(await ev('první výstřel (dávka 0,5 s)', async () => { await c.page.mouse.down(); await c.page.waitForTimeout(500); await c.page.mouse.up(); }));
    out.push(await ev('druhá dávka', async () => { await c.page.mouse.down(); await c.page.waitForTimeout(500); await c.page.mouse.up(); }));
    out.push(await ev('první granát (server: výbuch 6 m před hráčem)', async () => {
      const s = c.server.sim as any;
      s.grenades?.push?.({ id: 'perf_n1', kind: 'frag', owner: c.me.id, team: c.me.team, pos: { x: 0, y: 0.3, z: -16 }, vel: { x: 0, y: 0, z: 0 }, fuseAt: s.time + 0.1, smokeUntil: 0, rest: true });
    }));
    out.push(await ev('otevření obrazovky nasazení (Enter)', async () => { await c.page.keyboard.press('Enter'); }));
    out.push(await ev('zavření obrazovky nasazení', async () => { await c.page.keyboard.press('Escape'); await c.page.evaluate(() => ((window as any).__pf.session.input.locked = true)); }));
    out.push(await ev('tabulka skóre (Tab držený 1 s)', async () => { await c.page.keyboard.down('Tab'); await c.page.waitForTimeout(1000); await c.page.keyboard.up('Tab'); }));
    return { events: out };
  }).then((x) => x.r));

for (const [name, bots, mode] of [['fight8', 8, 'fight'], ['fight16', 16, 'fight'], ['spread16', 16, 'spread'], ['fight32', 32, 'fight'], ['spread32', 32, 'spread']] as const) {
  if (!want(name)) continue;
  push(name, await withServer(bots, mode, async (c) => {
    c.place(0, -33.5, 0);
    // Boti se stahují (fight) nebo rozbíhají (spread); měřící hráč stojí na křižovatce a střílí dávky.
    await c.page.waitForTimeout(15000);
    const frame = await measure(c, SEC, async () => {
      const end = Date.now() + SEC * 1000;
      let k = 0;
      while (Date.now() < end) {
        c.place(0, -33.5, (k++ % 4) * (Math.PI / 2));
        if (mode === 'fight') { await c.page.mouse.down(); await c.page.waitForTimeout(400); await c.page.mouse.up(); }
        await c.page.waitForTimeout(mode === 'fight' ? 2100 : 2500);
      }
    });
    return { bots, mode, frame, players: c.server.sim.players.size };
  }).then((x) => x.r));
}

if (want('lifecycle'))
  push('lifecycle', await withServer(4, 'spread', async (c) => {
    const snap = async (label: string) => ({ label, ...(await c.page.evaluate(() => { const A = (window as any).__pf; return { ...A.counts(), programs: A.renderer.info.programs?.length ?? 0, nameTags: document.querySelectorAll('.h-nametag').length, hudNodes: document.querySelectorAll('#hud *').length }; })), heap: await cdpHeap(c.page) });
    const out = [await snap('po prvním spawnu')];
    const sim = c.server.sim as any;
    for (let i = 0; i < 10; i++) {
      sim.kill(c.me, null, 'redeploy');
      await c.page.waitForTimeout(1200);
      await c.page.evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
      for (let j = 0; j < 100 && !c.me.alive; j++) await new Promise((r) => setTimeout(r, 100));
      await c.page.waitForTimeout(500);
    }
    out.push(await snap('po 10× smrt + respawn'));
    for (let i = 0; i < 5; i++) {
      await c.page.evaluate(() => (window as any).__pf.exitPlay());
      await c.page.waitForTimeout(800);
      await c.page.evaluate((ws: string) => (window as any).__pf.connectTo(ws, 'Mereni'), `ws://127.0.0.1:${c.port}`);
      await c.page.waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 120000 });
      await c.page.waitForTimeout(800);
    }
    out.push(await snap('po 5× odpojení a připojení'));
    const cq = sim.conquest;
    if (cq) {
      cq.tickets.teamA = 0;
      await c.page.waitForTimeout(9000);
    }
    out.push(await snap('po konci kola a novém kole (střídání scénáře)'));
    return { steps: out };
  }).then((x) => x.r));

if (which.includes('long'))
  push('long', await withServer(16, 'fight', async (c) => {
    c.place(0, -33.5, 0);
    await c.page.waitForTimeout(15000);
    const samples = [];
    const t0 = Date.now();
    await c.page.evaluate(() => (window as any).__pf.perf.reset());
    while (Date.now() - t0 < LONG * 1000) {
      for (let i = 0; i < 12; i++) {
        c.place(0, -33.5, (i % 4) * (Math.PI / 2));
        await c.page.mouse.down(); await c.page.waitForTimeout(300); await c.page.mouse.up();
        await c.page.waitForTimeout(2200);
      }
      const rep = await c.page.evaluate(() => { const A = (window as any).__pf; const r = A.perf.report(); A.perf.reset(); return { interval: r.interval, cpu: r.cpu, calls: r.calls.p50, hitches: r.hitches }; });
      const counts = await c.page.evaluate(() => (window as any).__pf.counts());
      samples.push({ t: Math.round((Date.now() - t0) / 1000), ...rep, counts, heap: await cdpHeap(c.page) });
      console.log(`long ${samples[samples.length - 1].t} s: heap ${samples[samples.length - 1].heap.jsHeapUsedMB} MB, p50 ${rep.interval.p50}`);
    }
    return { seconds: LONG, samples };
  }).then((x) => x.r));

mkdirSync(dirname(OUT), { recursive: true });
const all = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
writeFileSync(OUT, JSON.stringify([...all, ...results], null, 1));
process.exit(0);
