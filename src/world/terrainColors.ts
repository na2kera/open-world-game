import { Color } from 'three';

import { WATER_LEVEL } from '../config';
import { smoothstep } from '../utils/math';
import { BIOME_THRESHOLDS, type Biome } from './Terrain';

/** Representative colour of each biome (minimap, vegetation tints). */
export const BIOME_COLORS: Readonly<Record<Biome, number>> = {
  ocean: 0x2f5f86,
  beach: 0xd9c78f,
  grassland: 0x76a84a,
  forest: 0x3f7a36,
  highland: 0x8a9152,
  mountain: 0x80776c,
  snow: 0xf1f4f8,
  desert: 0xc6a15a,
  wetland: 0x3f6e58,
};

const LUSH_GRASS = new Color(0x4f8f3c);
const DRY_GRASS = new Color(0x9bb455);
const FOREST = new Color(BIOME_COLORS.forest);
const HIGHLAND = new Color(0x8f9a52);
const MOUNTAIN = new Color(0x857a6f);
const SNOW = new Color(BIOME_COLORS.snow);
const DESERT = new Color(BIOME_COLORS.desert);
const MARSH = new Color(BIOME_COLORS.wetland);
const SAND = new Color(BIOME_COLORS.beach);
const WET_SAND = new Color(0xb8a37a);
const SEABED = new Color(0x8c7f5c);
const DIRT = new Color(0x8a6b4a);
const ROCK = new Color(0x8b7f72);
const ROCK_COOL = new Color(0x7a7a7e);
const ROCK_WARM = new Color(0x9a8872);

/** Height / slope bands used for colour blending. */
const BANDS = {
  forestMoistureStart: BIOME_THRESHOLDS.forestMoisture - 0.12,
  forestMoistureEnd: BIOME_THRESHOLDS.forestMoisture + 0.12,
  beachTop: WATER_LEVEL + BIOME_THRESHOLDS.beach + 1,
  beachFull: WATER_LEVEL + BIOME_THRESHOLDS.beach - 0.5,
  /** Sand below this height reads as wet. */
  wetSandTop: WATER_LEVEL + 0.6,
  wetSandBlend: 0.25,
  seabedStart: WATER_LEVEL - 0.5,
  seabedFull: WATER_LEVEL - 4,
  highlandBlend: 8,
  mountainBlend: 10,
  snowBlend: 8,
  /** normal.y below which slopes start turning to bare dirt. */
  dirtStart: 0.84,
  /** normal.y at which slopes reach {@link BANDS.dirtMax}. */
  dirtFull: 0.72,
  /** Strongest blend toward dirt, so some grass hue survives. */
  dirtMax: 0.75,
  /** normal.y below which slopes start turning to rock. */
  rockStart: 0.78,
  /** normal.y at which slopes are fully rock. */
  rockFull: 0.6,
  /** Snow sticks only to surfaces flatter than this normal.y range. */
  snowSlopeStart: 0.55,
  snowSlopeEnd: 0.75,
} as const;

/** Noise frequencies (cycles per world unit) and amplitudes. */
const NOISE = {
  patchScale: 1 / 18,
  fineScale: 1 / 5,
  rockScale: 1 / 40,
  /** ± brightness from the fine noise. */
  fineAmount: 0.05,
  /** ± brightness of desert / marsh from the patch noise. */
  climateAmount: 0.08,
  strataAmount: 0.05,
  strataFrequency: 0.9,
  /** Highland patches above this noise value show rock through. */
  highlandRockStart: 0.62,
  highlandRockEnd: 0.82,
  highlandRockMax: 0.55,
} as const;

/** Hash of an integer lattice point into [0, 1). */
function latticeHash(ix: number, iz: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth deterministic 2-D value noise in [0, 1). Pure: no seed, no state. */
function valueNoise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = latticeHash(ix, iz);
  const b = latticeHash(ix + 1, iz);
  const c = latticeHash(ix, iz + 1);
  const d = latticeHash(ix + 1, iz + 1);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uz;
}

const tmpLayer = new Color();
const tmpRock = new Color();

/**
 * Vertex colour for a terrain point, blending biome bands by height, moisture and slope.
 * Writes linear RGB into `out`.
 */
export function terrainColorAt(
  height: number,
  normalY: number,
  moisture: number,
  x: number,
  z: number,
  out: Color,
): Color {
  const b = BANDS;
  const t = BIOME_THRESHOLDS;
  const n = NOISE;
  const patch = valueNoise2D(x * n.patchScale + 13.7, z * n.patchScale + 57.1);
  const fine = valueNoise2D(x * n.fineScale + 71.3, z * n.fineScale - 19.7);
  const rockNoise = valueNoise2D(x * n.rockScale - 403.1, z * n.rockScale + 211.9);
  const climateShade = 1 + (patch - 0.5) * 2 * n.climateAmount;

  out.copy(LUSH_GRASS).lerp(DRY_GRASS, smoothstep(0.3, 0.7, patch));
  out.lerp(FOREST, smoothstep(b.forestMoistureStart, b.forestMoistureEnd, moisture));
  const dry =
    smoothstep(-0.02, t.desertMoisture - 0.08, moisture) * (1 - smoothstep(26, 48, height));
  out.lerp(tmpLayer.copy(DESERT).multiplyScalar(climateShade), dry);
  const marsh =
    smoothstep(0.32, t.wetlandMoisture + 0.12, moisture) *
    smoothstep(t.wetlandHeight + 2, 4.5, height) *
    (1 - smoothstep(3.4, 1.4, height));
  out.lerp(tmpLayer.copy(MARSH).multiplyScalar(climateShade), marsh);

  // Rock: lighter base drifting cool / warm over large patches, with faint horizontal strata.
  if (rockNoise < 0.5) tmpRock.copy(ROCK).lerp(ROCK_COOL, (0.5 - rockNoise) * 2);
  else tmpRock.copy(ROCK).lerp(ROCK_WARM, (rockNoise - 0.5) * 2);
  tmpRock.multiplyScalar(1 + n.strataAmount * Math.sin(height * n.strataFrequency + rockNoise * 2));

  const highland = smoothstep(t.highland - b.highlandBlend, t.highland + b.highlandBlend, height);
  out.lerp(HIGHLAND, highland);
  out.lerp(
    tmpRock,
    highland * n.highlandRockMax * smoothstep(n.highlandRockStart, n.highlandRockEnd, patch),
  );
  out.lerp(
    MOUNTAIN,
    smoothstep(t.mountain - b.mountainBlend, t.mountain + b.mountainBlend, height),
  );
  tmpLayer
    .copy(WET_SAND)
    .lerp(SAND, smoothstep(b.wetSandTop - b.wetSandBlend, b.wetSandTop + b.wetSandBlend, height));
  const beachAmount = smoothstep(b.beachTop, b.beachFull, height);
  const seabedAmount = smoothstep(b.seabedStart, b.seabedFull, height);
  out.lerp(tmpLayer, beachAmount);
  out.lerp(SEABED, seabedAmount);
  // Bare dirt only on grassy slopes: not on dunes, beaches or the seabed.
  out.lerp(
    DIRT,
    b.dirtMax *
      smoothstep(b.dirtStart, b.dirtFull, normalY) *
      (1 - dry) *
      (1 - beachAmount) *
      (1 - seabedAmount),
  );
  out.lerp(tmpRock, smoothstep(b.rockStart, b.rockFull, normalY));
  const snow =
    smoothstep(t.snow - b.snowBlend, t.snow + b.snowBlend, height) *
    smoothstep(b.snowSlopeStart, b.snowSlopeEnd, normalY);
  out.lerp(SNOW, snow);
  return out.multiplyScalar(1 + (fine - 0.5) * 2 * n.fineAmount);
}
