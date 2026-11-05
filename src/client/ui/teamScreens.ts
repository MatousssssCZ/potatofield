import type { Team } from '../../shared/map/schema';
import type { ConquestState } from '../../shared/sim/conquest';
import { NET } from '../../shared/net/protocol';
import { arsenalEntry, KIT_LABEL } from '../../shared/config/arsenal';
import type { OrderKind } from '../../shared/net/protocol';
import type { PlayerView } from '../runtime/driver';
import type { NetDriver } from '../runtime/netDriver';
import { t } from './i18n';
import { button, h } from './kit';
import { TacticalMap, playArea } from './tactical';

/**
 * Obrazovky týmu: četa (založit, připojit, opustit, zamknout), velitel (role, rozkazy četám,
 * UAV, sken s obnovou ze serveru) a tabulka skóre. Jen skutečná data serveru: rozkaz má stav
 * Odesláno → Potvrzeno / Odmítnuto podle odpovědi, ne podle předpokladu.
 */
type Pending = { what: string; label: string; at: number; state: 'sent' | 'ok' | 'rejected'; detail?: string };

export class TeamScreens {
  private pending: Pending[] = [];
  private seenFeedback = 0;
  private orderKind: OrderKind = 'attack';
  private orderSquad: string | null = null;
  private cmdCanvas = h('canvas', { class: 'pf-cmd-map' }) as HTMLCanvasElement;
  private lastCmdCtx: { me: PlayerView; remotes: PlayerView[]; cq: ConquestState | null } | null = null;

  constructor(
    private d: NetDriver,
    private map: () => TacticalMap | null,
  ) {
    this.cmdCanvas.addEventListener('click', (e) => this.mapClick(e));
  }

  private send(what: string, label: string, msg: Parameters<NetDriver['net']['send']>[0]) {
    this.d.net.send(msg);
    this.pending.push({ what, label, at: performance.now(), state: 'sent' });
    if (this.pending.length > 6) this.pending.shift();
  }

  /** Spáruje odpovědi serveru s odeslanými příkazy (nejstarší čekající daného typu). */
  private syncFeedback() {
    const fb = this.d.feedback;
    for (const f of fb.slice(Math.max(0, fb.length - (fb.length - this.seenFeedback)))) {
      if (f.at < (this.pending[0]?.at ?? 0)) continue;
      const p = this.pending.find((x) => x.state === 'sent' && x.what === f.what);
      if (p) {
        p.state = f.ok ? 'ok' : 'rejected';
        p.detail = f.detail;
      }
    }
    this.seenFeedback = fb.length;
    // Bez odpovědi do 3 s → stále „Odesláno“ (nevymýšlíme potvrzení).
  }

  private status() {
    this.syncFeedback();
    return h('ul', { class: 'pf-acks' }, ...this.pending.slice(-4).reverse().map((p) =>
      h('li', { class: p.state }, `${p.label}: `, h('b', {}, p.state === 'sent' ? t('cmd.sent') : p.state === 'ok' ? t('cmd.acked') : t('cmd.rejected', { reason: p.detail ?? '' })))));
  }

  private names() {
    return new Map(this.d.scores.map((s) => [s.id, s.name]));
  }

  /** Četa: seznam čet vlastního týmu, členové, akce podle role. */
  squadView(): HTMLElement {
    const me = this.d.local();
    const names = this.names();
    if (!me) return h('div');
    const mine = this.d.squads.find((s) => s.members.includes(me.id));
    const rows = this.d.squads.filter((s) => s.team === me.team).map((s) =>
      h('div', { class: `pf-squad${s === mine ? ' mine' : ''}` },
        h('div', { class: 'pf-squad-head' }, h('b', {}, s.name), h('span', { class: 'pf-dim tnum' }, ` ${s.members.length}/${NET.squad.maxMembers}`), s.locked ? h('span', { class: 'pf-dim' }, ' 🔒') : null,
          s !== mine && !s.locked && s.members.length < NET.squad.maxMembers ? button(t('squad.join'), () => this.send('squad', t('squad.join'), { t: 'squad', op: 'join', squad: s.id }), 'pf-btn small') : null),
        h('ul', {}, ...s.members.map((m) => h('li', {}, m === s.leader ? '★ ' : '', m === me.id ? t('common.you') : (names.get(m) ?? m)))),
      ));
    const order = this.d.order;
    const orderLine = mine ? h('p', {}, `${t('squad.order')}: `, h('b', {}, order && order.status === 'active' ? `${t(`cmd.${order.kind}`)}${order.target.cp ? ` – ${order.target.cp}` : ''}` : t('squad.noOrder'))) : null;
    const actions = mine
      ? h('div', { class: 'pf-row-inline' }, button(t('squad.leave'), () => this.send('squad', t('squad.leave'), { t: 'squad', op: 'leave' }), 'pf-btn'),
          mine.leader === me.id ? button(mine.locked ? t('squad.unlock') : t('squad.lock'), () => this.send('squad', t('squad.lock'), { t: 'squad', op: mine.locked ? 'unlock' : 'lock' }), 'pf-btn') : null)
      : h('div', { class: 'pf-row-inline' }, button(t('squad.create'), () => this.send('squad', t('squad.create'), { t: 'squad', op: 'create' }), 'pf-btn primary'));
    return h('div', { class: 'pf-team-screen' }, h('h3', {}, t('squad.title')), mine ? null : h('p', { class: 'pf-dim' }, t('squad.none')), orderLine, ...rows, actions, this.status());
  }

  /** Velitel: role, schopnosti s obnovou, rozkazy četám na mapě. */
  commanderView(me: PlayerView, remotes: PlayerView[], cq: ConquestState | null): HTMLElement {
    this.lastCmdCtx = { me, remotes, cq };
    const c = this.d.command;
    const names = this.names();
    const isCmd = !!c && c.commander === me.id;
    const now = this.d.time();
    const head = h('div', { class: 'pf-row-inline' },
      h('span', {}, c?.commander ? t('cmd.current', { name: c.commander === me.id ? t('common.you') : (names.get(c.commander) ?? c.commander) }) : t('cmd.none')),
      isCmd ? button(t('cmd.resign'), () => this.send('command', t('cmd.resign'), { t: 'command', op: 'resign' }), 'pf-btn') : !c?.commander ? button(t('cmd.apply'), () => this.send('command', t('cmd.apply'), { t: 'command', op: 'apply' }), 'pf-btn primary') : null,
    );
    if (!isCmd) return h('div', { class: 'pf-team-screen' }, h('h3', {}, t('cmd.title')), head, h('p', { class: 'pf-dim' }, t('cmd.notCommander')), this.status());
    const cd = (at: number) => (now >= at ? t('cmd.ready') : t('cmd.cooldown', { s: Math.ceil(at - now) }));
    const abilities = h('div', { class: 'pf-row-inline' },
      button(`${t('cmd.uav')} · ${cd(c!.uavReadyAt)}`, () => this.ability('uav'), 'pf-btn', { disabled: now < c!.uavReadyAt, title: t('cmd.uavHint') }),
      button(`${t('cmd.scan')} · ${cd(c!.scanReadyAt)}`, () => this.send('ability', t('cmd.scan'), { t: 'ability', kind: 'scan' }), 'pf-btn', { disabled: now < c!.scanReadyAt }),
      button(t('cmd.supply'), () => {}, 'pf-btn', { disabled: true, title: t('cmd.supplyMissing') }),
    );
    const squads = this.d.squads.filter((s) => s.team === me.team);
    if (!squads.some((s) => s.id === this.orderSquad)) this.orderSquad = squads[0]?.id ?? null;
    const orderRow = h('div', { class: 'pf-row-inline' },
      ...squads.map((s) => button(s.name, () => {
        this.orderSquad = s.id;
        this.redraw();
      }, `pf-btn small${this.orderSquad === s.id ? ' on' : ''}`)),
      h('span', { class: 'pf-sep' }),
      ...(['attack', 'defend', 'move'] as OrderKind[]).map((k) => button(t(`cmd.${k}`), () => {
        this.orderKind = k;
        this.redraw();
      }, `pf-btn small${this.orderKind === k ? ' on' : ''}`)),
    );
    const root = h('div', { class: 'pf-team-screen pf-cmd' },
      h('h3', {}, t('cmd.title')), head, abilities,
      h('div', { class: 'pf-label' }, `${t('cmd.order')} – ${squads.length ? t('cmd.pickTarget') : t('cmd.noSquads')}`),
      orderRow, this.cmdCanvas, this.status());
    this.drawCmdMap();
    return root;
  }

  private redraw() {
    // Obrazovku překreslí volající (aktualizace ~4×/s); mapu ihned.
    this.drawCmdMap();
  }

  private ability(kind: 'uav' | 'scan') {
    this.uavArmed = kind === 'uav';
    this.drawCmdMap();
  }
  private uavArmed = false;

  private view() {
    const m = this.map();
    if (!m) return null;
    const W = this.cmdCanvas.clientWidth || 640, H = this.cmdCanvas.clientHeight || 400;
    if (this.cmdCanvas.width !== W || this.cmdCanvas.height !== H) {
      this.cmdCanvas.width = W;
      this.cmdCanvas.height = H;
    }
    const win = playArea(this.d.doc!) ?? m.bounds;
    const scale = m.fit(W, H, 16, win);
    const cx = (win.x0 + win.x1) / 2, cz = (win.z0 + win.z1) / 2;
    return { m, W, H, scale, cx, cz };
  }

  private drawCmdMap() {
    const v = this.view();
    const ctx = this.lastCmdCtx;
    if (!v || !ctx) return;
    const g = this.cmdCanvas.getContext('2d')!;
    g.fillStyle = '#151b1b';
    g.fillRect(0, 0, v.W, v.H);
    v.m.draw(g, v.cx, v.cz, v.W / 2, v.H / 2, v.scale);
    const w2s = TacticalMap.w2s(v.cx, v.cz, v.W / 2, v.H / 2, v.scale);
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => css.getPropertyValue(n).trim();
    g.font = '600 12px "Barlow Semi Condensed", sans-serif';
    for (const cp of ctx.cq?.cps ?? []) {
      const [x, y] = w2s(cp.pos[0], cp.pos[2]);
      g.strokeStyle = cp.owner === 'neutral' ? col('--pf-neutral') : cp.owner === ctx.me.team ? col('--pf-team') : col('--pf-enemy');
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#e5e7d8';
      g.fillText(cp.name, x + 12, y + 4);
    }
    for (const r of ctx.remotes) {
      if (!r.alive || r.team !== ctx.me.team) continue;
      const [x, y] = w2s(r.state.pos.x, r.state.pos.z);
      const inSel = this.d.squads.find((s) => s.id === this.orderSquad)?.members.includes(r.id);
      g.fillStyle = inSel ? col('--pf-squad') : col('--pf-team');
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const c of this.d.contacts) {
      const [x, y] = w2s(c.pos[0], c.pos[2]);
      g.strokeStyle = c.kind === 'confirmed' ? col('--pf-enemy') : '#e8a24a';
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.stroke();
    }
    const u = this.d.command?.uav;
    if (u) {
      const [x, y] = w2s(u.pos[0], u.pos[2]);
      g.strokeStyle = col('--pf-accent');
      g.setLineDash([4, 4]);
      g.beginPath();
      g.arc(x, y, NET.command.uavRadius * v.scale, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    const o = this.d.order;
    if (o?.status === 'active') {
      const [x, y] = w2s(o.target.pos[0], o.target.pos[2]);
      g.strokeStyle = col('--pf-accent');
      g.strokeRect(x - 8, y - 8, 16, 16);
    }
    g.fillStyle = col('--pf-accent');
    g.fillText(this.uavArmed ? t('cmd.uavPlace') : '', 12, v.H - 12);
  }

  private mapClick(e: MouseEvent) {
    const v = this.view();
    const ctx = this.lastCmdCtx;
    if (!v || !ctx) return;
    const r = this.cmdCanvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * v.W, sy = ((e.clientY - r.top) / r.height) * v.H;
    const x = v.cx + (sx - v.W / 2) / v.scale, z = v.cz + (sy - v.H / 2) / v.scale;
    if (this.uavArmed) {
      this.uavArmed = false;
      this.send('ability', t('cmd.uav'), { t: 'ability', kind: 'uav', pos: [x, 0, z] });
      return this.drawCmdMap();
    }
    if (!this.orderSquad) return;
    // Klik do bodu = rozkaz k bodu (útok/obrana); jinde přesun.
    const cp = ctx.cq?.cps.find((c) => Math.hypot(c.pos[0] - x, c.pos[2] - z) <= Math.max(c.radius, 12 / v.scale));
    const kind: OrderKind = this.orderKind === 'move' || !cp ? 'move' : this.orderKind;
    const label = `${t(`cmd.${kind}`)} → ${this.d.squads.find((s) => s.id === this.orderSquad)?.name ?? ''}`;
    if (kind === 'move') this.send('order', label, { t: 'order', kind, pos: [x, ctx.me.state.pos.y, z], squad: this.orderSquad });
    else this.send('order', label, { t: 'order', kind, cp: cp!.id, squad: this.orderSquad });
    this.drawCmdMap();
  }
}

/** Tabulka skóre (Tab): oba týmy, vlastní řádek zvýrazněný, posuvná pro 64 hráčů. */
export function scoreboard(c: { me: PlayerView | null; remotes: PlayerView[]; team: Team; cq: ConquestState | null; net: NetDriver | null }) {
  type Row = { id: string; name: string; team: Team; kills: number; deaths: number; revives: number; ping: number | null; squad: string | null; kit: string; life: string };
  const rows: Row[] = [];
  const views = new Map([...(c.me ? [c.me] : []), ...c.remotes].map((p) => [p.id, p]));
  const squadName = (sid: string | null) => (sid ? (c.net?.squads.find((s) => s.id === sid)?.name ?? '') : '');
  if (c.net?.scores.length) {
    for (const s of c.net.scores) {
      const v = views.get(s.id);
      rows.push({ id: s.id, name: s.name, team: s.team, kills: s.kills, deaths: s.deaths, revives: s.revives, ping: s.ping, squad: squadName(s.squad), kit: kitOf(v), life: v?.life ?? '' });
    }
  } else for (const v of views.values()) rows.push({ id: v.id, name: v.name, team: v.team, kills: v.kills, deaths: v.deaths, revives: v.revives, ping: null, squad: null, kit: kitOf(v), life: v.life });
  const col = (team: Team) => {
    const list = rows.filter((r) => r.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    return h('section', { class: `pf-sb-team ${team === c.team ? 'own' : 'enemy'}` },
      h('header', {}, h('b', {}, team === c.team ? t('score.ownTeam') : t('score.enemyTeam')), c.cq ? h('span', { class: 'tnum' }, `${t('score.tickets')}: ${c.cq.tickets[team]}`) : null, h('span', { class: 'pf-dim tnum' }, String(list.length))),
      h('div', { class: 'pf-sb-scroll' }, h('table', { class: 'pf-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('col.name')), h('th', {}, t('col.squad')), h('th', {}, t('col.class')), h('th', { class: 'num' }, t('col.kills')), h('th', { class: 'num' }, t('col.deaths')), h('th', { class: 'num' }, t('col.revives')), h('th', { class: 'num' }, t('col.ping')))),
        h('tbody', {}, ...list.map((r) => h('tr', { class: `${r.id === c.me?.id ? 'mine' : ''}${r.life && r.life !== 'alive' ? ' out' : ''}` },
          h('td', {}, r.id === c.me?.id ? `${r.name} (${t('common.you')})` : r.name), h('td', {}, r.squad ?? '—'), h('td', {}, team === c.team ? r.kit : '—'),
          h('td', { class: 'num' }, String(r.kills)), h('td', { class: 'num' }, String(r.deaths)), h('td', { class: 'num' }, String(r.revives)), h('td', { class: 'num' }, r.ping === null ? '—' : String(r.ping))))),
      )));
  };
  const other: Team = c.team === 'teamA' ? 'teamB' : 'teamA';
  return h('div', { class: 'pf-sb' }, col(c.team), col(other));
}

function kitOf(v: PlayerView | undefined) {
  const e = v ? arsenalEntry(v.weapon.weaponId) : undefined;
  return e ? KIT_LABEL[e.kit] : '—';
}
