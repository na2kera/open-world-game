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

const GRASS = new Color(BIOME_COLORS.grassland);
const FOREST = new Color(BIOME_COLORS.forest);
const HIGHLAND = new Color(BIOME_COLORS.highland);
const MOUNTAIN = new Color(BIOME_COLORS.mountain);
const SNOW = new Color(BIOME_COLORS.snow);
const DESERT = new Color(BIOME_COLORS.desert);
const MARSH = new Color(BIOME_COLORS.wetland);
const SAND = new Color(BIOME_COLORS.beach);
const SEABED = new Color(0x8c7f5c);
const ROCK = new Color(0x75695e);

/** Height / slope bands used for colour blending. */
const BANDS = {
  forestMoistureStart: BIOME_THRESHOLDS.forestMoisture - 0.12,
  forestMoistureEnd: BIOME_THRESHOLDS.forestMoisture + 0.12,
  beachTop: WATER_LEVEL + BIOME_THRESHOLDS.beach + 1,
  beachFull: WATER_LEVEL + BIOME_THRESHOLDS.beach - 0.5,
  seabedStart: WATER_LEVEL - 0.5,
  seabedFull: WATER_LEVEL - 4,
  highlandBlend: 8,
  mountainBlend: 10,
  snowBlend: 8,
  /** normal.y below which slopes start turning to rock. */
  rockStart: 0.8,
  /** normal.y at which slopes are fully rock. */
  rockFull: 0.64,
  /** Snow sticks only to surfaces flatter than this normal.y range. */
  snowSlopeStart: 0.55,
  snowSlopeEnd: 0.75,
  /** ± brightness jitter amplitude per vertex. */
  jitter: 0.06,
} as const;

const HASH_X = 12.9898;
const HASH_Z = 78.233;
const HASH_SCALE = 43758.5453;

/** Cheap deterministic pseudo-random value in [0, 1) from a position. */
function positionHash(x: number, z: number): number {
  const v = Math.sin(x * HASH_X + z * HASH_Z) * HASH_SCALE;
  return v - Math.floor(v);
}

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
  out.copy(GRASS).lerp(FOREST, smoothstep(b.forestMoistureStart, b.forestMoistureEnd, moisture));
  const dry =
    smoothstep(-0.02, BIOME_THRESHOLDS.desertMoisture - 0.08, moisture) *
    (1 - smoothstep(26, 48, height));
  out.lerp(DESERT, dry);
  const marsh =
    smoothstep(0.32, BIOME_THRESHOLDS.wetlandMoisture + 0.12, moisture) *
    smoothstep(BIOME_THRESHOLDS.wetlandHeight + 2, 4.5, height) *
    (1 - smoothstep(3.4, 1.4, height));
  out.lerp(MARSH, marsh);
  out.lerp(
    HIGHLAND,
    smoothstep(t.highland - b.highlandBlend, t.highland + b.highlandBlend, height),
  );
  out.lerp(
    MOUNTAIN,
    smoothstep(t.mountain - b.mountainBlend, t.mountain + b.mountainBlend, height),
  );
  out.lerp(SAND, smoothstep(b.beachTop, b.beachFull, height));
  out.lerp(SEABED, smoothstep(b.seabedStart, b.seabedFull, height));
  out.lerp(ROCK, smoothstep(b.rockStart, b.rockFull, normalY));
  const snow =
    smoothstep(t.snow - b.snowBlend, t.snow + b.snowBlend, height) *
    smoothstep(b.snowSlopeStart, b.snowSlopeEnd, normalY);
  out.lerp(SNOW, snow);
  const jitter = 1 + (positionHash(x, z) - 0.5) * 2 * b.jitter;
  return out.multiplyScalar(jitter);
}
