import type { MapDocument, SpawnPoint, Team } from '../../shared/map/schema';
import type { ConquestState } from '../../shared/sim/conquest';
import { ARSENAL, KIT_LABEL, PILOT, arsenalEntry, rulesOf, weaponFor, type Faction, type Kit } from '../../shared/config/arsenal';
import type { PlayerView } from '../runtime/driver';
import { t } from './i18n';
import { button, fmtTime, h, legend, tabs } from './kit';
import { TacticalMap, playArea } from './tactical';

/**
 * Obrazovka nasazení a respawnu: jedna taktická obrazovka (žádný průchod modálními okny).
 * Volbu classy a místa si pamatuje, před nasazením ji ověří server; odmítnutí a ztrátu
 * místa vysvětlí – hráče nikdy potichu nepřesune jinam. Odpočet jen ze stavu autority.
 */
export interface DeployContext {
  doc: MapDocument;
  map: TacticalMap;
  me: PlayerView;
  team: Team;
  cq: ConquestState | null;
  spawns: SpawnPoint[];
  /** Frakce týmu (null = volný test – výběr frakce hráčem). */
  faction: Faction | null;
  kits: Kit[];
  simTime: number;
  teammates: Array<{ id: string; pos: [number, number]; squad: boolean; leader: boolean }>;
  /** Doplňkové záložky (Squad, Commander) – jen pokud je server podporuje. */
  extraTabs: Array<{ id: string; label: string; view: () => HTMLElement }>;
  /** Hráč je naživu (změna classy platí pro příští nasazení, okamžité nasazení není). */
  alive: boolean;
}

export class DeployScreen {
  readonly root = h('div', { id: 'pf-deploy', class: 'pf-screen pf-deploy hidden' });
  private kit: Kit = 'assault';
  private faction: Faction = 'usmc';
  private spawn: string | null = null;
  private tab = 'deploy';
  private message: { text: string; kind: 'warn' | 'info' } | null = null;
  private lastKey = '';
  private canvas = h('canvas', { class: 'pf-deploy-map', 'aria-label': 'map' }) as HTMLCanvasElement;
  private ctx: DeployContext | null = null;
  /** Žádost o nasazení (vrací okamžitý důvod odmítnutí, nebo null – síťové odmítnutí přijde přes reject()). */
  onDeploy: (spawnId: string | null, weaponId: string) => string | null = () => null;

  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem('pf.deploy') ?? '{}');
      if (typeof v.kit === 'string') this.kit = v.kit;
      if (typeof v.faction === 'string') this.faction = v.faction;
    } catch {
      /* výchozí */
    }
    this.canvas.addEventListener('click', (e) => this.pick(e));
    document.body.append(this.root);
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    if (!v) this.lastKey = '';
  }

  /** Server nasazení odmítl: důvod zobrazit, volbu nechat k úpravě. */
  reject(reason: string) {
    this.message = { text: t('deploy.rejected', { reason }), kind: 'warn' };
    this.lastKey = '';
  }

  dispose() {
    this.root.remove();
  }

  private save() {
    try {
      localStorage.setItem('pf.deploy', JSON.stringify({ kit: this.kit, faction: this.faction }));
    } catch {
      /* ignorovat */
    }
  }

  private weapon(c: DeployContext) {
    return weaponFor(c.faction ?? this.faction, this.kit);
  }

  update(c: DeployContext) {
    this.ctx = c;
    if (!c.kits.includes(this.kit)) this.kit = c.kits[0];
    // Zneplatnění volby: ztráta bodu / smrt leadera → vysvětlit, nepřesouvat.
    if (this.spawn && !c.spawns.some((s) => s.id === this.spawn)) {
      this.spawn = null;
      this.message = { text: t('deploy.spawnLost'), kind: 'warn' };
    }
    if (!this.spawn && c.cq && c.spawns.length === 1) this.spawn = c.spawns[0].id;
    const wait = Math.max(0, c.me.respawnAt - c.simTime);
    const key = [this.tab, this.kit, this.faction, this.spawn, c.spawns.map((s) => s.id).join(), Math.ceil(wait), this.message?.text, c.alive, c.cq?.tickets.teamA, c.cq?.tickets.teamB, Math.floor((c.cq?.time ?? 0))].join('|');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.render(c, wait);
    }
    this.drawMap(c);
  }

  private render(c: DeployContext, wait: number) {
    const cq = c.cq;
    const ownCol = (team: Team) => (team === c.team ? 'own' : 'enemy');
    const top = h('header', { class: 'pf-deploy-top' },
      h('div', { class: 'pf-deploy-title' }, h('b', {}, c.doc.name), h('span', { class: 'pf-dim' }, cq ? 'Conquest' : t('mode.free')), h('span', {}, `${t('deploy.team')}: `, h('b', { class: 'own' }, (c.faction ?? this.faction).toUpperCase()))),
      cq
        ? h('div', { class: 'pf-tickets tnum' }, h('span', { class: ownCol('teamA') }, `${cq.tickets.teamA}`), h('span', { class: 'pf-dim' }, fmtTime(cq.timeLimit - cq.time)), h('span', { class: ownCol('teamB') }, `${cq.tickets.teamB}`))
        : h('div'),
      tabs([{ id: 'deploy', label: t('deploy.tabDeploy') }, ...c.extraTabs.map((x) => ({ id: x.id, label: x.label }))], this.tab, (id) => {
        this.tab = id;
        this.lastKey = '';
      }),
    );
    let body: HTMLElement;
    const extra = c.extraTabs.find((x) => x.id === this.tab);
    if (extra) body = h('div', { class: 'pf-deploy-extra' }, extra.view());
    else {
      // Levá třetina: classy a výbava.
      const left = h('div', { class: 'pf-deploy-left' });
      if (!c.faction) {
        // Volný test: frakci volí hráč (pilot USMC × MEC).
        const fs = h('div', { class: 'pf-row-inline' }, ...PILOT.factions.map((f) => button(f.toUpperCase(), () => {
          this.faction = f;
          this.save();
          this.lastKey = '';
        }, `pf-btn${this.faction === f ? ' on' : ''}`)));
        left.append(h('div', { class: 'pf-label' }, t('deploy.faction')), fs);
      }
      left.append(h('div', { class: 'pf-label' }, t('deploy.class')));
      for (const k of c.kits) {
        const w = weaponFor(c.faction ?? this.faction, k);
        const unavailable = w.available === false;
        const card = h('button', { class: `pf-class${this.kit === k ? ' on' : ''}${unavailable ? ' unavailable' : ''}`, type: 'button', 'aria-pressed': this.kit === k ? 'true' : 'false' },
          h('b', {}, KIT_LABEL[k]), h('span', { class: 'pf-dim' }, t(`kit.${k}.role` as never)), h('span', {}, unavailable ? t('deploy.weaponPending', { name: w.name }) : w.name));
        card.addEventListener('click', () => {
          this.kit = k;
          this.save();
          this.message = null;
          this.lastKey = '';
        });
        left.append(card);
      }
      const w = this.weapon(c);
      const R = rulesOf(w.id);
      left.append(h('div', { class: 'pf-equip' },
        h('div', { class: 'pf-label' }, t('deploy.equipment')),
        h('div', { class: 'pf-kv' },
          h('span', {}, t('deploy.weapon')), h('b', {}, w.name),
          h('span', {}, t('deploy.ammo')), h('b', { class: 'tnum' }, `${R.magazine} + ${R.reserve}`),
          h('span', {}, t('deploy.modes')), h('b', {}, R.modes.map((m) => (m === 'auto' ? 'AUTO' : 'SEMI')).join(' / ')),
          h('span', {}, t('deploy.health')), h('b', { class: 'tnum' }, String(PILOT.maxHp)),
        ),
        h('p', { class: 'pf-dim' }, t(`kit.${this.kit}.note` as never)),
      ));
      // Pravé dvě třetiny: taktická mapa s legendou.
      const right = h('div', { class: 'pf-deploy-right' }, this.canvas, legend([
        { symbol: '■', cls: 'own', label: t('legend.spawn') },
        { symbol: '◆', cls: 'sel', label: t('legend.selected') },
        { symbol: '★', cls: 'squad', label: t('legend.leader') },
        { symbol: '⬢', cls: 'own', label: t('legend.base') },
        { symbol: '●', cls: 'neutral', label: t('legend.cp') },
        { symbol: '✕', cls: 'dim', label: t('legend.unavailable') },
      ]));
      body = h('div', { class: 'pf-deploy-body' }, left, right);
    }
    // Spodní pruh: classa, místo, odpočet, Nasadit (nedostupné tlačítko vysvětluje proč).
    const w = this.weapon(c);
    const spawnName = this.spawnName(c);
    let reason = '';
    if (c.alive) reason = t('deploy.aliveNote');
    else if (w.available === false) reason = t('deploy.weaponPending', { name: w.name });
    else if (wait > 0) reason = t('deploy.wait', { s: Math.ceil(wait) });
    else if (c.cq && !c.spawns.length) reason = t('deploy.noSpawns');
    else if (c.cq && !this.spawn) reason = t('deploy.pickSpawn');
    const go = button(wait > 0 && !c.alive ? t('deploy.deployIn', { s: Math.ceil(wait) }) : t('deploy.deploy'), () => {
      this.message = null;
      const err = this.onDeploy(c.cq ? this.spawn : null, w.id);
      if (err) this.reject(err);
    }, 'pf-btn primary big', { disabled: !!reason, title: reason || undefined });
    const bottom = h('footer', { class: 'pf-deploy-bottom' },
      h('div', {}, h('span', { class: 'pf-dim' }, `${t('deploy.class')}: `), h('b', {}, `${KIT_LABEL[this.kit]} – ${w.name}`)),
      h('div', {}, h('span', { class: 'pf-dim' }, `${t('deploy.spawn')}: `), h('b', {}, spawnName ?? '—')),
      h('div', { class: `pf-deploy-msg ${this.message?.kind ?? ''}` }, this.message?.text ?? reason),
      go,
    );
    this.root.replaceChildren(top, body, bottom);
  }

  private spawnName(c: DeployContext) {
    if (!c.cq) return t('deploy.testSpawn');
    const s = c.spawns.find((x) => x.id === this.spawn);
    if (!s) return null;
    if (s.id.startsWith('squad:')) return t('deploy.leaderSpawn');
    const cp = c.cq.cps.find((x) => x.id === s.controlPointId);
    return cp ? cp.name : t('legend.base');
  }

  private view(c: DeployContext, w: number, hh: number) {
    const win = playArea(c.doc) ?? c.map.bounds;
    const scale = c.map.fit(w, hh, 24, win);
    const cx = (win.x0 + win.x1) / 2, cz = (win.z0 + win.z1) / 2;
    return { cx, cz, scale, w2s: TacticalMap.w2s(cx, cz, w / 2, hh / 2, scale) };
  }

  private drawMap(c: DeployContext) {
    if (this.tab !== 'deploy' || !this.canvas.isConnected) return;
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(200, Math.round(r.width)), hh = Math.max(160, Math.round(r.height));
    if (this.canvas.width !== w || this.canvas.height !== hh) {
      this.canvas.width = w;
      this.canvas.height = hh;
    }
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#151b1b';
    g.fillRect(0, 0, w, hh);
    const v = this.view(c, w, hh);
    c.map.draw(g, v.cx, v.cz, w / 2, hh / 2, v.scale);
    const css = getComputedStyle(document.documentElement);
    const col = { own: css.getPropertyValue('--pf-team').trim(), enemy: css.getPropertyValue('--pf-enemy').trim(), neutral: css.getPropertyValue('--pf-neutral').trim(), squad: css.getPropertyValue('--pf-squad').trim(), sel: css.getPropertyValue('--pf-accent').trim() };
    g.font = '600 12px "Barlow Semi Condensed", sans-serif';
    for (const cp of c.cq?.cps ?? c.doc.controlPoints.map((x) => ({ ...x, pos: x.position, owner: x.defaultOwner, p: 0, activity: null }))) {
      const [x, y] = v.w2s(cp.pos[0], cp.pos[2]);
      const owner = cp.owner === 'neutral' ? 'neutral' : cp.owner === c.team ? 'own' : 'enemy';
      g.strokeStyle = col[owner as 'own'];
      g.fillStyle = col[owner as 'own'] + '33';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, Math.max(8, cp.radius * v.scale), 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#e5e7d8';
      g.fillText(cp.name, x + 10, y - 10);
    }
    for (const tm of c.teammates) {
      const [x, y] = v.w2s(tm.pos[0], tm.pos[1]);
      g.fillStyle = tm.squad ? col.squad : col.own;
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    const avail = new Set(c.spawns.map((s) => s.id));
    for (const s of c.doc.spawnPoints.filter((x) => x.teams.includes(c.team))) {
      const [x, y] = v.w2s(s.position[0], s.position[2]);
      if (!avail.has(s.id)) {
        g.strokeStyle = '#6b7067';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - 5, y - 5);
        g.lineTo(x + 5, y + 5);
        g.moveTo(x + 5, y - 5);
        g.lineTo(x - 5, y + 5);
        g.stroke();
      }
    }
    for (const s of c.spawns) {
      const [x, y] = v.w2s(s.position[0], s.position[2]);
      const sel = s.id === this.spawn;
      if (s.id.startsWith('squad:')) {
        g.fillStyle = sel ? col.sel : col.squad;
        star(g, x, y, sel ? 11 : 9);
      } else if (sel) {
        g.fillStyle = col.sel;
        g.beginPath();
        g.moveTo(x, y - 9);
        g.lineTo(x + 9, y);
        g.lineTo(x, y + 9);
        g.lineTo(x - 9, y);
        g.closePath();
        g.fill();
      } else {
        g.fillStyle = col.own;
        g.fillRect(x - 6, y - 6, 12, 12);
      }
    }
    if (c.me.alive || c.me.life === 'downed') {
      const [x, y] = v.w2s(c.me.state.pos.x, c.me.state.pos.z);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.strokeRect(x - 5, y - 5, 10, 10);
    }
  }

  private pick(e: MouseEvent) {
    const c = this.ctx;
    if (!c) return;
    const r = this.canvas.getBoundingClientRect();
    const v = this.view(c, this.canvas.width, this.canvas.height);
    const mx = ((e.clientX - r.left) / r.width) * this.canvas.width, my = ((e.clientY - r.top) / r.height) * this.canvas.height;
    let best: SpawnPoint | null = null, bd = 22;
    for (const s of c.spawns) {
      const [x, y] = v.w2s(s.position[0], s.position[2]);
      const d = Math.hypot(x - mx, y - my);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) {
      this.spawn = best.id;
      this.message = null;
      this.lastKey = '';
    }
  }

  /** Pro testy a náhled. */
  get selection() {
    return { kit: this.kit, spawn: this.spawn, faction: this.faction };
  }
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

export { ARSENAL, arsenalEntry };
