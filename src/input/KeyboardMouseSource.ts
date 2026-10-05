import type { ButtonAction, ControllerKind, InputSource, RawInputSample } from './types';

/** `KeyboardEvent.code` → actions. */
const KEY_BINDINGS: Readonly<Record<string, readonly ButtonAction[]>> = {
  Space: ['jump'],
  ShiftLeft: ['sprint'],
  ShiftRight: ['sprint'],
  KeyE: ['interact'],
  ControlLeft: ['dodge'],
  ControlRight: ['dodge'],
  AltLeft: ['dodge'],
  AltRight: ['dodge'],
  Tab: ['inventory'],
  KeyI: ['inventory'],
  Escape: ['pause'],
  KeyQ: ['cameraReset'],
  ArrowUp: ['menuUp'],
  ArrowDown: ['menuDown'],
  ArrowLeft: ['menuLeft'],
  ArrowRight: ['menuRight'],
  Enter: ['menuConfirm'],
  Backspace: ['menuCancel'],
};

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

const MOUSE_BUTTON_PRIMARY = 0;
const MOUSE_BUTTON_SECONDARY = 2;

/**
 * Keyboard + mouse source. WASD moves, the mouse looks while the pointer is locked
 * (click the canvas to lock, Esc releases).
 */
export class KeyboardMouseSource implements InputSource {
  readonly kind: ControllerKind = 'keyboard';
  private readonly keys = new Set<string>();
  private readonly mouseButtons = new Set<number>();
  private mouseDx = 0;
  private mouseDy = 0;
  private activity = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    element.addEventListener('mousedown', this.handleMouseDown);
    element.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousemove', this.handleMouseMove);
  }

  /** True while the pointer is locked to the game canvas. */
  get isPointerLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  sample(out: RawInputSample): boolean {
    const keys = this.keys;
    const x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const y = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    out.move.set(x, y);
    if (out.move.lengthSq() > 1) out.move.normalize();

    for (const code of keys) {
      const actions = KEY_BINDINGS[code];
      if (!actions) continue;
      for (const action of actions) out.held[action] = true;
    }
    if (this.mouseButtons.has(MOUSE_BUTTON_PRIMARY)) out.held.attack = true;
    if (this.mouseButtons.has(MOUSE_BUTTON_SECONDARY)) out.held.lockOn = true;

    out.lookDelta.set(this.mouseDx, this.mouseDy);
    this.mouseDx = 0;
    this.mouseDy = 0;

    const active = this.activity;
    this.activity = false;
    return active;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.element.removeEventListener('mousedown', this.handleMouseDown);
    this.element.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('mousemove', this.handleMouseMove);
  }

  private requestPointerLock(): void {
    if (this.isPointerLocked) return;
    try {
      const result: unknown = this.element.requestPointerLock();
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Pointer lock may be refused (e.g. immediately after exiting it); clicking again retries.
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey) return;
    const bound = KEY_BINDINGS[event.code] !== undefined || MOVE_KEYS.has(event.code);
    if (!bound) return;
    event.preventDefault();
    this.keys.add(event.code);
    this.activity = true;
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly handleBlur = (): void => {
    this.keys.clear();
    this.mouseButtons.clear();
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    this.activity = true;
    if (!this.isPointerLocked) {
      this.requestPointerLock();
      return;
    }
    this.mouseButtons.add(event.button);
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    this.mouseButtons.delete(event.button);
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.isPointerLocked) return;
    this.mouseDx += event.movementX;
    this.mouseDy += event.movementY;
    this.activity = true;
  };
}
