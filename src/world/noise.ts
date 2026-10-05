import { mulberry32 } from '../utils/random';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const PERM_SIZE = 256;
const PERM_MASK = PERM_SIZE - 1;
const GRADIENT_COUNT = 12;
/** Scales the raw simplex sum to roughly [-1, 1]. */
const SIMPLEX_SCALE = 70;

/** 12 gradient directions (x, y pairs). */
const GRADIENTS = new Float64Array([
  1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1,
]);

/** Seeded 2D simplex noise (Gustavson). Output is in [-1, 1]. */
export class SimplexNoise2D {
  private readonly perm = new Uint8Array(PERM_SIZE * 2);
  private readonly gradIndex = new Uint8Array(PERM_SIZE * 2);

  constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(PERM_SIZE);
    for (let i = 0; i < PERM_SIZE; i++) p[i] = i;
    for (let i = PERM_SIZE - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i]!;
      p[i] = p[j]!;
      p[j] = tmp;
    }
    for (let i = 0; i < PERM_SIZE * 2; i++) {
      const value = p[i & PERM_MASK]!;
      this.perm[i] = value;
      this.gradIndex[i] = (value % GRADIENT_COUNT) * 2;
    }
  }

  /** Samples noise at (x, y). */
  noise(x: number, y: number): number {
    const perm = this.perm;
    const gradIndex = this.gradIndex;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & PERM_MASK;
    const jj = j & PERM_MASK;

    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = gradIndex[ii + perm[jj]!]!;
      t0 *= t0;
      n += t0 * t0 * (GRADIENTS[g]! * x0 + GRADIENTS[g + 1]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = gradIndex[ii + i1 + perm[jj + j1]!]!;
      t1 *= t1;
      n += t1 * t1 * (GRADIENTS[g]! * x1 + GRADIENTS[g + 1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = gradIndex[ii + 1 + perm[jj + 1]!]!;
      t2 *= t2;
      n += t2 * t2 * (GRADIENTS[g]! * x2 + GRADIENTS[g + 1]! * y2);
    }
    return SIMPLEX_SCALE * n;
  }
}

/** Frequency multiplier between octaves. */
export const DEFAULT_LACUNARITY = 2;
/** Amplitude multiplier between octaves. */
export const DEFAULT_GAIN = 0.5;

/** Fractal Brownian motion over `noise`; normalised to [-1, 1]. */
export function fbm(
  noise: SimplexNoise2D,
  x: number,
  y: number,
  octaves: number,
  lacunarity = DEFAULT_LACUNARITY,
  gain = DEFAULT_GAIN,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * noise.noise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

/**
 * Ridged multifractal noise (sharp crests, good for mountain ranges); normalised to [0, 1].
 * Each octave is weighted by the previous one so ridges stay crisp.
 */
export function ridged(
  noise: SimplexNoise2D,
  x: number,
  y: number,
  octaves: number,
  lacunarity = DEFAULT_LACUNARITY,
  gain = DEFAULT_GAIN,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise.noise(x * frequency, y * frequency));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

/** Output of {@link domainWarp}. */
export interface WarpedPoint {
  x: number;
  y: number;
}

/**
 * Offsets (x, y) by two independent fBm fields, producing organic, swirly features when the
 * result is fed into another noise. Writes into `out` and returns it.
 */
export function domainWarp(
  noiseX: SimplexNoise2D,
  noiseY: SimplexNoise2D,
  x: number,
  y: number,
  frequency: number,
  amplitude: number,
  octaves: number,
  out: WarpedPoint,
): WarpedPoint {
  out.x = x + amplitude * fbm(noiseX, x * frequency, y * frequency, octaves);
  out.y = y + amplitude * fbm(noiseY, x * frequency, y * frequency, octaves);
  return out;
}
