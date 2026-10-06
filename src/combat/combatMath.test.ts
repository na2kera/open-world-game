import { describe, expect, it } from 'vitest';

import { ComboInputBuffer, isPointInAttackArc, isTerrainOccluded } from './combatMath';

describe('ComboInputBuffer', () => {
  it('holds an early press and consumes it once', () => {
    const buffer = new ComboInputBuffer(0.25);
    buffer.press();
    buffer.update(0.2);
    expect(buffer.consume()).toBe(true);
    expect(buffer.consume()).toBe(false);
  });

  it('expires old presses', () => {
    const buffer = new ComboInputBuffer(0.1);
    buffer.press();
    buffer.update(0.11);
    expect(buffer.hasInput).toBe(false);
  });
});

describe('isTerrainOccluded', () => {
  it('rejects a line that passes through a hill and keeps a clear line', () => {
    const heightAt = (x: number) => (x > 4 && x < 8 ? 6 : 0);
    const from = { x: 0, y: 1.5, z: 0 };
    expect(isTerrainOccluded(heightAt, from, { x: 12, y: 1.5, z: 0 })).toBe(true);
    expect(isTerrainOccluded(heightAt, from, { x: 3, y: 1.5, z: 0 })).toBe(false);
  });
});

describe('isPointInAttackArc', () => {
  it('accepts points in front and rejects rear/out-of-range points', () => {
    const origin = { x: 0, z: 0 };
    expect(isPointInAttackArc(origin, 0, { x: 0, z: 2 })).toBe(true);
    expect(isPointInAttackArc(origin, 0, { x: 1.5, z: 1 })).toBe(true);
    expect(isPointInAttackArc(origin, 0, { x: 0, z: -1 })).toBe(false);
    expect(isPointInAttackArc(origin, 0, { x: 0, z: 3 })).toBe(false);
  });
});
