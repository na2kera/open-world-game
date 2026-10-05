import { Vector2 } from 'three';
import { describe, expect, it } from 'vitest';

import { INPUT_CONFIG } from '../config';
import { getButtonLabel, getSprintLabel } from './buttonLabels';
import {
  applyRadialDeadzone,
  detectControllerKind,
  GamepadSource,
  STANDARD_BUTTON,
} from './GamepadSource';
import { createRawSample, resetRawSample } from './types';

const BUTTON_COUNT = 17;
const AXIS_COUNT = 4;

/** Minimal Gamepad stand-in with writable buttons/axes. */
function createMockPad(id: string): {
  pad: Gamepad;
  press: (index: number, down: boolean) => void;
} {
  const buttons = Array.from({ length: BUTTON_COUNT }, () => ({
    pressed: false,
    touched: false,
    value: 0,
  }));
  const pad = {
    id,
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: new Array<number>(AXIS_COUNT).fill(0),
    buttons,
    timestamp: 0,
  } as unknown as Gamepad;
  const press = (index: number, down: boolean): void => {
    const button = buttons[index];
    if (!button) throw new Error(`no button ${index}`);
    button.pressed = down;
    button.value = down ? 1 : 0;
  };
  return { pad, press };
}

describe('detectControllerKind', () => {
  it('recognises common controllers', () => {
    expect(
      detectControllerKind('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'),
    ).toBe('switch');
    expect(detectControllerKind('Xbox Wireless Controller (Vendor: 045e)')).toBe('xbox');
    expect(detectControllerKind('DualSense Wireless Controller (Vendor: 054c)')).toBe(
      'playstation',
    );
    expect(detectControllerKind('Some Pad')).toBe('generic');
  });
});

describe('applyRadialDeadzone', () => {
  it('zeroes small input and rescales to the unit circle', () => {
    const out = new Vector2();
    expect(applyRadialDeadzone(0.1, 0.05, 0.15, out).length()).toBe(0);
    expect(applyRadialDeadzone(1, 1, 0.15, out).length()).toBeCloseTo(1);
    const mid = applyRadialDeadzone(0.575, 0, 0.15, out);
    expect(mid.x).toBeCloseTo(0.5);
  });
});

describe('GamepadSource', () => {
  const step = INPUT_CONFIG.sprintHoldTime / 5;

  it('maps a short B tap to dodge and a long hold to sprint', () => {
    const { pad, press } = createMockPad('Pro Controller 057e');
    const source = new GamepadSource({ getGamepads: () => [pad] });
    const sample = createRawSample();
    const poll = (): void => {
      resetRawSample(sample);
      source.sample(sample, step);
    };

    press(STANDARD_BUTTON.bottom, true);
    poll();
    expect(sample.held.menuCancel).toBe(true);
    expect(sample.held.dodge).toBe(false);
    press(STANDARD_BUTTON.bottom, false);
    poll();
    expect(sample.held.dodge).toBe(true);
    poll();
    expect(sample.held.dodge).toBe(false);

    press(STANDARD_BUTTON.bottom, true);
    for (let i = 0; i < 6; i++) poll();
    expect(sample.held.sprint).toBe(true);
    press(STANDARD_BUTTON.bottom, false);
    poll();
    expect(sample.held.dodge).toBe(false);
    expect(source.kind).toBe('switch');
  });

  it('maps face buttons following the BotW layout', () => {
    const { pad, press } = createMockPad('generic');
    const source = new GamepadSource({ getGamepads: () => [pad] });
    const sample = createRawSample();
    press(STANDARD_BUTTON.right, true);
    press(STANDARD_BUTTON.top, true);
    expect(source.sample(sample, step)).toBe(true);
    expect(sample.held.interact).toBe(true);
    expect(sample.held.menuConfirm).toBe(true);
    expect(sample.held.jump).toBe(true);
  });
});

describe('button labels', () => {
  it('uses Switch naming for Switch controllers', () => {
    expect(getButtonLabel('jump', 'switch')).toBe('X');
    expect(getButtonLabel('interact', 'switch')).toBe('A');
    expect(getSprintLabel('switch')).toBe('B長押し');
    expect(getSprintLabel('keyboard')).toBe('Shift');
  });
});
