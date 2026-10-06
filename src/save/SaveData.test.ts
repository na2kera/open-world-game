import { describe, expect, it } from 'vitest';

import { Inventory } from '../items/Inventory';
import { deserializeSaveData, serializeSaveData, type SaveData } from './SaveData';
import { SAVE_STORAGE_KEY, SaveManager, type SaveStorage } from './SaveManager';

class MemoryStorage implements SaveStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function sampleSave(): SaveData {
  const inventory = new Inventory();
  inventory.add('apple', 3);
  inventory.add('traveler-sword');
  inventory.equipWeapon('traveler-sword');
  return {
    version: 1,
    seed: 20260,
    player: {
      position: { x: 1, y: 2, z: 3 },
      hp: 10,
      maxHp: 12,
      maxStamina: 100,
    },
    inventory: inventory.toJSON(),
    equippedWeapon: 'traveler-sword',
    timeOfDay: 0.4,
    day: 2,
    collectedItemIds: ['0:0:1'],
    openedChestIds: ['chest:0:0'],
    clearedCamps: [{ campId: 'camp:1', clearedAtDay: 1 }],
    quests: {},
    story: {},
  };
}

describe('SaveData', () => {
  it('round-trips a valid save', () => {
    const save = sampleSave();
    expect(deserializeSaveData(serializeSaveData(save))).toEqual(save);
  });

  it('rejects malformed or unsupported saves', () => {
    expect(deserializeSaveData('{broken')).toBeNull();
    expect(deserializeSaveData(JSON.stringify({ ...sampleSave(), version: 99 }))).toBeNull();
    expect(
      deserializeSaveData(
        JSON.stringify({ ...sampleSave(), player: { ...sampleSave().player, hp: -1 } }),
      ),
    ).toBeNull();
  });

  it('persists through SaveManager and ignores corrupt storage', () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    expect(manager.hasSave()).toBe(false);
    expect(manager.save(sampleSave())).toBe(true);
    expect(manager.load()).toEqual(sampleSave());
    storage.values.set(SAVE_STORAGE_KEY, 'not json');
    expect(manager.load()).toBeNull();
    manager.clear();
    expect(storage.values.size).toBe(0);
  });
});
