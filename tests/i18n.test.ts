import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/client/ui/strings';

/** Úplnost lokalizace: obě řeči mají stejné klíče, žádný prázdný text, kód nepoužívá neznámý klíč. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}

describe('lokalizace cs/en', () => {
  it('angličtina má všechny klíče češtiny a naopak, bez prázdných textů', () => {
    const cs = Object.keys(STRINGS.cs).sort(), en = Object.keys(STRINGS.en).sort();
    expect(en).toEqual(cs);
    for (const l of ['cs', 'en'] as const) for (const [k, v] of Object.entries(STRINGS[l])) expect(v.trim(), `${l}:${k}`).not.toBe('');
  });

  it('parametry {x} se v obou řečích shodují', () => {
    for (const k of Object.keys(STRINGS.cs) as Array<keyof typeof STRINGS.cs>) {
      const p = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(p(STRINGS.en[k]), k).toEqual(p(STRINGS.cs[k]));
    }
  });

  it('každý doslovný klíč t(...) v klientu existuje', () => {
    const missing: string[] = [];
    for (const f of sources('src/client')) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes("from './i18n'") && !src.includes("from '../ui/i18n'")) continue;
      for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) if (!(m[1] in STRINGS.cs)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('složené klíče (classy, postoje, kategorie, fáze, chyby) existují', () => {
    const need = [
      ...['assault', 'medic', 'support', 'sniper', 'engineer'].flatMap((k) => [`kit.${k}.role`, `kit.${k}.note`]),
      ...['stand', 'crouch', 'prone'].map((s) => `stance.${s}`),
      ...['video', 'audio', 'controls', 'ui'].map((c) => `set.cat.${c}`),
      ...['connecting', 'auth', 'loading', 'ready'].map((p) => `phase.${p}`),
      ...['timeout', 'unreachable', 'address', 'full', 'version', 'closed', 'map'].map((e) => `err.${e}`),
      ...['play', 'servers', 'settings', 'controls', 'about'].map((n) => `nav.${n}`),
      ...['attack', 'defend', 'move'].map((o) => `cmd.${o}`),
      ...['low', 'standard', 'high'].map((q) => `set.quality.${q}`),
      ...['none', 'deutan', 'protan', 'tritan'].map((c) => `set.cb.${c}`),
    ];
    for (const k of need) expect(k in STRINGS.cs, k).toBe(true);
  });
});
