// Vývojový nástroj: snímky animačních stavů vojáků z prohlížeče postav (characters.html).
// Použití: node scripts/anim-shots.mjs [url] <složka>   (běží npm run dev)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const dir = process.argv[3] ?? '.';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
let errors = 0;
p.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
await p.goto(`${url}characters.html`);
await p.waitForFunction(() => window.__chars && window.__chars.actors().length, null, { timeout: 240000 });
await p.waitForTimeout(3000);
const cam = (v) => p.evaluate((v) => { document.querySelector('#cam').value = v; }, v);
const shot = async (name, wait = 900) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${dir}/anim-${name}.png`, clip: { x: 150, y: 120, width: 600, height: 520 } }); console.log('✓', name); };
const C = (fn) => p.evaluate(fn);
await cam('front');
await C(() => window.__chars.set({ move: 'r', stance: '1.8', ads: true })); await shot('01-ukrok-vpravo', 1500);
await C(() => window.__chars.set({ move: 'l' })); await shot('02-ukrok-vlevo', 1500);
await cam('side');
await C(() => window.__chars.set({ move: 'b', ads: false })); await shot('03-couvani', 1500);
await C(() => { window.__chars.set({ move: 'f' }); window.__chars.jump(1.2); }); await shot('04-skok', 500);
await p.waitForTimeout(1200);
await C(() => { window.__chars.set({ move: '0' }); window.__chars.ladder(3); }); await shot('05-zebrik', 1300);
await p.waitForTimeout(2200);
await cam('side');
await C(() => window.__chars.actors().forEach((a) => window.__chars.pool.hit(a.view.id, { x: a.base.x, z: a.base.z - 5 }, 1))); await shot('06-zasah', 90);
await cam('front');
await C(() => { const t = window.__chars.now(); window.__chars.actors().forEach((a) => Object.assign(a.view.weapon, { action: 'equip', actionStart: t, actionEnd: t + 0.8 })); }); await shot('07-vymena-zbrane', 250);
await p.waitForTimeout(1000);
for (const role of ['base', 'sniper']) {
  const ok = await p.evaluate((r) => { const s = document.querySelector('#role'); if (![...s.options].some((o) => o.value === r)) return false; s.value = r; s.dispatchEvent(new Event('change')); return true; }, role);
  if (!ok) continue;
  await p.waitForTimeout(800);
  await C(() => window.__chars.reload(true)); await shot(`08-prebiti-${role}`, 1400);
  await p.waitForTimeout(3000);
}
await cam('side');
await C(() => { window.__chars.set({ move: 's' }); }); await p.waitForTimeout(800);
await C(() => window.__chars.setLife('dead')); await shot('09-smrt-v-behu', 1800);
await C(() => { window.__chars.setLife('alive'); window.__chars.set({ move: '0' }); }); await p.waitForTimeout(800);
await C(() => window.__chars.setLife('downed')); await shot('10-vyrazen', 1500);
console.log('chyb stránky:', errors);
await b.close();
