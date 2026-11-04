import { DEFAULT_ENVIRONMENT, type EnvironmentProfile, type MapObject } from '../../shared/map/schema';
import { allAssets, getAsset, resolveParams, type AssetDef, type ParamSpec } from '../../world/registry';
import { cmds, type EditorDoc, type History } from './editorDoc';
import { TEST_SPAWN_ID, type Editor } from './editor';

const CATEGORY_LABELS: Record<AssetDef['category'], string> = {
  buildings: 'Budovy',
  structures: 'Konstrukce',
  street: 'Ulice',
  cover: 'Kryty',
  primitives: 'Základní tvary',
  range: 'Střelnice',
  markers: 'Herní markery',
};

const MATERIAL_LABELS: Record<string, string> = {
  concrete: 'Beton',
  concreteLight: 'Beton světlý',
  plaster: 'Omítka',
  plasterWarm: 'Omítka okrová',
  plasterWhite: 'Omítka bílá',
  brick: 'Cihla',
  sandstone: 'Pískovec',
  paving: 'Dlažba',
  asphalt: 'Asfalt',
  wood: 'Dřevo',
  woodDark: 'Dřevo tmavé',
  metal: 'Kov',
  paintedMetal: 'Kov olivový',
  paintedMetalBlue: 'Kov modrý',
  paintedMetalRed: 'Kov červený',
  fabricSand: 'Plátno',
  paint: 'Barva',
  target: 'Terč',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

const fmt = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

export function toast(msg: string, kind: 'info' | 'warn' = 'info') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = el('div', { class: `toast ${kind}` }, msg);
  box.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/** Jednoduchý modální dialog. Vrací id stisknutého tlačítka (nebo null při zavření). */
export function modal(title: string, body: Node | string, buttons: Array<{ id: string; label: string; primary?: boolean }>): Promise<string | null> {
  const root = document.getElementById('modal')!;
  root.querySelector('h3')!.textContent = title;
  const b = root.querySelector('.modal-body')!;
  b.replaceChildren(typeof body === 'string' ? document.createTextNode(body) : body);
  const btns = root.querySelector('.modal-buttons')!;
  btns.replaceChildren();
  root.classList.remove('hidden');
  return new Promise((resolve) => {
    const done = (id: string | null) => {
      root.classList.add('hidden');
      root.removeEventListener('keydown', onKey);
      resolve(id);
    };
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).code === 'Escape') done(null);
    };
    root.addEventListener('keydown', onKey);
    for (const bt of buttons) {
      const x = el('button', bt.primary ? { class: 'primary' } : {}, bt.label);
      x.addEventListener('click', () => done(bt.id));
      btns.appendChild(x);
    }
    (btns.lastElementChild as HTMLElement | null)?.focus();
  });
}

export function issuesList(issues: Array<{ severity: string; path: string; message: string }>, max = 30) {
  const ul = el('ul');
  for (const i of issues.slice(0, max)) {
    ul.appendChild(el('li', { class: i.severity === 'error' ? 'err' : 'wrn' }, `${i.path ? i.path + ': ' : ''}${i.message}`));
  }
  if (issues.length > max) ul.appendChild(el('li', {}, `… a dalších ${issues.length - max}`));
  return ul;
}

// ---------------- Katalog ----------------

export function buildCatalog(onPick: (assetId: string) => void) {
  const list = document.getElementById('cat-list')!;
  const search = document.getElementById('cat-search') as HTMLInputElement;
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    const groups = new Map<string, AssetDef[]>();
    for (const a of allAssets()) {
      if (q && !a.label.toLowerCase().includes(q) && !a.assetId.includes(q)) continue;
      const arr = groups.get(a.category) ?? [];
      arr.push(a);
      groups.set(a.category, arr);
    }
    for (const [cat, items] of groups) {
      const g = el('div', { class: 'cat-group' });
      g.appendChild(el('h4', {}, CATEGORY_LABELS[cat as AssetDef['category']] ?? cat));
      for (const a of items) {
        const b = el('button', { class: 'cat-item', title: `${a.assetId} – klik vloží do středu pohledu` });
        b.append(el('span', {}, a.label), el('small', {}, a.sizeParams ? 'param.' : a.uniformScale ? 'rekvizita' : ''));
        b.addEventListener('click', () => onPick(a.assetId));
        g.appendChild(b);
      }
      list.appendChild(g);
    }
    if (!list.childElementCount) list.appendChild(el('div', { class: 'note' }, 'Nic nenalezeno.'));
  };
  search.addEventListener('input', render);
  render();
}

// ---------------- Seznam scény ----------------

export function objectName(o: MapObject) {
  return o.editor?.name || getAsset(o.assetId)?.label || o.assetId;
}

export function renderSceneList(ed: EditorDoc, history: History, editor: Editor) {
  const root = document.getElementById('scene-list')!;
  root.replaceChildren();
  const row = (id: string, name: string, extra?: (r: HTMLElement) => void) => {
    const r = el('div', { class: `scene-row${editor.selection.has(id) ? ' sel' : ''}` });
    r.appendChild(el('span', { class: 'nm', title: id }, name));
    extra?.(r);
    r.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      if (e.ctrlKey || e.metaKey) {
        const s = new Set(editor.selection);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        editor.select([...s]);
      } else editor.select([id]);
    });
    root.appendChild(r);
  };
  row(TEST_SPAWN_ID, '◎ Testovací spawn');
  for (const o of ed.doc.objects) {
    row(o.id, objectName(o), (r) => {
      const eye = el('button', { title: 'Skrýt v editoru (nemění hru)', class: o.editor?.hidden ? 'off' : '' }, '👁');
      eye.addEventListener('click', () => history.execute(cmds.update(ed, o.id, (x) => (x.editor = { ...x.editor, hidden: !x.editor?.hidden }), 'Skrýt v editoru')));
      const lock = el('button', { title: 'Zamknout pro editaci', class: o.editor?.locked ? '' : 'off' }, '🔒');
      lock.addEventListener('click', () => history.execute(cmds.update(ed, o.id, (x) => (x.editor = { ...x.editor, locked: !x.editor?.locked }), 'Zamknout')));
      r.append(eye, lock);
    });
  }
}

// ---------------- Inspektor ----------------

interface NumOpts {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

function numInput(value: number, o: NumOpts, commit: (v: number) => void) {
  const i = el('input', { type: 'number', step: String(o.step ?? 0.01) }) as HTMLInputElement;
  if (o.min !== undefined) i.min = String(o.min);
  if (o.max !== undefined) i.max = String(o.max);
  i.value = fmt(value);
  const range = o.min !== undefined || o.max !== undefined ? `${o.min ?? '−∞'}–${o.max ?? '∞'}${o.unit ? ' ' + o.unit : ''}` : o.unit ?? '';
  i.title = range;
  i.addEventListener('change', () => {
    const v = Number(i.value.replace(',', '.'));
    if (!Number.isFinite(v) || (o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) {
      i.classList.add('bad');
      toast(`Hodnota mimo povolený rozsah (${range}).`, 'warn');
      return;
    }
    i.classList.remove('bad');
    commit(v);
  });
  i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') i.blur();
  });
  return i;
}

function prop(label: string, sub: string | undefined, control: HTMLElement) {
  const p = el('div', { class: 'prop' });
  const l = el('span', { class: 'lbl' }, label);
  if (sub) l.appendChild(el('small', {}, sub));
  p.append(l, control);
  return p;
}

function paramControl(spec: ParamSpec, value: number | string | boolean, commit: (v: number | string | boolean) => void) {
  if (spec.type === 'bool') {
    const c = el('input', { type: 'checkbox' }) as HTMLInputElement;
    c.checked = Boolean(value);
    c.addEventListener('change', () => commit(c.checked));
    return c;
  }
  if (spec.type === 'enum') {
    const s = el('select') as HTMLSelectElement;
    for (const o of spec.options ?? []) s.appendChild(el('option', { value: o.value }, o.label));
    s.value = String(value);
    s.addEventListener('change', () => commit(s.value));
    return s;
  }
  if (spec.type === 'string') {
    const t = el('input', { type: 'text', maxlength: '60' }) as HTMLInputElement;
    t.value = String(value);
    t.addEventListener('change', () => commit(t.value));
    return t;
  }
  return numInput(value as number, { min: spec.min, max: spec.max, step: spec.step ?? (spec.type === 'int' ? 1 : 0.05), unit: spec.unit }, (v) =>
    commit(spec.type === 'int' ? Math.round(v) : v),
  );
}

export function renderInspector(ed: EditorDoc, history: History, editor: Editor, extra: { missing: (id: string) => string | undefined; spawnIssue: () => string | undefined }) {
  const root = document.getElementById('inspector')!;
  // Nepřekreslovat pod rukama, když uživatel právě píše do pole inspektoru.
  if (root.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') {
    root.dataset.stale = '1';
    return;
  }
  root.dataset.stale = '';
  root.replaceChildren();
  const sel = [...editor.selection];

  if (sel.length === 0) {
    renderMapProps(root, ed, history);
    return;
  }
  if (sel.length > 1) {
    root.appendChild(el('h3', {}, `Vybráno ${sel.length} objektů`));
    root.appendChild(el('div', { class: 'note' }, 'Hromadný posun a rotace gizmem kolem společného středu. Nejednotná změna rozměrů různorodé skupiny není v této verzi podporována – měňte rozměry po jednom objektu.'));
    const row = el('div', { class: 'btnrow' });
    const d = el('button', {}, 'Duplikovat (Ctrl+D)');
    d.addEventListener('click', () => editor.duplicate());
    const x = el('button', {}, 'Smazat (Del)');
    x.addEventListener('click', () => editor.deleteSelection());
    const lockAll = el('button', {}, 'Zamknout vše');
    lockAll.addEventListener('click', () => history.execute(cmds.updateMany(ed, sel.filter((s) => s !== TEST_SPAWN_ID), (o) => (o.editor = { ...o.editor, locked: true }), 'Zamknout')));
    row.append(d, x, lockAll);
    root.appendChild(row);
    return;
  }

  const id = sel[0];
  if (id === TEST_SPAWN_ID) {
    const t = ed.doc.testSpawn ?? { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
    root.appendChild(el('h3', {}, 'Testovací spawn'));
    root.appendChild(el('div', { class: 'meta' }, 'Kde se objevíte po stisku Testovat (F5). Objem hráče 1,80 × Ø 0,60 m.'));
    const issue = extra.spawnIssue();
    if (issue) root.appendChild(el('div', { class: 'note warn' }, issue));
    const setT = (mut: (p: [number, number, number], r: [number, number, number]) => void) => {
      const p = [...t.position] as [number, number, number];
      const r = [...t.rotation] as [number, number, number];
      mut(p, r);
      history.execute({ label: 'Testovací spawn', changes: [{ kind: 'testSpawn', before: ed.doc.testSpawn, after: { position: p, rotation: r } }] });
    };
    const vec = el('div', { class: 'vec' });
    t.position.forEach((v, i) => vec.appendChild(numInput(v, { min: -5000, max: 5000, step: 0.25, unit: 'm' }, (nv) => setT((p) => (p[i] = nv)))));
    root.appendChild(prop('Pozice', 'm (X, Y, Z)', vec));
    root.appendChild(prop('Natočení', '° kolem svislé osy', numInput(deg(t.rotation[1]), { min: -360, max: 360, step: 15, unit: '°' }, (v) => setT((_p, r) => (r[1] = rad(v))))));
    return;
  }

  const o = ed.getObject(id);
  if (!o) return;
  const def = getAsset(o.assetId);
  root.appendChild(el('h3', {}, objectName(o)));
  root.appendChild(el('div', { class: 'meta' }, `${def?.label ?? 'Neznámý typ'} · ${o.assetId} v${o.generatorVersion} · ID ${o.id} · seed ${o.seed}`));
  const miss = extra.missing(o.id);
  if (miss) root.appendChild(el('div', { class: 'note warn' }, `Zobrazeno jako placeholder: ${miss}. Původní data objektu se při uložení zachovají.`));
  const upd = (label: string, mut: (x: MapObject) => void) => history.execute(cmds.update(ed, id, mut, label));

  const nm = el('input', { type: 'text', maxlength: '60', placeholder: def?.label ?? '' }) as HTMLInputElement;
  nm.value = o.editor?.name ?? '';
  nm.addEventListener('change', () => upd('Přejmenovat', (x) => (x.editor = { ...x.editor, name: nm.value.trim() || undefined })));
  root.appendChild(prop('Název', 'jen v editoru', nm));

  root.appendChild(el('div', { class: 'sec' }, 'Transformace'));
  const vec = el('div', { class: 'vec' });
  o.transform.position.forEach((v, i) =>
    vec.appendChild(numInput(v, { min: -5000, max: 5000, step: editor.settings.grid, unit: 'm' }, (nv) => upd('Posun', (x) => (x.transform.position[i] = nv)))),
  );
  root.appendChild(prop('Pozice', 'm (X, Y, Z)', vec));
  root.appendChild(prop('Natočení', '° kolem svislé osy', numInput(deg(o.transform.rotation[1]), { min: -360, max: 360, step: editor.settings.rotSnapDeg || 1, unit: '°' }, (v) => upd('Rotace', (x) => (x.transform.rotation[1] = rad(v))))));
  if (def?.uniformScale) {
    root.appendChild(
      prop('Měřítko', `${def.uniformScale.min}–${def.uniformScale.max}×`, numInput(o.transform.scale ?? 1, { min: def.uniformScale.min, max: def.uniformScale.max, step: 0.05 }, (v) => upd('Měřítko', (x) => (x.transform.scale = v)))),
    );
  }

  if (def && def.params.length) {
    root.appendChild(el('div', { class: 'sec' }, 'Parametry'));
    const p = resolveParams(def, o.params);
    for (const spec of def.params) {
      const sub = spec.type === 'number' || spec.type === 'int' ? `${spec.min ?? ''}–${spec.max ?? ''} ${spec.unit ?? ''}`.trim() : undefined;
      root.appendChild(prop(spec.label, sub, paramControl(spec, p[spec.key], (v) => upd(spec.label, (x) => (x.params[spec.key] = v)))));
    }
  }
  if (def && def.materials.length > 1) {
    const s = el('select') as HTMLSelectElement;
    for (const m of def.materials) s.appendChild(el('option', { value: m }, MATERIAL_LABELS[m] ?? m));
    s.value = o.material && def.materials.includes(o.material) ? o.material : def.defaultMaterial;
    s.addEventListener('change', () => upd('Materiál', (x) => (x.material = s.value)));
    root.appendChild(prop('Materiál', undefined, s));
  }

  root.appendChild(el('div', { class: 'sec' }, 'Viditelnost'));
  const chk = (label: string, sub: string, val: boolean, fn: (v: boolean) => void) => {
    const c = el('input', { type: 'checkbox' }) as HTMLInputElement;
    c.checked = val;
    c.addEventListener('change', () => fn(c.checked));
    root.appendChild(prop(label, sub, c));
  };
  chk('Skrýt v editoru', 'hru nemění', !!o.editor?.hidden, (v) => upd('Skrýt v editoru', (x) => (x.editor = { ...x.editor, hidden: v })));
  chk('Zamknout', 'nelze vybrat v pohledu', !!o.editor?.locked, (v) => upd('Zamknout', (x) => (x.editor = { ...x.editor, locked: v })));
  chk('Skrýt ve hře', 'bez renderu i kolize', !!o.gameHidden, (v) => upd('Herní viditelnost', (x) => (x.gameHidden = v || undefined)));

  const row = el('div', { class: 'btnrow' });
  const f = el('button', {}, 'Zaměřit (F)');
  f.addEventListener('click', () => editor.frameSelection());
  const d = el('button', {}, 'Duplikovat (Ctrl+D)');
  d.addEventListener('click', () => editor.duplicate());
  const x = el('button', {}, 'Smazat (Del)');
  x.addEventListener('click', () => editor.deleteSelection());
  row.append(f, d, x);
  root.appendChild(row);
}

function renderMapProps(root: HTMLElement, ed: EditorDoc, history: History) {
  const doc = ed.doc;
  root.appendChild(el('h3', {}, 'Mapa'));
  root.appendChild(el('div', { class: 'meta' }, `${doc.objects.length} objektů · terén ${(doc.terrain.samplesX - 1) * doc.terrain.spacing} × ${(doc.terrain.samplesZ - 1) * doc.terrain.spacing} m, rozteč ${doc.terrain.spacing} m`));
  const nm = el('input', { type: 'text', maxlength: '80' }) as HTMLInputElement;
  nm.value = doc.name;
  nm.addEventListener('change', () => {
    const v = nm.value.trim();
    if (v && v !== doc.name) history.execute({ label: 'Název mapy', changes: [{ kind: 'name', before: doc.name, after: v }] });
  });
  root.appendChild(prop('Název', undefined, nm));

  root.appendChild(el('div', { class: 'sec' }, 'Prostředí'));
  const env = doc.environment;
  const setEnv = (label: string, patch: Partial<EnvironmentProfile>) =>
    history.execute({ label, changes: [{ kind: 'environment', before: structuredClone(env), after: { ...structuredClone(env), ...patch } }] });
  const preset = el('select') as HTMLSelectElement;
  for (const [v, l] of [
    ['dustyNoon', 'Prašné poledne'],
    ['clearSun', 'Čisté slunečno'],
    ['overcastRain', 'Zataženo (déšť později)'],
  ])
    preset.appendChild(el('option', { value: v }, l));
  preset.value = env.preset;
  preset.addEventListener('change', () => setEnv('Předvolba prostředí', { preset: preset.value as EnvironmentProfile['preset'] }));
  root.appendChild(prop('Předvolba', undefined, preset));
  root.appendChild(prop('Azimut slunce', '0–360 °', numInput(env.sunAzimuthDeg, { min: 0, max: 360, step: 5, unit: '°' }, (v) => setEnv('Slunce', { sunAzimuthDeg: v }))));
  root.appendChild(prop('Výška slunce', '5–90 °', numInput(env.sunElevationDeg, { min: 5, max: 90, step: 1, unit: '°' }, (v) => setEnv('Slunce', { sunElevationDeg: v }))));
  root.appendChild(prop('Intenzita slunce', '0–10', numInput(env.sunIntensity, { min: 0, max: 10, step: 0.1 }, (v) => setEnv('Slunce', { sunIntensity: v }))));
  const col = el('input', { type: 'color' }) as HTMLInputElement;
  col.value = env.sunColor;
  col.addEventListener('change', () => setEnv('Barva slunce', { sunColor: col.value }));
  root.appendChild(prop('Barva slunce', undefined, col));
  root.appendChild(prop('Mlha (50 %)', '30–5000 m', numInput(env.fogHalfDistance, { min: 30, max: 5000, step: 10, unit: 'm' }, (v) => setEnv('Mlha', { fogHalfDistance: v }))));
  const fc = el('input', { type: 'color' }) as HTMLInputElement;
  fc.value = env.fogColor;
  fc.addEventListener('change', () => setEnv('Barva mlhy', { fogColor: fc.value }));
  root.appendChild(prop('Barva mlhy', undefined, fc));
  root.appendChild(prop('Okolní světlo', '0–4', numInput(env.ambientIntensity, { min: 0, max: 4, step: 0.05 }, (v) => setEnv('Okolní světlo', { ambientIntensity: v }))));
  const reset = el('button', {}, 'Výchozí prostředí');
  reset.addEventListener('click', () => setEnv('Výchozí prostředí', { ...DEFAULT_ENVIRONMENT }));
  const r = el('div', { class: 'btnrow' });
  r.appendChild(reset);
  root.appendChild(r);
  root.appendChild(el('div', { class: 'note' }, 'Vyberte objekt v pohledu (LMB) nebo v záložce Scéna. Nový objekt vložíte kliknutím v Katalogu.'));
}
