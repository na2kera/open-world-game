import { Group } from 'three';
import { describe, expect, it } from 'vitest';

import { NPC_DEFS } from '../data/npcs';
import type { Collider } from './vegetationPlacement';
import {
  buildVillage,
  COOKING_POT_OFFSET,
  hutFootprint,
  type VillageTerrain,
} from './villageMeshes';

const SPAWN = { x: 120, z: -40 } as const;

const flatTerrain: VillageTerrain = {
  seed: 20260,
  heightAt: () => 8,
  // Wetter towards +X, so the fence goes on that side.
  moistureAt: (x) => x * 0.001,
};

function build(): { colliders: Collider[]; village: ReturnType<typeof buildVillage> } {
  const colliders: Collider[] = [];
  const village = buildVillage(
    new Group(),
    flatTerrain,
    { addCollider: (collider) => colliders.push(collider) },
    SPAWN,
  );
  return { colliders, village };
}

describe('buildVillage', () => {
  it('places all four huts on flat ground', () => {
    const { village } = build();
    expect(village.huts).toHaveLength(4);
    expect(new Set(village.huts.map((hut) => hut.kind))).toEqual(
      new Set(['cottage', 'round', 'long']),
    );
    for (const hut of village.huts) expect(hut.floorY).toBe(8);
    expect(village.geometries.length).toBeGreaterThan(0);
    expect(village.materials.length).toBeGreaterThan(0);
  });

  it('keeps every collider clear of the spawn, the NPCs and the cooking pot', () => {
    const { colliders } = build();
    const keepClear = [
      [SPAWN.x, SPAWN.z],
      [SPAWN.x + COOKING_POT_OFFSET.x, SPAWN.z + COOKING_POT_OFFSET.z],
      ...NPC_DEFS.map((def) => [SPAWN.x + def.offsetX, SPAWN.z + def.offsetZ]),
    ] as const;
    expect(colliders.length).toBeGreaterThan(10);
    for (const collider of colliders) {
      for (const [x, z] of keepClear) {
        expect(Math.hypot(collider.x - x, collider.z - z) - collider.radius).toBeGreaterThanOrEqual(
          2.5,
        );
      }
    }
  });

  it('covers every wall corner of the long house with a collider', () => {
    const { colliders, village } = build();
    const long = village.huts.find((hut) => hut.kind === 'long');
    expect(long).toBeDefined();
    if (!long) return;
    const { halfX, halfZ } = hutFootprint('long');
    const cos = Math.cos(long.yaw);
    const sin = Math.sin(long.yaw);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 0, 1]) {
        const lx = sx * halfX;
        const lz = sz * halfZ;
        const x = long.x + lx * cos + lz * sin;
        const z = long.z - lx * sin + lz * cos;
        const covered = colliders.some((c) => Math.hypot(c.x - x, c.z - z) <= c.radius);
        expect(covered, `corner (${lx}, ${lz})`).toBe(true);
      }
    }
    // Door-wall centre.
    const doorX = long.x + halfZ * sin;
    const doorZ = long.z + halfZ * cos;
    expect(colliders.some((c) => Math.hypot(c.x - doorX, c.z - doorZ) <= c.radius)).toBe(true);
  });
});
