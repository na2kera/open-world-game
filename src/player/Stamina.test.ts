import { describe, expect, it } from 'vitest';

import { STAMINA_CONFIG } from '../config';
import { Stamina } from './Stamina';

const DT = 1 / 60;

/** Runs `seconds` of fixed steps with the given drain. */
function run(stamina: Stamina, seconds: number, drain: number): boolean {
  let ranOut = false;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) ranOut = stamina.update(DT, drain) || ranOut;
  return ranOut;
}

describe('Stamina', () => {
  it('starts full', () => {
    const stamina = new Stamina();
    expect(stamina.value).toBe(STAMINA_CONFIG.max);
    expect(stamina.isFull).toBe(true);
    expect(stamina.canExert).toBe(true);
  });

  it('drains at the sprint rate', () => {
    const stamina = new Stamina();
    run(stamina, 2, STAMINA_CONFIG.sprintDrain);
    expect(stamina.value).toBeCloseTo(STAMINA_CONFIG.max - STAMINA_CONFIG.sprintDrain * 2, 5);
  });

  it('waits before regenerating, then regenerates at the regen rate', () => {
    const stamina = new Stamina();
    run(stamina, 2, STAMINA_CONFIG.climbDrain);
    const afterDrain = stamina.value;
    run(stamina, STAMINA_CONFIG.regenDelay * 0.9, 0);
    expect(stamina.value).toBe(afterDrain);
    run(stamina, STAMINA_CONFIG.regenDelay * 0.1 + 0.5, 0);
    expect(stamina.value).toBeGreaterThan(afterDrain);
    expect(stamina.value).toBeLessThanOrEqual(
      afterDrain + STAMINA_CONFIG.regen * (0.5 + 2 * DT) + 1e-6,
    );
  });

  it('locks exertion for the exhaustion period after running out', () => {
    const stamina = new Stamina();
    const secondsToEmpty = STAMINA_CONFIG.max / STAMINA_CONFIG.swimDrain;
    expect(run(stamina, secondsToEmpty + 0.1, STAMINA_CONFIG.swimDrain)).toBe(true);
    expect(stamina.value).toBeGreaterThanOrEqual(0);
    expect(stamina.isExhausted).toBe(true);
    expect(stamina.canExert).toBe(false);

    run(stamina, STAMINA_CONFIG.exhaustedLock - 0.2, STAMINA_CONFIG.sprintDrain);
    expect(stamina.canExert).toBe(false);
    run(stamina, 0.3, 0);
    expect(stamina.isExhausted).toBe(false);
    expect(stamina.canExert).toBe(true);
    expect(stamina.value).toBeGreaterThan(0);
  });

  it('never exceeds max and refill resets exhaustion', () => {
    const stamina = new Stamina();
    stamina.consume(STAMINA_CONFIG.max * 2);
    expect(stamina.isExhausted).toBe(true);
    stamina.refill();
    expect(stamina.canExert).toBe(true);
    run(stamina, 5, 0);
    expect(stamina.value).toBe(STAMINA_CONFIG.max);
  });
});
