import type { Vector2 } from 'three';

import { INPUT_CONFIG } from '../config';
import type { ControllerKind, InputSource, RawInputSample } from './types';

/** Button indices of the W3C "standard" gamepad mapping. */
export const STANDARD_BUTTON = {
  /** Bottom face button (Switch B / Xbox A / PS ✕). */
  bottom: 0,
  /** Right face button (Switch A / Xbox B / PS ○). */
  right: 1,
  /** Left face button (Switch Y / Xbox X / PS □). */
  left: 2,
  /** Top face button (Switch X / Xbox Y / PS △). */
  top: 3,
  l: 4,
  r: 5,
  zl: 6,
  zr: 7,
  minus: 8,
  plus: 9,
  leftStick: 10,
  rightStick: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

const AXIS_LEFT_X = 0;
const AXIS_LEFT_Y = 1;
const AXIS_RIGHT_X = 2;
const AXIS_RIGHT_Y = 3;

/** Identifies the controller family from `Gamepad.id`. */
export function detectControllerKind(id: string): Exclude<ControllerKind, 'keyboard'> {
  const lower = id.toLowerCase();
  if (lower.includes('057e') || lower.includes('pro controller') || lower.includes('nintendo')) {
    return 'switch';
  }
  if (lower.includes('045e') || lower.includes('xbox') || lower.includes('xinput')) {
    return 'xbox';
  }
  if (
    lower.includes('054c') ||
    lower.includes('playstation') ||
    lower.includes('dualsense') ||
    lower.includes('dualshock')
  ) {
    return 'playstation';
  }
  return 'generic';
}

/**
 * Applies a radial deadzone and rescales so the output covers the full unit disc.
 * Writes into `out` and returns it.
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number, out: Vector2): Vector2 {
  const length = Math.hypot(x, y);
  if (length <= deadzone) return out.set(0, 0);
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  return out.set((x / length) * scaled, (y / length) * scaled);
}

/** Connection info passed to {@link GamepadSourceOptions} callbacks. */
export interface GamepadInfo {
  index: number;
  id: string;
  kind: Exclude<ControllerKind, 'keyboard'>;
}

/** Dependencies of {@link GamepadSource}; injectable for tests. */
export interface GamepadSourceOptions {
  getGamepads?: () => readonly (Gamepad | null)[];
  onConnected?: (info: GamepadInfo) => void;
  onDisconnected?: (info: GamepadInfo) => void;
}

/**
 * Gamepad API source (standard mapping).
 *
 * Bottom button (Switch B): tap → `dodge` (emitted on release), hold ≥ 0.25 s → `sprint`.
 * It also drives `menuCancel` immediately.
 */
export class GamepadSource implements InputSource {
  private kindValue: ControllerKind = 'generic';
  private bottomHeldTime = 0;
  private bottomWasDown = false;
  private readonly getGamepads: () => readonly (Gamepad | null)[];

  constructor(private readonly options: GamepadSourceOptions = {}) {
    this.getGamepads =
      options.getGamepads ??
      (() =>
        typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []);
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', this.handleConnected);
      window.addEventListener('gamepaddisconnected', this.handleDisconnected);
    }
  }

  get kind(): ControllerKind {
    return this.kindValue;
  }

  /** True if any gamepad is currently connected. */
  get isConnected(): boolean {
    return this.findPad() !== null;
  }

  sample(out: RawInputSample, dt: number): boolean {
    const pad = this.findPad();
    if (!pad) {
      this.bottomHeldTime = 0;
      this.bottomWasDown = false;
      return false;
    }
    this.kindValue = detectControllerKind(pad.id);
    const { stickDeadzone, sprintHoldTime } = INPUT_CONFIG;

    applyRadialDeadzone(
      pad.axes[AXIS_LEFT_X] ?? 0,
      pad.axes[AXIS_LEFT_Y] ?? 0,
      stickDeadzone,
      out.move,
    );
    out.move.y = -out.move.y;
    applyRadialDeadzone(
      pad.axes[AXIS_RIGHT_X] ?? 0,
      pad.axes[AXIS_RIGHT_Y] ?? 0,
      stickDeadzone,
      out.look,
    );

    let anyButton = false;
    const down = (index: number): boolean => {
      const button = pad.buttons[index];
      const isDown = !!button && (button.pressed || button.value > INPUT_CONFIG.buttonThreshold);
      if (isDown) anyButton = true;
      return isDown;
    };

    const held = out.held;
    const bottom = down(STANDARD_BUTTON.bottom);
    if (bottom) {
      this.bottomHeldTime += dt;
      if (this.bottomHeldTime >= sprintHoldTime) held.sprint = true;
    } else {
      if (this.bottomWasDown && this.bottomHeldTime < sprintHoldTime) held.dodge = true;
      this.bottomHeldTime = 0;
    }
    this.bottomWasDown = bottom;
    held.menuCancel = bottom;

    const right = down(STANDARD_BUTTON.right);
    held.interact = right;
    held.menuConfirm = right;
    held.attack = down(STANDARD_BUTTON.left);
    held.jump = down(STANDARD_BUTTON.top);
    held.cameraReset = down(STANDARD_BUTTON.l);
    // R / ZR / R3 are reserved for later phases but still count as activity.
    down(STANDARD_BUTTON.r);
    held.lockOn = down(STANDARD_BUTTON.zl);
    down(STANDARD_BUTTON.zr);
    held.inventory = down(STANDARD_BUTTON.minus);
    held.pause = down(STANDARD_BUTTON.plus);
    if (down(STANDARD_BUTTON.leftStick)) held.sprint = true;
    down(STANDARD_BUTTON.rightStick);
    held.menuUp = down(STANDARD_BUTTON.dpadUp);
    held.menuDown = down(STANDARD_BUTTON.dpadDown);
    held.menuLeft = down(STANDARD_BUTTON.dpadLeft);
    held.menuRight = down(STANDARD_BUTTON.dpadRight);

    return anyButton || out.move.lengthSq() > 0 || out.look.lengthSq() > 0;
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('gamepadconnected', this.handleConnected);
      window.removeEventListener('gamepaddisconnected', this.handleDisconnected);
    }
  }

  /** First connected pad, preferring ones with the standard mapping. */
  private findPad(): Gamepad | null {
    let fallback: Gamepad | null = null;
    for (const pad of this.getGamepads()) {
      if (!pad || !pad.connected) continue;
      if (pad.mapping === 'standard') return pad;
      fallback ??= pad;
    }
    return fallback;
  }

  private readonly handleConnected = (event: GamepadEvent): void => {
    const { index, id } = event.gamepad;
    this.options.onConnected?.({ index, id, kind: detectControllerKind(id) });
  };

  private readonly handleDisconnected = (event: GamepadEvent): void => {
    const { index, id } = event.gamepad;
    this.options.onDisconnected?.({ index, id, kind: detectControllerKind(id) });
  };
}
