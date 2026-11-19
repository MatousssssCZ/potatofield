import type { ControlPoint, ControlPointOverride, Scenario, SpawnPoint, Team, TeamOwner, Zone } from '../../shared/map/schema';
import type { BrushKind } from '../../world/terrain';
import { cmds, type EditorDoc, type History } from './editorDoc';
import type { Editor, PlantBrush } from './editor';
import { markerId } from './markers';

/** UI herních markerů, scénářů a terénních štětců. */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};
const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10;
const rad = (d: number) => (d * Math.PI) / 180;
const OWNER_LABEL: Record<TeamOwner, string> = { teamA: 'Tým A', teamB: 'Tým B', neutral: 'Neutrální' };

function row(root: HTMLElement, label: string, sub: string | undefined, control: HTMLElement) {
  const p = el('div', { class: 'prop' });
  const l = el('span', { class: 'lbl' }, label);
  if (sub) l.appendChild(el('small', {}, sub));
  p.append(l, control);
  root.appendChild(p);
}
function num(v: number, min: number, max: number, step: number, commit: (v: number) => void) {
  const i = el('input', { type: 'number', min: String(min), max: String(max), step: String(step), title: `${min}–${max}` }) as HTMLInputElement;
  i.value = String(Math.round(v * 1000) / 1000);
  i.addEventListener('change', () => {
    const x = Number(i.value);
    if (!Number.isFinite(x) || x < min || x > max) {
      i.classList.add('bad');
      return;
    }
    i.classList.remove('bad');
    commit(x);
  });
  return i;
}
function chk(v: boolean, commit: (v: boolean) => void) {
  const c = el('input', { type: 'checkbox' }) as HTMLInputElement;
  c.checked = v;
  c.addEventListener('change', () => commit(c.checked));
  return c;
}
function sel(options: Array<[string, string]>, v: string, commit: (v: string) => void) {
  const s = el('select') as HTMLSelectElement;
  for (const [val, lab] of options) s.appendChild(el('option', { value: val }, lab));
  s.value = v;
  s.addEventListener('change', () => commit(s.value));
  return s;
}
function vec(v: [number, number, number], commit: (i: number, x: number) => void) {
  const d = el('div', { class: 'vec' });
  v.forEach((x, i) => d.appendChild(num(x, -5000, 5000, 0.25, (nv) => commit(i, nv))));
  return d;
}

export interface GameUiState {
  /** Upravovaný scénář (null = základ mapy). */
  scenario: string | null;
}

/** Vložení markeru do středu pohledu. */
export function insertMarker(ed: EditorDoc, history: History, editor: Editor, kind: 'flag' | 'spawnA' | 'spawnB' | 'zone' | 'boundary', at: [number, number, number]) {
  const p: [number, number, number] = [Math.round(at[0] * 2) / 2, Math.round(at[1] * 100) / 100, Math.round(at[2] * 2) / 2];
  if (kind === 'flag') {
    const cp: ControlPoint = {
      id: ed.newId('cp'),
      name: `Bod ${String.fromCharCode(65 + ed.doc.controlPoints.length)}`,
      position: p,
      radius: 10,
      height: 4,
      defaultOwner: 'neutral',
      capturable: true,
      spawnEnabled: true,
      countsForBleed: true,
    };
    history.execute(cmds.addEntity('controlPoints', cp, 'Vložit vlajku'));
    editor.select([markerId.cp(cp.id)]);
  } else if (kind === 'zone' || kind === 'boundary') {
    const r = kind === 'zone' ? 10 : 60;
    insertZoneRect(ed, history, editor, kind === 'zone' ? 'forbidden' : 'boundary', [p[0] - r, p[2] - r], [p[0] + r, p[2] + r]);
  } else {
    const team: Team = kind === 'spawnA' ? 'teamA' : 'teamB';
    // Přiřadit k nejbližšímu bodu do 40 m (lze změnit v inspektoru).
    let best: ControlPoint | undefined, bd = 40;
    for (const c of ed.doc.controlPoints) {
      const d = Math.hypot(c.position[0] - p[0], c.position[2] - p[2]);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    const sp: SpawnPoint = { id: ed.newId('spawn'), position: p, yaw: 0, teams: [team], ...(best ? { controlPointId: best.id } : {}) };
    history.execute(cmds.addEntity('spawnPoints', sp, 'Vložit spawn'));
    editor.select([markerId.sp(sp.id)]);
  }
}

/** Výška terénu pod obdélníkem zóny (min / max ze vzorků mřížky ~5 m). */
function groundSpan(editor: Editor, cx: number, cz: number, hx: number, hz: number, yaw: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  const n = Math.min(24, Math.max(2, Math.ceil((Math.max(hx, hz) * 2) / 5)));
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const lx = -hx + (2 * hx * i) / n, lz = -hz + (2 * hz * j) / n;
      const y = editor.groundY(cx + c * lx + sn * lz, cz - sn * lx + c * lz);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  return [lo, hi];
}

/** Výchozí výška zóny nad terénem: zakázaná 30 m, hranice 80 m (s rezervou pod terén). */
const ZONE_TOP = { forbidden: 30, boundary: 80 } as const;
const ZONE_BELOW = 3;

/** Komu má nová zakázaná zóna vadit: nepříteli nejbližší základny (spawn bez bodu nebo vlastněný nedobyvatelný bod). */
export function zoneTeamsAt(ed: EditorDoc, x: number, z: number): Team[] {
  let best: Team | null = null, bd = Infinity;
  const consider = (t: Team, p: [number, number, number]) => {
    const d = Math.hypot(p[0] - x, p[2] - z);
    if (d < bd) {
      bd = d;
      best = t;
    }
  };
  for (const sp of ed.doc.spawnPoints) if (!sp.controlPointId && sp.teams.length === 1) consider(sp.teams[0], sp.position);
  for (const cp of ed.doc.controlPoints) if (cp.defaultOwner !== 'neutral' && !cp.capturable) consider(cp.defaultOwner, cp.position);
  if (!best) return ['teamB'];
  return [best === 'teamA' ? 'teamB' : 'teamA'];
}

/** Nová zóna z obdélníku na zemi (a, b = rohy XZ): výška podle terénu, chytré týmy, zapnutá ve všech scénářích. */
export function insertZoneRect(ed: EditorDoc, history: History, editor: Editor, kind: Zone['kind'], a: [number, number], b: [number, number]) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const cx = r2((a[0] + b[0]) / 2), cz = r2((a[1] + b[1]) / 2);
  const hx = Math.max(0.5, r2(Math.abs(b[0] - a[0]) / 2)), hz = Math.max(0.5, r2(Math.abs(b[1] - a[1]) / 2));
  const [lo, hi] = groundSpan(editor, cx, cz, hx, hz, 0);
  const bottom = lo - ZONE_BELOW, top = hi + ZONE_TOP[kind];
  const z: Zone = {
    id: ed.newId('zone'),
    kind,
    center: [cx, r2((bottom + top) / 2), cz],
    halfExtents: [hx, r2((top - bottom) / 2), hz],
    yaw: 0,
    appliesTo: kind === 'boundary' ? ['teamA', 'teamB'] : zoneTeamsAt(ed, cx, cz),
    countdown: 10,
  };
  const label = kind === 'forbidden' ? 'Vložit zakázanou zónu' : 'Vložit hranici mapy';
  // Zóna se rovnou zapne ve všech scénářích – jinak by ve hře nic nedělala. Jedna položka historie.
  const changes = [...cmds.addEntity('zones', z, label).changes];
  for (const sc of ed.doc.scenarios) changes.push(...cmds.entity<Scenario>(ed, 'scenarios', sc.id, (x) => (x.zoneIds = [...new Set([...x.zoneIds, z.id])]), label).changes);
  history.execute({ label, changes });
  editor.select([markerId.zn(z.id)]);
}

export function renderMarkerInspector(root: HTMLElement, sel: string, ed: EditorDoc, history: History, _editor: Editor, state: GameUiState, rerender: () => void) {
  const m = markerId.parse(sel)!;
  const e = ed.getEntity(m.collection, m.id);
  if (!e) return;
  const upd = <T,>(label: string, fn: (x: T) => void) => history.execute(cmds.entity(ed, m.collection, m.id, fn as never, label));

  if (m.collection === 'controlPoints') {
    const cp = e as ControlPoint;
    root.appendChild(el('h3', {}, `⚑ ${cp.name}`));
    root.appendChild(el('div', { class: 'meta' }, `Kontrolní bod · ID ${cp.id}`));
    // Přepínač základ / scénář – UI vždy ukazuje, co mění.
    const scs: Array<[string, string]> = [['', 'Základ mapy'], ...ed.doc.scenarios.map((s) => [s.id, `Scénář: ${s.name}`] as [string, string])];
    row(root, 'Upravuji', undefined, sel_(scs, state.scenario ?? '', (v) => {
      state.scenario = v || null;
      rerender();
    }));
    const name = el('input', { type: 'text', maxlength: '40' }) as HTMLInputElement;
    name.value = cp.name;
    name.addEventListener('change', () => name.value.trim() && upd<ControlPoint>('Název bodu', (x) => (x.name = name.value.trim())));
    row(root, 'Název', undefined, name);
    row(root, 'Pozice', 'm', vec(cp.position, (i, v) => upd<ControlPoint>('Posun bodu', (x) => (x.position[i] = v))));
    row(root, 'Poloměr objemu', '1–100 m', num(cp.radius, 1, 100, 0.5, (v) => upd<ControlPoint>('Objem bodu', (x) => (x.radius = v))));
    row(root, 'Výška objemu', '1–50 m od podstavy', num(cp.height, 1, 50, 0.5, (v) => upd<ControlPoint>('Objem bodu', (x) => (x.height = v))));
    const sc = state.scenario ? ed.doc.scenarios.find((s) => s.id === state.scenario) : undefined;
    root.appendChild(el('div', { class: 'sec' }, sc ? `Herní vlastnosti – scénář „${sc.name}“` : 'Herní vlastnosti – základ mapy'));
    if (!sc) {
      row(root, 'Výchozí vlastník', undefined, sel_(Object.entries(OWNER_LABEL), cp.defaultOwner, (v) => upd<ControlPoint>('Vlastník bodu', (x) => (x.defaultOwner = v as TeamOwner))));
      row(root, 'Zabíratelný', undefined, chk(cp.capturable, (v) => upd<ControlPoint>('Zabíratelnost', (x) => (x.capturable = v))));
      row(root, 'Spawn povolen', 'samostatně od zabírání', chk(cp.spawnEnabled, (v) => upd<ControlPoint>('Spawn bodu', (x) => (x.spawnEnabled = v))));
      row(root, 'Počítá do bleed', 'ubývání ticketů', chk(cp.countsForBleed, (v) => upd<ControlPoint>('Bleed', (x) => (x.countsForBleed = v))));
    } else {
      const ov = sc.overrides.find((o) => o.controlPointId === cp.id) ?? { controlPointId: cp.id };
      const setOv = (fn: (o: ControlPointOverride) => void) =>
        history.execute(
          cmds.entity(ed, 'scenarios', sc.id, (s) => {
            const x = s as Scenario;
            let o = x.overrides.find((q) => q.controlPointId === cp.id);
            if (!o) x.overrides.push((o = { controlPointId: cp.id }));
            fn(o);
            x.overrides = x.overrides.filter((q) => Object.keys(q).length > 1);
          }, 'Přepsání ve scénáři'),
        );
      const ovRow = (label: string, key: keyof ControlPointOverride, base: unknown, control: (v: unknown, set: (v: unknown) => void) => HTMLElement) => {
        const has = ov[key] !== undefined;
        const wrap = el('div', { class: 'vec', style: 'grid-template-columns: auto 1fr' });
        const c = chk(has, (on) => setOv((o) => (on ? ((o as unknown as Record<string, unknown>)[key] = base) : delete (o as unknown as Record<string, unknown>)[key])));
        c.title = 'Přepsat ve scénáři';
        const ctl = control(has ? ov[key] : base, (v) => setOv((o) => ((o as unknown as Record<string, unknown>)[key] = v)));
        if (!has) (ctl as HTMLInputElement).disabled = true;
        wrap.append(c, ctl);
        row(root, label, has ? 'přepsáno scénářem' : 'ze základu mapy', wrap);
      };
      ovRow('Vlastník', 'defaultOwner', cp.defaultOwner, (v, set) => sel_(Object.entries(OWNER_LABEL), String(v), set));
      ovRow('Zabíratelný', 'capturable', cp.capturable, (v, set) => chk(Boolean(v), set));
      ovRow('Spawn povolen', 'spawnEnabled', cp.spawnEnabled, (v, set) => chk(Boolean(v), set));
      ovRow('Počítá do bleed', 'countsForBleed', cp.countsForBleed, (v, set) => chk(Boolean(v), set));
      ovRow('Vypnut ve scénáři', 'disabled', false, (v, set) => chk(Boolean(v), set));
    }
    root.appendChild(el('div', { class: 'note' }, 'Přítomnost v objemu se počítá i za zdí (pilot bez testu viditelnosti). Střecha mimo objem k zabírání nestačí.'));
    return;
  }
  if (m.collection === 'spawnPoints') {
    const sp = e as SpawnPoint;
    root.appendChild(el('h3', {}, '⬆ Spawn'));
    root.appendChild(el('div', { class: 'meta' }, `ID ${sp.id}`));
    row(root, 'Pozice', 'm', vec(sp.position, (i, v) => upd<SpawnPoint>('Posun spawnu', (x) => (x.position[i] = v))));
    row(root, 'Natočení', '°', num(deg(sp.yaw), -360, 360, 15, (v) => upd<SpawnPoint>('Natočení spawnu', (x) => (x.yaw = rad(v)))));
    row(root, 'Tým A', undefined, chk(sp.teams.includes('teamA'), (v) => upd<SpawnPoint>('Týmy spawnu', (x) => (x.teams = toggle(x.teams, 'teamA', v)))));
    row(root, 'Tým B', undefined, chk(sp.teams.includes('teamB'), (v) => upd<SpawnPoint>('Týmy spawnu', (x) => (x.teams = toggle(x.teams, 'teamB', v)))));
    const opts: Array<[string, string]> = [['', '— samostatná základna —'], ...ed.doc.controlPoints.map((c) => [c.id, c.name] as [string, string])];
    row(root, 'Patří k bodu', 'vazba přes ID', sel_(opts, sp.controlPointId ?? '', (v) => upd<SpawnPoint>('Vazba spawnu', (x) => (v ? (x.controlPointId = v) : delete x.controlPointId))));
    root.appendChild(el('div', { class: 'note' }, 'Spawn u bodu je dostupný, když bod vlastní tým a bod má povolený spawn. Bez vazby = základna týmu (vždy dostupná).'));
    return;
  }
  renderZoneInspector(root, e as Zone, ed, history, _editor, upd as <T>(label: string, fn: (x: T) => void) => void);
}

/** Přepínací tlačítka (segment). */
function seg<T extends string>(opts: Array<[T, string]>, on: (v: T) => boolean, click: (v: T) => void) {
  const d = el('div', { class: 'seg' });
  for (const [v, l] of opts) {
    const b = el('button', { class: on(v) ? 'on' : '', 'aria-pressed': String(on(v)) }, l);
    b.addEventListener('click', () => click(v));
    d.appendChild(b);
  }
  return d;
}

function renderZoneInspector(root: HTMLElement, z: Zone, ed: EditorDoc, history: History, editor: Editor, upd: <T>(label: string, fn: (x: T) => void) => void) {
  const forb = z.kind === 'forbidden';
  root.appendChild(el('h3', {}, forb ? '⛔ Zakázaná zóna' : '▭ Hranice mapy'));
  root.appendChild(el('div', { class: 'meta' }, `ID ${z.id} · úchopy na stěnách a nahoře mění rozměr přímo ve scéně`));
  const u = (label: string, fn: (x: Zone) => void) => upd<Zone>(label, fn);

  row(root, 'Typ', undefined, seg<Zone['kind']>([['forbidden', 'Zakázaná'], ['boundary', 'Hranice mapy']], (v) => v === z.kind, (v) => u('Typ zóny', (x) => {
    x.kind = v;
    if (v === 'boundary') x.appliesTo = ['teamA', 'teamB'];
  })));
  row(root, forb ? 'Vadí týmu' : 'Platí pro', forb ? 'komu běží odpočet' : 'kdo nesmí ven', seg<Team>([['teamA', 'Tým A'], ['teamB', 'Tým B']], (t) => z.appliesTo.includes(t), (t) => u('Týmy zóny', (x) => (x.appliesTo = toggle(x.appliesTo, t, !x.appliesTo.includes(t))))));
  if (!z.appliesTo.length) root.appendChild(el('div', { class: 'tip warn' }, '⚠ Zóna nevadí žádnému týmu – ve hře nic nedělá.'));

  // Rozměr: Š / H / V v metrech; změna drží spodek zóny (výška roste nahoru).
  const he = el('div', { class: 'vec' });
  const dims: Array<[number, string]> = [[0, 'Š'], [2, 'H'], [1, 'V']];
  for (const [i, l] of dims) {
    const inp = num(z.halfExtents[i] * 2, 1, 4000, 1, (nv) => u('Rozměr zóny', (x) => {
      const bottom = x.center[1] - x.halfExtents[1];
      x.halfExtents[i] = nv / 2;
      if (i === 1) x.center[1] = Math.round((bottom + nv / 2) * 100) / 100;
    }));
    inp.title = `${l} (m)`;
    inp.setAttribute('aria-label', `${l} v metrech`);
    he.appendChild(inp);
  }
  row(root, 'Rozměr', 'Š × H × V (m)', he);

  const quick = el('div', { class: 'seg' });
  const qb = (label: string, title: string, fn: () => void) => {
    const b = el('button', { title }, label);
    b.addEventListener('click', fn);
    quick.appendChild(b);
  };
  const span = () => groundSpan(editor, z.center[0], z.center[2], z.halfExtents[0], z.halfExtents[2], z.yaw);
  qb('⤓ Na zem', 'Spodek zóny kousek pod nejnižší terén, výška zůstane', () => {
    const [lo] = span();
    u('Zóna na zem', (x) => (x.center[1] = Math.round((lo - ZONE_BELOW + x.halfExtents[1]) * 100) / 100));
  });
  qb('⇕ Celá výška', `Od terénu do ${ZONE_TOP[z.kind]} m nad nejvyšší bod`, () => {
    const [lo, hi] = span();
    const bottom = lo - ZONE_BELOW, top = hi + ZONE_TOP[z.kind];
    u('Celá výška zóny', (x) => {
      x.center[1] = Math.round(((bottom + top) / 2) * 100) / 100;
      x.halfExtents[1] = Math.round(((top - bottom) / 2) * 100) / 100;
    });
  });
  row(root, 'Výška', undefined, quick);

  row(root, 'Střed', 'm (X, Y, Z)', vec(z.center, (i, v) => u('Posun zóny', (x) => (x.center[i] = v))));
  const rot = el('div', { class: 'vec' });
  const r90 = (d: number) => {
    const b = el('button', { title: `Otočit o ${d}°` }, d < 0 ? '⟲ 90°' : '⟳ 90°');
    b.addEventListener('click', () => u('Natočení zóny', (x) => (x.yaw = rad(Math.round(deg(x.yaw) + d)))));
    return b;
  };
  rot.append(r90(-90), num(deg(z.yaw), -360, 360, 15, (v) => u('Natočení zóny', (x) => (x.yaw = rad(v)))), r90(90));
  row(root, 'Natočení', '°', rot);

  if (forb) {
    const wrap = el('div', { style: 'display:flex;align-items:center;gap:8px;flex:1' });
    const sl = el('input', { type: 'range', min: '1', max: '60', step: '1', 'aria-label': 'Odpočet v sekundách', style: 'flex:1' }) as HTMLInputElement;
    sl.value = String(Math.min(60, z.countdown));
    const out = el('b', { style: 'min-width:3.2em;text-align:right' }, `${z.countdown} s`);
    sl.addEventListener('input', () => (out.textContent = `${sl.value} s`));
    sl.addEventListener('change', () => u('Odpočet zóny', (x) => (x.countdown = Number(sl.value))));
    wrap.append(sl, out);
    row(root, 'Odpočet', 'pak hráč zemře', wrap);
  } else row(root, 'Odpočet', '1–120 s', num(z.countdown, 1, 120, 1, (v) => u('Odpočet zóny', (x) => (x.countdown = v))));

  // Scénáře přímo tady: zóna, která není v žádném scénáři, ve hře neplatí.
  root.appendChild(el('div', { class: 'sect-title' }, 'Platí ve scénářích'));
  const scs = ed.doc.scenarios;
  if (!scs.length) root.appendChild(el('div', { class: 'tip warn' }, '⚠ Mapa nemá žádný scénář – přidej ho v panelu Hra.'));
  for (const sc of scs)
    row(root, sc.name, undefined, chk(sc.zoneIds.includes(z.id), (v) => history.execute(cmds.entity<Scenario>(ed, 'scenarios', sc.id, (x) => (x.zoneIds = v ? [...new Set([...x.zoneIds, z.id])] : x.zoneIds.filter((q) => q !== z.id)), 'Zóny scénáře'))));
  const off = scs.filter((sc) => !sc.zoneIds.includes(z.id));
  if (scs.length && off.length) {
    const t = el('div', { class: 'tip warn' }, off.length === scs.length ? '⚠ Zóna není v žádném scénáři – ve hře se neprojeví. ' : `Vypnuto ve ${off.length} z ${scs.length} scénářů. `);
    const b = el('button', {}, 'Zapnout ve všech');
    b.addEventListener('click', () => {
      const changes = scs.flatMap((sc) => cmds.entity<Scenario>(ed, 'scenarios', sc.id, (x) => (x.zoneIds = [...new Set([...x.zoneIds, z.id])]), 'Zóna ve všech scénářích').changes);
      history.execute({ label: 'Zóna ve všech scénářích', changes });
    });
    t.appendChild(b);
    root.appendChild(t);
  }
  root.appendChild(el('div', { class: 'note' }, forb ? 'Hráč týmu, kterému zóna vadí, po vstupu vidí odpočet; když neodejde, zemře. Po odchodu se odpočet resetuje.' : 'Hranice: hráč, který z ní vyjde ven, vidí odpočet; po návratu se resetuje.'));
}

const sel_ = sel;
function toggle(arr: Team[], t: Team, on: boolean): Team[] {
  const s = new Set(arr);
  if (on) s.add(t);
  else s.delete(t);
  return [...s].sort() as Team[];
}

/** Sekce scénářů ve vlastnostech mapy. */
export function renderScenarios(root: HTMLElement, ed: EditorDoc, history: History) {
  root.appendChild(el('div', { class: 'sec' }, `Scénáře (${ed.doc.scenarios.length})`));
  const doc = ed.doc;
  const cps = doc.controlPoints;
  root.appendChild(
    el('div', { class: 'note' }, `Body: ${cps.length} (počítané do bleed: ${cps.filter((c) => c.countsForBleed).length}, nezabíratelné: ${cps.filter((c) => !c.capturable).length}) · spawny A ${doc.spawnPoints.filter((s) => s.teams.includes('teamA')).length}, B ${doc.spawnPoints.filter((s) => s.teams.includes('teamB')).length}`),
  );
  for (const s of doc.scenarios) {
    const box = el('div', { class: 'sect' });
    const up = (label: string, fn: (x: Scenario) => void) => history.execute(cmds.entity(ed, 'scenarios', s.id, fn as never, label));
    const nm = el('input', { type: 'text', maxlength: '40' }) as HTMLInputElement;
    nm.value = s.name;
    nm.addEventListener('change', () => nm.value.trim() && up('Název scénáře', (x) => (x.name = nm.value.trim())));
    row(box, 'Název', s.id, nm);
    row(box, 'Tickety A', undefined, num(s.tickets.teamA, 1, 10000, 10, (v) => up('Tickety', (x) => (x.tickets.teamA = Math.round(v)))));
    row(box, 'Tickety B', undefined, num(s.tickets.teamB, 1, 10000, 10, (v) => up('Tickety', (x) => (x.tickets.teamB = Math.round(v)))));
    row(box, 'Časový limit', 's', num(s.timeLimit, 30, 7200, 60, (v) => up('Limit', (x) => (x.timeLimit = v))));
    row(box, 'Respawn', 's', num(s.respawnDelay, 0, 120, 1, (v) => up('Respawn', (x) => (x.respawnDelay = v))));
    row(box, 'Zabrání', 's (neutrální → vlastní)', num(s.captureTime, 1, 600, 1, (v) => up('Zabrání', (x) => (x.captureTime = v))));
    row(box, 'Neutralizace', 's', num(s.neutralizeTime, 1, 600, 1, (v) => up('Neutralizace', (x) => (x.neutralizeTime = v))));
    row(box, 'Bleed', 's na ticket', num(s.bleedInterval, 0.5, 600, 0.5, (v) => up('Bleed', (x) => (x.bleedInterval = v))));
    for (const z of doc.zones) row(box, `Zóna ${z.id}`, z.kind === 'forbidden' ? 'zakázaná' : 'hranice', chk(s.zoneIds.includes(z.id), (v) => up('Zóny scénáře', (x) => (x.zoneIds = v ? [...new Set([...x.zoneIds, z.id])] : x.zoneIds.filter((q) => q !== z.id)))));
    root.appendChild(el('div', { class: 'note' }, s.overrides.length ? `Přepsání bodů: ${s.overrides.map((o) => cps.find((c) => c.id === o.controlPointId)?.name ?? o.controlPointId).join(', ')}` : 'Bez přepsání bodů (používá základ mapy).'));
    const del = el('button', {}, 'Smazat scénář');
    del.addEventListener('click', () => history.execute(cmds.entity(ed, 'scenarios', s.id, null, 'Smazat scénář')));
    box.appendChild(del);
    root.appendChild(box);
  }
  const r = el('div', { class: 'btnrow' });
  const mk = (label: string, name: string) => {
    const b = el('button', {}, label);
    b.addEventListener('click', () => {
      const sc: Scenario = { id: ed.newId('sc'), name, overrides: [], tickets: { teamA: 100, teamB: 100 }, timeLimit: 1200, respawnDelay: 10, captureTime: 10, neutralizeTime: 10, bleedInterval: 5, zoneIds: doc.zones.map((z) => z.id) };
      history.execute(cmds.addEntity('scenarios', sc, 'Přidat scénář'));
    });
    r.appendChild(b);
  };
  mk('+ Scénář A (útok/obrana)', 'Obrana města');
  mk('+ Scénář B (dvě základny)', 'Dvě základny');
  root.appendChild(r);
}

/** Poslední nastavení štětce na palmy (zachová se mezi přepnutím štětců). */
let PLANT_DEFAULT: PlantBrush = { erase: false, spacing: 5, kind: 'mix', height: 8, variance: 0.35 };

/** Panel terénních štětců (záložka Terén). */
export function renderTerrainPanel(root: HTMLElement, editor: Editor, onChange: () => void) {
  root.replaceChildren();
  const on = el('button', { class: editor.terrainMode ? 'on' : '' }, editor.terrainMode ? '✔ Režim terénu zapnut' : 'Zapnout režim terénu');
  on.addEventListener('click', () => {
    editor.setTerrainMode(!editor.terrainMode);
    onChange();
  });
  root.appendChild(on);
  const kinds: Array<[BrushKind, string]> = [
    ['raise', 'Zvýšit'],
    ['lower', 'Snížit'],
    ['smooth', 'Vyhladit'],
    ['flatten', 'Srovnat'],
    ['paintDirt', 'Hlína'],
    ['paintUrban', 'Městský povrch'],
    ['paintGrass', 'Tráva +'],
    ['paintGrassLess', 'Tráva −'],
    ['paintErase', 'Smazat malbu'],
  ];
  const grid = el('div', { class: 'btnrow' });
  for (const [k, l] of kinds) {
    const b = el('button', { class: !editor.plant && editor.brush.kind === k ? 'on' : '' }, l);
    b.addEventListener('click', () => {
      editor.plant = null;
      editor.brush.kind = k;
      if (k === 'flatten') editor.brush.target = undefined;
      if (!editor.terrainMode) editor.setTerrainMode(true);
      onChange();
    });
    grid.appendChild(b);
  }
  root.appendChild(grid);
  const box = el('div', { style: 'margin-top:8px' });
  row(box, 'Poloměr', '1–40 m', num(editor.brush.radius, 1, 40, 0.5, (v) => (editor.brush.radius = v)));
  const paint = editor.brush.kind.startsWith('paint');
  if (!editor.plant) row(box, 'Síla', paint ? 'podíl/s' : 'm/s', num(editor.brush.strength, 0.05, 20, 0.05, (v) => (editor.brush.strength = v)));
  if (!editor.plant && editor.brush.kind === 'flatten') row(box, 'Cílová výška', 'Shift+klik nabere', num(editor.brush.target ?? 0, -999, 999, 0.1, (v) => (editor.brush.target = v)));
  root.appendChild(box);
  // Sázení palem: štětec, který místo terénu hromadně vkládá „Random palmy“.
  root.appendChild(el('div', { class: 'note', style: 'margin-top:10px;font-weight:600' }, 'Sázení palem (les, háj)'));
  const prow = el('div', { class: 'btnrow' });
  const pb = (label: string, erase: boolean) => {
    const b = el('button', { class: editor.plant && editor.plant.erase === erase ? 'on' : '' }, label);
    b.addEventListener('click', () => {
      editor.plant = { ...(editor.plant ?? PLANT_DEFAULT), erase };
      if (!editor.terrainMode) editor.setTerrainMode(true);
      onChange();
    });
    prow.appendChild(b);
  };
  pb('🌴 Sázet palmy', false);
  pb('Mazat palmy', true);
  root.appendChild(prow);
  if (editor.plant && !editor.plant.erase) {
    const pl = editor.plant;
    PLANT_DEFAULT = pl;
    const pbox = el('div', { style: 'margin-top:6px' });
    row(pbox, 'Rozestup', '2–15 m', num(pl.spacing, 2, 15, 0.5, (v) => (pl.spacing = v)));
    const kind = sel([['date', 'Datlovník'], ['slender', 'Štíhlá palma'], ['mix', 'Mix obou']], pl.kind, (v) => (pl.kind = v));
    row(pbox, 'Druh', '', kind);
    row(pbox, 'Průměrná výška', '2–16 m', num(pl.height, 2, 16, 0.5, (v) => (pl.height = v)));
    row(pbox, 'Míra rozdílů', '0 stejné – 1 hodně', num(pl.variance, 0, 1, 0.05, (v) => (pl.variance = v)));
    root.appendChild(pbox);
  }
  if (editor.plant)
    root.appendChild(
      el('div', { class: 'note' }, editor.plant.erase ? 'Tah štětcem smaže palmy v kruhu (jeden tah = jedna položka historie).' : 'Tah štětcem vysází palmy v kruhu s daným rozestupem; každá je trochu jiná (výška, náklon, listy). Poloměr štětce = velikost lesa pod kurzorem. Jeden tah = jedna položka historie (Ctrl+Z vrátí celý tah).'),
    );
  root.appendChild(
    el('div', { class: 'note' }, 'LMB táhne štětcem (jeden tah = jedna položka historie). Objekty se s terénem nehýbou – použijte „Položit na povrch“ ve vlastnostech objektu. Výškové pole neumí převisy ani tunely; ty tvoří objekty.'),
  );
}
