import { DEFAULT_ENVIRONMENT, type EnvironmentProfile } from '../../shared/map/schema';
import type { EditorDoc, History } from './editorDoc';
import { numInput, setBlur } from './ui';

/**
 * Dialog „Nastavení mapy“ (místo dlouhého panelu, který se ukazoval jen bez výběru):
 * Obecné · Prostředí · Terén · Hra. Každá změna jde přes historii (Ctrl+Z), pohled za dialogem
 * se překresluje hned.
 */
type Tab = 'general' | 'env' | 'terrain' | 'game';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};
function prop(label: string, sub: string | undefined, control: HTMLElement) {
  const p = el('div', { class: 'prop' });
  const l = el('span', { class: 'lbl' }, label);
  if (sub) l.appendChild(el('small', { style: 'display:block;color:var(--dim);font-size:11px' }, sub));
  p.append(l, control);
  return p;
}

const PRESETS: Array<{ v: EnvironmentProfile['preset']; label: string; desc: string; sky: string }> = [
  { v: 'dustyNoon', label: 'Prašné poledne', desc: 'teplé světlo, opar', sky: 'linear-gradient(#7fa6cf, #d9c9a3)' },
  { v: 'clearSun', label: 'Jasné slunce', desc: 'sytá obloha, ostré stíny', sky: 'linear-gradient(#3f78c4, #a9c6e6)' },
  { v: 'overcastRain', label: 'Zataženo, déšť', desc: 'měkké světlo, mlha', sky: 'linear-gradient(#6f7478, #a5a7a6)' },
];
const FOG_PRESETS: Record<string, { label: string; patch: Partial<EnvironmentProfile> }> = {
  light: { label: 'Lehký opar', patch: { fogEnabled: true, fogHalfDistance: 600, fogColor: '#d6cdb8', skyHaze: 0.15 } },
  dusty: { label: 'Prašná (pouštní)', patch: { fogEnabled: true, fogHalfDistance: 170, fogColor: '#cdb38a', skyHaze: 0.55 } },
  sandstorm: { label: 'Písečná bouře', patch: { fogEnabled: true, fogHalfDistance: 50, fogColor: '#c2a274', skyHaze: 0.9 } },
  morning: { label: 'Ranní mlha', patch: { fogEnabled: true, fogHalfDistance: 80, fogColor: '#c9cfd3', skyHaze: 0.7 } },
  smoke: { label: 'Kouř nad městem', patch: { fogEnabled: true, fogHalfDistance: 160, fogColor: '#9c968c', skyHaze: 0.6 } },
};

export interface MapSettingsDeps {
  groundAll: () => void;
  fitTerrain: () => void;
  openPlayMode: () => void;
}

export class MapSettingsDialog {
  private root = document.getElementById('mapset')!;
  private tab: Tab = 'env';
  constructor(private ed: EditorDoc, private history: History, private deps: MapSettingsDeps) {
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      e.stopPropagation();
    });
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  open(tab?: Tab) {
    if (tab) this.tab = tab;
    this.root.classList.remove('hidden');
    this.render();
    (this.root.querySelector('.ms-nav button.on') as HTMLElement | null)?.focus();
  }

  close() {
    this.root.classList.add('hidden');
  }

  /** Po změně dokumentu (historie) překreslit, když je dialog otevřený a uživatel nepíše. */
  refresh() {
    if (!this.visible) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && this.root.contains(a) && a.tagName === 'INPUT' && (a as HTMLInputElement).type !== 'range') return;
    this.render();
  }

  private render() {
    const doc = this.ed.doc;
    const box = el('div', { class: 'ms-box' });
    const head = el('div', { class: 'ms-head' });
    const close = el('button', {}, 'Zavřít');
    close.addEventListener('click', () => this.close());
    head.append(el('b', {}, 'Nastavení mapy'), el('span', { class: 'dim' }, doc.name), el('span', { style: 'flex:1' }), close);
    const main = el('div', { class: 'ms-main' });
    const nav = el('nav', { class: 'ms-nav', 'aria-label': 'Oddíly' });
    const tabs: Array<[Tab, string, string]> = [
      ['general', 'Obecné', 'název, ostrost textur'],
      ['env', 'Prostředí', 'slunce, mlha, obloha'],
      ['terrain', 'Terén', 'velikost, předměty na zem'],
      ['game', 'Hra', 'scénáře, tickety'],
    ];
    for (const [t, l, sub] of tabs) {
      const b = el('button', { class: t === this.tab ? 'on' : '' }, l);
      b.appendChild(el('small', {}, sub));
      b.addEventListener('click', () => {
        this.tab = t;
        this.render();
      });
      nav.appendChild(b);
    }
    const body = el('div', { class: 'ms-body' });
    if (this.tab === 'general') this.general(body);
    else if (this.tab === 'env') this.env(body);
    else if (this.tab === 'terrain') this.terrain(body);
    else this.game(body);
    main.append(nav, body);
    box.append(head, main);
    this.root.replaceChildren(box);
  }

  private general(root: HTMLElement) {
    const { ed, history } = this;
    const doc = ed.doc;
    const nm = el('input', { type: 'text', maxlength: '80' }) as HTMLInputElement;
    nm.value = doc.name;
    nm.addEventListener('change', () => {
      const v = nm.value.trim();
      if (v && v !== doc.name) history.execute({ label: 'Název mapy', changes: [{ kind: 'name', before: doc.name, after: v }] });
    });
    root.appendChild(prop('Název mapy', undefined, nm));
    const blurs = doc.objects.map((o) => o.texBlur ?? 0);
    const same = blurs.every((b) => b === blurs[0]);
    const r = el('input', { type: 'range', min: '0', max: '4', step: '0.5', 'aria-label': 'Ostrost textur' }) as HTMLInputElement;
    r.value = String(same ? (blurs[0] ?? 0) : 0);
    r.addEventListener('change', () => setBlur(ed, history, doc.objects.map((o) => o.id), Number(r.value), 'Rozpití textur celé mapy'));
    root.appendChild(prop('Ostrost textur', same ? 'všechny objekty · 0 = ostré' : 'všechny objekty (teď různé)', r));
    root.appendChild(el('div', { class: 'tip' }, `${doc.objects.length} objektů · ${doc.controlPoints.length} kontrolních bodů · ${doc.spawnPoints.length} spawnů · ${doc.scenarios.length} scénářů`));
  }

  private env(root: HTMLElement) {
    const { ed, history } = this;
    const env = ed.doc.environment;
    const setEnv = (label: string, patch: Partial<EnvironmentProfile>) =>
      history.execute({ label, changes: [{ kind: 'environment', before: structuredClone(env), after: { ...structuredClone(env), ...patch } }] });
    root.appendChild(el('div', { class: 'sect-title', style: 'margin-top:0;border:0;padding:0' }, 'Počasí a denní doba'));
    const cards = el('div', { class: 'preset-cards' });
    for (const p of PRESETS) {
      const b = el('button', { class: env.preset === p.v ? 'on' : '', 'aria-pressed': String(env.preset === p.v) });
      b.append(el('span', { class: 'sky', style: `background:${p.sky}` }), el('span', {}, p.label), el('small', {}, p.desc));
      b.addEventListener('click', () => setEnv('Předvolba prostředí', { preset: p.v }));
      cards.appendChild(b);
    }
    root.appendChild(cards);
    const slider = (label: string, unit: string, v: number, min: number, max: number, step: number, label2: string, key: keyof EnvironmentProfile) => {
      const box = el('label', { class: 'slider' });
      const t = el('span', { class: 'row' });
      const txt = el('span', {}, `${label} · ${v}${unit}`);
      t.append(txt, el('small', {}, label2));
      const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
      r.value = String(v);
      r.addEventListener('input', () => (txt.textContent = `${label} · ${r.value}${unit}`));
      r.addEventListener('change', () => setEnv(label, { [key]: Number(r.value) } as Partial<EnvironmentProfile>));
      box.append(t, r);
      return box;
    };
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px' });
    grid.append(
      slider('Směr slunce', '°', env.sunAzimuthDeg, 0, 360, 5, '0 = sever', 'sunAzimuthDeg'),
      slider('Výška slunce', '°', env.sunElevationDeg, 5, 90, 1, 'nízko = dlouhé stíny', 'sunElevationDeg'),
      slider('Síla slunce', '', env.sunIntensity, 0, 10, 0.1, '', 'sunIntensity'),
      slider('Okolní světlo', '', env.ambientIntensity, 0, 4, 0.05, 'jas stínů', 'ambientIntensity'),
    );
    root.appendChild(grid);
    const col = el('input', { type: 'color', 'aria-label': 'Barva slunce' }) as HTMLInputElement;
    col.value = env.sunColor;
    col.addEventListener('change', () => setEnv('Barva slunce', { sunColor: col.value }));
    root.appendChild(prop('Barva slunce', undefined, col));

    root.appendChild(el('div', { class: 'sect-title' }, 'Mlha a opar'));
    const fogOn = el('label', { class: 'switch' });
    const fc = el('input', { type: 'checkbox' }) as HTMLInputElement;
    fc.checked = env.fogEnabled !== false;
    fc.addEventListener('change', () => setEnv(fc.checked ? 'Zapnout mlhu' : 'Vypnout mlhu', { fogEnabled: fc.checked }));
    fogOn.append(fc, el('span', {}, 'zapnutá'));
    root.appendChild(prop('Mlha', 'mění i viditelnost hráčů', fogOn));
    const fp = el('div', { class: 'seg', style: 'flex-wrap:wrap;margin:6px 0 10px' });
    for (const [, d] of Object.entries(FOG_PRESETS)) {
      const b = el('button', {}, d.label);
      b.addEventListener('click', () => setEnv(`Mlha: ${d.label}`, d.patch));
      fp.appendChild(b);
    }
    root.appendChild(fp);
    root.appendChild(prop('Viditelnost', 'vzdálenost, kde je mlha z poloviny', numInput(env.fogHalfDistance, { min: 30, max: 5000, step: 10, unit: 'm' }, (v) => setEnv('Mlha', { fogHalfDistance: v }))));
    const fcol = el('input', { type: 'color', 'aria-label': 'Barva mlhy' }) as HTMLInputElement;
    fcol.value = env.fogColor;
    fcol.addEventListener('change', () => setEnv('Barva mlhy', { fogColor: fcol.value }));
    root.appendChild(prop('Barva mlhy', undefined, fcol));
    root.appendChild(slider('Opar na obloze', '', env.skyHaze ?? 0.25, 0, 1, 0.05, '0 čisté – 1 v mlze', 'skyHaze'));
    const reset = el('button', {}, 'Výchozí prostředí');
    reset.addEventListener('click', () => setEnv('Výchozí prostředí', { ...DEFAULT_ENVIRONMENT }));
    root.appendChild(reset);
  }

  private terrain(root: HTMLElement) {
    const t = this.ed.doc.terrain;
    root.appendChild(el('div', { class: 'tip' }, `Terén ${(t.samplesX - 1) * t.spacing} × ${(t.samplesZ - 1) * t.spacing} m, rozteč vzorků ${t.spacing} m. Tvar a povrch se mění štětci v režimech Terén (3) a Povrch (4).`));
    const a = el('button', { title: 'Každý předmět dosedne na terén nebo na předmět pod sebou. Doplňky na zdech zůstanou.' }, '⬇ Položit všechny předměty na zem');
    a.addEventListener('click', () => this.deps.groundAll());
    const b = el('button', { title: 'Předměty zůstanou na místě; terén pod nimi se srovná na jejich patu a plynule zaoblí.' }, '⛰ Dorovnat terén pod předměty');
    b.addEventListener('click', () => this.deps.fitTerrain());
    const row = el('div', { class: 'btnrow' });
    row.append(a, b);
    root.appendChild(row);
    root.appendChild(el('div', { class: 'note' }, 'Žádný předmět nemá viset ve vzduchu: buď předměty polož na zem, nebo nech terén dorovnat pod ně. Ploty, zdi a ulice kopírují terén samy. Jedno Ctrl+Z vrátí celou akci.'));
  }

  private game(root: HTMLElement) {
    const doc = this.ed.doc;
    root.appendChild(el('div', { class: 'tip' }, `${doc.scenarios.length} scénářů · ${doc.controlPoints.length} kontrolních bodů · spawny A ${doc.spawnPoints.filter((s) => s.teams.includes('teamA')).length}, B ${doc.spawnPoints.filter((s) => s.teams.includes('teamB')).length}`));
    for (const s of doc.scenarios) root.appendChild(el('div', { class: 'list-row' }, `${s.name} · tickety ${s.tickets.teamA}/${s.tickets.teamB} · ${Math.round(s.timeLimit / 60)} min`));
    const b = el('button', { class: 'primary' }, 'Upravit v režimu Hra (5)');
    b.addEventListener('click', () => {
      this.close();
      this.deps.openPlayMode();
    });
    root.appendChild(b);
  }
}
