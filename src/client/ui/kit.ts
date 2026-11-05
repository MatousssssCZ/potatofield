import { t, type StringKey } from './i18n';

/**
 * Sdílené stavební prvky herního UI (jedna sada pro menu, nasazení, HUD a dialogy):
 * element, tlačítko, záložky, tabulka s řazením, dialog s fokusem, řádek nastavení, legenda.
 * Texty se vkládají přes textContent – nikdy jako HTML.
 */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export function button(label: string, onClick: () => void, cls = 'pf-btn', attrs: Record<string, unknown> = {}) {
  return h('button', { class: cls, type: 'button', onclick: onClick, ...attrs }, label);
}

/** Záložky: vrací kontejner a funkci pro přepnutí. */
export function tabs(items: Array<{ id: string; label: string; disabled?: boolean; title?: string }>, active: string, onChange: (id: string) => void) {
  const bar = h('div', { class: 'pf-tabs', role: 'tablist' });
  for (const it of items) {
    const b = h('button', { class: `pf-tab${it.id === active ? ' on' : ''}`, role: 'tab', 'aria-selected': it.id === active ? 'true' : 'false', disabled: it.disabled, title: it.title, type: 'button' }, it.label);
    b.addEventListener('click', () => onChange(it.id));
    bar.append(b);
  }
  return bar;
}

export interface Column<T> {
  key: string;
  label: string;
  value: (r: T) => string | number | null;
  /** Číselný sloupec (zarovnání vpravo, tabulkové číslice). */
  num?: boolean;
  render?: (r: T) => Node | string;
  sortable?: boolean;
}

/** Tabulka s řazením kliknutím na hlavičku; výběr řádku myší i klávesnicí (Enter). */
export function table<T>(cols: Column<T>[], rows: T[], opts: { sort?: { key: string; dir: 1 | -1 }; onSort?: (key: string) => void; selected?: (r: T) => boolean; onSelect?: (r: T) => void; mine?: (r: T) => boolean; empty?: string } = {}) {
  const tb = h('table', { class: 'pf-table' });
  const head = h('tr');
  for (const c of cols) {
    const s = opts.sort?.key === c.key ? (opts.sort.dir > 0 ? ' ▲' : ' ▼') : '';
    const th = h('th', { class: c.num ? 'num' : '', scope: 'col' }, c.label + s);
    if (c.sortable !== false && opts.onSort) {
      th.tabIndex = 0;
      th.classList.add('sort');
      th.addEventListener('click', () => opts.onSort!(c.key));
      th.addEventListener('keydown', (e) => e.key === 'Enter' && opts.onSort!(c.key));
    }
    head.append(th);
  }
  tb.append(h('thead', {}, head));
  const body = h('tbody');
  let list = [...rows];
  if (opts.sort) {
    const c = cols.find((x) => x.key === opts.sort!.key);
    if (c) list.sort((a, b) => {
      const va = c.value(a), vb = c.value(b);
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * opts.sort!.dir;
    });
  }
  if (!list.length) body.append(h('tr', { class: 'empty' }, h('td', { colspan: String(cols.length) }, opts.empty ?? '')));
  for (const r of list) {
    const tr = h('tr', { class: `${opts.selected?.(r) ? 'sel' : ''}${opts.mine?.(r) ? ' mine' : ''}` });
    for (const c of cols) {
      const v = c.render ? c.render(r) : c.value(r);
      tr.append(h('td', { class: c.num ? 'num' : '' }, v === null ? '—' : typeof v === 'object' ? v : String(v)));
    }
    if (opts.onSelect) {
      tr.tabIndex = 0;
      tr.addEventListener('click', () => opts.onSelect!(r));
      tr.addEventListener('keydown', (e) => e.key === 'Enter' && opts.onSelect!(r));
    }
    body.append(tr);
  }
  tb.append(body);
  list = [];
  return tb;
}

/** Modální dialog s fokusem uvnitř; Esc = zrušit. Vrací id stisknutého tlačítka (null = zrušeno). */
export function dialog(title: string, body: Node | string, buttons: Array<{ id: string; label: string; primary?: boolean; danger?: boolean }>): Promise<string | null> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const box = h('div', { class: 'pf-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const wrap = h('div', { class: 'pf-dialog-wrap' }, box);
    const close = (v: string | null) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close(null);
      } else if (e.key === 'Tab') {
        const f = [...box.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length;
        f[n].focus();
        e.preventDefault();
      }
    };
    box.append(h('h3', {}, title), h('div', { class: 'pf-dialog-body' }, body));
    const row = h('div', { class: 'pf-dialog-buttons' });
    for (const b of buttons) row.append(button(b.label, () => close(b.id), `pf-btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`));
    box.append(row);
    document.body.append(wrap);
    document.addEventListener('keydown', onKey, true);
    (row.querySelector('.primary') as HTMLElement | null ?? row.querySelector('button') as HTMLElement | null)?.focus();
  });
}

/** Řádek nastavení: popisek vlevo, ovladač vpravo, volitelná nápověda. */
export function settingRow(label: string, control: Node, hint?: string) {
  return h('div', { class: 'pf-row' }, h('label', { class: 'pf-row-label' }, label, hint ? h('small', {}, hint) : null), h('div', { class: 'pf-row-ctl' }, control));
}

export function legend(items: Array<{ symbol: string; cls: string; label: string }>) {
  return h('div', { class: 'pf-legend' }, ...items.map((i) => h('span', { class: 'pf-legend-item' }, h('i', { class: i.cls }, i.symbol), i.label)));
}

export function tl(key: StringKey, vars?: Record<string, string | number>) {
  return t(key, vars);
}

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
