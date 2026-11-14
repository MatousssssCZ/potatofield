import type { MapDocument, SpawnPoint, Team } from '../../shared/map/schema';
import type { ConquestState } from '../../shared/sim/conquest';
import { PILOT, arsenalEntry, isGun, rulesOf, type Faction, type Kit } from '../../shared/config/arsenal';
import type { ContactInfo, OrderInfo, SquadInfo } from '../../shared/net/protocol';
import type { PlayerView } from '../runtime/driver';
import { drawSilhouette } from './silhouette';
import { t, type StringKey } from './i18n';
import { button, fmtTime, h } from './kit';
import { DeployScreen } from './deploy';
import { MapView } from './mapView';
import { SlotOverlay } from './slots';
import { TacticalMap } from './tactical';

/**
 * Herní HUD (DOM nad canvasem, aktualizace ~20×/s): rozložení podle zadání HUD –
 * vpravo nahoře minimapa s tickety a časem, vlevo nahoře kill feed / systém / chat,
 * vlevo dole zdraví, výdrž, postoj a četa, vpravo dole silueta výbavy a munice,
 * uprostřed zaměřovač, interakce, obsazování a identifikace. Zobrazuje jen data,
 * která předá herní systém (zdraví, munice, tickety, kontakty).
 */
export interface HudContext {
  now: number;
  me: PlayerView | null;
  team: Team;
  cq: ConquestState | null;
  doc: MapDocument;
  simTime: number;
  spawns: SpawnPoint[];
  faction: Faction | null;
  kits: Kit[];
  remotes: PlayerView[];
  map: TacticalMap | null;
  squads: SquadInfo[];
  contacts: ContactInfo[];
  order: OrderInfo | null;
  /** Kontextová interakce (např. „Drž E – oživit“) a průběh 0–1. */
  interaction: { text: string; progress: number } | null;
  /** Jméno identifikovaného nepřítele (po souvislém zamíření, ne přes zeď). */
  identified: string | null;
  extraTabs: Array<{ id: string; label: string; view: () => HTMLElement; full?: boolean }>;
  network: boolean;
  /** Sekundy do dalšího kola na serveru (0 = neznámo / kolo běží). */
  nextRound?: number;
  /** Jméno hráče, kterého pozorovatel sleduje. */
  spectating?: string;
}

export class Hud {
  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private killfeed: Array<{ el: HTMLElement; until: number }> = [];
  private sysmsg: Array<{ el: HTMLElement; until: number }> = [];
  private hitUntil = 0;
  readonly deploy = new DeployScreen();
  readonly slots = new SlotOverlay();
  /** Mapa na M: jen prohlížení (žádné nasazení), stejné značky jako obrazovka nasazení. */
  private mapView = new MapView();
  private mapOverlay = h('div', { class: 'pf-screen pf-mapover hidden', role: 'dialog' });
  get mapVisible() {
    return !this.mapOverlay.classList.contains('hidden');
  }
  toggleMap(v = !this.mapVisible) {
    this.mapOverlay.classList.toggle('hidden', !v);
    if (v) this.drawMapOverlay();
  }
  private drawMapOverlay() {
    const c = this.deploy.lastContext;
    if (!c || !this.mapVisible) return;
    this.mapView.setMap(c.map, this.deploy.mapWindow(c));
    this.mapView.setMarkers(this.deploy.markers(c).map((m) => ({ ...m, selectable: false })), null);
  }
  private minimap: HTMLCanvasElement;
  private silhouette: HTMLCanvasElement;
  private silId = '';
  private giveUpHeld = -1;
  private endShown = false;
  onSpawn: (id: string | null, weaponId: string | null) => string | null = () => null;
  onRestart: () => void = () => {};
  onGiveUp: () => void = () => {};
  onCallMedic: () => void = () => {};
  onLeave: () => void = () => {};

  constructor() {
    this.root = document.getElementById('hud')!;
    const mk = (id: string, cls: string, tag: 'div' | 'canvas' = 'div') => {
      let e = document.getElementById(id);
      if (!e) {
        e = document.createElement(tag);
        e.id = id;
        e.className = cls;
        this.root.appendChild(e);
      }
      this.els[id] = e;
      return e;
    };
    mk('h-tl', 'h-tl');
    mk('h-feed', 'h-feed');
    mk('h-sys', 'h-sys');
    mk('h-tr', 'h-tr');
    this.minimap = mk('h-minimap', 'h-minimap', 'canvas') as HTMLCanvasElement;
    this.els['h-tr'].append(this.minimap);
    mk('h-cpbar', 'h-cpbar');
    this.els['h-tr'].append(this.els['h-cpbar']);
    mk('h-score', 'h-score tnum');
    this.els['h-tl'].append(this.els['h-feed'], this.els['h-sys']);
    mk('h-bl', 'h-bl');
    mk('h-squad', 'h-squad');
    mk('h-vitals', 'h-vitals');
    this.els['h-bl'].append(this.els['h-squad'], this.els['h-vitals']);
    mk('h-br', 'h-br');
    this.silhouette = mk('h-sil', 'h-sil', 'canvas') as HTMLCanvasElement;
    mk('h-ammo', 'h-ammo tnum');
    this.els['h-br'].append(this.slots.root, this.silhouette, this.els['h-ammo']);
    mk('h-hit', 'h-hit');
    mk('h-hurt', 'h-hurt');
    mk('h-spec', 'h-spec hidden');
    mk('h-killer', 'h-killer hidden');
    mk('h-dirs', 'h-dirs');
    mk('h-center', 'h-center');
    mk('h-zone', 'h-zone hidden');
    mk('h-downed', 'h-downed hidden');
    mk('h-end', 'h-end hidden');
    // Stávající prvky (zaměřovač, výdrž, postoj) se přesunou do nového rozložení.
    const st = document.getElementById('stamina');
    const sc = document.getElementById('stance');
    if (st) st.remove();
    if (sc) sc.remove();
    this.deploy.onDeploy = (id, w) => this.onSpawn(id, w);
    this.mapOverlay.append(h('header', {}, h('h2', {}, t('mapview.title')), h('span', { class: 'pf-dim' }, 'M / Esc')), this.mapView.root);
    document.body.append(this.mapOverlay);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyG' && !this.els['h-downed'].classList.contains('hidden') && this.giveUpHeld < 0) this.giveUpHeld = performance.now();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyG') this.giveUpHeld = -1;
  };

  setCrosshair(radiusPx: number, visible: boolean) {
    const ch = document.getElementById('crosshair')!;
    ch.style.display = visible ? '' : 'none';
    const r = Math.max(4, Math.min(120, radiusPx));
    const parts = ch.children as HTMLCollectionOf<HTMLElement>;
    parts[0].style.top = `${-r - 8}px`;
    parts[1].style.top = `${r}px`;
    parts[2].style.left = `${-r - 8}px`;
    parts[3].style.left = `${r}px`;
  }

  /** Vlastní zranění: červený okraj obrazu úměrný poškození, rychle mizí. */
  damage(now: number, amount: number) {
    this.hurtUntil = now + 0.35 + Math.min(0.6, amount / 100);
    this.hurtAmount = Math.min(1, 0.35 + amount / 80);
  }
  private hurtUntil = 0;
  private hurtAmount = 0;

  /** Potvrzení zásahu: tělo bílé, hlava červené, vyřazení větší a delší. */
  hitmarker(now: number, kind: 'body' | 'head' | 'kill' = 'body') {
    this.hitUntil = now + (kind === 'kill' ? 0.4 : 0.15);
    this.els['h-hit'].className = `h-hit${kind === 'body' ? '' : ` ${kind}`}`;
  }

  /** Ukazatel směru poškození: oblouk kolem středu, úhel vůči pohledu (rad, + = vpravo). */
  damageFrom(now: number, angle: number) {
    const el = h('div', { class: 'h-dir' });
    el.style.transform = `rotate(${angle}rad)`;
    this.els['h-dirs'].append(el);
    this.dirs.push({ el, until: now + 1.6 });
    while (this.dirs.length > 6) this.dirs.shift()!.el.remove();
  }
  private dirs: Array<{ el: HTMLElement; until: number }> = [];

  /** Po vyřazení: kdo a čím (kamera se mezitím otočí na přemožitele). */
  killedBy(now: number, name: string, weapon: string) {
    this.killerUntil = now + 6;
    this.els['h-killer'].replaceChildren(h('small', {}, t('hud.killedBy')), h('b', {}, name), ...(weapon ? [h('span', {}, weapon)] : []));
  }
  private killerUntil = 0;
  private wasSpectator = false;
  private deployAt = 0;

  /** Kill feed (krátký, staré řádky mizí). */
  feed(text: string | Node, now: number) {
    const el = h('div', {}, text);
    this.els['h-feed'].prepend(el);
    this.killfeed.push({ el, until: now + 6 });
    while (this.killfeed.length > 5) this.killfeed.shift()!.el.remove();
  }

  /** Systémové zprávy (oddělený blok od kill feedu a chatu). */
  system(text: string, now: number) {
    const el = h('div', {}, text);
    this.els['h-sys'].append(el);
    this.sysmsg.push({ el, until: now + 6 });
    while (this.sysmsg.length > 3) this.sysmsg.shift()!.el.remove();
  }

  update(c: HudContext) {
    const e = this.els;
    const now = c.now;
    e['h-hit'].style.opacity = now < this.hitUntil ? '1' : '0';
    this.slots.update(c.me?.alive ? c.me.inv : null, now);
    e['h-hurt'].style.opacity = now < this.hurtUntil ? String(this.hurtAmount * Math.min(1, (this.hurtUntil - now) / 0.35)) : '0';
    this.dirs = this.dirs.filter((d) => {
      if (now > d.until) d.el.remove();
      else d.el.style.opacity = String(Math.min(1, (d.until - now) / 0.6));
      return now <= d.until;
    });
    for (const list of [this.killfeed, this.sysmsg]) {
      for (const k of list) if (now > k.until) k.el.remove();
      list.splice(0, list.length, ...list.filter((k) => now <= k.until));
    }
    const me = c.me;
    const alive = !!me?.alive;
    if (this.deployAt && now >= this.deployAt) {
      this.deployAt = 0;
      if (me && !me.alive && me.life === 'dead' && !c.cq?.ended && !me.spectator) this.deploy.open(true);
    }
    // Pozorovatel: nasazení zavřené, nahoře jméno sledovaného hráče.
    if (me?.spectator !== this.wasSpectator) {
      this.wasSpectator = !!me?.spectator;
      if (me?.spectator) this.deploy.close();
      else if (me && !me.alive && !c.cq?.ended) this.deploy.open(true);
    }
    this.els['h-spec'].classList.toggle('hidden', !me?.spectator);
    if (me?.spectator) this.els['h-spec'].textContent = `${t('hud.spectator')}${c.spectating ? ` · ${c.spectating}` : ''} — ${t('hud.spectatorHelp')}`;
    const kb = this.els['h-killer'];
    kb.classList.toggle('hidden', alive || now >= this.killerUntil || !!c.cq?.ended);
    // Nasazení: automaticky před prvním nasazením a po definitivní smrti; Enter ho otevře kdykoli.
    // Oživení i nasazení obrazovku zavře; konec kola ji skryje (výsledky).
    if (me && c.map) {
      const life = me.alive ? 'alive' : me.life;
      const lifeKey = `${me.lifeId ?? 0}|${life}`;
      if (c.cq && c.cq.time < this.lastCqTime - 1) this.round++;
      this.lastCqTime = c.cq?.time ?? 0;
      if (lifeKey !== this.lastLife) {
        // Po vyřazení nepřítelem chvíli běží kamera na přemožitele, nasazení se otevře až po ní.
        if (life === 'dead' && !c.cq?.ended && !me.spectator) this.deployAt = now + (now < this.killerUntil ? 3.5 : 0);
        else if (life === 'alive' && this.lastLife) this.deploy.close();
        this.lastLife = lifeKey;
      }
      if (c.cq?.ended && this.deploy.visible) this.deploy.close();
      const names = new Map(c.remotes.map((r) => [r.id, r.name]));
      this.deploy.update({ doc: c.doc, map: c.map, me, team: c.team, cq: c.cq, spawns: c.spawns, faction: c.faction, kits: c.kits, simTime: c.simTime, teammates: this.teammates(c), extraTabs: c.extraTabs, names, roundKey: `${c.doc.id}|${c.cq?.scenarioId ?? 'free'}|${this.round}` });
      this.drawMapOverlay();
    }
    this.root.classList.toggle('pf-dead', !alive);

    // Vlevo dole: zdraví (bez samovolné regenerace), výdrž, postoj; nad tím četa.
    if (me && alive) {
      const s = me.state;
      const low = me.hp <= 30;
      e['h-vitals'].replaceChildren(
        h('div', { class: `h-hp${low ? ' low' : ''}` }, h('span', { class: 'h-stance', title: t(`stance.${s.stance}` as never) }, stanceGlyph(s.stance)), h('b', { class: 'tnum' }, String(Math.ceil(me.hp))), h('div', { class: 'h-bar' }, h('i', { style: { width: `${Math.max(0, Math.min(100, me.hp))}%` } }))),
        h('div', { class: `h-stam${s.sprintLocked ? ' locked' : ''}${s.stamina < 99.5 ? '' : ' full'}` }, h('div', { class: 'h-bar thin' }, h('i', { style: { width: `${s.stamina}%` } }))),
      );
    } else e['h-vitals'].replaceChildren();
    this.renderSquad(c);

    // Vpravo dole: silueta skutečné zbraně, náboje, rezerva, režim; „Přebíjení“ podle zbraňového systému.
    if (me && alive) {
      const w = me.weapon;
      this.drawSilhouette(w.weaponId);
      const act = w.action === 'reload' ? t('hud.reloading') : w.action === 'equip' ? t('hud.equip') : '';
      const it = me.inv?.items.find((x) => x.slot === me.inv!.active);
      if (isGun(w.weaponId)) {
        // Režim jen podle skutečných možností zbraně.
        const modes = rulesOf(w.weaponId).modes;
        const magMax = Math.max(1, rulesOf(w.weaponId).magazine);
        e['h-ammo'].replaceChildren(h('b', {}, String(w.mag)), h('span', {}, `/ ${w.reserve}`), h('div', { class: 'h-bar thin h-magbar' }, h('i', { style: { width: `${Math.min(100, (w.mag / magMax) * 100)}%` } })), h('small', {}, `${modes.length > 1 || w.mode === 'auto' ? (w.mode === 'auto' ? 'AUTO' : 'SEMI') : 'SEMI'}${act ? ` · ${act}` : ''}`));
      } else {
        const name = it ? t(`item.${it.kind}` as StringKey) : w.weaponId;
        e['h-ammo'].replaceChildren(it?.max !== undefined ? h('b', {}, String(w.mag)) : h('span'), h('small', {}, `${name}${act ? ` · ${act}` : ''}`));
      }
      e['h-br'].classList.toggle('hidden', false);
    } else e['h-br'].classList.toggle('hidden', true);

    // Vpravo nahoře: minimapa, tickety a čas (číslo + krátký pruh).
    this.drawMinimap(c);
    if (c.cq) {
      const cq = c.cq;
      // BF2: dvě barevné plochy nahoře uprostřed (naši vlevo, nepřítel vpravo), čas mezi nimi.
      const row = (team: Team) => h('div', { class: `h-tk ${team === c.team ? 'own' : 'enemy'}${cq.tickets[team] <= 20 ? ' low' : ''}` }, h('b', {}, String(cq.tickets[team])));
      e['h-score'].replaceChildren(row(c.team), h('div', { class: 'h-time' }, fmtTime(cq.timeLimit - cq.time)), row(c.team === 'teamA' ? 'teamB' : 'teamA'));
      // Pruh vlastnictví bodů pod minimapou (jeden segment na obsaditelný bod).
      e['h-cpbar'].replaceChildren(...cq.cps.filter((p) => p.capturable).map((p) => h('i', { class: p.owner === 'neutral' ? 'neutral' : p.owner === c.team ? 'own' : 'enemy', title: p.name })));
    } else {
      e['h-score'].replaceChildren();
      e['h-cpbar'].replaceChildren();
    }

    // Střed: obsazování, interakce, identifikace.
    const center: Node[] = [];
    if (me && alive && c.cq) {
      const here = c.cq.cps.find((p) => Math.hypot(p.pos[0] - me.state.pos.x, p.pos[2] - me.state.pos.z) <= p.radius && me.state.pos.y >= p.pos[1] - 0.5 && me.state.pos.y <= p.pos[1] + p.height);
      if (here && here.capturable) {
        const enemy = c.team === 'teamA' ? 'teamB' : 'teamA';
        const st = !here.capturable
          ? t('cap.locked')
          : here.activity === 'contested'
            ? t('cap.contested')
            : here.activity === c.team
              ? here.owner === enemy
                ? t('cap.neutralizing')
                : t('cap.capturing')
              : here.activity === enemy
                ? t('cap.enemy')
                : here.owner === c.team
                  ? t('cap.ours')
                  : t('cap.idle');
        const prog = here.owner === c.team || here.activity === c.team ? Math.abs(here.p) : Math.abs(here.p);
        center.push(h('div', { class: 'h-cap' }, h('div', {}, `${here.name} – ${st}`), h('div', { class: 'h-bar' }, h('i', { class: (c.team === 'teamA') === here.p >= 0 ? 'own' : 'enemy', style: { width: `${(prog * 100).toFixed(0)}%` } }))));
      }
    }
    if (c.interaction) center.push(h('div', { class: 'h-act' }, c.interaction.text, c.interaction.progress > 0 ? h('div', { class: 'h-bar thin' }, h('i', { style: { width: `${c.interaction.progress * 100}%` } })) : null));
    if (c.identified) center.push(h('div', { class: 'h-ident' }, c.identified));
    e['h-center'].replaceChildren(...center);

    // Zakázaná zóna.
    if (me?.alive && me.zone) {
      e['h-zone'].classList.remove('hidden');
      e['h-zone'].textContent = t('hud.zone', { s: Math.max(0, me.zone.countdown - me.zone.t).toFixed(1) });
    } else e['h-zone'].classList.add('hidden');

    this.renderDowned(c);
    this.renderEnd(c);
  }

  private lastLife = '';
  private lastCqTime = 0;
  private round = 0;

  private teammates(c: HudContext) {
    const mySquad = c.squads.find((s) => c.me && s.members.includes(c.me.id));
    return c.remotes.filter((r) => r.alive && r.team === c.team).map((r) => ({ id: r.id, name: r.name, pos: [r.state.pos.x, r.state.pos.z] as [number, number], squad: !!mySquad?.members.includes(r.id), leader: mySquad?.leader === r.id }));
  }

  private renderSquad(c: HudContext) {
    const me = c.me;
    const sq = me ? c.squads.find((s) => s.members.includes(me.id)) : undefined;
    if (!sq) return this.els['h-squad'].replaceChildren();
    const names = new Map(c.remotes.map((r) => [r.id, r]));
    this.els['h-squad'].replaceChildren(
      h('div', { class: 'h-sq-title' }, sq.name),
      ...sq.members.map((id) => {
        const r = id === me!.id ? me! : names.get(id);
        const state = !r ? '' : r.life === 'downed' ? t('life.downed') : r.life === 'dead' ? t('life.dead') : '';
        return h('div', { class: `h-sq-m${id === me!.id ? ' me' : ''}${r?.life !== 'alive' ? ' out' : ''}` }, id === sq.leader ? '★ ' : '· ', id === me!.id ? t('common.you') : r?.name ?? id, state ? h('small', {}, ` ${state}`) : null);
      }),
    );
  }

  /** Vyřazení: „Můžeš být oživen“, čas ze serveru, vzdát pomoc podržením (1 s) i tlačítkem. */
  private renderDowned(c: HudContext) {
    const d = this.els['h-downed'];
    const me = c.me;
    if (!me || me.life !== 'downed' || c.cq?.ended) {
      d.classList.add('hidden');
      this.giveUpHeld = -1;
      return;
    }
    d.classList.remove('hidden');
    const held = this.giveUpHeld >= 0 ? Math.min(1, (performance.now() - this.giveUpHeld) / 1000 / PILOT.giveUpHold) : 0;
    if (held >= 1) {
      this.giveUpHeld = -1;
      this.onGiveUp();
    }
    if (!d.dataset.built) {
      d.dataset.built = '1';
      const gb = button(t('downed.giveUp'), () => {}, 'pf-btn');
      // Tlačítko: také podržení (1 s) – brání náhodnému potvrzení.
      gb.addEventListener('pointerdown', () => (this.giveUpHeld = performance.now()));
      for (const ev of ['pointerup', 'pointerleave']) gb.addEventListener(ev, () => (this.giveUpHeld = -1));
      d.replaceChildren(h('h2', {}, t('downed.title')), h('div', { class: 'h-downed-time tnum' }), h('div', { class: 'h-bar' }, h('i')), h('p', { class: 'pf-dim' }, t('downed.hint')), h('div', { class: 'pf-row-inline' }, gb, button(t('downed.callMedic'), () => this.onCallMedic(), 'pf-btn')));
    }
    (d.querySelector('.h-downed-time') as HTMLElement).textContent = `${Math.ceil(me.downedLeft)} s`;
    (d.querySelector('.h-bar i') as HTMLElement).style.width = `${held * 100}%`;
  }

  /** Konec kola: vítěz, důvod, tickety, týmové tabulky a vlastní příspěvek – jen ze skutečných dat. */
  private renderEnd(c: HudContext) {
    const e = this.els['h-end'];
    if (!c.cq?.ended) {
      e.classList.add('hidden');
      this.endShown = false;
      return;
    }
    if (this.endShown) {
      const n = e.querySelector('.pf-next-round');
      if (n) n.textContent = c.nextRound ? t('end.nextRound', { s: String(Math.ceil(c.nextRound)) }) : t('end.nextRoundSoon');
      return;
    }
    this.endShown = true;
    this.deploy.show(false);
    const cq = c.cq;
    const win = cq.winner === 'draw' ? t('end.draw') : cq.winner === c.team ? t('end.victory') : t('end.defeat');
    const reason = cq.tickets.teamA <= 0 || cq.tickets.teamB <= 0 ? t('end.reasonTickets') : t('end.reasonTime');
    const all = [...(c.me ? [c.me] : []), ...c.remotes];
    const col = (team: Team) =>
      h('div', { class: `pf-end-team ${team === c.team ? 'own' : 'enemy'}` },
        h('h3', {}, team === c.team ? t('score.ownTeam') : t('score.enemyTeam'), ` – ${cq.tickets[team]}`),
        h('table', { class: 'pf-table' }, h('thead', {}, h('tr', {}, h('th', {}, t('col.name')), h('th', { class: 'num' }, t('col.kills')), h('th', { class: 'num' }, t('col.deaths')), h('th', { class: 'num' }, t('col.revives')))),
          h('tbody', {}, ...all.filter((p) => p.team === team).sort((a, b) => b.kills - a.kills).map((p) => h('tr', { class: p === c.me ? 'mine' : '' }, h('td', {}, p === c.me ? t('common.you') : p.name), h('td', { class: 'num' }, String(p.kills)), h('td', { class: 'num' }, String(p.deaths)), h('td', { class: 'num' }, String(p.revives)))))),
      );
    e.replaceChildren(
      h('h2', {}, win),
      h('p', {}, reason),
      h('div', { class: 'pf-end-cols' }, col(c.team), col(c.team === 'teamA' ? 'teamB' : 'teamA')),
      h('div', { class: 'pf-row-inline' }, c.network ? button(t('end.leave'), () => this.onLeave(), 'pf-btn primary') : button(t('end.restart'), () => this.onRestart(), 'pf-btn primary'), c.network ? null : button(t('end.leave'), () => this.onLeave(), 'pf-btn')),
    );
    if (c.me) {
      const mates = all.filter((p) => p.team === c.team).sort((a, b) => b.kills - a.kills);
      e.append(h('p', { class: 'pf-end-mine' }, `${t('end.yours')}: ${c.me.kills} ${t('col.kills')} · ${c.me.deaths} ${t('col.deaths')} · ${c.me.revives} ${t('col.revives')} · ${t('end.rank', { n: String(mates.indexOf(c.me) + 1), of: String(mates.length) })}`));
    }
    if (c.network) e.append(h('p', { class: 'pf-dim pf-next-round' }, t('end.nextRoundSoon')));
    e.classList.remove('hidden');
  }

  /** Minimapa: sever nahoře, měřítko podle skutečných souřadnic; kreslí se z mapového podkladu. */
  private drawMinimap(c: HudContext) {
    const cv = this.minimap;
    const W = Math.round(cv.getBoundingClientRect().width) || 240;
    if (cv.width !== W) cv.width = cv.height = W;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, W, W);
    const me = c.me;
    if (!c.map || !me || (!me.alive && me.life !== 'downed')) {
      cv.style.visibility = 'hidden';
      return;
    }
    cv.style.visibility = '';
    // Kovový prstenec s kompasem (BF2): mapa je uvnitř, na prstenci N / E / S / W.
    const ringW = Math.round(W * 0.075);
    const inner = W / 2 - ringW;
    const scale = (inner * 2) / 120; // 120 m přes průměr mapy
    const cx = me.state.pos.x, cz = me.state.pos.z;
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, inner, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#151b1b';
    g.fillRect(0, 0, W, W);
    c.map.draw(g, cx, cz, W / 2, W / 2, scale);
    const w2s = TacticalMap.w2s(cx, cz, W / 2, W / 2, scale);
    const css = getComputedStyle(document.documentElement);
    const col = { own: css.getPropertyValue('--pf-team').trim(), enemy: css.getPropertyValue('--pf-enemy').trim(), neutral: css.getPropertyValue('--pf-neutral').trim(), squad: css.getPropertyValue('--pf-squad').trim(), accent: css.getPropertyValue('--pf-accent').trim() };
    g.font = '700 11px "Barlow Semi Condensed", sans-serif';
    for (const cp of c.cq?.cps ?? []) {
      const [x, y] = w2s(cp.pos[0], cp.pos[2]);
      const k = cp.owner === 'neutral' ? 'neutral' : cp.owner === c.team ? 'own' : 'enemy';
      g.fillStyle = col[k] + '55';
      g.strokeStyle = col[k];
      g.beginPath();
      g.arc(x, y, Math.max(5, cp.radius * scale), 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#e5e7d8';
      g.fillText(cp.name.slice(0, 1), x - 3, y + 4);
    }
    const mySquad = c.squads.find((s) => s.members.includes(me.id));
    for (const r of c.remotes) {
      if (!r.alive || r.team !== c.team) continue;
      const [x, y] = w2s(r.state.pos.x, r.state.pos.z);
      g.fillStyle = mySquad?.members.includes(r.id) ? col.squad : col.own;
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const ct of c.contacts) {
      const [x, y] = w2s(ct.pos[0], ct.pos[2]);
      g.strokeStyle = ct.kind === 'confirmed' ? col.enemy : '#e8a24a';
      g.lineWidth = 2;
      g.beginPath();
      if (ct.kind === 'confirmed') {
        g.moveTo(x, y - 6);
        g.lineTo(x + 5, y + 4);
        g.lineTo(x - 5, y + 4);
        g.closePath();
      } else g.arc(x, y, 6, 0, Math.PI * 2);
      g.stroke();
    }
    if (c.order?.status === 'active') {
      const [x, y] = w2s(c.order.target.pos[0], c.order.target.pos[2]);
      g.strokeStyle = col.accent;
      g.lineWidth = 2;
      g.strokeRect(x - 7, y - 7, 14, 14);
    }
    g.restore();
    // Vlastní hráč a orientace (šipka ve směru pohledu; sever nahoře).
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(-me.state.yaw);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5, 5);
    g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
    this.drawRing(g, W, ringW, inner);
  }

  /** Prstenec minimapy: kartáčovaný kov, rysky po 15°, světové strany. */
  private drawRing(g: CanvasRenderingContext2D, W: number, ringW: number, inner: number) {
    const R = W / 2;
    const gr = g.createLinearGradient(0, 0, W, W);
    gr.addColorStop(0, '#9a9fa1');
    gr.addColorStop(0.22, '#3a3e40');
    gr.addColorStop(0.45, '#b4b9ba');
    gr.addColorStop(0.7, '#2c3032');
    gr.addColorStop(1, '#80868a');
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.arc(R, R, inner, 0, Math.PI * 2, true);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(R, R, inner, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.arc(R, R, R - 2.5, 0, Math.PI * 2);
    g.stroke();
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180, major = a % 90 === 0;
      if (major) continue;
      const r0 = inner + ringW * 0.62, r1 = inner + ringW * 0.9;
      g.strokeStyle = 'rgba(15,17,18,0.8)';
      g.lineWidth = a % 45 === 0 ? 2 : 1;
      g.beginPath();
      g.moveTo(R + Math.sin(rad) * r0, R - Math.cos(rad) * r0);
      g.lineTo(R + Math.sin(rad) * r1, R - Math.cos(rad) * r1);
      g.stroke();
    }
    g.font = `800 ${Math.round(ringW * 0.9)}px "Barlow Semi Condensed", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [ch, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
      const rad = (a * Math.PI) / 180, r = inner + ringW * 0.52;
      g.fillStyle = ch === 'N' ? '#f4d35a' : '#14181a';
      g.fillText(ch, R + Math.sin(rad) * r, R - Math.cos(rad) * r + 1);
    }
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
  }

  /** Silueta aktivní výbavy z geometrie skutečné zbraně (boční průmět, jednou na zbraň). */
  private drawSilhouette(id: string) {
    if (id === this.silId) return;
    this.silId = id;
    drawSilhouette(this.silhouette, id, 220, 70);
    this.silhouette.title = arsenalEntry(id)?.name ?? id;
  }

  reset() {
    for (const k of this.killfeed) k.el.remove();
    this.killfeed = [];
    this.endShown = false;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    this.deploy.dispose();
    this.mapOverlay.remove();
    for (const id of ['h-tl', 'h-tr', 'h-bl', 'h-br', 'h-score', 'h-hit', 'h-hurt', 'h-spec', 'h-killer', 'h-dirs', 'h-center', 'h-zone', 'h-downed', 'h-end']) document.getElementById(id)?.remove();
  }
}

function stanceGlyph(s: string) {
  return s === 'prone' ? '▁' : s === 'crouch' ? '▃' : '▆';
}
