import type { ControlPoint, ControlPointOverride, Scenario, SpawnPoint, Team, TeamOwner, Zone } from '../../shared/map/schema';
import type { BrushKind } from '../../world/terrain';
import { cmds, type EditorDoc, type History } from './editorDoc';
import type { Editor } from './editor';
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
export function insertMarker(ed: EditorDoc, history: History, editor: Editor, kind: 'flag' | 'spawnA' | 'spawnB' | 'zone', at: [number, number, number]) {
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
  } else if (kind === 'zone') {
    const z: Zone = { id: ed.newId('zone'), kind: 'forbidden', center: [p[0], p[1] + 5, p[2]], halfExtents: [10, 5, 10], yaw: 0, appliesTo: ['teamB'], countdown: 10 };
    history.execute(cmds.addEntity('zones', z, 'Vložit zónu'));
    editor.select([markerId.zn(z.id)]);
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
  const z = e as Zone;
  root.appendChild(el('h3', {}, '⛔ Zóna'));
  root.appendChild(el('div', { class: 'meta' }, `ID ${z.id}`));
  row(root, 'Typ', undefined, sel_([['forbidden', 'Zakázaná zóna'], ['boundary', 'Hranice mapy']], z.kind, (v) => upd<Zone>('Typ zóny', (x) => (x.kind = v as Zone['kind']))));
  row(root, 'Střed', 'm', vec(z.center, (i, v) => upd<Zone>('Posun zóny', (x) => (x.center[i] = v))));
  const he = el('div', { class: 'vec' });
  z.halfExtents.forEach((v, i) => he.appendChild(num(v * 2, 1, 2000, 0.5, (nv) => upd<Zone>('Rozměr zóny', (x) => (x.halfExtents[i] = nv / 2)))));
  row(root, 'Rozměr', 'm (X, Y, Z)', he);
  row(root, 'Natočení', '°', num(deg(z.yaw), -360, 360, 15, (v) => upd<Zone>('Natočení zóny', (x) => (x.yaw = rad(v)))));
  row(root, 'Platí pro tým A', undefined, chk(z.appliesTo.includes('teamA'), (v) => upd<Zone>('Týmy zóny', (x) => (x.appliesTo = toggle(x.appliesTo, 'teamA', v)))));
  row(root, 'Platí pro tým B', undefined, chk(z.appliesTo.includes('teamB'), (v) => upd<Zone>('Týmy zóny', (x) => (x.appliesTo = toggle(x.appliesTo, 'teamB', v)))));
  row(root, 'Odpočet', '1–120 s', num(z.countdown, 1, 120, 1, (v) => upd<Zone>('Odpočet zóny', (x) => (x.countdown = v))));
  root.appendChild(el('div', { class: 'note' }, 'Zóna platí jen ve scénářích, které ji mají zapnutou (vlastnosti mapy → Scénáře). Odpočet běží jen během pobytu, po návratu se resetuje.'));
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
    ['paintErase', 'Smazat malbu'],
  ];
  const grid = el('div', { class: 'btnrow' });
  for (const [k, l] of kinds) {
    const b = el('button', { class: editor.brush.kind === k ? 'on' : '' }, l);
    b.addEventListener('click', () => {
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
  row(box, 'Síla', paint ? 'podíl/s' : 'm/s', num(editor.brush.strength, 0.05, 20, 0.05, (v) => (editor.brush.strength = v)));
  if (editor.brush.kind === 'flatten') row(box, 'Cílová výška', 'Shift+klik nabere', num(editor.brush.target ?? 0, -999, 999, 0.1, (v) => (editor.brush.target = v)));
  root.appendChild(box);
  root.appendChild(
    el('div', { class: 'note' }, 'LMB táhne štětcem (jeden tah = jedna položka historie). Objekty se s terénem nehýbou – použijte „Položit na povrch“ ve vlastnostech objektu. Výškové pole neumí převisy ani tunely; ty tvoří objekty.'),
  );
}
