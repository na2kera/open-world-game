import { PLATFORM_STEP_SNAP } from '../config';

/** Axis-aligned or yaw-rotated box the player can stand on. */
export interface Platform {
  readonly x: number;
  readonly z: number;
  readonly topY: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly yaw: number;
}

/**
 * Walkable surfaces that sit above the height field (tower stairs).
 * A platform counts only when its top is within a step of the feet, so the
 * player can pass underneath a higher landing.
 */
export class Platforms {
  private readonly items: Platform[] = [];

  add(platform: Platform): void {
    this.items.push(platform);
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Highest step the feet can land on, or undefined when nothing is under them. */
  heightAt(x: number, feetY: number, z: number): number | undefined {
    let best: number | undefined;
    for (const platform of this.items) {
      if (!contains(platform, x, z)) continue;
      if (platform.topY > feetY + PLATFORM_STEP_SNAP) continue;
      if (best === undefined || platform.topY > best) best = platform.topY;
    }
    return best;
  }
}

function contains(platform: Platform, x: number, z: number): boolean {
  const dx = x - platform.x;
  const dz = z - platform.z;
  const cos = Math.cos(platform.yaw);
  const sin = Math.sin(platform.yaw);
  // Inverse of a Three.js Y rotation, so `yaw` matches `mesh.rotation.y`.
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  return Math.abs(localX) <= platform.halfX && Math.abs(localZ) <= platform.halfZ;
}
