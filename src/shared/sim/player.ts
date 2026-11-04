import type RAPIER from '@dimforge/rapier3d-compat';
import { deg, jumpVelocity, type MovementConfig, type Stance } from '../config/movement';
import { clamp, quatFromEuler, quatMul, quatYaw, angleDiff, type V3 } from '../math';
import { MOVE_QUERY_GROUPS, type PhysicsWorld } from '../physics/world';
import { BTN, type InputFrame } from './input';
import type { LadderDef } from '../../world/parts';

export const LADDER = { speed: 2.2, reach: 0.95, exitForward: 0.6, detachPush: 1.6 } as const;

/**
 * Stav pěšáka. Čistá data (kopírovatelná pro rollback/replay a síť).
 * Postoj, pohyb a výdrž jsou oddělené části stavu, ne jeden enum kombinací.
 */
export interface PlayerState {
  tick: number;
  /** Poloha chodidel (střed podstavy těla). */
  pos: V3;
  vel: V3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  /** Postoj, do kterého tělo směřuje (nebo v něm je). */
  stance: Stance;
  /** Aktuální výška těla – interpolovaná při přechodu. Řídí collider, hitbox i oči. */
  height: number;
  /** Záměr hráče: přepínač lehu (Z). */
  proneToggle: boolean;
  /** Mezerník při dřepu zrušil držený dřep až do puštění Ctrl. */
  crouchSuppressed: boolean;
  /** Natočení ležícího těla (může zaostávat za pohledem). */
  bodyYaw: number;
  stamina: number;
  staminaRegenAt: number;
  sprintLocked: boolean;
  sprinting: boolean;
  lastJumpAt: number;
  lastLandAt: number;
  /** Horizontální rychlost při odrazu (strop pro vzdušné řízení). */
  takeoffSpeed: number;
  /** Rychlost dopadu posledního přistání (pro kosmetický kick kamery). */
  lastLandSpeed: number;
  /** ADS průběh 0–1 (nastavuje zbraňový systém; zde jen čten). */
  adsProgress: number;
  /** Zbraň blokuje sprint (požadavek ADS/střelby). */
  weaponBlocksSprint: boolean;
  /** Důvody blokace pro debug panel. */
  blocked: string[];
  /** ID žebříku, na kterém hráč visí (null = nelezé). */
  ladder: string | null;
}

export function createPlayerState(cfg: MovementConfig, pos: V3, yaw = 0): PlayerState {
  return {
    tick: 0,
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    grounded: false,
    stance: 'stand',
    height: cfg.stances.stand.height,
    proneToggle: false,
    crouchSuppressed: false,
    bodyYaw: yaw,
    stamina: cfg.stamina.max,
    staminaRegenAt: 0,
    sprintLocked: false,
    sprinting: false,
    lastJumpAt: -1e9,
    lastLandAt: -1e9,
    takeoffSpeed: 0,
    lastLandSpeed: 0,
    adsProgress: 0,
    weaponBlocksSprint: false,
    blocked: [],
    ladder: null,
  };
}

export function clonePlayerState(s: PlayerState): PlayerState {
  return { ...s, pos: { ...s.pos }, vel: { ...s.vel }, blocked: [...s.blocked] };
}

/** Výška očí odvozená ze stejného průběhu výšky těla (žádné zvláštní časování kamery). */
export function eyeHeightFor(cfg: MovementConfig, height: number): number {
  const st = cfg.stances;
  // Lineárně mezi definovanými postoji podle výšky těla.
  if (height >= st.crouch.height) {
    const t = (height - st.crouch.height) / (st.stand.height - st.crouch.height);
    return st.crouch.eyeHeight + (st.stand.eyeHeight - st.crouch.eyeHeight) * t;
  }
  const t = (height - st.prone.height) / (st.crouch.height - st.prone.height);
  return st.prone.eyeHeight + (st.crouch.eyeHeight - st.prone.eyeHeight) * clamp(t, 0, 1);
}

/** Poloha očí (herní, bez kosmetického bobu). */
export function eyePosition(cfg: MovementConfig, s: PlayerState): V3 {
  const eh = eyeHeightFor(cfg, s.height);
  // V lehu jsou oči vpředu na hlavě, ne nad středem těla.
  const proneT = clamp((cfg.stances.crouch.height - s.height) / (cfg.stances.crouch.height - cfg.stances.prone.height), 0, 1);
  const fwd = cfg.proneEyeForward * proneT;
  return {
    x: s.pos.x - Math.sin(s.bodyYaw) * fwd,
    y: s.pos.y + eh,
    z: s.pos.z - Math.cos(s.bodyYaw) * fwd,
  };
}

export const forwardOf = (yaw: number): V3 => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
export const rightOf = (yaw: number): V3 => ({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });

/** Je výška těla v rozsahu, kdy se používá ležící (vodorovný) objem? */
const isProneShape = (cfg: MovementConfig, height: number) => height <= cfg.stances.prone.height + 1e-6;

/**
 * Kinematický controller jednoho hráče: drží Rapier collider a KCC,
 * stav je v `PlayerState`. Stejná třída běží v prohlížeči i na serveru.
 */
export class PlayerController {
  readonly cfg: MovementConfig;
  readonly phys: PhysicsWorld;
  readonly collider: RAPIER.Collider;
  private kcc: RAPIER.KinematicCharacterController;
  private shapeKey = '';
  /** Žebříky mapy (odvozené z dat mapy, stejné pro klienta i server). */
  ladders: LadderDef[] = [];

  constructor(phys: PhysicsWorld, cfg: MovementConfig) {
    this.cfg = cfg;
    this.phys = phys;
    const R = phys.R;
    // Collider hráče sám nikoho neblokuje (členství PLAYER, prázdný filtr) – pohyb řeší KCC dotazy.
    const desc = R.ColliderDesc.capsule(cfg.stances.stand.height / 2 - cfg.radius, cfg.radius).setCollisionGroups((0x0004 << 16) | 0);
    this.collider = phys.world.createCollider(desc);
    this.kcc = phys.world.createCharacterController(cfg.skinWidth);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setSlideEnabled(true);
    this.kcc.setMaxSlopeClimbAngle(deg(cfg.maxWalkSlopeDeg));
    this.kcc.setMinSlopeSlideAngle(deg(cfg.maxWalkSlopeDeg + 1));
    // Mez schodu: o tloušťku "skinu" víc, aby přesně 0,30 m prošlo (ověřeno testem).
    this.kcc.enableAutostep(cfg.stepHeight + cfg.skinWidth, 0.15, false);
    this.kcc.enableSnapToGround(0.25);
    this.kcc.setApplyImpulsesToDynamicBodies(false);
  }

  dispose() {
    this.phys.world.removeCharacterController(this.kcc);
    this.phys.world.removeCollider(this.collider, false);
  }

  /** Tvar a poloha collideru pro danou výšku/natočení těla (svislá kapsle nebo ležící objem). */
  private bodyPose(height: number, bodyYaw: number, feet: V3) {
    const cfg = this.cfg;
    if (isProneShape(cfg, height)) {
      const r = cfg.proneRadius;
      const half = cfg.proneLength / 2 - r;
      // Kapsle (osa Y) sklopená do vodorovné polohy a natočená podle těla.
      const rot = quatMul(quatYaw(bodyYaw), quatFromEuler(Math.PI / 2, 0, 0));
      return { key: `p`, half, r, pos: { x: feet.x, y: feet.y + r + cfg.skinWidth, z: feet.z }, rot };
    }
    const r = Math.min(cfg.radius, height / 2);
    const half = Math.max(0, height / 2 - r);
    return { key: `s${height.toFixed(4)}`, half, r, pos: { x: feet.x, y: feet.y + height / 2 + cfg.skinWidth, z: feet.z }, rot: { x: 0, y: 0, z: 0, w: 1 } };
  }

  /** Vejde se tělo dané výšky na toto místo? */
  fits(height: number, bodyYaw: number, feet: V3): boolean {
    const p = this.bodyPose(height, bodyYaw, feet);
    const lift = 0.01; // malá rezerva nad podlahou, aby kontakt se zemí nebyl kolize
    const shape = new this.phys.R.Capsule(p.half, p.r - 0.005);
    return !this.phys.shapeBlocked(shape, { x: p.pos.x, y: p.pos.y + lift, z: p.pos.z }, p.rot, this.collider);
  }

  private applyPose(s: PlayerState) {
    const p = this.bodyPose(s.height, s.bodyYaw, s.pos);
    if (p.key !== this.shapeKey) {
      this.collider.setShape(new this.phys.R.Capsule(p.half, p.r));
      this.shapeKey = p.key;
    }
    this.collider.setTranslation(p.pos);
    this.collider.setRotation(p.rot);
  }

  /**
   * Vlastní sonda země: krátký sweep těla dolů. Pochozí jen plocha se sklonem do limitu.
   * (Rapier s FIX_INTERNAL_EDGES na výškovém poli kontakt se zemí sám nehlásí.)
   */
  probeGround(s: PlayerState): boolean {
    const p = this.bodyPose(s.height, s.bodyYaw, s.pos);
    const shape = new this.phys.R.Capsule(p.half, p.r);
    const hit = this.phys.world.castShape(
      p.pos,
      p.rot,
      { x: 0, y: -1, z: 0 },
      shape,
      0,
      this.cfg.skinWidth + 0.03,
      true,
      undefined,
      MOVE_QUERY_GROUPS,
      this.collider,
    );
    if (!hit) return false;
    return hit.normal1.y >= Math.cos(deg(this.cfg.maxWalkSlopeDeg)) - 1e-3;
  }

  /** Bod, kde lezec stojí (před žebříkem) ve výšce chodidel y. */
  private ladderPoint(L: LadderDef, y: number): V3 {
    return { x: L.base.x - L.facing.x * L.climbOffset, y, z: L.base.z - L.facing.z * L.climbOffset };
  }

  /**
   * Lezení: E nastoupí (zespodu i shora), W/S nahoru/dolů, Space pustí.
   * Vrací true, pokud tento tick obsloužil žebřík (normální pohyb se přeskočí).
   */
  private stepLadder(s: PlayerState, input: InputFrame, t: number, dt: number): boolean {
    const cfg = this.cfg;
    const standH = cfg.stances.stand.height;
    const pressed = (b: number) => (input.pressed & b) !== 0;
    if (!s.ladder) {
      // Nástup: dosah k bodu před žebříkem a pohled zhruba k žebříku.
      const fw = forwardOf(s.yaw);
      for (const L of this.ladders) {
        const top = L.base.y + L.height;
        const front = this.ladderPoint(L, s.pos.y);
        const dist = Math.hypot(front.x - s.pos.x, front.z - s.pos.z);
        const facingDot = fw.x * L.facing.x + fw.z * L.facing.z;
        if (dist < LADDER.reach && s.pos.y >= L.base.y - 0.4 && s.pos.y <= top - 0.6 && facingDot > 0.2) {
          if (!this.fits(standH, s.yaw, front)) {
            s.blocked.push('žebřík: není místo');
            return false;
          }
          s.ladder = L.id;
          s.pos = front;
          break;
        }
        // Nástup shora: hráč stojí na hraně nad žebříkem a dívá se ven (k lezci).
        const topPt = { x: L.base.x + L.facing.x * LADDER.exitForward, z: L.base.z + L.facing.z * LADDER.exitForward };
        if (Math.hypot(topPt.x - s.pos.x, topPt.z - s.pos.z) < LADDER.reach && Math.abs(s.pos.y - top) < 0.45 && facingDot < -0.2) {
          const p = this.ladderPoint(L, top - standH + 0.3);
          if (!this.fits(standH, s.yaw, p)) {
            s.blocked.push('žebřík: není místo pro sestup');
            return false;
          }
          s.ladder = L.id;
          s.pos = p;
          break;
        }
      }
      if (!s.ladder) return false;
      s.vel = { x: 0, y: 0, z: 0 };
      s.stance = 'stand';
      s.height = standH;
      s.proneToggle = false;
      s.sprinting = false;
      s.grounded = false;
      this.applyPose(s);
      return true;
    }
    const L = this.ladders.find((l) => l.id === s.ladder);
    if (!L) {
      s.ladder = null;
      return false;
    }
    s.sprinting = false;
    s.blocked.push('na žebříku: bez střelby a míření');
    if (pressed(BTN.JUMP)) {
      // Pustit se: malý odraz od žebříku, dál běžná fyzika.
      s.ladder = null;
      s.vel = { x: -L.facing.x * LADDER.detachPush, y: 0, z: -L.facing.z * LADDER.detachPush };
      s.takeoffSpeed = LADDER.detachPush;
      s.grounded = false;
      return false;
    }
    const top = L.base.y + L.height;
    const climb = Math.max(-1, Math.min(1, input.moveZ)) * LADDER.speed * dt;
    let y = s.pos.y + climb;
    if (input.moveZ > 0 && y >= top - 0.25) {
      // Výstup nahoře: jen když se tělo vejde – jinak zůstat (neprojít zdí ani stropem).
      const exit = { x: L.base.x + L.facing.x * LADDER.exitForward, y: top + 0.02, z: L.base.z + L.facing.z * LADDER.exitForward };
      if (this.fits(standH, s.yaw, exit)) {
        s.ladder = null;
        s.pos = exit;
        s.vel = { x: 0, y: 0, z: 0 };
        s.grounded = false;
        this.applyPose(s);
        return true;
      }
      s.blocked.push('žebřík: výstup blokován');
      y = Math.min(y, top - 0.25);
    }
    if (y <= L.base.y) {
      y = L.base.y;
      if (input.moveZ < 0) {
        s.ladder = null;
        s.pos = this.ladderPoint(L, y);
        this.applyPose(s);
        return true;
      }
    }
    const next = this.ladderPoint(L, y);
    if (this.fits(standH, s.yaw, next)) s.pos = next;
    else s.blocked.push('žebřík: překážka');
    s.vel = { x: 0, y: climb / dt, z: 0 };
    s.grounded = false;
    // Výdrž se na žebříku obnovuje normálně.
    if (t >= s.staminaRegenAt) s.stamina = Math.min(cfg.stamina.max, s.stamina + cfg.stamina.regenPerSec * dt);
    this.applyPose(s);
    return true;
  }

  /** Umístí hráče (spawn/teleport) a vynuluje dynamiku. */
  place(s: PlayerState, feet: V3, yaw: number) {
    s.ladder = null;
    s.pos = { ...feet };
    s.vel = { x: 0, y: 0, z: 0 };
    s.yaw = yaw;
    s.bodyYaw = yaw;
    s.pitch = 0;
    s.grounded = false;
    this.applyPose(s);
  }

  /** Jeden simulační krok. Výsledek nezávisí na renderovacím FPS. */
  step(s: PlayerState, input: InputFrame) {
    const cfg = this.cfg;
    const dt = 1 / cfg.tickRate;
    const t = s.tick * dt;
    s.blocked = [];
    const held = (b: number) => (input.held & b) !== 0;
    const pressed = (b: number) => (input.pressed & b) !== 0;

    // --- Pohled ---
    s.yaw = (s.yaw + input.lookDYaw) % (Math.PI * 2);
    const pl = deg(89);
    s.pitch = clamp(s.pitch + input.lookDPitch, -pl, pl);

    // --- Žebřík (sdílený stav pohybu, žádný teleport editoru) ---
    if (s.ladder || pressed(BTN.USE)) {
      if (this.stepLadder(s, input, t, dt)) {
        s.tick++;
        return;
      }
    }

    // --- Záměr postoje ---
    let jumpConsumed = false;
    if (!held(BTN.CROUCH)) s.crouchSuppressed = false;
    if (pressed(BTN.PRONE)) s.proneToggle = !s.proneToggle;
    if (pressed(BTN.CROUCH) && s.proneToggle) s.proneToggle = false; // Ctrl z lehu = dřep
    if (pressed(BTN.JUMP) && (s.stance !== 'stand' || s.height < cfg.stances.stand.height - 1e-6)) {
      // Space ve dřepu/lehu jen požádá o stoj; tentýž stisk neskáče.
      s.proneToggle = false;
      if (held(BTN.CROUCH)) s.crouchSuppressed = true;
      jumpConsumed = true;
    }
    const wanted: Stance = s.proneToggle ? 'prone' : held(BTN.CROUCH) && !s.crouchSuppressed ? 'crouch' : 'stand';

    if (wanted !== s.stance) {
      const order = { prone: 0, crouch: 1, stand: 2 } as const;
      if (wanted === 'prone') {
        if (!s.grounded) {
          s.blocked.push('leh: ve vzduchu');
        } else if (t - s.lastLandAt < cfg.proneAfterLanding) {
          s.blocked.push(`leh: blokace po dopadu (${(cfg.proneAfterLanding - (t - s.lastLandAt)).toFixed(2)} s)`);
        } else if (!this.fits(cfg.stances.prone.height, s.yaw, s.pos)) {
          s.blocked.push('leh: tělo se nevejde');
        } else {
          s.stance = 'prone';
          s.bodyYaw = s.yaw;
        }
      } else if (order[wanted] > order[s.stance]) {
        // Zvětšení těla: nejdřív test prostoru pro cílový postoj.
        const tryStances: Stance[] = wanted === 'stand' ? ['stand', 'crouch'] : ['crouch'];
        let done = false;
        for (const st of tryStances) {
          if (order[st] <= order[s.stance]) break;
          if (this.fits(cfg.stances[st].height, s.bodyYaw, s.pos)) {
            s.stance = st;
            done = true;
            break;
          }
          s.blocked.push(`${st === 'stand' ? 'stoj' : 'dřep'}: nad hlavou není místo`);
        }
        if (!done && wanted === 'stand' && s.stance === 'prone' && !s.proneToggle) {
          /* zůstává v lehu, dokud se neuvolní prostor */
        }
      } else {
        s.stance = wanted; // zmenšení je vždy možné
      }
    }

    // --- Průběh výšky těla (collider, hitbox i oči sdílí tento průběh) ---
    const targetH = cfg.stances[s.stance].height;
    if (Math.abs(s.height - targetH) > 1e-6) {
      const from = s.height;
      // Leh: celý rozsah stoj→leh za `prone.transition`; jinak rychlost stoj↔dřep.
      const st = cfg.stances;
      const rate =
        s.stance === 'prone'
          ? (st.stand.height - st.prone.height) / st.prone.transition
          : (st.stand.height - st.crouch.height) / st.crouch.transition;
      let next = from + Math.sign(targetH - from) * rate * dt;
      if ((targetH - from) * (targetH - next) <= 0) next = targetH;
      if (next > from && !this.fits(next, s.bodyYaw, s.pos)) {
        // Během přechodu vstoupil pod překážku: vrátit cíl na nižší postoj.
        s.blocked.push('přechod postoje zastaven překážkou');
        s.stance = from <= cfg.stances.crouch.height ? (from <= cfg.stances.prone.height ? 'prone' : 'crouch') : 'crouch';
        if (s.stance === 'crouch' && from < cfg.stances.crouch.height && !this.fits(cfg.stances.crouch.height, s.bodyYaw, s.pos)) {
          s.stance = 'prone';
        }
      } else {
        // Do ležícího objemu přejít jen když se vejde v aktuálním natočení.
        if (isProneShape(cfg, next) && !isProneShape(cfg, from) && !this.fits(next, s.bodyYaw, s.pos)) {
          s.blocked.push('leh: tělo se nevejde');
          s.stance = 'crouch';
          s.proneToggle = false;
        } else {
          s.height = next;
        }
      }
    }

    // --- Natočení ležícího těla (nohy nesmí projít zdí) ---
    if (isProneShape(cfg, s.height)) {
      const d = angleDiff(s.yaw, s.bodyYaw);
      const maxTurn = cfg.proneTurnRate * dt;
      const turn = clamp(d, -maxTurn, maxTurn);
      if (Math.abs(turn) > 1e-6) {
        const ny = s.bodyYaw + turn;
        if (this.fits(s.height, ny, s.pos)) s.bodyYaw = ny;
        else s.blocked.push('leh: otočení těla blokuje překážka');
      }
    } else {
      s.bodyYaw = s.yaw;
    }

    // --- Požadovaná rychlost ---
    let mx = input.moveX, mz = input.moveZ;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    const standing = s.stance === 'stand' && s.height >= cfg.stances.stand.height - 1e-6;
    if (s.sprintLocked && s.stamina >= cfg.stamina.sprintRestartThreshold) s.sprintLocked = false;
    let sprint = false;
    if (held(BTN.SPRINT)) {
      if (mz <= 0) s.blocked.push('sprint: jen vpřed');
      else if (!standing) s.blocked.push('sprint: jen ve stoje');
      else if (!s.grounded) s.blocked.push('sprint: ve vzduchu');
      else if (s.sprintLocked || s.stamina <= 0) s.blocked.push('sprint: vyčerpaná výdrž');
      else if (s.weaponBlocksSprint) s.blocked.push('sprint: akce zbraně');
      else sprint = true;
    }
    s.sprinting = sprint;

    let lx: number, lz: number;
    if (sprint) {
      // Celý vektor omezen sprintem (diagonála nepřekročí 6 m/s).
      lx = mx * cfg.speedSprint;
      lz = mz * cfg.speedSprint;
    } else {
      const stanceScale = cfg.stances[s.stance === 'stand' && !standing ? 'crouch' : s.stance].speed / cfg.stances.stand.speed;
      const ads = 1 + (cfg.adsSpeedMultiplier - 1) * s.adsProgress;
      const k = stanceScale * ads;
      lx = mx * cfg.speedForward * k;
      lz = mz * (mz >= 0 ? cfg.speedForward : cfg.speedBack) * k;
    }
    const fw = forwardOf(s.yaw), rt = rightOf(s.yaw);
    const tvx = rt.x * lx + fw.x * lz;
    const tvz = rt.z * lx + fw.z * lz;

    if (s.grounded) {
      const wish = Math.hypot(tvx, tvz) > 1e-4;
      const rate = (wish ? cfg.groundAccel : cfg.groundDecel) * dt;
      const dvx = tvx - s.vel.x, dvz = tvz - s.vel.z;
      const dl = Math.hypot(dvx, dvz);
      if (dl <= rate) {
        s.vel.x = tvx;
        s.vel.z = tvz;
      } else {
        s.vel.x += (dvx / dl) * rate;
        s.vel.z += (dvz / dl) * rate;
      }
    } else if (Math.hypot(tvx, tvz) > 1e-4) {
      const rate = cfg.groundAccel * cfg.airControl * dt;
      const dvx = tvx - s.vel.x, dvz = tvz - s.vel.z;
      const dl = Math.hypot(dvx, dvz);
      const k = dl <= rate ? 1 : rate / dl;
      s.vel.x += dvx * k;
      s.vel.z += dvz * k;
      // Vzdušné řízení nesmí zvýšit rychlost nad odraz / běžný limit.
      const cap = Math.max(s.takeoffSpeed, cfg.speedForward);
      const hs = Math.hypot(s.vel.x, s.vel.z);
      if (hs > cap) {
        s.vel.x *= cap / hs;
        s.vel.z *= cap / hs;
      }
    }

    // --- Skok ---
    if (pressed(BTN.JUMP) && !jumpConsumed) {
      if (!s.grounded) s.blocked.push('skok: ve vzduchu');
      else if (t - s.lastJumpAt < cfg.jumpMinInterval) s.blocked.push('skok: interval');
      else if (!this.fits(cfg.stances.stand.height + 0.05, s.bodyYaw, s.pos)) s.blocked.push('skok: strop');
      else {
        s.vel.y = jumpVelocity(cfg);
        s.lastJumpAt = t;
        s.grounded = false;
        s.takeoffSpeed = Math.hypot(s.vel.x, s.vel.z);
        s.stamina = Math.max(0, s.stamina - cfg.stamina.jumpCost);
        s.staminaRegenAt = Math.max(s.staminaRegenAt, t + cfg.stamina.regenDelayAfterJump);
      }
    }

    // --- Výdrž ---
    if (sprint) {
      s.stamina -= cfg.stamina.sprintDrainPerSec * dt;
      s.staminaRegenAt = Math.max(s.staminaRegenAt, t + cfg.stamina.regenDelayAfterSprint);
      if (s.stamina <= 1e-9) {
        s.stamina = 0;
        s.sprintLocked = true;
      }
    } else if (t >= s.staminaRegenAt) {
      s.stamina = Math.min(cfg.stamina.max, s.stamina + cfg.stamina.regenPerSec * dt);
    }

    // --- Gravitace a pohyb přes sweep-and-slide ---
    // Přesná integrace konstantního zrychlení: vrchol skoku nezávisí na délce kroku.
    let dy: number;
    if (!s.grounded) {
      dy = s.vel.y * dt - 0.5 * cfg.gravity * dt * dt;
      s.vel.y -= cfg.gravity * dt;
    } else {
      // Na zemi bez svislé složky (ta by Rapieru ubírala vodorovnou dráhu); kontakt drží snap-to-ground.
      s.vel.y = Math.min(s.vel.y, 0);
      dy = 0;
    }
    const desired = { x: s.vel.x * dt, y: dy, z: s.vel.z * dt };

    this.applyPose(s);
    if (s.grounded && s.vel.y <= 0) this.kcc.enableSnapToGround(0.25);
    else this.kcc.disableSnapToGround();
    this.phys.sync();
    this.kcc.computeColliderMovement(this.collider, desired, undefined, MOVE_QUERY_GROUPS);
    const mv = this.kcc.computedMovement();
    const wasGrounded = s.grounded;
    const vyBefore = s.vel.y;
    s.pos = { x: s.pos.x + mv.x, y: s.pos.y + mv.y, z: s.pos.z + mv.z };
    this.applyPose(s);

    const groundedNow = s.vel.y <= 0 && (this.kcc.computedGrounded() || this.probeGround(s));
    // Náraz do stropu zastaví stoupání.
    if (s.vel.y > 0 && mv.y < desired.y - 1e-5) s.vel.y = 0;
    // Stěna ořízne složku rychlosti do stěny (žádné nahromadění hybnosti, klouzání podél zdi zůstává).
    // Svahy a zdolané schody rychlost neořezávají.
    const dh = Math.hypot(desired.x, desired.z);
    const mh = Math.hypot(mv.x, mv.z);
    if (mh < dh - 1e-5) {
      const walkCos = Math.cos(deg(cfg.maxWalkSlopeDeg));
      for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
        const c = this.kcc.computedCollision(i);
        if (!c) continue;
        const n = c.normal1;
        if (n.y >= walkCos) continue;
        // Kontakt v dosahu schodu není zeď – autostep ho musí mít šanci zdolat.
        if (c.witness1.y - s.pos.y <= cfg.stepHeight + cfg.skinWidth) continue;
        const nl = Math.hypot(n.x, n.z);
        if (nl < 1e-6) continue;
        const nx = n.x / nl, nz = n.z / nl;
        const into = s.vel.x * nx + s.vel.z * nz;
        if (into < 0) {
          s.vel.x -= nx * into;
          s.vel.z -= nz * into;
        }
      }
    }
    if (groundedNow) {
      if (!wasGrounded) {
        s.lastLandAt = t;
        s.lastLandSpeed = -vyBefore;
      }
      s.vel.y = 0;
    }
    s.grounded = groundedNow;
    s.tick++;
  }
}
