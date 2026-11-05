import { PROTOCOL_VERSION } from '../../shared/net/protocol';
import { applyStatic, lang, onLang, setLang, t, type Lang, tErr } from './i18n';
import { button, dialog, h, table, type Column } from './kit';
import { compatible, defaultAddress, fetchInfo, full, loadAddresses, recommend, saveAddresses, type ServerEntry } from './servers';

/**
 * Hlavní menu: horní pruh (název, PILOT, přezdívka, jazyk, stav), levá navigace, hlavní plocha
 * (Hrát / Servery / Nastavení / Ovládání / O hře) a spodní pruh (verze, stav). Statické pozadí
 * z kompozice a mřížky – žádná druhá 3D scéna. Připojení ukazuje skutečné fáze a chyby.
 */
export type Section = 'play' | 'servers' | 'settings' | 'controls' | 'about';
export type Phase = 'connecting' | 'auth' | 'loading' | 'ready';

export interface MenuHooks {
  /** Připojí se; volá onPhase; vrací null (úspěch) nebo kód chyby. */
  connect(address: string, name: string, onPhase: (p: Phase) => void, signal: AbortSignal): Promise<string | null>;
  openEditor(): void;
  training(): void;
  settingsView(): HTMLElement;
  controlsView(): HTMLElement;
  /** Náhled s ukázkovými daty (nikdy nepoužije produkční připojení). */
  preview?: boolean;
}

export const VERSION = '0.9-pilot';

export class MainMenu {
  readonly root: HTMLElement;
  private section: Section = 'play';
  private main: HTMLElement;
  private nav: HTMLElement;
  private status: HTMLElement;
  private entries: ServerEntry[] = [];
  private selected: string | null = null;
  private sort: { key: string; dir: 1 | -1 } = { key: 'ping', dir: 1 };
  private filters = { free: false, compatible: true };
  private loading = false;
  private unLang: () => void;
  name: string;

  constructor(private hooks: MenuHooks) {
    this.name = (() => {
      try {
        return localStorage.getItem('pf.name') || 'Vojín';
      } catch {
        return 'Vojín';
      }
    })();
    this.root = h('div', { id: 'pf-menu', class: 'pf-screen pf-menu' });
    this.nav = h('nav', { class: 'pf-nav', 'aria-label': 'menu' });
    this.main = h('main', { class: 'pf-menu-main' });
    this.status = h('span', { class: 'pf-dim' });
    document.body.append(this.root);
    this.unLang = onLang(() => this.render());
    this.render();
    void this.refresh();
  }

  dispose() {
    this.unLang();
    this.root.remove();
  }

  show(section: Section = this.section) {
    this.section = section;
    this.root.classList.remove('hidden');
    this.render();
    if (section === 'play' || section === 'servers') void this.refresh();
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  private render() {
    const nameIn = h('input', { class: 'pf-input', value: this.name, maxlength: '24', 'aria-label': t('menu.nick'), onchange: (e: Event) => {
      this.name = (e.target as HTMLInputElement).value.trim().slice(0, 24) || 'Vojín';
      try {
        localStorage.setItem('pf.name', this.name);
      } catch {
        /* ignorovat */
      }
    } });
    const langSel = h('select', { class: 'pf-select', 'aria-label': t('menu.lang'), onchange: (e: Event) => setLang((e.target as HTMLSelectElement).value as Lang) }, h('option', { value: 'cs' }, 'Čeština'), h('option', { value: 'en' }, 'English'));
    langSel.value = lang();
    const top = h('header', { class: 'pf-topbar' },
      h('div', { class: 'pf-brand' }, 'POTATOFIELD', h('span', { class: 'pf-badge' }, 'PILOT')),
      h('div', { class: 'pf-top-right' }, h('label', { class: 'pf-inline' }, t('menu.nick'), nameIn), h('label', { class: 'pf-inline' }, t('menu.lang'), langSel), this.status),
    );
    this.nav.replaceChildren(...(['play', 'servers', 'settings', 'controls', 'about'] as Section[]).map((s) => button(t(`nav.${s}` as never), () => this.show(s), `pf-nav-item${s === this.section ? ' on' : ''}`, { 'aria-current': s === this.section ? 'page' : undefined })), h('div', { class: 'pf-nav-sep' }), button(t('nav.editor'), () => this.hooks.openEditor(), 'pf-nav-item'));
    this.main.replaceChildren(this.sectionView());
    const bottom = h('footer', { class: 'pf-bottombar' }, h('span', {}, `Potatofield ${VERSION} · ${t('menu.protocol', { v: PROTOCOL_VERSION })}`), h('span', { class: 'pf-dim' }, this.hooks.preview ? t('preview.badge') : t('menu.noFakeStats')));
    this.root.replaceChildren(h('div', { class: 'pf-menu-bg', 'aria-hidden': 'true' }), top, h('div', { class: 'pf-menu-body' }, this.nav, this.main), bottom);
    this.status.textContent = this.loading ? t('servers.loading') : '';
    applyStatic(this.root);
  }

  private sectionView(): HTMLElement {
    switch (this.section) {
      case 'play':
        return this.playView();
      case 'servers':
        return this.serversView();
      case 'settings':
        return h('section', { class: 'pf-panel pf-wide' }, h('h2', {}, t('nav.settings')), this.hooks.settingsView());
      case 'controls':
        return h('section', { class: 'pf-panel pf-wide' }, h('h2', {}, t('nav.controls')), this.hooks.controlsView());
      default:
        return h('section', { class: 'pf-panel pf-wide pf-about' }, h('h2', {}, t('nav.about')), h('p', {}, t('about.p1')), h('p', {}, t('about.p2')), h('p', {}, t('about.p3')));
    }
  }

  /** Hrát: doporučený kompatibilní server s volným místem a jedno dominantní tlačítko. */
  private playView() {
    const rec = recommend(this.entries);
    const panel = h('section', { class: 'pf-panel pf-server-card' });
    panel.append(h('h2', {}, t('play.title')));
    if (this.loading && !rec) panel.append(h('p', { class: 'pf-dim' }, t('servers.loading')));
    else if (rec?.info) {
      const i = rec.info;
      panel.append(
        h('div', { class: 'pf-kv' },
          h('span', {}, t('col.server')), h('b', {}, i.name),
          h('span', {}, t('col.map')), h('b', {}, i.map),
          h('span', {}, t('col.mode')), h('b', {}, i.mode === 'conquest' ? 'Conquest' : t('mode.free')),
          h('span', {}, t('col.players')), h('b', { class: 'tnum' }, `${i.players} / ${i.capacity}`),
          h('span', {}, t('col.ping')), h('b', { class: 'tnum' }, rec.ping === null ? '—' : `${rec.ping} ms`),
          h('span', {}, t('col.ff')), h('b', {}, i.friendlyFire ? t('common.on') : t('common.off')),
        ),
        button(t('play.join'), () => void this.connect(rec.address), 'pf-btn primary big'),
      );
    } else {
      // Bez dostupného serveru: srozumitelný stav, adresa a opakování (žádný falešný server).
      const addr = h('input', { class: 'pf-input', value: this.entries[0]?.address ?? defaultAddress(), 'aria-label': t('servers.address') });
      panel.append(
        h('p', {}, t('play.none')),
        h('p', { class: 'pf-dim' }, t('play.noneHint')),
        h('div', { class: 'pf-row-inline' }, addr, button(t('servers.connect'), () => void this.connect(addr.value.trim()), 'pf-btn primary'), button(t('servers.retry'), () => void this.refresh(), 'pf-btn')),
      );
    }
    panel.append(h('div', { class: 'pf-row-inline pf-secondary' }, button(t('play.training'), () => this.hooks.training(), 'pf-btn'), button(t('nav.servers'), () => this.show('servers'), 'pf-btn')));
    return panel;
  }

  private serversView() {
    const list = this.entries.filter((e) => (!this.filters.free || !full(e)) && (!this.filters.compatible || e.state !== 'ok' || compatible(e)));
    const cols: Column<ServerEntry>[] = [
      { key: 'name', label: t('col.server'), value: (e) => e.info?.name ?? e.address, render: (e) => h('span', {}, e.info?.name ?? e.address, e.state === 'error' ? h('small', { class: 'pf-warn' }, ` ${t(`err.${e.error === 'timeout' ? 'timeout' : 'unreachable'}`)}`) : null, e.state === 'ok' && !compatible(e) ? h('small', { class: 'pf-warn' }, ` ${t('servers.incompatible')}`) : null) },
      { key: 'map', label: t('col.map'), value: (e) => e.info?.map ?? null },
      { key: 'mode', label: t('col.mode'), value: (e) => (e.info ? (e.info.mode === 'conquest' ? 'Conquest' : t('mode.free')) : null) },
      { key: 'players', label: t('col.players'), num: true, value: (e) => (e.info ? e.info.players : null), render: (e) => (e.info ? `${e.info.players} / ${e.info.capacity}${full(e) ? ` · ${t('servers.full')}` : ''}` : '—') },
      { key: 'ping', label: t('col.ping'), num: true, value: (e) => e.ping, render: (e) => (e.ping === null ? '—' : `${e.ping} ms`) },
      { key: 'ff', label: t('col.ff'), value: (e) => (e.info ? (e.info.friendlyFire ? t('common.on') : t('common.off')) : null) },
    ];
    const tb = table(cols, list, {
      sort: this.sort,
      onSort: (k) => {
        this.sort = { key: k, dir: this.sort.key === k ? ((-this.sort.dir) as 1 | -1) : 1 };
        this.render();
      },
      selected: (e) => e.address === this.selected,
      onSelect: (e) => {
        this.selected = e.address;
        this.render();
      },
      empty: this.loading ? t('servers.loading') : t('servers.empty'),
    });
    const chk = (k: 'free' | 'compatible', label: string) =>
      h('label', { class: 'pf-check' }, h('input', { type: 'checkbox', checked: this.filters[k], onchange: (e: Event) => {
        this.filters[k] = (e.target as HTMLInputElement).checked;
        this.render();
      } }), label);
    const addr = h('input', { class: 'pf-input', placeholder: 'ws://adresa:8787', 'aria-label': t('servers.address') });
    const sel = this.entries.find((e) => e.address === this.selected);
    const detail = h('div', { class: 'pf-detail' });
    if (sel) {
      const i = sel.info;
      detail.append(
        h('h3', {}, i?.name ?? sel.address),
        i
          ? h('div', { class: 'pf-kv' },
              h('span', {}, t('col.map')), h('b', {}, i.map),
              h('span', {}, t('detail.rules')), h('b', {}, `${i.pilot ? 'PILOT · ' : ''}${i.teamSize} × ${i.teamSize} · ${t('col.ff')} ${i.friendlyFire ? t('common.on') : t('common.off')}`),
              h('span', {}, t('detail.factions')), h('b', {}, `${i.factions.teamA.toUpperCase()} × ${i.factions.teamB.toUpperCase()}`),
              h('span', {}, t('detail.kits')), h('b', {}, i.kits.join(', ')),
              h('span', {}, t('detail.version')), h('b', {}, `${t('menu.protocol', { v: i.protocol })}${compatible(sel) ? '' : ` – ${t('servers.incompatible')}`}`),
              h('span', {}, t('servers.address')), h('b', {}, sel.address),
            )
          : h('p', { class: 'pf-warn' }, t(sel.error === 'timeout' ? 'err.timeout' : 'err.unreachable')),
        h('div', { class: 'pf-row-inline' },
          button(t('servers.connect'), () => void this.connect(sel.address), 'pf-btn primary', { disabled: sel.state === 'ok' && (!compatible(sel) || full(sel)) }),
          button(t('servers.remove'), () => {
            saveAddresses(loadAddresses().filter((a) => a !== sel.address));
            this.entries = this.entries.filter((e) => e !== sel);
            this.selected = null;
            this.render();
          }, 'pf-btn'),
        ),
      );
    } else detail.append(h('p', { class: 'pf-dim' }, t('servers.pick')));
    return h('section', { class: 'pf-panel pf-wide' },
      h('div', { class: 'pf-toolbar' }, h('h2', {}, t('nav.servers')), chk('free', t('servers.filterFree')), chk('compatible', t('servers.filterCompat')), button(t('servers.refresh'), () => void this.refresh(), 'pf-btn')),
      h('div', { class: 'pf-servers' }, h('div', {}, h('div', { class: 'pf-table-wrap' }, tb),
      h('div', { class: 'pf-row-inline' }, addr,
        button(t('servers.add'), () => {
          const a = addr.value.trim();
          if (!a) return;
          saveAddresses([...loadAddresses(), a]);
          void this.refresh();
        }, 'pf-btn'),
        button(t('servers.direct'), () => void this.connect(addr.value.trim()), 'pf-btn primary'))),
      detail),
    );
  }

  async refresh() {
    if (this.hooks.preview) return;
    this.loading = true;
    const addrs = loadAddresses();
    this.entries = addrs.map((a) => this.entries.find((e) => e.address === a) ?? { address: a, state: 'loading', ping: null });
    this.render();
    this.entries = await Promise.all(addrs.map((a) => fetchInfo(a)));
    this.loading = false;
    this.render();
  }

  /** Data pro náhled (jasně označená, nikdy produkční připojení). */
  setPreviewEntries(list: ServerEntry[]) {
    this.entries = list;
    this.selected = list[0]?.address ?? null;
    this.render();
  }

  /** Připojení s fázemi Připojování → Ověřování → Načítání mapy → Připraveno; Zrušit ukončí pokus. */
  async connect(address: string) {
    if (!address) return;
    saveAddresses([address, ...loadAddresses()]);
    const ctl = new AbortController();
    const phases: Phase[] = ['connecting', 'auth', 'loading', 'ready'];
    const list = h('ol', { class: 'pf-phases' }, ...phases.map((p) => h('li', { dataset: { p } }, t(`phase.${p}` as never))));
    const msg = h('p', { class: 'pf-dim' }, address);
    const cancel = button(t('common.cancel'), () => ctl.abort(), 'pf-btn');
    const overlay = h('div', { class: 'pf-dialog-wrap', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'pf-dialog' }, h('h3', {}, t('connect.title')), list, msg, h('div', { class: 'pf-dialog-buttons' }, cancel)));
    document.body.append(overlay);
    cancel.focus();
    const onPhase = (p: Phase) => list.querySelectorAll('li').forEach((li) => {
      const i = phases.indexOf(li.dataset.p as Phase), k = phases.indexOf(p);
      li.className = i < k ? 'done' : i === k ? 'now' : '';
    });
    onPhase('connecting');
    const err = await this.hooks.connect(address, this.name, onPhase, ctl.signal);
    overlay.remove();
    if (!err) return this.hide();
    if (err === 'cancelled') return;
    const ch = await dialog(t('connect.failed'), tErr(err), [
      { id: 'back', label: t('common.back') },
      { id: 'retry', label: t('servers.retry'), primary: true },
    ]);
    if (ch === 'retry') void this.connect(address);
  }
}
