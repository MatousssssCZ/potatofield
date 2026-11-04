import { BTN, type ButtonName, type InputFrame } from '../../shared/sim/input';

/**
 * Vstup hry. Klávesy se mapují podle fyzického `KeyboardEvent.code` (nezávisle
 * na rozložení); popisky se zobrazují podle aktuálního rozložení klávesnice.
 */
export type Action = ButtonName | 'FORWARD' | 'BACK' | 'LEFT' | 'RIGHT';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  FORWARD: ['KeyW'],
  BACK: ['KeyS'],
  LEFT: ['KeyA'],
  RIGHT: ['KeyD'],
  SPRINT: ['ShiftLeft'],
  JUMP: ['Space'],
  CROUCH: ['ControlLeft'],
  PRONE: ['KeyZ'],
  FIRE: ['Mouse0'],
  ADS: ['Mouse2'],
  RELOAD: ['KeyR'],
  SLOT3: ['Digit3'],
  MODE: ['KeyB'],
  USE: ['KeyE'],
};

export const ACTION_LABELS: Record<Action, string> = {
  FORWARD: 'Vpřed',
  BACK: 'Vzad',
  LEFT: 'Vlevo',
  RIGHT: 'Vpravo',
  SPRINT: 'Sprint',
  JUMP: 'Skok',
  CROUCH: 'Dřep',
  PRONE: 'Leh (přepnout)',
  FIRE: 'Střelba',
  ADS: 'Míření',
  RELOAD: 'Přebití',
  SLOT3: 'Primární zbraň / režim',
  MODE: 'Režim střelby',
  USE: 'Použít (žebřík)',
};

export interface InputSettings {
  sensitivity: number;
  invertY: boolean;
  crouchToggle: boolean;
}

/** Akumulátor pohybu myši: úhel je součet přírůstků, nezávislý na FPS (bez násobení dt). */
export class LookAccumulator {
  dyaw = 0;
  dpitch = 0;
  add(dx: number, dy: number, radPerCount: number, invertY: boolean) {
    this.dyaw -= dx * radPerCount;
    this.dpitch -= dy * radPerCount * (invertY ? -1 : 1);
  }
  take(): [number, number] {
    const r: [number, number] = [this.dyaw, this.dpitch];
    this.dyaw = 0;
    this.dpitch = 0;
    return r;
  }
}

export class InputSystem {
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  settings: InputSettings = { sensitivity: 1, invertY: false, crouchToggle: false };
  private held = new Set<string>();
  private pressedCodes = new Set<string>();
  readonly look = new LookAccumulator();
  /** Pohled zobrazený v renderu ještě před spotřebováním tickem (nulová latence myši). */
  pendingYaw = 0;
  pendingPitch = 0;
  private crouchLatched = false;
  private seq = 0;
  locked = false;
  radPerCount = 0.0022;
  adsSensScale = 1;
  onLockChange: (locked: boolean) => void = () => {};
  onMenuKey: () => void = () => {};
  onDevKey: () => void = () => {};
  /** Klávesy týmového UI (chat, rádio, rozkazy, četa, skóre) – nejsou bojové akce. */
  onUiKey: (code: string, down: boolean) => boolean = () => false;
  /** Dočasné potlačení střelby (otevřené rádiové kolo – klik potvrzuje povel). */
  suppressFire = false;
  /** Pohyb myši při otevřeném kole (místo otáčení pohledu). */
  onUiMouse: ((dx: number, dy: number) => void) | null = null;
  onUiClick: (() => void) | null = null;
  private layout: Map<string, string> | null = null;
  private listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [];

  constructor(private canvas: HTMLElement) {}

  attach() {
    this.detach();
    const on = (t: EventTarget, ev: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn, opts);
      this.listeners.push([t, ev, fn, opts]);
    };
    on(window, 'keydown', ((e: KeyboardEvent) => this.keyDown(e)) as EventListener);
    on(window, 'keyup', ((e: KeyboardEvent) => this.keyUp(e)) as EventListener);
    on(window, 'mousedown', ((e: MouseEvent) => this.mouse(e, true)) as EventListener);
    on(window, 'mouseup', ((e: MouseEvent) => this.mouse(e, false)) as EventListener);
    on(window, 'mousemove', ((e: MouseEvent) => this.mouseMove(e)) as EventListener);
    on(window, 'blur', () => this.clear());
    on(document, 'visibilitychange', () => this.clear());
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.clear();
      this.onLockChange(this.locked);
    });
    on(this.canvas, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    kb?.getLayoutMap?.().then((m) => (this.layout = m)).catch(() => {});
  }

  detach() {
    for (const [t, ev, fn, opts] of this.listeners) t.removeEventListener(ev, fn, opts);
    this.listeners = [];
    this.clear();
  }

  get listenerCount() {
    return this.listeners.length;
  }

  requestLock() {
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    // Některé prohlížeče unadjustedMovement nepodporují → zkusit znovu bez něj.
    p?.catch?.(() => this.canvas.requestPointerLock());
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Vyčistí držené vstupy (blur, ztráta zámku, smrt). Další střelba vyžaduje nový stisk. */
  clear() {
    this.held.clear();
    this.pressedCodes.clear();
    this.look.take();
    this.pendingYaw = this.pendingPitch = 0;
    this.crouchLatched = false;
  }

  private typing(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private keyDown(e: KeyboardEvent) {
    if (this.typing(e)) return; // psaní nikdy nespouští herní akce
    if (e.code === 'F3' || e.code === 'Backquote') {
      e.preventDefault();
      if (!e.repeat) this.onDevKey();
      return;
    }
    if (!this.locked) return;
    if (e.code === 'Escape') {
      this.onMenuKey();
      return;
    }
    if (!e.repeat && this.onUiKey(e.code, true)) {
      e.preventDefault();
      return;
    }
    if (this.isBound(e.code)) e.preventDefault();
    if (e.repeat) return; // key repeat netvoří nové stisky
    this.held.add(e.code);
    this.pressedCodes.add(e.code);
  }

  private keyUp(e: KeyboardEvent) {
    this.held.delete(e.code);
    if (this.locked) this.onUiKey(e.code, false);
  }

  private mouse(e: MouseEvent, down: boolean) {
    const code = `Mouse${e.button}`;
    if (!down) {
      this.held.delete(code);
      return;
    }
    // Klik, kterým se zámek teprve získává, není výstřel.
    if (!this.locked) return;
    if (this.onUiClick && e.button === 0) {
      this.onUiClick();
      return;
    }
    this.held.add(code);
    this.pressedCodes.add(code);
  }

  private mouseMove(e: MouseEvent) {
    if (!this.locked) return;
    if (this.onUiMouse) {
      this.onUiMouse(e.movementX, e.movementY);
      return;
    }
    const k = this.radPerCount * this.settings.sensitivity * this.adsSensScale;
    this.look.add(e.movementX, e.movementY, k, this.settings.invertY);
    this.pendingYaw = this.look.dyaw;
    this.pendingPitch = this.look.dpitch;
  }

  private isBound(code: string) {
    for (const k in this.bindings) if (this.bindings[k as Action].includes(code)) return true;
    return false;
  }

  private act(a: Action, set: Set<string>) {
    return this.bindings[a].some((c) => set.has(c));
  }

  /** Sestaví vstup jednoho ticku a spotřebuje stisky a pohyb myši. */
  consumeTick(tick: number): InputFrame {
    let held = 0, pressed = 0;
    for (const k of Object.keys(BTN) as ButtonName[]) {
      if (this.act(k, this.held)) held |= BTN[k];
      if (this.act(k, this.pressedCodes)) pressed |= BTN[k];
    }
    if (this.settings.crouchToggle) {
      if (pressed & BTN.CROUCH) this.crouchLatched = !this.crouchLatched;
      if (pressed & (BTN.JUMP | BTN.PRONE)) this.crouchLatched = false;
      held = this.crouchLatched ? held | BTN.CROUCH : held & ~BTN.CROUCH;
    }
    if (this.suppressFire) {
      held &= ~BTN.FIRE;
      pressed &= ~BTN.FIRE;
    }
    const [dyaw, dpitch] = this.look.take();
    this.pendingYaw = this.pendingPitch = 0;
    this.pressedCodes.clear();
    return {
      seq: ++this.seq,
      tick,
      moveX: (this.act('RIGHT', this.held) ? 1 : 0) - (this.act('LEFT', this.held) ? 1 : 0),
      moveZ: (this.act('FORWARD', this.held) ? 1 : 0) - (this.act('BACK', this.held) ? 1 : 0),
      lookDYaw: dyaw,
      lookDPitch: dpitch,
      held,
      pressed,
    };
  }

  /** Popisek klávesy podle aktuálního rozložení (např. KeyZ → „Y“ na QWERTZ). */
  keyLabel(code: string): string {
    if (code.startsWith('Mouse')) return ['LMB', 'Kolečko', 'RMB', 'Myš 4', 'Myš 5'][Number(code.slice(5))] ?? code;
    const fromLayout = this.layout?.get(code);
    if (fromLayout) return fromLayout.toUpperCase();
    const special: Record<string, string> = {
      Space: 'Mezerník',
      ShiftLeft: 'L Shift',
      ControlLeft: 'L Ctrl',
      Escape: 'Esc',
      Backquote: ';',
    };
    if (special[code]) return special[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }
}
