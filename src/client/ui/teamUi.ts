import type { MapDocument } from '../../shared/map/schema';
import { RADIO_IDS, RADIO_TEXT, type ChatChannel, type RadioId } from '../../shared/net/protocol';
import type { NetDriver } from '../runtime/netDriver';
import type { InputSystem } from '../runtime/input';
import type { PlayerView } from '../runtime/driver';

/**
 * Týmové UI síťové hry: chat (J/K/L), rádiové kolo (Q), rozkazy čety (T),
 * panel čet (Home / P), skóre (Tab) a minimapa. Text se vkládá přes textContent (nikdy HTML).
 */
const TEAM_COL = { teamA: '#4f8fe6', teamB: '#e2604a', neutral: '#d8d0bd' } as Record<string, string>;
const CH_LABEL: Record<string, string> = { all: 'VŠICHNI', team: 'TÝM', squad: 'ČETA', system: 'SERVER', radio: 'RÁDIO' };

export class TeamUi {
  private root: HTMLElement;
  private log: HTMLElement;
  private chatBox: HTMLElement;
  private chatInput: HTMLInputElement;
  private chatCh: ChatChannel = 'team';
  private radial: HTMLElement;
  private radialSel = -1;
  private radialVec = { x: 0, y: 0 };
  private squadPanel: HTMLElement;
  private score: HTMLElement;
  private minimap: HTMLCanvasElement;
  private shown = new Set<string>();
  private requests: Array<{ pos: [number, number, number]; kind: RadioId; until: number }> = [];
  private orderMenu = false;

  constructor(
    private driver: NetDriver,
    private input: InputSystem,
    private doc: MapDocument,
  ) {
    const hud = document.getElementById('hud')!;
    const mk = (cls: string, tag = 'div') => {
      const e = document.createElement(tag);
      e.className = cls;
      hud.appendChild(e);
      return e;
    };
    this.root = mk('tui');
    this.log = mk('tui-log');
    this.chatBox = mk('tui-chat hidden');
    this.chatInput = document.createElement('input');
    this.chatInput.maxLength = 200;
    this.chatBox.append(document.createElement('span'), this.chatInput);
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) this.driver.net.send({ t: 'chat', ch: this.chatCh, text: t });
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    this.radial = mk('tui-radial hidden');
    RADIO_IDS.forEach((id, i) => {
      const it = document.createElement('div');
      const a = (i / RADIO_IDS.length) * Math.PI * 2 - Math.PI / 2;
      it.style.left = `${50 + Math.cos(a) * 40}%`;
      it.style.top = `${50 + Math.sin(a) * 40}%`;
      it.textContent = RADIO_TEXT[id];
      this.radial.appendChild(it);
    });
    this.squadPanel = mk('tui-squad hidden');
    this.score = mk('tui-score hidden');
    this.minimap = mk('tui-map', 'canvas') as HTMLCanvasElement;
    this.minimap.width = this.minimap.height = 200;
    this.driver.onReject = (what, reason) => this.line('system', 'Server', `${what}: ${reason}`);
    input.onUiKey = (code, down) => this.key(code, down);
  }

  private line(ch: string, name: string, text: string) {
    const d = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = `[${CH_LABEL[ch] ?? ch}] ${name}: `;
    b.className = `ch-${ch}`;
    const t = document.createElement('span');
    t.textContent = text;
    d.append(b, t);
    this.log.appendChild(d);
    while (this.log.childElementCount > 8) this.log.firstElementChild!.remove();
    setTimeout(() => d.classList.add('old'), 9000);
  }

  private openChat(ch: ChatChannel) {
    this.chatCh = ch;
    (this.chatBox.firstChild as HTMLElement).textContent = `${CH_LABEL[ch]}: `;
    this.chatBox.classList.remove('hidden');
    this.input.clear(); // psaní nesmí nechat držené bojové vstupy
    setTimeout(() => this.chatInput.focus(), 0);
  }

  private closeChat() {
    this.chatInput.value = '';
    this.chatInput.blur();
    this.chatBox.classList.add('hidden');
    this.input.clear();
  }

  private key(code: string, down: boolean): boolean {
    if (!this.chatBox.classList.contains('hidden')) return true;
    if (down && (code === 'KeyJ' || code === 'KeyK' || code === 'KeyL')) {
      this.openChat(code === 'KeyJ' ? 'all' : code === 'KeyK' ? 'team' : 'squad');
      return true;
    }
    if (code === 'KeyQ') {
      if (down) this.openRadial();
      else this.closeRadial(false);
      return true;
    }
    if (code === 'KeyT' && down) {
      this.orderMenu = !this.orderMenu;
      this.renderOrderMenu();
      return true;
    }
    if (this.orderMenu && down && /^Digit[1-3]$/.test(code)) {
      this.issueOrder(Number(code.slice(5)));
      return true;
    }
    // Četa, velitel a skóre mají vlastní obrazovky (pauza / Tab) – řeší aplikace.
    return false;
  }

  private openRadial() {
    this.radial.classList.remove('hidden');
    this.radialSel = -1;
    this.radialVec = { x: 0, y: 0 };
    this.input.suppressFire = true;
    this.input.onUiMouse = (dx, dy) => {
      this.radialVec.x = Math.max(-120, Math.min(120, this.radialVec.x + dx));
      this.radialVec.y = Math.max(-120, Math.min(120, this.radialVec.y + dy));
      const len = Math.hypot(this.radialVec.x, this.radialVec.y);
      if (len < 25) this.radialSel = -1; // mrtvá zóna uprostřed
      else {
        const a = Math.atan2(this.radialVec.y, this.radialVec.x) + Math.PI / 2;
        this.radialSel = Math.round(((a / (Math.PI * 2)) * RADIO_IDS.length + RADIO_IDS.length) % RADIO_IDS.length) % RADIO_IDS.length;
      }
      [...this.radial.children].forEach((c, i) => c.classList.toggle('on', i === this.radialSel));
    };
    this.input.onUiClick = () => this.closeRadial(true);
  }

  /** Povel se pošle jen potvrzeným kliknutím; puštění Q bez potvrzení nic neposílá. */
  private closeRadial(confirm: boolean) {
    if (this.radial.classList.contains('hidden')) return;
    if (confirm && this.radialSel >= 0) this.driver.net.send({ t: 'radio', id: RADIO_IDS[this.radialSel] });
    this.radial.classList.add('hidden');
    this.input.onUiMouse = null;
    this.input.onUiClick = null;
    setTimeout(() => (this.input.suppressFire = false), 150);
  }

  private renderOrderMenu() {
    let el = document.getElementById('tui-order');
    if (!this.orderMenu) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'tui-order';
      el.className = 'tui-order';
      document.getElementById('hud')!.appendChild(el);
    }
    el.innerHTML = '<b>ROZKAZ ČETĚ</b><div>1 – Útok na nejbližší bod v záměru</div><div>2 – Obrana nejbližšího bodu</div><div>3 – Přesun na místo v záměru</div><small>T zavřít · jen velitel čety</small>';
  }

  private issueOrder(n: number) {
    const me = this.driver.local();
    if (!me) return;
    const s = me.state;
    const dir = { x: -Math.sin(s.yaw) * Math.cos(s.pitch), y: Math.sin(s.pitch), z: -Math.cos(s.yaw) * Math.cos(s.pitch) };
    // Bod v záměru: nejbližší kontrolní bod podle úhlu pohledu.
    let best: string | undefined, bc = -2;
    for (const c of this.doc.controlPoints) {
      const v = { x: c.position[0] - s.pos.x, z: c.position[2] - s.pos.z };
      const l = Math.hypot(v.x, v.z) || 1;
      const cos = (v.x * dir.x + v.z * dir.z) / l;
      if (cos > bc) {
        bc = cos;
        best = c.id;
      }
    }
    if (n === 1 && best) this.driver.net.send({ t: 'order', kind: 'attack', cp: best });
    else if (n === 2 && best) this.driver.net.send({ t: 'order', kind: 'defend', cp: best });
    else if (n === 3) {
      const d = 25;
      this.driver.net.send({ t: 'order', kind: 'move', pos: [s.pos.x + dir.x * d, s.pos.y, s.pos.z + dir.z * d] });
    }
    this.orderMenu = false;
    this.renderOrderMenu();
  }

  update(me: PlayerView | null, _remotes: PlayerView[]) {
    // Chat a rádio (každá zpráva jednou podle ID).
    for (const m of this.driver.chat) {
      if (this.shown.has(m.id)) continue;
      this.shown.add(m.id);
      if (m.radio) {
        const id = m.text as RadioId;
        this.line('radio', m.name, RADIO_TEXT[id] ?? m.text);
        const ev = this.driver.net.inbox.find((x) => x.t === 'radio' && x.id === m.id) as { pos: [number, number, number] | null } | undefined;
        if (ev?.pos) this.requests.push({ pos: ev.pos, kind: id, until: performance.now() + 8000 });
      } else this.line(m.ch, m.name, m.text);
    }
    this.requests = this.requests.filter((r) => r.until > performance.now());
    // Minimapu kreslí HUD (vpravo nahoře); tady jen požadavky z rádia.
    void this.drawMinimap;
    this.minimap.style.display = 'none';
    if (!this.squadPanel.classList.contains('hidden')) this.renderSquads(me);
    if (!this.score.classList.contains('hidden')) this.renderScore();
  }

  private drawMinimap(me: PlayerView | null, remotes: PlayerView[]) {
    const g = this.minimap.getContext('2d')!;
    const W = this.minimap.width, S = 1.6; // px na metr
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(20,17,13,0.7)';
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.fill();
    if (!me) return;
    const cx = me.state.pos.x, cz = me.state.pos.z, yaw = me.state.yaw;
    // Mapa se otáčí s hráčem (nahoře = směr pohledu).
    const tr = (x: number, z: number) => {
      const dx = x - cx, dz = z - cz;
      const c = Math.cos(-yaw), s = Math.sin(-yaw);
      return [W / 2 + (dx * c - dz * s) * S, W / 2 + (dx * s + dz * c) * S] as const;
    };
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.clip();
    const cq = this.driver.conquest();
    for (const c of cq?.cps ?? []) {
      const [x, y] = tr(c.pos[0], c.pos[2]);
      g.fillStyle = (TEAM_COL[c.owner] ?? '#ccc') + '99';
      g.beginPath();
      g.arc(x, y, Math.max(4, c.radius * S), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#eadfc8';
      g.font = 'bold 10px sans-serif';
      g.fillText(c.name.slice(0, 1), x - 3, y + 4);
    }
    // Spoluhráči (nepřátele mapa nezná – jen ověřené kontakty).
    for (const r of remotes) {
      if (!r.alive || r.team !== me.team) continue;
      const [x, y] = tr(r.state.pos.x, r.state.pos.z);
      const inSquad = this.driver.squads.some((s) => s.members.includes(r.id) && s.members.includes(me.id));
      g.fillStyle = inSquad ? '#7fe07f' : TEAM_COL[me.team];
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    const now = this.driver.time();
    for (const c of this.driver.contacts) {
      const [x, y] = tr(c.pos[0], c.pos[2]);
      const age = Math.max(0, Math.min(1, (c.expires - now) / 6));
      g.globalAlpha = 0.3 + age * 0.7;
      g.strokeStyle = c.kind === 'confirmed' ? '#ff4a3a' : '#ffb84a';
      g.lineWidth = 2;
      g.beginPath();
      if (c.kind === 'confirmed') {
        g.moveTo(x, y - 6);
        g.lineTo(x + 5, y + 4);
        g.lineTo(x - 5, y + 4);
        g.closePath();
      } else g.arc(x, y, 7, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    for (const r of this.requests) {
      const [x, y] = tr(r.pos[0], r.pos[2]);
      g.fillStyle = r.kind === 'medic' ? '#ffffff' : r.kind === 'ammo' ? '#ffd23f' : '#9fd0ff';
      g.font = 'bold 12px sans-serif';
      g.fillText(r.kind === 'medic' ? '+' : r.kind === 'ammo' ? '▮' : '!', x - 4, y + 4);
    }
    const o = this.driver.order;
    if (o && o.status === 'active') {
      const [x, y] = tr(o.target.pos[0], o.target.pos[2]);
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 2;
      g.strokeRect(x - 7, y - 7, 14, 14);
      g.fillStyle = '#ffd23f';
      g.font = 'bold 9px sans-serif';
      g.fillText(o.kind === 'attack' ? 'ÚTOK' : o.kind === 'defend' ? 'OBRANA' : 'PŘESUN', x - 14, y - 10);
    }
    g.restore();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(W / 2, W / 2 - 7);
    g.lineTo(W / 2 + 5, W / 2 + 5);
    g.lineTo(W / 2 - 5, W / 2 + 5);
    g.closePath();
    g.fill();
  }

  private renderSquads(me: PlayerView | null) {
    const p = this.squadPanel;
    p.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = 'ČETY (Home / P zavřít)';
    p.appendChild(h);
    const mySquad = this.driver.squads.find((s) => me && s.members.includes(me.id));
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    const names = new Map(this.driver.scores.map((s) => [s.id, s.name]));
    for (const s of this.driver.squads) {
      const row = document.createElement('div');
      row.className = 'sq';
      const t = document.createElement('b');
      t.textContent = `${s.name} (${s.members.length}/6)${s.locked ? ' 🔒' : ''}`;
      const mem = document.createElement('span');
      mem.textContent = s.members.map((m) => (m === s.leader ? `★${names.get(m) ?? m}` : names.get(m) ?? m)).join(', ');
      row.append(t, mem);
      if (s !== mySquad && !s.locked && s.members.length < 6) row.appendChild(btn('Připojit', () => this.driver.net.send({ t: 'squad', op: 'join', squad: s.id })));
      p.appendChild(row);
    }
    const r = document.createElement('div');
    r.className = 'btns';
    if (!mySquad) r.appendChild(btn('Založit četu', () => this.driver.net.send({ t: 'squad', op: 'create' })));
    else {
      r.appendChild(btn('Opustit četu', () => this.driver.net.send({ t: 'squad', op: 'leave' })));
      if (me && mySquad.leader === me.id) r.appendChild(btn(mySquad.locked ? 'Odemknout' : 'Uzamknout', () => this.driver.net.send({ t: 'squad', op: mySquad.locked ? 'unlock' : 'lock' })));
    }
    p.appendChild(r);
  }

  private renderScore() {
    const s = this.score;
    s.replaceChildren();
    for (const team of ['teamA', 'teamB'] as const) {
      const col = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = team === 'teamA' ? 'TÝM A' : 'TÝM B';
      h.style.color = TEAM_COL[team];
      col.appendChild(h);
      for (const p of this.driver.scores.filter((x) => x.team === team).sort((a, b) => b.kills - a.kills)) {
        const r = document.createElement('div');
        r.textContent = `${p.name}  ${p.kills}/${p.deaths}  ${p.ping} ms`;
        col.appendChild(r);
      }
      s.appendChild(col);
    }
  }

  dispose() {
    for (const e of [this.root, this.log, this.chatBox, this.radial, this.squadPanel, this.score, this.minimap]) e.remove();
    document.getElementById('tui-order')?.remove();
    this.input.onUiKey = () => false;
    this.input.onUiMouse = null;
    this.input.onUiClick = null;
  }
}
