import * as THREE from 'three';
import { CAMERA, vFovFromH16x9 } from '../shared/config/camera';
import { MOVEMENT, toDeg } from '../shared/config/movement';
import { rulesOf } from '../shared/config/arsenal';
import { spreadOf } from '../shared/sim/weapon';
import type { MapDocument } from '../shared/map/schema';
import { validateMap } from '../shared/map/validate';
import { PhysicsWorld, initRapier } from '../shared/physics/world';
import { generateObject, partsToColliders, collidersForMap, generateMap, getAsset, resolveParams, type LadderDef } from '../world';
import { buildEmptyMap } from '../world/maps/empty';
import { buildRangeMap } from '../world/maps/range';
import { buildStreetMap } from '../world/maps/street';
import { buildShowcaseMap } from '../world/maps/showcase';
import { buildOsadaSliceMap } from '../world/maps/osadaSlice';
import { Editor, TEST_SPAWN_ID } from './editor/editor';
import { EditorDoc, History, cmds, type Change } from './editor/editorDoc';
import { AutoSaver, MapStore, exportMapFile, readMapFile } from './editor/persistence';
import { buildCatalog, issuesList, modal, renderInspector, renderSceneList, toast } from './editor/ui';
import { insertMarker, renderTerrainPanel, type GameUiState } from './editor/uiGame';
import { debugLines } from '../shared/physics/world';
import { heightAt } from '../world/terrain';
import type { MapObject } from '../shared/map/schema';
import { cutApronNeeded, cutPending, footprintPoints, localFootprint, planTerrainFit, type Pad } from '../world/groundFit';
import { EnvironmentRig } from './render/environment';
import { preloadGunModels } from './render/weapons/glbWeapon';
import { preloadSoldierModel } from './render/soldier/mannequin';
import { preloadGlbProps } from './render/glbProps';
import { MaterialLibrary, TEXTURE_IDS, generateTextures, makeMacroNoise, sharedUniforms } from './render/materials';
import { PostPipeline } from './render/post';
import { QUALITY, type QualityProfile } from './render/quality';
import { WorldView } from './render/worldView';
import { PlaySession } from './runtime/session';
import { GameAudio } from './runtime/audio';
import { NetDriver } from './runtime/netDriver';
import { TeamUi } from './ui/teamUi';
import type { WsLike } from '../shared/net/client';
import type { GameDriver } from './runtime/driver';
import type { Team } from '../shared/map/schema';
import { SettingsView, applyUiSettings, bindingsOf, controlsView, keyLabel, loadSettings, saveSettings, type Settings } from './ui/settings';
import { MainMenu, type Phase } from './ui/mainMenu';
import { PauseMenu } from './ui/pause';
import { TeamScreens, scoreboard } from './ui/teamScreens';
import { PILOT } from '../shared/config/arsenal';
import { h } from './ui/kit';
import { applyStatic, onLang, t } from './ui/i18n';
import type { Footprint } from './ui/tactical';
import { FlagSystem } from './render/flags';
import { Thumbnails } from './editor/thumbnails';
import { DEFAULT_FACTIONS } from '../shared/config/arsenal';
import { PROTOCOL_VERSION } from '../shared/net/protocol';
import { insecureFromHttps } from './ui/servers';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const EDITOR_VFOV = 60;
const PREVIEW = new URLSearchParams(location.search).get('preview');

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
  /** Žebříky po objektech (pro simulaci lezení v testu). */
  ladders = new Map<string, LadderDef[]>();
  gameUi: GameUiState = { scenario: null };
  readonly audio = new GameAudio();
  private colliderLines: THREE.LineSegments | null = null;
  menu: MainMenu | null = null;
  readonly flags = new FlagSystem();
  private thumbs: Thumbnails | null = null;
  private catalog: { refresh(): void } | null = null;
  pause: PauseMenu | null = null;
  private sbEl: HTMLElement | null = null;
  private sbT = 0;
  /** Kam se vrátit po hře: hlavní menu (trénink, server) nebo editor (test mapy). */
  private returnTo: 'menu' | 'editor' = 'editor';
  readonly settingsView = new SettingsView(
    () => this.settings,
    (s, reload) => this.applySettings(s, reload),
  );

  /** Potvrzené nastavení: uložit a promítnout do běžící hry i UI. */
  applySettings(s: Settings, reload = false) {
    this.settings = s;
    saveSettings(s);
    applyUiSettings(s);
    this.audio.setVolume(s.volume);
    const g = this.session?.game;
    if (g) g.settings = { hFov: s.hFov, bob: s.bob, landingKick: s.landingKick, weapon: s.weapon, adsSens: s.adsSens };
    const i = this.session?.input;
    if (i) {
      i.settings = { sensitivity: s.sensitivity, invertY: s.invertY, crouchToggle: s.crouchToggle };
      i.bindings = bindingsOf(s);
    }
    $('#dev').classList.toggle('hidden', !(this.devOn || s.showFps));
    if (reload) void this.saver.flush().then(() => location.reload());
  }

  /**
   * Náhledový režim (?preview=servers): ukázková data pro vzhled obrazovek, zřetelně označená
   * pruhem „NÁHLED – smyšlená data“. Nikdy se nepřipojuje k serveru.
   */
  private startPreview(kind: string) {
    document.body.append(h('div', { class: 'pf-preview-flag' }, t('preview.badge')));
    if (kind === 'servers' || kind === 'menu') {
      const info = (name: string, players: number, ff: boolean, protocol = PROTOCOL_VERSION) => ({ name, map: 'Referenční ulice', mode: 'conquest' as const, players, capacity: 16, friendlyFire: ff, protocol, pilot: true, teamSize: 8, kits: PILOT.kits, factions: { teamA: 'usmc', teamB: 'mec' } });
      this.menu?.setPreviewEntries([
        { address: 'ws://ukazka-1:8787', state: 'ok', info: info('Ukázkový server 1', 11, false), ping: 34 },
        { address: 'ws://ukazka-2:8787', state: 'ok', info: info('Ukázkový server 2', 16, true), ping: 58 },
        { address: 'ws://ukazka-3:8787', state: 'ok', info: info('Ukázkový server (stará verze)', 4, false, PROTOCOL_VERSION - 1), ping: 80 },
        { address: 'ws://ukazka-4:8787', state: 'error', ping: null, error: 'timeout' },
      ]);
      if (kind === 'servers') this.menu?.show('servers');
    }
  }

  openEditor() {
    this.menu?.hide();
    document.body.classList.remove('mode-menu');
    this.resize();
  }

  showMenu() {
    document.body.classList.add('mode-menu');
    this.menu?.show('play');
  }

  /** Trénink: offline Conquest na šabloně ulice s pilotními classami (bez botů). */
  async training() {
    await this.saver.flush();
    this.editorDocBeforeNet = this.ed.doc;
    const d = this.streetTemplate();
    this.openDoc(d, false);
    this.menu?.hide();
    document.body.classList.remove('mode-menu');
    this.returnTo = 'menu';
    await this.enterPlay(undefined, { conquest: true, scenarioId: d.scenarios[0]?.id, team: 'teamA', kits: PILOT.kits });
  }
  private showColliders = false;

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
    const [, , , , textures] = await Promise.all([
      initRapier(),
      preloadGlbProps(import.meta.env.BASE_URL),
      preloadGunModels(import.meta.env.BASE_URL),
      preloadSoldierModel(import.meta.env.BASE_URL),
      generateTextures(TEXTURE_IDS, this.quality.textureSize, anis, (d, n) => progress(0.05 + (d / n) * 0.8, `Generuji materiály ${d}/${n}`), this.settings.softTextures),
    ]);
    sharedUniforms.uMacro.value = makeMacroNoise();
    this.mats = new MaterialLibrary(textures);
    this.world = new WorldView(this.mats, textures);
    this.scene.add(this.world.root);
    this.scene.add(this.flags.root);
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
    this.menu = new MainMenu({
      connect: (a, n, ph, sig) => this.connectDriver(a, n, { latencyMs: 0, jitterMs: 0, lossPct: 0 }, ph, sig),
      openEditor: () => this.openEditor(),
      training: () => void this.training(),
      settingsView: () => this.settingsView.open(),
      controlsView: () => controlsView(this.settings),
      preview: !!PREVIEW,
    });
    if (PREVIEW) this.startPreview(PREVIEW);
    if (new URLSearchParams(location.search).has('editor')) this.openEditor();
    requestAnimationFrame(this.loop);
    (window as unknown as Record<string, unknown>).__pf = this;
  }

  streetTemplate() {
    const d = buildStreetMap();
    d.id = `street_${Date.now().toString(36)}`;
    return d;
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
    this.ladders.clear();
    for (const g of gen) if (g.ladders.length && !g.object.gameHidden) this.ladders.set(g.object.id, g.ladders);
    this.phys.setTerrain(doc.terrain);
    this.phys.addColliders(collidersForMap(gen.filter((g) => !g.object.gameHidden)));
    this.phys.sync();
    this.world.build(doc, gen);
    this.flags.rebuild(doc.controlPoints);
    this.world.setMode('editor');
    this.env.shadowRate = 0;
    this.env.apply(doc.environment, this.quality);
    const prevSettings = this.editor?.settings;
    this.editor = new Editor(this.camera, $<HTMLCanvasElement>('#view'), this.world, this.ed, this.history);
    if (prevSettings) this.editor.settings = prevSettings;
    this.scene.add(this.editor.root);
    this.editor.onSelection = () => (this.uiDirty = true);
    this.editor.onStatus = () => this.renderStatus();
    this.editor.onToast = (m, k) => toast(m, k);
    this.editor.updateSpawnMarker();
    this.editor.markers.rebuild(doc);
    this.editor.onTerrainPreview = () => this.world.updateTerrain(this.ed.doc.terrain);
    this.gameUi.scenario = null;
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
  /** Přegeneruje jeden objekt (render, kolize, žebříky) z aktuálního dokumentu a terénu. */
  private regenObject(id: string) {
    const now = this.ed.getObject(id);
    this.world.removeObject(id);
    this.phys.removeObject(id);
    this.ladders.delete(id);
    if (!now) return;
    const g = generateObject(now, this.ed.doc.terrain, this.ed.doc.objects);
    this.world.addObject(g);
    if (g.ladders.length && !now.gameHidden) this.ladders.set(now.id, g.ladders);
    if (!now.gameHidden) this.phys.addColliders(partsToColliders(now, g.parts));
  }

  private applyChanges(changes: Change[]) {
    for (const c of changes) {
      if (c.kind === 'object') {
        this.regenObject(c.id);
        // Kreslená silnice: přepočítat i ostatní (křižovatky se mohly objevit nebo zmizet).
        const kind = (c.after ?? c.before)?.assetId;
        if (kind === 'street.roadPath') for (const o of this.ed.doc.objects) if (o.assetId === 'street.roadPath' && o.id !== c.id) this.regenObject(o.id);
      }
      else if (c.kind === 'terrain') {
        // Render i kolize terénu se aktualizují spolu (i při undo) – test nikdy nepoběží se starým colliderem.
        this.world.updateTerrain(this.ed.doc.terrain);
        this.phys.setTerrain(this.ed.doc.terrain);
        // Ploty, zdi a ulice, které kopírují terén, se přegenerují.
        for (const o of this.ed.doc.objects) {
          const def = getAsset(o.assetId);
          if (def?.usesTerrain?.(resolveParams(def, o.params))) this.regenObject(o.id);
        }
      } else if (c.kind === 'entity') {
        this.editor.markers.rebuild(this.ed.doc);
        this.flags.rebuild(this.ed.doc.controlPoints);
      } else if (c.kind === 'testSpawn') this.editor.updateSpawnMarker();
      else if (c.kind === 'environment') this.env.apply(this.ed.doc.environment, this.quality);
      else if (c.kind === 'name') $('#tb-mapname').textContent = this.ed.doc.name;
    }
    this.phys.sync();
    this.editor.refreshSelectionVisuals();
    if (this.showColliders) this.rebuildColliderLines();
  }

  private rebuildColliderLines() {
    if (this.colliderLines) {
      this.colliderLines.geometry.dispose();
      (this.colliderLines.material as THREE.Material).dispose();
      this.colliderLines.removeFromParent();
      this.colliderLines = null;
    }
    if (!this.showColliders) return;
    const { vertices, colors } = debugLines(this.phys);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.colliderLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthTest: false }));
    this.colliderLines.renderOrder = 15;
    this.colliderLines.raycast = () => {};
    this.editor.root.add(this.colliderLines);
  }

  /** Předměty, které stojí na terénu nebo na jiném předmětu (ne doplňky na zdi). */
  private groundCandidates(): MapObject[] {
    return this.ed.doc.objects.filter((o) => {
      const def = getAsset(o.assetId);
      if (!def || def.mount?.kind === 'wall' || o.editor?.locked) return false;
      return true;
    });
  }

  /**
   * Podpora předmětu: výška, na kterou má dosednout. Ze všech bodů půdorysu: pokud něco pod
   * patou je jiný předmět (střecha, bedna), dosedne na nejvyšší z nich; jinak na nejnižší bod
   * terénu pod půdorysem (žádný roh nevisí ve vzduchu). Předměty kopírující terén = terén v pivotu.
   */
  private supportOf(o: MapObject): { y: number; onObject: boolean; by?: string } | null {
    const t = this.ed.doc.terrain;
    const def = getAsset(o.assetId)!;
    const [px, py, pz] = o.transform.position;
    if (def.usesTerrain?.(resolveParams(def, o.params)) || def.params.some((q) => q.type === 'points')) {
      const h = heightAt(t, px, pz);
      return h === null ? null : { y: h, onObject: false };
    }
    const g = generateObject(o, t, this.ed.doc.objects);
    const fp = localFootprint(g.parts);
    let terrainMin = Infinity, objTop = -Infinity, by: string | undefined;
    for (const [x, z] of footprintPoints(o, fp, this.cutOf(o))) {
      const th = heightAt(t, x, z);
      if (th !== null) terrainMin = Math.min(terrainMin, th);
      // Jiný předmět pod patou (paprsek jen kousek nad patou → nechytí střechu nad sebou).
      const from = Math.max(py, th ?? py) + 0.35;
      const hit = this.phys.castRay({ x, y: from, z }, { x: 0, y: -1, z: 0 }, 400, undefined, undefined, o.id);
      // Podpora = plocha jiného předmětu POD patou (střecha pod nádrží, bedna pod bednou). Věci, které
      // jen stojí uvnitř / vedle (bedna v domě, plot u zdi), sahají nad patu → nepočítají se.
      if (hit && hit.objectId !== '__terrain' && (th === null || hit.point.y > th + 0.25) && hit.point.y <= py + 0.05 && hit.point.y > objTop) {
        objTop = hit.point.y;
        by = hit.objectId;
      }
    }
    if (isFinite(objTop)) return { y: objTop, onObject: true, by };
    return isFinite(terrainMin) ? { y: terrainMin, onObject: false } : null;
  }

  /** Prohlubeň v terénu, kterou předmět potřebuje (sklepní vstup), jinak undefined. */
  private cutOf(o: MapObject) {
    const def = getAsset(o.assetId);
    return def?.terrainCut?.(resolveParams(def, o.params));
  }

  /** Jedno tlačítko: všechny předměty dosednou na zem (nebo na předmět pod sebou). */
  groundAllObjects() {
    const changes = this.groundChanges();
    if (!changes.length) return toast('Všechny předměty už stojí na zemi.');
    this.history.execute({ label: `Položit předměty na zem (${changes.length})`, changes });
    toast(`Na zem položeno předmětů: ${changes.length} (Ctrl+Z vrátí)`);
  }

  /** Změny „položit na zem“ (jen `only`, pokud je zadáno; podpůrné předměty se počítají vždy). */
  private groundChanges(only?: Set<string>): Change[] {
    const changes: Change[] = [];
    // Odspodu nahoru: předmět na jiném předmětu (nádrž na střeše) se posune spolu s ním.
    const delta = new Map<string, number>();
    const list = this.groundCandidates().sort((a, b) => a.transform.position[1] - b.transform.position[1]);
    for (const o of list) {
      if (only && !only.has(o.id)) continue;
      const sup = this.supportOf(o);
      if (!sup) continue;
      const [x, y, z] = o.transform.position;
      const ny = Math.round((sup.y + (sup.by ? (delta.get(sup.by) ?? 0) : 0)) * 1000) / 1000;
      delta.set(o.id, ny - y);
      if (Math.abs(ny - y) < 0.005) continue;
      changes.push({ kind: 'object', id: o.id, before: structuredClone(o), after: { ...structuredClone(o), transform: { ...o.transform, position: [x, ny, z] } } });
    }
    return changes;
  }

  /** Jedno tlačítko: terén se pod předměty srovná na jejich patu a plynule zaoblí do okolí. */
  fitTerrainToObjects() {
    const r = this.terrainFitChange();
    if (!r) return toast('Terén už pod všemi předměty sedí.');
    this.history.execute({ label: `Dorovnat terén pod předměty (${r.count})`, changes: [r.change] });
    toast(`Terén dorovnán pod ${r.count} předměty (${r.points} bodů terénu, Ctrl+Z vrátí)`);
  }

  private terrainFitChange(only?: Set<string>): { change: Change; count: number; points: number } | null {
    const t = this.ed.doc.terrain;
    const pads: Pad[] = [];
    for (const o of this.groundCandidates()) {
      if (only && !only.has(o.id)) continue;
      const def = getAsset(o.assetId)!;
      // Ploty, zdi a kreslené silnice kopírují terén samy.
      if (def.usesTerrain?.(resolveParams(def, o.params)) || def.params.some((q) => q.type === 'points')) continue;
      const sup = this.supportOf(o);
      if (!sup || sup.onObject) continue;
      const g = generateObject(o, t, this.ed.doc.objects);
      const fp = localFootprint(g.parts);
      const cut = this.cutOf(o);
      // Upravit jen tam, kde terén pod půdorysem od paty skutečně odbíhá (nebo chybí prohlubeň).
      const pts = footprintPoints(o, fp, cut).map(([x, z]) => heightAt(t, x, z) ?? o.transform.position[1]);
      if (pts.every((h) => Math.abs(h - o.transform.position[1]) < 0.02) && !(cut && cutPending(t, o, cut))) continue;
      pads.push({ object: o, fp, base: o.transform.position[1], cut });
    }
    const plan = planTerrainFit(t, pads);
    if (!plan) return null;
    return { change: { kind: 'terrain', region: plan.region, before: plan.before, after: plan.after }, count: pads.length, points: plan.changed };
  }

  /** Nejbližší volné místo pro hráče (spawn) do 10 m: na povrchu, bez kolize s objekty. */
  private freeSpotNear(p: [number, number, number]): [number, number, number] | null {
    for (let r = 0; r <= 10; r += 0.75) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.75);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = p[0] + Math.cos(a) * r, z = p[2] + Math.sin(a) * r;
        // Povrch pod bodem (paprsek z výšky pasu → podlaha ve stejné místnosti, ne střecha).
        const hit = this.phys.castRay({ x, y: p[1] + 1.2, z }, { x: 0, y: -1, z: 0 }, 60);
        const th = this.terrainHeight(x, z);
        const y = hit ? hit.point.y : th;
        if (y === null || y === undefined) continue;
        const q: [number, number, number] = [Math.round(x * 100) / 100, Math.round((y + 0.02) * 100) / 100, Math.round(z * 100) / 100];
        if (!this.spawnIssue(q)) return q;
      }
    }
    return null;
  }

  /** Předměty, jejichž půdorysy se výrazně překrývají (AABB, bez doplňků a věcí na jiných předmětech). */
  private overlaps(): { a: MapObject; b: MapObject; push: [number, number] }[] {
    const boxes: { o: MapObject; x0: number; z0: number; x1: number; z1: number }[] = [];
    for (const o of this.groundCandidates()) {
      const def = getAsset(o.assetId)!;
      if (def.mount || def.params.some((q) => q.type === 'points') || def.usesTerrain?.(resolveParams(def, o.params))) continue;
      const g = generateObject(o, this.ed.doc.terrain, this.ed.doc.objects);
      if (!g.parts.some((p) => p.collide)) continue;
      const fp = localFootprint(g.parts);
      const pts = footprintPoints(o, fp);
      const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
      const b = { o, x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
      if ((b.x1 - b.x0) * (b.z1 - b.z0) < 1) continue;
      boxes.push(b);
    }
    const out: { a: MapObject; b: MapObject; push: [number, number] }[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i], B = boxes[j];
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
        if (ox <= 0 || oz <= 0) continue;
        const small = Math.min((A.x1 - A.x0) * (A.z1 - A.z0), (B.x1 - B.x0) * (B.z1 - B.z0));
        if (ox * oz < small * 0.25) continue;
        // Odsunout B po kratší ose ven z A (+ mezera 0,2 m).
        const bcx = (B.x0 + B.x1) / 2, acx = (A.x0 + A.x1) / 2, bcz = (B.z0 + B.z1) / 2, acz = (A.z0 + A.z1) / 2;
        const push: [number, number] = ox < oz ? [Math.sign(bcx - acx || 1) * (ox + 0.2), 0] : [0, Math.sign(bcz - acz || 1) * (oz + 0.2)];
        out.push({ a: A.o, b: B.o, push });
      }
    return out;
  }

  /** Jednorázové položení objektů na povrch pod nimi (terén nebo jiný objekt). */
  dropToSurface(ids: string[]) {
    const changes: Change[] = [];
    for (const id of ids) {
      const o = this.ed.getObject(id);
      if (!o) continue;
      const [x, y, z] = o.transform.position;
      const hit = this.phys.castRay({ x, y: y + 50, z }, { x: 0, y: -1, z: 0 }, 200, undefined, undefined, id);
      const ny = hit ? hit.point.y : heightAt(this.ed.doc.terrain, x, z);
      if (ny === null || ny === undefined || Math.abs(ny - y) < 1e-4) continue;
      changes.push({ kind: 'object', id, before: structuredClone(o), after: { ...structuredClone(o), transform: { ...o.transform, position: [x, Math.round(ny * 1000) / 1000, z] } } });
    }
    if (changes.length) this.history.execute({ label: 'Položit na povrch', changes });
    else toast('Objekt už leží na povrchu.');
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

  private teamUi: TeamUi | null = null;
  private editorDocBeforeNet: MapDocument | null = null;

  /** Připojení k autoritativnímu serveru: mapa přijde ze serveru (klient ji neposílá jako pravdu). */
  async connectDriver(url: string, name: string, cond: { latencyMs: number; jitterMs: number; lossPct: number }, onPhase: (p: Phase) => void = () => {}, signal?: AbortSignal): Promise<string | null> {
    let ws: WebSocket;
    try {
      const u = new URL(url);
      if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return 'address';
      if (insecureFromHttps(url)) return 'insecure';
      ws = new WebSocket(url);
    } catch {
      return 'address';
    }
    const driver = new NetDriver(ws as unknown as WsLike, name, cond);
    onPhase('connecting');
    const t0 = performance.now();
    let opened = false;
    while (!driver.net.welcome && !driver.net.closed) {
      if (signal?.aborted) {
        driver.dispose();
        return 'cancelled';
      }
      if (!opened && ws.readyState === WebSocket.OPEN) {
        opened = true;
        onPhase('auth');
      }
      // Bezplatný hosting uspává nečinný server – probuzení trvá až minutu (lokálně 8 s).
      if (performance.now() - t0 > (/^wss?:\/\/(localhost|127\.)/.test(url) ? 8000 : 75000)) {
        driver.dispose();
        return 'timeout';
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const w = driver.net.welcome;
    if (!w) {
      const reason = driver.net.closeReason;
      driver.dispose();
      if (reason === 'full') return 'full';
      if (/protokol|protocol|verze/i.test(reason)) return 'version';
      return reason || (opened ? 'closed' : 'unreachable');
    }
    onPhase('loading');
    const v = validateMap(JSON.parse(JSON.stringify(w.map)));
    if (!v.ok) {
      driver.dispose();
      return 'map';
    }
    await this.saver.flush();
    if (this.mode === 'play') this.exitPlay(true);
    this.editorDocBeforeNet = this.ed.doc;
    this.openDoc(w.map, false);
    driver.attachWorld(this.phys, [...this.ladders.values()].flat());
    onPhase('ready');
    document.body.classList.remove('mode-menu');
    this.returnTo = 'menu';
    await this.enterPlay(driver);
    return null;
  }

  /** Přímé připojení (testy, konzole): chyba se ukáže dialogem. */
  async connectTo(url: string, name: string, cond = { latencyMs: 0, jitterMs: 0, lossPct: 0 }) {
    const err = await this.connectDriver(url, name, cond);
    if (err) await modal(t('connect.failed'), document.createTextNode(err), [{ id: 'ok', label: t('common.close'), primary: true }]);
    else this.menu?.hide();
  }

  /**
   * Test z editoru: nejdřív kliknout do scény, kde se hráč objeví (směr pohledu = kamera editoru).
   * Enter použije uložený spawn (marker), Esc / pravé tlačítko zruší.
   */
  async pickAndPlay() {
    if (this.mode !== 'editor' || this.editor.stroking) return;
    if (this.editor.terrainMode) this.editor.setTerrainMode(false);
    toast('Klikni do scény, kde se objevíš · Enter = uložený spawn · Esc = zrušit');
    const r = await this.editor.pickSpawn();
    if (!r) return;
    if (r !== 'marker') this.history.execute({ label: 'Spawn testu', changes: [{ kind: 'testSpawn', before: this.ed.doc.testSpawn, after: { position: r.pos, rotation: [0, r.yaw, 0] } }] });
    await this.enterPlay();
  }

  async enterPlay(netDriver?: GameDriver, preset?: { conquest: boolean; scenarioId?: string; team: Team; kits?: typeof PILOT.kits }) {
    if (this.mode === 'play' || this.editor.stroking) return;
    if (this.editor.terrainMode) this.editor.setTerrainMode(false);
    const v = validateMap(JSON.parse(JSON.stringify(this.ed.doc)));
    if (!v.ok) {
      await modal('Mapu nelze testovat', issuesList(v.issues.filter((i) => i.severity === 'error')), [{ id: 'ok', label: 'Rozumím', primary: true }]);
      return;
    }
    let spawn = this.ed.doc.testSpawn?.position ?? [0, 0, 0];
    const yaw = this.ed.doc.testSpawn?.rotation[1] ?? 0;
    const issue = netDriver ? undefined : this.spawnIssue();
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
    // Volba režimu: volný test od markeru, nebo Conquest (scénář + tým), má-li mapa body.
    let mode: { conquest: boolean; scenarioId?: string; team: Team; kits?: typeof PILOT.kits } = preset ?? { conquest: false, team: 'teamA' };
    const doc = this.ed.doc;
    if (!preset && doc.controlPoints.length && doc.scenarios.length && !this.forceFreeTest && !netDriver) {
      const b = document.createElement('div');
      b.innerHTML = `<div class="prop"><span class="lbl">Scénář</span><select id="pm-sc">${doc.scenarios.map((x) => `<option value="${x.id}">${x.name.replace(/[<>&"]/g, '')}</option>`).join('')}</select></div><div class="prop"><span class="lbl">Tým</span><select id="pm-team"><option value="teamA">Tým A</option><option value="teamB">Tým B</option></select></div><div class="note">Conquest běží lokálně (bez botů): zabírání, tickety, respawn a zóny podle scénáře.</div>`;
      const ch = await modal('Testovat', b, [
        { id: 'cancel', label: 'Zrušit' },
        { id: 'free', label: 'Volný test od markeru' },
        { id: 'cq', label: 'Conquest', primary: true },
      ]);
      if (!ch || ch === 'cancel') return;
      if (ch === 'cq') mode = { conquest: true, scenarioId: (b.querySelector('#pm-sc') as HTMLSelectElement).value, team: (b.querySelector('#pm-team') as HTMLSelectElement).value as Team };
    }
    if (!netDriver && !preset) this.returnTo = 'editor';
    this.audio.unlock();
    this.editorCam = this.editor.saveCamera();
    this.editor.detach();
    this.mode = 'play';
    this.switches++;
    document.body.classList.replace('mode-editor', 'mode-play');
    this.world.setMode('play');
    this.env.shadowRate = 20;
    const s = this.settings;
    this.session = new PlaySession(
      $<HTMLCanvasElement>('#view'),
      this.camera,
      this.scene,
      this.phys,
      this.world,
      this.ed.doc,
      { position: spawn as [number, number, number], yaw },
      [...this.ladders.values()].flat(),
      this.audio,
      this.quality,
      { sensitivity: s.sensitivity, invertY: s.invertY, crouchToggle: s.crouchToggle },
      { hFov: s.hFov, bob: s.bob, landingKick: s.landingKick, weapon: s.weapon, adsSens: s.adsSens },
      CAMERA.radiansPerCount,
      { ...mode, driver: netDriver },
    );
    const game = this.session.game;
    game.buildMap(this.footprints());
    game.onLeave = () => this.exitPlay();
    const inp = this.session.input;
    inp.bindings = bindingsOf(s);
    this.session.game.hud.slots.bindLabel = (slot) => {
      const b = bindingsOf(this.settings)[`SLOT${slot}` as 'SLOT1'];
      return b?.length ? keyLabel(b[0]) : '—';
    };
    this.session.game.slotKey = this.session.game.hud.slots.bindLabel;
    const net = netDriver instanceof NetDriver ? netDriver : null;
    if (net) {
      this.teamUi = new TeamUi(net, inp, this.ed.doc);
      const ts = new TeamScreens(net, () => game.map);
      game.extraTabs = [
        { id: 'squad', label: t('pause.squad'), view: () => ts.squadView() },
        { id: 'commander', label: t('pause.commander'), full: true, view: () => (game.driver.local() ? ts.commanderView(game.driver.local()!, game.driver.remotes(), game.driver.conquest()) : h('div')) },
      ];
    }
    const teamKey = inp.onUiKey;
    inp.onUiKey = (code, down) => {
      if (teamKey(code, down)) return true;
      if (!down) return false;
      if (net && (code === 'KeyP' || code === 'Home')) return this.openPause('squad'), true;
      if (net && code === 'KeyC') return this.openPause('commander'), true;
      if (code === 'Enter' || code === 'NumpadEnter') return this.openDeploy(), true;
      if (code === 'KeyM') {
        // Mapa jen k prohlížení: uvolní myš (zoom, posun), boj se nepropustí.
        game.hud.toggleMap(true);
        inp.releaseLock();
        inp.clear();
        return true;
      }
      return false;
    };
    game.hud.deploy.onClose = () => {
      game.hud.deploy.close();
      // Tlačítko „Zpět do hry“ je uživatelské gesto → pointer lock (živý hráč).
      if (game.driver.local()?.alive) void this.lockPointer();
    };
    this.pause = new PauseMenu({
      resume: () => void this.lockPointer(),
      deploy: () => {
        // Nasazení za živa: změna výbavy platí pro příští nasazení (obrazovka to vysvětluje).
        this.pause?.show(false);
        game.hud.deploy.open(false);
      },
      leave: () => this.exitPlay(),
      settings: () => this.settingsView.open(),
      controls: () => controlsView(this.settings),
      extra: game.extraTabs,
      network: !!net,
      mapName: this.ed.doc.name,
    });
    inp.onDevKey = () => this.toggleDev();
    inp.onMenuKey = () => inp.releaseLock();
    inp.onLockChange = (locked) => {
      // Mrtvý / vyřazený hráč pracuje s kurzorem (nasazení, vzdání pomoci) → pauza jen u živého hráče.
      const me = this.session?.game.driver.local();
      const alive = me?.alive ?? true;
      if (locked) this.pause?.show(false);
      else if (alive && !game.hud.deploy.visible) this.pause?.show(true);
      game.active = locked;
      $('#hud').classList.remove('hidden');
    };
    $('#hud').classList.remove('hidden');
    game.active = false;
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

  forceFreeTest = false;

  private openPause(section: string | null) {
    this.session?.input.releaseLock();
    this.pause?.show(true, section);
  }

  /** Půdorysy viditelných objektů pro taktickou mapu (jednou na hru). */
  private footprints(): Footprint[] {
    const out: Footprint[] = [];
    const box = new THREE.Box3();
    for (const o of this.ed.doc.objects) {
      if (o.gameHidden) continue;
      const g = this.world.objects.get(o.id);
      if (!g) continue;
      box.setFromObject(g);
      if (box.isEmpty()) continue;
      const hgt = box.max.y - box.min.y;
      if (hgt < 0.4) continue;
      out.push({ x0: box.min.x, z0: box.min.z, x1: box.max.x, z1: box.max.z, h: hgt });
    }
    return out;
  }

  /** Tab: tabulka skóre (drží se; funguje živý i mrtvý). */
  private scoreKey = (e: KeyboardEvent) => {
    if (e.code !== 'Tab' || !this.session) return;
    e.preventDefault();
    if (e.type === 'keydown' && !e.repeat) {
      this.sbEl ??= document.body.appendChild(h('div', { id: 'pf-scoreboard', class: 'pf-screen pf-scoreboard' }));
      this.sbT = 1;
    } else if (e.type === 'keyup') {
      this.sbEl?.remove();
      this.sbEl = null;
    }
  };

  private renderScoreboard(dt: number) {
    if (!this.sbEl || !this.session) return;
    this.sbT += dt;
    if (this.sbT < 0.25) return;
    this.sbT = 0;
    const g = this.session.game, d = g.driver, me = d.local();
    this.sbEl.replaceChildren(h('h2', {}, t('score.title')), scoreboard({ me, remotes: d.remotes(), team: me?.team ?? 'teamA', cq: d.conquest(), net: d instanceof NetDriver ? d : null }));
  }

  /** Esc bez zamčené myši: zavřít pauzu (návrat do hry), případně ji otevřít. */
  /** Otevřít obrazovku nasazení (Enter): uvolnit myš, vyčistit držené vstupy (boj se nepropustí). */
  private openDeploy() {
    const s = this.session;
    if (!s) return;
    this.pause?.show(false);
    s.game.hud.deploy.open(false);
    s.input.releaseLock();
    s.input.clear();
  }

  private playKey = (e: KeyboardEvent) => {
    if (!this.session || this.session.input.locked) return;
    if (!$('#modal').classList.contains('hidden') || document.querySelector('.pf-dialog')) return;
    const g = this.session.game;
    const dep = g.hud.deploy;
    const tgt = e.target as HTMLElement | null;
    const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && !typing) {
      if (dep.visible) {
        // Enter v obrazovce = hlavní akce, jen když fokus není v jiném ovládacím prvku.
        if (!tgt || tgt === document.body || tgt.classList.contains('pf-map-canvas') || tgt.classList.contains('pf-deploy')) {
          e.preventDefault();
          dep.primaryAction();
        }
      } else if (!this.pause?.visible && !this.menu?.visible) {
        e.preventDefault();
        this.openDeploy();
      }
      return;
    }
    if (g.hud.mapVisible && (e.code === 'KeyM' || e.code === 'Escape')) {
      g.hud.toggleMap(false);
      if (g.driver.local()?.alive && e.code === 'KeyM') void this.lockPointer();
      return;
    }
    if (e.code !== 'Escape') return;
    // Escape: nejdřív bublina / seznam, pak obrazovka, pak pauza.
    const picker = document.querySelector('.pf-map-picker:not(.hidden)');
    if (picker) return picker.classList.add('hidden');
    if (this.pause?.visible) {
      if (g.driver.local()?.alive) void this.lockPointer();
      else this.pause.show(false);
    } else if (dep.visible) {
      dep.close();
      if (g.driver.local()?.alive) void this.lockPointer();
    } else this.pause?.show(true);
  };

  /** Výzva k návratu do hry, když myš není zamčená a nic jiného obraz nezakrývá. */
  private lockPrompt: HTMLElement | null = null;
  private updateLockPrompt() {
    const s = this.session;
    const g = s?.game;
    const show = !!s && !s.input.locked && !this.pause?.visible && !g!.hud.deploy.visible && !g!.hud.mapVisible && !this.sbEl && !this.menu?.visible && !document.querySelector('.pf-dialog') && !g!.driver.conquest()?.ended && g!.driver.local()?.life !== 'downed';
    if (!show) {
      this.lockPrompt?.classList.add('hidden');
      return;
    }
    const alive = !!g!.driver.local()?.alive;
    if (!this.lockPrompt) {
      this.lockPrompt = h('button', { class: 'pf-lock-prompt hidden', type: 'button' });
      this.lockPrompt.addEventListener('click', () => {
        if (this.session?.game.driver.local()?.alive) void this.lockPointer();
        else this.openDeploy();
      });
      document.body.append(this.lockPrompt);
    }
    const text = alive ? t('hud.lock') : t('deploy.chipHint');
    if (this.lockPrompt.textContent !== text) this.lockPrompt.textContent = text;
    this.lockPrompt.classList.remove('hidden');
  }

  exitPlay(toEditor = false) {
    if (this.mode !== 'play' || !this.session) return;
    this.teamUi?.dispose();
    this.teamUi = null;
    this.pause?.dispose();
    this.pause = null;
    this.sbEl?.remove();
    this.sbEl = null;
    this.lockPrompt?.classList.add('hidden');
    this.session.dispose();
    this.audio.suspend();
    this.session = null;
    this.mode = 'editor';
    this.switches++;
    if (document.fullscreenElement) {
      const kb = (navigator as unknown as { keyboard?: { unlock?: () => void } }).keyboard;
      kb?.unlock?.();
      void document.exitFullscreen().catch(() => {});
    }
    document.body.classList.replace('mode-play', 'mode-editor');
    $('#hud').classList.add('hidden');
    this.world.setMode('editor');
    this.env.shadowRate = 0;
    this.world.update(0);
    this.editor.attach();
    if (this.editorCam) this.editor.restoreCamera(this.editorCam);
    this.camera.fov = EDITOR_VFOV;
    this.camera.updateProjectionMatrix();
    this.resize();
    this.uiDirty = true;
    if (this.editorDocBeforeNet) {
      const d = this.editorDocBeforeNet;
      this.editorDocBeforeNet = null;
      this.openDoc(d, false);
    }
    if (this.returnTo === 'menu' && !toEditor) this.showMenu();
  }

  private toggleDev() {
    this.devOn = !this.devOn;
    $('#dev').classList.toggle('hidden', !this.devOn);
  }

  // ---------------- UI ----------------

  private bindUI() {
    this.thumbs = new Thumbnails();
    this.catalog = buildCatalog((id) => {
      if (id.startsWith('marker.')) {
        const r = $('#view').getBoundingClientRect();
        const hit = this.editor.pick(r.left + r.width / 2, r.top + r.height / 2, true).point;
        const at: [number, number, number] = hit ? [hit.x, hit.y, hit.z] : [this.camera.position.x, 0, this.camera.position.z - 10];
        insertMarker(this.ed, this.history, this.editor, ({ 'marker.flag': 'flag', 'marker.spawnA': 'spawnA', 'marker.spawnB': 'spawnB', 'marker.zone': 'zone' } as const)[id as 'marker.flag']!, at);
      } else {
        if (this.editor.terrainMode) this.editor.setTerrainMode(false);
        this.editor.insertAsset(id);
      }
    }, {
      thumbs: this.thumbs,
      used: () => {
        const m = new Map<string, number>();
        for (const o of this.ed.doc.objects) m.set(o.assetId, (m.get(o.assetId) ?? 0) + 1);
        return m;
      },
    });
    $('#tb-vis-vol').addEventListener('click', () => {
      const on = !this.editor.markers.showVolumes;
      this.editor.markers.setVolumesVisible(on);
      $('#tb-vis-vol').classList.toggle('on', on);
    });
    $('#tb-vis-col').addEventListener('click', () => {
      this.showColliders = !this.showColliders;
      $('#tb-vis-col').classList.toggle('on', this.showColliders);
      this.rebuildColliderLines();
    });
    $('#tb-vis-slope').addEventListener('click', () => {
      this.world.slopeDebug.value = this.world.slopeDebug.value ? 0 : 1;
      $('#tb-vis-slope').classList.toggle('on', !!this.world.slopeDebug.value);
    });
    applyUiSettings(this.settings);
    this.audio.volume = this.settings.volume;
    applyStatic();
    onLang(() => applyStatic());
    window.addEventListener('keydown', this.scoreKey, true);
    window.addEventListener('keyup', this.scoreKey, true);
    window.addEventListener('keydown', this.playKey);
    $('#dev').classList.toggle('hidden', !this.devOn);

    // Globální klávesy aplikace (F5 přepíná režim jen uvnitř aplikace).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F5') {
        e.preventDefault();
        if (!$('#modal').classList.contains('hidden')) return;
        if (this.mode === 'editor') void this.pickAndPlay();
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

    $('#tb-play').addEventListener('click', () => void this.pickAndPlay());
    $('#tb-net').addEventListener('click', () => this.showMenu());
    $('#tb-undo').addEventListener('click', () => this.editor.undo());
    $('#tb-redo').addEventListener('click', () => this.editor.redo());
    $('#tb-check').addEventListener('click', () => void this.checkMap());
    $('#tb-help').addEventListener('click', () => this.editor.toggleHelp());
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
      game: this.gameUi,
      rerender: () => (this.uiDirty = true),
      dropToSurface: (ids) => this.dropToSurface(ids),
      groundAll: () => this.groundAllObjects(),
      fitTerrain: () => this.fitTerrainToObjects(),
    });
    if (!$('[data-body="terrain"]').classList.contains('hidden')) renderTerrainPanel($('#terrain-panel'), this.editor, () => (this.uiDirty = true));
    if (!$('[data-body="scene"]').classList.contains('hidden')) renderSceneList(this.ed, this.history, this.editor);
    this.catalog?.refresh();
    $<HTMLButtonElement>('#tb-undo').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('#tb-redo').disabled = !this.history.canRedo;
    $('#tb-undo').title = this.history.undoLabel ? `Zpět: ${this.history.undoLabel} (Ctrl+Z)` : 'Zpět (Ctrl+Z)';
    $('#tb-redo').title = this.history.redoLabel ? `Znovu: ${this.history.redoLabel} (Ctrl+Shift+Z)` : 'Znovu';
    this.renderStatus();
  }

  renderStatus() {
    if (!this.editor || !this.saver) return;
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
    $('#st-hint').textContent = this.editor.drawingRoad
      ? 'Kreslení ulice: klik = bod · Enter / dvojklik = hotovo · Backspace = zpět o bod · Esc = zrušit'
      : 'Táhni = posun · G/R/S + číslo = přesně · prstenec = rotace · kostky = rozměry · Ctrl+C/V · ? zkratky · F5 testovat';
  }

  /**
   * Kontrola mapy s opravami: každý problém má „Ukázat“ (vybere a zaměří) a kde to jde
   * „Opravit“; „Opravit vše“ provede všechny opravy jako jednu položku historie.
   */
  private async checkMap() {
    type Issue = { severity: string; path: string; message: string; show?: string[]; fix?: { label: string; order: number; changes: () => Change[] } };
    const v = validateMap(JSON.parse(JSON.stringify(this.ed.doc)));
    const issues: Issue[] = [...v.issues];
    const doc = this.ed.doc;
    const nameOf = (o: MapObject) => o.editor?.name || getAsset(o.assetId)?.label || o.assetId;
    // Překryvy se řeší dřív (odsunutím) – ty předměty se v „na zem“ neopakují.
    const ovl = this.overlaps();
    const inOverlap = new Set(ovl.flatMap((o) => [o.a.id, o.b.id]));
    // Předměty ve vzduchu / zapadlé pod terén.
    const ground = this.groundChanges();
    for (const c of ground) {
      if (c.kind !== 'object' || !c.before || !c.after || inOverlap.has(c.id)) continue;
      const dy = c.before.transform.position[1] - c.after.transform.position[1];
      if (Math.abs(dy) < 0.08) continue;
      const o = c.before;
      const one = new Set([o.id]);
      issues.push({
        severity: 'warning',
        path: nameOf(o),
        message: dy > 0 ? `visí ${dy.toFixed(2)} m nad zemí` : `je ${(-dy).toFixed(2)} m pod terénem`,
        show: [o.id],
        fix: { label: 'Položit na zem', order: 1, changes: () => this.groundChanges(one) },
      });
    }
    // Sklepní vstupy: terén pod schody musí být snížený a dlážděné okolí dost široké.
    for (const o of doc.objects) {
      const cut = this.cutOf(o);
      if (!cut) continue;
      const one = new Set([o.id]);
      if (cutPending(doc.terrain, o, cut))
        issues.push({ severity: 'warning', path: nameOf(o), message: 'schody vedou pod terén – terén pod nimi je potřeba snížit', show: [o.id], fix: { label: 'Snížit terén', order: 2, changes: () => { const r = this.terrainFitChange(one); return r ? [r.change] : []; } } });
      const need = cutApronNeeded(doc.terrain, o.transform.rotation[1]);
      const apron = Number(resolveParams(getAsset(o.assetId)!, o.params).apron ?? Infinity);
      if (apron < need - 1e-3)
        issues.push({ severity: 'warning', path: nameOf(o), message: `dlážděné okolí ${apron.toFixed(1)} m nezakryje přechod terénu (mřížka ${doc.terrain.spacing} m) – nastav aspoň ${Math.ceil(need * 10) / 10} m`, show: [o.id] });
    }
    // Překrývající se předměty.
    for (const ov of ovl) {
      issues.push({
        severity: 'warning',
        path: `${nameOf(ov.a)} × ${nameOf(ov.b)}`,
        message: 'předměty stojí v sobě',
        show: [ov.a.id, ov.b.id],
        fix: {
          label: 'Odsunout',
          order: 0,
          changes: () => {
            const o = this.ed.getObject(ov.b.id);
            if (!o) return [];
            const [x, y, z] = o.transform.position;
            const nx = Math.round((x + ov.push[0]) * 1000) / 1000, nz = Math.round((z + ov.push[1]) * 1000) / 1000;
            const ny = y + (heightAt(doc.terrain, nx, nz) ?? 0) - (heightAt(doc.terrain, x, z) ?? 0);
            return [{ kind: 'object', id: o.id, before: structuredClone(o), after: { ...structuredClone(o), transform: { ...o.transform, position: [nx, Math.round(ny * 1000) / 1000, nz] } } }];
          },
        },
      });
    }
    // Testovací spawn a spawny týmů.
    const si = this.spawnIssue();
    if (si) {
      const ts = doc.testSpawn;
      issues.push({
        severity: 'warning',
        path: 'testovací spawn',
        message: si,
        show: ts ? [TEST_SPAWN_ID] : undefined,
        fix: ts ? { label: 'Přesunout na volné místo', order: 2, changes: () => {
          const q = this.freeSpotNear(ts.position);
          return q ? [{ kind: 'testSpawn', before: ts, after: { ...ts, position: q } }] : [];
        } } : undefined,
      });
    }
    for (const sp of doc.spawnPoints) {
      const iss = this.spawnIssue(sp.position);
      if (!iss) continue;
      issues.push({
        severity: 'error',
        path: `spawn ${sp.id}`,
        message: iss,
        show: [`sp:${sp.id}`],
        fix: { label: 'Přesunout na volné místo', order: 2, changes: () => {
          const q = this.freeSpotNear(sp.position);
          return q ? cmds.entity<typeof sp>(this.ed, 'spawnPoints', sp.id, (e) => {
            e.position = q;
          }, 'Spawn').changes : [];
        } },
      });
    }
    for (const [id, m] of this.world.missing) issues.push({ severity: 'warning', path: id, message: `placeholder: ${m}`, show: [id] });
    // Žebříky: volný výstup nahoře.
    for (const [oid, list] of this.ladders) {
      for (const L of list) {
        const exit = { x: L.base.x + L.facing.x * 0.6, y: L.base.y + L.height + 0.05, z: L.base.z + L.facing.z * 0.6 };
        if (this.phys.capsuleBlocked(exit, MOVEMENT.stances.stand.height, MOVEMENT.radius)) issues.push({ severity: 'warning', path: oid, message: 'žebřík: výstup nahoře je blokovaný (nepoužitelný žebřík) – posuň ho nebo uvolni místo nahoře', show: [oid] });
      }
    }
    if (doc.controlPoints.length && !doc.scenarios.length) issues.push({ severity: 'warning', path: 'scenarios', message: 'mapa má body, ale žádný scénář – Conquest nelze spustit (záložka Scéna → + Scénář)' });
    for (const sc of doc.scenarios) {
      for (const team of ['teamA', 'teamB'] as const) {
        const ok = doc.spawnPoints.some((sp) => {
          if (!sp.teams.includes(team)) return false;
          if (!sp.controlPointId) return true;
          const cp = doc.controlPoints.find((c) => c.id === sp.controlPointId);
          const ov = sc.overrides.find((o) => o.controlPointId === sp.controlPointId);
          const owner = ov?.defaultOwner ?? cp?.defaultOwner;
          const en = ov?.spawnEnabled ?? cp?.spawnEnabled;
          return owner === team && en && !ov?.disabled;
        });
        if (!ok) issues.push({ severity: 'error', path: `scénář ${sc.name}`, message: `tým ${team === 'teamA' ? 'A' : 'B'} nemá na začátku žádný dostupný spawn` });
      }
      const counted = doc.controlPoints.filter((c) => {
        const ov = sc.overrides.find((o) => o.controlPointId === c.id);
        return !ov?.disabled && (ov?.countsForBleed ?? c.countsForBleed);
      });
      if (!counted.length) issues.push({ severity: 'warning', path: `scénář ${sc.name}`, message: 'žádný bod se nepočítá do bleed – tickety budou ubývat jen smrtí' });
    }
    // Vykreslení: řádky s tlačítky.
    const body = document.createElement('div');
    if (!issues.length) {
      body.textContent = 'Bez chyb a upozornění. (Kontrola neprokazuje vyváženost mapy.)';
      await modal('Kontrola mapy', body, [{ id: 'ok', label: 'Zavřít', primary: true }]);
      return;
    }
    const fixable = issues.filter((i) => i.fix);
    const close = () => document.getElementById('modal')!.classList.add('hidden');
    const runFixes = (list: Issue[], label: string) => {
      // Po skupinách: nejdřív odsunout překryvy, pak položit na zem, nakonec spawny (každá
      // skupina se počítá až po předchozí, aby opravy na sebe navazovaly).
      let done = 0;
      for (const order of [0, 1, 2]) {
        const group = list.filter((i) => i.fix!.order === order);
        if (!group.length) continue;
        const changes: Change[] = [];
        const seen = new Set<string>();
        for (const i of group) for (const c of i.fix!.changes()) {
          const key = c.kind === 'object' ? c.id : c.kind === 'entity' ? c.id : c.kind;
          if (seen.has(key)) continue;
          seen.add(key);
          changes.push(c);
        }
        if (changes.length) {
          this.history.execute({ label: `${label}: ${group[0].fix!.label.toLowerCase()}`, changes });
          done += group.length;
        }
      }
      if (done) toast(`${label}: opraveno ${done} (Ctrl+Z vrátí po krocích)`);
      else toast('Opravu se nepodařilo najít automaticky – použij Ukázat.', 'warn');
      void this.checkMap();
    };
    const head = document.createElement('div');
    head.className = 'check-head';
    head.textContent = `${issues.length} ${issues.length === 1 ? 'problém' : issues.length < 5 ? 'problémy' : 'problémů'}, z toho ${fixable.length} jde opravit automaticky.`;
    if (fixable.length) {
      const all = document.createElement('button');
      all.className = 'primary';
      all.textContent = `Opravit vše (${fixable.length})`;
      all.addEventListener('click', () => runFixes(fixable, 'Opravit vše'));
      head.appendChild(all);
    }
    body.appendChild(head);
    const ul = document.createElement('ul');
    ul.className = 'check-list';
    for (const i of issues.slice(0, 80)) {
      const li = document.createElement('li');
      li.className = i.severity === 'error' ? 'err' : 'wrn';
      const tx = document.createElement('span');
      tx.textContent = `${i.path ? i.path + ': ' : ''}${i.message}`;
      li.appendChild(tx);
      if (i.show) {
        const b = document.createElement('button');
        b.textContent = 'Ukázat';
        b.addEventListener('click', () => {
          close();
          this.editor.select(i.show!.filter((id) => id === TEST_SPAWN_ID || id.startsWith('sp:') || this.ed.getObject(id)), false);
          this.editor.frameSelection();
        });
        li.appendChild(b);
      }
      if (i.fix) {
        const b = document.createElement('button');
        b.textContent = i.fix.label;
        b.addEventListener('click', () => runFixes([i], i.fix!.label));
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
    if (issues.length > 80) ul.appendChild(Object.assign(document.createElement('li'), { textContent: `… a dalších ${issues.length - 80}` }));
    body.appendChild(ul);
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
      { id: 'street', label: 'Šablona: ulice' },
      { id: 'showcase', label: 'Přehled sady 300' },
      { id: 'osadaSlice', label: 'Skladová osada · řez' },
      { id: 'import', label: 'Importovat…' },
      { id: 'export', label: 'Exportovat', primary: true },
    ]);
    if (picked) {
      const l = await this.store.load(picked);
      if (l) this.openDoc(l.doc, false);
      else toast('Mapu se nepodařilo načíst.', 'warn');
      return;
    }
    if (choice === 'new') {
      const b = document.createElement('div');
      b.innerHTML = '<div class="prop"><span class="lbl">Rozměr plátna</span><select id="nm-size"><option value="128">128 × 128 m</option><option value="256" selected>256 × 256 m</option><option value="512">512 × 512 m</option><option value="1024">1024 × 1024 m</option></select></div><div class="prop"><span class="lbl">Rozteč terénu</span><select id="nm-sp"><option value="1" selected>1 m</option><option value="2">2 m</option><option value="4">4 m</option></select></div><div class="note">Rozměr a rozlišení terénu se nastavují před tvorbou; pozdější změna plátna je v pilotu zablokovaná.</div>';
      const c = await modal('Nová mapa', b, [
        { id: 'cancel', label: 'Zrušit' },
        { id: 'ok', label: 'Vytvořit', primary: true },
      ]);
      if (c === 'ok') {
        const size = Number((b.querySelector('#nm-size') as HTMLSelectElement).value);
        let sp = Number((b.querySelector('#nm-sp') as HTMLSelectElement).value);
        if (size / sp > 1024) sp = size / 1024;
        this.openDoc(buildEmptyMap('Nová mapa', size, sp));
      }
    }
    else if (choice === 'range') this.openDoc(this.rangeTemplate());
    else if (choice === 'street') this.openDoc(this.streetTemplate());
    else if (choice === 'showcase') {
      this.openDoc(buildShowcaseMap());
      toast('Přehled sady 300: všech 300 modelů po sekcích A–K, u každého cedule s číslem.');
    }
    else if (choice === 'osadaSlice') {
      this.openDoc(buildOsadaSliceMap());
      toast('Skladová osada – vertikální řez: dům, hala, cesty, plot, zeď, balvany, bod A a spawny.');
    }
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
    // Hlavní menu je neprůhledné: 3D scéna se pod ním nekreslí (žádná práce GPU navíc).
    if (!this.session && this.menu?.visible) {
      requestAnimationFrame(this.loop);
      return;
    }
    this.renderer.info.reset();
    if (this.session) {
      this.session.update(dt);
      if (this.teamUi) this.teamUi.update(this.session.game.driver.local(), this.session.game.driver.remotes());
      this.renderScoreboard(dt);
      this.updateLockPrompt();
    } else {
      // Náhledy katalogu: po dvou na snímek, jen v editoru (vykreslí se do rohu, scéna je přepíše).
      if (this.thumbs?.pending) this.thumbs.pump(this.renderer, this.world, 2);
      this.editor.update(dt);
      if (this.uiDirty) {
        this.uiDirty = false;
        this.renderUI();
      }
    }
    this.updateFlags(dt);
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

  /** Vlajky: ve hře ze stavu bodů (autorita), v editoru a volném testu výchozí vlastník. */
  private updateFlags(dt: number) {
    const d = this.session?.game.driver;
    const cq = d?.conquest();
    if (d && cq) return this.flags.update(dt, cq.cps, d.teamFactions());
    const states = this.ed.doc.controlPoints.map((c) => ({ id: c.id, p: c.defaultOwner === 'teamA' ? 1 : c.defaultOwner === 'teamB' ? -1 : 0 }));
    this.flags.update(dt, states, DEFAULT_FACTIONS, true);
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
      const g = this.session.game;
      const me = g.driver.local();
      if (me) {
        const s = me.state, w = me.weapon;
        const sp = spreadOf(rulesOf(w.weaponId), MOVEMENT, s, w, g.simTime);
        const net = g.driver.netStats?.();
        lines.push(
          `pos ${s.pos.x.toFixed(2)} ${s.pos.y.toFixed(2)} ${s.pos.z.toFixed(2)}  yaw ${toDeg(s.yaw).toFixed(1)}°  pitch ${toDeg(s.pitch).toFixed(1)}°  tick ${s.tick}  zahozeno ${g.stats.droppedSteps}`,
          `rychlost ${Math.hypot(s.vel.x, s.vel.z).toFixed(2)} m/s  vy ${s.vel.y.toFixed(2)}  grounded ${s.grounded}  žebřík ${s.ladder ?? '–'}  HP ${me.hp}`,
          `postoj ${s.stance} (výška ${s.height.toFixed(2)} m)  sprint ${s.sprinting}  výdrž ${s.stamina.toFixed(1)}${s.sprintLocked ? ' (vyčerpáno)' : ''}`,
          `zbraň M4A1 (pravidla PF-Rifle) ${w.mode}  akce ${w.action}  ${w.mag}/${w.reserve}  další výstřel ${Math.max(0, w.nextShotAt - g.simTime).toFixed(3)} s  ADS ${w.adsProgress.toFixed(2)}  překážka ${w.obstruction.toFixed(2)}`,
          `rozptyl ${toDeg(sp.total).toFixed(2)}° = (základ ${sp.base.toFixed(2)} + pohyb ${sp.move.toFixed(2)}) × ADS ${sp.ads.toFixed(2)} + střelba ${sp.firing.toFixed(2)} + vzduch ${sp.air.toFixed(2)} + leh ${sp.prone.toFixed(2)} + dopad ${sp.landing.toFixed(2)}`,
          `recoil ${toDeg(w.recoilPitch).toFixed(2)}° / ${toDeg(w.recoilYaw).toFixed(2)}°  síť: ${net ? `RTT ${net.rtt.toFixed(0)} ms  korekce ${net.corrections}  nepotvrzené ${net.pending}` : 'offline'}  vojáci ${g.soldiers.count}  zbraň ${g.fp.stats().triangles} tris`,
          s.blocked.length || w.blockReason ? `<span class="warn">blokace: ${[...s.blocked, w.blockReason].filter(Boolean).join(' | ')}</span>` : 'blokace: –',
        );
      }
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
