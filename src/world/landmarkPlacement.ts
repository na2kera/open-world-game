import type { Biome } from './Terrain';

export interface TerrainQuery {
  heightAt(x: number, z: number): number;
  biomeAt(x: number, z: number): Biome;
}

export interface PlacedPoint {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

export interface PlacedLandmarks {
  readonly towers: readonly PlacedPoint[];
  readonly shrine: PlacedPoint;
  readonly arena: PlacedPoint;
}

const TOWER_BEARINGS = [0.5, 2.6, 4.4] as const;
const TOWER_MIN = 320;
const TOWER_MAX = 700;
const TOWER_STEP = 40;
const SHRINE_BEARING = 3.6;
const ARENA_BEARING = 1.35;

/** Deterministic tower, shrine and boss-arena positions on dry land around the village. */
export function placeLandmarks(
  spawnX: number,
  spawnZ: number,
  query: TerrainQuery,
): PlacedLandmarks {
  const towers = TOWER_BEARINGS.map((bearing, index) => {
    const point = search(
      spawnX,
      spawnZ,
      bearing,
      TOWER_MIN,
      TOWER_MAX,
      TOWER_STEP,
      query,
      isTowerSite,
    );
    return { id: `tower-${index}`, ...point };
  });
  const shrinePoint = search(spawnX, spawnZ, SHRINE_BEARING, 160, 380, 20, query, isShore);
  const arenaPoint = search(spawnX, spawnZ, ARENA_BEARING, 480, 860, 40, query, isHighGround);
  return {
    towers,
    shrine: { id: 'shrine', ...shrinePoint },
    arena: { id: 'arena', ...arenaPoint },
  };
}

interface Site {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

function search(
  spawnX: number,
  spawnZ: number,
  bearing: number,
  min: number,
  max: number,
  step: number,
  query: TerrainQuery,
  accept: (y: number, biome: Biome) => boolean,
): Site {
  let fallback: Site | null = null;
  for (let distance = min; distance <= max; distance += step) {
    const x = spawnX + Math.cos(bearing) * distance;
    const z = spawnZ + Math.sin(bearing) * distance;
    const y = query.heightAt(x, z);
    const biome = query.biomeAt(x, z);
    if (isDry(y, biome)) fallback = { x, z, y };
    if (isDry(y, biome) && accept(y, biome)) return { x, z, y };
  }
  if (fallback) return fallback;
  const x = spawnX + Math.cos(bearing) * min;
  const z = spawnZ + Math.sin(bearing) * min;
  return { x, z, y: Math.max(query.heightAt(x, z), 4) };
}

function isDry(y: number, biome: Biome): boolean {
  return y > 2 && biome !== 'ocean' && biome !== 'beach';
}

function isTowerSite(y: number, biome: Biome): boolean {
  return y > 3 && (biome === 'grassland' || biome === 'forest' || biome === 'highland');
}

function isShore(y: number, biome: Biome): boolean {
  return y > 2 && y < 7 && biome !== 'mountain' && biome !== 'snow';
}

function isHighGround(y: number, biome: Biome): boolean {
  return y > 18 || biome === 'highland' || biome === 'mountain';
}
