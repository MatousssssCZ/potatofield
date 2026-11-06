import * as THREE from 'three';
import type { MapObject, Transform } from '../../shared/map/schema';
import { generateObject, getAsset, resolveParams, type AssetDef } from '../../world/registry';
import { formatPoints, parsePoints, type Pt } from '../../world/assets/roads';
import { buildObjectGeometry } from '../render/geometry';
import type { WorldView } from '../render/worldView';
import { cmds, type Command, type EditorDoc, type History } from './editorDoc';
import { MarkerView, markerId } from './markers';
import { applyBrush, heightAt, readRegion, unionRegion, type Brush, type Region } from '../../world/terrain';

export const TEST_SPAWN_ID = '__testSpawn';

export interface EditorSettings {
  grid: number;
  rotSnapDeg: number; // 0 = volná
  flySpeed: number;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

type V3 = [number, number, number];

/** Úchop gizma ve viewportu. */
interface HandleInfo {
  kind: 'rotate' | 'size' | 'uniform' | 'point' | 'addPoint';
  axis?: 'x' | 'y' | 'z';
  sign?: 1 | -1;
  index?: number;
}

type Drag =
  | { kind: 'move'; gp0: THREE.Vector3; starts: Map<string, { pos: V3; rotY: number }>; mount: boolean }
  | { kind: 'rotate'; center: THREE.Vector3; a0: number; starts: Map<string, { pos: V3; rotY: number }>; delta: number }
  | { kind: 'size'; id: string; axis: 'x' | 'y' | 'z'; sign: 1 | -1; origin: THREE.Vector3; dir: THREE.Vector3; ext: number; opp: number; f: number; uniform: boolean }
  | { kind: 'point'; id: string; index: number; pts: Pt[] };

/**
 * Editor ve viewportu: volná kamera, výběr a jednotná manipulace bez režimů.
 * Klik vybere, tažení objektu ho posune po terénu (všechno stojí na zemi; doplňky typu klimatizace
 * se přilepí na stěnu, nádrž na střechu). Kolem výběru je prstenec rotace a úchopy rozměrů,
 * u ulice úchopy bodů. Všechny změny mapy jdou přes History (undo/redo). Listenery se registrují
 * přes `on()` a `detach()` je všechny odebere (přepínání do hry je nehromadí).
 */
export class Editor {
  readonly root = new THREE.Group();
  readonly selection = new Set<string>();
  settings: EditorSettings = { grid: 0.5, rotSnapDeg: 15, flySpeed: 12 };
  onSelection: () => void = () => {};
  onToast: (msg: string, kind?: 'info' | 'warn') => void = () => {};
  onStatus: () => void = () => {};

  private handles = new THREE.Group();
  private drag: Drag | null = null;
  private pressed: { x: number; y: number; ctrl: boolean; id: string | null; started: boolean } | null = null;
  private grid: THREE.GridHelper | null = null;
  private boxes = new Map<string, THREE.Box3Helper>();
  readonly spawnMarker: THREE.Group;
  readonly markers = new MarkerView();
  /** Režim úprav terénu (štětce místo výběru objektů). */
  terrainMode = false;
  brush: Brush = { kind: 'raise', radius: 6, strength: 1.5 };
  onTerrainPreview: () => void = () => {};
  private stroke: { snapshot: ReturnType<typeof readRegion>; full: number[]; dirt?: number[]; urban?: number[]; region: Region | null } | null = null;
  brushPoint: THREE.Vector3 | null = null;
  private brushRing: THREE.Line;
  private pointerNdc = new THREE.Vector2(9, 9);
  /** Kreslení nové ulice: body ve světě, náhled. */
  private roadDraft: { assetId: string; pts: THREE.Vector3[]; line: THREE.Line; dots: THREE.Group } | null = null;

  // kamera
  private yaw = 0;
  private pitch = -0.5;
  private flying = false;
  private keys = new Set<string>();
  private altHeld = false;
  private rectEl: HTMLDivElement;
  private raycaster = new THREE.Raycaster();
  private listeners: Array<[EventTarget, string, EventListener]> = [];
  attached = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    private world: WorldView,
    private ed: EditorDoc,
    private history: History,
  ) {
    this.root.name = 'editorRoot';
    this.handles.name = 'handles';
    this.root.add(this.handles);
    this.spawnMarker = makeSpawnMarker();
    this.root.add(this.spawnMarker);
    this.root.add(this.markers.root);
    this.brushRing = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffd27a', depthTest: false, transparent: true }));
    this.brushRing.renderOrder = 20;
    this.brushRing.visible = false;
    this.brushRing.raycast = () => {};
    this.root.add(this.brushRing);
    this.rectEl = document.createElement('div');
    this.rectEl.className = 'select-rect hidden';
    canvas.parentElement!.appendChild(this.rectEl);
    this.rebuildGrid();
    camera.position.set(0, 18, 28);
    this.yaw = 0;
    this.pitch = -0.55;
  }

  // ---------------- životní cyklus ----------------

  private on(t: EventTarget, ev: string, fn: EventListener) {
    t.addEventListener(ev, fn);
    this.listeners.push([t, ev, fn]);
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    this.on(this.canvas, 'pointerdown', ((e: PointerEvent) => this.pointerDown(e)) as EventListener);
    this.on(window, 'pointermove', ((e: PointerEvent) => this.pointerMove(e)) as EventListener);
    this.on(window, 'pointerup', ((e: PointerEvent) => this.pointerUp(e)) as EventListener);
    this.on(this.canvas, 'dblclick', (() => this.roadDraft && this.finishRoad()) as EventListener);
    this.on(this.canvas, 'wheel', ((e: WheelEvent) => this.wheel(e)) as EventListener);
    this.on(this.canvas, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
    this.on(window, 'keydown', ((e: KeyboardEvent) => this.keyDown(e)) as EventListener);
    this.on(window, 'keyup', ((e: KeyboardEvent) => this.keyUp(e)) as EventListener);
    this.on(window, 'blur', () => this.clearKeys());
    this.on(document, 'pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas && this.flying) this.flying = false;
    });
    this.root.visible = true;
    this.applyCamera();
    this.refreshSelectionVisuals();
  }

  detach() {
    for (const [t, ev, fn] of this.listeners) t.removeEventListener(ev, fn);
    this.listeners = [];
    this.attached = false;
    this.clearKeys();
    this.flying = false;
    this.cancelRoad();
    this.root.visible = false;
  }

  get listenerCount() {
    return this.listeners.length;
  }

  /** Stav kamery pro obnovení po návratu z testu. */
  saveCamera() {
    return { pos: this.camera.position.clone(), yaw: this.yaw, pitch: this.pitch, fov: this.camera.fov };
  }
  restoreCamera(s: ReturnType<Editor['saveCamera']>) {
    this.camera.position.copy(s.pos);
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.applyCamera();
  }

  private clearKeys() {
    this.keys.clear();
    this.altHeld = false;
  }

  // ---------------- kamera ----------------

  private applyCamera() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  update(dt: number) {
    if (this.flying) {
      const v = new THREE.Vector3();
      if (this.keys.has('KeyW')) v.z -= 1;
      if (this.keys.has('KeyS')) v.z += 1;
      if (this.keys.has('KeyA')) v.x -= 1;
      if (this.keys.has('KeyD')) v.x += 1;
      // Mezerník nahoru, Shift dolů (Q/E zůstávají jako záloha).
      if (this.keys.has('Space') || this.keys.has('KeyE')) v.y += 1;
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('KeyQ')) v.y -= 1;
      if (v.lengthSq() > 0) {
        v.normalize().multiplyScalar(this.settings.flySpeed * dt);
        const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
        const up = v.y;
        v.y = 0;
        v.applyQuaternion(yawQ);
        v.y += up;
        this.camera.position.add(v);
      }
    }
    this.applyCamera();
    this.updateBrush(dt);
    this.markers.update(performance.now() / 1000);
    if (!this.drag) this.layoutHandles();
    this.scaleHandles();
    for (const [id, h] of this.boxes) {
      const g = this.groupOf(id);
      if (g) h.box.setFromObject(g);
    }
  }

  frameSelection() {
    const box = new THREE.Box3();
    for (const id of this.selection) {
      const g = this.groupOf(id);
      if (g) box.expandByObject(g);
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const dist = Math.max(3, sphere.radius * 2.4) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.5;
    this.camera.position.copy(sphere.center).addScaledVector(dir, -dist);
  }

  // ---------------- vstup ----------------

  private typing(e: Event) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private keyDown(e: KeyboardEvent) {
    if (this.typing(e)) return; // psaní do polí nikdy nehýbe kamerou ani nemaže
    this.altHeld = e.altKey;
    if (e.code === 'AltLeft' || e.code === 'AltRight') {
      e.preventDefault();
      this.updateSnap();
    }
    if (this.flying) {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      return;
    }
    if (this.roadDraft) {
      if (e.code === 'Enter') this.finishRoad();
      else if (e.code === 'Escape') this.cancelRoad(true);
      else if (e.code === 'Backspace') {
        e.preventDefault();
        this.roadDraft.pts.pop();
        this.redrawDraft();
      }
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (ctrl && e.code === 'KeyY') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (ctrl && e.code === 'KeyD') {
      e.preventDefault();
      this.duplicate();
      return;
    }
    if (ctrl) return;
    switch (e.code) {
      case 'KeyF':
        this.frameSelection();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSelection();
        break;
      case 'Escape':
        if (this.drag) this.cancelDrag();
        else this.select([], false);
        break;
    }
  }

  private keyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
    if (!e.altKey && this.altHeld) {
      this.altHeld = false;
      this.updateSnap();
    }
  }

  private pointerDown(e: PointerEvent) {
    if (e.button === 2) {
      this.flying = true;
      this.canvas.requestPointerLock?.();
      return;
    }
    if (e.button !== 0) return;
    this.pointerNdc = this.ndc(e.clientX, e.clientY);
    if (this.terrainMode) {
      this.beginStroke(e.shiftKey);
      return;
    }
    if (this.roadDraft) {
      const p = this.groundAtPointer();
      if (p) {
        this.roadDraft.pts.push(this.snapXZ(p));
        this.redrawDraft();
      }
      return;
    }
    // 1) Úchopy gizma mají přednost před objekty za nimi.
    const h = this.pickHandle();
    if (h) {
      this.beginHandle(h.info, h.point, e.shiftKey);
      return;
    }
    // 2) Objekt: výběr hned, tažení až po posunu myši o pár pixelů.
    const { id } = this.pick(e.clientX, e.clientY);
    const ctrl = e.ctrlKey || e.metaKey;
    if (id && !ctrl && !this.selection.has(id)) this.select([id], false);
    this.pressed = { x: e.clientX, y: e.clientY, ctrl, id, started: false };
  }

  private pointerMove(e: PointerEvent) {
    this.pointerNdc = this.ndc(e.clientX, e.clientY);
    if (this.flying && document.pointerLockElement === this.canvas) {
      this.yaw -= e.movementX * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0025, -1.55, 1.55);
      return;
    }
    if (this.roadDraft) {
      this.redrawDraft();
      return;
    }
    if (this.drag) {
      this.previewDrag();
      return;
    }
    const d = this.pressed;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) <= 5) return;
    if (d.id && !d.ctrl && this.selection.has(d.id)) {
      this.pressed = null;
      this.beginMove(this.ndc(d.x, d.y));
      this.previewDrag();
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const x0 = Math.min(e.clientX, d.x) - r.left, y0 = Math.min(e.clientY, d.y) - r.top;
    Object.assign(this.rectEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` });
    this.rectEl.classList.remove('hidden');
    d.started = true;
  }

  private pointerUp(e: PointerEvent) {
    if (e.button === 2 && this.flying) {
      this.flying = false;
      this.keys.clear();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      return;
    }
    if (e.button === 0 && this.stroke) {
      this.endStroke();
      return;
    }
    if (e.button !== 0) return;
    if (this.drag) {
      this.endDrag();
      return;
    }
    const d = this.pressed;
    this.pressed = null;
    if (!d) return;
    this.rectEl.classList.add('hidden');
    if (d.started) this.rectSelect(d.x, d.y, e.clientX, e.clientY, d.ctrl);
    else this.clickSelect(d.id, d.ctrl);
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (this.flying) {
      this.settings.flySpeed = THREE.MathUtils.clamp(this.settings.flySpeed * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 1, 200);
      this.onStatus();
    } else {
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      this.camera.position.addScaledVector(dir, (e.deltaY < 0 ? 1 : -1) * Math.max(1, this.settings.flySpeed * 0.25));
    }
  }

  // ---------------- výběr ----------------

  private ndc(cx: number, cy: number) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  }

  /** Paprsek z bodu obrazovky do světa (objekty, terén). */
  pick(cx: number, cy: number, includeLocked = false): { id: string | null; point: THREE.Vector3 | null } {
    this.raycaster.setFromCamera(this.ndc(cx, cy), this.camera);
    const targets: THREE.Object3D[] = [this.world.root, this.markers.root];
    if (this.spawnMarker.visible) targets.push(this.spawnMarker);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      if (!isVisible(h.object)) continue;
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.objectId && !o.userData.special) o = o.parent;
      if (!o) continue;
      if (o.userData.special) return { id: o.userData.special as string, point: h.point };
      const id = o.userData.objectId as string;
      if (id === '__terrain') return { id: null, point: h.point };
      const obj = this.ed.getObject(id);
      if (!includeLocked && obj?.editor?.locked) continue;
      return { id, point: h.point };
    }
    return { id: null, point: null };
  }

  private clickSelect(id: string | null, ctrl: boolean) {
    if (ctrl) {
      if (id) {
        const next = new Set(this.selection);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        this.select([...next], false);
      }
    } else this.select(id ? [id] : [], false);
  }

  private rectSelect(x0: number, y0: number, x1: number, y1: number, ctrl: boolean) {
    const a = this.ndc(Math.min(x0, x1), Math.max(y0, y1));
    const b = this.ndc(Math.max(x0, x1), Math.min(y0, y1));
    const ids: string[] = ctrl ? [...this.selection] : [];
    const v = new THREE.Vector3();
    for (const o of this.ed.doc.objects) {
      if (o.editor?.locked || o.editor?.hidden) continue;
      const g = this.world.objects.get(o.id);
      if (!g) continue;
      new THREE.Box3().setFromObject(g).getCenter(v);
      v.project(this.camera);
      if (v.z < 1 && v.x >= a.x && v.x <= b.x && v.y >= a.y && v.y <= b.y && !ids.includes(o.id)) ids.push(o.id);
    }
    this.select(ids, false);
  }

  select(ids: string[], keepTool = true) {
    void keepTool;
    this.selection.clear();
    for (const id of ids) if (this.exists(id)) this.selection.add(id);
    this.refreshSelectionVisuals();
    this.onSelection();
  }

  /** Odebere z výběru neexistující objekty (po undo/redo). */
  pruneSelection() {
    let changed = false;
    for (const id of [...this.selection]) {
      if (!this.exists(id)) {
        this.selection.delete(id);
        changed = true;
      }
    }
    this.refreshSelectionVisuals();
    if (changed) this.onSelection();
  }

  refreshSelectionVisuals() {
    for (const h of this.boxes.values()) {
      h.removeFromParent();
      h.geometry.dispose();
      (h.material as THREE.Material).dispose();
    }
    this.boxes.clear();
    for (const id of this.selection) {
      const h = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ffb23e'));
      h.raycast = () => {};
      this.root.add(h);
      this.boxes.set(id, h);
    }
    if (!this.drag) this.buildHandles();
  }

  /** Přichycení na mřížku a rotace: Alt dočasně vypne. */
  updateSnap() {
    this.onStatus();
  }

  get snapDisabled() {
    return this.altHeld;
  }

  rebuildGrid() {
    if (this.grid) {
      this.grid.removeFromParent();
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    const size = 200;
    const div = Math.min(800, Math.round(size / this.settings.grid));
    this.grid = new THREE.GridHelper(size, div, new THREE.Color('#e8c27a'), new THREE.Color('#6d5b40'));
    const m = this.grid.material as THREE.LineBasicMaterial;
    m.transparent = true;
    m.opacity = 0.35;
    m.depthWrite = false;
    this.grid.position.y = 0.02;
    this.grid.raycast = () => {};
    this.root.add(this.grid);
  }

  exists(id: string) {
    if (id === TEST_SPAWN_ID) return true;
    const m = markerId.parse(id);
    if (m) return !!this.ed.getEntity(m.collection, m.id);
    return !!this.ed.getObject(id);
  }

  private transformOf(id: string): Transform | undefined {
    if (id === TEST_SPAWN_ID) return this.ed.doc.testSpawn;
    const m = markerId.parse(id);
    if (m) {
      const e = this.ed.getEntity(m.collection, m.id) as unknown as Record<string, unknown> | undefined;
      if (!e) return undefined;
      const pos = (e.position ?? e.center) as [number, number, number];
      return { position: pos, rotation: [0, (e.yaw as number) ?? 0, 0] };
    }
    return this.ed.getObject(id)?.transform;
  }

  private groupOf(id: string): THREE.Object3D | undefined {
    if (id === TEST_SPAWN_ID) return this.spawnMarker;
    if (markerId.parse(id)) return this.markers.objectFor(id);
    return this.world.objects.get(id);
  }

  private movable(): string[] {
    return [...this.selection].filter((id) => id === TEST_SPAWN_ID || markerId.parse(id) || !this.ed.getObject(id)?.editor?.locked);
  }

  // ---------------- terén a paprsky ----------------

  /** Výška terénu (0 mimo terén). */
  groundY(x: number, z: number): number {
    return heightAt(this.ed.doc.terrain, x, z) ?? 0;
  }

  /** Bod na terénu pod kurzorem (nebo na rovině y = 0 mimo terén). */
  private groundAtPointer(ndc = this.pointerNdc): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const mesh = this.world.terrain;
    if (mesh) {
      const h = this.raycaster.intersectObject(mesh, false)[0];
      if (h) return h.point.clone();
    }
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  private snapXZ(p: THREE.Vector3): THREE.Vector3 {
    if (this.altHeld) return p;
    const g = this.settings.grid;
    const x = Math.round(p.x / g) * g, z = Math.round(p.z / g) * g;
    return new THREE.Vector3(x, this.groundY(x, z), z);
  }

  // ---------------- úchopy (gizmo) ----------------

  private handleMat = {
    rotate: new THREE.MeshBasicMaterial({ color: '#4fc3ff', depthTest: false, transparent: true, opacity: 0.85 }),
    size: new THREE.MeshBasicMaterial({ color: '#ffb23e', depthTest: false }),
    uniform: new THREE.MeshBasicMaterial({ color: '#ff7a3e', depthTest: false }),
    point: new THREE.MeshBasicMaterial({ color: '#7dff8a', depthTest: false }),
    addPoint: new THREE.MeshBasicMaterial({ color: '#d8ffe0', depthTest: false, transparent: true, opacity: 0.7 }),
  };

  /** Lokální obálka objektu z jeho geometrie (bez měřítka skupiny). */
  private localBounds(id: string): THREE.Box3 | null {
    const g = this.world.objects.get(id);
    if (!g) return null;
    const box = new THREE.Box3();
    for (const c of g.children) {
      const m = c as THREE.Mesh;
      if (!m.geometry || m.name === '__batch') continue;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrix);
      box.union(b);
    }
    return box.isEmpty() ? null : box;
  }

  private buildHandles() {
    for (const c of [...this.handles.children]) {
      c.removeFromParent();
      (c as THREE.Mesh).geometry?.dispose();
    }
    const ids = this.movable();
    if (!ids.length || this.terrainMode) return;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, info: HandleInfo) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 30;
      m.userData.handle = info;
      this.handles.add(m);
      return m;
    };
    // Prstenec rotace (u CP a zón bez natočení se nekreslí).
    const rotatable = ids.some((id) => !id.startsWith('cp:'));
    if (rotatable) {
      const ring = add(new THREE.TorusGeometry(1, 0.035, 6, 64), this.handleMat.rotate, { kind: 'rotate' });
      ring.rotation.x = Math.PI / 2;
      ring.userData.ring = true;
    }
    if (ids.length !== 1) return;
    const id = ids[0];
    const o = this.ed.getObject(id);
    const def = o && getAsset(o.assetId);
    if (!o || !def) return;
    const cube = () => new THREE.BoxGeometry(1, 1, 1);
    if (def.sizeParams) {
      for (const axis of ['x', 'z', 'y'] as const) {
        if (!def.sizeParams[axis]) continue;
        for (const sign of axis === 'y' ? ([1] as const) : ([1, -1] as const)) add(cube(), this.handleMat.size, { kind: 'size', axis, sign });
      }
    } else if (def.uniformScale) add(cube(), this.handleMat.uniform, { kind: 'uniform', axis: 'y', sign: 1 });
    const ps = def.params.find((q) => q.type === 'points');
    if (ps) {
      const pts = parsePoints(String(resolveParams(def, o.params)[ps.key]));
      pts.forEach((_, i) => add(new THREE.SphereGeometry(1, 14, 10), this.handleMat.point, { kind: 'point', index: i }));
      for (let i = 0; i <= pts.length; i++) add(new THREE.OctahedronGeometry(1), this.handleMat.addPoint, { kind: 'addPoint', index: i });
    }
    this.layoutHandles();
  }

  /** Rozmístí úchopy podle aktuální polohy výběru. */
  private layoutHandles() {
    const ids = this.movable();
    if (!ids.length || !this.handles.children.length) return;
    const center = new THREE.Vector3();
    let radius = 1;
    const box = new THREE.Box3();
    for (const id of ids) {
      const g = this.groupOf(id);
      if (g) box.expandByObject(g);
    }
    if (!box.isEmpty()) {
      box.getCenter(center);
      const s = box.getSize(new THREE.Vector3());
      radius = Math.max(0.8, Math.hypot(s.x, s.z) / 2 + 0.4);
    }
    const t0 = this.transformOf(ids[0]);
    const pivot = ids.length === 1 && t0 ? new THREE.Vector3(...t0.position) : new THREE.Vector3(center.x, box.isEmpty() ? 0 : box.min.y, center.z);
    const o = ids.length === 1 ? this.ed.getObject(ids[0]) : undefined;
    const g = o ? this.world.objects.get(o.id) : undefined;
    const lb = o ? this.localBounds(o.id) : null;
    const def = o ? getAsset(o.assetId) : undefined;
    let pts: Pt[] = [];
    if (o && def) {
      const ps = def.params.find((q) => q.type === 'points');
      if (ps) pts = parsePoints(String(resolveParams(def, o.params)[ps.key]));
    }
    for (const c of this.handles.children) {
      const info = c.userData.handle as HandleInfo;
      if (info.kind === 'rotate') {
        // Rotace kolem středu obálky (u plotu tedy kolem jeho středu, ne kolem konce).
        if (box.isEmpty()) c.position.set(pivot.x, pivot.y + 0.08, pivot.z);
        else c.position.set(center.x, box.min.y + 0.08, center.z);
        c.userData.radius = radius;
      } else if ((info.kind === 'size' || info.kind === 'uniform') && g && lb) {
        const lc = lb.getCenter(new THREE.Vector3());
        const local = lc.clone();
        if (info.kind === 'uniform') local.set(lb.max.x, lb.max.y, lb.max.z);
        else local[info.axis!] = info.sign! > 0 ? lb.max[info.axis!] : lb.min[info.axis!];
        if (info.axis === 'y' && info.kind === 'size') local.y = lb.max.y + 0.15;
        c.position.copy(local.applyMatrix4(g.matrixWorld));
      } else if ((info.kind === 'point' || info.kind === 'addPoint') && o && pts.length) {
        const i = info.index!;
        let lp: Pt;
        if (info.kind === 'point') lp = pts[i];
        else if (i === 0) lp = extend(pts[0], pts[1]);
        else if (i === pts.length) lp = extend(pts[pts.length - 1], pts[pts.length - 2]);
        else lp = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
        const w = this.localToWorld(o, lp);
        c.position.set(w.x, this.groundY(w.x, w.z) + 0.35, w.z);
      }
    }
  }

  /** Úchopy drží stálou velikost na obrazovce. */
  private scaleHandles() {
    for (const c of this.handles.children) {
      const d = c.position.distanceTo(this.camera.position);
      const k = d * 0.012;
      const info = c.userData.handle as HandleInfo;
      if (info.kind === 'rotate') {
        const r = c.userData.radius ?? 1;
        // Tloušťka prstence stálá na obrazovce; geometrie se mění jen při větší změně.
        const tube = Math.min(0.2, (k * 0.35) / r);
        if (Math.abs(tube - (c.userData.tube ?? 0)) > tube * 0.15) {
          (c as THREE.Mesh).geometry.dispose();
          (c as THREE.Mesh).geometry = new THREE.TorusGeometry(1, tube, 6, 64);
          c.userData.tube = tube;
        }
        c.scale.setScalar(r);
      } else if (info.kind === 'point') c.scale.setScalar(k * 0.9);
      else if (info.kind === 'addPoint') c.scale.setScalar(k * 0.6);
      else c.scale.setScalar(k * 1.1);
    }
  }

  private pickHandle(): { info: HandleInfo; point: THREE.Vector3 } | null {
    if (!this.handles.children.length) return null;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.handles.children, false);
    // Body a rozměry mají přednost před prstencem (leží uvnitř něj).
    hits.sort((a, b) => Number((a.object.userData.handle as HandleInfo).kind === 'rotate') - Number((b.object.userData.handle as HandleInfo).kind === 'rotate') || a.distance - b.distance);
    const h = hits[0];
    return h ? { info: h.object.userData.handle as HandleInfo, point: h.object.position.clone() } : null;
  }

  private localToWorld(o: MapObject, p: Pt): THREE.Vector3 {
    const [px, , pz] = o.transform.position;
    const yaw = o.transform.rotation[1], s = o.transform.scale ?? 1;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return new THREE.Vector3(px + (c * p[0] + sn * p[1]) * s, 0, pz + (-sn * p[0] + c * p[1]) * s);
  }

  private worldToLocal(o: MapObject, w: THREE.Vector3): Pt {
    const [px, , pz] = o.transform.position;
    const yaw = o.transform.rotation[1], s = o.transform.scale ?? 1;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const dx = (w.x - px) / s, dz = (w.z - pz) / s;
    return [r4(c * dx - sn * dz), r4(sn * dx + c * dz)];
  }

  // ---------------- tažení ----------------

  private startStates(ids: string[]) {
    const m = new Map<string, { pos: V3; rotY: number }>();
    for (const id of ids) {
      const t = this.transformOf(id);
      if (t) m.set(id, { pos: [...t.position] as V3, rotY: t.rotation[1] });
    }
    return m;
  }

  private beginMove(ndc: THREE.Vector2) {
    const ids = this.movable();
    const gp0 = this.groundAtPointer(ndc);
    if (!ids.length || !gp0) return;
    const one = ids.length === 1 ? this.ed.getObject(ids[0]) : undefined;
    const mount = !!(one && getAsset(one.assetId)?.mount);
    this.drag = { kind: 'move', gp0, starts: this.startStates(ids), mount };
    this.handles.visible = false;
  }

  private beginHandle(info: HandleInfo, point: THREE.Vector3, shift: boolean) {
    const ids = this.movable();
    if (info.kind === 'rotate') {
      const ring = this.handles.children.find((c) => (c.userData.handle as HandleInfo).kind === 'rotate')!;
      const center = ring.position.clone();
      const gp = this.groundAtPointer() ?? point;
      this.drag = { kind: 'rotate', center, a0: Math.atan2(gp.x - center.x, gp.z - center.z), starts: this.startStates(ids), delta: 0 };
      return;
    }
    const id = ids[0];
    const o = this.ed.getObject(id);
    if (!o) return;
    const def = getAsset(o.assetId)!;
    if (info.kind === 'point' || info.kind === 'addPoint') {
      const ps = def.params.find((q) => q.type === 'points')!;
      const pts = parsePoints(String(resolveParams(def, o.params)[ps.key]));
      if (info.kind === 'point' && shift) {
        if (pts.length <= 2) return this.onToast('Ulice musí mít aspoň 2 body.', 'warn');
        pts.splice(info.index!, 1);
        this.history.execute(cmds.update(this.ed, id, (x) => (x.params[ps.key] = formatPoints(pts)), 'Smazat bod ulice'));
        return;
      }
      let index = info.index!;
      if (info.kind === 'addPoint') {
        const lp = this.worldToLocal(o, point);
        pts.splice(index, 0, lp);
      }
      this.drag = { kind: 'point', id, index, pts };
      this.handles.visible = info.kind === 'point';
      void index;
      return;
    }
    // Rozměry: tažení po ose úchopu (lokální osa natočená do světa).
    const g = this.world.objects.get(id);
    const lb = this.localBounds(id);
    if (!g || !lb) return;
    const axis = info.axis!, sign = info.sign!;
    const uniform = info.kind === 'uniform';
    const local = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0).multiplyScalar(sign);
    const dir = uniform ? new THREE.Vector3(0, 1, 0) : local.applyQuaternion(g.quaternion).normalize();
    const ext = (lb.max[axis] - lb.min[axis]) * g.scale.x;
    const opp = sign > 0 ? lb.min[axis] : lb.max[axis];
    this.drag = { kind: 'size', id, axis, sign, origin: point.clone(), dir, ext: Math.max(0.05, ext), opp, f: 1, uniform };
    this.handles.visible = false;
  }

  /** Vzdálenost podél přímky (origin, dir) k bodu na paprsku myši, který je jí nejblíž. */
  private alongAxis(origin: THREE.Vector3, dir: THREE.Vector3): number {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const r = this.raycaster.ray;
    const w0 = origin.clone().sub(r.origin);
    const a = dir.dot(dir), b = dir.dot(r.direction), c = r.direction.dot(r.direction);
    const d = dir.dot(w0), e = r.direction.dot(w0);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-6) return 0;
    return (b * e - c * d) / den;
  }

  /** Místo na budově pro doplněk (stěna / střecha) pod kurzorem, nebo null. */
  private mountHit(id: string, def: AssetDef): { pos: THREE.Vector3; yaw?: number } | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.world.root, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.objectId) o = o.parent;
      const hid = o?.userData.objectId as string | undefined;
      if (!hid || hid === id || hid === '__terrain' || !isVisible(h.object) || !h.face) continue;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (def.mount!.kind === 'wall' && Math.abs(n.y) < 0.4) {
        n.y = 0;
        n.normalize();
        const p = h.point.clone().addScaledVector(n, def.mount!.back ?? 0);
        if (!this.altHeld) p.y = Math.round(p.y / 0.25) * 0.25;
        // Žebřík stojí patou na zemi.
        if (def.assetId === 'struct.ladder') p.y = this.groundY(p.x, p.z);
        return { pos: p, yaw: Math.atan2(-n.x, -n.z) };
      }
      if (def.mount!.kind === 'top' && n.y > 0.6) return { pos: h.point.clone() };
      return null;
    }
    return null;
  }

  /** Lehký náhled během tažení: pohybují se existující meshe (ulice se přegeneruje). */
  private previewDrag() {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'move') {
      const gp = this.groundAtPointer();
      if (!gp) return;
      if (d.mount) {
        const [id] = [...d.starts.keys()];
        const def = getAsset(this.ed.getObject(id)!.assetId)!;
        const m = this.mountHit(id, def);
        const g = this.groupOf(id);
        if (m && g) {
          g.position.copy(m.pos);
          if (m.yaw !== undefined) g.rotation.set(0, m.yaw, 0);
          g.updateMatrixWorld(true);
          g.userData.mounted = true;
          return;
        }
        if (g) g.userData.mounted = false;
      }
      let dx = gp.x - d.gp0.x, dz = gp.z - d.gp0.z;
      // Přichycení: první objekt na mřížku, ostatní stejný posun (zachová rozestavení).
      const first = d.starts.values().next().value!;
      if (!this.altHeld) {
        const g = this.settings.grid;
        dx = Math.round((first.pos[0] + dx) / g) * g - first.pos[0];
        dz = Math.round((first.pos[2] + dz) / g) * g - first.pos[2];
      }
      for (const [id, s] of d.starts) {
        const g = this.groupOf(id);
        if (!g) continue;
        const x = s.pos[0] + dx, z = s.pos[2] + dz;
        // Výška kopíruje terén: objekt na zemi zůstane na zemi, objekt nad zemí drží odstup.
        const y = s.pos[1] + this.groundY(x, z) - this.groundY(s.pos[0], s.pos[2]);
        g.position.set(x, y, z);
        g.rotation.set(0, s.rotY, 0);
        g.updateMatrixWorld(true);
      }
      return;
    }
    if (d.kind === 'rotate') {
      const gp = this.groundAtPointer();
      if (!gp) return;
      let delta = Math.atan2(gp.x - d.center.x, gp.z - d.center.z) - d.a0;
      const snap = this.settings.rotSnapDeg;
      if (snap && !this.altHeld) delta = Math.round(delta / THREE.MathUtils.degToRad(snap)) * THREE.MathUtils.degToRad(snap);
      d.delta = delta;
      const c = Math.cos(delta), s = Math.sin(delta);
      for (const [id, st] of d.starts) {
        const g = this.groupOf(id);
        if (!g) continue;
        const rx = st.pos[0] - d.center.x, rz = st.pos[2] - d.center.z;
        g.position.set(d.center.x + c * rx + s * rz, st.pos[1], d.center.z - s * rx + c * rz);
        g.rotation.set(0, st.rotY + delta, 0);
        g.updateMatrixWorld(true);
      }
      return;
    }
    if (d.kind === 'size') {
      const g = this.world.objects.get(d.id);
      const o = this.ed.getObject(d.id);
      if (!g || !o) return;
      const t = this.alongAxis(d.origin, d.dir);
      d.f = Math.max(0.05, (d.ext + t) / d.ext);
      const base = o.transform.scale ?? 1;
      if (d.uniform) g.scale.setScalar(base * d.f);
      else {
        g.scale.set(base, base, base);
        g.scale[d.axis] = base * d.f;
        // Protilehlá stěna zůstává na místě.
        const shift = new THREE.Vector3();
        shift[d.axis] = d.opp * (1 - d.f) * base;
        shift.applyQuaternion(g.quaternion);
        g.position.set(...o.transform.position).add(shift);
      }
      g.updateMatrixWorld(true);
      return;
    }
    if (d.kind === 'point') {
      const o = this.ed.getObject(d.id);
      const gp = this.groundAtPointer();
      if (!o || !gp) return;
      d.pts[d.index] = this.worldToLocal(o, this.snapXZ(gp));
      const def = getAsset(o.assetId)!;
      const key = def.params.find((q) => q.type === 'points')!.key;
      const tmp: MapObject = { ...o, params: { ...o.params, [key]: formatPoints(d.pts) } };
      this.world.addObject(generateObject(tmp, this.ed.doc.terrain, this.ed.doc.objects));
      const h = this.handles.children.find((c) => (c.userData.handle as HandleInfo).kind === 'point' && (c.userData.handle as HandleInfo).index === d.index);
      if (h) h.position.set(gp.x, gp.y + 0.35, gp.z);
    }
  }

  private cancelDrag() {
    const d = this.drag;
    this.drag = null;
    this.handles.visible = true;
    if (!d) return;
    for (const id of d.kind === 'move' || d.kind === 'rotate' ? d.starts.keys() : [d.id]) {
      const o = this.ed.getObject(id);
      if (o) this.world.addObject(generateObject(o, this.ed.doc.terrain, this.ed.doc.objects));
    }
    this.editorRefreshMarkers();
    this.buildHandles();
  }

  private editorRefreshMarkers() {
    this.markers.rebuild(this.ed.doc);
    this.updateSpawnMarker();
  }

  /** Dokončení tažení = jedna položka historie, finální přegenerování a kolize. */
  private endDrag() {
    const d = this.drag!;
    this.drag = null;
    this.handles.visible = true;
    const changes: Command['changes'] = [];
    let label = 'Posun';
    if (d.kind === 'move' || d.kind === 'rotate') {
      label = d.kind === 'move' ? 'Posun' : 'Rotace';
      for (const id of d.starts.keys()) {
        const g = this.groupOf(id);
        if (!g) continue;
        const pos: V3 = [r4(g.position.x), r4(g.position.y), r4(g.position.z)];
        const rotY = r4(normAngle(new THREE.Euler().setFromQuaternion(g.quaternion, 'YXZ').y));
        const st = d.starts.get(id)!;
        if (pos.every((v, i) => Math.abs(v - st.pos[i]) < 1e-4) && Math.abs(rotY - normAngle(st.rotY)) < 1e-4) continue;
        if (g.userData.mounted) label = 'Přilepit na budovu';
        changes.push(...this.transformChanges(id, pos, rotY));
      }
    } else if (d.kind === 'size') {
      const c = this.sizeCommand(d);
      if (c) {
        changes.push(...c.changes);
        label = c.label;
      }
    } else if (d.kind === 'point') {
      const o = this.ed.getObject(d.id)!;
      const def = getAsset(o.assetId)!;
      const key = def.params.find((q) => q.type === 'points')!.key;
      changes.push(...cmds.update(this.ed, d.id, (x) => (x.params[key] = formatPoints(d.pts)), 'Bod ulice').changes);
      label = 'Bod ulice';
    }
    if (changes.length) this.history.execute({ label, changes });
    else this.cancelDrag();
    this.buildHandles();
  }

  private transformChanges(id: string, pos: V3, rotY: number): Command['changes'] {
    const mk = markerId.parse(id);
    if (id === TEST_SPAWN_ID) return [{ kind: 'testSpawn', before: this.ed.doc.testSpawn, after: { position: pos, rotation: [0, rotY, 0] } }];
    if (mk)
      return cmds.entity(this.ed, mk.collection, mk.id, (e) => {
        const x = e as unknown as Record<string, unknown>;
        if (mk.collection === 'zones') {
          x.center = pos;
          x.yaw = rotY;
        } else {
          x.position = pos;
          if (mk.collection === 'spawnPoints') x.yaw = rotY;
        }
      }, 'Posun markeru').changes;
    return cmds.update(this.ed, id, (o) => {
      o.transform.position = pos;
      o.transform.rotation = [0, rotY, 0];
    }).changes;
  }

  /** Převod tažení rozměrového úchopu na parametry generátoru (mřížka, meze) a dorovnání polohy. */
  private sizeCommand(d: Extract<Drag, { kind: 'size' }>): Command | null {
    const o = this.ed.getObject(d.id);
    if (!o) return null;
    const def = getAsset(o.assetId);
    if (!def) return null;
    if (Math.abs(d.f - 1) < 1e-3) return null;
    if (d.uniform && def.uniformScale) {
      const v = THREE.MathUtils.clamp(r4((o.transform.scale ?? 1) * d.f), def.uniformScale.min, def.uniformScale.max);
      return cmds.update(this.ed, d.id, (x) => (x.transform.scale = v), 'Měřítko');
    }
    const key = def.sizeParams?.[d.axis];
    if (!key) return null;
    const p = resolveParams(def, o.params);
    const spec = def.params.find((q) => q.key === key)!;
    let v = (p[key] as number) * d.f;
    if (spec.type === 'int') v = Math.round(v);
    else if (!this.altHeld) v = Math.max(this.settings.grid, Math.round(v / this.settings.grid) * this.settings.grid);
    v = r4(THREE.MathUtils.clamp(v, spec.min ?? 0, spec.max ?? 1e6));
    // Nová obálka → posun, aby protilehlá strana zůstala na místě.
    const next: MapObject = { ...structuredClone(o), params: { ...o.params, [key]: v } };
    const geo = buildObjectGeometry(generateObject(next, this.ed.doc.terrain, this.ed.doc.objects).parts);
    const nb = new THREE.Box3();
    for (const { geometry } of geo.byMaterial.values()) {
      geometry.computeBoundingBox();
      nb.union(geometry.boundingBox!);
      geometry.dispose();
    }
    const pos = [...o.transform.position] as V3;
    if (d.axis !== 'y' && !nb.isEmpty()) {
      const nopp = d.sign > 0 ? nb.min[d.axis] : nb.max[d.axis];
      const shift = new THREE.Vector3();
      shift[d.axis] = (d.opp - nopp) * (o.transform.scale ?? 1);
      shift.applyEuler(new THREE.Euler(0, o.transform.rotation[1], 0));
      pos[0] = r4(pos[0] + shift.x);
      pos[2] = r4(pos[2] + shift.z);
    }
    if (def.describe) this.onToast(`${def.label}: ${def.describe({ ...p, [key]: v })}`);
    return cmds.update(this.ed, d.id, (x) => {
      x.params[key] = v;
      x.transform.position = pos;
    }, 'Rozměry');
  }

  // ---------------- kreslení ulice ----------------

  /** Začne kreslit ulici: klikání přidává body, Enter / dvojklik dokončí, Esc zruší. */
  startRoad(assetId: string) {
    this.cancelRoad();
    this.select([], false);
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#7dff8a', depthTest: false }));
    line.renderOrder = 25;
    line.raycast = () => {};
    const dots = new THREE.Group();
    this.root.add(line, dots);
    this.roadDraft = { assetId, pts: [], line, dots };
    this.onToast('Kreslení ulice: klikej body na terén (rovinka = 2 body, zatáčka = víc bodů). Enter nebo dvojklik dokončí, Backspace vrátí bod, Esc zruší.');
    this.onStatus();
  }

  get drawingRoad() {
    return this.roadDraft !== null;
  }

  private redrawDraft() {
    const r = this.roadDraft;
    if (!r) return;
    const cur = this.groundAtPointer();
    const pts = [...r.pts, ...(cur ? [this.snapXZ(cur)] : [])].map((p) => p.clone().setY(p.y + 0.3));
    r.line.geometry.dispose();
    r.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    for (const c of [...r.dots.children]) {
      c.removeFromParent();
      (c as THREE.Mesh).geometry.dispose();
    }
    for (const p of r.pts) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.2, p.distanceTo(this.camera.position) * 0.01), 10, 8), this.handleMat.point);
      m.position.copy(p).setY(p.y + 0.3);
      m.renderOrder = 30;
      r.dots.add(m);
    }
  }

  private cancelRoad(toast = false) {
    const r = this.roadDraft;
    if (!r) return;
    this.roadDraft = null;
    r.line.removeFromParent();
    r.line.geometry.dispose();
    for (const c of r.dots.children) (c as THREE.Mesh).geometry.dispose();
    r.dots.removeFromParent();
    if (toast) this.onToast('Kreslení ulice zrušeno.');
    this.onStatus();
  }

  private finishRoad() {
    const r = this.roadDraft;
    if (!r) return;
    // Dvojklik přidá stejný bod dvakrát – duplicity pryč.
    const pts = r.pts.filter((p, i) => i === 0 || p.distanceTo(r.pts[i - 1]) > 0.3);
    const assetId = r.assetId;
    this.cancelRoad();
    if (pts.length < 2) return this.onToast('Ulice potřebuje aspoň 2 body.', 'warn');
    const def = getAsset(assetId)!;
    const o0 = pts[0];
    const local = pts.map((p) => [r4(p.x - o0.x), r4(p.z - o0.z)] as Pt);
    const key = def.params.find((q) => q.type === 'points')!.key;
    const obj: MapObject = {
      id: this.ed.newId(),
      assetId,
      generatorVersion: def.generatorVersion,
      transform: { position: [r4(o0.x), r4(o0.y), r4(o0.z)], rotation: [0, 0, 0] },
      params: { ...resolveParams(def, {}), [key]: formatPoints(local) },
      seed: (Math.random() * 0xffffffff) >>> 0,
      material: def.defaultMaterial,
    };
    this.history.execute(cmds.insert(this.ed, [obj], `Nakreslit: ${def.label}`));
    this.select([obj.id], false);
  }

  // ---------------- operace ----------------

  undo() {
    const c = this.history.undo();
    if (c) this.onToast(`Zpět: ${c.label}`);
    this.pruneSelection();
  }
  redo() {
    const c = this.history.redo();
    if (c) this.onToast(`Znovu: ${c.label}`);
    this.pruneSelection();
  }

  deleteSelection() {
    const ids = [...this.selection].filter((id) => id !== TEST_SPAWN_ID && !markerId.parse(id) && !this.ed.getObject(id)?.editor?.locked);
    const changes: Command['changes'] = [...cmds.remove(this.ed, ids).changes];
    for (const id of this.selection) {
      const m = markerId.parse(id);
      if (!m) continue;
      changes.push(...cmds.entity(this.ed, m.collection, m.id, null, 'Smazat').changes);
      // Smazaný bod: odpojit spawny, které na něj odkazují (vazby přes ID).
      if (m.collection === 'controlPoints') {
        for (const sp of this.ed.doc.spawnPoints)
          if (sp.controlPointId === m.id) changes.push(...cmds.entity(this.ed, 'spawnPoints', sp.id, (e) => delete (e as { controlPointId?: string }).controlPointId, 'Odpojit spawn').changes);
        for (const sc of this.ed.doc.scenarios)
          if (sc.overrides.some((o) => o.controlPointId === m.id))
            changes.push(...cmds.entity(this.ed, 'scenarios', sc.id, (e) => {
              const x = e as typeof sc;
              x.overrides = x.overrides.filter((o) => o.controlPointId !== m.id);
            }, 'Upravit scénář').changes);
      }
    }
    if (!changes.length) return;
    this.history.execute({ label: 'Smazat', changes });
    this.select([], false);
  }

  duplicate() {
    const ids = [...this.selection].filter((id) => id !== TEST_SPAWN_ID && !markerId.parse(id));
    const mk = [...this.selection].map((id) => markerId.parse(id)).filter((m) => m && m.collection !== 'controlPoints');
    if (mk.length) {
      const changes: Command['changes'] = [];
      const sel: string[] = [];
      for (const m of mk) {
        const e = structuredClone(this.ed.getEntity(m!.collection, m!.id)) as unknown as Record<string, unknown>;
        e.id = this.ed.newId(m!.collection === 'zones' ? 'zone' : 'spawn');
        const p = (e.position ?? e.center) as number[];
        p[0] += 2;
        p[2] += 2;
        changes.push(...cmds.addEntity(m!.collection, e as never, 'Duplikovat').changes);
        sel.push(m!.collection === 'zones' ? markerId.zn(e.id as string) : markerId.sp(e.id as string));
      }
      this.history.execute({ label: 'Duplikovat', changes });
      this.select(sel, false);
      return;
    }
    if (!ids.length) return;
    const off = Math.max(this.settings.grid, 1);
    const { cmd, newIds } = cmds.duplicate(this.ed, ids, [off, 0, off]);
    this.history.execute(cmd);
    this.select(newIds, false);
  }

  /** Vloží nový objekt z katalogu na místo ve středu pohledu. */
  insertAsset(assetId: string) {
    const def = getAsset(assetId);
    if (!def) return;
    if (def.params.some((q) => q.type === 'points')) return this.startRoad(assetId);
    const r = this.canvas.getBoundingClientRect();
    const hit = this.pick(r.left + r.width / 2, r.top + r.height / 2, true);
    let p = hit.point;
    if (!p) {
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      p = this.camera.position.clone().addScaledVector(dir, 12);
      p.y = 0;
    }
    const g = this.settings.grid;
    const obj: MapObject = {
      id: this.ed.newId(),
      assetId,
      generatorVersion: def.generatorVersion,
      // Všechno stojí na zemi (doplňky se pak tažením přilepí na budovu).
      transform: { position: [r4(Math.round(p.x / g) * g), r4(this.groundY(Math.round(p.x / g) * g, Math.round(p.z / g) * g)), r4(Math.round(p.z / g) * g)], rotation: [0, 0, 0] },
      params: resolveParams(def, {}),
      seed: (Math.random() * 0xffffffff) >>> 0,
      material: def.defaultMaterial,
    };
    this.history.execute(cmds.insert(this.ed, [obj], `Vložit: ${def.label}`));
    this.select([obj.id], false);
  }

  updateSpawnMarker() {
    const t = this.ed.doc.testSpawn;
    this.spawnMarker.visible = !!t;
    if (t) {
      this.spawnMarker.position.set(...t.position);
      this.spawnMarker.rotation.set(0, t.rotation[1], 0);
    }
  }

  // ---------------- terén ----------------

  setTerrainMode(on: boolean) {
    this.terrainMode = on;
    this.cancelRoad();
    if (on) this.select([], false);
    this.brushRing.visible = false;
    this.onStatus();
  }

  private terrainHit(): THREE.Vector3 | null {
    const mesh = this.world.terrain;
    if (!mesh) return null;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const h = this.raycaster.intersectObject(mesh, false)[0];
    return h ? h.point : null;
  }

  private beginStroke(pickHeight: boolean) {
    const p = this.terrainHit();
    if (!p) return;
    const t = this.ed.doc.terrain;
    if (pickHeight || (this.brush.kind === 'flatten' && this.brush.target === undefined)) {
      this.brush.target = Math.round((heightAt(t, p.x, p.z) ?? 0) * 100) / 100;
      this.onToast(`Cílová výška srovnání: ${this.brush.target.toFixed(2)} m`);
      this.onStatus();
      if (pickHeight) return;
    }
    // Snímek celého pole (jen kopie čísel) → přesné „před“ pro undo jedné položky.
    this.stroke = { snapshot: readRegion(t, { x0: 0, z0: 0, x1: 0, z1: 0 }), full: t.heights.slice(), dirt: t.dirt?.slice(), urban: t.urban?.slice(), region: null };
  }

  private updateBrush(dt: number) {
    if (!this.terrainMode || this.flying) {
      this.brushRing.visible = false;
      return;
    }
    const p = this.terrainHit();
    this.brushPoint = p;
    this.brushRing.visible = !!p;
    const t = this.ed.doc.terrain;
    if (p) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const x = p.x + Math.cos(a) * this.brush.radius, z = p.z + Math.sin(a) * this.brush.radius;
        pts.push(new THREE.Vector3(x, (heightAt(t, x, z) ?? p.y) + 0.08, z));
      }
      this.brushRing.geometry.dispose();
      this.brushRing.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    if (this.stroke && p) {
      const r = applyBrush(t, this.brush, p.x, p.z, Math.min(dt, 0.1));
      this.stroke.region = unionRegion(this.stroke.region, r);
      this.onTerrainPreview();
    }
  }

  private endStroke() {
    const st = this.stroke;
    this.stroke = null;
    if (!st || !st.region) return;
    const t = this.ed.doc.terrain;
    const after = readRegion(t, st.region);
    // „Před“ ze snímku na začátku tahu.
    const tmp = { ...t, heights: st.full, dirt: st.dirt ?? (after.dirt ? new Array(t.heights.length).fill(0) : undefined), urban: st.urban ?? (after.urban ? new Array(t.heights.length).fill(0) : undefined) };
    const before = readRegion(tmp, st.region);
    const label = { raise: 'Zvýšit terén', lower: 'Snížit terén', smooth: 'Vyhladit terén', flatten: 'Srovnat terén', paintDirt: 'Malovat hlínu', paintUrban: 'Malovat městský povrch', paintErase: 'Smazat malbu' }[this.brush.kind];
    this.history.execute({ label, changes: [{ kind: 'terrain', region: st.region, before, after }] });
  }

  get stroking() {
    return this.stroke !== null;
  }

  dispose() {
    this.detach();
    this.rectEl.remove();
    this.selection.clear();
    this.refreshSelectionVisuals();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.root.removeFromParent();
  }
}

/** Bod 6 m za koncem ulice (úchop „přidat bod na konec“). */
function extend(end: Pt, prev: Pt): Pt {
  const dx = end[0] - prev[0], dz = end[1] - prev[1];
  const l = Math.hypot(dx, dz) || 1;
  return [end[0] + (dx / l) * 6, end[1] + (dz / l) * 6];
}

function normAngle(a: number) {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function isVisible(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Marker testovacího spawnu: obrys postavy 1,8 m a šipka směru pohledu. */
function makeSpawnMarker(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'testSpawnMarker';
  g.userData.special = TEST_SPAWN_ID;
  const mat = new THREE.MeshBasicMaterial({ color: '#3fd0ff', transparent: true, opacity: 0.45, depthWrite: false });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 4, 12), mat);
  body.position.y = 0.9;
  body.userData.special = TEST_SPAWN_ID;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 12), new THREE.MeshBasicMaterial({ color: '#3fd0ff' }));
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.set(0, 1.65, -0.55);
  arrow.userData.special = TEST_SPAWN_ID;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 32), new THREE.MeshBasicMaterial({ color: '#3fd0ff', side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.userData.special = TEST_SPAWN_ID;
  g.add(body, arrow, ring);
  return g;
}
