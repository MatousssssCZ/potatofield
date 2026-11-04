import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { MapObject, Transform } from '../../shared/map/schema';
import { getAsset, resolveParams } from '../../world/registry';
import type { WorldView } from '../render/worldView';
import { cmds, type Command, type EditorDoc, type History } from './editorDoc';
import { MarkerView, markerId } from './markers';
import { applyBrush, heightAt, readRegion, unionRegion, type Brush, type Region } from '../../world/terrain';

export type Tool = 'translate' | 'rotate' | 'scale';
export const TEST_SPAWN_ID = '__testSpawn';

export interface EditorSettings {
  grid: number;
  rotSnapDeg: number; // 0 = volná
  space: 'local' | 'world';
  flySpeed: number;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Editor ve viewportu: volná kamera, výběr, gizma a transformace.
 * Všechny změny mapy jdou přes History (undo/redo). Listenery se registrují
 * přes `on()` a `detach()` je všechny odebere (přepínání do hry je nehromadí).
 */
export class Editor {
  readonly root = new THREE.Group();
  readonly selection = new Set<string>();
  tool: Tool = 'translate';
  settings: EditorSettings = { grid: 0.5, rotSnapDeg: 15, space: 'world', flySpeed: 12 };
  onSelection: () => void = () => {};
  onToast: (msg: string, kind?: 'info' | 'warn') => void = () => {};
  onStatus: () => void = () => {};

  private tc: TransformControls;
  private tcHelper: THREE.Object3D;
  private pivot = new THREE.Object3D();
  private pivotStart = new THREE.Matrix4();
  private startMats = new Map<string, THREE.Matrix4>();
  private dragging = false;
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

  // kamera
  private yaw = 0;
  private pitch = -0.5;
  private flying = false;
  private keys = new Set<string>();
  private altHeld = false;
  // výběr rámečkem
  private down: { x: number; y: number; ctrl: boolean; button: number } | null = null;
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
    this.tc = new TransformControls(camera, canvas);
    this.tc.setSize(0.9);
    this.tcHelper = this.tc.getHelper();
    this.root.add(this.tcHelper);
    this.root.add(this.pivot);
    this.tc.addEventListener('dragging-changed', (e) => (this.dragging = Boolean((e as unknown as { value: boolean }).value)));
    this.tc.addEventListener('mouseDown', () => this.beginDrag());
    this.tc.addEventListener('objectChange', () => this.previewDrag());
    this.tc.addEventListener('mouseUp', () => this.endDrag());
    this.tc.disconnect();
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
    this.applyTool();
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
    this.tc.connect(this.canvas);
    this.on(this.canvas, 'pointerdown', ((e: PointerEvent) => this.pointerDown(e)) as EventListener);
    this.on(window, 'pointermove', ((e: PointerEvent) => this.pointerMove(e)) as EventListener);
    this.on(window, 'pointerup', ((e: PointerEvent) => this.pointerUp(e)) as EventListener);
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
    this.tc.disconnect();
    this.attached = false;
    this.clearKeys();
    this.flying = false;
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
      if (this.keys.has('KeyE')) v.y += 1;
      if (this.keys.has('KeyQ')) v.y -= 1;
      if (v.lengthSq() > 0) {
        v.normalize().multiplyScalar(this.settings.flySpeed * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1) * dt);
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
    // Pivot sleduje výběr, když se zrovna netáhne (např. po undo).
    if (!this.dragging) this.placePivot();
    for (const [id, h] of this.boxes) {
      const g = id === TEST_SPAWN_ID ? this.spawnMarker : this.world.objects.get(id);
      if (g) h.box.setFromObject(g);
    }
  }

  frameSelection() {
    const box = new THREE.Box3();
    for (const id of this.selection) {
      const g = id === TEST_SPAWN_ID ? this.spawnMarker : this.world.objects.get(id);
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
      this.keys.add(e.code);
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
      case 'KeyW':
        this.setTool('translate');
        break;
      case 'KeyE':
        this.setTool('rotate');
        break;
      case 'KeyR':
        this.setTool('scale');
        break;
      case 'KeyF':
        this.frameSelection();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSelection();
        break;
      case 'Escape':
        this.select([], false);
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
    if (this.terrainMode) {
      this.beginStroke(e.shiftKey);
      return;
    }
    // Klik na gizmo nevybírá objekt za ním.
    if (this.tc.axis !== null || this.dragging) return;
    this.down = { x: e.clientX, y: e.clientY, ctrl: e.ctrlKey || e.metaKey, button: 0 };
  }

  private pointerMove(e: PointerEvent) {
    this.pointerNdc = this.ndc(e.clientX, e.clientY);
    if (this.flying && document.pointerLockElement === this.canvas) {
      this.yaw -= e.movementX * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0025, -1.55, 1.55);
      return;
    }
    if (this.down) {
      const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y;
      if (Math.hypot(dx, dy) > 5) {
        const r = this.canvas.getBoundingClientRect();
        const x0 = Math.min(e.clientX, this.down.x) - r.left, y0 = Math.min(e.clientY, this.down.y) - r.top;
        Object.assign(this.rectEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` });
        this.rectEl.classList.remove('hidden');
      }
    }
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
    if (e.button !== 0 || !this.down) return;
    const d = this.down;
    this.down = null;
    this.rectEl.classList.add('hidden');
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5;
    if (moved) this.rectSelect(d.x, d.y, e.clientX, e.clientY, d.ctrl);
    else this.clickSelect(e.clientX, e.clientY, d.ctrl);
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

  private clickSelect(cx: number, cy: number, ctrl: boolean) {
    const { id } = this.pick(cx, cy);
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
    this.placePivot();
    const movable = [...this.selection].filter((id) => id === TEST_SPAWN_ID || markerId.parse(id) || !this.ed.getObject(id)?.editor?.locked);
    if (movable.length > 0) this.tc.attach(this.pivot);
    else this.tc.detach();
    this.applyTool();
  }

  // ---------------- gizmo ----------------

  setTool(t: Tool) {
    this.tool = t;
    this.applyTool();
    this.onStatus();
  }

  private applyTool() {
    this.tc.setMode(this.tool);
    const multi = this.selection.size > 1;
    this.tc.setSpace(this.tool === 'scale' ? 'local' : this.settings.space);
    // Rotace jen kolem svislé osy (městská stavebnice); X/Z by rozbily parametrické stavby.
    this.tc.showX = this.tool !== 'rotate';
    this.tc.showZ = this.tool !== 'rotate';
    this.tc.showY = true;
    const only = [...this.selection][0];
    if (this.tool === 'scale' && (multi || only === TEST_SPAWN_ID || only?.startsWith('sp:'))) this.tc.detach();
    this.updateSnap();
  }

  updateSnap() {
    const off = this.altHeld;
    this.tc.setTranslationSnap(off ? null : this.settings.grid);
    this.tc.setRotationSnap(off || this.settings.rotSnapDeg === 0 ? null : THREE.MathUtils.degToRad(this.settings.rotSnapDeg));
    this.tc.setScaleSnap(null);
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

  private placePivot() {
    const ids = [...this.selection];
    if (ids.length === 0) return;
    const c = new THREE.Vector3();
    let n = 0;
    for (const id of ids) {
      const t = this.transformOf(id);
      if (!t) continue;
      c.add(new THREE.Vector3(...t.position));
      n++;
    }
    if (!n) return;
    c.divideScalar(n);
    this.pivot.position.copy(c);
    const t0 = this.transformOf(ids[0]);
    if (ids.length === 1 && t0) this.pivot.rotation.set(0, t0.rotation[1], 0);
    else this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld();
  }

  private groupOf(id: string): THREE.Object3D | undefined {
    if (id === TEST_SPAWN_ID) return this.spawnMarker;
    if (markerId.parse(id)) return this.markers.objectFor(id);
    return this.world.objects.get(id);
  }

  private beginDrag() {
    this.pivot.updateMatrixWorld();
    this.pivotStart.copy(this.pivot.matrixWorld);
    this.startMats.clear();
    for (const id of this.selection) {
      const g = this.groupOf(id);
      if (g) {
        g.updateMatrixWorld();
        this.startMats.set(id, g.matrixWorld.clone());
      }
    }
  }

  /** Lehký náhled během tažení: pohybují se jen existující meshe, nic se negeneruje. */
  private previewDrag() {
    this.pivot.updateMatrixWorld();
    if (this.tool === 'scale') {
      const id = [...this.selection][0];
      const g = this.groupOf(id);
      const start = this.startMats.get(id);
      if (g && start) {
        const s = this.pivot.scale;
        const base = new THREE.Vector3();
        start.decompose(new THREE.Vector3(), new THREE.Quaternion(), base);
        g.scale.set(base.x * Math.max(0.01, s.x), base.y * Math.max(0.01, s.y), base.z * Math.max(0.01, s.z));
      }
      return;
    }
    const delta = this.pivot.matrixWorld.clone().multiply(this.pivotStart.clone().invert());
    for (const [id, m0] of this.startMats) {
      const g = this.groupOf(id);
      if (!g) continue;
      const m = delta.clone().multiply(m0);
      m.decompose(g.position, g.quaternion, g.scale);
      g.updateMatrixWorld(true);
    }
  }

  /** Dokončení tažení = jedna položka historie, finální přegenerování a kolize. */
  private endDrag() {
    const changes: Command['changes'] = [];
    if (this.tool === 'scale') {
      const id = [...this.selection][0];
      const s = this.pivot.scale.clone();
      const g = this.groupOf(id);
      const mk = markerId.parse(id ?? '');
      if (mk && mk.collection !== 'spawnPoints') {
        const c = cmds.entity(this.ed, mk.collection, mk.id, (e) => {
          const x = e as unknown as Record<string, unknown>;
          if (mk.collection === 'zones') {
            const he = x.halfExtents as number[];
            x.halfExtents = [r4(Math.max(0.5, he[0] * s.x)), r4(Math.max(0.5, he[1] * s.y)), r4(Math.max(0.5, he[2] * s.z))];
          } else {
            x.radius = r4(THREE.MathUtils.clamp((x.radius as number) * (s.x + s.z) / 2, 1, 100));
            x.height = r4(THREE.MathUtils.clamp((x.height as number) * s.y, 1, 50));
          }
        }, 'Rozměry markeru');
        changes.push(...c.changes);
        const g = this.groupOf(id);
        if (g) g.scale.set(1, 1, 1);
      } else if (id && id !== TEST_SPAWN_ID) {
        const c = this.scaleCommand(id, s);
        if (c) changes.push(...c.changes);
        else if (g && this.startMats.get(id)) this.startMats.get(id)!.decompose(g.position, g.quaternion, g.scale);
      }
      this.pivot.scale.set(1, 1, 1);
    } else {
      for (const id of this.selection) {
        const g = this.groupOf(id);
        if (!g) continue;
        const e = new THREE.Euler().setFromQuaternion(g.quaternion, 'XYZ');
        const pos: [number, number, number] = [r4(g.position.x), r4(g.position.y), r4(g.position.z)];
        const rot: [number, number, number] = [r4(e.x), r4(normAngle(e.y)), r4(e.z)];
        const mk = markerId.parse(id);
        if (id === TEST_SPAWN_ID) {
          const before = this.ed.doc.testSpawn;
          changes.push({ kind: 'testSpawn', before, after: { position: pos, rotation: [0, rot[1], 0] } });
        } else if (mk) {
          const c = cmds.entity(this.ed, mk.collection, mk.id, (e) => {
            const x = e as unknown as Record<string, unknown>;
            if (mk.collection === 'zones') {
              x.center = pos;
              x.yaw = rot[1];
            } else {
              x.position = pos;
              if (mk.collection === 'spawnPoints') x.yaw = rot[1];
            }
          }, 'Posun markeru');
          changes.push(...c.changes);
        } else {
          const c = cmds.update(this.ed, id, (o) => {
            o.transform.position = pos;
            o.transform.rotation = rot;
          });
          changes.push(...c.changes);
        }
      }
    }
    const label = this.tool === 'translate' ? 'Posun' : this.tool === 'rotate' ? 'Rotace' : 'Rozměry';
    if (changes.length) this.history.execute({ label, changes });
    this.placePivot();
  }

  /** Převod tažení rozměrového handlu na parametry generátoru (přichycené na mřížku a meze). */
  private scaleCommand(id: string, s: THREE.Vector3): Command | null {
    const o = this.ed.getObject(id);
    if (!o) return null;
    const def = getAsset(o.assetId);
    if (!def) return null;
    if (def.sizeParams) {
      const p = resolveParams(def, o.params);
      const next: Record<string, number> = {};
      for (const axis of ['x', 'y', 'z'] as const) {
        const key = def.sizeParams[axis];
        if (!key) continue;
        const f = s[axis];
        if (Math.abs(f - 1) < 1e-4) continue;
        const spec = def.params.find((q) => q.key === key)!;
        let v = (p[key] as number) * f;
        if (spec.type === 'int') v = Math.round(v); // moduly / patra: jen celé počty
        else if (!this.altHeld) v = Math.max(this.settings.grid, Math.round(v / this.settings.grid) * this.settings.grid);
        v = THREE.MathUtils.clamp(v, spec.min ?? 0, spec.max ?? 1e6);
        next[key] = r4(v);
      }
      const c = cmds.update(this.ed, id, (obj) => Object.assign(obj.params, next), 'Rozměry');
      if (def.describe) this.onToast(`${def.label}: ${def.describe({ ...p, ...next })}`);
      return c;
    }
    if (def.uniformScale) {
      const f = (s.x + s.y + s.z) / 3;
      const cur = o.transform.scale ?? 1;
      const v = THREE.MathUtils.clamp(r4(cur * f), def.uniformScale.min, def.uniformScale.max);
      return cmds.update(this.ed, id, (obj) => (obj.transform.scale = v), 'Měřítko');
    }
    this.onToast(`${def.label}: rozměry tohoto typu nelze měnit.`, 'warn');
    return null;
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
      transform: { position: [r4(Math.round(p.x / g) * g), r4(Math.max(0, p.y)), r4(Math.round(p.z / g) * g)], rotation: [0, 0, 0] },
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
    this.tc.detach();
    this.tc.dispose();
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
