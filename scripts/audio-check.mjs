// Vývojová kontrola zvuku: načtení CC0 nahrávek, kroky při chůzi, výstřel a přebití bez chyb stránky.
// Použití: node scripts/audio-check.mjs [url]  (běží npm run dev)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => { if (!/Pointer Lock|pointer lock/i.test(e.message)) { errors.push(e.message); console.log('[pageerror]', e.message); } });
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
await page.goto(`${url}?q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 240000, polling: 1000 });
await page.evaluate(() => { const a = window.__pf; a.openDoc(a.streetTemplate(), false); });
await page.waitForTimeout(2500);
await page.evaluate(async () => {
  const a = window.__pf; a.forceFreeTest = true;
  void a.enterPlay();
  for (let i = 0; i < 120 && !a.session; i++) await new Promise((r) => setTimeout(r, 500));
  document.querySelector('#menu')?.classList.add('hidden');
});
await page.waitForTimeout(3000);
const info = await page.evaluate(async () => {
  const a = window.__pf;
  const g = a.session.game;
  const au = g.audio;
  au.unlock();
  for (let i = 0; i < 40 && au.loaded < 56; i++) await new Promise((r) => setTimeout(r, 250));
  const calls = { footstep: 0, land: 0, mech: 0, shot: 0, impactAt: 0 };
  for (const k of Object.keys(calls)) { const f = au[k].bind(au); au[k] = (...x) => { calls[k]++; return f(...x); }; }
  return { loaded: au.loaded, state: au.ctx?.state, hasGame: !!g, calls: (window.__calls = calls) && 0 };
});
ok(info.loaded === 56, `načteno ${info.loaded} / 56 nahrávek (stav kontextu ${info.state})`);
// Chůze vpřed 2,5 s, výstřel, přebití – vstupy přes herní InputSystem.
await page.evaluate(async () => {
  const g = window.__pf.session.game;
  g.active = true;
  const inp = g.input;
  const orig = inp.consumeTick.bind(inp);
  let n = 0;
  inp.consumeTick = (t) => { const f = orig(t); n++; f.moveZ = n < 150 ? 1 : 0; if (n === 160) { f.pressed |= 1; f.held |= 1; } return f; };
  await new Promise((r) => setTimeout(r, 6000));
  inp.consumeTick = orig;
});
const calls = await page.evaluate(() => window.__calls);
console.log('volání zvuků:', JSON.stringify(calls));
ok(calls.footstep >= 3, `kroky při chůzi (${calls.footstep})`);
ok(errors.length === 0, `bez chyb stránky (${errors.length})`);
await browser.close();
