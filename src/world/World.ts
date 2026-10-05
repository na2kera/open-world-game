import { Vector3, type Camera, type Scene } from 'three';

import type { System } from '../core/System';
import { DayNightCycle } from './DayNightCycle';
import { Sky } from './Sky';
import { Terrain, type Vec3Like } from './Terrain';
import { TerrainChunkManager } from './TerrainChunkManager';
import { Vegetation } from './Vegetation';
import { Water } from './Water';
import { WorldCollision } from './WorldCollision';

/**
 * Facade over everything environmental: height field, streamed terrain and vegetation,
 * water, sky / day-night lighting and static collision.
 *
 * `focus` is a live position (usually the player) that streaming and the shadow camera follow.
 */
export class World implements System {
  readonly terrain: Terrain;
  readonly chunks: TerrainChunkManager;
  readonly vegetation: Vegetation;
  readonly water: Water;
  readonly sky: Sky;
  readonly dayNight: DayNightCycle;
  readonly collision: WorldCollision;
  /** Ground position where the player starts. */
  readonly spawnPoint = new Vector3();

  constructor(
    scene: Scene,
    readonly seed: number,
    focus: Readonly<Vec3Like>,
    private readonly camera: Camera,
  ) {
    this.terrain = new Terrain(seed);
    this.terrain.findSpawnPoint(this.spawnPoint);
    this.chunks = new TerrainChunkManager(scene, this.terrain, focus);
    this.vegetation = new Vegetation(scene, this.terrain, seed, focus);
    this.water = new Water(scene, focus);
    this.sky = new Sky(scene);
    this.dayNight = new DayNightCycle(scene, this.sky, this.water, focus);
    this.collision = new WorldCollision(this.vegetation);
  }

  /** Builds the area around the focus synchronously (call after the focus is placed). */
  preload(): void {
    this.chunks.preload();
    this.vegetation.preload();
  }

  update(dt: number): void {
    this.dayNight.update(dt);
  }

  /** Streams content and updates lighting; run after the camera has moved. */
  frameUpdate(frameDt: number): void {
    this.chunks.frameUpdate();
    this.vegetation.frameUpdate();
    this.water.frameUpdate(frameDt);
    this.dayNight.frameUpdate();
    this.dayNight.followCamera(this.camera);
  }

  dispose(): void {
    this.chunks.dispose();
    this.vegetation.dispose();
    this.water.dispose();
    this.dayNight.dispose();
  }
}
