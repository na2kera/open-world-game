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

  it('reports a top the feet can stand on and a trunk being walked into', () => {
    expect(collision.supportHeight(10, 5.2, 10)).toBe(5);
    expect(collision.supportHeight(10, 1, 10)).toBeUndefined();
    const climb = collision.climbTarget(10, 1, 8.2, 0.4, 0, 1);
    expect(climb?.topY).toBe(5);
    expect(collision.blocksSight({ x: 10, y: 2, z: 6 }, { x: 10, y: 2, z: 14 })).toBe(true);
    expect(collision.blocksSight({ x: 10, y: 8, z: 6 }, { x: 10, y: 8, z: 14 })).toBe(false);
  });
});

describe('generateCellPlacement', () => {
  it('is deterministic per seed and cell', () => {
    const terrain = new Terrain(DEFAULT_SEED);
    const a = generateCellPlacement(terrain, DEFAULT_SEED, 1, -2);
    const b = generateCellPlacement(terrain, DEFAULT_SEED, 1, -2);
    expect(a.trees).toEqual(b.trees);
    expect(a.ruins).toEqual(b.ruins);
    expect(a.colliders.length).toBeGreaterThanOrEqual(a.trees.length + a.rocks.length);
  });
});
