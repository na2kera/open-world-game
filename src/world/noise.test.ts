import { describe, expect, it } from 'vitest';

import { domainWarp, fbm, ridged, SimplexNoise2D } from './noise';

const SAMPLES = 5000;
const SPREAD = 0.731;

describe('SimplexNoise2D', () => {
  it('is deterministic for a given seed', () => {
    const a = new SimplexNoise2D(42);
    const b = new SimplexNoise2D(42);
    for (let i = 0; i < 100; i++) {
      expect(a.noise(i * SPREAD, -i * 1.3)).toBe(b.noise(i * SPREAD, -i * 1.3));
    }
  });

  it('differs between seeds', () => {
    const a = new SimplexNoise2D(1);
    const b = new SimplexNoise2D(2);
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      if (a.noise(i * SPREAD, i * 0.37) !== b.noise(i * SPREAD, i * 0.37)) differences++;
    }
    expect(differences).toBeGreaterThan(90);
  });

  it('stays within [-1, 1] and covers a reasonable range', () => {
    const noise = new SimplexNoise2D(7);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      const v = noise.noise(i * SPREAD, (i % 97) * 1.913);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeLessThan(-0.6);
    expect(max).toBeGreaterThan(0.6);
  });
});

describe('fractal helpers', () => {
  const noise = new SimplexNoise2D(99);

  it('fbm is normalised to [-1, 1]', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const v = fbm(noise, i * 0.05, i * 0.031, 5);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('ridged is normalised to [0, 1]', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const v = ridged(noise, i * 0.05, i * 0.031, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('domainWarp is deterministic and bounded by its amplitude', () => {
    const other = new SimplexNoise2D(100);
    const amplitude = 10;
    const a = domainWarp(noise, other, 3, 4, 0.1, amplitude, 2, { x: 0, y: 0 });
    const b = domainWarp(noise, other, 3, 4, 0.1, amplitude, 2, { x: 0, y: 0 });
    expect(a).toEqual(b);
    expect(Math.abs(a.x - 3)).toBeLessThanOrEqual(amplitude);
    expect(Math.abs(a.y - 4)).toBeLessThanOrEqual(amplitude);
  });
});
