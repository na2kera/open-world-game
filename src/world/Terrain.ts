import { MAX_TERRAIN_HEIGHT, WATER_LEVEL, WORLD_HALF } from '../config';
import { clamp, lerp, smoothstep } from '../utils/math';
import { hashInts } from '../utils/random';
import { domainWarp, fbm, ridged, SimplexNoise2D, type WarpedPoint } from './noise';

/** Biome classification of a terrain point. */
export type Biome = 'ocean' | 'beach' | 'grassland' | 'forest' | 'highland' | 'mountain' | 'snow';

/** Mutable 3-component vector (structurally compatible with THREE.Vector3). */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Shape parameters of the height field. */
const SHAPE = {
  warpFrequency: 1 / 900,
  warpAmplitude: 220,
  warpOctaves: 2,
  continentFrequency: 1 / 1400,
  continentOctaves: 4,
  /** How strongly continent noise bends the radial coastline. */
  continentInfluence: 0.12,
  /** Normalised radius where land starts fading into the sea. */
  coastStart: 0.6,
  /** Normalised radius beyond which everything is ocean (≥ 1 - continentInfluence keeps edges wet). */
  coastEnd: 0.88,
  oceanFloor: -35,
  lowland: 6,
  hillFrequency: 1 / 280,
  hillOctaves: 4,
  hillHeight: 22,
  hillExponent: 1.5,
  mountainMaskFrequency: 1 / 1100,
  mountainMaskOctaves: 3,
  mountainMaskStart: -0.08,
  mountainMaskEnd: 0.3,
  ridgeFrequency: 1 / 520,
  ridgeOctaves: 5,
  mountainBase: 18,
  mountainHeight: 175,
  lakeFrequency: 1 / 380,
  lakeOctaves: 3,
  lakeStart: 0.32,
  lakeEnd: 0.55,
  lakeBottom: -8,
  detailFrequency: 1 / 40,
  detailOctaves: 2,
  detailHeight: 1.2,
  moistureFrequency: 1 / 700,
  moistureOctaves: 3,
} as const;

/** Height / moisture thresholds used by {@link classifyBiome}. */
export const BIOME_THRESHOLDS = {
  /** Below `WATER_LEVEL - oceanMargin` is water. */
  oceanMargin: 0.3,
  /** Up to `WATER_LEVEL + beach` is sand. */
  beach: 2,
  highland: 42,
  mountain: 85,
  snow: 130,
  /** Moisture above this turns grassland into forest. */
  forestMoisture: 0.08,
} as const;

/** Spawn search parameters. */
const SPAWN = {
  ringStep: 24,
  maxRadius: 1600,
  minHeight: WATER_LEVEL + 3,
  maxHeight: 30,
  minNormalY: 0.96,
  /** Neighbouring probes must also be dry land (avoid spawning on a lake shore). */
  probeDistance: 12,
} as const;

/** Distance used for central differences in {@link Terrain.normalAt}. */
const NORMAL_EPSILON = 1;

/** Salts that derive independent noise fields from one world seed. */
const enum NoiseSalt {
  WarpX = 1,
  WarpZ,
  Continent,
  Hills,
  MountainMask,
  Ridge,
  Lake,
  Detail,
  Moisture,
}

/** Classifies a biome from height and moisture (pure; shared by terrain colouring and minimap). */
export function classifyBiome(height: number, moisture: number): Biome {
  const t = BIOME_THRESHOLDS;
  if (height < WATER_LEVEL - t.oceanMargin) return 'ocean';
  if (height < WATER_LEVEL + t.beach) return 'beach';
  if (height > t.snow) return 'snow';
  if (height > t.mountain) return 'mountain';
  if (height > t.highland) return 'highland';
  return moisture > t.forestMoisture ? 'forest' : 'grassland';
}

/**
 * Deterministic procedural height field for the whole world (pure functions, no rendering).
 * The world is a {@link WORLD_HALF}*2 square island centred on the origin, surrounded by sea.
 */
export class Terrain {
  private readonly warpX: SimplexNoise2D;
  private readonly warpZ: SimplexNoise2D;
  private readonly continent: SimplexNoise2D;
  private readonly hills: SimplexNoise2D;
  private readonly mountainMask: SimplexNoise2D;
  private readonly ridge: SimplexNoise2D;
  private readonly lake: SimplexNoise2D;
  private readonly detail: SimplexNoise2D;
  private readonly moisture: SimplexNoise2D;
  private readonly warped: WarpedPoint = { x: 0, y: 0 };

  constructor(readonly seed: number) {
    const make = (salt: NoiseSalt): SimplexNoise2D => new SimplexNoise2D(hashInts(seed, salt));
    this.warpX = make(NoiseSalt.WarpX);
    this.warpZ = make(NoiseSalt.WarpZ);
    this.continent = make(NoiseSalt.Continent);
    this.hills = make(NoiseSalt.Hills);
    this.mountainMask = make(NoiseSalt.MountainMask);
    this.ridge = make(NoiseSalt.Ridge);
    this.lake = make(NoiseSalt.Lake);
    this.detail = make(NoiseSalt.Detail);
    this.moisture = make(NoiseSalt.Moisture);
  }

  /** Terrain surface height at world (x, z). */
  heightAt(x: number, z: number): number {
    const s = SHAPE;
    const w = domainWarp(
      this.warpX,
      this.warpZ,
      x,
      z,
      s.warpFrequency,
      s.warpAmplitude,
      s.warpOctaves,
      this.warped,
    );
    const wx = w.x;
    const wz = w.y;

    const radius = Math.hypot(x, z) / WORLD_HALF;
    const continent = fbm(
      this.continent,
      wx * s.continentFrequency,
      wz * s.continentFrequency,
      s.continentOctaves,
    );
    const land =
      1 - smoothstep(s.coastStart, s.coastEnd, radius - continent * s.continentInfluence);

    let height = lerp(s.oceanFloor, s.lowland, land);

    const hill01 =
      fbm(this.hills, wx * s.hillFrequency, wz * s.hillFrequency, s.hillOctaves) * 0.5 + 0.5;
    height += land * land * Math.pow(hill01, s.hillExponent) * s.hillHeight;

    const maskNoise = fbm(
      this.mountainMask,
      wx * s.mountainMaskFrequency,
      wz * s.mountainMaskFrequency,
      s.mountainMaskOctaves,
    );
    const mountainMask = smoothstep(s.mountainMaskStart, s.mountainMaskEnd, maskNoise) * land;
    if (mountainMask > 0) {
      const ridge = ridged(
        this.ridge,
        wx * s.ridgeFrequency,
        wz * s.ridgeFrequency,
        s.ridgeOctaves,
      );
      height += mountainMask * (s.mountainBase + ridge * ridge * s.mountainHeight);
    }

    const lakeNoise = fbm(this.lake, wx * s.lakeFrequency, wz * s.lakeFrequency, s.lakeOctaves);
    const lakeMask = smoothstep(s.lakeStart, s.lakeEnd, lakeNoise) * (1 - mountainMask) * land;
    if (lakeMask > 0) height = lerp(height, s.lakeBottom, lakeMask);

    height +=
      land *
      s.detailHeight *
      fbm(this.detail, x * s.detailFrequency, z * s.detailFrequency, s.detailOctaves);

    return Math.min(height, MAX_TERRAIN_HEIGHT);
  }

  /** Moisture in [-1, 1] at world (x, z); drives forest vs grassland. */
  moistureAt(x: number, z: number): number {
    const s = SHAPE;
    return fbm(this.moisture, x * s.moistureFrequency, z * s.moistureFrequency, s.moistureOctaves);
  }

  /** Unit surface normal at (x, z), written into `out`. */
  normalAt<T extends Vec3Like>(x: number, z: number, out: T): T {
    const dx = this.heightAt(x + NORMAL_EPSILON, z) - this.heightAt(x - NORMAL_EPSILON, z);
    const dz = this.heightAt(x, z + NORMAL_EPSILON) - this.heightAt(x, z - NORMAL_EPSILON);
    const nx = -dx;
    const ny = 2 * NORMAL_EPSILON;
    const nz = -dz;
    const length = Math.hypot(nx, ny, nz);
    out.x = nx / length;
    out.y = ny / length;
    out.z = nz / length;
    return out;
  }

  /** Biome at (x, z). */
  biomeAt(x: number, z: number): Biome {
    return classifyBiome(this.heightAt(x, z), this.moistureAt(x, z));
  }

  /** True if (x, z) lies within the playable square. */
  isInsideWorld(x: number, z: number): boolean {
    return Math.abs(x) <= WORLD_HALF && Math.abs(z) <= WORLD_HALF;
  }

  /** Clamps a coordinate to the world square shrunk by `margin`. */
  clampToWorld(value: number, margin: number): number {
    return clamp(value, -WORLD_HALF + margin, WORLD_HALF - margin);
  }

  /**
   * Finds a flat, dry grassland point by searching square rings outward from the origin.
   * The returned `y` is the ground height at that point.
   */
  findSpawnPoint<T extends Vec3Like>(out: T): T {
    const normal = { x: 0, y: 0, z: 0 };
    for (let radius = 0; radius <= SPAWN.maxRadius; radius += SPAWN.ringStep) {
      const steps = Math.max(1, Math.round((radius * 2) / SPAWN.ringStep));
      for (let i = 0; i < steps * 4; i++) {
        const side = Math.floor(i / steps);
        const t = (i % steps) / steps;
        const along = -radius + t * radius * 2;
        const x = side === 0 ? along : side === 1 ? radius : side === 2 ? -along : -radius;
        const z = side === 0 ? -radius : side === 1 ? along : side === 2 ? radius : -along;
        if (this.isGoodSpawn(x, z, normal)) {
          out.x = x;
          out.y = this.heightAt(x, z);
          out.z = z;
          return out;
        }
      }
    }
    out.x = 0;
    out.z = 0;
    out.y = Math.max(this.heightAt(0, 0), WATER_LEVEL + 1);
    return out;
  }

  private isGoodSpawn(x: number, z: number, normal: Vec3Like): boolean {
    const height = this.heightAt(x, z);
    if (height < SPAWN.minHeight || height > SPAWN.maxHeight) return false;
    if (this.biomeAt(x, z) !== 'grassland') return false;
    if (this.normalAt(x, z, normal).y < SPAWN.minNormalY) return false;
    const d = SPAWN.probeDistance;
    return (
      this.heightAt(x + d, z) > SPAWN.minHeight &&
      this.heightAt(x - d, z) > SPAWN.minHeight &&
      this.heightAt(x, z + d) > SPAWN.minHeight &&
      this.heightAt(x, z - d) > SPAWN.minHeight
    );
  }
}
