import { Vector2 } from 'three';

import {
  BUTTON_ACTIONS,
  createActionRecord,
  createRawSample,
  resetRawSample,
  type ButtonState,
  type ControllerKind,
  type InputSource,
  type InputState,
  type RawInputSample,
} from './types';

/** Called when the most recently used device family changes. */
export type ActiveKindListener = (kind: ControllerKind) => void;

/**
 * Merges several {@link InputSource}s into one {@link InputState}.
 *
 * Call {@link poll} once per rendered frame and {@link consumeEdges} after each fixed
 * simulation step. `pressed` / `released` edges stay set until consumed, so they are neither
 * lost on frames without a simulation step nor seen twice by consecutive steps.
 */
export class InputManager {
  private readonly buttons = createActionRecord<ButtonState>(() => ({
    pressed: false,
    held: false,
    released: false,
  }));
  private readonly sample: RawInputSample = createRawSample();
  private readonly heldScratch = createActionRecord(() => false);
  private readonly move = new Vector2();
  private readonly look = new Vector2();
  private readonly lookDelta = new Vector2();
  private activeKindValue: ControllerKind = 'keyboard';
  private receivedInput = false;

  /** Merged input snapshot (live object, updated in place). */
  readonly state: InputState = {
    move: this.move,
    look: this.look,
    lookDelta: this.lookDelta,
    buttons: this.buttons,
  };

  constructor(
    private readonly sources: readonly InputSource[],
    private readonly onActiveKindChange?: ActiveKindListener,
  ) {}

  /** Device family that produced input most recently (for button prompts). */
  get activeKind(): ControllerKind {
    return this.activeKindValue;
  }

  /** True once any source has reported user activity. */
  get hasReceivedInput(): boolean {
    return this.receivedInput;
  }

  /** Samples every source and updates {@link state}. */
  poll(dt: number): void {
    this.move.set(0, 0);
    this.look.set(0, 0);
    this.lookDelta.set(0, 0);
    const heldNow = this.heldScratch;
    for (const action of BUTTON_ACTIONS) heldNow[action] = false;

    for (const source of this.sources) {
      resetRawSample(this.sample);
      const active = source.sample(this.sample, dt);
      if (active) {
        this.receivedInput = true;
        if (source.kind !== this.activeKindValue) {
          this.activeKindValue = source.kind;
          this.onActiveKindChange?.(source.kind);
        }
      }
      if (this.sample.move.lengthSq() > this.move.lengthSq()) this.move.copy(this.sample.move);
      this.look.add(this.sample.look);
      this.lookDelta.add(this.sample.lookDelta);
      for (const action of BUTTON_ACTIONS) {
        if (this.sample.held[action]) heldNow[action] = true;
      }
    }

    if (this.look.lengthSq() > 1) this.look.normalize();

    for (const action of BUTTON_ACTIONS) {
      const state = this.buttons[action];
      const isHeld = heldNow[action];
      if (isHeld && !state.held) state.pressed = true;
      if (!isHeld && state.held) state.released = true;
      state.held = isHeld;
    }
  }

  /** Clears `pressed` / `released` edges after a simulation step has seen them. */
  consumeEdges(): void {
    for (const action of BUTTON_ACTIONS) {
      const state = this.buttons[action];
      state.pressed = false;
      state.released = false;
    }
  }

  dispose(): void {
    for (const source of this.sources) source.dispose?.();
  }
}
