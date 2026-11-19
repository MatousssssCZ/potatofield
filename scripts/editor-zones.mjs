// Vývojová kontrola: zóna jako mnohoúhelník – kreslení vrcholů, obdélník tažením, úprava vrcholů.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const shotDir = process.argv[3];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${url}?editor&q=low`);
await p.waitForFunction(() => window.__pf && window.__pf.editor, null, { timeout: 240000 });
await p.waitForTimeout(1500);
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
await p.evaluate(() => window.__pf.openDoc(window.__pf.streetTemplate(), false));
await p.waitForTimeout(3000);
await p.evaluate(() => { const a = window.__pf; a.editor.restoreCamera({ pos: new a.camera.position.constructor(0, 60, 40), yaw: 0, pitch: -1.3, fov: 60 }); });
await p.keyboard.press('5');
await p.waitForTimeout(500);
const r = await p.evaluate(() => document.querySelector('#view').getBoundingClientRect().toJSON());
const at = (fx, fy) => [r.left + r.width * fx, r.top + r.height * fy];
const zones = () => p.evaluate(() => window.__pf.ed.doc.zones);
const n0 = (await zones()).length;

// 1) Mnohoúhelník klikáním: tvar L (6 vrcholů), Enter dokončí.
await p.getByRole('button', { name: '✏ Zakázaná zóna' }).click();
const L = [[0.35, 0.35], [0.6, 0.35], [0.6, 0.5], [0.48, 0.5], [0.48, 0.7], [0.35, 0.7]];
for (const [fx, fy] of L) {
  const [x, y] = at(fx, fy);
  await p.mouse.click(x, y);
  await p.waitForTimeout(120);
}
await p.mouse.move(...at(0.4, 0.6));
await p.waitForTimeout(200);
if (shotDir) await p.screenshot({ path: `${shotDir}/zone-poly-draw.png` });
await p.keyboard.press('Enter');
await p.waitForTimeout(600);
let zs = await zones();
const z = zs.at(-1);
ok(zs.length === n0 + 1 && z.points?.length === 6, `nakreslen mnohoúhelník: ${z.points?.length} vrcholů, obal ${(z.halfExtents[0] * 2).toFixed(1)} × ${(z.halfExtents[2] * 2).toFixed(1)} m, výška ${(z.halfExtents[1] * 2).toFixed(1)} m`);
const inSc = await p.evaluate((id) => window.__pf.ed.doc.scenarios.every((s) => s.zoneIds.includes(id)), z.id);
ok(inSc, 'zóna je zapnutá ve všech scénářích');
const inL = await p.evaluate(async (id) => {
  const { insideZone, zoneWorld } = await import('/src/shared/map/zoneShape.ts');
  const z = window.__pf.ed.doc.zones.find((q) => q.id === id);
  // Střed vnitřního rohu výřezu (mimo L) a bod v rameni L.
  const pts = z.points;
  const xs = pts.map((q) => q[0]), zs2 = pts.map((q) => q[1]);
  const cut = zoneWorld(z, [(Math.max(...xs) + pts[3][0]) / 2, (Math.max(...zs2) + pts[3][1]) / 2]);
  const arm = zoneWorld(z, [(Math.min(...xs) + pts[3][0]) / 2, (Math.max(...zs2) + pts[3][1]) / 2]);
  return { cut: insideZone(z, { x: cut[0], y: z.center[1] - 0.9, z: cut[1] }), arm: insideZone(z, { x: arm[0], y: z.center[1] - 0.9, z: arm[1] }) };
}, z.id);
ok(!inL.cut && inL.arm, `server: výřez L mimo zónu (${inL.cut}), rameno uvnitř (${inL.arm})`);
await p.waitForTimeout(400);
if (shotDir) await p.screenshot({ path: `${shotDir}/zone-poly-selected.png` });

const handleXY = (kind, index) => p.evaluate(([kind, index]) => {
  const e = window.__pf.editor;
  const c = e.handles.children.find((m) => m.userData.handle.kind === kind && m.userData.handle.index === index);
  if (!c) return null;
  const v = c.position.clone().project(window.__pf.camera);
  const rc = document.querySelector('#view').getBoundingClientRect();
  return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height };
}, [kind, index]);
const world = (id, i) => p.evaluate(async ([id, i]) => {
  const { zoneWorld } = await import('/src/shared/map/zoneShape.ts');
  const z = window.__pf.ed.doc.zones.find((q) => q.id === id);
  return zoneWorld(z, z.points[i]);
}, [id, i]);

// 2) Tažení vrcholu 1 doprava: posune se jen ten vrchol.
const w0 = await world(z.id, 1), w2a = await world(z.id, 2);
let h = await handleXY('zoneVertex', 1);
await p.mouse.move(h.x, h.y);
await p.mouse.down();
await p.mouse.move(h.x + 70, h.y - 20, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(500);
const w1 = await world(z.id, 1), w2b = await world(z.id, 2);
ok(Math.hypot(w1[0] - w0[0], w1[1] - w0[1]) > 3 && Math.hypot(w2b[0] - w2a[0], w2b[1] - w2a[1]) < 0.05, `vrchol posunut o ${Math.hypot(w1[0] - w0[0], w1[1] - w0[1]).toFixed(1)} m, sousední vrchol stojí`);

// 3) Nový vrchol z kosočtverce na hraně.
h = await handleXY('zoneAdd', 0);
await p.mouse.move(h.x, h.y);
await p.mouse.down();
await p.mouse.move(h.x, h.y - 50, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(500);
zs = await zones();
ok(zs.find((q) => q.id === z.id).points.length === 7, `přidán vrchol (${zs.find((q) => q.id === z.id).points.length})`);

// 4) Shift + klik smaže vrchol.
h = await handleXY('zoneVertex', 1);
await p.keyboard.down('Shift');
await p.mouse.click(h.x, h.y);
await p.keyboard.up('Shift');
await p.waitForTimeout(500);
zs = await zones();
ok(zs.find((q) => q.id === z.id).points.length === 6, `Shift + klik smazal vrchol (${zs.find((q) => q.id === z.id).points.length})`);
if (shotDir) await p.screenshot({ path: `${shotDir}/zone-poly-edited.png` });

// 5) Ctrl+Z vrací kroky.
await p.keyboard.press('Control+z');
await p.waitForTimeout(300);
zs = await zones();
ok(zs.find((q) => q.id === z.id).points.length === 7, 'Ctrl+Z vrátí smazaný vrchol');

// 6) Obdélník tažením hned prvním stiskem; 7) Esc ruší.
await p.getByRole('button', { name: '✏ Hranice mapy' }).click();
await p.mouse.move(...at(0.66, 0.3));
await p.mouse.down();
await p.mouse.move(...at(0.72, 0.4), { steps: 5 });
await p.mouse.move(...at(0.8, 0.5), { steps: 5 });
await p.mouse.up();
await p.waitForTimeout(500);
zs = await zones();
ok(zs.length === n0 + 2 && zs.at(-1).points.length === 4 && zs.at(-1).kind === 'boundary', `tažením vznikl obdélník (hranice mapy, ${zs.at(-1).points?.length} vrcholy)`);
await p.getByRole('button', { name: '✏ Zakázaná zóna' }).click();
await p.mouse.click(...at(0.2, 0.2));
await p.mouse.click(...at(0.3, 0.2));
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
ok((await zones()).length === n0 + 2, 'Esc kreslení zruší');
await b.close();
