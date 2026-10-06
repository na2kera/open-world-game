import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Scene,
} from 'three';

import {
  ENEMY_ACTIVE_DISTANCE,
  ENEMY_CAMP_CELL_SIZE,
  STREAMING_REFRESH_DISTANCE,
  VILLAGE_SAFE_RADIUS,
  WATER_LEVEL,
} from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { System } from '../core/System';
import { getEnemyDef, rollDrops } from '../data/enemies';
import type { ItemSpawner } from '../items/ItemSpawner';
import type { PlayerController } from '../player/PlayerController';
import { hashInts, mulberry32 } from '../utils/random';
import type { DayNightCycle } from '../world/DayNightCycle';
import { cellKey, distanceToCell, toCell } from '../world/grid';
import type { Terrain, Vec3Like } from '../world/Terrain';
import type { WorldLabelLayer } from '../ui/WorldLabelLayer';
import { Enemy } from './Enemy';

interface Camp {
  readonly id: string;
  readonly cx: number;
  readonly cz: number;
  readonly x: number;
  readonly z: number;
  readonly root: Group;
  readonly enemies: Enemy[];
  active: boolean;
  clearedAtDay: number | null;
}

export interface CampProgress {
  readonly campId: string;
  readonly clearedAtDay: number;
}

const CAMP_RANGE = 2;
const CAMP_CHANCE = 0.42;
const FIRE_COLOR = 0xff7a25;

/** Streams deterministic camps and manages night-only floating enemies. */
export class EnemySpawner implements System {
  readonly group = new Group();
  private readonly camps = new Map<number, Camp>();
  private readonly cleared = new Map<string, number>();
  private readonly spawnCellX: number;
  private readonly spawnCellZ: number;
  private readonly spawnX: number;
  private readonly spawnZ: number;
  private readonly lastRefresh = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  private nightEnemy: Enemy | null = null;
  private nightSerial = 0;

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
    private readonly seed: number,
    private readonly focus: Readonly<Vec3Like>,
    private readonly player: PlayerController,
    private readonly dayNight: DayNightCycle,
    private readonly bus: EventBus<GameEvents>,
    private readonly labels: WorldLabelLayer,
    private readonly itemSpawner: ItemSpawner,
  ) {
    this.group.name = 'enemies';
    scene.add(this.group);
    this.spawnCellX = toCell(focus.x, ENEMY_CAMP_CELL_SIZE);
    this.spawnCellZ = toCell(focus.z, ENEMY_CAMP_CELL_SIZE);
    this.spawnX = focus.x;
    this.spawnZ = focus.z;
  }

  get targetableEnemies(): readonly Enemy[] {
    const result: Enemy[] = [];
    for (const camp of this.camps.values()) {
      for (const enemy of camp.enemies) {
        if (enemy.active && enemy.isAlive) result.push(enemy);
      }
    }
    if (this.nightEnemy?.active && this.nightEnemy.isAlive) result.push(this.nightEnemy);
    return result;
  }

  get campProgress(): readonly CampProgress[] {
    return [...this.cleared].map(([campId, clearedAtDay]) => ({ campId, clearedAtDay }));
  }

  get campMarkers(): readonly { id: string; x: number; z: number; cleared: boolean }[] {
    return [...this.camps.values()].map((camp) => ({
      id: camp.id,
      x: camp.x,
      z: camp.z,
      cleared: camp.clearedAtDay !== null,
    }));
  }

  update(dt: number): void {
    for (const camp of this.camps.values()) {
      if (!camp.active) continue;
      for (const enemy of [...camp.enemies]) enemy.update(dt);
    }
    this.nightEnemy?.update(dt);
    this.updateNightEnemy();
  }

  frameUpdate(): void {
    const dx = this.focus.x - this.lastRefresh.x;
    const dz = this.focus.z - this.lastRefresh.z;
    if (dx * dx + dz * dz >= STREAMING_REFRESH_DISTANCE * STREAMING_REFRESH_DISTANCE) {
      this.refresh();
    }
  }

  restoreProgress(progress: readonly CampProgress[]): void {
    this.cleared.clear();
    for (const entry of progress) this.cleared.set(entry.campId, entry.clearedAtDay);
    for (const camp of this.camps.values()) {
      camp.clearedAtDay = this.cleared.get(camp.id) ?? null;
      if (camp.clearedAtDay !== null) this.removeCampEnemies(camp);
    }
  }

  reset(): void {
    for (const camp of this.camps.values()) this.disposeCamp(camp);
    this.camps.clear();
    this.cleared.clear();
    this.nightEnemy?.dispose();
    this.nightEnemy = null;
    this.lastRefresh.x = Number.POSITIVE_INFINITY;
    this.lastRefresh.z = Number.POSITIVE_INFINITY;
    this.refresh();
  }

  nearestEnemy(position: Readonly<Vec3Like>): Enemy | null {
    let nearest: Enemy | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const enemy of this.targetableEnemies) {
      const dx = enemy.position.x - position.x;
      const dz = enemy.position.z - position.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < best) {
        nearest = enemy;
        best = distanceSq;
      }
    }
    return nearest;
  }

  dispose(): void {
    for (const camp of this.camps.values()) this.disposeCamp(camp);
    this.camps.clear();
    this.nightEnemy?.dispose();
    this.nightEnemy = null;
    this.group.removeFromParent();
  }

  private refresh(): void {
    const { x, z } = this.focus;
    this.lastRefresh.x = x;
    this.lastRefresh.z = z;
    const centerX = toCell(x, ENEMY_CAMP_CELL_SIZE);
    const centerZ = toCell(z, ENEMY_CAMP_CELL_SIZE);
    for (let cz = centerZ - CAMP_RANGE; cz <= centerZ + CAMP_RANGE; cz++) {
      for (let cx = centerX - CAMP_RANGE; cx <= centerX + CAMP_RANGE; cx++) {
        const key = cellKey(cx, cz);
        if (!this.camps.has(key)) {
          const camp = this.createCamp(cx, cz);
          if (camp) this.camps.set(key, camp);
        }
      }
    }
    for (const camp of this.camps.values()) {
      this.updateCampRespawn(camp);
      const active =
        distanceToCell(x, z, camp.cx, camp.cz, ENEMY_CAMP_CELL_SIZE) <= ENEMY_ACTIVE_DISTANCE;
      this.setCampActive(camp, active);
    }
  }

  private createCamp(cx: number, cz: number): Camp | null {
    const rng = mulberry32(hashInts(this.seed, cx, cz, 0xca4f));
    const forced = cx === this.spawnCellX && cz === this.spawnCellZ;
    if (!forced && rng() >= CAMP_CHANCE) return null;
    const x = forced ? this.focus.x + 22 : (cx + 0.25 + rng() * 0.5) * ENEMY_CAMP_CELL_SIZE;
    const z = forced ? this.focus.z + 10 : (cz + 0.25 + rng() * 0.5) * ENEMY_CAMP_CELL_SIZE;
    if (Math.hypot(x - this.spawnX, z - this.spawnZ) < VILLAGE_SAFE_RADIUS) return null;
    const y = this.terrain.heightAt(x, z);
    const biome = this.terrain.biomeAt(x, z);
    if (
      y <= WATER_LEVEL + 1 ||
      biome === 'ocean' ||
      biome === 'beach' ||
      biome === 'snow' ||
      biome === 'mountain'
    ) {
      return null;
    }
    const id = `camp:${cx}:${cz}`;
    const root = createCampFire(x, y, z);
    const camp: Camp = {
      id,
      cx,
      cz,
      x,
      z,
      root,
      enemies: [],
      active: false,
      clearedAtDay: this.cleared.get(id) ?? null,
    };
    if (camp.clearedAtDay === null) this.populateCamp(camp, rng);
    const chestPosition = { x: x + 3.2, y, z: z - 1.8 };
    this.itemSpawner.spawnChest(
      `${id}:chest`,
      rng() < 0.35 ? 'knight-sword' : 'baked-apple',
      chestPosition,
      rng() < 0.35 ? 1 : 3,
    );
    return camp;
  }

  private populateCamp(camp: Camp, rng: () => number): void {
    const count = 2 + Math.floor(rng() * 3);
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2 + rng() * 0.5;
      const radius = 4 + rng() * 2.5;
      const defId = index === count - 1 && rng() < 0.45 ? 'bokoblin-blue' : 'bokoblin-red';
      const def = getEnemyDef(defId);
      if (!def) continue;
      const enemy = new Enemy({
        id: `${camp.id}:enemy:${index}`,
        def,
        x: camp.x + Math.cos(angle) * radius,
        z: camp.z + Math.sin(angle) * radius,
        terrain: this.terrain,
        player: this.player,
        bus: this.bus,
        labels: this.labels,
        onFinishedDeath: (dead) => this.finishEnemyDeath(camp, dead),
      });
      camp.enemies.push(enemy);
    }
  }

  private finishEnemyDeath(camp: Camp, enemy: Enemy): void {
    this.dropEnemyLoot(enemy);
    enemy.dispose();
    const index = camp.enemies.indexOf(enemy);
    if (index >= 0) camp.enemies.splice(index, 1);
    if (camp.enemies.some((candidate) => candidate.isAlive)) return;
    camp.clearedAtDay = this.dayNight.elapsedDays;
    this.cleared.set(camp.id, camp.clearedAtDay);
    this.bus.emit('camp:cleared', { campId: camp.id });
  }

  private dropEnemyLoot(enemy: Enemy): void {
    const rng = mulberry32(hashInts(this.seed, hashString(enemy.id), this.dayNight.elapsedDays));
    for (const drop of rollDrops(enemy.def.drops, rng)) {
      this.itemSpawner.spawnDrop(drop.itemId, drop.count, enemy.position);
    }
  }

  private setCampActive(camp: Camp, active: boolean): void {
    if (camp.active === active) return;
    camp.active = active;
    if (active) {
      this.group.add(camp.root);
    } else {
      camp.root.removeFromParent();
    }
    for (const enemy of camp.enemies) enemy.setActive(active, this.group);
  }

  private updateCampRespawn(camp: Camp): void {
    if (camp.clearedAtDay === null || this.dayNight.elapsedDays - camp.clearedAtDay < 1) return;
    camp.clearedAtDay = null;
    this.cleared.delete(camp.id);
    this.populateCamp(
      camp,
      mulberry32(hashInts(this.seed, camp.cx, camp.cz, this.dayNight.elapsedDays)),
    );
  }

  private updateNightEnemy(): void {
    if (!this.dayNight.isNight) {
      this.nightEnemy?.dispose();
      this.nightEnemy = null;
      return;
    }
    if (this.nightEnemy?.isAlive) return;
    if (Math.hypot(this.focus.x - this.spawnX, this.focus.z - this.spawnZ) < VILLAGE_SAFE_RADIUS) {
      return;
    }
    const def = getEnemyDef('night-wisp');
    if (!def) return;
    const angle = hashInts(this.seed, this.dayNight.elapsedDays, this.nightSerial) / 4294967296;
    this.nightSerial++;
    this.nightEnemy = new Enemy({
      id: `night:${this.dayNight.elapsedDays}:${this.nightSerial}`,
      def,
      x: this.focus.x + Math.cos(angle * Math.PI * 2) * 12,
      z: this.focus.z + Math.sin(angle * Math.PI * 2) * 12,
      terrain: this.terrain,
      player: this.player,
      bus: this.bus,
      labels: this.labels,
      onFinishedDeath: (dead) => {
        this.dropEnemyLoot(dead);
        dead.dispose();
        if (this.nightEnemy === dead) this.nightEnemy = null;
      },
    });
    this.nightEnemy.setActive(true, this.group);
  }

  private removeCampEnemies(camp: Camp): void {
    for (const enemy of camp.enemies) enemy.dispose();
    camp.enemies.length = 0;
  }

  private disposeCamp(camp: Camp): void {
    this.removeCampEnemies(camp);
    disposeObject(camp.root);
    camp.root.removeFromParent();
  }
}

function createCampFire(x: number, y: number, z: number): Group {
  const root = new Group();
  root.name = 'enemy-camp';
  root.position.set(x, y, z);
  const logMaterial = new MeshStandardMaterial({ color: 0x4a2b18, roughness: 0.95 });
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const log = new Mesh(new CylinderGeometry(0.16, 0.2, 2.1, 6), logMaterial);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = angle;
    log.position.y = 0.18;
    log.castShadow = true;
    root.add(log);
  }
  const fire = new Mesh(
    new ConeGeometry(0.48, 1.25, 7),
    new MeshStandardMaterial({
      color: FIRE_COLOR,
      emissive: FIRE_COLOR,
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.82,
    }),
  );
  fire.position.y = 0.82;
  root.add(fire);
  return root;
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function hashString(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = Math.imul(result ^ value.charCodeAt(index), 31);
  }
  return result;
}
