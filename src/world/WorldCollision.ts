import { PLATFORM_STEP_SNAP, VEGETATION_CELL_SIZE } from '../config';
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

export interface ClimbTarget {
  readonly x: number;
  readonly z: number;
  readonly topY: number;
  readonly radius: number;
}

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

  /**
   * Highest rock or tree top under the feet that can be stepped or landed on.
   * Tops far above the feet are ignored so a tall trunk is climbed, not teleported onto.
   */
  supportHeight(x: number, feetY: number, z: number): number | undefined {
    let best: number | undefined;
    this.visit(x, z, (collider) => {
      const dx = x - collider.x;
      const dz = z - collider.z;
      if (dx * dx + dz * dz > collider.radius * collider.radius) return;
      if (collider.topY > feetY + PLATFORM_STEP_SNAP) return;
      if (best === undefined || collider.topY > best) best = collider.topY;
    });
    return best;
  }

  /**
   * A rock or trunk the player is walking into. Used to climb onto the top
   * instead of being slid around the base.
   */
  climbTarget(
    x: number,
    feetY: number,
    z: number,
    bodyRadius: number,
    dirX: number,
    dirZ: number,
  ): ClimbTarget | null {
    const dirLength = Math.hypot(dirX, dirZ);
    if (dirLength < 1e-4) return null;
    const found: { collider: Collider | null; distance: number } = {
      collider: null,
      distance: Number.POSITIVE_INFINITY,
    };
    this.visit(x, z, (collider) => {
      if (feetY >= collider.topY || feetY < collider.baseY - bodyRadius) return;
      const dx = collider.x - x;
      const dz = collider.z - z;
      const distance = Math.hypot(dx, dz);
      const reach = bodyRadius + collider.radius + 0.45;
      if (distance > reach || distance < 1e-4 || distance >= found.distance) return;
      if ((dirX * dx + dirZ * dz) / (dirLength * distance) < 0.35) return;
      found.collider = collider;
      found.distance = distance;
    });
    const chosen = found.collider;
    if (!chosen) return null;
    return { x: chosen.x, z: chosen.z, topY: chosen.topY, radius: chosen.radius };
  }

  /** True when a trunk or boulder stands between two points, ignoring the last stretch. */
  blocksSight(from: Readonly<Vec3Like>, to: Readonly<Vec3Like>): boolean {
    const samples = 6;
    for (let index = 1; index < samples; index++) {
      const t = index / samples;
      if (t > 0.82) break;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      let blocked = false;
      this.visit(x, z, (collider) => {
        if (blocked || y < collider.baseY || y > collider.topY) return;
        const dx = x - collider.x;
        const dz = z - collider.z;
        if (dx * dx + dz * dz <= collider.radius * collider.radius) blocked = true;
      });
      if (blocked) return true;
    }
    return false;
  }

  private visit(x: number, z: number, visitor: (collider: Collider) => void): void {
    const reach = MAX_COLLIDER_RADIUS;
    const minCx = toCell(x - reach, this.cellSize);
    const maxCx = toCell(x + reach, this.cellSize);
    const minCz = toCell(z - reach, this.cellSize);
    const maxCz = toCell(z + reach, this.cellSize);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (const collider of this.provider.getColliders(cx, cz)) visitor(collider);
      }
    }
    for (const collider of this.extras) visitor(collider);
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
