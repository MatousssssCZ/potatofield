import { t } from './i18n';
import { button, dialog, h } from './kit';

/**
 * Pauza (Esc): Pokračovat / Nasazení / Četa / Velitel / Nastavení / Ovládání / Odpojit.
 * Online se hra nepozastaví – obrazovka to říká. Odpojení vyžaduje potvrzení.
 */
export interface PauseHooks {
  resume(): void;
  deploy(): void;
  leave(): void;
  settings(): HTMLElement;
  controls(): HTMLElement;
  /** Doplňkové sekce (četa, velitel) – jen v síťové hře. */
  extra: Array<{ id: string; label: string; view: () => HTMLElement }>;
  network: boolean;
  mapName: string;
}

export class PauseMenu {
  readonly root = h('div', { id: 'pf-pause', class: 'pf-screen pf-pause hidden', role: 'dialog', 'aria-modal': 'true' });
  private section: string | null = null;
  private timer = 0;

  constructor(private hooks: PauseHooks) {
    document.body.append(this.root);
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  show(v: boolean, section: string | null = null) {
    this.root.classList.toggle('hidden', !v);
    this.section = section;
    clearInterval(this.timer);
    if (v) {
      this.render();
      // Sekce s živými daty (četa, velitel) se obnovují.
      this.timer = window.setInterval(() => {
        if (this.section && this.hooks.extra.some((x) => x.id === this.section) && !this.root.contains(document.activeElement as Node | null)) this.renderBody();
        else if (this.section && this.hooks.extra.some((x) => x.id === this.section)) this.renderBody();
      }, 500);
    }
  }

  private body = h('div', { class: 'pf-pause-body' });

  private render() {
    const k = this.hooks;
    const item = (id: string | null, label: string, fn?: () => void) => button(label, fn ?? (() => {
      this.section = id;
      this.render();
    }), `pf-nav-item${this.section === id && id ? ' on' : ''}`);
    const nav = h('nav', { class: 'pf-nav' },
      button(t('pause.resume'), () => k.resume(), 'pf-nav-item primary'),
      button(t('pause.deploy'), () => k.deploy(), 'pf-nav-item'),
      ...k.extra.map((x) => item(x.id, x.label)),
      item('settings', t('pause.settings')),
      item('controls', t('pause.controls')),
      h('div', { class: 'pf-nav-sep' }),
      button(k.network ? t('pause.disconnect') : t('pause.leave'), () => void this.confirmLeave(), 'pf-nav-item danger'),
    );
    this.root.replaceChildren(
      h('div', { class: 'pf-pause-panel' },
        h('header', {}, h('h2', {}, t('pause.title')), h('span', { class: 'pf-dim' }, k.mapName), k.network ? h('p', { class: 'pf-warn' }, t('pause.online')) : null),
        h('div', { class: 'pf-pause-cols' }, nav, this.body),
      ),
    );
    this.renderBody();
    (nav.firstElementChild as HTMLElement | null)?.focus();
  }

  private renderBody() {
    const k = this.hooks;
    const x = k.extra.find((e) => e.id === this.section);
    if (x) this.body.replaceChildren(x.view());
    else if (this.section === 'settings') this.body.replaceChildren(k.settings());
    else if (this.section === 'controls') this.body.replaceChildren(k.controls());
    else this.body.replaceChildren(h('p', { class: 'pf-dim' }, t('hud.lockHint')));
  }

  private async confirmLeave() {
    const ch = await dialog(this.hooks.network ? t('pause.disconnect') : t('pause.leave'), this.hooks.network ? t('pause.confirmLeave') : t('pause.confirmTraining'), [
      { id: 'no', label: t('common.cancel') },
      { id: 'yes', label: this.hooks.network ? t('pause.disconnect') : t('pause.leave'), danger: true, primary: true },
    ]);
    if (ch === 'yes') this.hooks.leave();
  }

  dispose() {
    clearInterval(this.timer);
    this.root.remove();
  }
}
