/** Offset that keeps cell coordinates positive inside {@link cellKey}. */
const KEY_OFFSET = 32768;
const KEY_STRIDE = 65536;

/** Packs integer cell coordinates into one number (allocation-free map key). */
export function cellKey(cx: number, cz: number): number {
  return (cx + KEY_OFFSET) * KEY_STRIDE + (cz + KEY_OFFSET);
}

/** Cell coordinate containing world coordinate `value`. */
export function toCell(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

/** Horizontal distance from (x, z) to the square cell (cx, cz); 0 if inside. */
export function distanceToCell(
  x: number,
  z: number,
  cx: number,
  cz: number,
  cellSize: number,
): number {
  const minX = cx * cellSize;
  const minZ = cz * cellSize;
  const dx = Math.max(minX - x, 0, x - (minX + cellSize));
  const dz = Math.max(minZ - z, 0, z - (minZ + cellSize));
  return Math.hypot(dx, dz);
}
