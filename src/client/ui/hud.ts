import type { MapDocument, SpawnPoint, Team } from '../../shared/map/schema';
import type { ConquestState } from '../../shared/sim/conquest';
import type { PlayerView } from '../runtime/driver';

/** HUD v DOM (aktualizace ~20×/s, ne každý snímek → UI neřídí render). */
const TEAM_NAME: Record<Team, string> = { teamA: 'Tým A', teamB: 'Tým B' };
const TEAM_COL: Record<string, string> = { teamA: '#4f8fe6', teamB: '#e2604a', neutral: '#d8d0bd' };

export class Hud {
  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private killfeed: Array<{ el: HTMLElement; until: number }> = [];
  private hitUntil = 0;
  onSpawn: (id: string | null) => void = () => {};
  onRestart: () => void = () => {};
  private selectedSpawn: string | null = null;
  private lastSpawnKey = '';

  constructor() {
    this.root = document.getElementById('hud')!;
    const mk = (id: string, cls: string, parent: HTMLElement = this.root) => {
      let e = document.getElementById(id);
      if (!e) {
        e = document.createElement('div');
        e.id = id;
        e.className = cls;
        parent.appendChild(e);
      }
      this.els[id] = e;
      return e;
    };
    mk('h-ammo', 'h-box h-ammo');
    mk('h-hp', 'h-box h-hp');
    mk('h-hit', 'h-hit');
    mk('h-top', 'h-top');
    mk('h-cps', 'h-cps');
    mk('h-zone', 'h-zone hidden');
    mk('h-feed', 'h-feed');
    mk('h-death', 'h-death hidden');
    mk('h-end', 'h-end hidden');
    mk('h-cap', 'h-cap hidden');
  }

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

  hitmarker(now: number) {
    this.hitUntil = now + 0.15;
  }

  feed(text: string, now: number) {
    const el = document.createElement('div');
    el.textContent = text;
    this.els['h-feed'].prepend(el);
    this.killfeed.push({ el, until: now + 5 });
  }

  update(now: number, me: PlayerView | null, cq: ConquestState | null, doc: MapDocument, simTime: number, spawns: SpawnPoint[]) {
    const e = this.els;
    e['h-hit'].style.opacity = now < this.hitUntil ? '1' : '0';
    for (const k of this.killfeed) if (now > k.until) k.el.remove();
    this.killfeed = this.killfeed.filter((k) => now <= k.until);
    if (me && me.alive) {
      const w = me.weapon;
      const act = w.action === 'reload' ? ' · PŘEBÍJÍM' : w.action === 'equip' ? ' · TASENÍ' : '';
      e['h-ammo'].innerHTML = `<b>${w.mag}</b><span>/ ${w.reserve}</span><small>${w.mode === 'auto' ? 'AUTO' : 'SEMI'}${act}</small>`;
      e['h-hp'].innerHTML = `<b style="color:${me.hp > 30 ? '#eadfc8' : '#e2604a'}">${Math.ceil(me.hp)}</b><small>ZDRAVÍ</small>`;
    } else {
      e['h-ammo'].innerHTML = '';
      e['h-hp'].innerHTML = '';
    }
    // Zakázaná zóna.
    if (me?.alive && me.zone) {
      e['h-zone'].classList.remove('hidden');
      e['h-zone'].textContent = `ZAKÁZANÁ ZÓNA – vraťte se! ${Math.max(0, me.zone.countdown - me.zone.t).toFixed(1)} s`;
    } else e['h-zone'].classList.add('hidden');
    // Conquest.
    if (cq) {
      const left = Math.max(0, cq.timeLimit - cq.time);
      const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
      e['h-top'].innerHTML = `<span style="color:${TEAM_COL.teamA}">A ${cq.tickets.teamA}</span><span class="t">${mm}:${String(ss).padStart(2, '0')}</span><span style="color:${TEAM_COL.teamB}">${cq.tickets.teamB} B</span>`;
      e['h-cps'].innerHTML = cq.cps
        .map((c) => {
          const prog = Math.abs(c.p);
          const col = c.p > 0 ? TEAM_COL.teamA : c.p < 0 ? TEAM_COL.teamB : TEAM_COL.neutral;
          return `<div class="cp" title="${esc(c.name)}"><i style="background:${TEAM_COL[c.owner]};${c.activity === 'contested' ? 'outline:2px solid #ffd23f' : ''}"></i><span>${esc(c.name.slice(0, 10))}</span><u style="width:${(prog * 100).toFixed(0)}%;background:${col}"></u></div>`;
        })
        .join('');
      // Postup zabírání bodu, ve kterém hráč stojí.
      const here = me?.alive ? cq.cps.find((c) => Math.hypot(c.pos[0] - me.state.pos.x, c.pos[2] - me.state.pos.z) <= c.radius && me.state.pos.y >= c.pos[1] - 0.5 && me.state.pos.y <= c.pos[1] + c.height) : undefined;
      if (here) {
        e['h-cap'].classList.remove('hidden');
        const st = here.activity === 'contested' ? 'SPORNÝ BOD' : !here.capturable ? 'NEZABÍRATELNÝ' : here.activity ? 'ZABÍRÁNÍ' : 'BOD';
        e['h-cap'].innerHTML = `<div>${esc(here.name)} – ${st}</div><div class="bar"><u style="width:${(Math.abs(here.p) * 100).toFixed(0)}%;background:${here.p >= 0 ? TEAM_COL.teamA : TEAM_COL.teamB}"></u></div>`;
      } else e['h-cap'].classList.add('hidden');
      if (cq.ended) {
        e['h-end'].classList.remove('hidden');
        const w = cq.winner === 'draw' ? 'REMÍZA' : `VÍTĚZÍ ${TEAM_NAME[cq.winner as Team].toUpperCase()}`;
        if (!e['h-end'].dataset.shown) {
          e['h-end'].dataset.shown = '1';
          e['h-end'].innerHTML = `<h2>${w}</h2><p>Tickety A ${cq.tickets.teamA} : ${cq.tickets.teamB} B</p><button id="h-restart">Restart scénáře</button>`;
          document.getElementById('h-restart')!.addEventListener('click', () => this.onRestart());
        }
      } else {
        e['h-end'].classList.add('hidden');
        delete e['h-end'].dataset.shown;
      }
    } else {
      e['h-top'].innerHTML = '';
      e['h-cps'].innerHTML = '';
      e['h-cap'].classList.add('hidden');
      e['h-end'].classList.add('hidden');
    }
    // Smrt a výběr spawnu.
    if (me && !me.alive && !(cq?.ended)) {
      e['h-death'].classList.remove('hidden');
      const wait = Math.max(0, me.respawnAt - simTime);
      const key = `${spawns.map((s) => s.id).join()}|${Math.ceil(wait)}|${this.selectedSpawn}`;
      if (key !== this.lastSpawnKey) {
        this.lastSpawnKey = key;
        this.renderSpawn(doc, cq, me.team, spawns, wait);
      }
    } else {
      e['h-death'].classList.add('hidden');
      this.lastSpawnKey = '';
    }
  }

  private renderSpawn(doc: MapDocument, cq: ConquestState | null, team: Team, spawns: SpawnPoint[], wait: number) {
    const box = this.els['h-death'];
    box.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = wait > 0 ? `Padl jsi – respawn za ${Math.ceil(wait)} s` : 'Vyber místo nasazení';
    box.appendChild(h);
    if (!cq) {
      const p = document.createElement('p');
      p.textContent = 'Volný test: oživení u testovacího spawnu.';
      box.appendChild(p);
    }
    // Schematická mapa: body a dostupné spawny (shora).
    const cv = document.createElement('canvas');
    cv.width = 360;
    cv.height = 260;
    box.appendChild(cv);
    const g = cv.getContext('2d')!;
    const pts = [...doc.controlPoints.map((c) => c.position), ...doc.spawnPoints.map((s) => s.position)];
    if (pts.length) {
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]);
      const minX = Math.min(...xs) - 20, maxX = Math.max(...xs) + 20, minZ = Math.min(...zs) - 20, maxZ = Math.max(...zs) + 20;
      const sc = Math.min(cv.width / (maxX - minX), cv.height / (maxZ - minZ));
      const tx = (x: number) => (x - minX) * sc + (cv.width - (maxX - minX) * sc) / 2;
      const tz = (z: number) => (z - minZ) * sc + (cv.height - (maxZ - minZ) * sc) / 2;
      g.fillStyle = 'rgba(30,26,20,0.85)';
      g.fillRect(0, 0, cv.width, cv.height);
      for (const c of cq?.cps ?? []) {
        g.beginPath();
        g.arc(tx(c.pos[0]), tz(c.pos[2]), Math.max(5, c.radius * sc), 0, Math.PI * 2);
        g.fillStyle = TEAM_COL[c.owner] + '66';
        g.fill();
        g.fillStyle = '#eadfc8';
        g.font = '11px sans-serif';
        g.fillText(c.name.slice(0, 14), tx(c.pos[0]) + 8, tz(c.pos[2]) - 6);
      }
      for (const s of spawns) {
        g.fillStyle = s.id === this.selectedSpawn ? '#ffd23f' : TEAM_COL[team];
        g.fillRect(tx(s.position[0]) - 4, tz(s.position[2]) - 4, 8, 8);
      }
      cv.addEventListener('click', (ev) => {
        const r = cv.getBoundingClientRect();
        const x = ev.clientX - r.left, y = ev.clientY - r.top;
        let best: SpawnPoint | null = null, bd = 20;
        for (const s of spawns) {
          const d = Math.hypot(tx(s.position[0]) - x, tz(s.position[2]) - y);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        if (best) {
          this.selectedSpawn = best.id;
          this.lastSpawnKey = '';
        }
      });
    }
    if (cq) {
      const list = document.createElement('div');
      list.className = 'h-spawns';
      const groups = new Map<string, SpawnPoint>();
      for (const s of spawns) groups.set(s.controlPointId ?? `base:${s.id}`, groups.get(s.controlPointId ?? `base:${s.id}`) ?? s);
      for (const [k, s] of groups) {
        const b = document.createElement('button');
        const cp = cq.cps.find((c) => c.id === s.controlPointId);
        b.textContent = cp ? cp.name : `Základna (${s.id})`;
        if (this.selectedSpawn === s.id) b.className = 'on';
        b.addEventListener('click', () => {
          this.selectedSpawn = s.id;
          this.lastSpawnKey = '';
        });
        list.appendChild(b);
        void k;
      }
      if (!spawns.length) list.textContent = 'Žádné dostupné místo – počkejte nebo zabírejte body.';
      box.appendChild(list);
    }
    const go = document.createElement('button');
    go.className = 'primary';
    go.textContent = wait > 0 ? `Nasadit (${Math.ceil(wait)} s)` : 'Nasadit';
    go.disabled = wait > 0 || (!!cq && !this.selectedSpawn && spawns.length > 0);
    go.addEventListener('click', () => this.onSpawn(cq ? this.selectedSpawn : null));
    box.appendChild(go);
  }

  reset() {
    this.selectedSpawn = null;
    this.lastSpawnKey = '';
    for (const k of this.killfeed) k.el.remove();
    this.killfeed = [];
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
