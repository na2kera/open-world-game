import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MeshStandardMaterial,
  TorusGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';

import { NPC_DEFS } from '../data/npcs';
import { MeshKit, paint, type Paint } from '../entities/meshKit';
import { hashInts, mulberry32 } from '../utils/random';
import type { Collider } from './vegetationPlacement';

/** Cooking pot offset from the spawn point (GameplayFlow places the pot here). */
export const COOKING_POT_OFFSET = { x: 5.5, z: -4.5 } as const;

/** Terrain queries the village needs. */
export interface VillageTerrain {
  readonly seed: number;
  heightAt(x: number, z: number): number;
  moistureAt(x: number, z: number): number;
}

export interface VillageCollision {
  addCollider(collider: Collider): void;
}

type HutKind = 'cottage' | 'round' | 'long';

/** Hut spots relative to the spawn and their variant. */
const HUT_SPOTS: readonly { x: number; z: number; kind: HutKind }[] = [
  { x: 14, z: 5, kind: 'cottage' },
  { x: -13, z: 7, kind: 'round' },
  { x: 5, z: -14, kind: 'long' },
  { x: -11, z: -11, kind: 'cottage' },
];

/** Half extents of each footprint (x along the hut's width, z along its depth). */
const FOOTPRINT: Readonly<Record<HutKind, { halfX: number; halfZ: number; radius: number }>> = {
  cottage: { halfX: 1.6, halfZ: 1.6, radius: 2.1 },
  round: { halfX: 1.75, halfZ: 1.75, radius: 1.85 },
  long: { halfX: 2.3, halfZ: 1.5, radius: 2 },
};

/** Local x of the long-house collider circles (radius in {@link FOOTPRINT}). */
const LONG_HOUSE_COLLIDER_X = [-1.25, 0, 1.25] as const;

const VILLAGE = {
  /** Huts below this height (beach / water) are skipped. */
  minHutHeight: 1,
  /** ± yaw jitter around facing the village centre. */
  yawJitter: 0.3,
  /** The stone plinth reaches this far below the floor so slopes never show a gap. */
  plinthDepth: 1.6,
  /** On steep spots the plinth goes this far below the lowest footprint point. */
  plinthEmbed: 0.4,
  plinthLip: 0.2,
  plinthMargin: 0.25,
  /** Space between a plinth edge and props stacked beside it. */
  propGap: 0.1,
  /** Nothing may be placed within this distance of the spawn, an NPC or the pot. */
  clearRadius: 2.5,
  fenceRadius: 21,
  fenceSegments: 5,
  fenceLength: 2.4,
  forestProbeRadius: 26,
  forestProbeDirections: 16,
} as const;

const COLORS = {
  plaster: 0xc4a574,
  plank: 0xb08d62,
  timber: 0x5a3924,
  darkTimber: 0x3e2a1a,
  shutter: 0x7a5a3a,
  roof: 0x8d3d32,
  tile: 0x6f4f3a,
  thatch: 0xc9a85c,
  stone: 0x9a9388,
  plinth: 0x7d766c,
  chimney: 0x6e5344,
  window: 0xffd7a1,
  water: 0x2f5f86,
  crate: 0x9a7448,
  barrel: 0x80562f,
  iron: 0x3b3a38,
  log: 0x8a6240,
  lamp: 0xffe0a8,
} as const;

type Finish = 'matte' | 'window' | 'lamp';
type VillagePaint = Paint<Finish>;

const SEED_SALT = 0x5117;

/** One placed hut: world position, yaw and its floor. */
export interface HutPlacement {
  readonly kind: HutKind;
  readonly x: number;
  readonly z: number;
  readonly floorY: number;
  readonly yaw: number;
}

/** What {@link buildVillage} created; the caller disposes the GPU resources. */
export interface BuiltVillage {
  readonly huts: readonly HutPlacement[];
  readonly geometries: readonly BufferGeometry[];
  readonly materials: readonly MeshStandardMaterial[];
}

/** Wall half extents of a hut kind (for tests / tooling). */
export function hutFootprint(kind: HutKind): { readonly halfX: number; readonly halfZ: number } {
  return FOOTPRINT[kind];
}

/**
 * Builds the village around `spawn`: three hut variants facing the centre on stone plinths,
 * plus a well, fences on the forest side, crates, a barrel, lantern posts and a woodpile.
 * Everything is merged per material.
 */
export function buildVillage(
  parent: Object3D,
  terrain: VillageTerrain,
  collision: VillageCollision,
  spawn: { readonly x: number; readonly z: number },
): BuiltVillage {
  const materials = new Map<Finish, MeshStandardMaterial>();
  const material = (finish: Finish): MeshStandardMaterial => {
    let result = materials.get(finish);
    if (!result) {
      result = createMaterial(finish);
      materials.set(finish, result);
    }
    return result;
  };
  const geometries: BufferGeometry[] = [];
  const rng = mulberry32(hashInts(terrain.seed, SEED_SALT));
  const huts: HutPlacement[] = [];

  for (const spot of HUT_SPOTS) {
    const jitter = (rng() * 2 - 1) * VILLAGE.yawJitter;
    const x = spawn.x + spot.x;
    const z = spawn.z + spot.z;
    if (terrain.heightAt(x, z) < VILLAGE.minHutHeight) continue;
    const yaw = Math.atan2(spawn.x - x, spawn.z - z) + jitter;
    const ground = footprintRange(terrain, x, z, yaw, FOOTPRINT[spot.kind]);
    const floorY = ground.top;
    // At least plinthDepth, deeper on steep spots so the low side never shows a gap.
    const plinthDepth = Math.max(VILLAGE.plinthDepth, floorY - ground.bottom + VILLAGE.plinthEmbed);
    const hut = new Group();
    hut.position.set(x, floorY, z);
    hut.rotation.y = yaw;
    parent.add(hut);
    const kit = new MeshKit<Finish>();
    buildHut(kit, hut, spot.kind, plinthDepth);
    kit.bake({ joints: [hut], geometries, material, receiveShadow: true });
    huts.push({ kind: spot.kind, x, z, floorY, yaw });
    addHutColliders(collision, spot.kind, x, z, yaw, floorY, plinthDepth);
  }

  const props = new Group();
  props.name = 'village-props';
  parent.add(props);
  const kit = new MeshKit<Finish>();
  const blocked = clearPoints(spawn);
  const place = (
    x: number,
    z: number,
    radius: number,
    height: number,
    build: (y: number) => void,
  ): void => {
    if (!isClear(blocked, x, z, radius)) return;
    const y = terrain.heightAt(x, z);
    build(y);
    collision.addCollider({ x, z, radius, baseY: y, topY: y + height });
  };

  place(spawn.x - 3.5, spawn.z + 3.5, 1, 2.4, (y) =>
    well(kit, props, spawn.x - 3.5, y, spawn.z + 3.5),
  );
  for (const [dx, dz] of [
    [3, 4],
    [-4, -4],
  ] as const) {
    place(spawn.x + dx, spawn.z + dz, 0.25, 2.4, (y) =>
      lanternPost(kit, props, spawn.x + dx, y, spawn.z + dz),
    );
  }
  place(spawn.x + 10, spawn.z + 9, 0.8, 0.7, (y) =>
    woodpile(kit, props, spawn.x + 10, y, spawn.z + 9),
  );

  // Crates and a barrel beside a cottage (or any hut), just outside its plinth on the right.
  const storeHut = huts.find((hut) => hut.kind === 'cottage') ?? huts[0];
  if (storeHut) {
    const side = -(FOOTPRINT[storeHut.kind].halfX + VILLAGE.plinthMargin + VILLAGE.propGap);
    const items: readonly {
      lz: number;
      radius: number;
      kind: 'crate' | 'small-crate' | 'barrel';
    }[] = [
      { lz: 0.7, radius: 0.5, kind: 'crate' },
      { lz: 1.6, radius: 0.35, kind: 'small-crate' },
      { lz: -0.6, radius: 0.5, kind: 'barrel' },
    ];
    for (const item of items) {
      const [x, z] = hutToWorld(storeHut, side - item.radius, item.lz);
      const radius = item.radius;
      place(x, z, radius, 0.8, (y) => {
        if (item.kind === 'barrel') barrel(kit, props, x, y, z);
        else {
          const big = item.kind === 'crate';
          crate(kit, props, x, y, z, big ? 0.7 : 0.48, storeHut.yaw + (big ? 0.2 : -0.35));
        }
      });
    }
  }

  // Fence along the forest edge (the wettest side of the village).
  const fenceAngle = forestSide(terrain, spawn);
  const segmentArc = VILLAGE.fenceLength / VILLAGE.fenceRadius;
  for (let i = 0; i < VILLAGE.fenceSegments; i++) {
    const angle = fenceAngle + (i - (VILLAGE.fenceSegments - 1) / 2) * segmentArc * 1.08;
    const x = spawn.x + Math.sin(angle) * VILLAGE.fenceRadius;
    const z = spawn.z + Math.cos(angle) * VILLAGE.fenceRadius;
    if (!isClear(blocked, x, z, VILLAGE.fenceLength / 2)) continue;
    const y = terrain.heightAt(x, z);
    // Yaw = angle turns the rails along the circle's tangent (cos a, -sin a).
    fence(kit, props, x, y, z, angle);
    for (const t of [-0.5, 0, 0.5]) {
      collision.addCollider({
        x: x + Math.cos(angle) * t * VILLAGE.fenceLength,
        z: z - Math.sin(angle) * t * VILLAGE.fenceLength,
        radius: 0.45,
        baseY: y - 0.5,
        topY: y + 1.1,
      });
    }
  }
  kit.bake({ joints: [props], geometries, material, receiveShadow: true });
  return { huts, geometries, materials: [...materials.values()] };
}

function createMaterial(finish: Finish): MeshStandardMaterial {
  switch (finish) {
    case 'window':
      return new MeshStandardMaterial({
        vertexColors: true,
        emissive: 0xffb15a,
        emissiveIntensity: 0.35,
        roughness: 0.3,
      });
    case 'lamp':
      return new MeshStandardMaterial({
        vertexColors: true,
        emissive: 0xffb15a,
        emissiveIntensity: 0.9,
        roughness: 0.4,
      });
    case 'matte':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  }
}

const P = {
  plaster: paint<Finish>(COLORS.plaster, 'matte'),
  plank: paint<Finish>(COLORS.plank, 'matte'),
  timber: paint<Finish>(COLORS.timber, 'matte'),
  darkTimber: paint<Finish>(COLORS.darkTimber, 'matte'),
  shutter: paint<Finish>(COLORS.shutter, 'matte'),
  roof: paint<Finish>(COLORS.roof, 'matte'),
  tile: paint<Finish>(COLORS.tile, 'matte'),
  thatch: paint<Finish>(COLORS.thatch, 'matte'),
  stone: paint<Finish>(COLORS.stone, 'matte'),
  plinth: paint<Finish>(COLORS.plinth, 'matte'),
  chimney: paint<Finish>(COLORS.chimney, 'matte'),
  water: paint<Finish>(COLORS.water, 'matte'),
  crate: paint<Finish>(COLORS.crate, 'matte'),
  barrel: paint<Finish>(COLORS.barrel, 'matte'),
  iron: paint<Finish>(COLORS.iron, 'matte'),
  log: paint<Finish>(COLORS.log, 'matte'),
  window: paint<Finish>(COLORS.window, 'window'),
  lamp: paint<Finish>(COLORS.lamp, 'lamp'),
} as const satisfies Record<string, VillagePaint>;

/**
 * Highest and lowest terrain of the (rotated) footprint: corners and edge midpoints of the
 * plinth, plus the centre.
 */
function footprintRange(
  terrain: VillageTerrain,
  x: number,
  z: number,
  yaw: number,
  size: { halfX: number; halfZ: number },
): { top: number; bottom: number } {
  const centre = terrain.heightAt(x, z);
  let top = centre;
  let bottom = centre;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const halfX = size.halfX + VILLAGE.plinthMargin;
  const halfZ = size.halfZ + VILLAGE.plinthMargin;
  for (const sx of [-1, 0, 1]) {
    for (const sz of [-1, 0, 1]) {
      if (sx === 0 && sz === 0) continue;
      const lx = sx * halfX;
      const lz = sz * halfZ;
      const h = terrain.heightAt(x + lx * cos + lz * sin, z - lx * sin + lz * cos);
      top = Math.max(top, h);
      bottom = Math.min(bottom, h);
    }
  }
  return { top, bottom };
}

function hutToWorld(hut: HutPlacement, lx: number, lz: number): [number, number] {
  const cos = Math.cos(hut.yaw);
  const sin = Math.sin(hut.yaw);
  return [hut.x + lx * cos + lz * sin, hut.z - lx * sin + lz * cos];
}

function addHutColliders(
  collision: VillageCollision,
  kind: HutKind,
  x: number,
  z: number,
  yaw: number,
  floorY: number,
  plinthDepth: number,
): void {
  const baseY = floorY - plinthDepth;
  const topY = floorY + VILLAGE.plinthLip + (kind === 'long' ? 3.6 : 3.2);
  const { radius } = FOOTPRINT[kind];
  if (kind !== 'long') {
    collision.addCollider({ x, z, radius, baseY, topY });
    return;
  }
  // Three overlapping circles along the long house cover its walls (corners included), the
  // door-wall centre and the plinth edge midpoints.
  for (const lx of LONG_HOUSE_COLLIDER_X) {
    collision.addCollider({
      x: x + lx * Math.cos(yaw),
      z: z - lx * Math.sin(yaw),
      radius,
      baseY,
      topY,
    });
  }
}

function clearPoints(spawn: { readonly x: number; readonly z: number }): [number, number][] {
  return [
    [spawn.x, spawn.z],
    [spawn.x + COOKING_POT_OFFSET.x, spawn.z + COOKING_POT_OFFSET.z],
    ...NPC_DEFS.map((def): [number, number] => [spawn.x + def.offsetX, spawn.z + def.offsetZ]),
  ];
}

function isClear(
  points: readonly [number, number][],
  x: number,
  z: number,
  radius: number,
): boolean {
  return points.every(([px, pz]) => Math.hypot(px - x, pz - z) >= VILLAGE.clearRadius + radius);
}

/** Direction (yaw around the spawn) with the highest moisture: where the forest is. */
function forestSide(
  terrain: VillageTerrain,
  spawn: { readonly x: number; readonly z: number },
): number {
  let best = 0;
  let bestMoisture = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < VILLAGE.forestProbeDirections; i++) {
    const angle = (i / VILLAGE.forestProbeDirections) * Math.PI * 2;
    const moisture = terrain.moistureAt(
      spawn.x + Math.sin(angle) * VILLAGE.forestProbeRadius,
      spawn.z + Math.cos(angle) * VILLAGE.forestProbeRadius,
    );
    if (moisture > bestMoisture) {
      bestMoisture = moisture;
      best = angle;
    }
  }
  return best;
}

function buildHut(kit: MeshKit<Finish>, hut: Group, kind: HutKind, plinthDepth: number): void {
  const size = FOOTPRINT[kind];
  const lip = VILLAGE.plinthLip;
  // Stone plinth from well below the floor up to a small lip.
  const plinthH = plinthDepth + lip;
  const plinthY = lip - plinthH / 2;
  if (kind === 'round') {
    kit.place(
      new CylinderGeometry(size.halfX + VILLAGE.plinthMargin, size.halfX + 0.35, plinthH, 10),
      P.plinth,
      hut,
      0,
      plinthY,
      0,
    );
  } else {
    kit.place(
      new BoxGeometry(
        (size.halfX + VILLAGE.plinthMargin) * 2,
        plinthH,
        (size.halfZ + VILLAGE.plinthMargin) * 2,
      ),
      P.plinth,
      hut,
      0,
      plinthY,
      0,
    );
  }
  const body = kit.scaffold(new Group());
  body.position.y = lip;
  hut.add(body);
  if (kind === 'cottage') cottage(kit, body);
  else if (kind === 'round') roundHut(kit, body);
  else longHouse(kit, body);
}

function cottage(kit: MeshKit<Finish>, hut: Group): void {
  const half = 1.6;
  const wallH = 2.2;
  kit.place(new BoxGeometry(half * 2, wallH, half * 2), P.plaster, hut, 0, wallH / 2, 0);
  // Timber frame: corner posts, sill and top beams.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      kit.place(new BoxGeometry(0.16, wallH, 0.16), P.timber, hut, sx * half, wallH / 2, sz * half);
    }
  }
  for (const y of [0.08, wallH - 0.08]) {
    for (const sz of [-1, 1]) {
      kit.place(
        new BoxGeometry(half * 2 + 0.1, 0.14, 0.1),
        P.timber,
        hut,
        0,
        y,
        sz * (half + 0.01),
      );
    }
    for (const sx of [-1, 1]) {
      kit.place(
        new BoxGeometry(0.1, 0.14, half * 2 + 0.1),
        P.timber,
        hut,
        sx * (half + 0.01),
        y,
        0,
      );
    }
  }
  // Side diagonal braces.
  for (const sx of [-1, 1]) {
    kit.place(
      new BoxGeometry(0.08, 2.3, 0.12),
      P.timber,
      hut,
      sx * (half + 0.02),
      wallH / 2,
      0,
    ).rotation.x = sx * 0.72;
  }
  // Door with frame.
  const front = half + 0.04;
  kit.place(new BoxGeometry(0.72, 1.38, 0.08), P.timber, hut, 0, 0.69, front);
  for (const sx of [-1, 1]) {
    kit.place(new BoxGeometry(0.1, 1.55, 0.12), P.darkTimber, hut, sx * 0.44, 0.775, front + 0.01);
  }
  kit.place(new BoxGeometry(1.0, 0.12, 0.12), P.darkTimber, hut, 0, 1.5, front + 0.01);
  // Windows with shutters.
  for (const sx of [-1, 1]) {
    const wx = sx * 0.98;
    kit.place(new BoxGeometry(0.42, 0.42, 0.08), P.window, hut, wx, 1.35, front);
    for (const side of [-1, 1]) {
      kit.place(
        new BoxGeometry(0.2, 0.46, 0.05),
        P.shutter,
        hut,
        wx + side * 0.33,
        1.35,
        front + 0.02,
      );
    }
  }
  // Pyramid roof with an overhang, and a chimney through it.
  kit.place(new ConeGeometry(2.85, 1.7, 4), P.roof, hut, 0, wallH + 0.85, 0).rotation.y =
    Math.PI / 4;
  kit.place(new CylinderGeometry(0.2, 0.24, 1.4, 6), P.chimney, hut, 0.85, wallH + 1.05, -0.5);
}

function roundHut(kit: MeshKit<Finish>, hut: Group): void {
  const radius = 1.72;
  const wallH = 2.1;
  kit.place(new CylinderGeometry(radius, radius + 0.04, wallH, 10), P.stone, hut, 0, wallH / 2, 0);
  // Ring beam under the thatch.
  kit.place(
    new CylinderGeometry(radius + 0.1, radius + 0.1, 0.16, 10),
    P.timber,
    hut,
    0,
    wallH + 0.02,
    0,
  );
  kit.place(new ConeGeometry(2.35, 1.9, 10), P.thatch, hut, 0, wallH + 0.95, 0);
  // Small door and two side windows.
  kit.place(new BoxGeometry(0.68, 1.3, 0.12), P.timber, hut, 0, 0.65, radius - 0.01);
  kit.place(new BoxGeometry(0.86, 0.1, 0.14), P.darkTimber, hut, 0, 1.33, radius);
  for (const side of [-1, 1]) {
    const angle = side * (Math.PI / 4);
    kit.place(
      new BoxGeometry(0.36, 0.36, 0.1),
      P.window,
      hut,
      Math.sin(angle) * (radius - 0.02),
      1.3,
      Math.cos(angle) * (radius - 0.02),
    ).rotation.y = angle;
  }
}

function longHouse(kit: MeshKit<Finish>, hut: Group): void {
  const halfX = 2.3;
  const halfZ = 1.5;
  const wallH = 2.4;
  kit.place(new BoxGeometry(halfX * 2, wallH, halfZ * 2), P.plank, hut, 0, wallH / 2, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      kit.place(
        new BoxGeometry(0.18, wallH, 0.18),
        P.timber,
        hut,
        sx * halfX,
        wallH / 2,
        sz * halfZ,
      );
    }
  }
  // Gable roof: a triangular prism along X with its apex up.
  const roofRadius = 2.08;
  const roofSquash = 0.55;
  const roof = kit.place(
    new CylinderGeometry(roofRadius, roofRadius, halfX * 2 + 0.3, 3, 1, false, Math.PI / 2),
    P.tile,
    hut,
    0,
    wallH + roofRadius * 0.5 * roofSquash,
    0,
  );
  roof.rotation.z = Math.PI / 2;
  roof.scale.set(roofSquash, 1, 1);
  // Door in the middle of the front, two windows on each long side.
  kit.place(new BoxGeometry(0.8, 1.5, 0.08), P.timber, hut, 0, 0.75, halfZ + 0.04);
  kit.place(new BoxGeometry(1.06, 0.12, 0.12), P.darkTimber, hut, 0, 1.58, halfZ + 0.05);
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      kit.place(
        new BoxGeometry(0.46, 0.42, 0.08),
        P.window,
        hut,
        sx * 1.35,
        1.45,
        sz * (halfZ + 0.04),
      );
    }
  }
}

function well(kit: MeshKit<Finish>, parent: Group, x: number, y: number, z: number): void {
  kit.place(new CylinderGeometry(0.9, 0.95, 0.8, 12, 1, true), P.stone, parent, x, y + 0.4, z);
  kit.place(new CylinderGeometry(0.72, 0.72, 0.8, 12, 1, true), P.stone, parent, x, y + 0.4, z);
  kit.place(new TorusGeometry(0.81, 0.11, 5, 14), P.stone, parent, x, y + 0.8, z).rotation.x =
    Math.PI / 2;
  kit.place(new CylinderGeometry(0.72, 0.72, 0.05, 12), P.water, parent, x, y + 0.45, z);
  for (const side of [-1, 1]) {
    kit.place(new BoxGeometry(0.12, 2, 0.12), P.timber, parent, x + side * 0.86, y + 1, z);
  }
  kit.place(new CylinderGeometry(0.05, 0.05, 1.84, 6), P.timber, parent, x, y + 1.6, z).rotation.z =
    Math.PI / 2;
  kit.place(new ConeGeometry(1.25, 0.6, 4), P.roof, parent, x, y + 2.25, z).rotation.y =
    Math.PI / 4;
}

function lanternPost(kit: MeshKit<Finish>, parent: Group, x: number, y: number, z: number): void {
  kit.place(new CylinderGeometry(0.07, 0.09, 2.2, 6), P.timber, parent, x, y + 1.1, z);
  kit.place(new BoxGeometry(0.5, 0.07, 0.07), P.timber, parent, x + 0.2, y + 2.15, z);
  kit.place(new BoxGeometry(0.2, 0.26, 0.2), P.lamp, parent, x + 0.4, y + 1.92, z);
  kit.place(new ConeGeometry(0.18, 0.14, 4), P.iron, parent, x + 0.4, y + 2.12, z).rotation.y =
    Math.PI / 4;
}

function woodpile(kit: MeshKit<Finish>, parent: Group, x: number, y: number, z: number): void {
  const rows = [3, 2, 1];
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 0.29;
      kit.place(
        new CylinderGeometry(0.14, 0.14, 1.2, 7),
        P.log,
        parent,
        x + offset,
        y + 0.14 + row * 0.25,
        z,
      ).rotation.x = Math.PI / 2;
    }
  });
}

function crate(
  kit: MeshKit<Finish>,
  parent: Group,
  x: number,
  y: number,
  z: number,
  size: number,
  yaw: number,
): void {
  kit.place(new BoxGeometry(size, size, size), P.crate, parent, x, y + size / 2, z).rotation.y =
    yaw;
  // Dark slats across the faces.
  kit.place(
    new BoxGeometry(size + 0.02, 0.06, size + 0.02),
    P.timber,
    parent,
    x,
    y + size * 0.75,
    z,
  ).rotation.y = yaw;
  kit.place(
    new BoxGeometry(size + 0.02, 0.06, size + 0.02),
    P.timber,
    parent,
    x,
    y + size * 0.25,
    z,
  ).rotation.y = yaw;
}

function barrel(kit: MeshKit<Finish>, parent: Group, x: number, y: number, z: number): void {
  kit.place(new CylinderGeometry(0.32, 0.32, 0.85, 10), P.barrel, parent, x, y + 0.425, z);
  kit.place(new CylinderGeometry(0.37, 0.37, 0.5, 10), P.barrel, parent, x, y + 0.425, z);
  for (const by of [0.15, 0.7]) {
    kit.place(new TorusGeometry(0.345, 0.025, 4, 12), P.iron, parent, x, y + by, z).rotation.x =
      Math.PI / 2;
  }
}

function fence(
  kit: MeshKit<Finish>,
  parent: Group,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const segment = kit.scaffold(new Group());
  segment.position.set(x, y, z);
  segment.rotation.y = yaw;
  parent.add(segment);
  const half = VILLAGE.fenceLength / 2;
  for (const side of [-1, 1]) {
    kit.place(
      new CylinderGeometry(0.08, 0.09, 1.4, 6),
      P.timber,
      segment,
      side * (half - 0.1),
      0.4,
      0,
    );
  }
  for (const ry of [0.45, 0.85]) {
    kit.place(new BoxGeometry(VILLAGE.fenceLength, 0.09, 0.06), P.plank, segment, 0, ry, 0);
  }
}
