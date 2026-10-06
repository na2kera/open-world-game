/** Uniform random generator returning values in [0, 1). */
export type Rng = () => number;

const UINT32_RANGE = 4294967296;
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;
const GOLDEN = 0x9e3779b9;

/** Mulberry32: tiny, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/** Hashes any number of integers into a well-mixed unsigned 32-bit value. */
export function hashInts(...values: number[]): number {
  let h = GOLDEN;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), MIX_A);
    h ^= h >>> 13;
    h = Math.imul(h, MIX_B);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Random float in [min, max). */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}
