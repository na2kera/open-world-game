import { Group, type Scene } from 'three';

import {
  ITEM_ACTIVE_DISTANCE,
  ITEM_CELL_SIZE,
  STREAMING_REFRESH_DISTANCE,
  WATER_LEVEL,
} from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { System } from '../core/System';
import type { ItemId } from '../data/items';
import { hashInts, mulberry32 } from '../utils/random';
import { cellKey, distanceToCell, toCell } from '../world/grid';
import type { Biome, Terrain, Vec3Like } from '../world/Terrain';
import type { InteractionSystem } from './InteractionSystem';
import type { Inventory } from './Inventory';
import { TreasureChest } from './TreasureChest';
import { WorldItem } from './WorldItem';

interface ItemCell {
  readonly cx: number;
  readonly cz: number;
  readonly items: WorldItem[];
  readonly chests: TreasureChest[];
  readonly unregister: (() => void)[];
}

const ITEM_CHOICES: Readonly<Record<Biome, readonly ItemId[]>> = {
  ocean: [],
  beach: ['rock-salt'],
  grassland: ['herb', 'hylian-herb', 'apple'],
  forest: ['mushroom', 'acorn', 'apple'],
  highland: ['herb', 'rock-salt'],
  mountain: ['rock-salt'],
  snow: ['rock-salt'],
};

const PLACEMENT_ATTEMPTS = 7;
const CHEST_CHANCE = 0.16;

/**
 * Deterministic cell-streamed pickups and treasure chests. Collected/opened IDs are retained
 * independently of active cells and exposed directly to save data.
 */
export class ItemSpawner implements System {
  readonly group = new Group();
  readonly collectedItemIds = new Set<string>();
  readonly openedChestIds = new Set<string>();
  private readonly cells = new Map<number, ItemCell>();
  private readonly looseItems = new Map<string, { item: WorldItem; unregister: () => void }>();
  private readonly looseChests = new Map<
    string,
    { chest: TreasureChest; unregister: () => void }
  >();
  private readonly lastRefresh = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  private elapsed = 0;
  private nextLooseId = 0;
  private readonly spawnCellX: number;
  private readonly spawnCellZ: number;

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
    private readonly seed: number,
    private readonly focus: Readonly<Vec3Like>,
    private readonly inventory: Inventory,
    private readonly interactions: InteractionSystem,
    private readonly bus: EventBus<GameEvents>,
  ) {
    this.group.name = 'items';
    scene.add(this.group);
    this.spawnCellX = toCell(focus.x, ITEM_CELL_SIZE);
    this.spawnCellZ = toCell(focus.z, ITEM_CELL_SIZE);
  }

  get activeItems(): readonly WorldItem[] {
    const result: WorldItem[] = [];
    for (const cell of this.cells.values()) result.push(...cell.items);
    for (const loose of this.looseItems.values()) result.push(loose.item);
    return result;
  }

  get activeChests(): readonly TreasureChest[] {
    const result: TreasureChest[] = [];
    for (const cell of this.cells.values()) result.push(...cell.chests);
    for (const loose of this.looseChests.values()) result.push(loose.chest);
    return result;
  }

  frameUpdate(frameDt: number): void {
    this.elapsed += frameDt;
    const dx = this.focus.x - this.lastRefresh.x;
    const dz = this.focus.z - this.lastRefresh.z;
    if (dx * dx + dz * dz >= STREAMING_REFRESH_DISTANCE * STREAMING_REFRESH_DISTANCE) {
      this.refresh();
    }
    for (const cell of this.cells.values()) {
      for (const item of cell.items) item.frameUpdate(this.elapsed, frameDt);
      for (const chest of cell.chests) chest.frameUpdate(frameDt);
    }
    for (const loose of this.looseItems.values()) {
      loose.item.frameUpdate(this.elapsed, frameDt);
    }
    for (const loose of this.looseChests.values()) {
      loose.chest.frameUpdate(frameDt);
      const dx = loose.chest.position.x - this.focus.x;
      const dz = loose.chest.position.z - this.focus.z;
      if (dx * dx + dz * dz <= ITEM_ACTIVE_DISTANCE * ITEM_ACTIVE_DISTANCE) {
        if (!loose.chest.root.parent) this.group.add(loose.chest.root);
      } else {
        loose.chest.root.removeFromParent();
      }
    }
  }

  spawnDrop(itemId: string, count: number, position: Readonly<Vec3Like>): WorldItem {
    const id = `drop:${this.nextLooseId++}`;
    const angle = (hashInts(this.seed, this.nextLooseId) * (Math.PI * 2)) / 4294967296;
    const item = new WorldItem({
      id,
      itemId,
      count,
      x: position.x + Math.cos(angle) * 0.55,
      y: Math.max(position.y, this.terrain.heightAt(position.x, position.z)),
      z: position.z + Math.sin(angle) * 0.55,
      inventory: this.inventory,
      onCollected: (collected) => this.removeLooseItem(collected.id, true),
    });
    this.group.add(item.root);
    const unregister = this.interactions.register(item);
    this.looseItems.set(id, { item, unregister });
    return item;
  }

  spawnChest(
    id: string,
    itemId: string,
    position: Readonly<Vec3Like>,
    count = 1,
  ): TreasureChest | null {
    if (this.openedChestIds.has(id) || this.looseChests.has(id)) return null;
    const chest = new TreasureChest({
      id,
      itemId,
      count,
      x: position.x,
      y: this.terrain.heightAt(position.x, position.z),
      z: position.z,
      inventory: this.inventory,
      onOpened: (opened) => this.handleLooseChestOpened(opened),
    });
    this.group.add(chest.root);
    const unregister = this.interactions.register(chest);
    this.looseChests.set(id, { chest, unregister });
    return chest;
  }

  /** Marks a world pickup as taken by someone else. The local inventory is unchanged. */
  forgetPickup(id: string): void {
    this.collectedItemIds.add(id);
    this.removeLooseItem(id, false);
    for (const cell of this.cells.values()) {
      const index = cell.items.findIndex((item) => item.id === id);
      const item = index >= 0 ? cell.items[index] : undefined;
      if (!item) continue;
      cell.items.splice(index, 1);
      item.retire();
    }
  }

  /** Marks a chest opened by someone else without granting its loot here. */
  forgetChest(id: string): void {
    this.openedChestIds.add(id);
    const loose = this.looseChests.get(id);
    if (loose) {
      loose.unregister();
      loose.chest.retire();
      this.looseChests.delete(id);
    }
    for (const cell of this.cells.values()) {
      const index = cell.chests.findIndex((chest) => chest.id === id);
      const chest = index >= 0 ? cell.chests[index] : undefined;
      if (!chest) continue;
      cell.chests.splice(index, 1);
      chest.retire();
    }
  }

  restoreProgress(collectedItemIds: readonly string[], openedChestIds: readonly string[]): void {
    this.collectedItemIds.clear();
    this.openedChestIds.clear();
    for (const id of collectedItemIds) this.collectedItemIds.add(id);
    for (const id of openedChestIds) this.openedChestIds.add(id);
    this.clearCells();
    for (const [id, loose] of this.looseChests) {
      if (!this.openedChestIds.has(id)) continue;
      loose.unregister();
      loose.chest.dispose();
      this.looseChests.delete(id);
    }
    this.lastRefresh.x = Number.POSITIVE_INFINITY;
    this.lastRefresh.z = Number.POSITIVE_INFINITY;
    this.refresh();
  }

  reset(): void {
    this.clearCells();
    for (const loose of this.looseItems.values()) {
      loose.unregister();
      loose.item.dispose();
    }
    this.looseItems.clear();
    for (const loose of this.looseChests.values()) {
      loose.unregister();
      loose.chest.dispose();
    }
    this.looseChests.clear();
    this.collectedItemIds.clear();
    this.openedChestIds.clear();
    this.lastRefresh.x = Number.POSITIVE_INFINITY;
    this.lastRefresh.z = Number.POSITIVE_INFINITY;
    this.refresh();
  }

  /** Debug/browser-test helper: nearest currently active pickup. */
  nearestItem(position: Readonly<Vec3Like>): WorldItem | null {
    let result: WorldItem | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const item of this.activeItems) {
      const dx = item.position.x - position.x;
      const dy = item.position.y - position.y;
      const dz = item.position.z - position.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < best) {
        result = item;
        best = distance;
      }
    }
    return result;
  }

  dispose(): void {
    this.clearCells();
    for (const loose of this.looseItems.values()) {
      loose.unregister();
      loose.item.dispose();
    }
    this.looseItems.clear();
    for (const loose of this.looseChests.values()) {
      loose.unregister();
      loose.chest.dispose();
    }
    this.looseChests.clear();
    this.group.removeFromParent();
  }

  private refresh(): void {
    const { x, z } = this.focus;
    this.lastRefresh.x = x;
    this.lastRefresh.z = z;
    const centerX = toCell(x, ITEM_CELL_SIZE);
    const centerZ = toCell(z, ITEM_CELL_SIZE);
    const range = Math.ceil(ITEM_ACTIVE_DISTANCE / ITEM_CELL_SIZE) + 1;
    const wanted = new Set<number>();
    for (let cz = centerZ - range; cz <= centerZ + range; cz++) {
      for (let cx = centerX - range; cx <= centerX + range; cx++) {
        if (distanceToCell(x, z, cx, cz, ITEM_CELL_SIZE) > ITEM_ACTIVE_DISTANCE) continue;
        const key = cellKey(cx, cz);
        wanted.add(key);
        if (!this.cells.has(key)) this.cells.set(key, this.buildCell(cx, cz));
      }
    }
    for (const [key, cell] of this.cells) {
      if (wanted.has(key)) continue;
      this.disposeCell(cell);
      this.cells.delete(key);
    }
  }

  private buildCell(cx: number, cz: number): ItemCell {
    const items: WorldItem[] = [];
    const chests: TreasureChest[] = [];
    const unregister: (() => void)[] = [];
    const rng = mulberry32(hashInts(this.seed, cx, cz, 0x17a1));
    const originX = cx * ITEM_CELL_SIZE;
    const originZ = cz * ITEM_CELL_SIZE;
    for (let index = 0; index < PLACEMENT_ATTEMPTS; index++) {
      const forced = index === 0 && cx === this.spawnCellX && cz === this.spawnCellZ;
      const x = forced ? this.focus.x + 1.2 : originX + rng() * ITEM_CELL_SIZE;
      const z = forced ? this.focus.z + 1.4 : originZ + rng() * ITEM_CELL_SIZE;
      const y = this.terrain.heightAt(x, z);
      if (y <= WATER_LEVEL + 0.8) continue;
      const choices = ITEM_CHOICES[this.terrain.biomeAt(x, z)];
      if (choices.length === 0) continue;
      const itemId = choices[Math.floor(rng() * choices.length)];
      if (!itemId) continue;
      const id = `${cx}:${cz}:item:${index}`;
      if (this.collectedItemIds.has(id)) continue;
      const item = new WorldItem({
        id,
        itemId,
        x,
        y,
        z,
        inventory: this.inventory,
        onCollected: (collected) => {
          this.collectedItemIds.add(collected.id);
          this.bus.emit('world:pickup', { id: collected.id });
          const cell = this.cells.get(cellKey(cx, cz));
          if (!cell) return;
          const itemIndex = cell.items.indexOf(collected);
          if (itemIndex >= 0) cell.items.splice(itemIndex, 1);
          collected.dispose();
        },
      });
      this.group.add(item.root);
      items.push(item);
      unregister.push(this.interactions.register(item));
    }

    if (rng() < CHEST_CHANCE) {
      const x = originX + (0.2 + rng() * 0.6) * ITEM_CELL_SIZE;
      const z = originZ + (0.2 + rng() * 0.6) * ITEM_CELL_SIZE;
      const y = this.terrain.heightAt(x, z);
      const id = `${cx}:${cz}:chest`;
      if (y > WATER_LEVEL + 1 && !this.openedChestIds.has(id)) {
        const chest = new TreasureChest({
          id,
          itemId: rng() < 0.35 ? 'traveler-sword' : 'baked-apple',
          count: rng() < 0.35 ? 1 : 2,
          x,
          y,
          z,
          inventory: this.inventory,
          onOpened: (opened) => {
            this.openedChestIds.add(opened.id);
            this.bus.emit('chest:opened', { chestId: opened.id, itemId: opened.itemId });
          },
        });
        this.group.add(chest.root);
        chests.push(chest);
        unregister.push(this.interactions.register(chest));
      }
    }
    return { cx, cz, items, chests, unregister };
  }

  private handleLooseChestOpened(chest: TreasureChest): void {
    this.openedChestIds.add(chest.id);
    this.bus.emit('chest:opened', { chestId: chest.id, itemId: chest.itemId });
  }

  private removeLooseItem(id: string, announce: boolean): void {
    const loose = this.looseItems.get(id);
    if (!loose) return;
    loose.unregister();
    loose.item.retire();
    this.looseItems.delete(id);
    if (announce) this.bus.emit('world:pickup', { id });
  }

  private clearCells(): void {
    for (const cell of this.cells.values()) this.disposeCell(cell);
    this.cells.clear();
  }

  private disposeCell(cell: ItemCell): void {
    for (const callback of cell.unregister) callback();
    for (const item of cell.items) item.dispose();
    for (const chest of cell.chests) chest.dispose();
  }
}
