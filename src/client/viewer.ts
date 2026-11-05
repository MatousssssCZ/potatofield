import * as THREE from 'three';
import { vFovFromH16x9 } from '../shared/config/camera';
import { createWeaponState } from '../shared/sim/weapon';
import { createPlayerState } from '../shared/sim/player';
import { MOVEMENT } from '../shared/config/movement';
import { PF_RIFLE } from '../shared/config/weapon';
import { FPWeapon } from './render/weapons/fpWeapon';
import { HAND_LOOKS } from './render/weapons/hands';
import { FACTION_LABEL, KIT_LABEL, WEAPON_DEFS, weaponDef } from './render/weapons/catalog';

/** Interní prohlížeč zbraní a rukou (vývojová scéna). */
const WEAPONS = WEAPON_DEFS.map((w) => ({ id: w.id, label: `${FACTION_LABEL[w.faction]} ${KIT_LABEL[w.kit]} – ${w.name}${w.build ? '' : ' (čeká)'}`, ready: !!w.build }));

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const canvas = $<HTMLCanvasElement>('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#6f716f');
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.03, 500);
scene.add(camera);

// Neutrální šedé prostředí s jednoduchou střelnicí v pozadí.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#8b8a86', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.65;
floor.receiveShadow = true;
scene.add(floor);
for (let i = 0; i < 5; i++) {
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.04), new THREE.MeshStandardMaterial({ color: '#c9b48a', roughness: 0.9 }));
  t.position.set(-4 + i * 2, -0.55, -10 - i * 6);
  t.castShadow = true;
  scene.add(t);
}
const wall = new THREE.Mesh(new THREE.BoxGeometry(30, 4, 0.5), new THREE.MeshStandardMaterial({ color: '#9a978f', roughness: 0.9 }));
wall.position.set(0, 0.35, -45);
scene.add(wall);
const hemi = new THREE.HemisphereLight('#dfe6ec', '#6d6556', 1.0);
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(-3, 6, 2);
sun.castShadow = true;
scene.add(hemi, sun);
const pm = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10), new THREE.MeshBasicMaterial({ color: '#9aa0a3', side: THREE.BackSide })));
const top = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 8, 0, Math.PI * 2, 0, 1), new THREE.MeshBasicMaterial({ color: '#e8eef2', side: THREE.BackSide }));
envScene.add(top);
scene.environment = pm.fromScene(envScene).texture;
scene.environmentIntensity = 0.5;

const sel = (id: string, opts: Array<[string, string]>) => {
  const s = $<HTMLSelectElement>(id);
  for (const [v, l] of opts) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    s.appendChild(o);
  }
  return s;
};
sel('#weapon', WEAPONS.map((w) => [w.id, w.label]));
for (const o of $<HTMLSelectElement>('#weapon').options) o.disabled = !WEAPONS.find((w) => w.id === o.value)?.ready;
const urlW = new URLSearchParams(location.search).get('w');
if (urlW && weaponDef(urlW).id === urlW) $<HTMLSelectElement>('#weapon').value = urlW;
sel('#hands', Object.keys(HAND_LOOKS).map((k) => [k, k]));
$<HTMLSelectElement>('#hands').value = weaponDef($<HTMLSelectElement>('#weapon').value).hands;

let fp: FPWeapon | null = null;
const ps = createPlayerState(MOVEMENT, { x: 0, y: 0, z: 0 });
const ws = createWeaponState(PF_RIFLE, -10);
ws.action = 'idle';
let simTime = 0;
let burst = 0;
const ptsGroup = new THREE.Group();

function build() {
  fp?.dispose();
  fp = new FPWeapon($<HTMLSelectElement>('#weapon').value, $<HTMLSelectElement>('#hands').value, $<HTMLSelectElement>('#q').value as never);
  camera.add(fp.root);
  rebuildPoints();
}

function rebuildPoints() {
  ptsGroup.removeFromParent();
  ptsGroup.clear();
  if (!fp || !$<HTMLInputElement>('#pts').checked) return;
  for (const [, v] of Object.entries(fp.model.points)) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2fd0', depthTest: false }));
    m.position.copy(v as THREE.Vector3);
    m.renderOrder = 50;
    ptsGroup.add(m);
  }
  const wr = fp.root.children[0].children.find((c) => c.type === 'Group' && c.children.length > 2);
  (wr ?? fp.root).add(ptsGroup);
}

function applyView() {
  const v = $<HTMLSelectElement>('#view').value;
  ws.adsToggle = v === 'ads';
  const fov = Number($<HTMLSelectElement>('#fov').value);
  const vf = THREE.MathUtils.radToDeg(vFovFromH16x9(fov));
  if (!fp) return;
  if (v === 'left' || v === 'right' || v === 'top') {
    // Katalogový pohled: sestava ve scéně, kamera obíhá kolem středu zbraně.
    scene.add(fp.root);
    fp.root.position.set(0, 0, 0);
    fp.root.quaternion.identity();
    const c = new THREE.Vector3(0.14, -0.15, -0.5);
    const d = 1.05;
    const p = v === 'left' ? new THREE.Vector3(-d, 0.05, 0) : v === 'right' ? new THREE.Vector3(d, 0.05, 0) : new THREE.Vector3(0.5, 0.6, 0.45);
    camera.position.copy(c).add(p);
    camera.fov = 38;
    camera.updateProjectionMatrix();
    camera.lookAt(c);
  } else {
    camera.add(fp.root);
    fp.root.position.set(0, 0, 0);
    fp.root.quaternion.identity();
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    camera.fov = v === 'ads' ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vf) / 2) / 1.35)) : vf;
    camera.updateProjectionMatrix();
  }
}

function applyLight() {
  const l = $<HTMLSelectElement>('#light').value;
  if (l === 'day') {
    sun.intensity = 2.6;
    sun.position.set(-3, 6, 2);
    hemi.intensity = 1.0;
    scene.environmentIntensity = 0.5;
  } else if (l === 'side') {
    sun.intensity = 4.0;
    sun.position.set(6, 1.2, -1);
    hemi.intensity = 0.35;
    scene.environmentIntensity = 0.25;
  } else {
    sun.intensity = 0.0;
    hemi.intensity = 0.3;
    scene.environmentIntensity = 0.18;
  }
}

$('#weapon').addEventListener('change', () => {
  $<HTMLSelectElement>('#hands').value = weaponDef($<HTMLSelectElement>('#weapon').value).hands;
  build();
  applyView();
});
for (const id of ['#hands', '#q']) $(id).addEventListener('change', () => {
  build();
  applyView();
});
$('#view').addEventListener('change', applyView);
$('#fov').addEventListener('change', applyView);
$('#light').addEventListener('change', applyLight);
$('#pts').addEventListener('change', rebuildPoints);
$('#fire').addEventListener('click', () => ws.shotSeq++);
$('#burst').addEventListener('click', () => (burst = 8));
const reload = (empty: boolean) => {
  ws.action = 'reload';
  ws.reloadEmpty = empty;
  ws.actionStart = simTime;
  ws.actionEnd = simTime + (empty ? PF_RIFLE.reloadEmpty : PF_RIFLE.reloadPartial);
  ws.adsToggle = false;
};
$('#reload').addEventListener('click', () => reload(false));
$('#reloadE').addEventListener('click', () => reload(true));
$('#swap').addEventListener('click', () => {
  for (let i = 0; i < 30; i++) build();
  applyView();
});

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
build();
resize();
applyView();
applyLight();

let last = performance.now();
const times: number[] = [];
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  simTime += dt;
  renderer.info.reset();
  if (burst > 0 && Math.floor(simTime * 10) !== Math.floor((simTime - dt) * 10)) {
    ws.shotSeq++;
    burst--;
  }
  if (ws.action === 'reload' && simTime >= ws.actionEnd) ws.action = 'idle';
  ws.adsProgress = THREE.MathUtils.clamp(ws.adsProgress + (ws.adsToggle && ws.action !== 'reload' ? dt / 0.2 : -dt / 0.15), 0, 1);
  fp?.update(dt, ps, ws, simTime, 0, 0, 0, 0);
  renderer.render(scene, camera);
  times.push(dt * 1000);
  if (times.length > 120) times.shift();
  const st = fp?.stats();
  const sorted = [...times].sort((a, b) => a - b);
  $('#stats').textContent = `trojúhelníky ${st?.triangles}\nmeshe ${st?.meshes}\ndraw calls ${renderer.info.render.calls}\nframe ${(sorted[sorted.length >> 1] ?? 0).toFixed(1)} ms, p95 ${(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)} ms\ngeometrie ${renderer.info.memory.geometries} textury ${renderer.info.memory.textures}`;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
(window as unknown as Record<string, unknown>).__viewer = { camera, renderer, scene, ws, get fp() { return fp; }, applyView, reload, build };
