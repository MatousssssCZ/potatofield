import * as THREE from 'three';
import { CAMERA, vFovFromH16x9 } from '../shared/config/camera';
import { MOVEMENT, toDeg } from '../shared/config/movement';
import type { MapDocument } from '../shared/map/schema';
import { validateMap } from '../shared/map/validate';
import { PhysicsWorld, initRapier } from '../shared/physics/world';
import { generateObject, partsToColliders, collidersForMap, generateMap } from '../world';
import { buildEmptyMap } from '../world/maps/empty';
import { buildRangeMap } from '../world/maps/range';
import { Editor, TEST_SPAWN_ID } from './editor/editor';
import { EditorDoc, History, type Change } from './editor/editorDoc';
import { AutoSaver, MapStore, exportMapFile, readMapFile } from './editor/persistence';
import { buildCatalog, issuesList, modal, renderInspector, renderSceneList, toast } from './editor/ui';
import { EnvironmentRig } from './render/environment';
import { MaterialLibrary, TEXTURE_IDS, generateTextures, makeMacroNoise, sharedUniforms } from './render/materials';
import { PostPipeline } from './render/post';
import { QUALITY, type QualityProfile } from './render/quality';
import { WorldView } from './render/worldView';
import { PlaySession } from './runtime/session';
import { buildControlsUI, buildSettingsUI, loadSettings, type Settings } from './ui/settings';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const EDITOR_VFOV = 60;

/**
 * Aplikace: jeden renderer, jedna scéna, jedna kamera. Režim editoru a testovací
 * režim se přepínají bez obnovení stránky; editor si drží kameru, výběr i historii.
 */
export class App {
  settings: Settings = loadSettings();
  quality!: QualityProfile;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(EDITOR_VFOV, 16 / 9, CAMERA.near, CAMERA.far);
  mats!: MaterialLibrary;
  world!: WorldView;
  env!: EnvironmentRig;
  post!: PostPipeline;
  phys!: PhysicsWorld;
  ed!: EditorDoc;
  history!: History;
  editor!: Editor;
  store = new MapStore();
  saver!: AutoSaver;
  session: PlaySession | null = null;
  mode: 'editor' | 'play' = 'editor';
  private editorCam: ReturnType<Editor['saveCamera']> | null = null;
  private devOn = new URLSearchParams(location.search).has('dev');
  private uiDirty = true;
  private unsub: (() => void) | null = null;
  switches = 0;

  async init() {
    const urlQ = new URLSearchParams(location.search).get('q');
    if (urlQ && urlQ in QUALITY) this.settings.quality = urlQ as QualityProfile['id'];
    this.quality = QUALITY[this.settings.quality];
    const canvas = $<HTMLCanvasElement>('#view');
    const r = new THREE.WebGLRenderer({ canvas, antialias: this.quality.antialias, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    this.renderer = r;

    const bar = $('#loading .fill'), status = $('#loading .status');
    const progress = (t: number, msg: string) => {
      bar.style.width = `${Math.round(t * 100)}%`;
      status.textContent = msg;
    };
    progress(0.02, 'Generuji materiály…');
    const anis = Math.min(this.quality.anisotropy, r.capabilities.getMaxAnisotropy());
    const [, textures] = await Promise.all([
      initRapier(),
      generateTextures(TEXTURE_IDS, this.quality.textureSize, anis, (d, n) => progress(0.05 + (d / n) * 0.8, `Generuji materiály ${d}/${n}`)),
    ]);
    sharedUniforms.uMacro.value = makeMacroNoise();
    this.mats = new MaterialLibrary(textures);
    this.world = new WorldView(this.mats, textures);
    this.scene.add(this.world.root);
    this.scene.add(this.camera);
    this.env = new EnvironmentRig(r, this.scene);
    this.post = new PostPipeline(r, this.scene, this.camera, this.quality);

    progress(0.9, 'Otevírám mapu…');
    let doc: MapDocument | null = null;
    try {
      const last = await this.store.lastMapId();
      if (last) {
        const l = await this.store.load(last);
        if (l) {
          doc = l.doc;
          if (l.fromBackup) setTimeout(() => toast('Poslední uložení bylo poškozené – obnovena předchozí dobrá verze.', 'warn'), 500);
        }
      }
    } catch (e) {
      console.warn('IndexedDB nedostupná', e);
      setTimeout(() => toast('Lokální úložiště není dostupné – ukládejte exportem do souboru.', 'warn'), 500);
    }
    this.openDoc(doc ?? this.rangeTemplate(), false);

    this.bindUI();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe($('#viewport'));
    this.resize();
    r.compile(this.scene, this.camera);
    progress(1, 'Hotovo');
    $('#loading').classList.add('hidden');
    requestAnimationFrame(this.loop);
    (window as unknown as Record<string, unknown>).__pf = this;
  }

  private rangeTemplate() {
    const d = buildRangeMap();
    d.id = `range_${Date.now().toString(36)}`;
    return d;
  }

  // ---------------- dokument ----------------

  /** Otevře dokument: přestaví kolize i render, vyčistí historii a výběr. */
  openDoc(doc: MapDocument, save = true) {
    this.unsub?.();
    if (this.editor) this.editor.dispose();
    this.phys?.free();
    this.phys = new PhysicsWorld(this.physR());
    this.ed = new EditorDoc(doc);
    this.history = new History(this.ed);
    const gen = generateMap(doc);
    this.phys.setTerrain(doc.terrain);
    this.phys.addColliders(collidersForMap(gen.filter((g) => !g.object.gameHidden)));
    this.phys.sync();
    this.world.build(doc, gen);
    this.world.setMode('editor');
    this.env.apply(doc.environment, this.quality);
    const prevSettings = this.editor?.settings;
    this.editor = new Editor(this.camera, $<HTMLCanvasElement>('#view'), this.world, this.ed, this.history);
    if (prevSettings) this.editor.settings = prevSettings;
    this.scene.add(this.editor.root);
    this.editor.onSelection = () => (this.uiDirty = true);
    this.editor.onStatus = () => this.renderStatus();
    this.editor.onToast = (m, k) => toast(m, k);
    this.editor.updateSpawnMarker();
    this.editor.attach();
    this.unsub = this.ed.onChange((changes) => this.applyChanges(changes));
    this.history.onChange = () => {
      this.saver.schedule();
      this.uiDirty = true;
    };
    this.saver = new AutoSaver(this.store, () => this.ed.doc);
    this.saver.onState = () => this.renderStatus();
    if (save) void this.saver.flush();
    this.uiDirty = true;
    $('#tb-mapname').textContent = doc.name;
    const t = doc.testSpawn?.position ?? [0, 0, 0];
    this.camera.position.set(t[0], t[1] + 14, t[2] + 22);
    this.camera.fov = EDITOR_VFOV;
    this.camera.updateProjectionMatrix();
  }

  private R: Awaited<ReturnType<typeof initRapier>> | null = null;
  private physR() {
    return this.R!;
  }

  /** Promítne změny dokumentu do renderu a kolizí (jen dotčené objekty). */
  private applyChanges(changes: Change[]) {
    for (const c of changes) {
      if (c.kind === 'object') {
        const now = this.ed.getObject(c.id);
        this.world.removeObject(c.id);
        this.phys.removeObject(c.id);
        if (now) {
          const g = generateObject(now);
          this.world.addObject(g);
          if (!now.gameHidden) this.phys.addColliders(partsToColliders(now, g.parts));
        }
      } else if (c.kind === 'testSpawn') this.editor.updateSpawnMarker();
      else if (c.kind === 'environment') this.env.apply(this.ed.doc.environment, this.quality);
      else if (c.kind === 'name') $('#tb-mapname').textContent = this.ed.doc.name;
    }
    this.phys.sync();
    this.editor.refreshSelectionVisuals();
  }

  // ---------------- testovací spawn ----------------

  /** Kontrola spawnu proti objemu hráče a terénu. */
  spawnIssue(pos?: [number, number, number]): string | undefined {
    const t = pos ?? this.ed.doc.testSpawn?.position;
    if (!t) return 'Mapa nemá testovací spawn.';
    const feet = { x: t[0], y: t[1], z: t[2] };
    const th = this.terrainHeight(feet.x, feet.z);
    if (th !== null && feet.y < th - 0.05) return 'Spawn je pod terénem.';
    if (this.phys.capsuleBlocked({ ...feet, y: feet.y + 0.03 }, MOVEMENT.stances.stand.height, MOVEMENT.radius)) return 'Spawn je uvnitř objektu (objem hráče koliduje).';
    return undefined;
  }

  private terrainHeight(x: number, z: number): number | null {
    const t = this.ed.doc.terrain;
    const gx = (x - t.origin[0]) / t.spacing, gz = (z - t.origin[1]) / t.spacing;
    if (gx < 0 || gz < 0 || gx > t.samplesX - 1 || gz > t.samplesZ - 1) return null;
    const x0 = Math.min(t.samplesX - 2, Math.floor(gx)), z0 = Math.min(t.samplesZ - 2, Math.floor(gz));
    const fx = gx - x0, fz = gz - z0;
    const h = (i: number, j: number) => t.heights[j * t.samplesX + i];
    return (h(x0, z0) * (1 - fx) + h(x0 + 1, z0) * fx) * (1 - fz) + (h(x0, z0 + 1) * (1 - fx) + h(x0 + 1, z0 + 1) * fx) * fz;
  }

  /** Nejbližší volné místo (spirála, položení na povrch, test objemu hráče). */
  findSafeSpawn(): [number, number, number] | null {
    const t = this.ed.doc.testSpawn?.position ?? [0, 0, 0];
    for (let r = 0; r <= 40; r += 0.5) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.5);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = t[0] + Math.cos(a) * r, z = t[2] + Math.sin(a) * r;
        const hit = this.phys.castRay({ x, y: t[1] + 6, z }, { x: 0, y: -1, z: 0 }, 60);
        if (!hit) continue;
        const p: [number, number, number] = [Math.round(x * 100) / 100, Math.round((hit.point.y + 0.02) * 100) / 100, Math.round(z * 100) / 100];
        if (!this.spawnIssue(p)) return p;
      }
    }
    return null;
  }

  // ---------------- režimy ----------------

  async enterPlay() {
    if (this.mode === 'play') return;
    const v = validateMap(JSON.parse(JSON.stringify(this.ed.doc)));
    if (!v.ok) {
      await modal('Mapu nelze testovat', issuesList(v.issues.filter((i) => i.severity === 'error')), [{ id: 'ok', label: 'Rozumím', primary: true }]);
      return;
    }
    let spawn = this.ed.doc.testSpawn?.position ?? [0, 0, 0];
    const yaw = this.ed.doc.testSpawn?.rotation[1] ?? 0;
    const issue = this.spawnIssue();
    if (issue) {
      const safe = this.findSafeSpawn();
      const choice = await modal(
        'Neplatný testovací spawn',
        `${issue} Hráč se nesmí objevit uvnitř objektu.${safe ? ` Nejbližší volné místo: ${safe.map((n) => n.toFixed(2)).join(', ')}.` : ' Volné místo v okolí 40 m nenalezeno.'}`,
        safe
          ? [
              { id: 'cancel', label: 'Zrušit' },
              { id: 'fix', label: 'Přesunout marker' },
              { id: 'once', label: 'Spustit z volného místa', primary: true },
            ]
          : [{ id: 'cancel', label: 'Zrušit', primary: true }],
      );
      if (!safe || choice === 'cancel' || choice === null) return;
      if (choice === 'fix') {
        this.history.execute({ label: 'Opravit spawn', changes: [{ kind: 'testSpawn', before: this.ed.doc.testSpawn, after: { position: safe, rotation: [0, yaw, 0] } }] });
      }
      spawn = safe;
    }
    this.editorCam = this.editor.saveCamera();
    this.editor.detach();
    this.mode = 'play';
    this.switches++;
    document.body.classList.replace('mode-editor', 'mode-play');
    this.world.setMode('play');
    const s = this.settings;
    this.session = new PlaySession(
      $<HTMLCanvasElement>('#view'),
      this.camera,
      this.phys,
      this.mats,
      this.ed.doc,
      { position: spawn as [number, number, number], yaw },
      { sensitivity: s.sensitivity, invertY: s.invertY, crouchToggle: s.crouchToggle },
      { hFov: s.hFov, bob: s.bob, landingKick: s.landingKick },
      CAMERA.radiansPerCount,
    );
    const inp = this.session.input;
    inp.onDevKey = () => this.toggleDev();
    inp.onMenuKey = () => inp.releaseLock();
    inp.onLockChange = (locked) => this.showPlayMenu(!locked);
    $('#menu-map').textContent = this.ed.doc.name;
    this.showPlayMenu(true);
    this.resize();
    await this.lockPointer();
  }

  private async lockPointer() {
    if (!this.session) return;
    if (this.settings.fullscreen && !document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
        const kb = (navigator as unknown as { keyboard?: { lock?: (k?: string[]) => Promise<void> } }).keyboard;
        await kb?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'Escape', 'KeyR', 'KeyZ', 'KeyB', 'KeyE', 'Digit3', 'Space', 'F5']);
      } catch {
        /* celá obrazovka odmítnuta – hraje se v okně */
      }
    }
    this.session?.input.requestLock();
  }

  private showPlayMenu(show: boolean) {
    if (!this.session) return;
    this.session.game.active = !show;
    $('#menu').classList.toggle('hidden', !show);
    $('#hud').classList.toggle('hidden', show);
  }

  exitPlay() {
    if (this.mode !== 'play' || !this.session) return;
    this.session.dispose();
    this.session = null;
    this.mode = 'editor';
    this.switches++;
    if (document.fullscreenElement) {
      const kb = (navigator as unknown as { keyboard?: { unlock?: () => void } }).keyboard;
      kb?.unlock?.();
      void document.exitFullscreen().catch(() => {});
    }
    document.body.classList.replace('mode-play', 'mode-editor');
    $('#menu').classList.add('hidden');
    $('#hud').classList.add('hidden');
    $('#settings').classList.add('hidden');
    $('#controls').classList.add('hidden');
    this.world.setMode('editor');
    this.world.update(0);
    this.editor.attach();
    if (this.editorCam) this.editor.restoreCamera(this.editorCam);
    this.camera.fov = EDITOR_VFOV;
    this.camera.updateProjectionMatrix();
    this.resize();
    this.uiDirty = true;
  }

  private toggleDev() {
    this.devOn = !this.devOn;
    $('#dev').classList.toggle('hidden', !this.devOn);
  }

  // ---------------- UI ----------------

  private bindUI() {
    buildCatalog((id) => this.editor.insertAsset(id));
    buildSettingsUI(this.settings, () => {
      const g = this.session?.game;
      if (g) g.settings = { hFov: this.settings.hFov, bob: this.settings.bob, landingKick: this.settings.landingKick };
      const i = this.session?.input;
      if (i) i.settings = { sensitivity: this.settings.sensitivity, invertY: this.settings.invertY, crouchToggle: this.settings.crouchToggle };
    });
    buildControlsUI();
    $('#dev').classList.toggle('hidden', !this.devOn);

    // Globální klávesy aplikace (F5 přepíná režim jen uvnitř aplikace).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F5') {
        e.preventDefault();
        if (!$('#modal').classList.contains('hidden')) return;
        if (this.mode === 'editor') void this.enterPlay();
        else this.exitPlay();
      } else if (e.code === 'F3' && this.mode === 'editor') {
        e.preventDefault();
        this.toggleDev();
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && this.mode === 'editor') {
        e.preventDefault();
        void this.saver.flush();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.mode === 'play' || this.saver.state === 'pending' || this.saver.state === 'saving') e.preventDefault();
    });

    $('#tb-play').addEventListener('click', () => void this.enterPlay());
    $('#btn-resume').addEventListener('click', () => void this.lockPointer());
    $('#btn-editor').addEventListener('click', () => this.exitPlay());
    $('#btn-settings').addEventListener('click', () => $('#settings').classList.toggle('hidden'));
    $('#btn-controls').addEventListener('click', () => $('#controls').classList.toggle('hidden'));
    $('#tb-undo').addEventListener('click', () => this.editor.undo());
    $('#tb-redo').addEventListener('click', () => this.editor.redo());
    for (const b of document.querySelectorAll<HTMLButtonElement>('.tool')) {
      b.addEventListener('click', () => this.editor.setTool(b.dataset.tool as never));
    }
    $('#tb-space').addEventListener('click', () => {
      this.editor.settings.space = this.editor.settings.space === 'world' ? 'local' : 'world';
      this.editor.setTool(this.editor.tool);
    });
    $('#tb-check').addEventListener('click', () => void this.checkMap());
    $('#tb-map').addEventListener('click', () => void this.mapMenu());
    $<HTMLSelectElement>('#st-grid').addEventListener('change', (e) => {
      this.editor.settings.grid = Number((e.target as HTMLSelectElement).value);
      this.editor.rebuildGrid();
      this.editor.updateSnap();
    });
    $<HTMLSelectElement>('#st-rot').addEventListener('change', (e) => {
      this.editor.settings.rotSnapDeg = Number((e.target as HTMLSelectElement).value);
      this.editor.updateSnap();
    });
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-collapse]')) {
      b.addEventListener('click', () => this.setCollapsed(b.dataset.collapse!, true));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-expand]')) {
      b.addEventListener('click', () => this.setCollapsed(b.dataset.expand!, false));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) {
      b.addEventListener('click', () => {
        for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b);
        for (const body of document.querySelectorAll<HTMLElement>('.tab-body')) body.classList.toggle('hidden', body.dataset.body !== b.dataset.tab);
        this.uiDirty = true;
      });
    }
    $<HTMLInputElement>('#file-import').addEventListener('change', (e) => void this.importFile(e.target as HTMLInputElement));
    // Panel inspektoru: po opuštění pole dokreslit odloženou změnu.
    $('#inspector').addEventListener('focusout', () => setTimeout(() => (this.uiDirty = true), 0));
  }

  private setCollapsed(side: string, collapsed: boolean) {
    document.body.classList.toggle(`${side}-collapsed`, collapsed);
    $(`[data-expand="${side}"]`).classList.toggle('hidden', !collapsed);
    this.resize();
  }

  private renderUI() {
    renderInspector(this.ed, this.history, this.editor, {
      missing: (id) => this.world.missing.get(id),
      spawnIssue: () => this.spawnIssue(),
    });
    if (!$('[data-body="scene"]').classList.contains('hidden')) renderSceneList(this.ed, this.history, this.editor);
    $<HTMLButtonElement>('#tb-undo').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('#tb-redo').disabled = !this.history.canRedo;
    $('#tb-undo').title = this.history.undoLabel ? `Zpět: ${this.history.undoLabel} (Ctrl+Z)` : 'Zpět (Ctrl+Z)';
    $('#tb-redo').title = this.history.redoLabel ? `Znovu: ${this.history.redoLabel} (Ctrl+Shift+Z)` : 'Znovu';
    this.renderStatus();
  }

  renderStatus() {
    if (!this.editor || !this.saver) return;
    for (const b of document.querySelectorAll<HTMLButtonElement>('.tool')) b.classList.toggle('on', b.dataset.tool === this.editor.tool);
    $('#tb-space').textContent = this.editor.settings.space === 'world' ? 'Osy: svět' : 'Osy: lokální';
    const sv = $('#st-save');
    sv.className = `save ${this.saver.state}`;
    sv.textContent =
      this.saver.state === 'saved'
        ? `● Uloženo${this.saver.savedAt ? ' ' + new Date(this.saver.savedAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : ''}`
        : this.saver.state === 'error'
          ? `● ${this.saver.message}`
          : '● Ukládám…';
    $('#st-snap').textContent = this.editor.snapDisabled ? 'Přichycení VYPNUTO (Alt)' : '';
    $('#st-speed').textContent = `Kamera ${this.editor.settings.flySpeed.toFixed(0)} m/s`;
    $('#st-count').textContent = `${this.ed.doc.objects.length} objektů · výběr ${this.editor.selection.size}`;
    $('#st-hint').textContent = 'F5 testovat · Ctrl+Z/Y historie · Ctrl+D duplikovat · Del smazat · F zaměřit';
  }

  private async checkMap() {
    const v = validateMap(JSON.parse(JSON.stringify(this.ed.doc)));
    const issues = [...v.issues];
    const si = this.spawnIssue();
    if (si) issues.push({ severity: 'warning', path: 'testSpawn', message: si });
    for (const [id, m] of this.world.missing) issues.push({ severity: 'warning', path: id, message: `placeholder: ${m}` });
    const body = issues.length ? issuesList(issues) : document.createTextNode('Bez chyb a upozornění. (Kontrola neprokazuje vyváženost mapy.)');
    await modal('Kontrola mapy', body, [{ id: 'ok', label: 'Zavřít', primary: true }]);
  }

  private async mapMenu() {
    await this.saver.flush();
    const body = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'maplist';
    let maps: Awaited<ReturnType<MapStore['list']>> = [];
    try {
      maps = await this.store.list();
    } catch {
      /* bez úložiště */
    }
    let picked: string | null = null;
    const close = () => $('#modal .modal-buttons button')?.dispatchEvent(new MouseEvent('click'));
    for (const m of maps) {
      const b = document.createElement('button');
      const n = document.createElement('span');
      n.textContent = `${m.id === this.ed.doc.id ? '▸ ' : ''}${m.name}`;
      const sm = document.createElement('small');
      sm.textContent = `${m.objects} obj. · ${new Date(m.updatedAt).toLocaleString('cs-CZ')}`;
      b.append(n, sm);
      b.addEventListener('click', () => {
        picked = m.id;
        close();
      });
      list.appendChild(b);
    }
    const info = document.createElement('div');
    info.className = 'note';
    info.textContent = maps.length ? 'Uložené mapy v tomto prohlížeči (klik otevře):' : 'Zatím žádné uložené mapy.';
    const warn = document.createElement('div');
    warn.className = 'note';
    warn.textContent = 'Prohlížeč může lokální data smazat – důležité mapy si zálohujte exportem do souboru.';
    body.append(info, list, warn);
    const choice = await modal('Mapy', body, [
      { id: 'close', label: 'Zavřít' },
      { id: 'new', label: 'Nová mapa' },
      { id: 'range', label: 'Šablona: střelnice' },
      { id: 'import', label: 'Importovat…' },
      { id: 'export', label: 'Exportovat', primary: true },
    ]);
    if (picked) {
      const l = await this.store.load(picked);
      if (l) this.openDoc(l.doc, false);
      else toast('Mapu se nepodařilo načíst.', 'warn');
      return;
    }
    if (choice === 'new') this.openDoc(buildEmptyMap());
    else if (choice === 'range') this.openDoc(this.rangeTemplate());
    else if (choice === 'import') $<HTMLInputElement>('#file-import').click();
    else if (choice === 'export') exportMapFile(this.ed.doc);
  }

  private async importFile(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const r = await readMapFile(f);
    if (!r.ok || !r.doc) {
      const b = document.createElement('div');
      b.append(document.createTextNode('Soubor neprošel validací. Aktuální mapa zůstává beze změny.'), issuesList(r.issues));
      await modal('Import selhal', b, [{ id: 'ok', label: 'Zavřít', primary: true }]);
      return;
    }
    const doc = r.doc;
    try {
      const existing = await this.store.list();
      if (existing.some((m) => m.id === doc.id)) {
        doc.id = `${doc.id.slice(0, 40)}_${Date.now().toString(36)}`;
        doc.name = `${doc.name} (import)`;
      }
    } catch {
      /* bez úložiště */
    }
    this.openDoc(doc);
    const warns = r.issues.filter((i) => i.severity === 'warning');
    toast(`Importováno: ${doc.name}${warns.length ? ` (${warns.length} upozornění)` : ''}`);
  }

  // ---------------- smyčka ----------------

  private last = performance.now();
  private frameTimes: number[] = [];
  private devT = 0;

  resize() {
    const vp = $('#viewport');
    const w = Math.max(1, vp.clientWidth), h = Math.max(1, vp.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr) * this.quality.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  private loop = (now: number) => {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.renderer.info.reset();
    if (this.session) {
      this.session.update(dt);
      this.world.update(this.session.game.simTime);
      this.updateHud();
    } else {
      this.editor.update(dt);
      if (this.uiDirty) {
        this.uiDirty = false;
        this.renderUI();
      }
    }
    this.env.update(this.camera.position, dt);
    this.post.render(dt);
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 300) this.frameTimes.shift();
    this.devT += dt;
    if (this.devOn && this.devT > 0.15) {
      this.devT = 0;
      this.renderDev();
    }
    requestAnimationFrame(this.loop);
  };

  private updateHud() {
    const s = this.session!.game.state;
    const st = $('#stamina');
    st.classList.toggle('show', s.stamina < 99.5);
    st.classList.toggle('low', s.sprintLocked);
    $('#stamina .fill').style.width = `${s.stamina}%`;
    $('#stance').textContent = s.stance === 'stand' ? 'STOJ' : s.stance === 'crouch' ? 'DŘEP' : 'LEH';
  }

  /** Počty pro kontrolu úniků při přepínání (entity, listenery, prostředky). */
  counts() {
    let objects = 0;
    this.scene.traverse(() => objects++);
    return {
      sceneObjects: objects,
      listeners: this.editor.listenerCount + (this.session?.input.listenerCount ?? 0),
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      colliders: this.phys.world.colliders.len(),
    };
  }

  private renderDev() {
    const info = this.renderer.info;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const c = this.counts();
    const lines = [
      `${this.mode === 'play' ? 'TEST' : 'EDITOR'}  FPS ${(1000 / Math.max(1e-3, p50)).toFixed(0)}  p95 ${p95.toFixed(1)} ms  kvalita ${this.quality.label}${this.post.enabled ? ' +AO' : ''}`,
      `draw ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  geo ${c.geometries}  tex ${c.textures}  scéna ${c.sceneObjects}  kolize ${c.colliders}  listenery ${c.listeners}  přepnutí ${this.switches}`,
    ];
    if (this.session) {
      const g = this.session.game, s = g.state;
      lines.push(
        `pos ${s.pos.x.toFixed(2)} ${s.pos.y.toFixed(2)} ${s.pos.z.toFixed(2)}  yaw ${toDeg(s.yaw).toFixed(1)}°  pitch ${toDeg(s.pitch).toFixed(1)}°  tick ${s.tick}  zahozeno ${g.stats.droppedSteps}`,
        `rychlost ${Math.hypot(s.vel.x, s.vel.z).toFixed(2)} m/s  vy ${s.vel.y.toFixed(2)}  grounded ${s.grounded}`,
        `postoj ${s.stance} (výška ${s.height.toFixed(2)} m)  sprint ${s.sprinting}  výdrž ${s.stamina.toFixed(1)}${s.sprintLocked ? ' (vyčerpáno)' : ''}`,
        `ADS ${s.adsProgress.toFixed(2)}  zbraň: placeholder (krok 6)  síť: offline`,
        s.blocked.length ? `<span class="warn">blokace: ${s.blocked.join(' | ')}</span>` : 'blokace: –',
      );
    } else {
      const p = this.camera.position;
      lines.push(`kamera ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  výběr ${[...this.editor.selection].slice(0, 4).join(', ')}`);
    }
    $('#dev').innerHTML = lines.join('\n');
  }

  /** Volá main před init(): Rapier se inicializuje jednou. */
  async prepare() {
    this.R = await initRapier();
  }
}

export { TEST_SPAWN_ID, vFovFromH16x9 };
