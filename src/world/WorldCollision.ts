import { VEGETATION_CELL_SIZE } from '../config';
import { toCell } from './grid';
import type { Vec3Like } from './Terrain';
import type { Collider } from './vegetationPlacement';

/** Supplies the colliders of a cell. */
export interface ColliderProvider {
  getColliders(cx: number, cz: number): readonly Collider[];
}

/** Colliders can stick out of their cell by at most this much. */
const MAX_COLLIDER_RADIUS = 2.5;
const RESOLVE_ITERATIONS = 2;
const MIN_SEPARATION = 1e-6;

/** Pushes moving cylinders (the player) out of static cylinder obstacles. */
export class WorldCollision {
  private readonly extras: Collider[] = [];

  constructor(
    private readonly provider: ColliderProvider,
    private readonly cellSize: number = VEGETATION_CELL_SIZE,
  ) {}

  /** Permanent obstacles such as village huts and tower columns. */
  addCollider(collider: Collider): void {
    this.extras.push(collider);
  }

  /**
   * Moves `position` (feet) horizontally out of any overlapping collider.
   * Obstacles only block while the feet are below their top. Returns true on contact.
   */
  resolve(position: Vec3Like, radius: number): boolean {
    let hit = false;
    const reach = radius + MAX_COLLIDER_RADIUS;
    const minCx = toCell(position.x - reach, this.cellSize);
    const maxCx = toCell(position.x + reach, this.cellSize);
    const minCz = toCell(position.z - reach, this.cellSize);
    const maxCz = toCell(position.z + reach, this.cellSize);
    for (let iteration = 0; iteration < RESOLVE_ITERATIONS; iteration++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (const c of this.provider.getColliders(cx, cz)) {
            if (this.pushOut(position, radius, c)) hit = true;
          }
        }
      }
      for (const c of this.extras) {
        if (this.pushOut(position, radius, c)) hit = true;
      }
    }
    return hit;
  }

  private pushOut(position: Vec3Like, radius: number, c: Collider): boolean {
    if (position.y >= c.topY || position.y < c.baseY - radius) return false;
    const dx = position.x - c.x;
    const dz = position.z - c.z;
    const minDist = radius + c.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minDist * minDist) return false;
    const dist = Math.sqrt(distSq);
    if (dist < MIN_SEPARATION) {
      position.x = c.x + minDist;
    } else {
      const push = (minDist - dist) / dist;
      position.x += dx * push;
      position.z += dz * push;
    }
    return true;
  }
}
