import { describe, expect, it } from 'vitest';
import { DEFAULT_BUS_VOLUME, SOUND_BUSES } from '../src/client/runtime/audio';
import { loadSettings } from '../src/client/ui/settings';

describe('Hlasitost podle druhu zvuku', () => {
  const withStore = (v: unknown, fn: () => void) => {
    const g = globalThis as { localStorage?: unknown };
    const old = g.localStorage;
    g.localStorage = { getItem: () => (v === null ? null : JSON.stringify(v)), setItem: () => {} };
    try {
      fn();
    } finally {
      g.localStorage = old;
    }
  };

  it('starší uložené nastavení bez skupin dostane výchozích 100 %', () => {
    withStore({ version: 1, volume: 0.4 }, () => {
      const s = loadSettings();
      expect(s.volume).toBe(0.4);
      expect(s.sound).toEqual(DEFAULT_BUS_VOLUME);
    });
  });

  it('uložená skupina se zachová, chybějící se doplní', () => {
    withStore({ version: 2, sound: { shots: 0.3 } }, () => {
      const s = loadSettings();
      expect(s.sound.shots).toBe(0.3);
      for (const b of SOUND_BUSES) if (b !== 'shots') expect(s.sound[b]).toBe(1);
    });
  });
});
