import type { MapObject } from '../../shared/map/schema';
import { allAssets, getAsset, resolveParams, terrainContext, type AssetDef, type ParamSpec } from '../../world/registry';
import { cmds, type EditorDoc, type History } from './editorDoc';
import { TEST_SPAWN_ID, type Editor } from './editor';
import { markerId } from './markers';
import type { Thumbnails } from './thumbnails';
import { GROUP_ORDER, groupOf, renderSceneTree } from './uiModes';
import { roadModel, SURFACES } from '../../world/assets/osada/road';
import { formatRanges, parseRanges, refToS, sToRef, type SurfaceRange } from '../../world/assets/osada/roadGraph';
import { branchFrom, joinRoads, splitRoad } from '../../world/assets/osada/roadOps';
import { renderMarkerInspector, type GameUiState } from './uiGame';

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

/**
 * Katalog (režim Stavět): hledání, kategorie jako štítky podle smyslu (Budovy, Ulice a cesty, Kryty a
 * zdi…), nahoře Oblíbené a „Na mapě“ (co mapa už používá). Klik vloží předmět doprostřed pohledu.
 * Herní značky (spawny, body, zóny) jsou v režimu Hra. Vrací `refresh()` – volat po změně mapy.
 */
export function buildCatalog(onPick: (assetId: string) => void, deps: { thumbs: Thumbnails; used: () => Map<string, number> }) {
  const list = document.getElementById('cat-list')!;
  const search = document.getElementById('cat-search') as HTMLInputElement;
  const chips = document.getElementById('cat-chips')!;
  let cat = (() => {
    try {
      return localStorage.getItem('pf.catalog.cat2') || 'all';
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
    const star = el('span', { class: `fav${favs.has(id) ? ' on' : ''}`, title: favs.has(id) ? 'Odebrat z oblíbených' : 'Přidat do oblíbených', role: 'button', 'aria-label': 'Oblíbené' }, favs.has(id) ? '★' : '☆');
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(id);
    });
    b.append(star);
    b.addEventListener('click', () => onPick(id));
    return b;
  };
  const assetTile = (a: AssetDef, tag = '') =>
    tile(a.assetId, a.label, tag || (a.sizeParams ? 'nastavitelný' : ''), `${a.label} – klik vloží doprostřed pohledu`, (cb) => deps.thumbs.request(a.assetId, cb));
  const section = (title: string, tiles: HTMLElement[]) => {
    const g = el('div', { class: 'cat-group' });
    const grid = el('div', { class: 'cat-grid' });
    grid.append(...tiles);
    g.append(el('h4', {}, title), grid);
    return g;
  };
  const pickCat = (c: string) => {
    cat = c;
    try {
      localStorage.setItem('pf.catalog.cat2', cat);
    } catch {
      /* ignorovat */
    }
    list.scrollTop = 0;
    render();
  };

  const renderChips = (used: Map<string, number>) => {
    const counts = new Map<string, number>();
    for (const a of allAssets()) {
      if (a.category === 'markers') continue;
      const g = groupOf(a);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const opts: Array<[string, string, number | null]> = [
      ['all', 'Vše', null],
      ['fav', '★ Oblíbené', favs.size],
      ['used', 'Na mapě', used.size],
      ...GROUP_ORDER.filter((g) => counts.has(g)).map((g) => [g, g, counts.get(g)!] as [string, string, number]),
    ];
    if (!opts.some(([v]) => v === cat)) cat = 'all';
    chips.replaceChildren(
      ...opts.map(([v, l, n]) => {
        const b = el('button', { class: v === cat ? 'on' : '', 'aria-pressed': String(v === cat) }, l);
        if (n !== null) b.appendChild(el('small', {}, String(n)));
        b.addEventListener('click', () => pickCat(v));
        return b;
      }),
    );
  };

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const match = (label: string, id: string) => !q || label.toLowerCase().includes(q) || id.includes(q);
    const used = deps.used();
    usedKey = [...used].map(([k, v]) => `${k}:${v}`).join(',');
    renderChips(used);
    list.replaceChildren();
    const assets = allAssets().filter((a) => a.category !== 'markers' && match(a.label, a.assetId));
    if (cat === 'all' || cat === 'fav') {
      const tiles = [...favs]
        .map((id) => getAsset(id))
        .filter((a): a is AssetDef => !!a && match(a.label, a.assetId))
        .map((a) => assetTile(a));
      if (tiles.length) list.appendChild(section('★ Oblíbené', tiles));
      else if (cat === 'fav') list.appendChild(el('div', { class: 'note' }, 'Žádné oblíbené – klikni na ☆ u předmětu.'));
    }
    if (cat === 'used' || (cat === 'all' && !q)) {
      const tiles = [...used]
        .sort((x, y) => y[1] - x[1])
        .map(([id, n]) => [getAsset(id), n] as const)
        .filter(([a]) => a && match(a.label, a.assetId))
        .slice(0, cat === 'used' ? 999 : 8)
        .map(([a, n]) => assetTile(a!, `×${n}`));
      if (tiles.length) list.appendChild(section(cat === 'used' ? 'Na mapě' : 'Na mapě (nejčastější)', tiles));
      else if (cat === 'used') list.appendChild(el('div', { class: 'note' }, q ? 'Nic nenalezeno.' : 'Na mapě zatím nic není.'));
    }
    if (cat !== 'used' && cat !== 'fav') {
      const groups = new Map<string, AssetDef[]>();
      for (const a of assets) {
        const g = groupOf(a);
        if (cat !== 'all' && g !== cat) continue;
        const arr = groups.get(g) ?? [];
        arr.push(a);
        groups.set(g, arr);
      }
      for (const g of GROUP_ORDER) {
        const items = groups.get(g);
        if (items?.length) list.appendChild(section(`${g} (${items.length})`, items.map((a) => assetTile(a))));
      }
    }
    if (!list.childElementCount) list.appendChild(el('div', { class: 'note' }, 'Nic nenalezeno.'));
  };
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
  const q = (document.getElementById('scene-search') as HTMLInputElement | null)?.value ?? '';
  renderSceneTree(document.getElementById('scene-list')!, ed, history, editor, q);
}

// ---------------- Inspektor ----------------

interface NumOpts {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/** Číselné pole s jednotkou uvnitř; rozsah v nápovědě (title), mimo rozsah upozorní. */
export function numInput(value: number, o: NumOpts, commit: (v: number) => void) {
  const wrap = el('span', { class: 'num' });
  const i = el('input', { type: 'number', step: String(o.step ?? 0.01) }) as HTMLInputElement;
  if (o.min !== undefined) i.min = String(o.min);
  if (o.max !== undefined) i.max = String(o.max);
  i.value = fmt(value);
  const range = o.min !== undefined || o.max !== undefined ? `${o.min ?? '−∞'}–${o.max ?? '∞'}${o.unit ? ' ' + o.unit : ''}` : o.unit ?? '';
  i.title = range ? `Rozsah ${range}` : '';
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
  wrap.appendChild(i);
  if (o.unit) wrap.appendChild(el('span', { class: 'unit' }, o.unit));
  return wrap;
}

/** Celé číslo s tlačítky − / +. */
function stepper(value: number, o: NumOpts, commit: (v: number) => void) {
  const box = el('span', { class: 'stepper' });
  const step = o.step ?? 1;
  const clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
  const minus = el('button', { 'aria-label': 'Ubrat', title: 'Ubrat' }, '−');
  const plus = el('button', { 'aria-label': 'Přidat', title: 'Přidat' }, '+');
  minus.addEventListener('click', () => commit(clamp(value - step)));
  plus.addEventListener('click', () => commit(clamp(value + step)));
  if (o.min !== undefined && value <= o.min) (minus as HTMLButtonElement).disabled = true;
  if (o.max !== undefined && value >= o.max) (plus as HTMLButtonElement).disabled = true;
  box.append(minus, numInput(value, o, (v) => commit(Math.round(v))), plus);
  return box;
}

function vec3(v: number[], o: NumOpts, commit: (i: number, x: number) => void) {
  const d = el('div', { class: 'vec3' });
  v.forEach((x, i) => {
    const n = numInput(x, o, (nv) => commit(i, nv));
    n.dataset.axis = 'XYZ'[i];
    d.appendChild(n);
  });
  return d;
}

function prop(label: string, sub: string | undefined, control: HTMLElement) {
  const p = el('div', { class: 'prop' });
  const l = el('span', { class: 'lbl' }, label);
  if (sub) l.title = sub;
  p.append(l, control);
  return p;
}

function propStack(label: string, control: HTMLElement) {
  const p = el('div', { class: 'prop stack' });
  p.append(el('span', { class: 'lbl' }, label), control);
  return p;
}

function switchCtl(value: boolean, label: string, commit: (v: boolean) => void) {
  const l = el('label', { class: 'switch' });
  const c = el('input', { type: 'checkbox' }) as HTMLInputElement;
  c.checked = value;
  c.addEventListener('change', () => commit(c.checked));
  l.append(c, el('span', {}, label));
  return l;
}

function paramControl(spec: ParamSpec, value: number | string | boolean, commit: (v: number | string | boolean) => void) {
  if (spec.type === 'bool') return switchCtl(Boolean(value), Boolean(value) ? 'zapnuto' : 'vypnuto', commit);
  if (spec.type === 'enum') {
    const opts = spec.options ?? [];
    if (opts.length <= 3 && opts.every((o) => o.label.length <= 12)) {
      const seg = el('div', { class: 'seg' });
      for (const o of opts) {
        const b = el('button', { class: String(value) === o.value ? 'on' : '', 'aria-pressed': String(String(value) === o.value) }, o.label);
        b.addEventListener('click', () => commit(o.value));
        seg.appendChild(b);
      }
      return seg;
    }
    const s = el('select') as HTMLSelectElement;
    for (const o of opts) s.appendChild(el('option', { value: o.value }, o.label));
    s.value = String(value);
    s.addEventListener('change', () => commit(s.value));
    return s;
  }
  if (spec.type === 'points') {
    const count = String(value).split(';').filter(Boolean).length;
    return el('span', { class: 'meta' }, `${count} bodů – táhni zelené úchopy v pohledu`);
  }
  if (spec.type === 'string') {
    const t = el('input', { type: 'text', maxlength: '60' }) as HTMLInputElement;
    t.value = String(value);
    t.addEventListener('change', () => commit(t.value));
    return t;
  }
  const o = { min: spec.min, max: spec.max, step: spec.step ?? (spec.type === 'int' ? 1 : 0.05), unit: spec.unit };
  if (spec.type === 'int') return stepper(value as number, o, (v) => commit(v));
  return numInput(value as number, o, (v) => commit(v));
}

/** Posuvník ostrosti textury (0 ostré – 4 velmi rozpité). */
function blurControl(value: number, commit: (v: number) => void) {
  const wrap = el('span', { class: 'blur-ctl' });
  const r = el('input', { type: 'range', min: '0', max: '4', step: '0.5', 'aria-label': 'Rozpití textury' }) as HTMLInputElement;
  r.value = String(value);
  const out = el('span', { class: 'meta' }, value ? value.toFixed(1) : 'ostré');
  r.addEventListener('input', () => (out.textContent = Number(r.value) ? Number(r.value).toFixed(1) : 'ostré'));
  r.addEventListener('change', () => commit(Number(r.value)));
  wrap.append(r, out);
  return wrap;
}

/** Nastaví rozpití textury hromadně (jedna položka historie). */
export function setBlur(ed: EditorDoc, history: History, ids: string[], v: number, label: string) {
  const targets = ids.filter((id) => (ed.getObject(id)?.texBlur ?? 0) !== v);
  if (!targets.length) return;
  history.execute(cmds.updateMany(ed, targets, (o) => (o.texBlur = v || undefined), label));
}

/** Sbalitelné skupiny vlastností; otevření se pamatuje (v tomto prohlížeči). */
const SECTION_OPEN: Record<string, boolean> = (() => {
  try {
    return JSON.parse(localStorage.getItem('pf.insp.open') || '{}');
  } catch {
    return {};
  }
})();
function section(root: HTMLElement, key: string, title: string, summary: string, defOpen = true) {
  const d = el('details', { class: 'isec' }) as HTMLDetailsElement;
  d.open = SECTION_OPEN[key] ?? defOpen;
  const s = el('summary', {});
  s.append(el('span', {}, title), el('span', { class: 'sum' }, summary));
  const body = el('div', { class: 'body' });
  d.append(s, body);
  d.addEventListener('toggle', () => {
    SECTION_OPEN[key] = d.open;
    try {
      localStorage.setItem('pf.insp.open', JSON.stringify(SECTION_OPEN));
    } catch {
      /* ignorovat */
    }
  });
  root.appendChild(d);
  return body;
}

function btn(label: string, title: string, fn: () => void, cls = '') {
  const b = el('button', { title, class: cls }, label);
  b.addEventListener('click', fn);
  return b;
}

const r1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('cs-CZ');

export interface InspectorExtra {
  missing: (id: string) => string | undefined;
  spawnIssue: () => string | undefined;
  game: GameUiState;
  rerender: () => void;
  dropToSurface: (ids: string[]) => void;
  groundAll: () => void;
  fitTerrain: () => void;
  openMapSettings: () => void;
  mode: string;
}

export function renderInspector(ed: EditorDoc, history: History, editor: Editor, extra: InspectorExtra) {
  const root = document.getElementById('inspector')!;
  // Nepřekreslovat pod rukama, když uživatel právě píše do pole inspektoru.
  if (root.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') {
    root.dataset.stale = '1';
    return;
  }
  root.dataset.stale = '';
  const scroll = root.scrollTop;
  root.replaceChildren();
  const sel = [...editor.selection];
  const head = (name: HTMLElement | string, type: string, actions: HTMLElement[] = []) => {
    const h = el('div', { class: 'insp-head' });
    const row = el('div', { class: 'row' });
    row.appendChild(typeof name === 'string' ? el('b', { style: 'font-size:17px;flex:1;padding:0 6px' }, name) : name);
    row.append(...actions);
    h.append(row, el('div', { class: 'type' }, type));
    root.appendChild(h);
  };

  if (sel.length === 0) {
    const doc = ed.doc;
    const box = el('div', { class: 'empty-state' });
    box.appendChild(el('h3', {}, 'Nic není vybráno'));
    const tips: Record<string, string[]> = {
      select: ['Klikni na objekt v pohledu nebo v seznamu Scéna.', 'Tažením po prázdném místě vybereš víc objektů rámečkem.', 'Ctrl+klik přidá objekt do výběru.'],
      build: ['Vyber předmět v katalogu vlevo – vloží se doprostřed pohledu.', 'Pak ho táhni na místo; R otočí, Ctrl+D přidá další kus.'],
      terrain: ['V režimu Terén se objekty nevybírají – štětec pracuje jen s krajinou.', 'Pro úpravu objektu přepni na Vybrat (1).'],
      paint: ['Malování mění jen povrch terénu.', 'Tráva roste ve hře podle namalované hustoty.'],
      play: ['Klikni na spawn, bod nebo zónu v seznamu vlevo nebo v pohledu.', 'Tady pak nastavíš tým, poloměr zabírání a vazby.'],
    };
    const ul = el('ul');
    for (const t of tips[extra.mode] ?? tips.select) ul.appendChild(el('li', {}, t));
    box.appendChild(ul);
    box.appendChild(el('div', { class: 'note' }, `Mapa „${doc.name}“: ${doc.objects.length} objektů, terén ${(doc.terrain.samplesX - 1) * doc.terrain.spacing} × ${(doc.terrain.samplesZ - 1) * doc.terrain.spacing} m, ${doc.spawnPoints.length} spawnů, ${doc.controlPoints.length} bodů.`));
    box.appendChild(btn('Nastavení mapy…', 'Název, prostředí, terén a pravidla hry', extra.openMapSettings, 'primary'));
    root.appendChild(box);
    return;
  }
  if (sel.length === 1 && markerId.parse(sel[0])) {
    renderMarkerInspector(root, sel[0], ed, history, editor, extra.game, extra.rerender);
    return;
  }
  const dupB = btn('⧉', 'Duplikovat (Ctrl+D)', () => editor.duplicate(), 'icon');
  dupB.setAttribute('aria-label', 'Duplikovat');
  const delB = btn('🗑', 'Smazat (Del)', () => editor.deleteSelection(), 'icon');
  delB.setAttribute('aria-label', 'Smazat');
  if (sel.length > 1) {
    head(`Vybráno ${sel.length} objektů`, 'Táhni kterýkoli z nich = posun všech · prstenec = rotace kolem středu', [dupB, delB]);
    const objs = sel.filter((s) => ed.getObject(s));
    const b = section(root, 'multi', 'Hromadné úpravy', '');
    const row = el('div', { class: 'btnrow' });
    row.append(
      btn('⬇ Položit na zem', 'Každý dosedne na povrch pod sebou', () => extra.dropToSurface(sel)),
      btn('🔒 Zamknout', 'Nelze vybrat v pohledu', () => history.execute(cmds.updateMany(ed, sel.filter((s) => s !== TEST_SPAWN_ID && ed.getObject(s)), (o) => (o.editor = { ...o.editor, locked: true }), 'Zamknout'))),
      btn('Zaměřit (F)', 'Kamera na výběr', () => editor.frameSelection()),
    );
    b.appendChild(row);
    if (objs.length) b.appendChild(prop('Ostrost textur', 'vybrané objekty', blurControl(ed.getObject(objs[0])?.texBlur ?? 0, (v) => setBlur(ed, history, objs, v, 'Rozpití textur'))));
    return;
  }

  const id = sel[0];
  if (id === TEST_SPAWN_ID) {
    const t = ed.doc.testSpawn ?? { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
    head('Testovací spawn', 'Kde se objevíš po stisku Testovat (F5) · hráč 1,80 × Ø 0,60 m');
    const issue = extra.spawnIssue();
    if (issue) root.appendChild(el('div', { class: 'tip warn' }, `⚠ ${issue}`));
    const setT = (mut: (p: [number, number, number], r: [number, number, number]) => void) => {
      const p = [...t.position] as [number, number, number];
      const r = [...t.rotation] as [number, number, number];
      mut(p, r);
      history.execute({ label: 'Testovací spawn', changes: [{ kind: 'testSpawn', before: ed.doc.testSpawn, after: { position: p, rotation: r } }] });
    };
    const b = section(root, 'place', 'Umístění', '');
    b.appendChild(propStack('Poloha (m)', vec3(t.position, { min: -5000, max: 5000, step: 0.25, unit: 'm' }, (i, nv) => setT((p) => (p[i] = nv)))));
    b.appendChild(prop('Natočení', '° kolem svislé osy', numInput(deg(t.rotation[1]), { min: -360, max: 360, step: 15, unit: '°' }, (v) => setT((_p, r) => (r[1] = rad(v))))));
    return;
  }

  const o = ed.getObject(id);
  if (!o) return;
  const def = getAsset(o.assetId);
  const upd = (label: string, mut: (x: MapObject) => void) => history.execute(cmds.update(ed, id, mut, label));
  const p = def ? resolveParams(def, o.params) : {};
  const nm = el('input', { type: 'text', maxlength: '60', class: 'name', placeholder: def?.label ?? o.assetId, 'aria-label': 'Název objektu (jen v editoru)', title: 'Název jen v editoru' }) as HTMLInputElement;
  nm.value = o.editor?.name ?? def?.label ?? '';
  nm.addEventListener('change', () => {
    const v = nm.value.trim();
    upd('Přejmenovat', (x) => (x.editor = { ...x.editor, name: v && v !== def?.label ? v : undefined }));
  });
  nm.addEventListener('keydown', (e) => e.key === 'Enter' && nm.blur());
  head(nm, `${def?.label ?? 'Neznámý typ'}${def?.describe ? ' · ' + def.describe(p) : ''}`, [dupB, delB]);
  const miss = extra.missing(o.id);
  if (miss) root.appendChild(el('div', { class: 'tip warn' }, `Zobrazeno jako náhradní tvar: ${miss}. Data objektu se při uložení zachovají.`));
  for (const w of def?.validate?.(p) ?? []) root.appendChild(el('div', { class: 'tip warn' }, `⚠ ${w}`));

  // Umístění
  const [px, py, pz] = o.transform.position;
  const place = section(root, 'place', 'Umístění', `X ${r1(px)} · Y ${r1(py)} · Z ${r1(pz)} · ${Math.round(deg(o.transform.rotation[1]))}°`);
  place.appendChild(propStack('Poloha (m)', vec3(o.transform.position, { min: -5000, max: 5000, step: editor.settings.grid, unit: 'm' }, (i, nv) => upd('Posun', (x) => (x.transform.position[i] = nv)))));
  const rot = el('div', { class: 'rot-row' });
  const yaw = deg(o.transform.rotation[1]);
  rot.append(
    numInput(yaw, { min: -360, max: 360, step: editor.settings.rotSnapDeg || 1, unit: '°' }, (v) => upd('Rotace', (x) => (x.transform.rotation[1] = rad(v)))),
    btn('⟲', 'Otočit o 90° doleva', () => upd('Rotace', (x) => (x.transform.rotation[1] = rad(((yaw + 90 + 540) % 360) - 180)))),
    btn('⟳', 'Otočit o 90° doprava', () => upd('Rotace', (x) => (x.transform.rotation[1] = rad(((yaw - 90 + 540) % 360) - 180)))),
  );
  place.appendChild(prop('Natočení', '° kolem svislé osy', rot));
  if (def?.uniformScale) place.appendChild(prop('Měřítko', `${def.uniformScale.min}–${def.uniformScale.max}×`, numInput(o.transform.scale ?? 1, { min: def.uniformScale.min, max: def.uniformScale.max, step: 0.05, unit: '×' }, (v) => upd('Měřítko', (x) => (x.transform.scale = v)))));
  const prow = el('div', { class: 'btnrow' });
  prow.append(btn('⬇ Položit na zem', 'Jednorázově položí objekt na povrch pod ním (terén nebo objekt)', () => extra.dropToSurface([id])), btn('Zaměřit (F)', 'Kamera na objekt', () => editor.frameSelection()));
  place.appendChild(prow);

  // Parametry podle typu
  const specs = (def?.params ?? []).filter((s) => !s.hidden);
  const shape = specs.filter((s) => s.type === 'number' || s.type === 'int' || s.type === 'points');
  const look = specs.filter((s) => s.type === 'enum');
  const details = specs.filter((s) => s.type === 'bool' || s.type === 'string');
  const ctl = (spec: ParamSpec) => prop(spec.label, spec.type === 'number' || spec.type === 'int' ? `${spec.min ?? ''}–${spec.max ?? ''} ${spec.unit ?? ''}`.trim() : undefined, paramControl(spec, p[spec.key], (v) => upd(spec.label, (x) => (x.params[spec.key] = v))));
  if (shape.length) {
    const b = section(root, 'shape', 'Rozměry a tvar', def?.describe ? def.describe(p) : '');
    for (const sp of shape) b.appendChild(ctl(sp));
  }
  if (def && o.assetId === 'osada.road') roadPanel(section(root, 'road', 'Cesta: úseky a uzly', ''), o, ed, history, editor);
  const matLabel = MATERIAL_LABELS[o.material ?? def?.defaultMaterial ?? ''] ?? o.material ?? '';
  const lb = section(root, 'look', 'Vzhled', matLabel);
  for (const sp of look) lb.appendChild(ctl(sp));
  if (def && def.materials.length > 1) {
    const s = el('select', { 'aria-label': 'Materiál' }) as HTMLSelectElement;
    for (const m of def.materials) s.appendChild(el('option', { value: m }, MATERIAL_LABELS[m] ?? m));
    s.value = o.material && def.materials.includes(o.material) ? o.material : def.defaultMaterial;
    s.addEventListener('change', () => upd('Materiál', (x) => (x.material = s.value)));
    lb.appendChild(prop('Materiál', undefined, s));
  }
  lb.appendChild(prop('Ostrost textury', '0 ostré – 4 rozpité', blurControl(o.texBlur ?? 0, (v) => setBlur(ed, history, [id], v, 'Rozpití textury'))));
  const blurRow = el('div', { class: 'btnrow' });
  blurRow.append(
    btn(`Na všechny „${def?.label ?? o.assetId}“`, 'Stejná ostrost pro všechny objekty tohoto typu', () => setBlur(ed, history, ed.doc.objects.filter((x) => x.assetId === o.assetId).map((x) => x.id), o.texBlur ?? 0, 'Rozpití textur typu')),
    btn('Na celou mapu', 'Stejná ostrost pro všechny objekty na mapě', () => setBlur(ed, history, ed.doc.objects.map((x) => x.id), o.texBlur ?? 0, 'Rozpití textur celé mapy')),
  );
  lb.appendChild(blurRow);
  if (details.length) {
    const b = section(root, 'details', 'Detaily a nápisy', details.filter((d) => d.type === 'bool' && p[d.key]).map((d) => d.label.toLowerCase()).join(', '));
    for (const sp of details) b.appendChild(ctl(sp));
  }

  // Viditelnost a zámek
  const vis = [o.editor?.hidden ? 'skrytý v editoru' : '', o.editor?.locked ? 'zamčený' : '', o.gameHidden ? 'skrytý ve hře' : ''].filter(Boolean).join(', ');
  const vb = section(root, 'vis', 'Viditelnost a zámek', vis || 'běžný', false);
  vb.appendChild(prop('V editoru', 'hru nemění', switchCtl(!o.editor?.hidden, 'zobrazit', (v) => upd('Skrýt v editoru', (x) => (x.editor = { ...x.editor, hidden: !v })))));
  vb.appendChild(prop('Zámek', 'nelze vybrat v pohledu', switchCtl(!!o.editor?.locked, 'zamknout', (v) => upd('Zamknout', (x) => (x.editor = { ...x.editor, locked: v })))));
  vb.appendChild(prop('Ve hře', 'bez renderu i kolize', switchCtl(!o.gameHidden, 'existuje', (v) => upd('Herní viditelnost', (x) => (x.gameHidden = !v || undefined)))));

  // Pokročilé
  const adv = section(root, 'adv', 'Pokročilé', `seed ${o.seed}`, false);
  adv.appendChild(el('div', { class: 'note' }, `Typ ${o.assetId} v${o.generatorVersion} · ID ${o.id}`));
  adv.appendChild(prop('Semínko', 'náhodná variace tvaru a detailů', el('span', { class: 'meta' }, String(o.seed))));
  adv.appendChild(btn('⟳ Jiná variace', 'Nové náhodné semínko (stejné parametry, jiné detaily)', () => upd('Nová variace', (x) => (x.seed = Math.floor(Math.random() * 1e9)))));
  root.scrollTop = scroll;
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
