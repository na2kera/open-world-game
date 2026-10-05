import { VEGETATION_CELL_SIZE, WATER_LEVEL } from '../config';
import { hashInts, mulberry32, randRange, type Rng } from '../utils/random';
import { classifyBiome, type Biome, type Terrain } from './Terrain';

export type TreeKind = 'conifer' | 'broadleaf';

export interface TreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  kind: TreeKind;
  /** Foliage brightness multiplier. */
  tint: number;
}

export interface RockPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  tilt: number;
}

/** Vertical cylinder obstacle. */
export interface Collider {
  x: number;
  z: number;
  radius: number;
  /** Bottom of the cylinder. */
  baseY: number;
  /** Top of the cylinder; the player can pass over it above this height. */
  topY: number;
}

/** Packed grass instances: x, y, z, scale, rotation, tint per tuft. */
export const GRASS_STRIDE = 6;

/** Coarse height / moisture grid of one cell, used to place objects cheaply. */
export interface CellGrid {
  readonly heights: Float32Array;
  readonly moisture: Float32Array;
}

/** Deterministic vegetation layout of one cell. */
export interface CellPlacement {
  readonly cx: number;
  readonly cz: number;
  readonly trees: readonly TreePlacement[];
  readonly rocks: readonly RockPlacement[];
  readonly colliders: readonly Collider[];
  readonly grid: CellGrid;
}

/** Height grid spacing in units (bilinear interpolation in between). */
const GRID_SPACING = 4;
const GRID_SIDE = VEGETATION_CELL_SIZE / GRID_SPACING + 1;
const MOISTURE_SPACING = 32;
const MOISTURE_SIDE = VEGETATION_CELL_SIZE / MOISTURE_SPACING + 1;

/** Placement attempts per cell; acceptance probability depends on the biome. */
const TREE_ATTEMPTS = 260;
const ROCK_ATTEMPTS = 80;
const GRASS_ATTEMPTS = 3200;

const TREE_CHANCE: Readonly<Record<Biome, number>> = {
  ocean: 0,
  beach: 0,
  grassland: 0.05,
  forest: 0.6,
  highland: 0.22,
  mountain: 0.03,
  snow: 0,
};
const CONIFER_CHANCE: Readonly<Record<Biome, number>> = {
  ocean: 0,
  beach: 0,
  grassland: 0.1,
  forest: 0.5,
  highland: 0.95,
  mountain: 1,
  snow: 1,
};
const ROCK_CHANCE: Readonly<Record<Biome, number>> = {
  ocean: 0,
  beach: 0.05,
  grassland: 0.03,
  forest: 0.04,
  highland: 0.2,
  mountain: 0.4,
  snow: 0.15,
};
const GRASS_CHANCE: Readonly<Record<Biome, number>> = {
  ocean: 0,
  beach: 0,
  grassland: 0.85,
  forest: 0.35,
  highland: 0.25,
  mountain: 0,
  snow: 0,
};

/** Placement limits. */
const LIMITS = {
  minHeightAboveWater: 0.8,
  treeMinNormalY: 0.85,
  rockMinNormalY: 0.55,
  grassMinNormalY: 0.8,
  treeScale: [0.8, 1.45],
  rockScale: [0.5, 2.2],
  grassScale: [0.7, 1.3],
  tint: [0.8, 1.15],
  rockMaxTilt: 0.4,
  /** Trees / rocks are sunk slightly to hide interpolation error on slopes. */
  treeSink: 0.3,
  rockSink: 0.35,
  grassSink: 0.05,
  /** Grass under the forest canopy is darker. */
  forestGrassTint: 0.75,
} as const;

/** Collision shape relative to the instance scale. */
const COLLIDER = {
  treeRadius: 0.45,
  treeHeight: 9,
  rockRadius: 0.95,
  rockHeight: 1.3,
} as const;

/** RNG salts so tree / rock / grass streams are independent. */
const enum Salt {
  Objects = 11,
  Grass = 12,
}

/** Samples the cell grid for heights and moisture. */
function buildGrid(terrain: Terrain, originX: number, originZ: number): CellGrid {
  const heights = new Float32Array(GRID_SIDE * GRID_SIDE);
  for (let j = 0; j < GRID_SIDE; j++) {
    for (let i = 0; i < GRID_SIDE; i++) {
      heights[j * GRID_SIDE + i] = terrain.heightAt(
        originX + i * GRID_SPACING,
        originZ + j * GRID_SPACING,
      );
    }
  }
  const moisture = new Float32Array(MOISTURE_SIDE * MOISTURE_SIDE);
  for (let j = 0; j < MOISTURE_SIDE; j++) {
    for (let i = 0; i < MOISTURE_SIDE; i++) {
      moisture[j * MOISTURE_SIDE + i] = terrain.moistureAt(
        originX + i * MOISTURE_SPACING,
        originZ + j * MOISTURE_SPACING,
      );
    }
  }
  return { heights, moisture };
}

/** Bilinear lookup in a square grid with `side` samples spaced `spacing` apart. */
function bilinear(
  values: Float32Array,
  side: number,
  spacing: number,
  lx: number,
  lz: number,
): number {
  const max = side - 1 - 1e-6;
  const fx = Math.min(Math.max(lx / spacing, 0), max);
  const fz = Math.min(Math.max(lz / spacing, 0), max);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const a = values[iz * side + ix]!;
  const b = values[iz * side + ix + 1]!;
  const c = values[(iz + 1) * side + ix]!;
  const d = values[(iz + 1) * side + ix + 1]!;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Sampled terrain info at a candidate point. */
interface Candidate {
  x: number;
  z: number;
  height: number;
  normalY: number;
  biome: Biome;
}

function sampleCandidate(
  grid: CellGrid,
  originX: number,
  originZ: number,
  rng: Rng,
  out: Candidate,
): Candidate {
  const lx = rng() * VEGETATION_CELL_SIZE;
  const lz = rng() * VEGETATION_CELL_SIZE;
  const h = bilinear(grid.heights, GRID_SIDE, GRID_SPACING, lx, lz);
  const dx =
    bilinear(grid.heights, GRID_SIDE, GRID_SPACING, lx + GRID_SPACING, lz) -
    bilinear(grid.heights, GRID_SIDE, GRID_SPACING, lx - GRID_SPACING, lz);
  const dz =
    bilinear(grid.heights, GRID_SIDE, GRID_SPACING, lx, lz + GRID_SPACING) -
    bilinear(grid.heights, GRID_SIDE, GRID_SPACING, lx, lz - GRID_SPACING);
  const ny = 2 * GRID_SPACING;
  out.x = originX + lx;
  out.z = originZ + lz;
  out.height = h;
  out.normalY = ny / Math.hypot(dx, ny, dz);
  out.biome = classifyBiome(h, bilinear(grid.moisture, MOISTURE_SIDE, MOISTURE_SPACING, lx, lz));
  return out;
}

/** Computes trees, rocks and their colliders for cell (cx, cz). Deterministic per seed. */
export function generateCellPlacement(
  terrain: Terrain,
  seed: number,
  cx: number,
  cz: number,
): CellPlacement {
  const originX = cx * VEGETATION_CELL_SIZE;
  const originZ = cz * VEGETATION_CELL_SIZE;
  const grid = buildGrid(terrain, originX, originZ);
  const rng = mulberry32(hashInts(seed, cx, cz, Salt.Objects));
  const trees: TreePlacement[] = [];
  const rocks: RockPlacement[] = [];
  const colliders: Collider[] = [];
  const c: Candidate = { x: 0, z: 0, height: 0, normalY: 1, biome: 'ocean' };
  const minHeight = WATER_LEVEL + LIMITS.minHeightAboveWater;

  for (let i = 0; i < TREE_ATTEMPTS; i++) {
    sampleCandidate(grid, originX, originZ, rng, c);
    const roll = rng();
    if (c.height < minHeight || c.normalY < LIMITS.treeMinNormalY) continue;
    if (roll >= TREE_CHANCE[c.biome]) continue;
    const scale = randRange(rng, LIMITS.treeScale[0], LIMITS.treeScale[1]);
    const y = c.height - LIMITS.treeSink;
    trees.push({
      x: c.x,
      y,
      z: c.z,
      scale,
      rotation: rng() * Math.PI * 2,
      kind: rng() < CONIFER_CHANCE[c.biome] ? 'conifer' : 'broadleaf',
      tint: randRange(rng, LIMITS.tint[0], LIMITS.tint[1]),
    });
    colliders.push({
      x: c.x,
      z: c.z,
      radius: COLLIDER.treeRadius * scale,
      baseY: y,
      topY: y + COLLIDER.treeHeight * scale,
    });
  }

  for (let i = 0; i < ROCK_ATTEMPTS; i++) {
    sampleCandidate(grid, originX, originZ, rng, c);
    const roll = rng();
    if (c.height < minHeight || c.normalY < LIMITS.rockMinNormalY) continue;
    if (roll >= ROCK_CHANCE[c.biome]) continue;
    const scale = randRange(rng, LIMITS.rockScale[0], LIMITS.rockScale[1]);
    const y = c.height - LIMITS.rockSink * scale;
    rocks.push({
      x: c.x,
      y,
      z: c.z,
      scale,
      rotation: rng() * Math.PI * 2,
      tilt: (rng() - 0.5) * 2 * LIMITS.rockMaxTilt,
    });
    colliders.push({
      x: c.x,
      z: c.z,
      radius: COLLIDER.rockRadius * scale,
      baseY: y,
      topY: y + COLLIDER.rockHeight * scale,
    });
  }

  return { cx, cz, trees, rocks, colliders, grid };
}

/** Computes packed grass tufts for a cell (see {@link GRASS_STRIDE}). */
export function generateGrass(placement: CellPlacement, seed: number): Float32Array {
  const originX = placement.cx * VEGETATION_CELL_SIZE;
  const originZ = placement.cz * VEGETATION_CELL_SIZE;
  const rng = mulberry32(hashInts(seed, placement.cx, placement.cz, Salt.Grass));
  const out = new Float32Array(GRASS_ATTEMPTS * GRASS_STRIDE);
  const c: Candidate = { x: 0, z: 0, height: 0, normalY: 1, biome: 'ocean' };
  const minHeight = WATER_LEVEL + LIMITS.minHeightAboveWater;
  let count = 0;
  for (let i = 0; i < GRASS_ATTEMPTS; i++) {
    sampleCandidate(placement.grid, originX, originZ, rng, c);
    const roll = rng();
    if (c.height < minHeight || c.normalY < LIMITS.grassMinNormalY) continue;
    if (roll >= GRASS_CHANCE[c.biome]) continue;
    const o = count * GRASS_STRIDE;
    out[o] = c.x;
    out[o + 1] = c.height - LIMITS.grassSink;
    out[o + 2] = c.z;
    out[o + 3] = randRange(rng, LIMITS.grassScale[0], LIMITS.grassScale[1]);
    out[o + 4] = rng() * Math.PI * 2;
    out[o + 5] =
      randRange(rng, LIMITS.tint[0], LIMITS.tint[1]) *
      (c.biome === 'forest' ? LIMITS.forestGrassTint : 1);
    count++;
  }
  return out.slice(0, count * GRASS_STRIDE);
}
