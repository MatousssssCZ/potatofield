import { CAMERA } from '../../shared/config/camera';
import { QUALITY, type QualityProfile } from '../render/quality';
import { FACTION_LABEL, KIT_LABEL, readyWeapons } from '../render/weapons/catalog';
import { ACTION_LABELS, DEFAULT_BINDINGS, InputSystem, type Action } from '../runtime/input';

/** Nastavení hráče (per-viewer pohodlí v localStorage; vše funguje i bez něj). */
export interface Settings {
  quality: QualityProfile['id'];
  hFov: number;
  sensitivity: number;
  invertY: boolean;
  bob: number;
  landingKick: boolean;
  crouchToggle: boolean;
  fullscreen: boolean;
  /** Vzhled zbraně v testu (jen vizuál – pravidla střelby jsou pro všechny PF-Rifle). */
  weapon: string;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  hFov: CAMERA.hFovDeg16x9,
  sensitivity: 2.5,
  invertY: false,
  bob: 1,
  landingKick: true,
  crouchToggle: false,
  fullscreen: true,
  weapon: 'm4a1',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('pf.settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* bez úložiště */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem('pf.settings', JSON.stringify(s));
  } catch {
    /* ignorovat */
  }
}

/** Sestaví panel nastavení (jednou při startu). Změny se propisují přes `onChange`. */
export function buildSettingsUI(s: Settings, onChange: () => void) {
  const root = document.getElementById('settings')!;
  root.replaceChildren();
  const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
    const l = document.createElement('label');
    const sp = document.createElement('span');
    sp.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(s[key]);
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = fmt(Number(inp.value));
    inp.addEventListener('input', () => {
      (s[key] as number) = Number(inp.value);
      val.textContent = fmt(Number(inp.value));
      saveSettings(s);
      onChange();
    });
    l.append(sp, inp, val);
    root.appendChild(l);
  };
  const check = (label: string, key: keyof Settings) => {
    const l = document.createElement('label');
    l.className = 'check';
    const sp = document.createElement('span');
    sp.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.checked = Boolean(s[key]);
    inp.addEventListener('change', () => {
      (s[key] as boolean) = inp.checked;
      saveSettings(s);
      onChange();
    });
    l.append(sp, inp);
    root.appendChild(l);
  };
  const ql = document.createElement('label');
  const qs = document.createElement('span');
  qs.textContent = 'Kvalita grafiky';
  const sel = document.createElement('select');
  for (const q of Object.values(QUALITY)) {
    const o = document.createElement('option');
    o.value = q.id;
    o.textContent = q.label;
    sel.appendChild(o);
  }
  sel.value = s.quality;
  sel.addEventListener('change', () => {
    s.quality = sel.value as QualityProfile['id'];
    saveSettings(s);
    location.reload();
  });
  ql.append(qs, sel);
  root.appendChild(ql);
  const wl = document.createElement('label');
  const wsp = document.createElement('span');
  wsp.textContent = 'Zbraň (vzhled)';
  const wsel = document.createElement('select');
  for (const w of readyWeapons()) {
    const o = document.createElement('option');
    o.value = w.id;
    o.textContent = `${FACTION_LABEL[w.faction]} ${KIT_LABEL[w.kit]} – ${w.name}`;
    wsel.appendChild(o);
  }
  wsel.value = readyWeapons().some((w) => w.id === s.weapon) ? s.weapon : 'm4a1';
  wsel.addEventListener('change', () => {
    s.weapon = wsel.value;
    saveSettings(s);
    onChange();
  });
  wl.append(wsp, wsel);
  root.appendChild(wl);
  slider('FOV (horizontální, 16:9)', 'hFov', CAMERA.hFovMinDeg, CAMERA.hFovMaxDeg, 1, (v) => `${v}°`);
  slider('Citlivost myši', 'sensitivity', 0.2, 8, 0.05, (v) => v.toFixed(2));
  slider('Pohupování kamery', 'bob', 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`);
  check('Invertovat osu Y', 'invertY');
  check('Dřep přepínáním (toggle)', 'crouchToggle');
  check('Kick kamery při dopadu', 'landingKick');
  check('Celá obrazovka (chrání Ctrl+W)', 'fullscreen');
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = 'Změna kvality znovu načte stránku (mapa je uložená). Kvalita mění jen vzhled, nikoli kolize, mlhu ani kryty. Vzhled zbraně se projeví při dalším spuštění testu.';
  root.appendChild(note);
}

export function buildControlsUI() {
  const root = document.getElementById('controls')!;
  root.replaceChildren();
  const labeler = new InputSystem(document.body);
  const t = document.createElement('table');
  for (const [a, label] of Object.entries(ACTION_LABELS)) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = label;
    const td2 = document.createElement('td');
    td2.className = 'k';
    td2.textContent = DEFAULT_BINDINGS[a as Action].map((c) => labeler.keyLabel(c)).join(', ');
    tr.append(td1, td2);
    t.appendChild(tr);
  }
  root.appendChild(t);
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = 'Klávesy se mapují podle fyzické polohy; popisek odpovídá vašemu rozložení (Z = „Y“ na české klávesnici).';
  root.appendChild(note);
}
