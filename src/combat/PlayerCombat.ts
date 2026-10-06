import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Object3D } from 'three';

import { COMBAT_CONFIG, PLAYER_CONFIG } from '../config';
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
import type { Terrain } from '../world/Terrain';
import type { WorldCollision } from '../world/WorldCollision';
import {
  COMBO_STAGES,
  ComboInputBuffer,
  isPointInAttackArc,
  isTerrainOccluded,
} from './combatMath';

export interface PlayerCombatDeps {
  readonly bus: EventBus<GameEvents>;
  readonly player: PlayerController;
  readonly avatar: PlayerAvatar;
  readonly camera: ThirdPersonCamera;
  readonly input: InputState;
  readonly inventory: Inventory;
  readonly getEnemies: () => readonly Enemy[];
  readonly labels: WorldLabelLayer;
  readonly terrain: Terrain;
  readonly collision: WorldCollision;
  readonly parent: Object3D;
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
  private readonly arrows: Arrow[] = [];

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
    this.updateArrows(dt);
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
    if (this.stage < 0 && this.attackBuffer.consume()) {
      if (!this.tryShoot()) this.startStage(0);
    }
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
    for (const arrow of this.arrows) arrow.dispose();
    this.arrows.length = 0;
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
        dx * dx + dz * dz > COMBAT_CONFIG.lockOnRange * COMBAT_CONFIG.lockOnRange ||
        !this.canSee(this.lockTarget)
      ) {
        this.lockTarget = null;
      }
    }
    if (!this.lockTarget) {
      let best = COMBAT_CONFIG.lockOnRange * COMBAT_CONFIG.lockOnRange;
      for (const enemy of this.deps.getEnemies()) {
        if (!this.canSee(enemy)) continue;
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

  private canSee(enemy: Enemy): boolean {
    const from = {
      x: this.deps.player.position.x,
      y: this.deps.player.position.y + PLAYER_CONFIG.chestHeight,
      z: this.deps.player.position.z,
    };
    const to = { x: enemy.position.x, y: enemy.position.y + 1.1, z: enemy.position.z };
    if (isTerrainOccluded((x, z) => this.deps.terrain.heightAt(x, z), from, to)) return false;
    return !this.deps.collision.blocksSight(from, to);
  }

  /** Fires an arrow when the equipped weapon is a bow. Returns true for any ranged weapon. */
  private tryShoot(): boolean {
    const equippedId = this.deps.inventory.equippedWeaponId;
    const equipped = equippedId ? getItemDef(equippedId) : undefined;
    if (equipped?.category !== 'weapon' || !equipped.ranged) return false;
    const arrowId = equipped.ranged.arrowId;
    if (!this.deps.inventory.consume(arrowId)) return true;
    const speed = equipped.ranged.speed;
    const direction = this.aimDirection();
    const origin = this.deps.player.position;
    this.arrows.push(
      new Arrow(
        this.deps.parent,
        origin.x + direction.x * 0.6,
        origin.y + PLAYER_CONFIG.chestHeight + direction.y * 0.4,
        origin.z + direction.z * 0.6,
        direction.x * speed,
        direction.y * speed,
        direction.z * speed,
        Math.max(1, equipped.attack),
      ),
    );
    this.deps.inventory.damageEquippedWeapon();
    return true;
  }

  private aimDirection(): Vector3 {
    const locked = this.lockTarget;
    if (locked) {
      const origin = this.deps.player.position;
      const direction = new Vector3(
        locked.position.x - origin.x,
        locked.position.y + 1.1 - (origin.y + PLAYER_CONFIG.chestHeight),
        locked.position.z - origin.z,
      );
      if (direction.lengthSq() > 0) return direction.normalize();
    }
    const { yaw, pitch } = this.deps.camera;
    const cosPitch = Math.cos(pitch);
    return new Vector3(-Math.sin(yaw) * cosPitch, -Math.sin(pitch), -Math.cos(yaw) * cosPitch);
  }

  private updateArrows(dt: number): void {
    for (let index = this.arrows.length - 1; index >= 0; index--) {
      const arrow = this.arrows[index];
      if (!arrow) continue;
      const done = arrow.advance(dt, this.deps.terrain, this.deps.getEnemies());
      if (!done) continue;
      arrow.dispose();
      this.arrows.splice(index, 1);
    }
  }

  private releaseLockOn(): void {
    this.lockTarget = null;
    this.deps.camera.setLookTarget(null);
    this.deps.player.setCombatFacing(null);
  }
}

const ARROW_GEOMETRY = new SphereGeometry(0.08, 6, 4);
const ARROW_MATERIAL = new MeshStandardMaterial({ color: 0xd7c08a, roughness: 0.6 });
const ARROW_GRAVITY = 12;

class Arrow {
  private readonly mesh = new Mesh(ARROW_GEOMETRY, ARROW_MATERIAL);
  private readonly velocity = new Vector3();
  private life = 1.8;

  constructor(
    parent: Object3D,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    private readonly damageAmount: number,
  ) {
    this.mesh.position.set(x, y, z);
    this.mesh.castShadow = true;
    this.velocity.set(vx, vy, vz);
    parent.add(this.mesh);
  }

  advance(dt: number, terrain: Terrain, enemies: readonly Enemy[]): boolean {
    this.life -= dt;
    this.velocity.y -= ARROW_GRAVITY * dt;
    this.mesh.position.addScaledVector(this.velocity, dt);
    const point = this.mesh.position;
    if (this.life <= 0 || point.y <= terrain.heightAt(point.x, point.z)) return true;
    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;
      const dx = enemy.position.x - point.x;
      const dy = enemy.position.y + 1 - point.y;
      const dz = enemy.position.z - point.z;
      if (dx * dx + dy * dy + dz * dz > 0.64) continue;
      enemy.damage(this.damageAmount, point);
      return true;
    }
    return false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
