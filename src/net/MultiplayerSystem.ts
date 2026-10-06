import type { Object3D } from 'three';

import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { System } from '../core/System';
import type { EnemySpawner } from '../entities/EnemySpawner';
import type { ItemSpawner } from '../items/ItemSpawner';
import type { PlayerController } from '../player/PlayerController';
import type { GameplayFlow } from '../story/GameplayFlow';
import type { Hud } from '../ui/Hud';
import type { WorldLabelLayer } from '../ui/WorldLabelLayer';
import { RemoteAvatar } from './RemoteAvatar';
import type { ServerMessage } from './protocol';
import type { NetPlayer, WorldEvent } from './room';
import type { MultiplayerConnection } from './session';

const SEND_INTERVAL = 0.1;

export interface MultiplayerDeps {
  readonly connection: MultiplayerConnection;
  readonly bus: EventBus<GameEvents>;
  readonly player: PlayerController;
  readonly parent: Object3D;
  readonly labels: WorldLabelLayer;
  readonly items: ItemSpawner;
  readonly enemies: EnemySpawner;
  readonly flow: GameplayFlow;
  readonly hud: Hud;
}

/** Sends this player to the room and applies everyone else's presence and world events. */
export class MultiplayerSystem implements System {
  private readonly avatars = new Map<string, RemoteAvatar>();
  private readonly unsubscribeNet: () => void;
  private readonly unsubscribeBus: (() => void)[] = [];
  private applying = false;
  private sendTimer = 0;

  constructor(private readonly deps: MultiplayerDeps) {
    for (const player of deps.connection.players) this.upsert(player, true);
    for (const event of deps.connection.events) this.applyEvent(event);
    this.unsubscribeNet = deps.connection.subscribe((message) => this.onMessage(message));
    this.unsubscribeBus.push(
      deps.bus.on('world:pickup', ({ id }) => this.sendEvent({ kind: 'pickup', id })),
      deps.bus.on('chest:opened', ({ chestId }) => this.sendEvent({ kind: 'chest', id: chestId })),
      deps.bus.on('enemy:killed', ({ enemyId }) => this.sendEvent({ kind: 'enemy', id: enemyId })),
      deps.bus.on('tower:activated', ({ towerId }) =>
        this.sendEvent({ kind: 'tower', id: towerId }),
      ),
    );
    this.refreshHud();
  }

  frameUpdate(dt: number): void {
    this.sendTimer += dt;
    if (this.sendTimer >= SEND_INTERVAL) {
      this.sendTimer = 0;
      this.sendSnapshot();
    }
    for (const avatar of this.avatars.values()) avatar.frameUpdate(dt);
  }

  dispose(): void {
    this.unsubscribeNet();
    for (const unsubscribe of this.unsubscribeBus) unsubscribe();
    for (const avatar of this.avatars.values()) avatar.dispose();
    this.avatars.clear();
    this.deps.connection.close();
    this.deps.hud.setOnline(null);
  }

  private onMessage(message: ServerMessage): void {
    if (message.type === 'presence') this.upsert(message.player, false);
    else if (message.type === 'leave') this.remove(message.id);
    else if (message.type === 'world') this.applyEvent(message.event);
  }

  private upsert(player: NetPlayer, snap: boolean): void {
    if (player.id === this.deps.connection.selfId) return;
    const existing = this.avatars.get(player.id);
    if (existing) {
      existing.apply(player, snap);
      return;
    }
    this.avatars.set(player.id, new RemoteAvatar(player, this.deps.parent, this.deps.labels));
    this.refreshHud();
  }

  private remove(id: string): void {
    this.avatars.get(id)?.dispose();
    this.avatars.delete(id);
    this.refreshHud();
  }

  private applyEvent(event: WorldEvent): void {
    this.applying = true;
    if (event.kind === 'pickup') this.deps.items.forgetPickup(event.id);
    else if (event.kind === 'chest') this.deps.items.forgetChest(event.id);
    else if (event.kind === 'enemy') {
      this.deps.enemies.forgetEnemy(event.id);
      this.deps.flow.dismissEnemy(event.id);
    } else this.deps.flow.syncTower(event.id);
    this.applying = false;
  }

  private sendEvent(event: WorldEvent): void {
    if (this.applying) return;
    this.deps.connection.send({ type: 'world', event });
  }

  private sendSnapshot(): void {
    const player = this.deps.player;
    this.deps.connection.send({
      type: 'snapshot',
      player: {
        id: this.deps.connection.selfId,
        name: '',
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        facing: player.facing,
        anim: player.state,
        hp: player.stats.hp,
        maxHp: player.stats.maxHp,
      },
    });
  }

  private refreshHud(): void {
    this.deps.hud.setOnline(this.avatars.size + 1);
  }
}
