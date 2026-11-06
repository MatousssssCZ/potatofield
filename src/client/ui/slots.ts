import type { InvView } from '../../shared/sim/inventory';
import { SIDEARMS, arsenalEntry } from '../../shared/config/arsenal';
import { t, type StringKey } from './i18n';
import { h } from './kit';
import { drawSilhouette } from './silhouette';

/**
 * Overlay výbavy (BF2: krátký utilitární seznam): vpravo nad muničním panelem, zobrazí se při
 * volbě a ~1,5 s po poslední volbě zmizí. Řádek = klávesa slotu, silueta, název, skutečný počet
 * (zbraně náboje/rezerva, granáty kusy, nůž a nástroje bez čísla). Požadovaná položka je
 * vyznačená zvlášť, dokud server přechod nepotvrdí; při odmítnutí se vrátí ke skutečnosti.
 */
export class SlotOverlay {
  readonly root = h('div', { class: 'h-slots hidden', 'aria-live': 'polite' });
  private until = 0;
  private requested: number | null = null;
  private requestedAt = 0;
  private key = '';
  private sils = new Map<string, HTMLCanvasElement>();
  /** Popisek klávesy slotu (respektuje přemapování). */
  bindLabel: (slot: number) => string = (s) => String(s);

  request(slot: number | null, now: number) {
    this.until = now + 1.5;
    this.requested = slot;
    this.requestedAt = now;
  }

  update(inv: InvView | null | undefined, now: number) {
    if (!inv || now > this.until) {
      this.root.classList.add('hidden');
      return;
    }
    // Server přechod potvrdil, nebo ho do 0,6 s neprovedl → zobrazit skutečný stav.
    if (this.requested !== null && (this.requested === inv.active || now - this.requestedAt > 0.6)) this.requested = null;
    this.root.classList.remove('hidden');
    const key = JSON.stringify(inv) + `|${this.requested}`;
    if (key === this.key) return;
    this.key = key;
    this.root.replaceChildren(...inv.items.map((it) => {
      const name = it.kind === 'primary' ? (arsenalEntry(it.id)?.name ?? it.id) : it.kind === 'pistol' ? (SIDEARMS[it.id]?.name ?? it.id) : t(`item.${it.kind}` as StringKey);
      const spent = it.max !== undefined && it.mag <= 0;
      const count = it.kind === 'primary' || it.kind === 'pistol' ? `${it.mag} / ${it.reserve}` : it.max !== undefined ? (spent ? t('slot.spent') : `× ${it.mag}`) : '';
      const cls = `h-slot${it.slot === inv.active ? ' on' : ''}${it.slot === this.requested ? ' req' : ''}${spent ? ' spent' : ''}`;
      return h('div', { class: cls }, h('span', { class: 'h-slot-key' }, this.bindLabel(it.slot)), this.sil(it.id), h('span', { class: 'h-slot-name' }, name), h('span', { class: 'h-slot-count tnum' }, count));
    }));
  }

  private sil(id: string) {
    let c = this.sils.get(id);
    if (!c) {
      c = h('canvas', { class: 'h-slot-sil' }) as HTMLCanvasElement;
      if (!drawSilhouette(c, id, 84, 26)) c.classList.add('none');
      this.sils.set(id, c);
    }
    return c;
  }
}
