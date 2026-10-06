import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import {
  GRASS_DISTANCE,
  STREAMING_REFRESH_DISTANCE,
  VEGETATION_BUILDS_PER_FRAME,
  VEGETATION_CELL_SIZE,
  VEGETATION_DISTANCE,
} from '../config';
import type { System } from '../core/System';
import { cellKey, distanceToCell, toCell } from './grid';
import type { Terrain, Vec3Like } from './Terrain';
import { createRuinGroup } from './ruinMeshes';
import {
  generateCellPlacement,
  generateGrass,
  GRASS_STRIDE,
  type CellPlacement,
  type Collider,
} from './vegetationPlacement';

/** Cells farther than this keep no cached placement data. */
const EVICT_DISTANCE = VEGETATION_DISTANCE + VEGETATION_CELL_SIZE * 2;
const ROCK_SQUASH = 0.7;
const ROCK_JITTER = 0.28;
const ROCK_JITTER_SEED = 7.31;
const ROCK_HASH_WEIGHTS = [3.1, 5.7, 2.3] as const;
/** Rocks roll around Z by this fraction of their X tilt. */
const ROCK_ROLL_FACTOR = 0.5;

const COLORS = {
  trunk: 0x6b4a2f,
  conifer: 0x2f6a35,
  broadleaf: 0x4f8a3a,
  rock: 0x8a8580,
  cactus: 0x6f8f3c,
  reed: 0x8aaa55,
  grassBase: 0x3d6b2a,
  grassTip: 0x9cc75a,
} as const;

/** Shared geometries / materials for all cells. */
interface VegetationAssets {
  trunk: BufferGeometry;
  conifer: BufferGeometry;
  broadleaf: BufferGeometry;
  cactus: BufferGeometry;
  reed: BufferGeometry;
  rock: BufferGeometry;
  grass: BufferGeometry;
  trunkMaterial: Material;
  coniferMaterial: Material;
  broadleafMaterial: Material;
  cactusMaterial: Material;
  reedMaterial: Material;
  rockMaterial: Material;
  grassMaterial: Material;
}

function createAssets(): VegetationAssets {
  const trunk = new CylinderGeometry(0.22, 0.46, 3.4, 8, 3);
  trunk.translate(0, 1.7, 0);

  const coneLow = new ConeGeometry(2.15, 3.4, 8);
  coneLow.translate(0, 3.5, 0);
  const coneMid = new ConeGeometry(1.55, 2.8, 8);
  coneMid.translate(0, 5.5, 0);
  const coneHigh = new ConeGeometry(0.85, 2.3, 7);
  coneHigh.translate(0, 7.35, 0);
  const conifer = mergeGeometries([coneLow, coneMid, coneHigh]) ?? coneLow;

  const crownMain = new IcosahedronGeometry(2.05, 1);
  crownMain.translate(0, 4.7, 0);
  const crownSide = new IcosahedronGeometry(1.35, 1);
  crownSide.translate(1.15, 5.5, 0.4);
  const crownBack = new IcosahedronGeometry(1.15, 1);
  crownBack.translate(-0.7, 5.9, -0.55);
  const crownTop = new IcosahedronGeometry(1.05, 1);
  crownTop.translate(0.15, 6.7, 0.1);
  const broadleaf = mergeGeometries([crownMain, crownSide, crownBack, crownTop]) ?? crownMain;
  const cactusStem = new CylinderGeometry(0.22, 0.28, 2.5, 7);
  cactusStem.translate(0, 1.25, 0);
  const cactusLeft = new CylinderGeometry(0.11, 0.14, 0.85, 6);
  cactusLeft.translate(-0.42, 1.55, 0);
  const cactusRight = new CylinderGeometry(0.1, 0.13, 0.7, 6);
  cactusRight.translate(0.4, 1.15, 0.05);
  const cactus = mergeGeometries([cactusStem, cactusLeft, cactusRight]) ?? cactusStem;
  const reedA = new CylinderGeometry(0.035, 0.06, 1.45, 4);
  reedA.translate(0, 0.72, 0);
  const reedB = new CylinderGeometry(0.03, 0.05, 1.15, 4);
  reedB.translate(0.16, 0.58, 0.08);
  const reedC = new CylinderGeometry(0.025, 0.045, 0.95, 4);
  reedC.translate(-0.12, 0.48, -0.06);
  const reed = mergeGeometries([reedA, reedB, reedC]) ?? reedA;

  return {
    trunk,
    conifer,
    broadleaf,
    cactus,
    reed,
    rock: createRockGeometry(),
    grass: createGrassGeometry(),
    trunkMaterial: new MeshStandardMaterial({ color: COLORS.trunk, roughness: 0.92 }),
    coniferMaterial: new MeshStandardMaterial({
      color: COLORS.conifer,
      roughness: 0.86,
      flatShading: true,
    }),
    broadleafMaterial: new MeshStandardMaterial({
      color: COLORS.broadleaf,
      roughness: 0.82,
      flatShading: true,
    }),
    cactusMaterial: new MeshStandardMaterial({
      color: COLORS.cactus,
      roughness: 0.8,
      flatShading: true,
    }),
    reedMaterial: new MeshStandardMaterial({ color: COLORS.reed, roughness: 0.75 }),
    rockMaterial: new MeshStandardMaterial({
      color: COLORS.rock,
      roughness: 0.94,
      flatShading: true,
    }),
    grassMaterial: new MeshLambertMaterial({ vertexColors: true }),
  };
}

/** Low-poly rock: icosahedron with position-hashed jitter (shared vertices move together). */
function createRockGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const [wx, wy, wz] = ROCK_HASH_WEIGHTS;
    const h = Math.sin((x * wx + y * wy + z * wz) * ROCK_JITTER_SEED) * 0.5 + 0.5;
    const s = 1 + (h - 0.5) * 2 * ROCK_JITTER;
    position.setXYZ(i, x * s, y * s * ROCK_SQUASH, z * s);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const GRASS_BLADES = 5;
const GRASS_BLADE_WIDTH = 0.11;
const GRASS_BLADE_HEIGHT = 0.95;
const GRASS_BLADE_LEAN = 0.16;

/** A tuft of crossing triangular blades; normals point up so it shades like the ground. */
function createGrassGeometry(): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const base = new Color(COLORS.grassBase);
  const tip = new Color(COLORS.grassTip);
  for (let b = 0; b < GRASS_BLADES; b++) {
    const angle = (b / GRASS_BLADES) * Math.PI;
    const cx = Math.cos(angle) * GRASS_BLADE_WIDTH;
    const cz = Math.sin(angle) * GRASS_BLADE_WIDTH;
    const lean = (b - (GRASS_BLADES - 1) / 2) * GRASS_BLADE_LEAN;
    // Both windings, so each side is front-facing and keeps the upward normal.
    positions.push(-cx, 0, -cz, cx, 0, cz, lean, GRASS_BLADE_HEIGHT, -lean);
    positions.push(cx, 0, cz, -cx, 0, -cz, lean, GRASS_BLADE_HEIGHT, -lean);
    for (let side = 0; side < 2; side++) {
      colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  return geometry;
}

interface VegetationCell {
  readonly cx: number;
  readonly cz: number;
  placement: CellPlacement | null;
  objects: Group | null;
  grass: InstancedMesh | null;
  distance: number;
}

const tmpMatrix = new Matrix4();
const tmpPosition = new Vector3();
const tmpQuaternion = new Quaternion();
const tmpEuler = new Euler();
const tmpScale = new Vector3();
const tmpColor = new Color();

/**
 * Streams trees, rocks (within {@link VEGETATION_DISTANCE}) and grass (within
 * {@link GRASS_DISTANCE}) as per-cell InstancedMeshes. Placement is deterministic per seed and
 * cell and also provides the colliders used by {@link WorldCollision}.
 */
export class Vegetation implements System {
  readonly group = new Group();
  private readonly assets = createAssets();
  private readonly cells = new Map<number, VegetationCell>();
  private readonly queue: VegetationCell[] = [];
  private readonly lastRefresh = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
    private readonly seed: number,
    private readonly focus: Readonly<Vec3Like>,
    private readonly spawn: Readonly<Vec3Like> = focus,
  ) {
    this.group.name = 'vegetation';
    scene.add(this.group);
  }

  /** Colliders of cell (cx, cz); generates the placement on demand. */
  getColliders(cx: number, cz: number): readonly Collider[] {
    return this.ensurePlacement(this.getCell(cx, cz)).colliders;
  }

  /** Synchronously builds the cells closest to the focus. */
  preload(): void {
    this.refresh();
    while (this.queue.length > 0 && (this.queue[0]?.distance ?? Infinity) <= 0) {
      const cell = this.queue.shift();
      if (cell) this.build(cell);
    }
  }

  frameUpdate(): void {
    const dx = this.focus.x - this.lastRefresh.x;
    const dz = this.focus.z - this.lastRefresh.z;
    if (dx * dx + dz * dz > STREAMING_REFRESH_DISTANCE * STREAMING_REFRESH_DISTANCE) {
      this.refresh();
    }
    for (let i = 0; i < VEGETATION_BUILDS_PER_FRAME && this.queue.length > 0; i++) {
      const cell = this.queue.shift();
      if (cell) this.build(cell);
    }
  }

  dispose(): void {
    for (const cell of this.cells.values()) {
      this.removeObjects(cell);
      this.removeGrass(cell);
    }
    this.cells.clear();
    const a = this.assets;
    for (const geometry of [a.trunk, a.conifer, a.broadleaf, a.cactus, a.reed, a.rock, a.grass]) {
      geometry.dispose();
    }
    for (const material of [
      a.trunkMaterial,
      a.coniferMaterial,
      a.broadleafMaterial,
      a.cactusMaterial,
      a.reedMaterial,
      a.rockMaterial,
      a.grassMaterial,
    ]) {
      material.dispose();
    }
    this.group.removeFromParent();
  }

  private getCell(cx: number, cz: number): VegetationCell {
    const key = cellKey(cx, cz);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { cx, cz, placement: null, objects: null, grass: null, distance: Infinity };
      this.cells.set(key, cell);
    }
    return cell;
  }

  private ensurePlacement(cell: VegetationCell): CellPlacement {
    cell.placement ??= generateCellPlacement(
      this.terrain,
      this.seed,
      cell.cx,
      cell.cz,
      this.spawn.x,
      this.spawn.z,
    );
    return cell.placement;
  }

  private refresh(): void {
    const { x, z } = this.focus;
    this.lastRefresh.x = x;
    this.lastRefresh.z = z;
    const centerX = toCell(x, VEGETATION_CELL_SIZE);
    const centerZ = toCell(z, VEGETATION_CELL_SIZE);
    const range = Math.ceil(VEGETATION_DISTANCE / VEGETATION_CELL_SIZE) + 1;
    for (let cz = centerZ - range; cz <= centerZ + range; cz++) {
      for (let cx = centerX - range; cx <= centerX + range; cx++) {
        if (distanceToCell(x, z, cx, cz, VEGETATION_CELL_SIZE) <= VEGETATION_DISTANCE) {
          this.getCell(cx, cz);
        }
      }
    }

    this.queue.length = 0;
    for (const [key, cell] of this.cells) {
      cell.distance = distanceToCell(x, z, cell.cx, cell.cz, VEGETATION_CELL_SIZE);
      const wantObjects = cell.distance <= VEGETATION_DISTANCE;
      const wantGrass = cell.distance <= GRASS_DISTANCE;
      if (!wantObjects) this.removeObjects(cell);
      if (!wantGrass) this.removeGrass(cell);
      if (cell.distance > EVICT_DISTANCE) {
        this.cells.delete(key);
        continue;
      }
      if ((wantObjects && !cell.objects) || (wantGrass && !cell.grass)) this.queue.push(cell);
    }
    this.queue.sort((a, b) => a.distance - b.distance);
  }

  private build(cell: VegetationCell): void {
    const placement = this.ensurePlacement(cell);
    if (!cell.objects && cell.distance <= VEGETATION_DISTANCE) {
      cell.objects = this.buildObjects(placement);
      this.group.add(cell.objects);
    }
    if (!cell.grass && cell.distance <= GRASS_DISTANCE) {
      cell.grass = this.buildGrass(placement);
      if (cell.grass) this.group.add(cell.grass);
    }
  }

  private buildObjects(placement: CellPlacement): Group {
    const a = this.assets;
    const group = new Group();
    const trees = placement.trees;
    const trunks = trees.filter((t) => t.kind === 'conifer' || t.kind === 'broadleaf');
    const conifers = trees.filter((t) => t.kind === 'conifer');
    const broadleaves = trees.filter((t) => t.kind === 'broadleaf');
    const cacti = trees.filter((t) => t.kind === 'cactus');
    const reeds = trees.filter((t) => t.kind === 'reed');

    if (trunks.length > 0) {
      const trunkMesh = new InstancedMesh(a.trunk, a.trunkMaterial, trunks.length);
      trunks.forEach((t, i) => {
        trunkMesh.setMatrixAt(i, composeUpright(t.x, t.y, t.z, t.rotation, t.scale));
      });
      group.add(finalize(trunkMesh, true));
    }
    for (const [list, geometry, material] of [
      [conifers, a.conifer, a.coniferMaterial],
      [broadleaves, a.broadleaf, a.broadleafMaterial],
      [cacti, a.cactus, a.cactusMaterial],
      [reeds, a.reed, a.reedMaterial],
    ] as const) {
      if (list.length === 0) continue;
      const mesh = new InstancedMesh(geometry, material, list.length);
      list.forEach((t, i) => {
        mesh.setMatrixAt(i, composeUpright(t.x, t.y, t.z, t.rotation, t.scale));
        mesh.setColorAt(i, tmpColor.setScalar(t.tint));
      });
      group.add(finalize(mesh, true));
    }

    if (placement.rocks.length > 0) {
      const rocks = new InstancedMesh(a.rock, a.rockMaterial, placement.rocks.length);
      placement.rocks.forEach((r, i) => {
        tmpPosition.set(r.x, r.y, r.z);
        tmpQuaternion.setFromEuler(tmpEuler.set(r.tilt, r.rotation, r.tilt * ROCK_ROLL_FACTOR));
        tmpScale.setScalar(r.scale);
        rocks.setMatrixAt(i, tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale));
      });
      group.add(finalize(rocks, true));
    }
    for (const ruin of placement.ruins) group.add(createRuinGroup(ruin));
    return group;
  }

  private buildGrass(placement: CellPlacement): InstancedMesh | null {
    const data = generateGrass(placement, this.seed);
    const count = data.length / GRASS_STRIDE;
    if (count === 0) return null;
    const mesh = new InstancedMesh(this.assets.grass, this.assets.grassMaterial, count);
    for (let i = 0; i < count; i++) {
      const o = i * GRASS_STRIDE;
      mesh.setMatrixAt(
        i,
        composeUpright(data[o]!, data[o + 1]!, data[o + 2]!, data[o + 4]!, data[o + 3]!),
      );
      mesh.setColorAt(i, tmpColor.setScalar(data[o + 5]!));
    }
    return finalize(mesh, false);
  }

  private removeObjects(cell: VegetationCell): void {
    if (!cell.objects) return;
    cell.objects.traverse((object) => {
      if (object instanceof InstancedMesh) object.dispose();
      else if (object instanceof Mesh) object.geometry.dispose();
    });
    cell.objects.removeFromParent();
    cell.objects = null;
  }

  private removeGrass(cell: VegetationCell): void {
    if (!cell.grass) return;
    cell.grass.dispose();
    cell.grass.removeFromParent();
    cell.grass = null;
  }
}

/** Matrix for an upright instance rotated around Y with uniform scale (shared temp). */
function composeUpright(x: number, y: number, z: number, rotation: number, scale: number): Matrix4 {
  tmpPosition.set(x, y, z);
  tmpQuaternion.setFromEuler(tmpEuler.set(0, rotation, 0));
  tmpScale.setScalar(scale);
  return tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
}

/** Uploads instance data, computes culling bounds and sets shadow flags. */
function finalize(mesh: InstancedMesh, castShadow: boolean): InstancedMesh {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
