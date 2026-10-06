import { describe, expect, it, vi } from 'vitest';

import { InputManager } from './InputManager';
import type { ButtonAction, ControllerKind, InputSource, RawInputSample } from './types';

/** Scriptable source: set `held`/`move` before each poll. */
class MockSource implements InputSource {
  held = new Set<ButtonAction>();
  moveX = 0;
  moveY = 0;
  active = false;

  constructor(readonly kind: ControllerKind) {}

  sample(out: RawInputSample): boolean {
    out.move.set(this.moveX, this.moveY);
    for (const action of this.held) out.held[action] = true;
    return this.active;
  }
}

const FRAME = 1 / 60;

describe('InputManager', () => {
  it('detects pressed / held / released edges', () => {
    const source = new MockSource('keyboard');
    const input = new InputManager([source]);
    const jump = input.state.buttons.jump;

    source.held.add('jump');
    input.poll(FRAME);
    expect(jump).toEqual({ pressed: true, held: true, released: false });
    input.consumeEdges();

    input.poll(FRAME);
    expect(jump).toEqual({ pressed: false, held: true, released: false });
    input.consumeEdges();

    source.held.delete('jump');
    input.poll(FRAME);
    expect(jump).toEqual({ pressed: false, held: false, released: true });
    input.consumeEdges();

    input.poll(FRAME);
    expect(jump).toEqual({ pressed: false, held: false, released: false });
  });

  it('keeps edges until a simulation step consumes them', () => {
    const source = new MockSource('keyboard');
    const input = new InputManager([source]);
    source.held.add('attack');
    input.poll(FRAME);
    source.held.delete('attack');
    input.poll(FRAME);
    const attack = input.state.buttons.attack;
    expect(attack.pressed).toBe(true);
    expect(attack.released).toBe(true);
    expect(attack.held).toBe(false);
    input.consumeEdges();
    expect(attack.pressed).toBe(false);
  });

  it('merges sources and tracks the active device kind', () => {
    const keyboard = new MockSource('keyboard');
    const pad = new MockSource('switch');
    const onKind = vi.fn();
    const input = new InputManager([keyboard, pad], onKind);
    expect(input.hasReceivedInput).toBe(false);

    keyboard.moveX = 0.3;
    pad.moveY = 0.9;
    pad.active = true;
    pad.held.add('dodge');
    keyboard.held.add('jump');
    input.poll(FRAME);

    expect(input.state.move.y).toBeCloseTo(0.9);
    expect(input.state.buttons.dodge.held).toBe(true);
    expect(input.state.buttons.jump.held).toBe(true);
    expect(input.activeKind).toBe('switch');
    expect(input.hasReceivedInput).toBe(true);
    expect(onKind).toHaveBeenCalledWith('switch');
  });
});
