import { CAMERA } from '../../shared/config/camera';
import { QUALITY, detectQuality, type QualityProfile } from '../render/quality';
import { DEFAULT_BINDINGS, InputSystem, type Action } from '../runtime/input';
import { lang, setLang, t, type Lang, type StringKey } from './i18n';
import { button, h, settingRow, tabs } from './kit';

/**
 * Nastavení hráče (per-viewer pohodlí v localStorage, verzované; vše funguje i bez úložiště).
 * Obrazovka nastavení pracuje s pracovní kopií: Použít / Zrušit / Výchozí.
 */
export type Colorblind = 'none' | 'deutan' | 'protan' | 'tritan';

export interface Settings {
  version: number;
  quality: QualityProfile['id'];
  /** Kvalitu zvolil hráč (jinak se doporučí podle grafiky zařízení). */
  qualityChosen?: boolean;
  hFov: number;
  sensitivity: number;
  /** Násobek citlivosti při míření (vůči výchozímu poměru kamery). */
  adsSens: number;
  invertY: boolean;
  bob: number;
  landingKick: boolean;
  crouchToggle: boolean;
  fullscreen: boolean;
  volume: number;
  hudScale: number;
  hudOpacity: number;
  textSize: 's' | 'm' | 'l';
  colorblind: Colorblind;
  netDiag: boolean;
  showFps: boolean;
  /** Vlastní klávesy (jen změněné akce). */
  bindings: Partial<Record<Action, string[]>>;
  /** Vzhled zbraně ve volném testu editoru (výbavu jinak určuje nasazení). */
  weapon: string;
  lang?: Lang;
}

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  quality: 'standard',
  hFov: CAMERA.hFovDeg16x9,
  sensitivity: 2.5,
  adsSens: 1,
  invertY: false,
  bob: 1,
  landingKick: true,
  crouchToggle: false,
  fullscreen: true,
  volume: 0.6,
  hudScale: 1,
  hudOpacity: 1,
  textSize: 'm',
  colorblind: 'none',
  netDiag: false,
  showFps: false,
  bindings: {},
  weapon: 'm4a1',
};

/** Doporučení pro toto zařízení (zjišťuje se jednou za načtení stránky). */
export const DETECTED = typeof document !== 'undefined' ? detectQuality() : { id: 'standard' as const, gpu: '' };

export function loadSettings(): Settings {
  let s: Settings = structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem('pf.settings');
    if (raw) {
      const v = JSON.parse(raw);
      // Migrace: starší verze nemají nová pole – doplní se výchozí, známá pole zůstanou.
      if (v && typeof v === 'object') s = { ...s, ...v, version: SETTINGS_VERSION, bindings: { ...(v.bindings ?? {}) } };
    }
  } catch {
    /* bez úložiště nebo poškozená hodnota → výchozí */
  }
  if (!s.qualityChosen) s.quality = DETECTED.id;
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem('pf.settings', JSON.stringify(s));
  } catch {
    /* ignorovat */
  }
}

export function bindingsOf(s: Settings): Record<Action, string[]> {
  const b = structuredClone(DEFAULT_BINDINGS);
  for (const [k, v] of Object.entries(s.bindings)) if (Array.isArray(v) && v.length) b[k as Action] = v;
  return b;
}

/** Rozhraní: velikost/průhlednost HUD, text, barvy pro barvoslepé, jazyk – CSS proměnné na <html>. */
export function applyUiSettings(s: Settings) {
  const r = document.documentElement;
  r.style.setProperty('--pf-hud-scale', String(s.hudScale));
  r.style.setProperty('--pf-hud-opacity', String(s.hudOpacity));
  r.dataset.text = s.textSize;
  r.dataset.cb = s.colorblind;
}

export const ACTION_KEY: Record<Action, StringKey> = {
  FORWARD: 'act.forward',
  BACK: 'act.back',
  LEFT: 'act.left',
  RIGHT: 'act.right',
  SPRINT: 'act.sprint',
  JUMP: 'act.jump',
  CROUCH: 'act.crouch',
  PRONE: 'act.prone',
  FIRE: 'act.fire',
  ADS: 'act.aim',
  RELOAD: 'act.reload',
  SLOT3: 'act.slot3',
  MODE: 'act.fireMode',
  USE: 'act.use',
};

/** Pevné klávesy UI (nepřemapovatelné v pilotu) – pro přehled ovládání. */
export const UI_KEYS: Array<[StringKey, string]> = [
  ['act.scoreboard', 'Tab'],
  ['act.map', 'M'],
  ['act.squad', 'P / Home'],
  ['act.commander', 'C'],
  ['act.giveUp', 'G'],
  ['act.chat', 'J / K / L'],
  ['act.radio', 'Q'],
  ['act.order', 'T'],
];

let labeler: InputSystem | null = null;
export function keyLabel(code: string) {
  labeler ??= new InputSystem(document.body);
  return labeler.keyLabel(code);
}

type Cat = 'video' | 'audio' | 'controls' | 'ui';

/**
 * Obrazovka nastavení (pro hlavní menu i pauzu). `apply` dostane potvrzenou kopii;
 * `reload` = změna vyžaduje znovunačtení (kvalita).
 */
export class SettingsView {
  readonly root = h('div', { class: 'pf-settings' });
  private work: Settings;
  private cat: Cat = 'video';
  private note = '';
  private rebinding: Action | null = null;

  constructor(
    private current: () => Settings,
    private apply: (s: Settings, needsReload: boolean) => void,
    private onClose?: () => void,
  ) {
    this.work = structuredClone(current());
    this.render();
  }

  /** Znovu načíst pracovní kopii (otevření obrazovky). */
  open() {
    this.work = structuredClone(this.current());
    this.note = '';
    this.render();
    return this.root;
  }

  private get dirty() {
    return JSON.stringify(this.work) !== JSON.stringify(this.current());
  }

  private render() {
    const w = this.work;
    const slider = (key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const val = h('span', { class: 'pf-val tnum' }, fmt(w[key] as number));
      const inp = h('input', { type: 'range', min, max, step, value: w[key] as number }) as HTMLInputElement;
      inp.addEventListener('input', () => {
        (w[key] as number) = Number(inp.value);
        val.textContent = fmt(Number(inp.value));
        this.renderFooter();
      });
      return h('div', { class: 'pf-slider' }, inp, val);
    };
    const check = (key: keyof Settings) => {
      const inp = h('input', { type: 'checkbox' }) as HTMLInputElement;
      inp.checked = Boolean(w[key]);
      inp.addEventListener('change', () => {
        (w[key] as boolean) = inp.checked;
        this.renderFooter();
      });
      return inp;
    };
    const select = <T extends string>(value: T, opts: Array<[T, string]>, set: (v: T) => void) => {
      const s = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
      s.value = value;
      s.addEventListener('change', () => {
        set(s.value as T);
        this.renderFooter();
      });
      return s;
    };
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    let body: HTMLElement;
    if (this.cat === 'video') {
      const qn = (id: QualityProfile['id']) => t(`set.quality.${id}` as StringKey);
      body = h('div', { class: 'pf-set-body' },
        settingRow(t('set.quality'), select(w.quality, Object.values(QUALITY).map((q) => [q.id, qn(q.id)] as [QualityProfile['id'], string]), (v) => {
          w.quality = v;
          w.qualityChosen = true;
        }), t('set.detected', { q: qn(DETECTED.id) })),
        settingRow(t('set.fov'), slider('hFov', CAMERA.hFovMinDeg, CAMERA.hFovMaxDeg, 1, (v) => `${v}°`)),
        settingRow(t('set.bob'), slider('bob', 0, 1, 0.05, pct)),
        settingRow(t('set.landingKick'), check('landingKick')),
        settingRow(t('set.fullscreen'), check('fullscreen')),
        settingRow(t('set.fps'), check('showFps')),
      );
    } else if (this.cat === 'audio') {
      body = h('div', { class: 'pf-set-body' }, settingRow(t('set.volume'), slider('volume', 0, 1, 0.05, pct)));
    } else if (this.cat === 'controls') {
      const b = bindingsOf(w);
      const owner = (code: string, except: Action) => (Object.keys(b) as Action[]).find((a) => a !== except && b[a].includes(code));
      const rows = (Object.keys(DEFAULT_BINDINGS) as Action[]).map((a) => {
        const btn = button(this.rebinding === a ? t('set.rebind') : b[a].map(keyLabel).join(', '), () => {
          this.rebinding = a;
          this.render();
          const onKey = (e: KeyboardEvent | MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            window.removeEventListener('keydown', onKey as EventListener, true);
            window.removeEventListener('mousedown', onKey as EventListener, true);
            const code = e instanceof KeyboardEvent ? e.code : `Mouse${e.button}`;
            this.rebinding = null;
            if (code === 'Escape') return this.render();
            const clash = owner(code, a);
            if (clash) this.note = t('set.conflict', { key: keyLabel(code), action: t(ACTION_KEY[clash]) });
            else {
              this.note = '';
              w.bindings[a] = [code];
            }
            this.render();
          };
          setTimeout(() => {
            window.addEventListener('keydown', onKey as EventListener, true);
            window.addEventListener('mousedown', onKey as EventListener, true);
          }, 0);
        }, `pf-btn pf-key${this.rebinding === a ? ' on' : ''}`);
        return settingRow(t(ACTION_KEY[a]), btn);
      });
      body = h('div', { class: 'pf-set-body' },
        settingRow(t('set.sens'), slider('sensitivity', 0.2, 8, 0.05, (v) => v.toFixed(2))),
        settingRow(t('set.adsSens'), slider('adsSens', 0.3, 2, 0.05, pct)),
        settingRow(t('set.invertY'), check('invertY')),
        settingRow(t('set.toggleCrouch'), check('crouchToggle')),
        h('h4', {}, t('set.bindings')),
        ...rows,
        h('h4', {}, t('set.uiKeys')),
        ...UI_KEYS.map(([k, key]) => settingRow(t(k), h('span', { class: 'pf-key static' }, key))),
      );
    } else {
      body = h('div', { class: 'pf-set-body' },
        settingRow(t('menu.lang'), select<Lang>(w.lang ?? lang(), [['cs', 'Čeština'], ['en', 'English']], (v) => (w.lang = v))),
        settingRow(t('set.hudScale'), slider('hudScale', 0.75, 1.5, 0.05, pct)),
        settingRow(t('set.hudOpacity'), slider('hudOpacity', 0.4, 1, 0.05, pct)),
        settingRow(t('set.textSize'), select(w.textSize, [['s', 'S'], ['m', 'M'], ['l', 'L']], (v) => (w.textSize = v))),
        settingRow(t('set.colorblind'), select<Colorblind>(w.colorblind, (['none', 'deutan', 'protan', 'tritan'] as const).map((c) => [c, t(`set.cb.${c}`)] as [Colorblind, string]), (v) => (w.colorblind = v)), t('set.cbHint')),
        settingRow(t('set.netDiag'), check('netDiag')),
      );
    }
    this.root.replaceChildren(
      tabs((['video', 'audio', 'controls', 'ui'] as Cat[]).map((c) => ({ id: c, label: t(`set.cat.${c}`) })), this.cat, (id) => {
        this.cat = id as Cat;
        this.render();
      }),
      body,
      h('footer', { class: 'pf-set-foot' }),
    );
    this.renderFooter();
  }

  private renderFooter() {
    const f = this.root.querySelector('.pf-set-foot') as HTMLElement;
    const dirty = this.dirty;
    f.replaceChildren(
      h('span', { class: `pf-dim${this.note ? ' pf-warn' : ''}` }, this.note || (dirty ? t('set.unsaved') : '')),
      button(t('common.reset'), () => {
        const keep = { quality: this.work.quality, qualityChosen: this.work.qualityChosen, lang: this.work.lang };
        this.work = { ...structuredClone(DEFAULT_SETTINGS), ...keep };
        this.note = '';
        this.render();
      }, 'pf-btn'),
      button(t('common.cancel'), () => {
        this.work = structuredClone(this.current());
        this.note = '';
        this.render();
        this.onClose?.();
      }, 'pf-btn'),
      button(t('common.apply'), () => {
        const reload = this.work.quality !== this.current().quality;
        if (this.work.lang && this.work.lang !== lang()) setLang(this.work.lang);
        this.apply(structuredClone(this.work), reload);
        this.note = t('set.applied');
        this.render();
      }, 'pf-btn primary', { disabled: !dirty }),
    );
  }
}

/** Přehled ovládání (jen pro čtení; přemapování je v Nastavení → Ovládání). */
export function controlsView(s: Settings) {
  const b = bindingsOf(s);
  return h('div', { class: 'pf-controls' },
    h('table', { class: 'pf-table' }, h('tbody', {},
      ...(Object.keys(DEFAULT_BINDINGS) as Action[]).map((a) => h('tr', {}, h('td', {}, t(ACTION_KEY[a])), h('td', { class: 'num' }, h('span', { class: 'pf-key static' }, b[a].map(keyLabel).join(', '))))),
      ...UI_KEYS.map(([k, key]) => h('tr', {}, h('td', {}, t(k)), h('td', { class: 'num' }, h('span', { class: 'pf-key static' }, key)))),
    )),
    h('p', { class: 'pf-dim' }, t('set.layoutNote')),
  );
}
