import { describe, expect, it } from 'vitest';

import { MAX_TERRAIN_HEIGHT, WATER_LEVEL, WORLD_HALF } from '../config';
import { classifyBiome, Terrain } from './Terrain';

const SEED = 12345;
const EDGE_SAMPLES = 64;

describe('Terrain', () => {
  const terrain = new Terrain(SEED);

  it('heightAt is deterministic across instances', () => {
    const other = new Terrain(SEED);
    for (let i = 0; i < 50; i++) {
      const x = i * 37.3 - 900;
      const z = i * -21.7 + 400;
      expect(other.heightAt(x, z)).toBe(terrain.heightAt(x, z));
    }
  });

  it('different seeds produce different worlds', () => {
    const other = new Terrain(SEED + 1);
    expect(other.heightAt(100, 200)).not.toBe(terrain.heightAt(100, 200));
  });

  it('is ocean along the world edge', () => {
    for (let i = 0; i <= EDGE_SAMPLES; i++) {
      const t = -WORLD_HALF + (i / EDGE_SAMPLES) * WORLD_HALF * 2;
      for (const [x, z] of [
        [t, -WORLD_HALF],
        [t, WORLD_HALF],
        [-WORLD_HALF, t],
        [WORLD_HALF, t],
      ] as const) {
        expect(terrain.heightAt(x, z)).toBeLessThan(WATER_LEVEL);
        expect(terrain.biomeAt(x, z)).toBe('ocean');
      }
    }
  });

  it('stays below the maximum height', () => {
    for (let i = 0; i < 2000; i++) {
      const x = ((i * 7919) % 3000) - 1500;
      const z = ((i * 104729) % 3000) - 1500;
      expect(terrain.heightAt(x, z)).toBeLessThanOrEqual(MAX_TERRAIN_HEIGHT);
    }
  });

  it('normalAt returns a unit vector pointing up', () => {
    const n = terrain.normalAt(10, -20, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
    expect(n.y).toBeGreaterThan(0);
  });

  it('findSpawnPoint lands on dry grassland', () => {
    for (const seed of [SEED, 1, 2026]) {
      const world = new Terrain(seed);
      const spawn = world.findSpawnPoint({ x: 0, y: 0, z: 0 });
      expect(spawn.y).toBeGreaterThan(WATER_LEVEL);
      expect(spawn.y).toBeCloseTo(world.heightAt(spawn.x, spawn.z));
      expect(world.biomeAt(spawn.x, spawn.z)).toBe('grassland');
    }
  });
});

describe('classifyBiome', () => {
  it('orders biomes by height', () => {
    expect(classifyBiome(-10, 0)).toBe('ocean');
    expect(classifyBiome(1, 0)).toBe('beach');
    expect(classifyBiome(10, -0.5)).toBe('grassland');
    expect(classifyBiome(10, 0.5)).toBe('forest');
    expect(classifyBiome(60, 0)).toBe('highland');
    expect(classifyBiome(100, 0)).toBe('mountain');
    expect(classifyBiome(150, 0)).toBe('snow');
  });
});
