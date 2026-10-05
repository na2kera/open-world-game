import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { Inventory } from './Inventory';

describe('Inventory', () => {
  it('adds, stacks, removes and caps stackable items', () => {
    const inventory = new Inventory();
    expect(inventory.add('apple', 3)).toBe(3);
    expect(inventory.add('apple', 200)).toBe(200);
    expect(inventory.count('apple')).toBe(203);
    expect(inventory.entries.every((entry) => entry.count <= 99)).toBe(true);
    expect(inventory.remove('apple', 4)).toBe(4);
    expect(inventory.has('apple', 199)).toBe(true);
  });

  it('equips, damages and breaks weapons', () => {
    const bus = new EventBus<GameEvents>();
    const broken = vi.fn();
    bus.on('weapon:broken', broken);
    const inventory = new Inventory(bus);
    inventory.add('wooden-stick');
    expect(inventory.equipWeapon('wooden-stick')).toBe(true);
    for (let i = 0; i < 12; i++) inventory.damageEquippedWeapon();
    expect(inventory.count('wooden-stick')).toBe(0);
    expect(inventory.equippedWeaponId).toBeNull();
    expect(broken).toHaveBeenCalledWith({ itemId: 'wooden-stick' });
  });

  it('serializes and restores without sharing mutable data', () => {
    const inventory = new Inventory();
    inventory.add('apple', 5);
    inventory.add('traveler-sword');
    inventory.equipWeapon('traveler-sword');
    inventory.damageEquippedWeapon(3);

    const restored = Inventory.fromJSON(inventory.toJSON());
    expect(restored?.toJSON()).toEqual(inventory.toJSON());
    restored?.remove('apple');
    expect(inventory.count('apple')).toBe(5);
  });

  it('rejects malformed serialized data', () => {
    expect(Inventory.fromJSON(null)).toBeNull();
    expect(
      Inventory.fromJSON({
        entries: [{ itemId: 'missing', count: 1, durability: null }],
        equippedWeapon: null,
      }),
    ).toBeNull();
    expect(
      Inventory.fromJSON({
        entries: [{ itemId: 'apple', count: -1, durability: null }],
        equippedWeapon: null,
      }),
    ).toBeNull();
  });
});
