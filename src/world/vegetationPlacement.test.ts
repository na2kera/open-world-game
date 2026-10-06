import { describe, expect, it } from 'vitest';

import { VEGETATION_CELL_SIZE } from '../config';
import { BIOME_THRESHOLDS, Terrain } from './Terrain';
import {
  generateCellPlacement,
  generateGrass,
  GRASS_STRIDE,
  type CellPlacement,
} from './vegetationPlacement';

const SEED = 1337;
const CELLS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, -1],
  [-2, 3],
  [4, 2],
];

/** Grid spacings used by the placement code (heights every 4 units, moisture every 32). */
const HEIGHT_SIDE = VEGETATION_CELL_SIZE / 4 + 1;
const MOISTURE_SIDE = VEGETATION_CELL_SIZE / 32 + 1;

/** A flat cell at `height` with uniform `moisture`. */
function flatCell(height: number, moisture: number): CellPlacement {
  return {
    cx: 3,
    cz: -2,
    trees: [],
    rocks: [],
    ruins: [],
    colliders: [],
    grid: {
      heights: new Float32Array(HEIGHT_SIDE * HEIGHT_SIDE).fill(height),
      moisture: new Float32Array(MOISTURE_SIDE * MOISTURE_SIDE).fill(moisture),
    },
  };
}

function summarize(grass: Float32Array): { count: number; meanR: number; meanB: number } {
  const count = grass.length / GRASS_STRIDE;
  let r = 0;
  let b = 0;
  for (let i = 0; i < count; i++) {
    r += grass[i * GRASS_STRIDE + 5]!;
    b += grass[i * GRASS_STRIDE + 7]!;
  }
  return { count, meanR: r / count, meanB: b / count };
}

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

  it('is continuous across the grassland / desert threshold', () => {
    const edge = BIOME_THRESHOLDS.desertMoisture;
    const wetter = summarize(generateGrass(flatCell(12, edge + 1e-5), SEED));
    const drier = summarize(generateGrass(flatCell(12, edge - 1e-5), SEED));
    expect(wetter.count).toBeGreaterThan(0);
    expect(Math.abs(wetter.count - drier.count) / wetter.count).toBeLessThan(0.05);
    expect(Math.abs(wetter.meanR - drier.meanR)).toBeLessThan(0.02);
    expect(Math.abs(wetter.meanB - drier.meanB)).toBeLessThan(0.02);
  });
});
