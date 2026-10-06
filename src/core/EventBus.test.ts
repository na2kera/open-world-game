import { describe, expect, it, vi } from 'vitest';

import { EventBus } from './EventBus';
import { GameState } from './GameState';

interface TestEvents {
  ping: { n: number };
  done: undefined;
}

describe('EventBus', () => {
  it('delivers payloads to subscribers and supports unsubscribe', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();
    const off = bus.on('ping', listener);
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ n: 1 });
  });

  it('once fires a single time', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();
    bus.once('done', listener);
    bus.emit('done', undefined);
    bus.emit('done', undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('GameState', () => {
  it('only allows listed transitions and reports changes', () => {
    const changes: string[] = [];
    const state = new GameState('title', (from, to) => changes.push(`${from}->${to}`));
    expect(state.set('paused')).toBe(false);
    expect(state.set('playing')).toBe(true);
    expect(state.togglePause()).toBe(true);
    expect(state.mode).toBe('paused');
    expect(state.isSimulating).toBe(false);
    expect(state.togglePause()).toBe(true);
    expect(changes).toEqual(['title->playing', 'playing->paused', 'paused->playing']);
  });
});
