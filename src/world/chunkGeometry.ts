import { BufferAttribute, BufferGeometry, Color } from 'three';

import { CHUNK_SIZE, CHUNK_SKIRT_DEPTH } from '../config';
import type { Terrain } from './Terrain';
import { terrainColorAt } from './terrainColors';

/** Moisture is sampled on a coarse grid (it varies slowly) and interpolated. */
const MOISTURE_CELLS = 4;
const UINT16_LIMIT = 65535;

const tmpColor = new Color();

/**
 * Builds the mesh of chunk (cx, cz) with `segments` quads per side. Vertices are local to the
 * chunk origin (cx * CHUNK_SIZE, cz * CHUNK_SIZE). A vertical skirt hides LOD seams.
 */
export function buildChunkGeometry(
  terrain: Terrain,
  cx: number,
  cz: number,
  segments: number,
): BufferGeometry {
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  const step = CHUNK_SIZE / segments;
  const side = segments + 1;
  const border = segments + 3;

  // Heights with a one-sample border so normals at the edges match neighbouring chunks.
  const heights = new Float32Array(border * border);
  for (let j = 0; j < border; j++) {
    const z = originZ + (j - 1) * step;
    for (let i = 0; i < border; i++) {
      heights[j * border + i] = terrain.heightAt(originX + (i - 1) * step, z);
    }
  }

  const moistureSide = MOISTURE_CELLS + 1;
  const moisture = new Float32Array(moistureSide * moistureSide);
  const moistureStep = CHUNK_SIZE / MOISTURE_CELLS;
  for (let j = 0; j < moistureSide; j++) {
    for (let i = 0; i < moistureSide; i++) {
      moisture[j * moistureSide + i] = terrain.moistureAt(
        originX + i * moistureStep,
        originZ + j * moistureStep,
      );
    }
  }
  const moistureAt = (lx: number, lz: number): number => {
    const fx = Math.min(lx / moistureStep, MOISTURE_CELLS - 1e-6);
    const fz = Math.min(lz / moistureStep, MOISTURE_CELLS - 1e-6);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = moisture[iz * moistureSide + ix]!;
    const b = moisture[iz * moistureSide + ix + 1]!;
    const c = moisture[(iz + 1) * moistureSide + ix]!;
    const d = moisture[(iz + 1) * moistureSide + ix + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  const surfaceCount = side * side;
  const skirtCount = side * 4;
  const vertexCount = surfaceCount + skirtCount;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const center = (j + 1) * border + (i + 1);
      const h = heights[center]!;
      const nx = heights[center - 1]! - heights[center + 1]!;
      const nz = heights[center - border]! - heights[center + border]!;
      const ny = 2 * step;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const lx = i * step;
      const lz = j * step;
      const v = (j * side + i) * 3;
      positions[v] = lx;
      positions[v + 1] = h;
      positions[v + 2] = lz;
      normals[v] = nx * inv;
      normals[v + 1] = ny * inv;
      normals[v + 2] = nz * inv;
      terrainColorAt(h, ny * inv, moistureAt(lx, lz), originX + lx, originZ + lz, tmpColor);
      colors[v] = tmpColor.r;
      colors[v + 1] = tmpColor.g;
      colors[v + 2] = tmpColor.b;
    }
  }

  const quadCount = segments * segments;
  const indexCount = quadCount * 6 + segments * 4 * 12;
  const indices =
    vertexCount > UINT16_LIMIT ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let k = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  // Skirts: duplicate each edge vertex lowered by CHUNK_SKIRT_DEPTH, two-sided strips.
  const edges: ((n: number) => number)[] = [
    (n) => n,
    (n) => segments * side + n,
    (n) => n * side,
    (n) => n * side + segments,
  ];
  let skirtVertex = surfaceCount;
  for (const edge of edges) {
    const first = skirtVertex;
    for (let n = 0; n < side; n++) {
      const src = edge(n) * 3;
      const dst = skirtVertex * 3;
      positions[dst] = positions[src]!;
      positions[dst + 1] = positions[src + 1]! - CHUNK_SKIRT_DEPTH;
      positions[dst + 2] = positions[src + 2]!;
      normals[dst] = normals[src]!;
      normals[dst + 1] = normals[src + 1]!;
      normals[dst + 2] = normals[src + 2]!;
      colors[dst] = colors[src]!;
      colors[dst + 1] = colors[src + 1]!;
      colors[dst + 2] = colors[src + 2]!;
      skirtVertex++;
    }
    for (let n = 0; n < segments; n++) {
      const top0 = edge(n);
      const top1 = edge(n + 1);
      const bottom0 = first + n;
      const bottom1 = first + n + 1;
      indices[k++] = top0;
      indices[k++] = bottom0;
      indices[k++] = top1;
      indices[k++] = top1;
      indices[k++] = bottom0;
      indices[k++] = bottom1;
      indices[k++] = top0;
      indices[k++] = top1;
      indices[k++] = bottom0;
      indices[k++] = top1;
      indices[k++] = bottom1;
      indices[k++] = bottom0;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
