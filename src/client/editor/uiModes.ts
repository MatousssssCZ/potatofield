import type { MapObject } from '../../shared/map/schema';
import { getAsset, type AssetDef } from '../../world/registry';
import type { BrushKind } from '../../world/terrain';
import { cmds, type EditorDoc, type History } from './editorDoc';
import { TEST_SPAWN_ID, type Editor, type PlantBrush } from './editor';
import { markerId } from './markers';
import { renderScenarios } from './uiGame';

/**
 * Editor podle režimů: Vybrat · Stavět · Terén · Povrch · Hra. Každý režim má vlastní panel vlevo
 * a vlastní chování myši (štětec kreslí jen v Terénu a Povrchu). Tento modul skládá panely režimů,
 * strom scény a sémantické skupiny katalogu.
 */
export type EditorMode = 'select' | 'build' | 'terrain' | 'paint' | 'play';

export const MODE_INFO: Record<EditorMode, { title: string; sub: string; hint: string; chip: string }> = {
  select: { title: 'Scéna', sub: 'Klikni na objekt v pohledu nebo v seznamu', chip: 'Vybrat', hint: 'Klik = výběr · Ctrl+klik = přidat · táhni = posun · G / R / S = posun / otočit / měřítko · F = zaměřit' },
  build: { title: 'Stavět', sub: 'Klikni na předmět – vloží se doprostřed pohledu', chip: 'Stavět', hint: 'Klik v katalogu = vložit doprostřed pohledu · pak táhni na místo · R = otočit · Ctrl+D = další kus' },
  terrain: { title: 'Terén', sub: 'Tvar krajiny: kopce, prohlubně, srovnání', chip: 'Terén', hint: 'Táhni = štětec · Shift + táhni = opačně · [ ] = velikost štětce · RMB + WASD = létat' },
  paint: { title: 'Povrch', sub: 'Hlína, město a tráva přímo na terén; rozsévání palem', chip: 'Povrch', hint: 'Táhni = malovat · Shift + táhni = ubrat · [ ] = velikost štětce' },
  play: { title: 'Hra', sub: 'Týmy, spawny, kontrolní body, zóny a scénáře', chip: 'Hra', hint: 'Přidej spawn nebo bod tlačítkem – objeví se uprostřed pohledu, pak ho přetáhni · Del = smazat' },
};

// ---------------- Sémantické skupiny katalogu ----------------

export type AssetGroup = 'Budovy' | 'Ulice a cesty' | 'Kryty a zdi' | 'Příroda' | 'Vojenské a vraky' | 'Rekvizity' | 'Konstrukce' | 'Střelnice';
export const GROUP_ORDER: AssetGroup[] = ['Budovy', 'Ulice a cesty', 'Kryty a zdi', 'Příroda', 'Vojenské a vraky', 'Rekvizity', 'Konstrukce', 'Střelnice'];

const BY_CATEGORY: Partial<Record<AssetDef['category'], AssetGroup>> = {
  buildings: 'Budovy',
  setA: 'Budovy',
  setB: 'Budovy',
  setC: 'Budovy',
  setD: 'Budovy',
  osada: 'Budovy',
  street: 'Ulice a cesty',
  setI: 'Ulice a cesty',
  cover: 'Kryty a zdi',
  setF: 'Kryty a zdi',
  setG: 'Kryty a zdi',
  nature: 'Příroda',
  setK: 'Příroda',
  setE: 'Vojenské a vraky',
  setH: 'Vojenské a vraky',
  setJ: 'Rekvizity',
  glb: 'Rekvizity',
  structures: 'Konstrukce',
  primitives: 'Konstrukce',
  range: 'Střelnice',
};

/** Skupina předmětu pro katalog a strom scény (podle smyslu, ne podle interní sady). */
export function groupOf(a: Pick<AssetDef, 'category' | 'assetId'>): AssetGroup {
  if (/road|street|sidewalk|curb|crossing/i.test(a.assetId)) return 'Ulice a cesty';
  return BY_CATEGORY[a.category] ?? 'Rekvizity';
}

// ---------------- Pomocné prvky ----------------

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

function slider(label: string, unit: string, value: number, min: number, max: number, step: number, hint: string, commit: (v: number) => void, fmt = (v: number) => String(v)) {
  const box = el('label', { class: 'slider' });
  const row = el('span', { class: 'row' });
  const t = el('span', {}, `${label} · ${fmt(value)}${unit}`);
  row.append(t, el('small', {}, hint));
  const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  r.value = String(value);
  r.addEventListener('input', () => {
    t.textContent = `${label} · ${fmt(Number(r.value))}${unit}`;
    commit(Number(r.value));
  });
  box.append(row, r);
  return box;
}

const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

// ---------------- Strom scény ----------------

const collapsed = new Set<string>(['Hratelnost', 'Konstrukce', 'Rekvizity']);

export function objectName(o: MapObject) {
  return o.editor?.name || getAsset(o.assetId)?.label || o.assetId;
}

/** Strom scény ve skupinách (Hratelnost, Budovy, Ulice…) s hledáním, počty a skrytím / zámkem. */
export function renderSceneTree(root: HTMLElement, ed: EditorDoc, history: History, editor: Editor, query: string) {
  root.replaceChildren();
  const q = query.trim().toLowerCase();
  const doc = ed.doc;
  type Item = { id: string; name: string; sub?: string; obj?: MapObject };
  const groups = new Map<string, Item[]>();
  const add = (g: string, it: Item) => {
    if (q && !it.name.toLowerCase().includes(q) && !(it.sub ?? '').toLowerCase().includes(q)) return;
    const arr = groups.get(g) ?? [];
    arr.push(it);
    groups.set(g, arr);
  };
  add('Hratelnost', { id: TEST_SPAWN_ID, name: 'Testovací spawn', sub: 'F5' });
  for (const c of doc.controlPoints) add('Hratelnost', { id: markerId.cp(c.id), name: `Bod ${c.name}`, sub: c.defaultOwner === 'teamA' ? 'tým A' : c.defaultOwner === 'teamB' ? 'tým B' : 'neutrální' });
  const n = { teamA: 0, teamB: 0 };
  for (const sp of doc.spawnPoints) {
    const team = sp.teams[0] ?? 'teamA';
    n[team]++;
    const cp = doc.controlPoints.find((c) => c.id === sp.controlPointId);
    add('Hratelnost', { id: markerId.sp(sp.id), name: `Spawn ${sp.teams.map((t) => (t === 'teamA' ? 'A' : 'B')).join('+')}${n[team]}`, sub: cp ? `u bodu ${cp.name}` : 'základna' });
  }
  for (const z of doc.zones) add('Hratelnost', { id: markerId.zn(z.id), name: z.kind === 'boundary' ? 'Hranice mapy' : 'Zakázaná zóna', sub: z.appliesTo.map((t) => (t === 'teamA' ? 'A' : 'B')).join('+') });
  for (const o of doc.objects) {
    const def = getAsset(o.assetId);
    add(def ? groupOf(def) : 'Rekvizity', { id: o.id, name: objectName(o), sub: o.editor?.name ? def?.label : undefined, obj: o });
  }
  const order = ['Hratelnost', ...GROUP_ORDER];
  if (!groups.size) root.appendChild(el('div', { class: 'tip' }, q ? 'Nic neodpovídá hledání.' : 'Mapa je prázdná – přepni na Stavět (2) a vlož první předmět.'));
  for (const g of order) {
    const items = groups.get(g);
    if (!items?.length) continue;
    const open = q ? true : !collapsed.has(g);
    const box = el('div', { class: 'tree-group' });
    const head = el('div', { class: 'tree-head', role: 'button', tabindex: '0', 'aria-expanded': String(open) });
    head.append(el('span', { class: 'arrow' }, open ? '▾' : '▸'), el('span', {}, g), el('span', { class: 'cnt' }, String(items.length)));
    const objs = items.filter((i) => i.obj).map((i) => i.obj!);
    if (objs.length) {
      const allHidden = objs.every((o) => o.editor?.hidden);
      const eye = el('button', { title: allHidden ? 'Zobrazit skupinu v editoru' : 'Skrýt skupinu v editoru (hru nemění)', class: allHidden ? 'off' : '' }, '👁');
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        history.execute(cmds.updateMany(ed, objs.map((o) => o.id), (x) => (x.editor = { ...x.editor, hidden: !allHidden }), allHidden ? 'Zobrazit skupinu' : 'Skrýt skupinu'));
      });
      head.appendChild(eye);
    }
    const toggle = () => {
      if (collapsed.has(g)) collapsed.delete(g);
      else collapsed.add(g);
      renderSceneTree(root, ed, history, editor, query);
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    box.appendChild(head);
    if (open) {
      for (const it of items) {
        const r = el('div', { class: `scene-row${editor.selection.has(it.id) ? ' sel' : ''}` });
        r.appendChild(el('span', { class: 'nm', title: it.id }, it.name));
        if (it.sub) r.appendChild(el('span', { class: 'rsub' }, it.sub));
        const o = it.obj;
        if (o) {
          const eye = el('button', { title: 'Skrýt v editoru (hru nemění)', class: o.editor?.hidden ? 'off' : '' }, '👁');
          eye.addEventListener('click', () => history.execute(cmds.update(ed, o.id, (x) => (x.editor = { ...x.editor, hidden: !x.editor?.hidden }), 'Skrýt v editoru')));
          const lock = el('button', { title: o.editor?.locked ? 'Odemknout' : 'Zamknout (nelze vybrat v pohledu)', class: o.editor?.locked ? '' : 'off' }, '🔒');
          lock.addEventListener('click', () => history.execute(cmds.update(ed, o.id, (x) => (x.editor = { ...x.editor, locked: !x.editor?.locked }), 'Zamknout')));
          r.append(eye, lock);
        }
        r.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).tagName === 'BUTTON') return;
          if (e.ctrlKey || e.metaKey) {
            const s = new Set(editor.selection);
            if (s.has(it.id)) s.delete(it.id);
            else s.add(it.id);
            editor.select([...s]);
          } else editor.select([it.id]);
        });
        r.addEventListener('dblclick', () => editor.frameSelection());
        box.appendChild(r);
      }
    }
    root.appendChild(box);
  }
}

// ---------------- Terén ----------------

const SHAPE_TOOLS: Array<[BrushKind, string, string, string]> = [
  ['raise', 'Zvýšit', 'kopce, valy', 'M12 4l8 14H4z'],
  ['lower', 'Snížit', 'prohlubně, příkopy', 'M12 20L4 6h16z'],
  ['smooth', 'Vyhladit', 'zjemní hrany', 'M3 15c4-6 6 2 9-3s5-3 9 1'],
  ['flatten', 'Srovnat', 'na jednu výšku', 'M3 14h18M7 10h10'],
];
let lastShape: BrushKind = 'raise';
let lastPaint: BrushKind | 'plant' | 'plantErase' = 'paintGrass';
let PLANT_DEFAULT: PlantBrush = { erase: false, spacing: 5, kind: 'mix', height: 8, variance: 0.35 };

/** Při vstupu do režimu: obnovit naposledy použitý nástroj režimu. */
export function enterBrushMode(editor: Editor, mode: 'terrain' | 'paint') {
  if (mode === 'terrain') {
    editor.plant = null;
    editor.brush.kind = lastShape;
  } else if (lastPaint === 'plant' || lastPaint === 'plantErase') {
    editor.plant = { ...PLANT_DEFAULT, erase: lastPaint === 'plantErase' };
  } else {
    editor.plant = null;
    editor.brush.kind = lastPaint;
  }
  if (!editor.terrainMode) editor.setTerrainMode(true);
}

function brushSliders(root: HTMLElement, editor: Editor, paint: boolean) {
  root.appendChild(slider('Velikost štětce', ' m', editor.brush.radius, 1, 40, 0.5, 'klávesy [ a ]', (v) => (editor.brush.radius = v)));
  const pct = (v: number) => `${Math.round(v * (paint ? 50 : 10))}`;
  root.appendChild(slider(paint ? 'Hustota / síla' : 'Síla', paint ? ' %' : ' %', editor.brush.strength, 0.1, paint ? 2 : 10, 0.05, paint ? 'rychlost malby' : 'rychlost změny', (v) => (editor.brush.strength = v), pct));
}

export function renderTerrainTools(root: HTMLElement, editor: Editor, onChange: () => void) {
  root.replaceChildren();
  const grid = el('div', { class: 'tool-grid' });
  for (const [k, label, hint, icon] of SHAPE_TOOLS) {
    const b = el('button', { class: editor.brush.kind === k && !editor.plant ? 'on' : '', 'aria-pressed': String(editor.brush.kind === k) });
    b.innerHTML = `${svg(icon)}<span>${label}</span><small>${hint}</small>`;
    b.addEventListener('click', () => {
      lastShape = k;
      editor.plant = null;
      editor.brush.kind = k;
      if (k === 'flatten') editor.brush.target = undefined;
      if (!editor.terrainMode) editor.setTerrainMode(true);
      onChange();
    });
    grid.appendChild(b);
  }
  root.appendChild(grid);
  brushSliders(root, editor, false);
  if (editor.brush.kind === 'flatten') {
    root.appendChild(
      el('div', { class: 'tip' }, editor.brush.target === undefined ? 'Cílová výška: nabere se z místa, kde začneš táhnout (nebo Shift+klik).' : `Cílová výška: ${editor.brush.target.toFixed(2)} m · Shift+klik nabere jinou.`),
    );
  }
  root.appendChild(el('div', { class: 'tip' }, 'Táhni levým tlačítkem. Shift obrací směr (Zvýšit ↔ Snížit). Předměty se s terénem nehýbou – „Položit na zem“ je ve vlastnostech objektu a v Nastavení mapy → Terén. Výškové pole neumí převisy ani tunely.'));
}

// ---------------- Povrch ----------------

const SURFACES: Array<[BrushKind, string, string, string]> = [
  ['paintDirt', 'Hlína', 'vyšlapané cesty, dvorky', '#7a5a3a'],
  ['paintUrban', 'Městský povrch', 'beton, štěrk, asfaltový prach', '#77736a'],
  ['paintGrass', 'Tráva', 'suchá stébla – ve hře rostou podle hustoty', '#b59a4e'],
  ['paintErase', 'Písek (guma)', 'smaže všechnu malbu – zůstane základní písek', '#c9a46a'],
];

export function renderPaintPanel(root: HTMLElement, editor: Editor, onChange: () => void) {
  root.replaceChildren();
  const list = el('div', { class: 'surf-list' });
  for (const [k, label, desc, color] of SURFACES) {
    const on = !editor.plant && editor.brush.kind === k;
    const b = el('button', { class: on ? 'on' : '', 'aria-pressed': String(on) });
    b.innerHTML = `<span class="swatch" style="background:${color}"></span><span>${label}<small>${desc}</small></span>`;
    b.addEventListener('click', () => {
      lastPaint = k;
      editor.plant = null;
      editor.brush.kind = k;
      if (!editor.terrainMode) editor.setTerrainMode(true);
      onChange();
    });
    list.appendChild(b);
  }
  root.appendChild(list);
  if (!editor.plant) {
    brushSliders(root, editor, true);
    root.appendChild(el('div', { class: 'tip' }, editor.brush.kind === 'paintErase' ? 'Táhni = vrátit povrch na písek.' : 'Táhni = přidat · Shift + táhni = ubrat. Opakovaný tah zvyšuje hustotu.'));
  }
  root.appendChild(el('div', { class: 'sect-title' }, 'Rozsévání předmětů štětcem'));
  const seg = el('div', { class: 'seg' });
  const pb = (label: string, erase: boolean) => {
    const on = !!editor.plant && editor.plant.erase === erase;
    const b = el('button', { class: on ? 'on' : '' }, label);
    b.addEventListener('click', () => {
      lastPaint = erase ? 'plantErase' : 'plant';
      editor.plant = { ...(editor.plant ?? PLANT_DEFAULT), erase };
      if (!editor.terrainMode) editor.setTerrainMode(true);
      onChange();
    });
    seg.appendChild(b);
  };
  pb('🌴 Sázet palmy', false);
  pb('Mazat palmy', true);
  root.appendChild(seg);
  if (editor.plant && !editor.plant.erase) {
    const pl = editor.plant;
    PLANT_DEFAULT = pl;
    root.appendChild(slider('Velikost háje', ' m', editor.brush.radius, 2, 40, 0.5, '[ ]', (v) => (editor.brush.radius = v)));
    root.appendChild(slider('Rozestup', ' m', pl.spacing, 2, 15, 0.5, 'mezi stromy', (v) => (pl.spacing = v)));
    root.appendChild(slider('Průměrná výška', ' m', pl.height, 2, 16, 0.5, '', (v) => (pl.height = v)));
    root.appendChild(slider('Rozdíly mezi stromy', ' %', pl.variance, 0, 1, 0.05, '', (v) => (pl.variance = v), (v) => String(Math.round(v * 100))));
    const kind = el('div', { class: 'seg' });
    for (const [v, l] of [['date', 'Datlovník'], ['slender', 'Štíhlá'], ['mix', 'Mix']] as const) {
      const b = el('button', { class: pl.kind === v ? 'on' : '' }, l);
      b.addEventListener('click', () => {
        pl.kind = v;
        onChange();
      });
      kind.appendChild(b);
    }
    root.appendChild(kind);
  }
  if (editor.plant) root.appendChild(el('div', { class: 'tip' }, editor.plant.erase ? 'Tah štětcem smaže palmy v kruhu.' : 'Tah štětcem vysází palmy v kruhu; každá je trochu jiná. Jeden tah = jedna položka historie.'));
}

// ---------------- Hra ----------------

export interface PlayDeps {
  insert: (kind: 'flag' | 'spawnA' | 'spawnB' | 'zone' | 'boundary') => void;
  spawnIssue: () => string | undefined;
}

export function renderPlayPanel(root: HTMLElement, ed: EditorDoc, history: History, editor: Editor, deps: PlayDeps) {
  root.replaceChildren();
  const doc = ed.doc;
  const cnt = (t: 'teamA' | 'teamB') => doc.spawnPoints.filter((s) => s.teams.includes(t)).length;
  const cards = el('div', { class: 'team-cards' });
  for (const [t, name, kind] of [['teamA', 'Tým A', 'spawnA'], ['teamB', 'Tým B', 'spawnB']] as const) {
    const c = el('div', { class: `team-card ${t === 'teamA' ? 'a' : 'b'}` });
    c.append(el('b', {}, name), el('small', {}, `${cnt(t)} spawnů`));
    const b = el('button', {}, `＋ Spawn ${t === 'teamA' ? 'A' : 'B'}`);
    b.addEventListener('click', () => deps.insert(kind));
    c.appendChild(b);
    cards.appendChild(c);
  }
  root.appendChild(cards);

  const head = (title: string, btn?: [string, () => void]) => {
    const h = el('div', { class: 'sect-title', style: 'display:flex;align-items:center' });
    h.appendChild(el('span', { style: 'flex:1' }, title));
    if (btn) {
      const b = el('button', { style: 'text-transform:none;letter-spacing:0' }, btn[0]);
      b.addEventListener('click', btn[1]);
      h.appendChild(b);
    }
    root.appendChild(h);
  };
  const rowSel = (id: string, badge: HTMLElement | null, text: string, sub: string) => {
    const r = el('div', { class: `list-row${editor.selection.has(id) ? ' sel' : ''}`, role: 'button', tabindex: '0' });
    if (badge) r.appendChild(badge);
    r.append(el('span', { class: 'grow' }, text), el('small', {}, sub));
    const pick = () => {
      editor.select([id]);
      editor.frameSelection();
    };
    r.addEventListener('click', pick);
    r.addEventListener('keydown', (e) => e.key === 'Enter' && pick());
    root.appendChild(r);
  };

  head('Kontrolní body', ['＋ Bod', () => deps.insert('flag')]);
  if (!doc.controlPoints.length) root.appendChild(el('div', { class: 'tip' }, 'Zatím žádné body. Pro režim Conquest přidej aspoň dva.'));
  doc.controlPoints.forEach((c, i) => {
    const b = el('span', { class: `cp-badge ${c.defaultOwner}` }, String.fromCharCode(65 + i));
    rowSel(markerId.cp(c.id), b, c.name, c.defaultOwner === 'teamA' ? 'tým A' : c.defaultOwner === 'teamB' ? 'tým B' : 'neutrální');
  });

  head('Zóny');
  const zs = el('div', { class: 'seg' });
  const zb = (label: string, kind: 'zone' | 'boundary') => {
    const b = el('button', {}, label);
    b.addEventListener('click', () => deps.insert(kind));
    zs.appendChild(b);
  };
  zb('＋ Zakázaná zóna', 'zone');
  zb('＋ Hranice mapy', 'boundary');
  root.appendChild(zs);
  for (const z of doc.zones) rowSel(markerId.zn(z.id), null, z.kind === 'boundary' ? 'Hranice mapy' : 'Zakázaná zóna', `pro ${z.appliesTo.map((t) => (t === 'teamA' ? 'A' : 'B')).join('+') || '—'}`);

  head('Testovací spawn');
  rowSel(TEST_SPAWN_ID, null, 'Kde začneš po F5', 'přetáhni v pohledu');
  const si = deps.spawnIssue();
  if (si) root.appendChild(el('div', { class: 'tip warn' }, `⚠ ${si}`));

  const sc = el('div', { class: 'scenarios' });
  renderScenarios(sc, ed, history);
  root.appendChild(sc);
}
