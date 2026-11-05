import { deg, type MovementConfig } from '../config/movement';
import { CAMERA } from '../config/camera';
import { PF_RIG, muzzleView, type RigProfile } from '../config/rig';
import { reloadDuration, type WeaponConfig } from '../config/weapon';
import { clamp, type V3 } from '../math';
import type { PhysicsWorld } from '../physics/world';
import type { Projectile } from './ballistics';
import { BTN, type InputFrame } from './input';
import { eyePosition, type PlayerState } from './player';

/**
 * Logika zbraně (sdílená klientem i serverem). Čtyři oddělené jevy:
 * směr zamíření (myš + zbývající recoil), kamerový recoil, rozptyl (kužel), kosmetické kopnutí (jen render).
 */
export type WeaponAction = 'equip' | 'idle' | 'reload' | 'sprintOut';

export interface WeaponState {
  mode: 'semi' | 'auto';
  mag: number;
  reserve: number;
  action: WeaponAction;
  actionStart: number;
  actionEnd: number;
  reloadEmpty: boolean;
  nextShotAt: number;
  adsToggle: boolean;
  adsProgress: number;
  firingPenalty: number;
  lastShotAt: number;
  /** Zbývající recoil (rad) přičtený k zamíření; návrat odstraňuje jen tento offset. */
  recoilPitch: number;
  recoilYaw: number;
  proneStartAt: number;
  landingAt: number;
  lastLandSeen: number;
  wasProne: boolean;
  wasSprinting: boolean;
  shotSeq: number;
  /** 0–1: jak moc je zbraň stažená kvůli blízké překážce. */
  obstruction: number;
  blockReason: string;
  /** Poslední výstřel (pro prezentaci a testy). */
  lastSpread: number;
  /** Zbraň z arzenálu (vzhled + pravidla); určuje server při spawnu. */
  weaponId: string;
  /** Nabíjení po jednom: kolik nábojů se v této akci vkládá a kolik už je vloženo. */
  shellsPlanned: number;
  shellsLoaded: number;
}

export function createWeaponState(w: WeaponConfig, t: number, weaponId = 'm4a1'): WeaponState {
  return {
    mode: w.modes.includes('auto') ? 'auto' : 'semi',
    mag: w.magazine,
    reserve: w.reserve,
    action: 'equip',
    actionStart: t,
    actionEnd: t + w.equipTime,
    reloadEmpty: false,
    nextShotAt: 0,
    adsToggle: false,
    adsProgress: 0,
    firingPenalty: 0,
    lastShotAt: -1e9,
    recoilPitch: 0,
    recoilYaw: 0,
    proneStartAt: -1e9,
    landingAt: -1e9,
    lastLandSeen: -1e9,
    wasProne: false,
    wasSprinting: false,
    shotSeq: 0,
    obstruction: 0,
    blockReason: '',
    lastSpread: 0,
    weaponId,
    shellsPlanned: 0,
    shellsLoaded: 0,
  };
}

/** Deterministický hash → [0,1) ze seedu a pořadí výstřelu (server přiděluje seed). */
export function shotRandom(seed: number, seq: number, k: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seq + 1, 0xc2b2ae35) ^ Math.imul(k + 7, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Rovnoměrný směr v kuželu s polovičním úhlem `alpha` kolem `dir` (prostorový úhel). */
export function sampleCone(dir: V3, alpha: number, u: number, v: number): V3 {
  const cosT = 1 - u * (1 - Math.cos(alpha));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = 2 * Math.PI * v;
  // Ortonormální báze kolem dir.
  const up = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let t1 = { x: up.y * dir.z - up.z * dir.y, y: up.z * dir.x - up.x * dir.z, z: up.x * dir.y - up.y * dir.x };
  const l = Math.hypot(t1.x, t1.y, t1.z);
  t1 = { x: t1.x / l, y: t1.y / l, z: t1.z / l };
  const t2 = { x: dir.y * t1.z - dir.z * t1.y, y: dir.z * t1.x - dir.x * t1.z, z: dir.x * t1.y - dir.y * t1.x };
  const a = Math.cos(phi) * sinT, b = Math.sin(phi) * sinT;
  return { x: dir.x * cosT + t1.x * a + t2.x * b, y: dir.y * cosT + t1.y * a + t2.y * b, z: dir.z * cosT + t1.z * a + t2.z * b };
}

/** Směr z úhlů (yaw kolem Y, pitch nahoru kladný); yaw = 0 míří k −Z. */
export function dirFromAngles(yaw: number, pitch: number): V3 {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

/** Zamíření = pohled myší + zbývající recoil (ořezané na limit pitch bez skrytého dluhu). */
export function aimAngles(ps: PlayerState, ws: WeaponState) {
  return { yaw: ps.yaw + ws.recoilYaw, pitch: clamp(ps.pitch + ws.recoilPitch, -deg(CAMERA.pitchLimitDeg), deg(CAMERA.pitchLimitDeg)) };
}

/** Rozptyl (rad, poloviční úhel) a jeho složky – pro debug panel i crosshair. */
export function spreadOf(w: WeaponConfig, mv: MovementConfig, ps: PlayerState, ws: WeaponState, t: number) {
  const sp = w.spread;
  const st = mv.stances;
  // Základ interpolovaný podle výšky těla (plynulý přechod postoje).
  const h = ps.height;
  const base =
    h >= st.crouch.height
      ? sp.crouchDeg + ((sp.standDeg - sp.crouchDeg) * (h - st.crouch.height)) / (st.stand.height - st.crouch.height)
      : sp.proneDeg + ((sp.crouchDeg - sp.proneDeg) * clamp((h - st.prone.height) / (st.crouch.height - st.prone.height), 0, 1)) ;
  const stanceKey = h >= st.stand.height - 0.05 ? 'stand' : h > st.prone.height + 0.05 ? 'crouch' : 'prone';
  const limit = st[stanceKey].speed;
  const move = sp.movementDeg * clamp(Math.hypot(ps.vel.x, ps.vel.z) / limit, 0, 1);
  const ads = 1 + (sp.adsMultiplier - 1) * ws.adsProgress;
  const air = ps.grounded || ps.ladder ? 0 : sp.airborneDeg;
  const prone = sp.proneStartDeg * clamp(1 - (t - ws.proneStartAt) / sp.proneStartDecay, 0, 1);
  const landing = sp.landingDeg * clamp(1 - (t - ws.landingAt) / sp.landingDecay, 0, 1);
  const totalDeg = (base + move) * ads + ws.firingPenalty + air + prone + landing;
  return { total: deg(totalDeg), base, move, ads, firing: ws.firingPenalty, air, prone, landing };
}

export interface FireContext {
  playerId: string;
  lifeId: number;
  team?: string;
  seed: number;
  phys: PhysicsWorld;
  exclude?: unknown;
}

/**
 * Jeden tick zbraně. Pořadí priorit: smrt (řeší volající), změna zbraně, reload, sprint, ADS, střelba.
 * Vrací vytvořené projektily (0 nebo 1).
 */
export function stepWeapon(
  w: WeaponConfig,
  mv: MovementConfig,
  ps: PlayerState,
  ws: WeaponState,
  input: InputFrame,
  ctx: FireContext,
  rig: RigProfile = PF_RIG,
): Projectile[] {
  const dt = 1 / mv.tickRate;
  const t = ps.tick * dt; // čas po kroku pohybu (ps.tick už je navýšený)
  const held = (b: number) => (input.held & b) !== 0;
  const pressed = (b: number) => (input.pressed & b) !== 0;
  ws.blockReason = '';
  const out: Projectile[] = [];

  // Penalizace přechodu do lehu a dopadu.
  const prone = ps.stance === 'prone';
  if (prone && !ws.wasProne) ws.proneStartAt = t;
  ws.wasProne = prone;
  if (ps.lastLandAt !== ws.lastLandSeen) {
    if (ws.lastLandSeen > -1e8) ws.landingAt = t;
    ws.lastLandSeen = ps.lastLandAt;
  }

  // Režim střelby: opětovný stisk 3 (aktivní primární) nebo B. Sloty 1/2 a kolečko bez akce.
  if (pressed(BTN.SLOT3) || pressed(BTN.MODE)) {
    if (w.modes.length > 1) ws.mode = ws.mode === 'auto' ? 'semi' : 'auto';
  }

  // Dokončení akcí.
  if (ws.action === 'equip' && t >= ws.actionEnd) ws.action = 'idle';
  if (ws.action === 'sprintOut' && t >= ws.actionEnd) ws.action = 'idle';
  const single = w.reloadKind === 'single';
  if (ws.action === 'reload' && single) {
    // Po jednom: každý náboj se připíše v okamžiku vložení (přerušitelné výstřelem).
    while (ws.shellsLoaded < ws.shellsPlanned && ws.reserve > 0 && ws.mag < w.magazine && t >= ws.actionStart + (w.shellStart ?? 0) + (ws.shellsLoaded + 1) * (w.shellInsert ?? 0.5) - 1e-9) {
      ws.mag++;
      ws.reserve--;
      ws.shellsLoaded++;
    }
    if (t >= ws.actionEnd - 1e-9) ws.action = 'idle';
  } else if (ws.action === 'reload' && t >= ws.actionEnd - 1e-9) {
    // Jediný commit munice na konci přebití.
    const n = Math.min(w.magazine - ws.mag, ws.reserve);
    ws.mag += n;
    ws.reserve -= n;
    ws.action = 'idle';
  }

  // Reload (priorita před sprintem a střelbou).
  if (pressed(BTN.RELOAD)) {
    if (ws.action !== 'idle' && ws.action !== 'sprintOut') ws.blockReason = 'reload: probíhá jiná akce';
    else if (ws.mag >= w.magazine) ws.blockReason = 'reload: plný zásobník';
    else if (ws.reserve <= 0) ws.blockReason = 'reload: bez rezervy';
    else if (ps.ladder) ws.blockReason = 'reload: na žebříku';
    else if (ws.action === 'sprintOut') ws.blockReason = 'reload: sprint-out';
    else {
      ws.reloadEmpty = ws.mag === 0;
      ws.action = 'reload';
      ws.actionStart = t;
      const rd = reloadDuration(w, ws.mag, ws.reserve);
      ws.actionEnd = t + rd.time;
      ws.shellsPlanned = rd.shells;
      ws.shellsLoaded = 0;
      ws.adsToggle = false; // toggle ADS se po reloadu automaticky neobnoví
    }
  }

  // Sprint: vypne ADS; přebíjení pokračuje (zadání „Pohyb vojáků“ kap. 10 – sprint-reload povolen).
  // Po sprintu následuje sprint-out (jen když neběží jiná akce).
  if (ps.sprinting) {
    ws.adsToggle = false;
    ws.wasSprinting = true;
  } else if (ws.wasSprinting) {
    ws.wasSprinting = false;
    if (ws.action === 'idle') {
      ws.action = 'sprintOut';
      ws.actionStart = t;
      ws.actionEnd = t + w.sprintOutTime;
    }
  }

  // Blízká překážka před hlavní (z očí po směru zamíření).
  const eye = eyePosition(mv, ps);
  const aim = aimAngles(ps, ws);
  const aimDir = dirFromAngles(aim.yaw, aim.pitch);
  const near = ctx.phys.castRay(eye, aimDir, rig.obstacleReach);
  const nd = near ? near.distance : rig.obstacleReach;
  ws.obstruction = clamp((rig.obstacleReach - nd) / (rig.obstacleReach - rig.blockDistance), 0, 1);

  // ADS: záměr ukončí sprint; během reloadu/equip/žebříku/stažené zbraně ne.
  if (pressed(BTN.ADS)) ws.adsToggle = !ws.adsToggle;
  const adsBlocked = ws.action === 'reload' || ws.action === 'equip' || !!ps.ladder || ws.obstruction > 0.6;
  const adsWanted = ws.adsToggle && !ps.sprinting && !adsBlocked;
  const rate = adsWanted ? dt / CAMERA.adsInTime : -dt / CAMERA.adsOutTime;
  ws.adsProgress = clamp(ws.adsProgress + rate, 0, 1);
  ps.adsProgress = ws.adsProgress;
  // Požadavek ADS nebo střelby ukončí sprint (bez obnovování sprintu každým tickem).
  ps.weaponBlocksSprint = ws.adsToggle || held(BTN.FIRE);

  // Odeznívání penalizace střelby a recoilu.
  if (t - ws.lastShotAt > w.spread.firingRecoveryDelay) ws.firingPenalty = Math.max(0, ws.firingPenalty - w.spread.firingRecoveryDegPerSec * dt);
  if (t - ws.lastShotAt > w.recoil.recoveryDelay) {
    const maxStep = deg(w.recoil.recoveryDegPerSec) * dt;
    const mag = Math.hypot(ws.recoilPitch, ws.recoilYaw);
    if (mag <= maxStep) ws.recoilPitch = ws.recoilYaw = 0;
    else {
      ws.recoilPitch -= (ws.recoilPitch / mag) * maxStep;
      ws.recoilYaw -= (ws.recoilYaw / mag) * maxStep;
    }
  }

  // Střelba.
  const want = ws.mode === 'auto' ? held(BTN.FIRE) : pressed(BTN.FIRE);
  // Nabíjení po jednom přeruší stisk spouště, je-li v zásobníku náboj (po prázdné zbrani se ještě dopumpuje).
  if (want && single && ws.action === 'reload' && ws.mag > 0) {
    ws.action = 'idle';
    if (ws.reloadEmpty) ws.nextShotAt = Math.max(ws.nextShotAt, t + (w.chamberTime ?? 0));
  }
  if (want) {
    let reason = '';
    if (ps.ladder) reason = 'na žebříku';
    else if (ps.sprinting) reason = 'sprint';
    else if (ws.action === 'sprintOut') reason = 'sprint-out';
    else if (ws.action === 'reload') reason = 'přebíjení';
    else if (ws.action === 'equip') reason = 'tasení';
    else if (!ps.grounded) reason = 've vzduchu';
    else if (ws.mag <= 0) reason = 'prázdný zásobník';
    else if (ws.obstruction >= 1) reason = 'hlaveň blokovaná překážkou';
    else if (t < ws.nextShotAt - 1e-9) reason = 'kadence';
    if (reason) ws.blockReason = `střelba: ${reason}`;
    else {
      // Kadence přes časovou osu: neztrácet zlomky intervalu, ale nenahromadit dluh.
      if (t - ws.nextShotAt > w.fireInterval) ws.nextShotAt = t;
      const ps2 = fire(w, mv, ps, ws, ctx, rig, eye, aimDir, t);
      if (ps2.length) {
        out.push(...ps2);
        ws.nextShotAt += w.fireInterval;
      }
    }
  }
  // Recoil nesmí vytvořit skrytý dluh u limitu pitch.
  const lim = deg(CAMERA.pitchLimitDeg);
  if (ps.pitch + ws.recoilPitch > lim) ws.recoilPitch = Math.max(0, lim - ps.pitch);
  return out;
}

/**
 * Výstřel: povolení → rozptyl → směr a projektil(y) → odečet náboje → recoil a penalizace pro další ránu.
 * Brokovnice: jeden náboj = `pellets` projektilů v kuželu `pelletSpreadDeg` kolem směru výstřelu
 * (deterministicky ze seedu serveru, pořadí výstřelu a indexu broku).
 */
function fire(w: WeaponConfig, mv: MovementConfig, ps: PlayerState, ws: WeaponState, ctx: FireContext, rig: RigProfile, eye: V3, aimDir: V3, t: number): Projectile[] {
  // Herní ústí ze sdíleného profilu (bez kosmetiky); kontrola oči → ústí.
  const mv3 = muzzleView(rig, ws.adsProgress);
  const aim = aimAngles(ps, ws);
  const cy = Math.cos(aim.yaw), sy = Math.sin(aim.yaw), cp = Math.cos(aim.pitch), sp = Math.sin(aim.pitch);
  // Pohledová báze: right, up, forward(−Z).
  const right = { x: cy, y: 0, z: -sy };
  const fwd = aimDir;
  const up = { x: sy * sp, y: cp, z: cy * sp };
  const muzzle = {
    x: eye.x + right.x * mv3[0] + up.x * mv3[1] - fwd.x * mv3[2],
    y: eye.y + right.y * mv3[0] + up.y * mv3[1] - fwd.y * mv3[2],
    z: eye.z + right.z * mv3[0] + up.z * mv3[1] - fwd.z * mv3[2],
  };
  const em = { x: muzzle.x - eye.x, y: muzzle.y - eye.y, z: muzzle.z - eye.z };
  const emLen = Math.hypot(em.x, em.y, em.z);
  const block = ctx.phys.castRay(eye, { x: em.x / emLen, y: em.y / emLen, z: em.z / emLen }, emLen);
  if (block) {
    ws.blockReason = 'střelba: hlaveň za překážkou';
    return [];
  }
  // Bod zamíření kamery → směr z ústí k němu (blízký bod: nikdy neotočit směr).
  const hit = ctx.phys.castRay(eye, aimDir, 2000);
  const aimDist = hit ? hit.distance : 2000;
  const ap = { x: eye.x + aimDir.x * aimDist, y: eye.y + aimDir.y * aimDist, z: eye.z + aimDir.z * aimDist };
  let dir = { x: ap.x - muzzle.x, y: ap.y - muzzle.y, z: ap.z - muzzle.z };
  const dl = Math.hypot(dir.x, dir.y, dir.z);
  dir = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
  if (aimDist < 2 || dir.x * aimDir.x + dir.y * aimDir.y + dir.z * aimDir.z < 0.8) dir = aimDir;
  const spread = spreadOf(w, mv, ps, ws, t).total;
  ws.lastSpread = spread;
  const d = sampleCone(dir, spread, shotRandom(ctx.seed, ws.shotSeq, 0), shotRandom(ctx.seed, ws.shotSeq, 1));
  const n = Math.max(1, w.pellets ?? 1);
  const out: Projectile[] = [];
  for (let i = 0; i < n; i++) {
    const pd = n > 1 ? sampleCone(d, deg(w.pelletSpreadDeg ?? 0), shotRandom(ctx.seed, ws.shotSeq, 3 + 2 * i), shotRandom(ctx.seed, ws.shotSeq, 4 + 2 * i)) : d;
    out.push({
      key: n > 1 ? `${ctx.playerId}:${ctx.lifeId}:${ws.shotSeq}:${i}` : `${ctx.playerId}:${ctx.lifeId}:${ws.shotSeq}`,
      owner: ctx.playerId,
      team: ctx.team,
      origin: { ...muzzle },
      pos: { ...muzzle },
      vel: { x: pd.x * w.projectileSpeed, y: pd.y * w.projectileSpeed, z: pd.z * w.projectileSpeed },
      age: 0,
      rules: w,
      pellet: i,
    });
  }
  ws.mag--;
  ws.recoilPitch += deg(w.recoil.pitchDeg);
  ws.recoilYaw += deg(w.recoil.yawDeg) * (shotRandom(ctx.seed, ws.shotSeq, 2) * 2 - 1);
  ws.firingPenalty = Math.min(w.spread.firingMaxDeg, ws.firingPenalty + w.spread.perShotDeg);
  ws.lastShotAt = t;
  ws.shotSeq++;
  return out;
}
