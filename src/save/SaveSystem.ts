import { Vector3 } from 'three';

import { SAVE_INTERVAL_SEC } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { System } from '../core/System';
import type { SaveData } from './SaveData';
import type { SaveManager } from './SaveManager';

export interface SaveSystemDeps {
  readonly bus: EventBus<GameEvents>;
  readonly manager: SaveManager;
  readonly createData: () => SaveData;
  readonly applyData: (data: SaveData) => void;
}

/** Autosave triggers and last-save-point ownership around the pure SaveManager. */
export class SaveSystem implements System {
  private readonly unsubscribers: (() => void)[] = [];
  private readonly lastPoint = new Vector3();
  private hasPoint = false;
  private timer = 0;

  constructor(private readonly deps: SaveSystemDeps) {
    this.unsubscribers.push(
      deps.bus.on('camp:cleared', () => this.save('auto')),
      deps.bus.on('chest:opened', () => this.save('auto')),
    );
  }

  get lastSavePoint(): Readonly<Vector3> | null {
    return this.hasPoint ? this.lastPoint : null;
  }

  update(dt: number): void {
    this.timer += dt;
    if (this.timer >= SAVE_INTERVAL_SEC) this.save('auto');
  }

  save(reason: 'auto' | 'manual'): boolean {
    this.timer = 0;
    const data = this.deps.createData();
    this.deps.bus.emit('save:started', undefined);
    const saved = this.deps.manager.save(data);
    if (!saved) return false;
    this.lastPoint.set(data.player.position.x, data.player.position.y, data.player.position.z);
    this.hasPoint = true;
    this.deps.bus.emit('save:completed', { reason });
    return true;
  }

  load(): boolean {
    const data = this.deps.manager.load();
    if (!data) return false;
    this.deps.applyData(data);
    this.lastPoint.set(data.player.position.x, data.player.position.y, data.player.position.z);
    this.hasPoint = true;
    this.timer = 0;
    this.deps.bus.emit('save:loaded', undefined);
    return true;
  }

  resetSavePoint(): void {
    this.hasPoint = false;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }
}
