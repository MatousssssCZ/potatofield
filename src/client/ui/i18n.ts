import { STRINGS, type StringKey } from './strings';

/**
 * Lokalizace herního UI (čeština a angličtina). Všechny texty jdou přes klíče; parametry
 * `{name}` se doplní z objektu. Uživatelský text (jména, chat) se nikdy neskládá jako HTML.
 */
export type Lang = 'cs' | 'en';

let current: Lang = (() => {
  try {
    const v = localStorage.getItem('pf.lang');
    if (v === 'cs' || v === 'en') return v;
  } catch {
    /* bez úložiště */
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('cs') ? 'cs' : typeof navigator === 'undefined' ? 'cs' : 'en';
})();
const listeners = new Set<() => void>();

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem('pf.lang', l);
  } catch {
    /* ignorovat */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  for (const f of listeners) f();
}

export function onLang(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let s: string = STRINGS[current][key] ?? STRINGS.cs[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Statické texty v DOM: atribut data-i18n (textContent) a data-i18n-title. */
export function applyStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n as StringKey)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((e) => (e.title = t(e.dataset.i18nTitle as StringKey)));
}

export type { StringKey };

/** Přeložený kód chyby; neznámý kód se zobrazí doslovně (např. důvod odpojení ze serveru). */
export function tErr(code: string): string {
  const k = `err.${code}` as StringKey;
  return k in STRINGS.cs ? t(k) : code;
}

export function hasKey(k: string): k is StringKey {
  return k in STRINGS.cs;
}
