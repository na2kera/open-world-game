import { describe, expect, it } from 'vitest';

import { DEFAULT_SEED } from '../config';
import { Terrain } from './Terrain';
import { generateCellPlacement } from './vegetationPlacement';
import { WorldCollision, type ColliderProvider } from './WorldCollision';

const CELL = 64;

describe('WorldCollision', () => {
  const provider: ColliderProvider = {
    getColliders: (cx, cz) =>
      cx === 0 && cz === 0 ? [{ x: 10, z: 10, radius: 1, baseY: 0, topY: 5 }] : [],
  };
  const collision = new WorldCollision(provider, CELL);

  it('pushes the player out of an obstacle', () => {
    const p = { x: 10.5, y: 1, z: 10 };
    expect(collision.resolve(p, 0.5)).toBe(true);
    expect(Math.hypot(p.x - 10, p.z - 10)).toBeCloseTo(1.5);
  });

  it('ignores obstacles below the feet', () => {
    const p = { x: 10.5, y: 6, z: 10 };
    expect(collision.resolve(p, 0.5)).toBe(false);
    expect(p.x).toBe(10.5);
  });
});

describe('generateCellPlacement', () => {
  it('is deterministic per seed and cell', () => {
    const terrain = new Terrain(DEFAULT_SEED);
    const a = generateCellPlacement(terrain, DEFAULT_SEED, 1, -2);
    const b = generateCellPlacement(terrain, DEFAULT_SEED, 1, -2);
    expect(a.trees).toEqual(b.trees);
    expect(a.colliders.length).toBe(a.trees.length + a.rocks.length);
  });
});
