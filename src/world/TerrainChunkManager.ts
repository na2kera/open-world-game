import { Group, Mesh, MeshStandardMaterial, type Scene } from 'three';

import {
  CHUNK_BUILD_BUDGET_MS,
  CHUNK_BUILDS_PER_FRAME,
  CHUNK_PRELOAD_RINGS,
  CHUNK_SIZE,
  LOD_DISTANCES,
  LOD_SEGMENTS,
  STREAMING_REFRESH_DISTANCE,
  VIEW_DISTANCE,
  WORLD_HALF,
} from '../config';
import type { System } from '../core/System';
import { buildChunkGeometry } from './chunkGeometry';
import { cellKey, distanceToCell, toCell } from './grid';
import type { Terrain, Vec3Like } from './Terrain';

const NO_LOD = -1;
const TERRAIN_ROUGHNESS = 0.92;

function createTerrainMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: TERRAIN_ROUGHNESS,
    metalness: 0,
  });
  material.customProgramCacheKey = () => 'terrain-detail';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vTerrainWorld;
         float terrainHash(vec2 p) {
           return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
         }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec2 cell = floor(vTerrainWorld.xz * 0.22);
         float patch = terrainHash(cell);
         float grain = terrainHash(vTerrainWorld.xz * 4.0);
         diffuseColor.rgb *= 0.95 + 0.06 * patch + 0.03 * grain;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         vec2 slopeCell = floor(vTerrainWorld.xz * 0.45);
         normal = normalize(normal + vec3(
           (terrainHash(slopeCell) - 0.5) * 0.18,
           0.0,
           (terrainHash(slopeCell.yx) - 0.5) * 0.18
         ));`,
      );
  };
  return material;
}

interface Chunk {
  readonly cx: number;
  readonly cz: number;
  /** LOD of the current mesh, or {@link NO_LOD}. */
  lod: number;
  /** LOD the chunk should have. */
  targetLod: number;
  distance: number;
  mesh: Mesh | null;
}

/** LOD index for a chunk at `distance` from the focus. */
function lodForDistance(distance: number): number {
  if (distance < LOD_DISTANCES[0]) return 0;
  if (distance < LOD_DISTANCES[1]) return 1;
  return 2;
}

/**
 * Streams terrain chunks around a focus point with three LOD levels. Builds are spread over
 * frames (nearest first) to avoid hitches; far chunks are unloaded and their geometry disposed.
 */
export class TerrainChunkManager implements System {
  readonly group = new Group();
  private readonly material = createTerrainMaterial();
  private readonly chunks = new Map<number, Chunk>();
  private readonly queue: Chunk[] = [];
  private readonly lastRefresh = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
    private readonly focus: Readonly<Vec3Like>,
  ) {
    this.group.name = 'terrain';
    scene.add(this.group);
  }

  /** Number of chunks currently holding a mesh. */
  get loadedCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) if (chunk.mesh) count++;
    return count;
  }

  /** Number of chunks waiting to be (re)built. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Synchronously builds the chunks closest to the focus (call once before the first frame). */
  preload(): void {
    this.refresh();
    const radius = CHUNK_PRELOAD_RINGS * CHUNK_SIZE;
    while (this.queue.length > 0 && (this.queue[0]?.distance ?? Infinity) <= radius) {
      const chunk = this.queue.shift();
      if (chunk) this.build(chunk);
    }
  }

  frameUpdate(): void {
    const dx = this.focus.x - this.lastRefresh.x;
    const dz = this.focus.z - this.lastRefresh.z;
    if (dx * dx + dz * dz > STREAMING_REFRESH_DISTANCE * STREAMING_REFRESH_DISTANCE) {
      this.refresh();
    }
    const start = performance.now();
    for (let built = 0; built < CHUNK_BUILDS_PER_FRAME && this.queue.length > 0; built++) {
      if (built > 0 && performance.now() - start > CHUNK_BUILD_BUDGET_MS) break;
      const chunk = this.queue.shift();
      if (chunk) this.build(chunk);
    }
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) this.unload(chunk);
    this.chunks.clear();
    this.queue.length = 0;
    this.material.dispose();
    this.group.removeFromParent();
  }

  /** Recomputes desired chunks / LODs, unloads far chunks and rebuilds the build queue. */
  private refresh(): void {
    const { x, z } = this.focus;
    this.lastRefresh.x = x;
    this.lastRefresh.z = z;
    const centerX = toCell(x, CHUNK_SIZE);
    const centerZ = toCell(z, CHUNK_SIZE);
    const range = Math.ceil(VIEW_DISTANCE / CHUNK_SIZE) + 1;
    const minCell = toCell(-WORLD_HALF, CHUNK_SIZE);
    const maxCell = toCell(WORLD_HALF - 1, CHUNK_SIZE);

    for (const chunk of this.chunks.values()) chunk.distance = Number.POSITIVE_INFINITY;

    for (let cz = centerZ - range; cz <= centerZ + range; cz++) {
      if (cz < minCell || cz > maxCell) continue;
      for (let cx = centerX - range; cx <= centerX + range; cx++) {
        if (cx < minCell || cx > maxCell) continue;
        const distance = distanceToCell(x, z, cx, cz, CHUNK_SIZE);
        if (distance > VIEW_DISTANCE) continue;
        const key = cellKey(cx, cz);
        let chunk = this.chunks.get(key);
        if (!chunk) {
          chunk = { cx, cz, lod: NO_LOD, targetLod: NO_LOD, distance, mesh: null };
          this.chunks.set(key, chunk);
        }
        chunk.distance = distance;
        chunk.targetLod = lodForDistance(distance);
      }
    }

    this.queue.length = 0;
    for (const [key, chunk] of this.chunks) {
      if (chunk.distance === Number.POSITIVE_INFINITY) {
        this.unload(chunk);
        this.chunks.delete(key);
      } else if (chunk.lod !== chunk.targetLod) {
        this.queue.push(chunk);
      }
    }
    this.queue.sort((a, b) => a.distance - b.distance);
  }

  private build(chunk: Chunk): void {
    const segments = LOD_SEGMENTS[chunk.targetLod as 0 | 1 | 2];
    const geometry = buildChunkGeometry(this.terrain, chunk.cx, chunk.cz, segments);
    if (chunk.mesh) {
      chunk.mesh.geometry.dispose();
      chunk.mesh.geometry = geometry;
    } else {
      const mesh = new Mesh(geometry, this.material);
      mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      chunk.mesh = mesh;
    }
    chunk.lod = chunk.targetLod;
  }

  private unload(chunk: Chunk): void {
    if (!chunk.mesh) return;
    chunk.mesh.geometry.dispose();
    chunk.mesh.removeFromParent();
    chunk.mesh = null;
    chunk.lod = NO_LOD;
  }
}
