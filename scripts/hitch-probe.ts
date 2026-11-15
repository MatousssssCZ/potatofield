// Vývojový nástroj: zachytí zaseknutí klienta při výbuchu granátu a při vlastní smrti.
// Počítá nově kompilované shadery (renderer.info.programs) a nejdelší snímek kolem události.
// Použití: npx tsx scripts/hitch-probe.ts [url klienta] [kvalita]   (běží npm run dev)
// V SwiftShaderu jsou časy jen orientační, počet kompilací je spolehlivý.
import { createRequire } from 'node:module';
import { GameServer } from '../server/gameServer';
import { buildStreetMap } from '../src/world/maps/street';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url = 'http://localhost:5173/', q = 'standard'] = process.argv.slice(2);
const server = await GameServer.create(buildStreetMap(), { conquest: true, scenarioId: 'sc_bases', roundBreak: 4 });
const port = await server.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pages: any[] = [];
for (const [i, name] of ['Alfa', 'Bravo'].entries()) {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  p.on('pageerror', (e: Error) => { if (!/pointer lock/i.test(e.message)) console.log(name, '[pageerror]', e.message); });
  await p.goto(`${url}?q=${i === 0 ? q : 'low'}`);
  await p.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000 });
  await p.evaluate(([ws, name]: string[]) => (window as any).__pf.connectTo(ws, name), [`ws://127.0.0.1:${port}`, name]);
  pages.push(p);
}
for (const p of pages) await p.waitForFunction(() => (window as any).__pf.session?.game?.driver?.local(), null, { timeout: 120000 });
const [a, b] = [...server.sim.players.values()];
// B se nasadí dřív a hned zmizí pod terén – A ho do své smrti neuvidí (jako přemožitel zpoza rohu).
await pages[1].evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
for (let i = 0; i < 100 && !b.alive; i++) await new Promise((r) => setTimeout(r, 50));
b.ctrl.place(b.state, { x: 3, y: -30, z: -25 }, Math.PI);
await pages[0].evaluate(() => { const d = (window as any).__pf.session.game.driver; d.requestSpawn(d.spawnOptions()[0]?.id ?? null); });
await pages[0].waitForTimeout(2500);
a.ctrl.place(a.state, { x: 0, y: 0.1, z: -10 }, 0);
// Pozn.: kód pro prohlížeč jako řetězec – tsx do pojmenovaných funkcí vkládá __name, který stránka nemá.
await pages[0].evaluate(`(() => {
  document.querySelector('#menu')?.classList.add('hidden');
  window.__frames = [];
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] });
  let last = performance.now();
  const tick = () => { const t = performance.now(); window.__frames.push([t, t - last]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // Které programy se poprvé použily (Three.js teprve tehdy čeká na dokončení překladu).
  window.__firstUse = [];
  const R = window.__pf.renderer, gl = R.getContext(), orig = gl.getProgramInfoLog.bind(gl);
  gl.getProgramInfoLog = (pr) => {
    const p = R.info.programs.find((x) => x.program === pr);
    let who = '';
    if (p) window.__pf.scene.traverse((o) => {
      for (const m of [o.material].flat()) if (m && R.properties.get(m).currentProgram === p) {
        const path = [];
        for (let q = o; q; q = q.parent) path.push(q.name || q.type);
        who += ' [' + m.type + ' ' + m.name + ' @ ' + path.join('<') + ']';
      }
    });
    let diff = '';
    if (p) {
      const a = p.cacheKey.split(',');
      let best = null, bd = 1e9;
      for (const q of R.info.programs) {
        if (q === p) continue;
        const b = q.cacheKey.split(',');
        if (b.length !== a.length || ((+b[54]) & 131072) !== ((+a[54]) & 131072)) continue;
        const d = a.filter((x, i) => x !== b[i]).length;
        if (d < bd) { bd = d; best = b; }
      }
      if (best) diff = ' rozdíl: ' + a.map((x, i) => (x !== best[i] ? i + ':' + best[i] + '→' + x : '')).filter(Boolean).join(' ');
    }
    window.__firstUse.push([performance.now(), p ? p.name + who + diff : '?']);
    return orig(pr);
  };
})()`);
await pages[0].waitForTimeout(4000);
const measure = async (label: string, act: () => void | Promise<void>) => {
  const before = await pages[0].evaluate(() => { const w = window as any; return { progs: w.__pf.renderer.info.programs.length, t: performance.now() }; });
  await act();
  await pages[0].waitForTimeout(2500);
  const r = await pages[0].evaluate((t0: number) => {
    const w = window as any;
    const fr = w.__frames.filter((f: number[]) => f[0] > t0);
    const base = w.__frames.filter((f: number[]) => f[0] < t0 && f[0] > t0 - 2000).map((f: number[]) => f[1]).sort((x: number, y: number) => x - y);
    return { first: w.__firstUse.filter((x: any[]) => x[0] > t0).map((x: any[]) => x[1]), long: w.__long.filter((x: number[]) => x[0] > t0).map((x: number[]) => Math.round(x[1])), progs: w.__pf.renderer.info.programs.length, worst: Math.round(Math.max(...fr.map((f: number[]) => f[1]))), median: Math.round(base[base.length >> 1] ?? 0) };
  }, before.t);
  for (const f of r.first) console.log('   1. použití:', f);
  console.log(`${label}: nové shadery ${r.progs - before.progs}, nejhorší snímek ${r.worst} ms (běžný ${r.median} ms), dlouhé úlohy JS: ${r.long.join(', ')}`);
};
const boom = (dz: number) => () => { server.sim.events.push({ type: 'explosion', key: 'probe' + dz, owner: b.id, pos: { x: 1, y: 0.2, z: dz } } as any); };
const cdp = await pages[0].context().newCDPSession(pages[0]);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
// Přemožitel, kterého oběť dosud neviděla (pod terénem = bez výhledu): server ho odhalí až při smrti.
b.ctrl.place(b.state, { x: 3, y: -30, z: -25 }, Math.PI);
await pages[0].waitForTimeout(3000);
const seen = await pages[0].evaluate(`window.__pf.session.game.driver.remotes().map((r) => r.name)`);
console.log('příprava (ms):', await pages[0].evaluate('Math.round(window.__pf.warmMs)'), 'bake:', await pages[0].evaluate('Math.round(window.__pf.bakeMs)'));
console.log('vidím před smrtí:', seen, 'vojáků v poolu:', await pages[0].evaluate(`window.__pf.session.game.soldiers.soldiers.size`));
await measure('smrt', () => {
  a.hp = 0;
  server.sim.events.push({ type: 'hit', owner: b.id, target: a.id, damage: 40, zone: 'torso', hp: 0, from: [b.state.pos.x, b.state.pos.y, b.state.pos.z] } as any);
  server.sim.down(a, b.id);
});
await measure('smrt po vyřazení (obrazovka nasazení)', () => { server.sim.kill(a, b.id, 'giveup', true); });
const { profile } = await cdp.send('Profiler.stop');
await measure('výbuch 1', boom(-16));
await measure('výbuch 2', boom(-18));
const total = new Map<string, number>();
const byId = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
for (let i = 0; i < profile.samples.length; i++) {
  const seen = new Set<string>();
  for (let id: number | undefined = profile.samples[i]; id !== undefined; id = parent.get(id)) {
    const f = byId.get(id).callFrame;
    const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()?.split('?')[0]}:${f.lineNumber}`;
    if (seen.has(k)) continue;
    seen.add(k);
    total.set(k, (total.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
}
console.log('CPU celkem (ms, včetně volaných):');
for (const [k, v] of [...total.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40)) console.log(`  ${(v / 1000).toFixed(0)}  ${k}`);
await browser.close();
await server.close();
process.exit(0);
