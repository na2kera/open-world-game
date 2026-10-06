import { COMBAT_CONFIG } from '../config';

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

export interface ComboStage {
  readonly windup: number;
  readonly active: number;
  readonly recovery: number;
  /** Visual swing direction: -1 left, 1 right, 0 overhead. */
  readonly direction: -1 | 0 | 1;
  readonly damageScale: number;
}

export const COMBO_STAGES: readonly ComboStage[] = [
  { windup: 0.09, active: 0.11, recovery: 0.18, direction: 1, damageScale: 1 },
  { windup: 0.08, active: 0.12, recovery: 0.17, direction: -1, damageScale: 1 },
  { windup: 0.12, active: 0.14, recovery: 0.28, direction: 0, damageScale: 1.35 },
];

/** Short-lived edge buffer used to chain attacks even when pressed during recovery. */
export class ComboInputBuffer {
  private remaining = 0;

  constructor(private readonly duration: number = COMBAT_CONFIG.comboBufferSeconds) {}

  get hasInput(): boolean {
    return this.remaining > 0;
  }

  press(): void {
    this.remaining = this.duration;
  }

  update(dt: number): void {
    this.remaining = Math.max(0, this.remaining - dt);
  }

  consume(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining = 0;
    return true;
  }

  clear(): void {
    this.remaining = 0;
  }
}

/** True when the ground rises through the line of sight. The last stretch is ignored. */
export function isTerrainOccluded(
  heightAt: (x: number, z: number) => number,
  from: Readonly<{ x: number; y: number; z: number }>,
  to: Readonly<{ x: number; y: number; z: number }>,
): boolean {
  const samples = 6;
  for (let index = 1; index < samples; index++) {
    const t = index / samples;
    if (t > 0.82) break;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    if (heightAt(x, z) > y + 0.35) return true;
  }
  return false;
}

/** True when `target` is inside the horizontal forward-facing attack sector. */
export function isPointInAttackArc(
  origin: Point2,
  facing: number,
  target: Point2,
  range = COMBAT_CONFIG.attackRange,
  arcRadians = COMBAT_CONFIG.attackArcRadians,
): boolean {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const distanceSq = dx * dx + dz * dz;
  if (distanceSq > range * range) return false;
  if (distanceSq === 0) return true;
  const inverseDistance = 1 / Math.sqrt(distanceSq);
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  const dot = (dx * forwardX + dz * forwardZ) * inverseDistance;
  return dot >= Math.cos(arcRadians / 2);
}
