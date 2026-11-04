import * as THREE from 'three';
import { CAMERA } from '../shared/config/camera';
import { toDeg } from '../shared/config/movement';
import { validateMap } from '../shared/map/validate';
import type { MapDocument } from '../shared/map/schema';
import { PhysicsWorld } from '../shared/physics/world';
import { collidersForMap, generateMap } from '../world';
import { buildRangeMap } from '../world/maps/range';
import { EnvironmentRig } from './render/environment';
import { MaterialLibrary, TEXTURE_IDS, generateTextures, makeMacroNoise, sharedUniforms } from './render/materials';
import { QUALITY, type QualityProfile } from './render/quality';
import { WorldView } from './render/worldView';
import { PostPipeline } from './render/post';
import { Game } from './runtime/game';
import { ACTION_LABELS, InputSystem, type Action } from './runtime/input';

// ---------- Nastavení (per-viewer pohodlí v localStorage; vše funguje i bez něj) ----------
interface Settings {
  quality: QualityProfile['id'];
  hFov: number;
  sensitivity: number;
  invertY: boolean;
  bob: number;
  landingKick: boolean;
  crouchToggle: boolean;
  fullscreen: boolean;
}
const DEFAULTS: Settings = {
  quality: 'high',
  hFov: CAMERA.hFovDeg16x9,
  sensitivity: 2.5,
  invertY: false,
  bob: 1,
  landingKick: true,
  crouchToggle: false,
  fullscreen: true,
};
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('pf.settings');
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* prohlížeč bez úložiště */
  }
  return { ...DEFAULTS };
}
function saveSettings(s: Settings) {
  try {
    localStorage.setItem('pf.settings', JSON.stringify(s));
  } catch {
    /* ignorovat */
  }
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

async function main() {
  const settings = loadSettings();
  const urlQ = new URLSearchParams(location.search).get('q');
  if (urlQ && urlQ in QUALITY) settings.quality = urlQ as QualityProfile['id'];
  const quality = QUALITY[settings.quality];

  const canvas = $<HTMLCanvasElement>('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false; // počítadla za celý snímek včetně post-processingu

  const status = $('#loading .status');
  const bar = $('#loading .fill');
  const setProgress = (t: number, msg: string) => {
    bar.style.width = `${Math.round(t * 100)}%`;
    status.textContent = msg;
  };

  // --- Paralelně: fyzika (WASM) a textury (Web Workery) ---
  setProgress(0.02, 'Generuji materiály…');
  const anis = Math.min(quality.anisotropy, renderer.capabilities.getMaxAnisotropy());
  const [phys, textures] = await Promise.all([
    PhysicsWorld.create(),
    generateTextures(TEXTURE_IDS, quality.textureSize, anis, (d, n) => setProgress(0.05 + (d / n) * 0.8, `Generuji materiály ${d}/${n}`)),
  ]);
  sharedUniforms.uMacro.value = makeMacroNoise();
  const mats = new MaterialLibrary(textures);

  // --- Mapa: validace → generátory → kolize + render ze stejných dílů ---
  setProgress(0.88, 'Stavím svět…');
  const doc: MapDocument = buildRangeMap();
  const check = validateMap(JSON.parse(JSON.stringify(doc)));
  if (!check.ok) {
    console.error(check.issues);
    status.textContent = 'Mapa neprošla validací – viz konzole.';
    return;
  }
  const gen = generateMap(doc);
  phys.setTerrain(doc.terrain);
  phys.addColliders(collidersForMap(gen));
  phys.sync();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, CAMERA.near, CAMERA.far);
  scene.add(camera);
  const env = new EnvironmentRig(renderer, scene);
  env.apply(doc.environment, quality);
  const world = new WorldView(mats, textures);
  world.build(doc, gen);
  scene.add(world.root);

  const input = new InputSystem(canvas);
  input.radPerCount = CAMERA.radiansPerCount;
  input.settings = { sensitivity: settings.sensitivity, invertY: settings.invertY, crouchToggle: settings.crouchToggle };
  input.attach();

  const game = new Game(camera, phys, input, mats);
  game.settings = { hFov: settings.hFov, bob: settings.bob, landingKick: settings.landingKick };
  camera.add(game.viewModel.root);
  const sp = doc.testSpawn!;
  game.spawn(sp.position, sp.rotation[1]);

  const post = new PostPipeline(renderer, scene, camera, quality);

  // --- Velikost a rozlišení renderu ---
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr) * quality.renderScale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
    post.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  // Kompilace shaderů předem (žádné škubnutí při prvním pohledu).
  renderer.compile(scene, camera);
  setProgress(1, 'Hotovo');
  $('#loading').classList.add('hidden');

  // --- Menu, HUD, dev panel ---
  const menu = $('#menu');
  const hud = $('#hud');
  const dev = $('#dev');
  $('#menu-map').textContent = doc.name;
  let devOn = new URLSearchParams(location.search).has('dev');
  dev.classList.toggle('hidden', !devOn);
  input.onDevKey = () => {
    devOn = !devOn;
    dev.classList.toggle('hidden', !devOn);
  };
  const openMenu = () => {
    game.active = false;
    menu.classList.remove('hidden');
    hud.classList.add('hidden');
  };
  input.onMenuKey = () => input.releaseLock();
  input.onLockChange = (locked) => {
    if (locked) {
      game.active = true;
      menu.classList.add('hidden');
      hud.classList.remove('hidden');
    } else openMenu();
  };
  $('#btn-play').addEventListener('click', async () => {
    if (settings.fullscreen && !document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
        // Ctrl+W (dřep + vpřed) by jinak zavřel kartu; Keyboard Lock funguje jen na celé obrazovce.
        const kb = (navigator as unknown as { keyboard?: { lock?: (k?: string[]) => Promise<void> } }).keyboard;
        await kb?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'Escape', 'KeyR', 'KeyZ', 'KeyB', 'KeyE', 'Digit3', 'Space']);
      } catch {
        /* celá obrazovka odmítnuta – hraje se v okně */
      }
    }
    input.requestLock();
  });
  window.addEventListener('beforeunload', (e) => {
    if (game.active) e.preventDefault();
  });
  buildSettingsUI(settings, input, game, () => saveSettings(settings));
  buildControlsUI(input);
  $('#btn-settings').addEventListener('click', () => $('#settings').classList.toggle('hidden'));
  $('#btn-controls').addEventListener('click', () => $('#controls').classList.toggle('hidden'));
  openMenu();

  // --- Hlavní smyčka ---
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fps = 0, devT = 0;
  const frameTimes: number[] = [];
  const staminaEl = $('#stamina'), staminaFill = $('#stamina .fill'), stanceEl = $('#stance');
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    renderer.info.reset();
    game.update(dt);
    world.update(game.simTime);
    env.update(camera.position, dt);
    post.render(dt);

    fpsAcc += dt;
    fpsN++;
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 600) frameTimes.shift();
    if (fpsAcc >= 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    const s = game.state;
    staminaEl.classList.toggle('show', s.stamina < 99.5);
    staminaEl.classList.toggle('low', s.sprintLocked);
    staminaFill.style.width = `${s.stamina}%`;
    stanceEl.textContent = s.stance === 'stand' ? 'STOJ' : s.stance === 'crouch' ? 'DŘEP' : 'LEH';
    devT += dt;
    if (devOn && devT > 0.1) {
      devT = 0;
      const info = renderer.info;
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      dev.innerHTML = [
        `FPS ${fps.toFixed(0)}  p95 ${p95.toFixed(1)} ms  tick ${s.tick}  dropped ${game.stats.droppedSteps}`,
        `draw ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  geo ${info.memory.geometries}  tex ${info.memory.textures}  kvalita ${quality.label}${post.enabled ? ' +AO' : ''}`,
        `pos ${s.pos.x.toFixed(2)} ${s.pos.y.toFixed(2)} ${s.pos.z.toFixed(2)}  yaw ${toDeg(s.yaw).toFixed(1)}°  pitch ${toDeg(s.pitch).toFixed(1)}°`,
        `rychlost ${Math.hypot(s.vel.x, s.vel.z).toFixed(2)} m/s  vy ${s.vel.y.toFixed(2)}  grounded ${s.grounded}`,
        `postoj ${s.stance} (výška ${s.height.toFixed(2)} m)  sprint ${s.sprinting}  výdrž ${s.stamina.toFixed(1)}${s.sprintLocked ? ' (vyčerpáno)' : ''}`,
        `ADS ${s.adsProgress.toFixed(2)}  zbraň: placeholder (krok 6)  síť: offline`,
        s.blocked.length ? `<span class="warn">blokace: ${s.blocked.join(' | ')}</span>` : 'blokace: –',
      ].join('\n');
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Ladicí háček pro automatické screenshoty a testy v prohlížeči.
  (window as unknown as Record<string, unknown>).__pf = { game, camera, renderer, scene, world, phys, doc, input, env };
}

function buildSettingsUI(s: Settings, input: InputSystem, game: Game, save: () => void) {
  const root = $('#settings');
  const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string, apply: (v: number) => void) => {
    const l = document.createElement('label');
    l.innerHTML = `<span></span><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span>`;
    (l.children[0] as HTMLElement).textContent = label;
    const inp = l.children[1] as HTMLInputElement;
    const val = l.children[2] as HTMLElement;
    inp.value = String(s[key]);
    val.textContent = fmt(Number(inp.value));
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      (s[key] as number) = v;
      val.textContent = fmt(v);
      apply(v);
      save();
    });
    root.appendChild(l);
  };
  const check = (label: string, key: keyof Settings, apply: (v: boolean) => void) => {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<span></span><input type="checkbox">`;
    (l.children[0] as HTMLElement).textContent = label;
    const inp = l.children[1] as HTMLInputElement;
    inp.checked = Boolean(s[key]);
    inp.addEventListener('change', () => {
      (s[key] as boolean) = inp.checked;
      apply(inp.checked);
      save();
    });
    root.appendChild(l);
  };
  const ql = document.createElement('label');
  ql.innerHTML = `<span>Kvalita grafiky</span><select></select>`;
  const sel = ql.querySelector('select')!;
  for (const q of Object.values(QUALITY)) {
    const o = document.createElement('option');
    o.value = q.id;
    o.textContent = q.label;
    sel.appendChild(o);
  }
  sel.value = s.quality;
  sel.addEventListener('change', () => {
    s.quality = sel.value as QualityProfile['id'];
    save();
    location.reload();
  });
  root.appendChild(ql);
  slider('FOV (horizontální, 16:9)', 'hFov', CAMERA.hFovMinDeg, CAMERA.hFovMaxDeg, 1, (v) => `${v}°`, (v) => (game.settings.hFov = v));
  slider('Citlivost myši', 'sensitivity', 0.2, 8, 0.05, (v) => v.toFixed(2), (v) => (input.settings.sensitivity = v));
  slider('Pohupování kamery', 'bob', 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`, (v) => (game.settings.bob = v));
  check('Invertovat osu Y', 'invertY', (v) => (input.settings.invertY = v));
  check('Dřep přepínáním (toggle)', 'crouchToggle', (v) => (input.settings.crouchToggle = v));
  check('Kick kamery při dopadu', 'landingKick', (v) => (game.settings.landingKick = v));
  check('Celá obrazovka (chrání Ctrl+W)', 'fullscreen', () => {});
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = 'Změna kvality znovu načte stránku. Kvalita mění jen vzhled, nikoli kolize, mlhu ani kryty.';
  root.appendChild(note);
}

function buildControlsUI(input: InputSystem) {
  const root = $('#controls');
  const t = document.createElement('table');
  for (const [a, label] of Object.entries(ACTION_LABELS)) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = label;
    const td2 = document.createElement('td');
    td2.className = 'k';
    td2.textContent = input.bindings[a as Action].map((c) => input.keyLabel(c)).join(', ');
    tr.append(td1, td2);
    t.appendChild(tr);
  }
  root.appendChild(t);
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = 'Klávesy se mapují podle fyzické polohy; popisek odpovídá vašemu rozložení. Přemapování v UI přijde s editorem.';
  root.appendChild(note);
}

main().catch((e) => {
  console.error(e);
  const st = document.querySelector('#loading .status');
  if (st) st.textContent = `Chyba při načítání: ${(e as Error).message}`;
});
