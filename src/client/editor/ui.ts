import { DEFAULT_ENVIRONMENT, type EnvironmentProfile, type MapObject } from '../../shared/map/schema';
import { allAssets, getAsset, resolveParams, terrainContext, type AssetDef, type ParamSpec } from '../../world/registry';
import { cmds, type EditorDoc, type History } from './editorDoc';
import { TEST_SPAWN_ID, type Editor } from './editor';
import { markerId } from './markers';
import { markerIcon, type Thumbnails } from './thumbnails';
import { roadModel, SURFACES } from '../../world/assets/osada/road';
import { formatRanges, parseRanges, refToS, sToRef, type SurfaceRange } from '../../world/assets/osada/roadGraph';
import { branchFrom, joinRoads, splitRoad } from '../../world/assets/osada/roadOps';
import { renderMarkerInspector, renderScenarios, type GameUiState } from './uiGame';

const CATEGORY_LABELS: Record<AssetDef['category'], string> = {
  buildings: 'Budovy',
  nature: 'Příroda',
  glb: 'Modely GLB (ChatGPT)',
  osada: 'Skladová osada',
  setA: 'Sada 300 · A Obytné budovy',
  setB: 'Sada 300 · B Stavební moduly',
  setC: 'Sada 300 · C Vstupy a průchody',
  setD: 'Sada 300 · D Obchody a vybavenost',
  setE: 'Sada 300 · E Průmysl a vojenské',
  setF: 'Sada 300 · F Zdi, ploty, brány',
  setG: 'Sada 300 · G Kryty a barikády',
  setH: 'Sada 300 · H Vraky vozidel',
  setI: 'Sada 300 · I Uliční mobiliář',
  setJ: 'Sada 300 · J Rekvizity a interiér',
  setK: 'Sada 300 · K Příroda',
  structures: 'Konstrukce',
  street: 'Ulice',
  cover: 'Kryty',
  primitives: 'Základní tvary',
  range: 'Střelnice',
  markers: 'Herní markery',
};

const MATERIAL_LABELS: Record<string, string> = {
  concrete: 'Beton',
  gravel: 'Štěrk',
  concreteLight: 'Beton světlý',
  plaster: 'Omítka',
  plasterWarm: 'Omítka okrová',
  plasterWhite: 'Omítka bílá',
  plasterOchre: 'Omítka okrová tmavá',
  metalSheet: 'Vlnitý plech',
  metalSheetRust: 'Vlnitý plech rezavý',
  containerRed: 'Červená',
  containerBlue: 'Modrá',
  containerGreen: 'Zelená',
  containerSand: 'Písková',
  awningRed: 'Červené pruhy',
  awningBlue: 'Modré pruhy',
  awningGreen: 'Zelené pruhy',
  awningSand: 'Pískové pruhy',
  acUnit: 'Klimatizace',
  burntMetal: 'Ohořelý kov',
  hescoFill: 'Geotextilie',
  rubber: 'Pryž',
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
  rock: 'Kámen šedý',
  rockWarm: 'Kámen teplý',
  stoneWall: 'Lomový kámen',
  plazaTile: 'Dlažba se vzorem',
  bark: 'Kůra',
  leafOlive: 'Olivové listí',
  leafGreen: 'Zelené listí',
  leafDry: 'Suché listí',
  crownOlive: 'Olivová koruna',
  crownGreen: 'Zelená koruna',
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

const MARKER_ITEMS: Array<{ id: string; label: string }> = [
  { id: 'marker.flag', label: 'Vlajka / kontrolní bod' },
  { id: 'marker.spawnA', label: 'Spawn – tým A' },
  { id: 'marker.spawnB', label: 'Spawn – tým B' },
  { id: 'marker.zone', label: 'Zakázaná zóna' },
];

const MARKER_KIND: Record<string, 'flag' | 'spawnA' | 'spawnB' | 'zone'> = { 'marker.flag': 'flag', 'marker.spawnA': 'spawnA', 'marker.spawnB': 'spawnB', 'marker.zone': 'zone' };

/**
 * Katalog jako v editoru nábytku: vyhledávání, kategorie z rozbalovací nabídky, mřížka dlaždic
 * s náhledovými obrázky a sekce „Použito na mapě“ (assety, které mapa už obsahuje, podle počtu).
 * Klik vloží asset do středu pohledu. Vrací `refresh()` – volat po změně mapy.
 */
export function buildCatalog(onPick: (assetId: string) => void, deps: { thumbs: Thumbnails; used: () => Map<string, number> }) {
  const list = document.getElementById('cat-list')!;
  const search = document.getElementById('cat-search') as HTMLInputElement;
  let sel = document.getElementById('cat-cat') as HTMLSelectElement | null;
  if (!sel) {
    sel = el('select', { id: 'cat-cat', title: 'Kategorie' }) as HTMLSelectElement;
    search.after(sel);
  }
  const select = sel;
  let cat = (() => {
    try {
      return localStorage.getItem('pf.catalog.cat') || 'all';
    } catch {
      return 'all';
    }
  })();
  let usedKey = '';
  // Oblíbené položky katalogu (jen v tomto prohlížeči – pohodlí, ne data mapy).
  const favs = new Set<string>((() => {
    try {
      return JSON.parse(localStorage.getItem('pf.catalog.fav') || '[]') as string[];
    } catch {
      return [];
    }
  })());
  const toggleFav = (id: string) => {
    if (favs.has(id)) favs.delete(id);
    else favs.add(id);
    try {
      localStorage.setItem('pf.catalog.fav', JSON.stringify([...favs]));
    } catch {
      /* ignorovat */
    }
    render();
  };
  const markerIcons = new Map<string, string>();

  const tile = (id: string, label: string, tag: string, title: string, img: (cb: (url: string) => void) => void) => {
    const b = el('button', { class: 'cat-tile', title });
    const pic = el('img', { alt: '', draggable: 'false' }) as HTMLImageElement;
    pic.decoding = 'async';
    img((url) => {
      if (url) pic.src = url;
      else pic.classList.add('none');
    });
    b.append(pic, el('span', { class: 'lbl' }, label));
    if (tag) b.append(el('small', { class: 'tag' }, tag));
    const star = el('span', { class: `fav${favs.has(id) ? ' on' : ''}`, title: favs.has(id) ? 'Odebrat z oblíbených' : 'Přidat do oblíbených' }, favs.has(id) ? '★' : '☆');
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(id);
    });
    b.append(star);
    b.addEventListener('click', () => onPick(id));
    return b;
  };
  const assetTile = (a: AssetDef, tag = '') =>
    tile(a.assetId, a.label, tag || (a.sizeParams ? 'param.' : a.uniformScale ? 'rekvizita' : ''), `${a.label} (${a.assetId}) – klik vloží do středu pohledu`, (cb) => deps.thumbs.request(a.assetId, cb));
  const markerTile = (m: { id: string; label: string }) =>
    tile(m.id, m.label, 'marker', `${m.label} – klik vloží do středu pohledu`, (cb) => {
      let u = markerIcons.get(m.id);
      if (!u) markerIcons.set(m.id, (u = markerIcon(MARKER_KIND[m.id])));
      cb(u);
    });
  const section = (title: string, tiles: HTMLElement[]) => {
    const g = el('div', { class: 'cat-group' });
    const grid = el('div', { class: 'cat-grid' });
    grid.append(...tiles);
    g.append(el('h4', {}, title), grid);
    return g;
  };

  const renderSelect = (used: Map<string, number>) => {
    const counts = new Map<string, number>();
    for (const a of allAssets()) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    const opts: Array<[string, string]> = [
      ['all', 'Vše'],
      ['fav', `★ Oblíbené (${favs.size})`],
      ['used', `Použito na mapě (${used.size})`],
      ['markers', 'Herní markery'],
      ...[...counts].map(([c, n]) => [c, `${CATEGORY_LABELS[c as AssetDef['category']] ?? c} (${n})`] as [string, string]),
    ];
    select.replaceChildren(...opts.map(([v, l]) => el('option', { value: v }, l)));
    if (!opts.some(([v]) => v === cat)) cat = 'all';
    select.value = cat;
  };

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const match = (label: string, id: string) => !q || label.toLowerCase().includes(q) || id.includes(q);
    const used = deps.used();
    usedKey = [...used].map(([k, v]) => `${k}:${v}`).join(',');
    renderSelect(used);
    list.replaceChildren();
    const assets = allAssets().filter((a) => match(a.label, a.assetId));
    if (cat === 'all' || cat === 'fav') {
      const tiles = [...favs]
        .map((id) => MARKER_ITEMS.find((m) => m.id === id) ?? getAsset(id))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => ('assetId' in a ? (match(a.label, a.assetId) ? assetTile(a) : null) : match(a.label, a.id) ? markerTile(a) : null))
        .filter((t): t is HTMLButtonElement => !!t);
      if (tiles.length) list.appendChild(section('★ Oblíbené', tiles));
      else if (cat === 'fav') list.appendChild(el('div', { class: 'note' }, 'Žádné oblíbené – klikni na ☆ u položky.'));
    }
    if (cat === 'all' || cat === 'used') {
      const tiles = [...used]
        .sort((x, y) => y[1] - x[1])
        .map(([id, n]) => [getAsset(id), n] as const)
        .filter(([a]) => a && match(a.label, a.assetId))
        .map(([a, n]) => assetTile(a!, `×${n}`));
      if (tiles.length) list.appendChild(section('Použito na mapě', tiles));
      else if (cat === 'used') list.appendChild(el('div', { class: 'note' }, q ? 'Nic nenalezeno.' : 'Na mapě zatím nic není.'));
    }
    if (cat === 'all' || cat === 'markers') {
      const mk = MARKER_ITEMS.filter((m) => match(m.label, m.id));
      if (mk.length) list.appendChild(section('Herní markery', mk.map(markerTile)));
    }
    if (cat !== 'used' && cat !== 'markers' && cat !== 'fav') {
      const groups = new Map<string, AssetDef[]>();
      for (const a of assets) {
        if (cat !== 'all' && a.category !== cat) continue;
        const arr = groups.get(a.category) ?? [];
        arr.push(a);
        groups.set(a.category, arr);
      }
      for (const [c, items] of groups) list.appendChild(section(CATEGORY_LABELS[c as AssetDef['category']] ?? c, items.map((a) => assetTile(a))));
    }
    if (!list.childElementCount) list.appendChild(el('div', { class: 'note' }, 'Nic nenalezeno.'));
  };
  select.addEventListener('change', () => {
    cat = select.value;
    try {
      localStorage.setItem('pf.catalog.cat', cat);
    } catch {
      /* ignorovat */
    }
    list.scrollTop = 0;
    render();
  });
  search.addEventListener('input', render);
  render();
  return {
    /** Po změně mapy: překreslit jen když se změnilo, co mapa používá. */
    refresh() {
      const used = deps.used();
      const key = [...used].map(([k, v]) => `${k}:${v}`).join(',');
      if (key !== usedKey) render();
    },
  };
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
  for (const c of ed.doc.controlPoints) row(markerId.cp(c.id), `⚑ ${c.name}`);
  for (const sp of ed.doc.spawnPoints) row(markerId.sp(sp.id), `⬆ Spawn ${sp.teams.map((t) => (t === 'teamA' ? 'A' : 'B')).join('+')}`);
  for (const z of ed.doc.zones) row(markerId.zn(z.id), `⛔ Zóna ${z.id}`);
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
  if (spec.type === 'points') {
    const count = String(value).split(';').filter(Boolean).length;
    return el('span', { class: 'meta' }, `${count} bodů – táhni zelené úchopy ve viewportu`);
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

/** Posuvník rozpití textury (0 ostré – 4 velmi rozpité). */
function blurControl(value: number, commit: (v: number) => void) {
  const wrap = el('span', { class: 'blur-ctl' });
  const r = el('input', { type: 'range', min: '0', max: '4', step: '0.5' }) as HTMLInputElement;
  r.value = String(value);
  const out = el('span', { class: 'meta' }, value ? value.toFixed(1) : 'ostré');
  r.addEventListener('input', () => (out.textContent = Number(r.value) ? Number(r.value).toFixed(1) : 'ostré'));
  r.addEventListener('change', () => commit(Number(r.value)));
  wrap.append(r, out);
  return wrap;
}

/** Nastaví rozpití textury hromadně (jedna položka historie). */
function setBlur(ed: EditorDoc, history: History, ids: string[], v: number, label: string) {
  const targets = ids.filter((id) => (ed.getObject(id)?.texBlur ?? 0) !== v);
  if (!targets.length) return;
  history.execute(cmds.updateMany(ed, targets, (o) => (o.texBlur = v || undefined), label));
}

export function renderInspector(
  ed: EditorDoc,
  history: History,
  editor: Editor,
  extra: { missing: (id: string) => string | undefined; spawnIssue: () => string | undefined; game: GameUiState; rerender: () => void; dropToSurface: (ids: string[]) => void; groundAll: () => void; fitTerrain: () => void },
) {
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
    renderMapProps(root, ed, history, extra);
    renderScenarios(root, ed, history);
    return;
  }
  if (sel.length === 1 && markerId.parse(sel[0])) {
    renderMarkerInspector(root, sel[0], ed, history, editor, extra.game, extra.rerender);
    return;
  }
  if (sel.length > 1) {
    root.appendChild(el('h3', {}, `Vybráno ${sel.length} objektů`));
    root.appendChild(el('div', { class: 'note' }, 'Táhni kterýkoli vybraný objekt = posun všech po terénu, modrý prstenec = rotace kolem společného středu. Rozměry se mění po jednom objektu.'));
    const objs = sel.filter((s) => ed.getObject(s));
    if (objs.length) root.appendChild(prop('Rozpití textur', 'vybrané objekty', blurControl(ed.getObject(objs[0])?.texBlur ?? 0, (v) => setBlur(ed, history, objs, v, 'Rozpití textur'))));
    const row = el('div', { class: 'btnrow' });
    const d = el('button', {}, 'Duplikovat (Ctrl+D)');
    d.addEventListener('click', () => editor.duplicate());
    const x = el('button', {}, 'Smazat (Del)');
    x.addEventListener('click', () => editor.deleteSelection());
    const drop = el('button', {}, 'Položit na povrch');
    drop.addEventListener('click', () => extra.dropToSurface(sel));
    row.appendChild(drop);
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
    if (def.describe) root.appendChild(el('div', { class: 'note' }, def.describe(p)));
    for (const w of def.validate?.(p) ?? []) root.appendChild(el('div', { class: 'note warn' }, `⚠ ${w}`));
    for (const spec of def.params) {
      if (spec.hidden) continue;
      const sub = spec.type === 'number' || spec.type === 'int' ? `${spec.min ?? ''}–${spec.max ?? ''} ${spec.unit ?? ''}`.trim() : undefined;
      root.appendChild(prop(spec.label, sub, paramControl(spec, p[spec.key], (v) => upd(spec.label, (x) => (x.params[spec.key] = v)))));
    }
  }
  if (def && o.assetId === 'osada.road') roadPanel(root, o, ed, history, editor);
  if (def && def.materials.length > 1) {
    const s = el('select') as HTMLSelectElement;
    for (const m of def.materials) s.appendChild(el('option', { value: m }, MATERIAL_LABELS[m] ?? m));
    s.value = o.material && def.materials.includes(o.material) ? o.material : def.defaultMaterial;
    s.addEventListener('change', () => upd('Materiál', (x) => (x.material = s.value)));
    root.appendChild(prop('Materiál', undefined, s));
  }

  root.appendChild(prop('Rozpití textury', '0 ostré – 4 rozpité', blurControl(o.texBlur ?? 0, (v) => setBlur(ed, history, [id], v, 'Rozpití textury'))));
  const blurRow = el('div', { class: 'btnrow' });
  const allBlur = el('button', { title: 'Nastaví stejné rozpití textury všem objektům na mapě' }, 'Použít rozpití na celou mapu');
  allBlur.addEventListener('click', () => setBlur(ed, history, ed.doc.objects.map((x) => x.id), o.texBlur ?? 0, 'Rozpití textur celé mapy'));
  const sameBlur = el('button', { title: 'Jen objekty stejného typu' }, `Na všechny „${def?.label ?? o.assetId}“`);
  sameBlur.addEventListener('click', () => setBlur(ed, history, ed.doc.objects.filter((x) => x.assetId === o.assetId).map((x) => x.id), o.texBlur ?? 0, 'Rozpití textur typu'));
  blurRow.append(allBlur, sameBlur);
  root.appendChild(blurRow);

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
  const dropB = el('button', { title: 'Jednorázově položí objekt na povrch pod ním (terén nebo objekt)' }, 'Položit na povrch');
  dropB.addEventListener('click', () => extra.dropToSurface([id]));
  row.appendChild(dropB);
  const d = el('button', {}, 'Duplikovat (Ctrl+D)');
  d.addEventListener('click', () => editor.duplicate());
  const x = el('button', {}, 'Smazat (Del)');
  x.addEventListener('click', () => editor.deleteSelection());
  row.append(f, d, x);
  root.appendChild(row);
}

function renderMapProps(root: HTMLElement, ed: EditorDoc, history: History, extra: { groundAll: () => void; fitTerrain: () => void }) {
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

  const blurs = doc.objects.map((o) => o.texBlur ?? 0);
  const same = blurs.every((b) => b === blurs[0]);
  root.appendChild(
    prop('Rozpití textur', same ? 'všechny objekty' : 'všechny objekty (teď různé)', blurControl(same ? (blurs[0] ?? 0) : 0, (v) => setBlur(ed, history, doc.objects.map((o) => o.id), v, 'Rozpití textur celé mapy'))),
  );

  // Předměty ve vzduchu: buď je položit na zem, nebo terén dorovnat pod ně (jedno Ctrl+Z vrátí).
  root.appendChild(el('div', { class: 'sec' }, 'Předměty a terén'));
  const gr = el('div', { class: 'btnrow' });
  const gA = el('button', { title: 'Každý předmět dosedne na terén (na svahu na nejnižší bod pod sebou, aby nevisel žádný roh) nebo na předmět pod sebou. Doplňky na zdech zůstanou.' }, '⬇ Položit vše na zem');
  gA.addEventListener('click', () => extra.groundAll());
  const gB = el('button', { title: 'Předměty zůstanou na místě; terén pod nimi se srovná na jejich patu a plynule zaoblí do okolí.' }, '⛰ Dorovnat terén pod předměty');
  gB.addEventListener('click', () => extra.fitTerrain());
  gr.append(gA, gB);
  root.appendChild(gr);
  root.appendChild(el('div', { class: 'note' }, 'Žádný předmět nemá viset ve vzduchu: buď předměty přesuň na zem, nebo nech terén dorovnat pod ně. Ploty, zdi a ulice kopírují terén samy. Jedno Ctrl+Z vrátí celou akci.'));

  root.appendChild(el('div', { class: 'sec' }, 'Prostředí'));
  const env = doc.environment;
  const setEnv = (label: string, patch: Partial<EnvironmentProfile>) =>
    history.execute({ label, changes: [{ kind: 'environment', before: structuredClone(env), after: { ...structuredClone(env), ...patch } }] });
  const preset = el('select') as HTMLSelectElement;
  for (const [v, l] of [
    ['dustyNoon', 'Prašné poledne'],
    ['clearSun', 'Čisté slunečno'],
    ['overcastRain', 'Zataženo s deštěm'],
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
  root.appendChild(el('div', { class: 'sec' }, 'Mlha'));
  const fogOn = el('input', { type: 'checkbox' }) as HTMLInputElement;
  fogOn.checked = env.fogEnabled !== false;
  fogOn.addEventListener('change', () => setEnv(fogOn.checked ? 'Zapnout mlhu' : 'Vypnout mlhu', { fogEnabled: fogOn.checked }));
  root.appendChild(prop('Mlha zapnutá', 'vizuálně i pro viditelnost na dálku', fogOn));
  const fogPreset = el('select') as HTMLSelectElement;
  const FOG_PRESETS: Record<string, { label: string; patch: Partial<EnvironmentProfile> }> = {
    custom: { label: 'Vlastní…', patch: {} },
    light: { label: 'Lehký opar', patch: { fogEnabled: true, fogHalfDistance: 600, fogColor: '#d6cdb8', skyHaze: 0.15 } },
    dusty: { label: 'Prašná mlha (pouštní)', patch: { fogEnabled: true, fogHalfDistance: 170, fogColor: '#cdb38a', skyHaze: 0.55 } },
    sandstorm: { label: 'Písečná bouře', patch: { fogEnabled: true, fogHalfDistance: 50, fogColor: '#c2a274', skyHaze: 0.9 } },
    morning: { label: 'Ranní mlha', patch: { fogEnabled: true, fogHalfDistance: 80, fogColor: '#c9cfd3', skyHaze: 0.7 } },
    smoke: { label: 'Kouř nad městem', patch: { fogEnabled: true, fogHalfDistance: 160, fogColor: '#9c968c', skyHaze: 0.6 } },
  };
  for (const [v, d] of Object.entries(FOG_PRESETS)) fogPreset.appendChild(el('option', { value: v }, d.label));
  fogPreset.value = 'custom';
  fogPreset.addEventListener('change', () => {
    const d = FOG_PRESETS[fogPreset.value];
    if (d && fogPreset.value !== 'custom') setEnv(`Mlha: ${d.label}`, d.patch);
  });
  root.appendChild(prop('Předvolba mlhy', 'nastaví hustotu, barvu a opar', fogPreset));
  root.appendChild(prop('Hustota (50 % ve vzdálenosti)', '30–5000 m · menší = hustší', numInput(env.fogHalfDistance, { min: 30, max: 5000, step: 10, unit: 'm' }, (v) => setEnv('Mlha', { fogHalfDistance: v }))));
  const fc = el('input', { type: 'color' }) as HTMLInputElement;
  fc.value = env.fogColor;
  fc.addEventListener('change', () => setEnv('Barva mlhy', { fogColor: fc.value }));
  root.appendChild(prop('Barva mlhy', undefined, fc));
  root.appendChild(prop('Opar na obloze', '0 čisté nebe – 1 nebe v mlze', numInput(env.skyHaze ?? 0.25, { min: 0, max: 1, step: 0.05 }, (v) => setEnv('Opar na obloze', { skyHaze: v }))));
  root.appendChild(el('div', { class: 'sec' }, 'Světlo'));
  root.appendChild(prop('Okolní světlo', '0–4', numInput(env.ambientIntensity, { min: 0, max: 4, step: 0.05 }, (v) => setEnv('Okolní světlo', { ambientIntensity: v }))));
  const reset = el('button', {}, 'Výchozí prostředí');
  reset.addEventListener('click', () => setEnv('Výchozí prostředí', { ...DEFAULT_ENVIRONMENT }));
  const r = el('div', { class: 'btnrow' });
  r.appendChild(reset);
  root.appendChild(r);
  root.appendChild(el('div', { class: 'note' }, 'Vyberte objekt v pohledu (LMB) nebo v záložce Scéna. Nový objekt vložíte kliknutím v Katalogu.'));
}

// ---------------- Cesta: úseky povrchu a graf ----------------

/**
 * Panel cesty Skladové osady: úseky povrchu (povrch, od–do v metrech po trase, přechod), přidání
 * úseku, a operace grafu – rozdělit / větvit v uzlu, spojit s navazující cestou, zrušit spoje.
 * Každá akce = jeden krok historie (i když mění víc objektů).
 */
function roadPanel(root: HTMLElement, o: MapObject, ed: EditorDoc, history: History, editor: Editor) {
  const def = getAsset(o.assetId)!;
  const p = resolveParams(def, o.params);
  const m = roadModel(p, terrainContext(o, ed.doc.terrain, ed.doc.objects));
  const keep = p.rangeLength === 'meters';
  const ranges = parseRanges(String(p.ranges));
  const setRanges = (label: string, rs: SurfaceRange[]) => history.execute(cmds.update(ed, o.id, (x) => (x.params.ranges = formatRanges(rs)), label));
  root.appendChild(el('div', { class: 'sec' }, 'Úseky povrchu'));
  root.appendChild(el('div', { class: 'note' }, `Trasa ${m.curve.total.toFixed(1)} m, základní povrch: ${SURFACES.find((x) => x.value === p.surface)?.label}. Úsek mění povrch jen v rozsahu od–do; hranice táhni růžovou (začátek) a fialovou (konec) značkou po trase. Přechod vzniká na obou koncích.`));
  ranges.forEach((r, i) => {
    const a = refToS(m.curve, m.ids, r.from, keep), b = refToS(m.curve, m.ids, r.to, keep);
    const box = el('div', { class: 'road-range' });
    const sel = el('select') as HTMLSelectElement;
    for (const s of SURFACES) sel.appendChild(el('option', { value: s.value }, s.label));
    sel.value = r.surface;
    sel.addEventListener('change', () => setRanges('Povrch úseku', ranges.map((x, k) => (k === i ? { ...x, surface: sel.value } : x))));
    box.appendChild(prop(`Úsek ${i + 1}`, a !== null && b !== null ? `délka ${Math.abs(b - a).toFixed(1)} m` : 'neplatný odkaz', sel));
    const at = (end: 'from' | 'to', v: number | null) =>
      numInput(v ?? 0, { min: 0, max: Math.round(m.curve.total * 100) / 100, step: 0.5, unit: 'm' }, (nv) => setRanges(end === 'from' ? 'Začátek úseku' : 'Konec úseku', ranges.map((x, k) => (k === i ? { ...x, [end]: sToRef(m.curve, m.ids, nv) } : x))));
    const vec = el('div', { class: 'vec' });
    vec.append(at('from', a), at('to', b));
    box.appendChild(prop('Od – do', 'm po trase', vec));
    box.appendChild(prop('Přechod', '0–8 m (zkrátí se u krátkého úseku)', numInput(r.transition, { min: 0, max: 8, step: 0.5, unit: 'm' }, (nv) => setRanges('Délka přechodu', ranges.map((x, k) => (k === i ? { ...x, transition: nv } : x))))));
    const del = el('button', {}, 'Smazat úsek');
    del.addEventListener('click', () => setRanges('Smazat úsek povrchu', ranges.filter((_, k) => k !== i)));
    box.appendChild(del);
    root.appendChild(box);
  });
  const add = el('button', { title: 'Nový úsek uprostřed trasy (pak posuň značky)' }, '+ Přidat úsek povrchu');
  add.addEventListener('click', () => {
    const L = m.curve.total;
    const other = p.surface === 'dirt' ? 'asphalt' : 'dirt';
    const id = `r${Math.max(0, ...ranges.map((r) => Number(r.id.replace(/\D/g, '')) || 0)) + 1}`;
    setRanges('Přidat úsek povrchu', [...ranges, { id, from: sToRef(m.curve, m.ids, L * 0.4), to: sToRef(m.curve, m.ids, L * 0.6), surface: other, transition: 2 }]);
  });
  root.appendChild(add);

  root.appendChild(el('div', { class: 'sec' }, 'Uzly a spoje'));
  const nodeSel = el('select') as HTMLSelectElement;
  m.ids.forEach((nid, i) => nodeSel.appendChild(el('option', { value: String(i) }, `uzel ${i + 1} (${nid})${m.joins.some((j) => j.index === i) ? ' · spoj' : ''}`)));
  root.appendChild(prop('Uzel', `${m.ids.length} uzlů`, nodeSel));
  const row = el('div', { class: 'btnrow' });
  const apply = (label: string, changes: import('./editorDoc').Command['changes'], select?: string[]) => {
    history.execute({ label, changes });
    if (select) editor.select(select);
  };
  const objChange = (after: MapObject | null, id: string) => ({ kind: 'object' as const, id, before: ed.getObject(id) ? JSON.parse(JSON.stringify(ed.getObject(id))) : null, after });
  const split = el('button', { title: 'Rozdělí trasu ve vybraném vnitřním uzlu na dvě cesty' }, 'Rozdělit v uzlu');
  split.addEventListener('click', () => {
    const r = splitRoad(o, Number(nodeSel.value), ed.newId(), ed.doc.objects);
    if ('error' in r) return void alertNote(root, r.error);
    apply('Rozdělit cestu', [objChange(r.a, o.id), objChange(r.b, r.b.id), ...r.others.map((x) => objChange(x, x.id))], [o.id, r.b.id]);
  });
  const branch = el('button', { title: 'Nová odbočka z vybraného uzlu (spojená s ním)' }, 'Větvit z uzlu');
  branch.addEventListener('click', () => {
    const b = branchFrom(o, Number(nodeSel.value), ed.newId());
    apply('Větvit cestu', [objChange(b, b.id)], [b.id]);
  });
  const join = el('button', { title: 'Spojí s cestou, jejíž konec leží u konce této cesty (≤ 1,5 m)' }, 'Spojit s navazující');
  join.addEventListener('click', () => {
    let msg = 'žádná cesta nekončí u konce této cesty';
    for (const other of ed.doc.objects) {
      if (other.id === o.id || other.assetId !== 'osada.road') continue;
      const r = joinRoads(o, other, ed.doc.objects);
      if ('error' in r) continue;
      apply('Spojit cesty', [objChange(r.a, o.id), objChange(null, r.removed), ...r.others.map((x) => objChange(x, x.id))], [o.id]);
      return;
    }
    alertNote(root, msg);
    msg = '';
  });
  row.append(split, branch, join);
  if (m.joins.length) {
    const unj = el('button', { title: 'Odpojí uzly od jiných cest (křižovatky se zruší)' }, 'Zrušit spoje');
    unj.addEventListener('click', () => history.execute(cmds.update(ed, o.id, (x) => (x.params.joins = '[]'), 'Zrušit spoje cesty')));
    row.append(unj);
  }
  root.appendChild(row);
}

function alertNote(root: HTMLElement, text: string) {
  root.querySelector('.road-alert')?.remove();
  root.appendChild(el('div', { class: 'note warn road-alert' }, `⚠ ${text}`));
}
