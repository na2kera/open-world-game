import { Vector3 } from 'three';

import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import type { PlayerController } from '../player/PlayerController';
import type { Vec3Like } from '../world/Terrain';

const GAME_OVER_SECONDS = 2.8;

/** Delayed death fade; inventory is untouched and recovery uses the latest save point. */
export class GameOverScreen implements System {
  readonly element = document.createElement('div');
  private readonly unsubscribe: () => void;
  private timer = -1;
  private readonly fallback = new Vector3();

  constructor(
    container: HTMLElement,
    bus: EventBus<GameEvents>,
    private readonly state: GameState,
    private readonly player: PlayerController,
    spawnPoint: Readonly<Vec3Like>,
    private readonly getSavePoint: () => Readonly<Vec3Like> | null,
  ) {
    this.fallback.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    this.element.className = 'game-over-screen';
    this.element.textContent = 'GAME OVER';
    this.element.hidden = true;
    container.appendChild(this.element);
    this.unsubscribe = bus.on('player:died', () => {
      this.timer = 0;
      this.element.hidden = false;
      this.state.set('dialog');
    });
  }

  frameUpdate(frameDt: number): void {
    if (this.timer < 0) return;
    this.timer += frameDt;
    this.element.classList.toggle('is-visible', this.timer >= 0.15);
    if (this.timer < GAME_OVER_SECONDS) return;
    this.player.reviveAt(this.getSavePoint() ?? this.fallback);
    this.timer = -1;
    this.element.classList.remove('is-visible');
    this.element.hidden = true;
    this.state.set('playing');
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }
}
