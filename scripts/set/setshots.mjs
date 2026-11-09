import { createRequire } from 'module'; import fs from 'node:fs';
const { chromium } = createRequire('/home/user/potatofield/')('playwright');
const out = process.argv[2]; const prefix = process.argv[3] ?? 'setA.';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.addInitScript(() => { localStorage.setItem('pf.lang', 'cs'); localStorage.setItem('pf.settings', JSON.stringify({ quality: 'standard', qualityChosen: true })); });
await p.goto('http://localhost:5173/?editor');
await p.waitForFunction(() => window.__pf && window.__pf.editor, null, { timeout: 240000 });
const ids = await p.evaluate(async (prefix) => {
  const reg = await import('/src/world/index.ts');
  return reg.allAssets().map((a) => a.assetId).filter((id) => id.startsWith(prefix));
}, prefix);
const only = process.argv[4];
const skipDone = !process.argv.includes('--all');
for (const id of ids) {
  if (only && !id.includes(only)) continue;
  const open = async (params) => p.evaluate(async ([id, params]) => {
    const { buildEmptyMap } = await import('/src/world/maps/empty.ts');
    const reg = await import('/src/world/index.ts');
    const d = buildEmptyMap('Render', 128, 2);
    d.objects.push({ id: 'b', assetId: id, generatorVersion: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: reg.resolveParams(reg.getAsset(id), params), seed: 7 });
    window.__pf.openDoc(d, false);
    window.__pf.editor.select([]);
    window.__pf.editor.spawnMarker.visible = false;
    return reg.getAsset(id).params.some((q) => q.key === 'interior');
  }, [id, params]);
  const info = await p.evaluate(async (id) => {
    const { buildEmptyMap } = await import('/src/world/maps/empty.ts');
    const reg = await import('/src/world/index.ts');
    const SET_META = reg.SET_META;
    const d = buildEmptyMap('Render', 128, reg.getAsset(id).terrainCut ? 1 : 2);
    d.objects.push({ id: 'b', assetId: id, generatorVersion: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, params: reg.resolveParams(reg.getAsset(id), {}), seed: 7 });
    window.__pf.openDoc(d, false);
    // Sklepní vstupy: terén pod schody snížit stejně jako tlačítko v editoru.
    if (reg.getAsset(id).terrainCut) window.__pf.fitTerrainToObjects();
    window.__pf.editor.select([]);
    window.__pf.editor.spawnMarker.visible = false;
    const g = reg.generateObject(d.objects[0]);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const q of g.parts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q.pos[k] - q.size[k] / 2); mx[k] = Math.max(mx[k], q.pos[k] + q.size[k] / 2); }
    return { label: reg.getAsset(id).label, mn, mx, meta: SET_META[id] };
  }, id);
  if (skipDone && fs.existsSync(`${out}/A${String(info.meta.item).padStart(2, '0')}.jpg`)) continue;
  await p.waitForTimeout(2500);
  const c = [(info.mn[0] + info.mx[0]) / 2, (info.mn[1] + info.mx[1]) / 2, (info.mn[2] + info.mx[2]) / 2];
  const R = Math.max(info.mx[0] - info.mn[0], info.mx[2] - info.mn[2], info.mx[1]) * 1.15 + 4;
  const r = info.meta.route;
  const views = [
    ['predni', [c[0] - R * 0.55, R * 0.42, info.mn[2] - R * 0.8], [c[0], c[1] * 0.8, c[2]]],
    ['zadni', [c[0] + R * 0.6, R * 0.5, info.mx[2] + R * 0.75], [c[0], c[1] * 0.8, c[2]]],
    ['shora', [c[0] - R * 0.35, R * 1.25, c[2] - R * 0.5], [c[0], 0, c[2]]],
    ['interier', info.meta.view ? info.meta.view[0] : [r[Math.min(2, r.length - 1)].p[0], r[Math.min(2, r.length - 1)].p[1] + 1.6, r[Math.min(2, r.length - 1)].p[2]], info.meta.view ? info.meta.view[1] : [r[0].p[0], r[0].p[1] + 1.4, r[0].p[2]], 72],
  ];
  const imgs = [];
  const hasInterior = await open({});
  await p.waitForTimeout(1500);
  for (const [name, pos, target, fov] of views) {
    if (name === 'interier' && hasInterior) {
      await open({ interior: true });
      await p.waitForTimeout(2500);
    }
    await p.evaluate(([pos, target, fov]) => { const e = window.__pf.editor; const dx = target[0] - pos[0], dy = target[1] - pos[1], dz = target[2] - pos[2]; e.restoreCamera({ pos: window.__pf.camera.position.clone().set(...pos), yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), fov: fov ?? 50 }); }, [pos, target, fov]);
    await p.waitForTimeout(1200);
    imgs.push((await p.locator('#view').screenshot({ timeout: 120000 })).toString('base64'));
  }
  const sheet = await b.newPage({ viewport: { width: 1400, height: 940 } });
  await sheet.setContent(`<body style="margin:0;background:#1c1a16;color:#eee;font:15px Arial"><div style="padding:8px 12px;font-size:18px"><b>${info.label}</b> <span style="color:#bbb">· ${id} · obálka ${(info.mx[0]-info.mn[0]).toFixed(2)} × ${(info.mx[2]-info.mn[2]).toFixed(2)} × ${info.mx[1].toFixed(2)} m · cíl ${info.meta.target.join(' × ')} m</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:0 4px">${imgs.map((d, i) => `<div style="position:relative"><img style="width:100%;display:block" src="data:image/png;base64,${d}"><span style="position:absolute;left:6px;top:4px;background:#0008;padding:2px 6px">${['zepředu','zezadu','shora',hasInterior ? 'interiér (volitelný – „Přístupný interiér“)' : 'interiér / detail'][i]}</span></div>`).join('')}</div></body>`);
  // Prohlížeč (swiftshader) občas snímek odmítne – zkusit znovu.
  for (let k = 0; k < 4; k++) {
    try {
      await sheet.screenshot({ path: `${out}/A${String(info.meta.item).padStart(2, '0')}.jpg`, fullPage: true, type: 'jpeg', quality: 85 });
      break;
    } catch (e) {
      if (k === 3) throw e;
      await sheet.waitForTimeout(2000);
    }
  }
  await sheet.close();
  console.log('✓', id);
}
await b.close();
