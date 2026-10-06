import { Vector2 } from 'three';

/** Every digital action the game understands. */
export const BUTTON_ACTIONS = [
  'jump',
  'sprint',
  'attack',
  'interact',
  'lockOn',
  'dodge',
  'inventory',
  'pause',
  'cameraReset',
  'menuUp',
  'menuDown',
  'menuLeft',
  'menuRight',
  'menuTabLeft',
  'menuTabRight',
  'menuConfirm',
  'menuCancel',
] as const;

export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

/** Device family used for button prompts. */
export type ControllerKind = 'switch' | 'xbox' | 'playstation' | 'generic' | 'keyboard';

/** Edge-aware state of one action. */
export interface ButtonState {
  /** Became held since the last consumed simulation step. */
  pressed: boolean;
  /** Currently held. */
  held: boolean;
  /** Became released since the last consumed simulation step. */
  released: boolean;
}

/** Snapshot of all player input, rebuilt by {@link InputManager.poll} every frame. */
export interface InputState {
  /** Movement stick; x = right, y = forward. Length ≤ 1. */
  readonly move: Vector2;
  /** Look stick rate; x = right, y = down. Length ≤ 1 (multiply by dt and a speed). */
  readonly look: Vector2;
  /** Mouse look displacement in pixels this frame; x = right, y = down. */
  readonly lookDelta: Vector2;
  readonly buttons: Readonly<Record<ButtonAction, ButtonState>>;
}

/** Raw per-source sample filled by an {@link InputSource}. */
export interface RawInputSample {
  move: Vector2;
  look: Vector2;
  lookDelta: Vector2;
  held: Record<ButtonAction, boolean>;
}

/** A device that contributes to the merged {@link InputState}. */
export interface InputSource {
  /** Device family of this source (may change, e.g. when another pad is connected). */
  readonly kind: ControllerKind;
  /**
   * Writes the current device state into `out` (which arrives zeroed).
   * Returns true when the user actively used the device during this poll.
   */
  sample(out: RawInputSample, dt: number): boolean;
  dispose?(): void;
}

/** Creates an action → value record initialised by `init`. */
export function createActionRecord<T>(init: () => T): Record<ButtonAction, T> {
  const record = {} as Record<ButtonAction, T>;
  for (const action of BUTTON_ACTIONS) record[action] = init();
  return record;
}

/** Allocates an empty {@link RawInputSample}. */
export function createRawSample(): RawInputSample {
  return {
    move: new Vector2(),
    look: new Vector2(),
    lookDelta: new Vector2(),
    held: createActionRecord(() => false),
  };
}

/** Zeroes a {@link RawInputSample} in place. */
export function resetRawSample(sample: RawInputSample): void {
  sample.move.set(0, 0);
  sample.look.set(0, 0);
  sample.lookDelta.set(0, 0);
  for (const action of BUTTON_ACTIONS) sample.held[action] = false;
}
