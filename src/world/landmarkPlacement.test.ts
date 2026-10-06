import { describe, expect, it } from 'vitest';

import type { Biome } from './Terrain';
import { placeLandmarks, type TerrainQuery } from './landmarkPlacement';

const flat: TerrainQuery = {
  heightAt: () => 8,
  biomeAt: (x, z) => {
    const distance = Math.hypot(x, z);
    if (distance > 1600) return 'ocean';
    return 'grassland' satisfies Biome;
  },
};

describe('placeLandmarks', () => {
  it('puts three towers on land, away from the village', () => {
    const placed = placeLandmarks(10, -20, flat);
    expect(placed.towers).toHaveLength(3);
    const ids = new Set(placed.towers.map((tower) => tower.id));
    expect(ids).toEqual(new Set(['tower-0', 'tower-1', 'tower-2']));
    for (const tower of placed.towers) {
      const distance = Math.hypot(tower.x - 10, tower.z + 20);
      expect(distance).toBeGreaterThanOrEqual(320);
      expect(distance).toBeLessThanOrEqual(700);
      expect(tower.y).toBeGreaterThan(2);
    }
    expect(placed.shrine.y).toBeGreaterThan(2);
    expect(placed.arena.y).toBeGreaterThan(2);
    expect(placeLandmarks(10, -20, flat)).toEqual(placed);
  });
});
