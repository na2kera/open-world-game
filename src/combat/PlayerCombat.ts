import { Vector3 } from 'three';

import { COMBAT_CONFIG } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { System } from '../core/System';
import { getItemDef } from '../data/items';
import type { Enemy } from '../entities/Enemy';
import type { Inventory } from '../items/Inventory';
import type { InputState } from '../input/types';
import type { PlayerAvatar } from '../player/PlayerAvatar';
import type { PlayerController } from '../player/PlayerController';
import type { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import type { WorldLabelHandle, WorldLabelLayer } from '../ui/WorldLabelLayer';
import { COMBO_STAGES, ComboInputBuffer, isPointInAttackArc } from './combatMath';

export interface PlayerCombatDeps {
  readonly bus: EventBus<GameEvents>;
  readonly player: PlayerController;
  readonly avatar: PlayerAvatar;
  readonly camera: ThirdPersonCamera;
  readonly input: InputState;
  readonly inventory: Inventory;
  readonly getEnemies: () => readonly Enemy[];
  readonly labels: WorldLabelLayer;
}

const tmpMarker = new Vector3();

/** Player melee combo, dodge and lock-on coordinator. */
export class PlayerCombat implements System {
  private readonly attackBuffer = new ComboInputBuffer();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly lockMarker: WorldLabelHandle;
  private stage = -1;
  private stageTime = 0;
  private didHit = false;
  private dodgeQueued = false;
  private lockTarget: Enemy | null = null;

  constructor(private readonly deps: PlayerCombatDeps) {
    this.unsubscribers.push(
      deps.bus.on('player:attack', () => this.attackBuffer.press()),
      deps.bus.on('player:dodge', () => {
        this.dodgeQueued = true;
      }),
      deps.bus.on('weapon:equipped', ({ itemId }) => deps.avatar.setWeapon(itemId)),
      deps.bus.on('weapon:broken', () => deps.avatar.setWeapon(null)),
    );
    deps.avatar.setWeapon(deps.inventory.equippedWeaponId);
    this.lockMarker = deps.labels.add({
      className: 'lock-on-marker',
      getPosition: (out) => {
        if (!this.lockTarget) return out.set(0, -1000, 0);
        return out.copy(this.lockTarget.position).add(tmpMarker.set(0, 1.25, 0));
      },
      isVisible: () => this.lockTarget !== null,
    });
    this.lockMarker.element.textContent = '◇';
  }

  get isInCombat(): boolean {
    return this.lockTarget !== null || this.stage >= 0;
  }

  get lockedEnemy(): Enemy | null {
    return this.lockTarget;
  }

  reset(): void {
    this.endAttack();
    this.releaseLockOn();
  }

  update(dt: number): void {
    if (this.deps.player.isDead) {
      this.endAttack();
      this.releaseLockOn();
      return;
    }
    this.attackBuffer.update(dt);
    this.updateLockOn();
    if (this.dodgeQueued) {
      this.dodgeQueued = false;
      this.performDodge();
    }
    if (this.stage < 0 && this.attackBuffer.consume()) this.startStage(0);
    if (this.stage < 0) return;
    const stage = COMBO_STAGES[this.stage];
    if (!stage) {
      this.endAttack();
      return;
    }
    this.stageTime += dt;
    const activeStart = stage.windup;
    const activeEnd = activeStart + stage.active;
    const total = activeEnd + stage.recovery;
    if (!this.didHit && this.stageTime >= activeStart) {
      this.didHit = true;
      this.hitEnemies(stage.damageScale);
    }
    this.deps.avatar.setAttackPose(
      Math.min(1, this.stageTime / (stage.windup + stage.active)),
      stage.direction,
      true,
    );
    if (this.stageTime < total) return;
    if (this.stage + 1 < COMBO_STAGES.length && this.attackBuffer.consume()) {
      this.startStage(this.stage + 1);
    } else {
      this.endAttack();
    }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.lockMarker.remove();
    this.releaseLockOn();
  }

  private startStage(stage: number): void {
    this.stage = stage;
    this.stageTime = 0;
    this.didHit = false;
    const forwardX = Math.sin(this.deps.player.facing);
    const forwardZ = Math.cos(this.deps.player.facing);
    this.deps.player.dash(forwardX, forwardZ, 0.18);
  }

  private endAttack(): void {
    this.stage = -1;
    this.stageTime = 0;
    this.didHit = false;
    this.attackBuffer.clear();
    this.deps.avatar.setAttackPose(0, 1, false);
  }

  private hitEnemies(damageScale: number): void {
    const player = this.deps.player;
    const equippedId = this.deps.inventory.equippedWeaponId;
    const equipped = equippedId ? getItemDef(equippedId) : undefined;
    const baseAttack =
      equipped?.category === 'weapon' ? equipped.attack : COMBAT_CONFIG.unarmedAttack;
    const damage = Math.max(1, Math.round(baseAttack * damageScale));
    let hit = false;
    for (const enemy of this.deps.getEnemies()) {
      if (
        !isPointInAttackArc(player.position, player.facing, enemy.position) ||
        Math.abs(enemy.position.y - player.position.y) > 3
      ) {
        continue;
      }
      enemy.damage(damage, player.position);
      hit = true;
    }
    if (!hit) return;
    this.deps.camera.shake(0.09, 0.1);
    if (equipped?.category === 'weapon') this.deps.inventory.damageEquippedWeapon();
  }

  private performDodge(): void {
    const player = this.deps.player;
    if (!player.stamina.canExert) return;
    player.stamina.consume(COMBAT_CONFIG.dodgeStamina);
    const move = this.deps.input.move;
    const yaw = this.deps.camera.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    let x = cos * move.x - sin * move.y;
    let z = -sin * move.x - cos * move.y;
    if (Math.hypot(x, z) < 0.15) {
      x = Math.sin(player.facing);
      z = Math.cos(player.facing);
    }
    player.dash(x, z, COMBAT_CONFIG.dodgeDistance);
    player.grantInvulnerability(COMBAT_CONFIG.dodgeInvulnerability);
    this.deps.camera.shake(0.08, 0.04);
  }

  private updateLockOn(): void {
    if (!this.deps.input.buttons.lockOn.held) {
      this.releaseLockOn();
      return;
    }
    const player = this.deps.player.position;
    if (this.lockTarget) {
      const dx = this.lockTarget.position.x - player.x;
      const dz = this.lockTarget.position.z - player.z;
      if (
        !this.lockTarget.active ||
        !this.lockTarget.isAlive ||
        dx * dx + dz * dz > COMBAT_CONFIG.lockOnRange * COMBAT_CONFIG.lockOnRange
      ) {
        this.lockTarget = null;
      }
    }
    if (!this.lockTarget) {
      let best = COMBAT_CONFIG.lockOnRange * COMBAT_CONFIG.lockOnRange;
      for (const enemy of this.deps.getEnemies()) {
        const dx = enemy.position.x - player.x;
        const dz = enemy.position.z - player.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < best) {
          best = distanceSq;
          this.lockTarget = enemy;
        }
      }
    }
    if (this.lockTarget) {
      this.deps.camera.setLookTarget(this.lockTarget.position);
      this.deps.player.setCombatFacing(this.lockTarget.position);
    } else {
      this.deps.camera.setLookTarget(null);
      this.deps.player.setCombatFacing(null);
    }
  }

  private releaseLockOn(): void {
    this.lockTarget = null;
    this.deps.camera.setLookTarget(null);
    this.deps.player.setCombatFacing(null);
  }
}
