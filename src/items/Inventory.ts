import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { getItemDef, isItemId, type ItemId, type WeaponItemDef } from '../data/items';

export interface InventoryEntry {
  readonly itemId: ItemId;
  readonly count: number;
  readonly durability: number | null;
}

export interface InventoryData {
  readonly entries: readonly InventoryEntry[];
  readonly equippedWeapon: ItemId | null;
}

interface MutableEntry {
  itemId: ItemId;
  count: number;
  durability: number | null;
}

function copyEntry(entry: MutableEntry): InventoryEntry {
  return { itemId: entry.itemId, count: entry.count, durability: entry.durability };
}

function weaponDef(itemId: string): WeaponItemDef | undefined {
  const def = getItemDef(itemId);
  return def?.category === 'weapon' ? def : undefined;
}

/**
 * Three/DOM-independent inventory model. Stack limits and weapon durability come from the
 * typed item catalogue; all mutations publish gameplay events when a bus is supplied.
 */
export class Inventory {
  private readonly slots: MutableEntry[] = [];
  private equipped: ItemId | null = null;

  constructor(private readonly bus?: EventBus<GameEvents>) {}

  get entries(): readonly InventoryEntry[] {
    return this.slots.map(copyEntry);
  }

  get equippedWeaponId(): ItemId | null {
    return this.equipped;
  }

  get equippedWeapon(): InventoryEntry | null {
    if (!this.equipped) return null;
    const entry = this.slots.find((slot) => slot.itemId === this.equipped);
    return entry ? copyEntry(entry) : null;
  }

  count(itemId: string): number {
    let total = 0;
    for (const entry of this.slots) {
      if (entry.itemId === itemId) total += entry.count;
    }
    return total;
  }

  has(itemId: string, count = 1): boolean {
    return count > 0 && this.count(itemId) >= count;
  }

  /** Adds as many items as stack limits allow and returns the amount actually added. */
  add(itemId: string, count = 1): number {
    const def = getItemDef(itemId);
    if (!def || !Number.isInteger(count) || count <= 0) return 0;
    let remaining = count;
    if (def.stackable) {
      const existing = this.slots.find((entry) => entry.itemId === itemId);
      if (existing) {
        const added = Math.min(remaining, def.maxStack - existing.count);
        existing.count += added;
        remaining -= added;
      }
      while (remaining > 0) {
        const added = Math.min(remaining, def.maxStack);
        this.slots.push({ itemId: def.id as ItemId, count: added, durability: null });
        remaining -= added;
      }
    } else {
      while (remaining > 0) {
        this.slots.push({
          itemId: def.id as ItemId,
          count: 1,
          durability: def.category === 'weapon' ? (def.durability ?? null) : null,
        });
        remaining--;
      }
    }
    const added = count - remaining;
    if (added > 0) {
      this.bus?.emit('item:acquired', { itemId, count: added });
      this.emitChanged(itemId);
    }
    return added;
  }

  /** Removes up to `count` and returns the amount removed. */
  remove(itemId: string, count = 1): number {
    if (!Number.isInteger(count) || count <= 0) return 0;
    let remaining = count;
    for (let index = this.slots.length - 1; index >= 0 && remaining > 0; index--) {
      const entry = this.slots[index];
      if (!entry || entry.itemId !== itemId) continue;
      const removed = Math.min(entry.count, remaining);
      entry.count -= removed;
      remaining -= removed;
      if (entry.count === 0) this.slots.splice(index, 1);
    }
    const removed = count - remaining;
    if (removed > 0) {
      if (this.equipped === itemId && !this.has(itemId)) {
        this.equipped = null;
        this.bus?.emit('weapon:equipped', { itemId: null });
      }
      this.emitChanged(itemId);
    }
    return removed;
  }

  /** Removes one item and emits `item:consumed`. */
  consume(itemId: string): boolean {
    if (this.remove(itemId, 1) !== 1) return false;
    this.bus?.emit('item:consumed', { itemId });
    return true;
  }

  equipWeapon(itemId: string | null): boolean {
    if (itemId === null) {
      if (this.equipped === null) return true;
      this.equipped = null;
      this.bus?.emit('weapon:equipped', { itemId: null });
      return true;
    }
    if (!weaponDef(itemId) || !this.has(itemId) || !isItemId(itemId)) return false;
    this.equipped = itemId;
    this.bus?.emit('weapon:equipped', { itemId });
    return true;
  }

  /** Spends durability on the equipped weapon. Returns true if it broke. */
  damageEquippedWeapon(amount = 1): boolean {
    if (!this.equipped || amount <= 0) return false;
    const entry = this.slots.find((slot) => slot.itemId === this.equipped);
    if (!entry || entry.durability === null) return false;
    entry.durability = Math.max(0, entry.durability - amount);
    if (entry.durability > 0) {
      this.emitChanged(entry.itemId);
      return false;
    }
    const brokenId = entry.itemId;
    const index = this.slots.indexOf(entry);
    this.slots.splice(index, 1);
    this.equipped = null;
    this.bus?.emit('weapon:broken', { itemId: brokenId });
    this.bus?.emit('weapon:equipped', { itemId: null });
    this.emitChanged(brokenId);
    return true;
  }

  toJSON(): InventoryData {
    return {
      entries: this.slots.map(copyEntry),
      equippedWeapon: this.equipped,
    };
  }

  restore(data: unknown): boolean {
    if (!isInventoryData(data)) return false;
    this.slots.length = 0;
    for (const entry of data.entries) {
      this.slots.push({
        itemId: entry.itemId,
        count: entry.count,
        durability: entry.durability,
      });
    }
    this.equipped = data.equippedWeapon;
    this.bus?.emit('weapon:equipped', { itemId: this.equipped });
    this.bus?.emit('inventory:changed', { itemId: '', count: 0, total: this.slots.length });
    return true;
  }

  clear(): void {
    this.slots.length = 0;
    this.equipped = null;
    this.bus?.emit('weapon:equipped', { itemId: null });
    this.bus?.emit('inventory:changed', { itemId: '', count: 0, total: 0 });
  }

  static fromJSON(data: unknown, bus?: EventBus<GameEvents>): Inventory | null {
    if (!isInventoryData(data)) return null;
    const inventory = new Inventory(bus);
    for (const entry of data.entries) {
      inventory.slots.push({
        itemId: entry.itemId,
        count: entry.count,
        durability: entry.durability,
      });
    }
    inventory.equipped = data.equippedWeapon;
    return inventory;
  }

  private emitChanged(itemId: string): void {
    const count = this.count(itemId);
    this.bus?.emit('inventory:changed', { itemId, count, total: this.slots.length });
  }
}

export function isInventoryData(value: unknown): value is InventoryData {
  if (!isRecord(value) || !Array.isArray(value['entries'])) return false;
  const equipped = value['equippedWeapon'];
  if (equipped !== null && (typeof equipped !== 'string' || !weaponDef(equipped))) return false;
  let hasEquipped = equipped === null;
  for (const candidate of value['entries']) {
    if (!isRecord(candidate)) return false;
    const itemId = candidate['itemId'];
    const count = candidate['count'];
    const durability = candidate['durability'];
    if (typeof itemId !== 'string' || !isItemId(itemId)) return false;
    const def = getItemDef(itemId);
    if (
      !def ||
      !Number.isInteger(count) ||
      (count as number) <= 0 ||
      (count as number) > def.maxStack
    ) {
      return false;
    }
    if (durability !== null && (!Number.isFinite(durability) || (durability as number) < 0)) {
      return false;
    }
    if (def.category !== 'weapon' && durability !== null) return false;
    if (itemId === equipped) hasEquipped = true;
  }
  return hasEquipped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
