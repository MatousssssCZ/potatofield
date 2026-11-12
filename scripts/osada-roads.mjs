// Vývojová kontrola silnic Skladové osady v reálném editoru (etapa 3):
// značky úseků povrchu (tažení = 1 krok historie), přidání úseku, rozdělení v uzlu, nakreslení
// cesty s napojením (T), Kontrola křížení + oprava „Vytvořit křižovatku“, shader přechodů bez chyb.
// Použití: node scripts/osada-roads.mjs [url] [složka-na-snímky]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const dir = process.argv[3];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
p.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
p.on('console', (m) => { if ((m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) || /THREE\.WebGLProgram|Shader Error/.test(m.text())) { errors.push(m.text().slice(0, 300)); console.log('[console]', m.text().slice(0, 300)); } });
await p.goto(`${url}?editor&q=low`);
await p.waitForFunction(() => window.__pf && window.__pf.editor, null, { timeout: 240000 });
await p.waitForTimeout(1500);
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
await p.evaluate(async () => {
  const { buildOsadaSliceMap } = await import('/src/world/maps/osadaSlice.ts');
  window.__pf.openDoc(buildOsadaSliceMap(), false);
});
await p.waitForTimeout(2500);
const cam = (x, y, z, yaw, pitch) => p.evaluate(([x, y, z, yaw, pitch]) => { const a = window.__pf; a.editor.restoreCamera({ pos: new a.camera.position.constructor(x, y, z), yaw, pitch, fov: 60 }); }, [x, y, z, yaw, pitch]);
const snap = async (name) => { if (dir) { await p.waitForTimeout(900); await p.screenshot({ path: `${dir}/${name}.png` }); } };
// Světový bod → obrazovka.
const scr = (x, y, z) => p.evaluate(([x, y, z]) => {
  const a = window.__pf; const v = new a.camera.position.constructor(x, y, z).project(a.camera);
  const r = document.querySelector('#view').getBoundingClientRect();
  return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
}, [x, y, z]);
const ranges = () => p.evaluate(() => JSON.parse(window.__pf.ed.getObject('os_001').params.ranges));
// Pohled shora na hlavní cestu.
await cam(-14, 40, 0.01, 0, -1.55);
await p.evaluate(() => window.__pf.editor.select(['os_001']));
await p.waitForTimeout(600);
const panel = await p.evaluate(() => document.querySelector('#inspector').textContent);
ok(panel.includes('Úseky povrchu') && panel.includes('Úsek 3'), 'panel cesty ukazuje 3 úseky povrchu');
const marks = await p.evaluate(() => window.__pf.editor['handles'].children.filter((c) => c.userData.handle.kind === 'rangeMark' && c.visible).map((c) => [c.position.x, c.position.y, c.position.z]));
ok(marks.length === 6, `značky úseků ve viewportu: ${marks.length}`);
// Táhnout začátek úseku 1 o ~6 m na západ.
const r0 = await ranges();
const [mx, my] = await scr(...marks[0]);
const [tx, ty] = await scr(marks[0][0] - 6, marks[0][1], marks[0][2]);
const undoBefore = await p.evaluate(() => window.__pf.history.undoStack.length);
await p.mouse.move(mx, my);
await p.mouse.down();
for (let i = 1; i <= 8; i++) await p.mouse.move(mx + ((tx - mx) * i) / 8, my + ((ty - my) * i) / 8);
await p.mouse.up();
await p.waitForTimeout(400);
const r1 = await ranges();
const steps = (await p.evaluate(() => window.__pf.history.undoStack.length)) - undoBefore;
ok(JSON.stringify(r1[0].from) !== JSON.stringify(r0[0].from) && steps === 1, `tažení značky změnilo začátek úseku (${JSON.stringify(r0[0].from)} → ${JSON.stringify(r1[0].from)}), kroků historie: ${steps}`);
ok(JSON.stringify(r1[1]) === JSON.stringify(r0[1]) && JSON.stringify(r1[2]) === JSON.stringify(r0[2]), 'ostatní úseky beze změny');
await snap('roads-01-znacky');
await p.evaluate(() => window.__pf.editor.undo());
ok(JSON.stringify((await ranges())[0]) === JSON.stringify(r0[0]), 'undo vrátí hranici úseku');
// Přidat úsek tlačítkem.
await p.evaluate(() => window.__pf.editor.select(['os_001']));
await p.waitForTimeout(300);
await p.getByRole('button', { name: '+ Přidat úsek povrchu' }).click();
await p.waitForTimeout(300);
ok((await ranges()).length === 4, 'přidán úsek povrchu');
await p.evaluate(() => window.__pf.editor.undo());
// Rozdělit v uzlu 3.
await p.evaluate(() => window.__pf.editor.select(['os_001']));
await p.waitForTimeout(300);
const n0 = await p.evaluate(() => window.__pf.ed.doc.objects.length);
await p.selectOption('#inspector select:near(:text("Uzel"))', '2').catch(async () => {
  await p.evaluate(() => { const s = [...document.querySelectorAll('#inspector select')].find((x) => x.textContent.includes('uzel 1')); s.value = '2'; });
});
await p.getByRole('button', { name: 'Rozdělit v uzlu' }).click();
await p.waitForTimeout(500);
const n1 = await p.evaluate(() => window.__pf.ed.doc.objects.length);
ok(n1 === n0 + 1, `rozdělení: ${n0} → ${n1} objektů`);
await p.evaluate(() => window.__pf.editor.undo());
await p.waitForTimeout(300);
ok((await p.evaluate(() => window.__pf.ed.doc.objects.length)) === n0, 'undo rozdělení');
// Nakreslit cestu severně od hlavní, konec u hlavní cesty → T.
await cam(-40, 45, 0.01, 0, -1.55);
await p.evaluate(() => window.__pf.editor.insertAsset('osada.road'));
for (const [x, z] of [[-40, -20], [-40, -10], [-40.3, 0.4]]) {
  const [sx, sy] = await scr(x, 0, z);
  await p.mouse.click(sx, sy);
  await p.waitForTimeout(120);
}
await p.keyboard.press('Enter');
await p.waitForTimeout(600);
const t = await p.evaluate(() => { const d = window.__pf.ed.doc; const o = d.objects.at(-1); return { id: o.id, joins: o.params.joins, main: d.objects.find((x) => x.id === 'os_001').params.nodeIds }; });
ok(t.joins && JSON.parse(t.joins).length === 1 && t.main.split(';').length === 6, `nakreslená cesta napojena (T): spoj ${t.joins}, uzly hlavní ${t.main}`);
await cam(-40, 22, 6, 0, -1.2);
await snap('roads-02-T-nakreslena');
// Křížení: cesta přes hlavní silnici → Kontrola nabídne křižovatku.
await p.evaluate(() => {
  const a = window.__pf;
  const o = { id: 'os_x', assetId: 'osada.road', generatorVersion: 1, transform: { position: [40, 0, -12], rotation: [0, 0, 0] }, params: { points: '0,0;2,24', nodeIds: 'x1;x2', width: 5, surface: 'gravel' }, seed: 5 };
  a.history.execute({ label: 'test', changes: [{ kind: 'object', id: o.id, before: null, after: o }] });
});
await p.waitForTimeout(400);
await p.click('#tb-check');
await p.waitForTimeout(800);
const chk = await p.evaluate(() => [...document.querySelectorAll('[class*=modal]')].map((x) => x.textContent).join(' '));
console.log('Kontrola:', chk.slice(0, 600));
ok(/kříží/.test(chk), 'Kontrola hlásí křížení bez křižovatky');
const fixBtn = p.locator('button:visible', { hasText: 'Vytvořit křižovatku' }).first();
console.log('tlačítek oprav:', await p.locator('button', { hasText: 'Vytvořit křižovatku' }).count());
await fixBtn.click().catch((e) => console.log('klik oprava selhal', e.message));
console.log('historie:', await p.evaluate(() => window.__pf.history.undoStack.at(-1)?.label));
await p.waitForTimeout(800);
await p.keyboard.press('Escape');
const x = await p.evaluate(() => window.__pf.ed.getObject('os_x').params.joins ?? '[]');
ok(JSON.parse(x).length === 1, `oprava vytvořila X křižovatku (spoj ${x})`);
await cam(41, 20, -2, 0, -1.45);
await snap('roads-03-X');
await cam(-14, 30, 0.01, 0, -1.55); await snap('roads-04-prechody-shora');
await cam(20, 30, 0.01, 0, -1.55); await snap('roads-05-beton-dlazba-shora');
ok(errors.length === 0, `bez chyb stránky a shaderu (${errors.length})`);
await b.close();
