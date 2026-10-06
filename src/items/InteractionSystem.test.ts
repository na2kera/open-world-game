import { describe, expect, it } from 'vitest';

import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { PlayerController } from '../player/PlayerController';
import type { Interactable } from './Interactable';
import { InteractionSystem } from './InteractionSystem';

function makePlayer(x: number, y: number, z: number, facing = 0): PlayerController {
  return { position: { x, y, z }, facing } as unknown as PlayerController;
}

function makeInteractable(x: number, y: number, z: number): Interactable {
  return {
    position: { x, y, z },
    radius: 1.4,
    promptLabel: '起動',
    isAvailable: () => true,
    interact: () => {},
  };
}

describe('InteractionSystem', () => {
  it('offers a terminal the player is standing next to', () => {
    const bus = new EventBus<GameEvents>();
    const terminal = makeInteractable(0, 22.7, 1.5);
    const system = new InteractionSystem(bus, makePlayer(0, 22.7, 0), () => {});
    system.register(terminal);
    system.frameUpdate();
    expect(system.selected).toBe(terminal);
  });

  it('ignores a terminal that is far above or below the feet', () => {
    const bus = new EventBus<GameEvents>();
    const terminal = makeInteractable(0, 22.7, 1.5);
    const system = new InteractionSystem(bus, makePlayer(0, 12.3, 0), () => {});
    system.register(terminal);
    system.frameUpdate();
    expect(system.selected).toBeNull();
  });
});
