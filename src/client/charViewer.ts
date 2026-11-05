import * as THREE from 'three';
import { MOVEMENT } from '../shared/config/movement';
import { rulesOf } from '../shared/config/arsenal';
import { reloadDuration } from '../shared/config/weapon';
import { createPlayerState } from '../shared/sim/player';
import { createWeaponState } from '../shared/sim/weapon';
import { hitboxOf } from '../shared/sim/ballistics';
import type { PlayerView } from './runtime/driver';
import { SoldierPool } from './render/soldier';

/**
 * Náhledová scéna vojáků (vývojová pomůcka): USMC a MEC vedle sebe, role, postoje, pohyb,
 * zamíření, akce, životní stavy, LOD, hitboxy, playlist a klientský benchmark 16/32/64 postav.
 * Data jsou syntetická – nejde o síťový ani herní test.
 */
const WEAPONS: Record<string, [string, string]> = { base: ['m249', 'pkm'], assault: ['m4a1', 'ak101'], medic: ['m16a2', 'akm'], sniper: ['m24', 'svd'] };

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const canvas = $<HTMLCanvasElement>('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#6f716f');
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 400);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: '#8b8a86', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(40, 40, 0x555555, 0x777777);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.35;
scene.add(grid);
const hemi = new THREE.HemisphereLight('#dfe6ec', '#6d6556', 1.0);
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(-4, 7, -5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
for (const k of ['left', 'bottom'] as const) (sun.shadow.camera as THREE.OrthographicCamera)[k] = -8;
for (const k of ['right', 'top'] as const) (sun.shadow.camera as THREE.OrthographicCamera)[k] = 8;
scene.add(hemi, sun, sun.target);
const pm = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10), new THREE.MeshBasicMaterial({ color: '#9aa0a3', side: THREE.BackSide })));
scene.environment = pm.fromScene(envScene).texture;
scene.environmentIntensity = 0.5;

const pool = new SoldierPool('standard');
scene.add(pool.root);

interface Actor {
  view: PlayerView;
  faction: 0 | 1;
  base: THREE.Vector3;
}
let actors: Actor[] = [];
let simTime = 0;
let burst = 0;
let jumpUntil = -1;
let playlistT = -1;
let bench = 0;

function makeActor(id: string, faction: 0 | 1, pos: THREE.Vector3, role: string): Actor {
  const wid = WEAPONS[role][faction];
  const st = createPlayerState(MOVEMENT, { x: pos.x, y: pos.y, z: pos.z }, 0);
  const w = createWeaponState(rulesOf(wid), -10, wid);
  w.action = 'idle';
  return { view: { id, name: id, team: faction ? 'teamB' : 'teamA', state: st, weapon: w, hp: 100, alive: true, respawnAt: 0, zone: null, kills: 0, deaths: 0, life: 'alive', downedLeft: 0, reviveProgress: 0, revives: 0 }, faction, base: pos.clone() };
}

function rebuild() {
  const role = $<HTMLSelectElement>('#role').value;
  actors = [];
  if (bench) {
    const n = bench;
    const roles = Object.keys(WEAPONS);
    for (let i = 0; i < n; i++) {
      const x = ((i % 8) - 3.5) * 2.2, z = 4 + Math.floor(i / 8) * 3;
      actors.push(makeActor(`b${i}`, (i % 2) as 0 | 1, new THREE.Vector3(x, 0, z), roles[i % roles.length]));
    }
  } else {
    actors.push(makeActor('usmc', 0, new THREE.Vector3(-0.85, 0, 0), role), makeActor('mec', 1, new THREE.Vector3(0.85, 0, 0), role));
  }
}

const moveVec = (m: string): [number, number] => ({ '0': [0, 0], f: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0], fl: [-0.7, -0.7], s: [0, -1] } as Record<string, [number, number]>)[m] ?? [0, 0];

function applyControls(a: Actor, i: number) {
  const s = a.view.state, w = a.view.weapon;
  const h = Number($<HTMLSelectElement>('#stance').value);
  s.height += (h - s.height) * 0.12;
  s.stance = s.height > 1.5 ? 'stand' : s.height > 0.8 ? 'crouch' : 'prone';
  const mv = bench ? (['f', 'l', '0', 'r', 'b', 's'][i % 6]) : $<HTMLSelectElement>('#move').value;
  const [mx, mz] = moveVec(mv);
  const sp = mv === 's' ? MOVEMENT.speedSprint : s.stance === 'stand' ? MOVEMENT.speedForward : s.stance === 'crouch' ? MOVEMENT.stances.crouch.speed : MOVEMENT.stances.prone.speed;
  const yaw = THREE.MathUtils.degToRad(Number($<HTMLInputElement>('#yaw').value)) + (bench ? Math.sin(simTime * 0.3 + i) * 1.5 : 0);
  // Pohyb v prostoru zamíření (in place – poloha se nemění, jen rychlost).
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  s.vel = { x: (mx * cy + mz * sy) * sp, y: 0, z: (-mx * sy + mz * cy) * sp };
  s.yaw = yaw;
  s.bodyYaw = yaw;
  s.pitch = THREE.MathUtils.degToRad(Number($<HTMLInputElement>('#pitch').value));
  s.sprinting = mv === 's' && s.stance === 'stand';
  s.grounded = simTime >= jumpUntil;
  w.adsProgress += (($<HTMLInputElement>('#ads').checked && !s.sprinting ? 1 : 0) - w.adsProgress) * 0.15;
  if (w.action === 'reload' && simTime >= w.actionEnd) w.action = 'idle';
}

function reload(empty: boolean) {
  for (const a of actors) {
    const R = rulesOf(a.view.weapon.weaponId);
    const rd = reloadDuration(R, empty ? 0 : R.magazine - 3, R.reserve);
    Object.assign(a.view.weapon, { action: 'reload', reloadEmpty: empty, actionStart: simTime, actionEnd: simTime + rd.time });
  }
}
const setLife = (l: PlayerView['life']) => actors.forEach((a) => {
  a.view.life = l;
  a.view.alive = l === 'alive';
});

$('#role').addEventListener('change', rebuild);
$('#fire').addEventListener('click', () => actors.forEach((a) => a.view.weapon.shotSeq++));
$('#burst').addEventListener('click', () => (burst = 8));
$('#reload').addEventListener('click', () => reload(false));
$('#reloadE').addEventListener('click', () => reload(true));
$('#cancel').addEventListener('click', () => actors.forEach((a) => (a.view.weapon.action = 'idle')));
$('#down').addEventListener('click', () => setLife('downed'));
$('#revive').addEventListener('click', () => setLife('alive'));
$('#die').addEventListener('click', () => setLife('dead'));
$('#alive').addEventListener('click', () => {
  rebuild();
  pool.dispose();
  location.reload();
});
$('#jump').addEventListener('click', () => {
  jumpUntil = simTime + 0.55;
  actors.forEach((a) => (a.view.state.lastLandAt = simTime + 0.55));
});
$('#lod').addEventListener('change', () => (pool.forceLod = Number($<HTMLSelectElement>('#lod').value)));
for (const [id, n] of [['#b16', 16], ['#b32', 32], ['#b64', 64]] as const)
  $(id).addEventListener('click', () => {
    bench = bench === n ? 0 : n;
    rebuild();
  });
$('#fpU').addEventListener('click', () => window.open('/viewer.html?w=m4a1', '_blank'));
$('#fpM').addEventListener('click', () => window.open('/viewer.html?w=ak101', '_blank'));
$('#light').addEventListener('change', () => {
  const l = $<HTMLSelectElement>('#light').value;
  sun.intensity = l === 'day' ? 2.6 : l === 'side' ? 4 : 0.2;
  sun.position.set(l === 'side' ? 6 : -4, l === 'side' ? 1.5 : 7, l === 'side' ? 0 : -5);
  hemi.intensity = l === 'dark' ? 0.25 : l === 'side' ? 0.35 : 1;
  scene.environmentIntensity = l === 'dark' ? 0.15 : 0.5;
});

// Playlist: opakovatelná sekvence stavů a kombinací (vizuální kontrola).
const PLAYLIST: Array<[string, () => void]> = [
  ['stoj', () => set({ move: '0', stance: '1.8' })],
  ['chůze vpřed', () => set({ move: 'f' })],
  ['úkrok vlevo + ADS', () => set({ move: 'l', ads: true })],
  ['chůze vzad + střelba', () => (set({ move: 'b', ads: false }), (burst = 10))],
  ['sprint', () => set({ move: 's' })],
  ['dřep – krok', () => set({ move: 'f', stance: '1.2' })],
  ['dřep + přebití', () => (set({ move: '0' }), reload(false))],
  ['leh – plazení', () => set({ move: 'f', stance: '0.5' })],
  ['leh + přebití', () => (set({ move: '0' }), reload(true))],
  ['stoj, otočka na místě', () => set({ stance: '1.8', yaw: 120 })],
  ['zamíření nahoru', () => set({ yaw: 0, pitch: 55 })],
  ['vyřazení', () => (set({ pitch: 0 }), setLife('downed'))],
  ['oživení', () => setLife('alive')],
  ['smrt', () => setLife('dead')],
];
function set(o: { move?: string; stance?: string; ads?: boolean; yaw?: number; pitch?: number }) {
  if (o.move !== undefined) $<HTMLSelectElement>('#move').value = o.move;
  if (o.stance !== undefined) $<HTMLSelectElement>('#stance').value = o.stance;
  if (o.ads !== undefined) $<HTMLInputElement>('#ads').checked = o.ads;
  if (o.yaw !== undefined) $<HTMLInputElement>('#yaw').value = String(o.yaw);
  if (o.pitch !== undefined) $<HTMLInputElement>('#pitch').value = String(o.pitch);
}
let playIdx = -1;
$('#play').addEventListener('click', () => {
  playlistT = 0;
  playIdx = -1;
  setLife('alive');
});

// Hitboxy (stejná funkce jako na serveru).
const hbGroup = new THREE.Group();
scene.add(hbGroup);
const hbMat = new THREE.MeshBasicMaterial({ color: '#ff3b30', wireframe: true, transparent: true, opacity: 0.6, depthTest: false });
function drawHitboxes() {
  hbGroup.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
  hbGroup.clear();
  if (!$<HTMLInputElement>('#hb').checked) return;
  for (const a of actors) {
    if (a.view.life !== 'alive') continue;
    const hb = hitboxOf(a.view.id, a.view.state, MOVEMENT);
    const A = new THREE.Vector3(hb.a.x, hb.a.y, hb.a.z), B = new THREE.Vector3(hb.b.x, hb.b.y, hb.b.z);
    const len = A.distanceTo(B);
    const g = new THREE.CapsuleGeometry(hb.r, len, 4, 10);
    const m = new THREE.Mesh(g, hbMat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    m.renderOrder = 10;
    hbGroup.add(m);
  }
}

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
rebuild();

let last = performance.now();
const times: number[] = [];
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  simTime += dt;
  if (playlistT >= 0) {
    playlistT += dt;
    const idx = Math.floor(playlistT / 2.5);
    if (idx !== playIdx) {
      playIdx = idx;
      if (idx >= PLAYLIST.length) playlistT = -1;
      else PLAYLIST[idx][1]();
    }
  }
  if (burst > 0 && Math.floor(simTime * 10) !== Math.floor((simTime - dt) * 10)) {
    actors.forEach((a) => a.view.weapon.shotSeq++);
    burst--;
  }
  actors.forEach(applyControls);
  // Kamera.
  const cam = $<HTMLSelectElement>('#cam').value;
  const target = new THREE.Vector3(0, bench ? 1 : 1.0, bench ? 8 : 0);
  const d = bench ? 16 : cam === 'far' ? 15 : 4.2;
  const ang = cam === 'front' ? 0 : cam === 'side' ? Math.PI / 2 : cam === 'back' ? Math.PI : simTime * 0.4;
  camera.position.set(Math.sin(ang) * d, bench ? 6 : 1.5, target.z - Math.cos(ang) * d);
  camera.lookAt(target);
  renderer.info.reset();
  pool.update(actors.map((a) => a.view), dt, simTime, camera.position, camera);
  drawHitboxes();
  renderer.render(scene, camera);
  times.push(dt * 1000);
  if (times.length > 120) times.shift();
  const sorted = [...times].sort((a, b) => a - b);
  const role = PLAYLIST[playIdx]?.[0];
  $('#stats').textContent =
    `postav ${actors.length} (viditelné ${pool.visibleCount})  LOD ${pool.lodCounts.join('/')}\n` +
    `draw calls ${renderer.info.render.calls}  trojúhelníky ${renderer.info.render.triangles}\n` +
    `frame ${(sorted[sorted.length >> 1] ?? 0).toFixed(1)} ms  p95 ${(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)} ms\n` +
    (playlistT >= 0 ? `playlist: ${role ?? ''}\n` : '') +
    `akce ${actors[0]?.view.weapon.action}  život ${actors[0]?.view.life}`;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
(window as unknown as Record<string, unknown>).__chars = { pool, actors: () => actors, set, setLife, reload, get simTime() { return simTime; }, rebuild, camera };
