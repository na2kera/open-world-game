/** Quarter hearts per full heart. */
export const QUARTERS_PER_HEART = 4;

/** Filled quarters (0..4) of heart number `heartIndex` for `hp` quarter hearts. */
export function heartQuarters(hp: number, heartIndex: number): number {
  return Math.max(0, Math.min(QUARTERS_PER_HEART, hp - heartIndex * QUARTERS_PER_HEART));
}

/** Number of heart containers needed for `maxHp` quarter hearts. */
export function heartCount(maxHp: number): number {
  return Math.ceil(maxHp / QUARTERS_PER_HEART);
}
