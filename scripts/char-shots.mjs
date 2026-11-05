// Vývojový nástroj: snímky náhledové scény vojáků. SHOTS='[{"name","role","cam","stance","move","ads","yaw","pitch","life","reload","fire","lod","hb","wait"}]' node scripts/char-shots.mjs <url> <out>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out] = process.argv.slice(2);
const shots = JSON.parse(process.env.SHOTS ?? '[]');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await page.goto(`${url}/characters.html`);
await page.waitForFunction(() => window.__chars, null, { timeout: 120000, polling: 500 });
for (const s of shots) {
  await page.evaluate((s) => {
    const c = window.__chars;
    const sel = (id, v) => { const e = document.querySelector(id); if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v); e.dispatchEvent(new Event('change')); };
    if (s.role) sel('#role', s.role);
    if (s.cam) sel('#cam', s.cam);
    if (s.lod !== undefined) sel('#lod', s.lod);
    sel('#hb', !!s.hb);
    c.set({ move: s.move ?? '0', stance: s.stance ?? '1.8', ads: !!s.ads, yaw: s.yaw ?? 0, pitch: s.pitch ?? 0 });
    c.setLife(s.life ?? 'alive');
    if (s.reload) c.reload(s.reload === 'empty');
    if (s.fire) c.actors().forEach((a) => a.view.weapon.shotSeq++);
    if (s.bench) document.querySelector(`#b${s.bench}`).click();
  }, s);
  await page.waitForTimeout(s.wait ?? 2500);
  await page.screenshot({ path: `${out}/${s.name}.png`, timeout: 120000 });
  console.log('shot', s.name, (await page.textContent('#stats')).replace(/\n/g, ' | '));
}
await browser.close();
