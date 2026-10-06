import { describe, expect, it } from 'vitest';

import { RoomHub } from './room';

describe('RoomHub', () => {
  it('locks the seed to the first player and replays world events to the next', () => {
    const hub = new RoomHub();
    const first = hub.join({ room: 'Wildlands', seed: 20260, name: '  リン  ' });
    const second = hub.join({ room: 'wildlands', seed: 1, name: '' });
    expect(first?.seed).toBe(20260);
    expect(second?.seed).toBe(20260);
    expect(second?.players).toHaveLength(1);
    expect(second?.players[0]?.name).toBe('リン');
    expect(hub.world('wildlands', { kind: 'tower', id: 'tower-0' })?.id).toBe('tower-0');
    expect(hub.world('wildlands', { kind: 'tower', id: 'tower-0' })).toBeNull();
    const third = hub.join({ room: 'wildlands', seed: 9, name: 'ソラ' });
    expect(third?.events).toEqual([{ kind: 'tower', id: 'tower-0' }]);
  });

  it('keeps the joined name when a snapshot arrives and frees the room on leave', () => {
    const hub = new RoomHub();
    const joined = hub.join({ room: 'camp', seed: 3, name: 'イオリ' });
    expect(joined).not.toBeNull();
    if (!joined) return;
    const moved = hub.snapshot('camp', {
      id: joined.id,
      name: 'ignored',
      x: 4,
      y: 1,
      z: 2,
      facing: 0.5,
      anim: 'ground',
      hp: 8,
      maxHp: 12,
    });
    expect(moved?.x).toBe(4);
    expect(moved?.name).toBe('イオリ');
    expect(hub.leave('camp', joined.id)).toBe(true);
    const again = hub.join({ room: 'camp', seed: 8, name: 'ミラ' });
    expect(again?.seed).toBe(8);
  });

  it('keeps the seed and events when the last player disconnects', () => {
    const hub = new RoomHub();
    const joined = hub.join({ room: 'camp', seed: 11, name: 'リン' });
    expect(joined).not.toBeNull();
    if (!joined) return;
    hub.world('camp', { kind: 'tower', id: 'tower-a' });
    expect(hub.disconnect('camp', joined.id)).toBe(true);
    expect(hub.exportState('camp')).toEqual({
      seed: 11,
      events: [{ kind: 'tower', id: 'tower-a' }],
    });
    const next = hub.join({ room: 'camp', seed: 1, name: 'ソラ' });
    expect(next?.seed).toBe(11);
    expect(next?.events).toEqual([{ kind: 'tower', id: 'tower-a' }]);
  });

  it('restores a room from stored seed and events', () => {
    const hub = new RoomHub();
    hub.hydrate('kept', 4, [{ kind: 'chest', id: 'camp:chest' }]);
    const restored = hub.join({ room: 'kept', seed: 99, name: 'ソラ' });
    expect(restored?.seed).toBe(4);
    expect(restored?.events).toEqual([{ kind: 'chest', id: 'camp:chest' }]);
  });
});
