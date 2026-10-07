import { VEGETATION_CELL_SIZE, WATER_LEVEL } from '../config';
import { lerp } from '../utils/math';
import { hashInts, mulberry32, randRange, type Rng } from '../utils/random';
import { classifyBiome, type Biome, type Terrain } from './Terrain';
import { drynessAt } from './terrainColors';

export type TreeKind = 'conifer' | 'broadleaf' | 'cactus' | 'reed';

export type RuinKind =
  'cottage' | 'stones' | 'arch' | 'cairn' | 'adobe' | 'stilt' | 'shelter' | 'wreck';

export interface RuinPlacement {
  x: number;
  y: number;
  z: number;
  rotation: number;
  kind: RuinKind;
}

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

/** Packed grass instances: x, y, z, scale, rotation, r, g, b per tuft. */
export const GRASS_STRIDE = 8;

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
  readonly ruins: readonly RuinPlacement[];
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
const GRASS_ATTEMPTS = 5200;

const TREE_CHANCE: Readonly<Record<Biome, number>> = {
  ocean: 0,
  beach: 0,
  grassland: 0.05,
  forest: 0.6,
  highland: 0.22,
  mountain: 0.03,
  snow: 0,
  desert: 0.14,
  wetland: 0.16,
};
const CONIFER_CHANCE: Readonly<Record<Biome, number>> = {
  ocean: 0,
  beach: 0,
  grassland: 0.1,
  forest: 0.5,
  highland: 0.95,
  mountain: 1,
  snow: 1,
  desert: 0,
  wetland: 0.05,
};
const ROCK_CHANCE: Readonly<Record<Biome, number>> = {
  ocean: 0,
  beach: 0.05,
  grassland: 0.03,
  forest: 0.04,
  highland: 0.2,
  mountain: 0.4,
  snow: 0.15,
  desert: 0.16,
  wetland: 0.02,
};
/** Dry straw tint and grass density on sand, blended in by {@link drynessAt}. */
const STRAW_TINT = [1.3, 1.05, 0.4] as const;
const DESERT_GRASS_CHANCE = 0.05;

const GRASS_CHANCE: Readonly<Record<Biome, number>> = {
  ocean: 0,
  beach: 0,
  grassland: 0.85,
  forest: 0.35,
  highland: 0.25,
  mountain: 0,
  snow: 0,
  desert: DESERT_GRASS_CHANCE,
  wetland: 0.72,
};

/** Per-biome RGB multiplier for grass tufts (biomes not listed use white). */
const GRASS_TINT: Readonly<Partial<Record<Biome, readonly [number, number, number]>>> = {
  forest: [0.75, 0.85, 0.75],
  wetland: [0.8, 0.95, 0.85],
  highland: [1.05, 1.0, 0.8],
};
const NEUTRAL_TINT = [1, 1, 1] as const;

/** Placement limits. */
const LIMITS = {
  minHeightAboveWater: 0.8,
  treeMinNormalY: 0.85,
  rockMinNormalY: 0.55,
  grassMinNormalY: 0.8,
  treeScale: [0.8, 1.45],
  rockScale: [0.5, 2.2],
  grassScale: [0.6, 1.1],
  tint: [0.8, 1.15],
  rockMaxTilt: 0.4,
  /** Trees / rocks are sunk slightly to hide interpolation error on slopes. */
  treeSink: 0.3,
  rockSink: 0.35,
  grassSink: 0.05,
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
  Ruins = 13,
}

/** Ruins stay outside the village and its immediate fields. */
const RUIN_CLEARANCE = 140;
const RUIN_CHANCE = 0.62;
const RUIN_TRIES = 6;

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
  moisture: number;
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
  out.moisture = bilinear(grid.moisture, MOISTURE_SIDE, MOISTURE_SPACING, lx, lz);
  out.biome = classifyBiome(h, out.moisture);
  return out;
}

/** Computes trees, rocks and their colliders for cell (cx, cz). Deterministic per seed. */
export function generateCellPlacement(
  terrain: Terrain,
  seed: number,
  cx: number,
  cz: number,
  spawnX = 0,
  spawnZ = 0,
): CellPlacement {
  const originX = cx * VEGETATION_CELL_SIZE;
  const originZ = cz * VEGETATION_CELL_SIZE;
  const grid = buildGrid(terrain, originX, originZ);
  const rng = mulberry32(hashInts(seed, cx, cz, Salt.Objects));
  const trees: TreePlacement[] = [];
  const rocks: RockPlacement[] = [];
  const ruins: RuinPlacement[] = [];
  const colliders: Collider[] = [];
  const c: Candidate = { x: 0, z: 0, height: 0, normalY: 1, moisture: 0, biome: 'ocean' };
  const minHeight = WATER_LEVEL + LIMITS.minHeightAboveWater;

  for (let i = 0; i < TREE_ATTEMPTS; i++) {
    sampleCandidate(grid, originX, originZ, rng, c);
    const roll = rng();
    if (c.height < minHeight || c.normalY < LIMITS.treeMinNormalY) continue;
    if (roll >= TREE_CHANCE[c.biome]) continue;
    const scale = randRange(rng, LIMITS.treeScale[0], LIMITS.treeScale[1]);
    const y = c.height - LIMITS.treeSink;
    const kind = treeKind(c.biome, rng);
    trees.push({
      x: c.x,
      y,
      z: c.z,
      scale,
      rotation: rng() * Math.PI * 2,
      kind,
      tint: randRange(rng, LIMITS.tint[0], LIMITS.tint[1]),
    });
    const size = plantSize(kind);
    colliders.push({
      x: c.x,
      z: c.z,
      radius: size.radius * scale,
      baseY: y,
      topY: y + size.height * scale,
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

  placeRuin(seed, cx, cz, spawnX, spawnZ, grid, originX, originZ, ruins, colliders);
  return { cx, cz, trees, rocks, ruins, colliders, grid };
}

/** Computes packed grass tufts for a cell (see {@link GRASS_STRIDE}). */
export function generateGrass(placement: CellPlacement, seed: number): Float32Array {
  const originX = placement.cx * VEGETATION_CELL_SIZE;
  const originZ = placement.cz * VEGETATION_CELL_SIZE;
  const rng = mulberry32(hashInts(seed, placement.cx, placement.cz, Salt.Grass));
  const out = new Float32Array(GRASS_ATTEMPTS * GRASS_STRIDE);
  const c: Candidate = { x: 0, z: 0, height: 0, normalY: 1, moisture: 0, biome: 'ocean' };
  const minHeight = WATER_LEVEL + LIMITS.minHeightAboveWater;
  let count = 0;
  for (let i = 0; i < GRASS_ATTEMPTS; i++) {
    sampleCandidate(placement.grid, originX, originZ, rng, c);
    // Every attempt draws the same numbers, whether or not a tuft is placed.
    const roll = rng();
    const scale = randRange(rng, LIMITS.grassScale[0], LIMITS.grassScale[1]);
    const rotation = rng() * Math.PI * 2;
    const brightness = randRange(rng, LIMITS.tint[0], LIMITS.tint[1]);
    if (c.height < minHeight || c.normalY < LIMITS.grassMinNormalY) continue;
    // Follow the visible sand blend rather than the hard biome threshold.
    const dry = drynessAt(c.height, c.moisture);
    // Desert borders grassland on the moisture axis: start from grassland there so density
    // and tint are continuous across the biome threshold.
    const base = c.biome === 'desert' ? 'grassland' : c.biome;
    if (roll >= lerp(GRASS_CHANCE[base], DESERT_GRASS_CHANCE, dry)) continue;
    const tint = GRASS_TINT[base] ?? NEUTRAL_TINT;
    const o = count * GRASS_STRIDE;
    out[o] = c.x;
    out[o + 1] = c.height - LIMITS.grassSink;
    out[o + 2] = c.z;
    out[o + 3] = scale;
    out[o + 4] = rotation;
    out[o + 5] = brightness * lerp(tint[0], STRAW_TINT[0], dry);
    out[o + 6] = brightness * lerp(tint[1], STRAW_TINT[1], dry);
    out[o + 7] = brightness * lerp(tint[2], STRAW_TINT[2], dry);
    count++;
  }
  return out.slice(0, count * GRASS_STRIDE);
}

function treeKind(biome: Biome, rng: Rng): TreeKind {
  if (biome === 'desert') return 'cactus';
  if (biome === 'wetland') return rng() < 0.72 ? 'reed' : 'broadleaf';
  return rng() < CONIFER_CHANCE[biome] ? 'conifer' : 'broadleaf';
}

function plantSize(kind: TreeKind): { radius: number; height: number } {
  if (kind === 'cactus') return { radius: 0.38, height: 3.2 };
  if (kind === 'reed') return { radius: 0.22, height: 1.6 };
  return { radius: COLLIDER.treeRadius, height: COLLIDER.treeHeight };
}

function placeRuin(
  seed: number,
  cx: number,
  cz: number,
  spawnX: number,
  spawnZ: number,
  grid: CellGrid,
  originX: number,
  originZ: number,
  ruins: RuinPlacement[],
  colliders: Collider[],
): void {
  const rng = mulberry32(hashInts(seed, cx, cz, Salt.Ruins));
  if (rng() > RUIN_CHANCE) return;
  const c: Candidate = { x: 0, z: 0, height: 0, normalY: 1, moisture: 0, biome: 'ocean' };
  const minHeight = WATER_LEVEL + 1.4;
  for (let attempt = 0; attempt < RUIN_TRIES; attempt++) {
    sampleCandidate(grid, originX, originZ, rng, c);
    if (c.height < minHeight || c.normalY < 0.86) continue;
    if (Math.hypot(c.x - spawnX, c.z - spawnZ) < RUIN_CLEARANCE) return;
    const kind = ruinKind(c.biome, rng);
    if (!kind) continue;
    const rotation = rng() * Math.PI * 2;
    ruins.push({ x: c.x, y: c.height, z: c.z, rotation, kind });
    addRuinColliders(colliders, c.x, c.height, c.z, rotation, kind);
    return;
  }
}

function ruinKind(biome: Biome, rng: Rng): RuinKind | null {
  switch (biome) {
    case 'ocean':
      return null;
    case 'beach':
      return 'wreck';
    case 'desert':
      return rng() < 0.65 ? 'adobe' : 'arch';
    case 'wetland':
      return rng() < 0.7 ? 'stilt' : 'wreck';
    case 'grassland':
      return rng() < 0.55 ? 'cottage' : 'stones';
    case 'forest':
      return rng() < 0.45 ? 'arch' : 'stones';
    case 'highland':
      return rng() < 0.5 ? 'cairn' : 'shelter';
    case 'mountain':
      return 'cairn';
    case 'snow':
      return rng() < 0.6 ? 'shelter' : 'cairn';
  }
}

function addRuinColliders(
  colliders: Collider[],
  x: number,
  y: number,
  z: number,
  yaw: number,
  kind: RuinKind,
): void {
  const column = (ox: number, oz: number, radius: number, height: number, base = 0): void => {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    colliders.push({
      x: x + ox * cos - oz * sin,
      z: z + ox * sin + oz * cos,
      radius,
      baseY: y + base,
      topY: y + base + height,
    });
  };
  switch (kind) {
    case 'cottage':
    case 'adobe':
    case 'shelter':
      column(0, 0, 1.55, kind === 'shelter' ? 1.7 : 2.5);
      break;
    case 'stones':
      for (let index = 0; index < 5; index++) {
        const angle = (index / 5) * Math.PI * 2;
        column(Math.cos(angle) * 2.15, Math.sin(angle) * 2.15, 0.38, 1.3 + (index % 2) * 0.7);
      }
      break;
    case 'arch':
      column(-1.15, 0, 0.38, 2.4);
      column(1.15, 0, 0.38, 2.4);
      break;
    case 'cairn':
      column(0, 0, 0.85, 1.5);
      break;
    case 'stilt':
      column(0, 0, 1.25, 0.28, 1.15);
      column(-0.8, -0.7, 0.18, 1.3);
      column(0.8, -0.7, 0.18, 1.3);
      column(-0.8, 0.7, 0.18, 1.3);
      column(0.8, 0.7, 0.18, 1.3);
      break;
    case 'wreck':
      column(-0.7, 0, 0.22, 1.6);
      column(0.8, 0.3, 0.22, 1.2);
      break;
  }
}
