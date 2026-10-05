import { INTERACTION_DISTANCE, INTERACTION_FORWARD_DOT } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { System } from '../core/System';
import type { PlayerController } from '../player/PlayerController';
import type { Interactable } from './Interactable';

export type InteractionPromptListener = (interactable: Interactable | null) => void;

/**
 * Selects the nearest available interactable within reach and roughly in front of the player.
 * Registration is deliberately generic so Phase 2b NPCs can join the same prompt pipeline.
 */
export class InteractionSystem implements System {
  private readonly interactables = new Set<Interactable>();
  private selectedValue: Interactable | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    bus: EventBus<GameEvents>,
    private readonly player: PlayerController,
    private readonly onPromptChange: InteractionPromptListener,
  ) {
    this.unsubscribe = bus.on('player:interact', () => this.selectedValue?.interact());
  }

  get selected(): Interactable | null {
    return this.selectedValue;
  }

  register(interactable: Interactable): () => void {
    this.interactables.add(interactable);
    return () => {
      this.interactables.delete(interactable);
      if (this.selectedValue === interactable) this.setSelected(null);
    };
  }

  frameUpdate(): void {
    const player = this.player.position;
    const forwardX = Math.sin(this.player.facing);
    const forwardZ = Math.cos(this.player.facing);
    let nearest: Interactable | null = null;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    for (const interactable of this.interactables) {
      if (!interactable.isAvailable()) continue;
      const dx = interactable.position.x - player.x;
      const dz = interactable.position.z - player.z;
      const maxDistance = INTERACTION_DISTANCE + interactable.radius;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > maxDistance * maxDistance || distanceSq >= nearestDistanceSq) continue;
      const distance = Math.sqrt(distanceSq);
      if (distance > 0 && (dx * forwardX + dz * forwardZ) / distance < INTERACTION_FORWARD_DOT) {
        continue;
      }
      nearest = interactable;
      nearestDistanceSq = distanceSq;
    }
    this.setSelected(nearest);
  }

  dispose(): void {
    this.unsubscribe();
    this.interactables.clear();
    this.setSelected(null);
  }

  private setSelected(next: Interactable | null): void {
    if (next === this.selectedValue) return;
    this.selectedValue = next;
    this.onPromptChange(next);
  }
}
