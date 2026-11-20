import type { MapDocument, SpawnPoint, Team } from '../../shared/map/schema';
import { cpStable, type ConquestState } from '../../shared/sim/conquest';
import { FACTION_LABEL, KIT_LABEL, PILOT, arsenalEntry, rulesOf, weaponFor, type Faction, type Kit } from '../../shared/config/arsenal';
import { kitItems } from '../../shared/config/kits';
import type { PlayerView } from '../runtime/driver';
import { t, type StringKey } from './i18n';
import { button, dialog, fmtTime, h, tabs } from './kit';
import { DeployIntent, type DeployTarget, type IntentInput } from './deployIntent';
import { MapView, type MapMarker } from './mapView';
import { playArea, type TacticalMap } from './tactical';
import { drawSilhouette } from './silhouette';

/**
 * Obrazovka nasazení ve stylu BF2: jedna taktická obrazovka. Horní pruh (mapa, režim, tým,
 * tickety, čas, záložky), vlevo classy v řádcích a výbava kitu, vpravo mapa s body, základnami
 * a leaderem, dole souhrn, místo nasazení (rozbalovací seznam sdílí výběr s mapou), stav a
 * hlavní akce. Nasazuje jen tlačítko Nasadit (klik ani dvojklik na mapu ne); potvrzené čekání
 * drží `DeployIntent`, rozhoduje server. Zaživa / ve vyřazení lze výběr jen připravit.
 */
export interface DeployContext {
  doc: MapDocument;
  map: TacticalMap;
  me: PlayerView;
  team: Team;
  cq: ConquestState | null;
  /** Spawny, které server pro tým aktuálně povoluje (včetně squad:<leader>). */
  spawns: SpawnPoint[];
  /** Frakce týmu (null = volný test – frakci volí hráč). */
  faction: Faction | null;
  kits: Kit[];
  simTime: number;
  teammates: Array<{ id: string; name?: string; pos: [number, number]; squad: boolean; leader: boolean }>;
  /** Doplňkové záložky (Squad, Commander) – jen pokud je server podporuje. */
  extraTabs: Array<{ id: string; label: string; view: () => HTMLElement; full?: boolean }>;
  /** Jména hráčů (leader). */
  names: Map<string, string>;
  /** Klíč kola: změna = nové kolo (záměr i vybraný cíl se ruší). */
  roundKey: string;
}

const KIT_ICON: Record<Kit, string> = {
  assault: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="currentColor" stroke-width="2"/></svg>',
  medic: '<svg viewBox="0 0 24 24"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor"/></svg>',
  support: '<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 9V5h3v4M11 9V5h3v4M15 9V5h3v4" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
  sniper: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v7M12 14v7M3 12h7M14 12h7" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>',
  engineer: '<svg viewBox="0 0 24 24"><path d="M4 20l9-9M14 4a5 5 0 006 6l-3 3-6-6z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

/** Ikony výbavy (vlastní jednoduché tvary, 24×24). */
const ITEM_ICON: Record<string, string> = {
  knife: '<svg viewBox="0 0 24 24"><path d="M4 20L16 5l4 3-9 13z" fill="currentColor"/><path d="M3 21l3-1" stroke="currentColor" stroke-width="2"/></svg>',
  pistol: '<svg viewBox="0 0 24 24"><path d="M3 8h16v4h-8l-1 4H6l1-4H3z" fill="currentColor"/></svg>',
  frag: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="6.5" fill="currentColor"/><rect x="10" y="3" width="4" height="4" fill="currentColor"/><path d="M14 5h5" stroke="currentColor" stroke-width="2"/></svg>',
  smoke: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="13" rx="1" fill="currentColor"/><rect x="9.5" y="3" width="5" height="4" fill="currentColor"/></svg>',
  medkit: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="2" fill="currentColor"/><path d="M12 9v8M8 13h8" stroke="#1a1d1e" stroke-width="2.4"/></svg>',
  defib: '<svg viewBox="0 0 24 24"><path d="M13 2L5 14h6l-1 8 9-13h-6z" fill="currentColor"/></svg>',
  ammo: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="11" fill="currentColor"/><path d="M8 9V5M12 9V5M16 9V5" stroke="currentColor" stroke-width="2.4"/></svg>',
};

function icon(svg: string) {
  const s = h('span', { class: 'pf-kit-ico', 'aria-hidden': 'true' });
  s.innerHTML = svg; // vlastní statické SVG (žádný uživatelský obsah)
  return s;
}

export class DeployScreen {
  readonly root = h('div', { id: 'pf-deploy', class: 'pf-screen pf-deploy hidden', role: 'dialog', 'aria-label': 'deploy' });
  /** Malý stav potvrzeného čekání, když je obrazovka zavřená. */
  readonly chip = h('div', { class: 'pf-deploy-chip hidden' });
  readonly intent = new DeployIntent();
  private kit: Kit = 'assault';
  private kitByFaction: Partial<Record<Faction, Kit>> = {};
  private faction: Faction = 'usmc';
  private target: string | null = null;
  private tab = 'deploy';
  private message: { text: string; kind: 'warn' | 'info' } | null = null;
  private lastKey = '';
  private ctx: DeployContext | null = null;
  private targets: DeployTarget[] = [];
  private mapView = new MapView();
  private silCanvas = h('canvas', { class: 'pf-deploy-sil' }) as HTMLCanvasElement;
  private silKey = '';
  private openedLife = '';
  /** Odeslání požadavku (spawn + zbraň kitu); okamžité odmítnutí (offline) vrací text. */
  onDeploy: (spawnId: string | null, weaponId: string) => string | null = () => null;
  /** Zavřít obrazovku a vrátit se do hry (uživatelské gesto → pointer lock). */
  onClose: () => void = () => {};
  /** Znovu nasadit (sebevražda) – nabízí se jen živému hráči; potvrzení varování řeší obrazovka. */
  onRedeploy: (() => void) | null = null;
  /** Změna týmu (síťová hra): obsazenost týmů a odeslání požadavku; null = volba se nenabízí. */
  teamInfo: (() => { counts: Record<Team, number>; size: number; factions: Record<Team, Faction> } | null) | null = null;
  onTeamSwitch: ((team: Team) => void) | null = null;
  /** Odpojení ze serveru / ukončení tréninku (potvrzení řeší obrazovka). */
  onLeave: (() => void) | null = null;
  leaveNetwork = true;
  private lastLife: IntentInput['life'] = 'dead';

  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem('pf.deploy') ?? '{}');
      if (v && typeof v.kits === 'object') this.kitByFaction = v.kits;
      if (typeof v.faction === 'string') this.faction = v.faction;
      if (typeof v.lastTarget === 'string') this.lastTarget = v.lastTarget;
    } catch {
      /* výchozí */
    }
    this.mapView.onSelect = (id) => this.selectTarget(id);
    // Dvojklik na dostupné místo v mapě = vybrat a rovnou nasadit.
    this.mapView.root.addEventListener('dblclick', () => {
      const tg = this.targets.find((x) => x.id === this.target);
      if (tg?.available && this.intent.phase === 'idle') this.primaryAction();
    });
    this.intent.onSend = (target) => {
      const w = this.weapon();
      return this.onDeploy(target.spawnId, w.id);
    };
    document.body.append(this.root, this.chip);
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  show(v: boolean) {
    if (v === this.visible) return;
    this.root.classList.toggle('hidden', !v);
    this.lastKey = '';
    if (v) requestAnimationFrame(() => (this.root.querySelector('.pf-class.on') as HTMLElement | null)?.focus());
  }

  /** Server nasazení odmítl (síť): důvod zobrazit, výběr zachovat. */
  reject(reason: string) {
    this.intent.reject(reason);
    this.lastKey = '';
  }

  dispose() {
    this.root.remove();
    this.chip.remove();
  }

  private save() {
    try {
      localStorage.setItem('pf.deploy', JSON.stringify({ kits: this.kitByFaction, faction: this.faction, lastTarget: this.lastTarget }));
    } catch {
      /* ignorovat */
    }
  }

  private fac(c = this.ctx) {
    return c?.faction ?? this.faction;
  }

  private weapon(c = this.ctx) {
    return weaponFor(this.fac(c), this.kit);
  }

  /** Klávesy 1–5: třída podle pořadí v seznamu. */
  selectKitIndex(i: number) {
    const k = this.ctx?.kits[i];
    if (k) this.selectKit(k);
  }

  private lastTarget = '';

  private selectKit(k: Kit) {
    if (k === this.kit) return;
    this.kit = k;
    this.kitByFaction[this.fac()] = k;
    this.save();
    this.intent.selectionChanged();
    this.message = null;
    this.lastKey = '';
  }

  private selectTarget(id: string) {
    const tg = this.targets.find((x) => x.id === id);
    if (!tg) return;
    if (!tg.available) {
      // Klik na nedostupný bod vysvětlí důvod, výběr nemění.
      this.message = { text: `${tg.name}: ${t(tg.reason ?? 'deploy.reasonBlocked')}`, kind: 'warn' };
      this.lastKey = '';
      return;
    }
    if (id !== this.target) {
      this.target = id;
      this.lastTarget = id;
      this.save();
      this.intent.selectionChanged();
    }
    this.message = null;
    this.lastKey = '';
  }

  /** Klávesa Enter uvnitř obrazovky: hlavní akce (když fokus není v jiném prvku). */
  primaryAction() {
    (this.root.querySelector('.pf-deploy-go') as HTMLButtonElement | null)?.click();
  }

  /** Cíle nasazení z mapy a stavu serveru (body, základny, leader); počet bodů není pevný. */
  private buildTargets(c: DeployContext): DeployTarget[] {
    const out: DeployTarget[] = [];
    const avail = c.spawns;
    if (!c.cq) {
      const tsp = c.doc.testSpawn?.position ?? [0, 0, 0];
      return [{ id: 'test', kind: 'test', name: t('deploy.testSpawn'), x: tsp[0], z: tsp[2], rel: 'own', available: true, spawnId: null }];
    }
    for (const cp of c.cq.cps) {
      const rel = cp.owner === 'neutral' ? 'neutral' : cp.owner === c.team ? 'own' : 'enemy';
      const sp = avail.find((s) => s.controlPointId === cp.id);
      const hasSpawns = c.doc.spawnPoints.some((s) => s.controlPointId === cp.id && s.teams.includes(c.team));
      let reason: StringKey | undefined;
      if (!sp) reason = rel === 'enemy' ? 'deploy.reasonEnemy' : rel === 'neutral' ? 'deploy.reasonNeutral' : !hasSpawns || !cp.spawnEnabled ? 'deploy.reasonNoSpawns' : !cpStable(cp) ? 'deploy.reasonUnstable' : 'deploy.reasonBlocked';
      out.push({ id: `cp:${cp.id}`, kind: cp.capturable ? 'cp' : 'base', name: cp.name, x: cp.pos[0], z: cp.pos[2], rel, available: !!sp, reason, spawnId: sp?.id ?? null });
    }
    // Spawny bez bodu (hlavní základna týmu).
    const loose = c.doc.spawnPoints.filter((s) => !s.controlPointId && s.teams.includes(c.team));
    if (loose.length) {
      const sp = avail.find((s) => !s.controlPointId && !s.id.startsWith('squad:'));
      const x = loose.reduce((a, s) => a + s.position[0], 0) / loose.length, z = loose.reduce((a, s) => a + s.position[2], 0) / loose.length;
      out.push({ id: `base:${c.team}`, kind: 'base', name: t('deploy.mainBase'), x, z, rel: 'own', available: !!sp, reason: sp ? undefined : 'deploy.reasonBlocked', spawnId: sp?.id ?? null });
    }
    for (const s of avail.filter((x) => x.id.startsWith('squad:'))) {
      const lid = s.id.slice(6);
      out.push({ id: s.id, kind: 'leader', name: t('deploy.leaderOf', { name: c.names.get(lid) ?? lid }), x: s.position[0], z: s.position[2], rel: 'own', available: true, spawnId: s.id });
    }
    return out;
  }

  update(c: DeployContext) {
    const roundChanged = this.ctx && this.ctx.roundKey !== c.roundKey;
    this.ctx = c;
    if (roundChanged) this.target = null; // místo nasazení platí jen v rámci kola a mapy
    // Classa: zapamatovaná pro frakci, ověřená proti konfiguraci serveru.
    const fac = this.fac(c);
    const want = this.kitByFaction[fac] ?? this.kit;
    if (c.kits.includes(want)) this.kit = want;
    else if (!c.kits.includes(this.kit)) {
      this.kit = c.kits[0];
      this.message = { text: t('deploy.kitReplaced', { kit: KIT_LABEL[this.kit] }), kind: 'warn' };
    }
    this.targets = this.buildTargets(c);
    const avail = this.targets.filter((x) => x.available);
    // Výchozí místo: naposledy zvolené (je-li dostupné), jinak první dostupné – „Nasadit“ jde hned.
    if (!this.target && avail.length) this.target = (avail.find((x) => x.id === this.lastTarget) ?? avail[0]).id;
    const sel = this.targets.find((x) => x.id === this.target) ?? null;
    const life: IntentInput['life'] = c.me.alive ? 'alive' : c.me.life === 'downed' ? 'downed' : 'dead';
    this.lastLife = life;
    const wait = Math.max(0, c.me.respawnAt - c.simTime);
    const w = this.weapon(c);
    this.intent.update({ now: performance.now() / 1000, life, lifeId: c.me.lifeId ?? 0, waitLeft: life === 'dead' ? wait : Infinity, target: sel, kitOk: c.kits.includes(this.kit) && w.available !== false, roundKey: c.roundKey, ended: !!c.cq?.ended });
    // Revive / nasazení: obrazovka otevřená automaticky po smrti se zavře.
    const lifeKey = `${c.me.lifeId}|${life}`;
    if (this.openedLife && lifeKey !== this.openedLife && life === 'alive' && this.autoOpened) this.close();
    this.renderChip(c, sel, wait);
    // Celé překreslení jen při skutečné změně (třída, místo, stav, tým…). Odpočty, čas kola a tickety
    // se mění každou sekundu – ty se přepisují jen jako text (jinak obrazovka problikávala).
    const ti = this.teamInfo?.();
    const key = [this.tab, this.kit, fac, this.target, life, wait > 0, c.me.downedLeft > 0, this.message?.text, this.intent.phase, this.intent.note?.key, JSON.stringify(this.intent.note?.vars ?? null), this.targets.map((x) => `${x.id}${x.available ? 1 : 0}${x.rel}`).join(), c.team, ti ? `${ti.counts.teamA}/${ti.counts.teamB}` : ''].join('|');
    if (this.visible && key !== this.lastKey) {
      this.lastKey = key;
      this.render(c, sel, life, wait);
    }
    if (this.visible) this.updateLive(c, sel, life, wait);
    if (this.visible) this.updateMap(c);
  }

  /** Průběžné hodnoty bez překreslení: tickety, čas kola, odpočet nasazení / vyřazení. */
  private updateLive(c: DeployContext, sel: DeployTarget | null, life: IntentInput['life'], wait: number) {
    const set = (k: string, v: string) => {
      const e = this.root.querySelector(`[data-live="${k}"]`);
      if (e && e.textContent !== v) e.textContent = v;
    };
    const cq = c.cq;
    if (cq) {
      const enemy: Team = c.team === 'teamA' ? 'teamB' : 'teamA';
      set('own', `${cq.tickets[c.team]}`);
      set('enemy', `${cq.tickets[enemy]}`);
      set('time', fmtTime(cq.timeLimit - cq.time));
    }
    const st = this.status(c, sel, life, wait);
    if (st.text) set('status', st.text);
  }

  private autoOpened = false;
  /** Otevřít (Enter / smrt). `auto` = otevřeno hrou (po smrti), ne hráčem. */
  open(auto = false) {
    this.autoOpened = auto;
    const c = this.ctx;
    this.openedLife = c ? `${c.me.lifeId}|${c.me.alive ? 'alive' : c.me.life}` : '';
    this.show(true);
  }

  close() {
    this.show(false);
    this.autoOpened = false;
  }

  private winCache: { doc: MapDocument; win: ReturnType<typeof playArea> } | null = null;
  private win(c: DeployContext) {
    if (this.winCache?.doc !== c.doc) this.winCache = { doc: c.doc, win: playArea(c.doc, 16) ?? c.map.bounds };
    return this.winCache.win ?? c.map.bounds;
  }

  /** Značky pro mapu (sdílí i mapa na M). */
  markers(c: DeployContext): MapMarker[] {
    return this.buildMarkers(c);
  }

  private updateMap(c: DeployContext) {
    this.mapView.setMap(c.map, this.win(c));
    this.mapView.setMarkers(this.buildMarkers(c), this.target);
  }

  private buildMarkers(c: DeployContext): MapMarker[] {
    const markers: MapMarker[] = [];
    for (const tg of this.targets) {
      const cp = c.cq?.cps.find((x) => `cp:${x.id}` === tg.id);
      const info = [tg.rel === 'own' ? t('map.own') : tg.rel === 'enemy' ? t('map.enemy') : t('map.neutral'), tg.available ? t('map.available') : t(tg.reason ?? 'deploy.reasonBlocked')].join(' · ');
      markers.push({ id: tg.id, kind: tg.kind === 'test' ? 'base' : tg.kind, x: tg.x, z: tg.z, label: tg.name, rel: tg.rel, selectable: tg.rel === 'own' || tg.kind === 'leader', available: tg.available, info, radius: cp?.radius, progress: cp && cp.capturable ? (c.team === 'teamA' ? cp.p : -cp.p) : undefined });
    }
    for (const tm of c.teammates) if (!tm.leader || !this.targets.some((x) => x.id === `squad:${tm.id}`)) markers.push({ id: `p:${tm.id}`, kind: tm.squad ? 'squadmate' : 'ally', x: tm.pos[0], z: tm.pos[1], rel: 'own', label: tm.name });
    if (c.me.alive || c.me.life === 'downed') markers.push({ id: 'me', kind: 'me', x: c.me.state.pos.x, z: c.me.state.pos.z, rel: 'own' });
    return markers;
  }

  /** Herní okno mapy pro mapu na M. */
  mapWindow(c: DeployContext) {
    return this.win(c);
  }

  get lastContext() {
    return this.ctx;
  }

  private status(c: DeployContext, sel: DeployTarget | null, life: IntentInput['life'], wait: number) {
    const kitName = KIT_LABEL[this.kit];
    const ph = this.intent.phase;
    if (life === 'alive') return { text: t('deploy.aliveNote'), kind: 'info', main: 'back' as const };
    if (life === 'downed') return { text: t('deploy.downedNote', { s: Math.ceil(c.me.downedLeft) }), kind: 'info', main: 'blocked' as const };
    if (c.cq?.ended) return { text: '', kind: 'info', main: 'blocked' as const };
    if (ph === 'sending') return { text: t('deploy.sending'), kind: 'info', main: 'sending' as const };
    if (ph === 'armed') return { text: wait > 0 ? t('deploy.waitingIn', { spawn: sel?.name ?? '—', kit: kitName, s: Math.ceil(wait) }) : t('deploy.waiting', { spawn: sel?.name ?? '—', kit: kitName }), kind: 'info', main: 'cancel' as const };
    const w = this.weapon(c);
    if (!c.kits.includes(this.kit) || w.available === false) return { text: t('deploy.kitInvalid'), kind: 'warn', main: 'blocked' as const };
    if (!this.targets.some((x) => x.available)) return { text: t('deploy.noTargets'), kind: 'warn', main: 'blocked' as const };
    if (!sel) return { text: t('deploy.pickSpawn'), kind: 'info', main: 'blocked' as const };
    if (!sel.available) return { text: `${t('deploy.spawnLost')} (${t(sel.reason ?? 'deploy.reasonBlocked')})`, kind: 'warn', main: 'blocked' as const };
    if (wait > 0) return { text: t('deploy.waitIn', { s: Math.ceil(wait) }), kind: 'info', main: 'deploy' as const };
    return { text: '', kind: 'info', main: 'deploy' as const };
  }

  private render(c: DeployContext, sel: DeployTarget | null, life: IntentInput['life'], wait: number) {
    const cq = c.cq;
    const fac = this.fac(c);
    const rel = (team: Team) => (team === c.team ? 'own' : 'enemy');
    const enemy: Team = c.team === 'teamA' ? 'teamB' : 'teamA';
    const top = h('header', { class: 'pf-deploy-top' },
      h('div', { class: 'pf-deploy-title' }, h('b', {}, c.doc.name), h('span', { class: 'pf-dim' }, cq ? 'Conquest' : t('mode.free')), this.teamSwitch(c, life) ?? h('span', {}, `${t('deploy.team')}: `, h('b', { class: 'own' }, FACTION_LABEL[fac]))),
      h('div', { class: 'pf-deploy-banner' }, t('deploy.selectSpawn')),
      cq ? h('div', { class: 'pf-tickets tnum' }, h('span', { class: rel(c.team), 'data-live': 'own' }, `${cq.tickets[c.team]}`), h('span', { class: 'pf-dim', 'data-live': 'time' }, fmtTime(cq.timeLimit - cq.time)), h('span', { class: rel(enemy), 'data-live': 'enemy' }, `${cq.tickets[enemy]}`)) : h('div'),
      tabs([{ id: 'deploy', label: t('deploy.tabDeploy') }, ...c.extraTabs.map((x) => ({ id: x.id, label: x.label }))], this.tab, (id) => {
        this.tab = id;
        this.lastKey = '';
      }),
    );
    const extra = c.extraTabs.find((x) => x.id === this.tab);
    const st = this.status(c, sel, life, wait);
    let body: HTMLElement;
    if (extra?.full) body = h('div', { class: 'pf-deploy-extra' }, extra.view());
    else {
      const left = extra ? h('div', { class: 'pf-deploy-left' }, extra.view()) : this.kitPanel(c);
      const right = h('div', { class: 'pf-deploy-right' }, this.mapView.root);
      // Seznam míst je vlastní sloupec vedle mapy (nepřekrývá body na mapě).
      body = extra ? h('div', { class: 'pf-deploy-body' }, left, right) : h('div', { class: 'pf-deploy-body with-list' }, left, this.spawnList(sel), right);
    }
    // Spodní pruh: classa, místo (rozbalovací seznam = stejný výběr jako mapa), stav, akce.
    const msg = this.intent.note ? t(this.intent.note.key, this.intent.note.vars) : this.message?.text;
    const msgKind = this.intent.note?.kind ?? this.message?.kind ?? st.kind;
    let main: HTMLElement;
    const inp = (): IntentInput => ({ now: performance.now() / 1000, life, lifeId: c.me.lifeId ?? 0, waitLeft: Math.max(0, c.me.respawnAt - (this.ctx?.simTime ?? c.simTime)), target: this.targets.find((x) => x.id === this.target) ?? null, kitOk: c.kits.includes(this.kit), roundKey: c.roundKey, ended: !!cq?.ended });
    if (st.main === 'back') main = button(t('deploy.back'), () => this.onClose(), 'pf-btn primary big pf-deploy-go');
    else if (st.main === 'cancel') main = button(t('deploy.cancelWait'), () => {
      this.intent.cancel();
      this.lastKey = '';
    }, 'pf-btn big danger pf-deploy-go');
    else if (st.main === 'sending') main = button(t('deploy.sending'), () => {}, 'pf-btn primary big pf-deploy-go', { disabled: true });
    else main = button(t('deploy.deploy'), () => {
      this.message = null;
      this.intent.confirm(inp());
      this.lastKey = '';
    }, 'pf-btn primary big pf-deploy-go', { disabled: st.main === 'blocked', title: st.text || undefined });
    const secondary = life !== 'alive' ? button(t('common.close'), () => this.onClose(), 'pf-btn') : null;
    // Živý hráč: „Znovu nasadit“ (s varováním) – zvolené místo a výbava se použijí hned po čekání.
    const redeploy = life === 'alive' && this.onRedeploy ? button(t('pause.redeploy'), () => void this.confirmRedeploy(), 'pf-btn danger') : null;
    const leave = this.onLeave ? button(`⏏ ${this.leaveNetwork ? t('pause.disconnect') : t('pause.leave')}`, () => void this.confirmLeave(), 'pf-btn pf-deploy-leave') : null;
    const bottom = h('footer', { class: 'pf-deploy-bottom' },
      leave,
      h('div', { class: 'pf-deploy-sum' }, h('span', { class: 'pf-dim' }, `${t('deploy.class')}: `), h('b', {}, KIT_LABEL[this.kit])),
      h('div', { class: 'pf-deploy-sum' }, h('span', { class: 'pf-dim' }, `${t('deploy.place')}: `), h('b', {}, sel?.name ?? t('deploy.placeNone'))),
      h('div', { class: `pf-deploy-msg ${msg ? msgKind : ''}`, role: 'status', 'aria-live': 'polite' }, msg ? h('div', {}, msg) : null, st.text && st.text !== msg ? h('div', { class: msg ? 'pf-dim' : '', 'data-live': 'status' }, st.text) : null),
      h('div', { class: 'pf-row-inline' }, redeploy, secondary, main),
    );
    this.root.replaceChildren(top, body, bottom);
    this.silKey = '';
    this.drawSil();
  }

  /**
   * Přepínač týmů v horní liště: oba týmy s počtem hráčů, vlastní zvýrazněný. Přechod mimo boj
   * hned; za živa po potvrzení (postava zemře – počítá se jako smrt). Plný / přeplněný tým nelze.
   */
  private teamSwitch(c: DeployContext, life: IntentInput['life']): HTMLElement | null {
    const info = this.teamInfo?.();
    if (!info || !this.onTeamSwitch || c.me.spectator) return null;
    const box = h('div', { class: 'pf-teamswitch', role: 'group', 'aria-label': t('deploy.team') });
    box.append(h('span', { class: 'pf-dim' }, `${t('deploy.team')}:`));
    for (const team of ['teamA', 'teamB'] as Team[]) {
      const own = team === c.team;
      const n = info.counts[team];
      const full = n >= info.size;
      const unbalanced = !own && n + 1 - (info.counts[c.team] - 1) > 1;
      const label = h('span', {}, h('b', {}, FACTION_LABEL[info.factions[team]]), h('small', { class: 'tnum' }, ` ${n}/${info.size}`));
      if (own) {
        box.append(h('span', { class: `pf-team own ${team === 'teamA' ? 'a' : 'b'}`, title: t('deploy.teamYours') }, label));
        continue;
      }
      const why = full ? t('deploy.teamFull') : unbalanced ? t('deploy.teamUnbalanced') : '';
      const b = button('', () => void this.switchTo(team, life), `pf-team other ${team === 'teamA' ? 'a' : 'b'}`, { disabled: !!why, title: why || t('deploy.teamSwitch') });
      b.replaceChildren(h('span', { class: 'pf-team-arrow', 'aria-hidden': 'true' }, '⇄'), label);
      box.append(b);
    }
    return box;
  }

  private async switchTo(team: Team, life: IntentInput['life']) {
    if (life !== 'dead') {
      const ch = await dialog(t('deploy.teamSwitchTitle'), h('p', { class: 'pf-warn' }, t(life === 'alive' ? 'deploy.teamSwitchAlive' : 'deploy.teamSwitchDowned')), [
        { id: 'no', label: t('common.cancel') },
        { id: 'yes', label: t('deploy.teamSwitch'), danger: true, primary: true },
      ]);
      if (ch !== 'yes') return;
      if (this.lastLife === 'alive') this.onRedeploy?.();
      else if (this.lastLife !== 'dead') return; // vyřazený: nejdřív „Vzdát pomoc“
    }
    this.onTeamSwitch?.(team);
    this.lastKey = '';
  }

  private async confirmLeave() {
    const net = this.leaveNetwork;
    const ch = await dialog(net ? t('pause.disconnect') : t('pause.leave'), net ? t('pause.confirmLeave') : t('pause.confirmTraining'), [
      { id: 'no', label: t('common.cancel') },
      { id: 'yes', label: net ? t('pause.disconnect') : t('pause.leave'), danger: true, primary: true },
    ]);
    if (ch === 'yes') this.onLeave?.();
  }

  private async confirmRedeploy() {
    const ch = await dialog(t('pause.redeployTitle'), h('p', { class: 'pf-warn' }, t('pause.redeployConfirm')), [
      { id: 'no', label: t('common.cancel') },
      { id: 'yes', label: t('pause.redeploy'), danger: true, primary: true },
    ]);
    // Mezitím mohl hráč zemřít nebo být vyřazen – potvrzení platí jen pro živého.
    if (ch === 'yes' && this.lastLife === 'alive') this.onRedeploy?.();
  }

  /** Levý panel: classy v kompaktních řádcích, pod nimi kit (silueta, mířidla, výbava). */
  private kitPanel(c: DeployContext) {
    const fac = this.fac(c);
    const left = h('div', { class: 'pf-deploy-left' });
    if (!c.faction) {
      const fs = h('div', { class: 'pf-row-inline' }, ...PILOT.factions.map((f) => button(FACTION_LABEL[f], () => {
        this.faction = f;
        this.save();
        this.intent.selectionChanged();
        this.lastKey = '';
      }, `pf-btn small${this.faction === f ? ' on' : ''}`)));
      left.append(h('div', { class: 'pf-label' }, t('deploy.faction')), fs);
    }
    left.append(h('div', { class: 'pf-label' }, t('deploy.class')));
    const rows = h('div', { class: 'pf-classes', role: 'radiogroup', 'aria-label': t('deploy.class') });
    const sils: Array<[HTMLCanvasElement, string]> = [];
    for (const [i, k] of c.kits.entries()) {
      const w = weaponFor(fac, k);
      const unavailable = w.available === false;
      const sil = h('canvas', { class: 'pf-card-sil' }) as HTMLCanvasElement;
      sils.push([sil, w.id]);
      // Ikony výbavy kitu (nůž, pistole, granáty, nástroje) v řadě pod zbraní.
      const gear = h('div', { class: 'pf-card-gear' }, ...kitItems(fac, k).filter((it) => it.kind !== 'primary').map((it) => {
        const g = icon(ITEM_ICON[it.kind] ?? ITEM_ICON.ammo);
        g.classList.add('pf-gear');
        g.title = it.kind === 'pistol' ? it.name : t(`item.${it.kind}` as StringKey);
        return g;
      }));
      const row = h('button', { class: `pf-class pf-kitcard${this.kit === k ? ' on' : ''}${unavailable ? ' off' : ''}`, type: 'button', role: 'radio', 'aria-checked': this.kit === k ? 'true' : 'false', title: `${KIT_LABEL[k]} – ${w.name}` },
        h('div', { class: 'pf-card-head' }, icon(KIT_ICON[k]), h('b', {}, KIT_LABEL[k]), h('span', { class: 'pf-dim' }, unavailable ? t('deploy.unavailableKit') : t(`kit.${k}.role` as StringKey)), h('span', { class: 'pf-class-key' }, String(i + 1))),
        h('div', { class: 'pf-card-body' }, sil, gear));
      row.addEventListener('click', () => this.selectKit(k));
      rows.append(row);
    }
    requestAnimationFrame(() => {
      for (const [cv, id] of sils) {
        const r = cv.getBoundingClientRect();
        if (r.width > 0) drawSilhouette(cv, id, r.width, r.height, 'rgba(236,238,228,0.92)');
      }
    });
    left.append(rows);
    const w = this.weapon(c);
    const e = arsenalEntry(w.id)!;
    const sight = e.sight.kind === 'scope' ? t('sight.scope', { z: e.sight.zoom ?? 1 }) : t(`sight.${e.sight.kind}` as StringKey);
    const items = kitItems(fac, this.kit);
    const kitBox = h('div', { class: 'pf-equip' },
      h('div', { class: 'pf-kit-title' }, t('deploy.kitTitle', { faction: FACTION_LABEL[fac], kit: KIT_LABEL[this.kit] })),
      h('div', { class: 'pf-kit-weapon' }, h('b', {}, w.name), h('span', { class: 'pf-dim' }, ` · ${t('deploy.sights')}: ${sight}`)),
      this.weaponStats(w.id),
      h('ul', { class: 'pf-kit-items' }, ...items.map((it) => {
        const name = it.kind === 'primary' || it.kind === 'pistol' ? it.name : t(`item.${it.kind}` as StringKey);
        const li = h('li', { tabindex: '0', title: it.kind === 'primary' ? '' : t(`item.${it.kind}.desc` as StringKey) }, h('span', { class: 'pf-slot' }, String(it.slot)), h('span', {}, name), it.count ? h('span', { class: 'pf-dim tnum' }, `× ${it.count}`) : null);
        return li;
      })),
      h('p', { class: 'pf-dim' }, t(`kit.${this.kit}.note` as StringKey)),
    );
    left.append(kitBox);
    return left;
  }

  /** Skutečné hodnoty zbraně z pravidel hry (stejná data jako server), ne odhady. */
  private weaponStats(id: string) {
    const r = rulesOf(id);
    const pel = r.pellets ?? 1;
    const dmg = r.damage.near * pel;
    const rpm = Math.round(60 / r.fireInterval);
    const rows: Array<[string, number, string]> = [
      [t('stat.damage'), Math.min(1, dmg / 100), pel > 1 ? `${pel} × ${r.damage.near}` : String(r.damage.near)],
      [t('stat.rate'), Math.min(1, rpm / 900), `${rpm} ${t('stat.rpm')}`],
      [t('stat.range'), Math.min(1, r.damage.farRange / 400), `${r.damage.nearRange}–${r.damage.farRange} m`],
      [t('stat.mag'), Math.min(1, r.magazine / 100), `${r.magazine} / ${r.reserve}`],
      [t('stat.reload'), Math.min(1, 1 - Math.min(1, (r.reloadKind === 'single' ? (r.shellInsert ?? 0.5) * r.magazine : r.reloadEmpty) / 8)), r.reloadKind === 'single' ? `${(r.shellInsert ?? 0.5).toFixed(1)} s ${t('stat.perShell')}` : `${r.reloadPartial.toFixed(1)} s`],
    ];
    return h('div', { class: 'pf-stats' }, ...rows.map(([label, f, val]) => h('div', { class: 'pf-stat' }, h('span', { class: 'pf-dim' }, label), (() => {
      const bar = h('i', {});
      bar.style.width = `${Math.round(f * 100)}%`;
      return h('span', { class: 'pf-stat-bar' }, bar);
    })(), h('span', { class: 'tnum' }, val))));
  }

  /** Seznam míst nasazení přes mapu: stejný výběr jako klik do mapy, se stavem a důvodem nedostupnosti. */
  private spawnList(sel: DeployTarget | null) {
    const list = h('div', { class: 'pf-spawn-list', role: 'radiogroup', 'aria-label': t('deploy.place') }, h('div', { class: 'pf-label' }, t('deploy.place')));
    for (const tg of this.targets) {
      const b = h('button', { class: `pf-spawn ${tg.rel}${tg.available ? '' : ' off'}${sel?.id === tg.id ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': sel?.id === tg.id ? 'true' : 'false' },
        h('i', {}), h('b', {}, tg.name), h('small', {}, tg.available ? t('map.available') : t(tg.reason ?? 'deploy.reasonBlocked')));
      b.addEventListener('click', () => this.selectTarget(tg.id));
      b.addEventListener('dblclick', () => {
        if (tg.available && this.intent.phase === 'idle') this.primaryAction();
      });
      list.append(b);
    }
    list.append(h('small', { class: 'pf-dim' }, t('deploy.dblHint')));
    return list;
  }

  private drawSil() {
    const id = this.weapon().id;
    if (this.silKey === id) return;
    this.silKey = id;
    requestAnimationFrame(() => {
      const r = this.silCanvas.getBoundingClientRect();
      if (r.width > 0) drawSilhouette(this.silCanvas, id, r.width, r.height);
    });
  }

  /** Čip potvrzeného čekání (vidět i při zavřené obrazovce). */
  private renderChip(c: DeployContext, sel: DeployTarget | null, wait: number) {
    const armed = this.intent.phase !== 'idle';
    const show = armed && !this.visible;
    this.chip.classList.toggle('hidden', !show);
    if (!show) return;
    const text = this.intent.phase === 'sending' ? t('deploy.sending') : wait > 0 ? t('deploy.waitingIn', { spawn: sel?.name ?? '—', kit: KIT_LABEL[this.kit], s: Math.ceil(wait) }) : t('deploy.waiting', { spawn: sel?.name ?? '—', kit: KIT_LABEL[this.kit] });
    if (this.chip.dataset.text === text) return;
    this.chip.dataset.text = text;
    this.chip.replaceChildren(h('span', {}, text), button(t('deploy.cancelWait'), () => this.intent.cancel(), 'pf-btn small'), h('small', { class: 'pf-dim' }, t('deploy.chipHint')));
    void c;
  }

  /** Pro testy a náhled. */
  get selection() {
    return { kit: this.kit, target: this.target, faction: this.faction, phase: this.intent.phase };
  }
}
