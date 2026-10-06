export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential damping factor. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

const TWO_PI = Math.PI * 2;

/** Wraps an angle to (-π, π]. */
export function wrapAngle(angle: number): number {
  const wrapped = (((angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI;
  return wrapped - Math.PI;
}

/** Interpolates between two angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** {@link damp} for angles (shortest arc). */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return lerpAngle(current, target, 1 - Math.exp(-lambda * dt));
}

/** Moves `current` towards `target` by at most `maxDelta`. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}
