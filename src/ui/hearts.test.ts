import { describe, expect, it } from 'vitest';

import { heartCount, heartQuarters } from './hearts';

describe('heart helpers', () => {
  it('splits quarter hearts across containers', () => {
    expect(heartCount(12)).toBe(3);
    expect([0, 1, 2].map((i) => heartQuarters(12, i))).toEqual([4, 4, 4]);
    expect([0, 1, 2].map((i) => heartQuarters(7, i))).toEqual([4, 3, 0]);
    expect([0, 1, 2].map((i) => heartQuarters(0, i))).toEqual([0, 0, 0]);
  });
});
