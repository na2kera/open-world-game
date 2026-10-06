import { describe, expect, it } from 'vitest';

import { Terrain } from './Terrain';
import { generateCellPlacement, generateGrass, GRASS_STRIDE } from './vegetationPlacement';

const SEED = 1337;
const CELLS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, -1],
  [-2, 3],
  [4, 2],
];

describe('generateGrass', () => {
  const terrain = new Terrain(SEED);

  it('packs finite tufts in whole strides, deterministically', () => {
    let total = 0;
    for (const [cx, cz] of CELLS) {
      const placement = generateCellPlacement(terrain, SEED, cx, cz);
      const grass = generateGrass(placement, SEED);
      expect(grass.length % GRASS_STRIDE).toBe(0);
      for (const value of grass) expect(Number.isFinite(value)).toBe(true);
      const again = generateGrass(generateCellPlacement(terrain, SEED, cx, cz), SEED);
      expect(Array.from(again)).toEqual(Array.from(grass));
      total += grass.length / GRASS_STRIDE;
    }
    expect(total).toBeGreaterThan(0);
  });
});
