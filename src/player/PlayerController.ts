import { Vector2, Vector3 } from 'three';

import { COMBAT_CONFIG, PLAYER_CONFIG, STAMINA_CONFIG, WATER_LEVEL } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, PositionPayload } from '../core/events';
import type { System } from '../core/System';
import type { InputState } from '../input/types';
import { damp, dampAngle, lerpAngle, clamp } from '../utils/math';
import type { Terrain, Vec3Like } from '../world/Terrain';
import type { WorldCollision } from '../world/WorldCollision';
import { Stamina } from './Stamina';
import type { DamageCause, MovementState, PlayerStats } from './types';

/** Dependencies of {@link PlayerController}. */
export interface PlayerControllerDeps {
  terrain: Terrain;
  collision: WorldCollision;
  input: InputState;
  bus: EventBus<GameEvents>;
  /** Current camera yaw (radians); movement is camera-relative. */
  getCameraYaw: () => number;
  spawnPoint: Readonly<Vec3Like>;
}

const DEG_TO_RAD = Math.PI / 180;
const COS_MAX_WALK_SLOPE = Math.cos(PLAYER_CONFIG.maxWalkSlopeDeg * DEG_TO_RAD);
const COS_CLIMB_EXIT = Math.cos(
  (PLAYER_CONFIG.maxWalkSlopeDeg - PLAYER_CONFIG.climbExitHysteresisDeg) * DEG_TO_RAD,
);
const JUMP_VELOCITY = Math.sqrt(2 * PLAYER_CONFIG.gravity * PLAYER_CONFIG.jumpHeight);
/** Stick deflection below which the player counts as idle. */
const MOVE_EPSILON = 0.1;
/** How directly the stick must point into a steep slope to start climbing (cosine). */
const CLIMB_ENTER_DOT = 0.35;
/** Stamina spent by jumping off a wall. */
const CLIMB_JUMP_COST = 15;
/** Horizontal speed below which the facing direction is kept. */
const TURN_MIN_SPEED = 0.4;
/** Smoothing for the swim float height. */
const SWIM_FLOAT_LAMBDA = 8;
/** Swimming accelerates at this fraction of ground acceleration. */
const SWIM_ACCEL_FACTOR = 0.5;
/** Maximum slide speed (u/s). */
const MAX_SLIDE_SPEED = 14;
/** Fraction of ground acceleration available for steering while sliding. */
const SLIDE_CONTROL = 0.3;
/** Minimum height above water for a "safe ground" respawn snapshot. */
const SAFE_GROUND_MIN_HEIGHT = WATER_LEVEL + 0.5;

const tmpWish = new Vector2();
const tmpHorizontal = new Vector2();
const tmpUp = new Vector3();

/** Copies a vector into a fresh event payload. */
function payload(v: Vec3Like): PositionPayload {
  return { x: v.x, y: v.y, z: v.z };
}

/** Moves the 2D vector `v` towards `target` by at most `maxDelta`. */
function moveTowards2(v: Vector2, target: Vector2, maxDelta: number): void {
  const dx = target.x - v.x;
  const dy = target.y - v.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxDelta || dist === 0) {
    v.copy(target);
  } else {
    v.x += (dx / dist) * maxDelta;
    v.y += (dy / dist) * maxDelta;
  }
}

/**
 * Player locomotion at the fixed simulation rate: camera-relative walking / sprinting,
 * jumping (coyote time + buffer), climbing steep slopes, sliding, swimming, stamina, HP and
 * fall damage. Exposes the previous and current position for render interpolation.
 */
export class PlayerController implements System {
  /** Feet position. */
  readonly position = new Vector3();
  readonly previousPosition = new Vector3();
  readonly velocity = new Vector3();
  /** Yaw of the body (0 = facing +Z). */
  facing = 0;
  previousFacing = 0;
  state: MovementState = 'ground';
  /** Surface normal under the player (valid on ground / climb / slide). */
  readonly surfaceNormal = new Vector3(0, 1, 0);
  /** Stick magnitude used this step (0..1). */
  moveAmount = 0;
  isSprinting = false;
  isDead = false;
  readonly stamina = new Stamina();
  readonly stats: PlayerStats = {
    hp: PLAYER_CONFIG.maxHpQuarters,
    maxHp: PLAYER_CONFIG.maxHpQuarters,
    stamina: STAMINA_CONFIG.max,
    maxStamina: STAMINA_CONFIG.max,
    staminaExhausted: false,
  };

  private readonly horizontal = new Vector2();
  private readonly lastSafe = new Vector3();
  private readonly spawn = new Vector3();
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private fallStartY = 0;
  private safeTimer = 0;
  private drain = 0;
  private invulnerabilityTimer = 0;
  private combatFacingTarget: Readonly<Vec3Like> | null = null;

  constructor(private readonly deps: PlayerControllerDeps) {
    this.spawn.set(deps.spawnPoint.x, deps.spawnPoint.y, deps.spawnPoint.z);
    this.placeAt(this.spawn);
  }

  /** Interpolated feet position for rendering. */
  getInterpolatedPosition(alpha: number, out: Vector3): Vector3 {
    return out.lerpVectors(this.previousPosition, this.position, alpha);
  }

  /** Interpolated facing for rendering. */
  getInterpolatedFacing(alpha: number): number {
    return lerpAngle(this.previousFacing, this.facing, alpha);
  }

  /** Teleports the player onto the ground at (x, z) and resets motion. */
  placeAt(point: Readonly<Vec3Like>): void {
    const y = Math.max(this.deps.terrain.heightAt(point.x, point.z), point.y);
    this.position.set(point.x, y, point.z);
    this.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.horizontal.set(0, 0);
    this.lastSafe.copy(this.position);
    this.fallStartY = y;
    this.setState('ground');
  }

  /** Applies damage in quarter hearts; death recovery is handled by the game-over system. */
  applyDamage(amount: number, cause: DamageCause): void {
    if (amount <= 0 || this.isDead || this.invulnerabilityTimer > 0) return;
    this.stats.hp = Math.max(0, this.stats.hp - amount);
    this.deps.bus.emit('player:damaged', { amount, hp: this.stats.hp, cause });
    if (this.stats.hp === 0) {
      this.isDead = true;
      this.deps.bus.emit('player:died', { position: payload(this.position) });
    } else {
      this.grantInvulnerability(COMBAT_CONFIG.damageInvulnerability);
    }
  }

  heal(amount: number): number {
    if (amount <= 0 || this.isDead) return 0;
    const before = this.stats.hp;
    this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + amount);
    return this.stats.hp - before;
  }

  grantInvulnerability(seconds: number): void {
    this.invulnerabilityTimer = Math.max(this.invulnerabilityTimer, seconds);
  }

  get isInvulnerable(): boolean {
    return this.invulnerabilityTimer > 0;
  }

  /** Restores persisted vitals without emitting gameplay events. */
  restoreVitals(hp: number, maxHp: number, maxStamina: number): void {
    this.stats.maxHp = Math.max(1, maxHp);
    this.stats.hp = clamp(hp, 0, this.stats.maxHp);
    this.stamina.setMax(maxStamina);
    this.stamina.refill();
    this.syncStats();
  }

  /** Completes the delayed death flow at a save point. */
  reviveAt(point: Readonly<Vec3Like>): void {
    this.isDead = false;
    this.stats.hp = this.stats.maxHp;
    this.stamina.refill();
    this.invulnerabilityTimer = 1;
    this.placeAt(point);
    this.deps.bus.emit('player:respawned', { position: payload(this.position), reason: 'died' });
  }

  /** Combat movement that still respects static collision and the world edge. */
  dash(directionX: number, directionZ: number, distance: number): void {
    const length = Math.hypot(directionX, directionZ);
    if (length <= 0 || this.isDead) return;
    this.position.x += (directionX / length) * distance;
    this.position.z += (directionZ / length) * distance;
    this.deps.collision.resolve(this.position, PLAYER_CONFIG.radius);
    this.clampToWorld();
    this.previousPosition.copy(this.position);
  }

  setCombatFacing(target: Readonly<Vec3Like> | null): void {
    this.combatFacingTarget = target;
    if (target) {
      this.facing = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    }
  }

  update(dt: number): void {
    this.previousPosition.copy(this.position);
    this.previousFacing = this.facing;
    this.invulnerabilityTimer = Math.max(0, this.invulnerabilityTimer - dt);
    if (this.isDead) {
      this.velocity.set(0, 0, 0);
      this.horizontal.set(0, 0);
      return;
    }
    const input = this.deps.input;
    const buttons = input.buttons;

    this.jumpBufferTimer = buttons.jump.pressed
      ? PLAYER_CONFIG.jumpBuffer
      : Math.max(0, this.jumpBufferTimer - dt);
    if (buttons.attack.pressed) {
      this.deps.bus.emit('player:attack', {
        position: payload(this.position),
        facing: this.facing,
      });
    }
    if (buttons.dodge.pressed) {
      this.deps.bus.emit('player:dodge', { position: payload(this.position), facing: this.facing });
    }
    if (buttons.interact.pressed) {
      this.deps.bus.emit('player:interact', {
        position: payload(this.position),
        facing: this.facing,
      });
    }

    this.computeWish();
    this.drain = 0;
    this.isSprinting = false;

    switch (this.state) {
      case 'ground':
        this.stepGround(dt);
        break;
      case 'air':
        this.stepAir(dt);
        break;
      case 'climb':
        this.stepClimb(dt);
        break;
      case 'slide':
        this.stepSlide(dt);
        break;
      case 'swim':
        this.stepSwim(dt);
        break;
    }

    const ranOut = this.stamina.update(dt, this.drain);
    if (ranOut && this.state === 'swim') this.drown();

    this.updateFacing(dt);
    this.syncStats();
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  private stepGround(dt: number): void {
    const terrain = this.deps.terrain;
    const p = this.position;
    const groundY = terrain.heightAt(p.x, p.z);
    if (groundY < WATER_LEVEL - PLAYER_CONFIG.swimDepth) {
      this.setState('swim');
      return;
    }
    terrain.normalAt(p.x, p.z, this.surfaceNormal);
    if (this.surfaceNormal.y < COS_MAX_WALK_SLOPE) {
      this.setState(this.wantsToClimb() ? 'climb' : 'slide');
      return;
    }

    const sprinting =
      this.deps.input.buttons.sprint.held &&
      this.moveAmount > MOVE_EPSILON &&
      this.stamina.canExert;
    const maxSpeed = sprinting ? PLAYER_CONFIG.sprintSpeed : PLAYER_CONFIG.walkSpeed;
    tmpHorizontal
      .copy(tmpWish)
      .multiplyScalar(sprinting ? 1 : this.moveAmount)
      .multiplyScalar(maxSpeed);
    const accel =
      this.moveAmount > MOVE_EPSILON ? PLAYER_CONFIG.groundAccel : PLAYER_CONFIG.groundDecel;
    moveTowards2(this.horizontal, tmpHorizontal, accel * dt);
    if (sprinting) {
      this.isSprinting = true;
      this.drain = STAMINA_CONFIG.sprintDrain;
    }

    this.updateSafeGround(dt, groundY);

    if (this.jumpBufferTimer > 0) {
      this.jump();
      this.moveHorizontal(dt);
      return;
    }

    this.moveHorizontal(dt);
    const newGround = terrain.heightAt(p.x, p.z);
    if (p.y - newGround > PLAYER_CONFIG.groundSnapDistance) {
      this.coyoteTimer = PLAYER_CONFIG.coyoteTime;
      this.fallStartY = p.y;
      this.velocity.y = 0;
      this.setState('air');
    } else {
      p.y = newGround;
      this.velocity.y = 0;
      this.fallStartY = p.y;
    }
  }

  private stepAir(dt: number): void {
    const p = this.position;
    const terrain = this.deps.terrain;
    this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    if (this.coyoteTimer > 0 && this.jumpBufferTimer > 0) {
      this.jump();
    }

    this.velocity.y = Math.max(
      this.velocity.y - PLAYER_CONFIG.gravity * dt,
      -PLAYER_CONFIG.maxFallSpeed,
    );
    if (this.moveAmount > MOVE_EPSILON) {
      const maxSpeed = Math.max(
        this.horizontal.length(),
        PLAYER_CONFIG.walkSpeed * this.moveAmount,
      );
      tmpHorizontal.copy(tmpWish).multiplyScalar(maxSpeed * this.moveAmount);
      moveTowards2(
        this.horizontal,
        tmpHorizontal,
        PLAYER_CONFIG.groundAccel * PLAYER_CONFIG.airControl * dt,
      );
    }
    this.moveHorizontal(dt);
    p.y += this.velocity.y * dt;
    this.fallStartY = Math.max(this.fallStartY, p.y);

    const groundY = terrain.heightAt(p.x, p.z);
    const deepWater = groundY < WATER_LEVEL - PLAYER_CONFIG.swimDepth;
    if (deepWater && p.y <= WATER_LEVEL - PLAYER_CONFIG.swimFloatDepth) {
      this.fallStartY = p.y;
      this.setState('swim');
      return;
    }
    if (p.y <= groundY) {
      p.y = groundY;
      const fallHeight = this.fallStartY - p.y;
      this.velocity.y = 0;
      this.deps.bus.emit('player:landed', { position: payload(p), fallHeight });
      if (fallHeight > PLAYER_CONFIG.fallDamageHeight) {
        const damage = Math.ceil(
          (fallHeight - PLAYER_CONFIG.fallDamageHeight) * PLAYER_CONFIG.fallDamagePerUnit,
        );
        this.applyDamage(Math.max(1, damage), 'fall');
      }
      this.fallStartY = p.y;
      if (this.state === 'air') this.setState('ground');
    }
  }

  private stepClimb(dt: number): void {
    const terrain = this.deps.terrain;
    const p = this.position;
    const n = terrain.normalAt(p.x, p.z, this.surfaceNormal);
    if (n.y >= COS_CLIMB_EXIT) {
      this.fallStartY = p.y;
      this.setState('ground');
      return;
    }
    if (terrain.heightAt(p.x, p.z) < WATER_LEVEL - PLAYER_CONFIG.swimDepth) {
      this.setState('swim');
      return;
    }
    if (!this.stamina.canExert) {
      this.setState('slide');
      return;
    }

    const horizontalLength = Math.hypot(n.x, n.z) || 1;
    const intoX = -n.x / horizontalLength;
    const intoZ = -n.z / horizontalLength;

    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer = 0;
      this.stamina.consume(CLIMB_JUMP_COST);
      this.horizontal.set(
        -intoX * PLAYER_CONFIG.climbJumpOffSpeed,
        -intoZ * PLAYER_CONFIG.climbJumpOffSpeed,
      );
      this.velocity.y = PLAYER_CONFIG.climbJumpUpSpeed;
      this.fallStartY = p.y;
      this.deps.bus.emit('player:jumped', { position: payload(p) });
      this.setState('air');
      return;
    }

    // Up-slope tangent: world up projected onto the surface plane.
    tmpUp.set(0, 1, 0).addScaledVector(n, -n.y).normalize();
    // Right along the wall when facing into it.
    const rightX = -intoZ;
    const rightZ = intoX;
    const move = this.deps.input.move;
    const speed = PLAYER_CONFIG.climbSpeed;
    const vx = (tmpUp.x * move.y + rightX * move.x) * speed;
    const vz = (tmpUp.z * move.y + rightZ * move.x) * speed;
    const vy = tmpUp.y * move.y * speed;
    p.x += vx * dt;
    p.z += vz * dt;
    this.clampToWorld();
    p.y = terrain.heightAt(p.x, p.z);
    this.velocity.set(vx, vy, vz);
    this.horizontal.set(0, 0);
    this.facing = Math.atan2(intoX, intoZ);
    this.fallStartY = p.y;
    this.drain = STAMINA_CONFIG.climbDrain;
  }

  private stepSlide(dt: number): void {
    const terrain = this.deps.terrain;
    const p = this.position;
    const n = terrain.normalAt(p.x, p.z, this.surfaceNormal);
    if (terrain.heightAt(p.x, p.z) < WATER_LEVEL - PLAYER_CONFIG.swimDepth) {
      this.setState('swim');
      return;
    }
    if (n.y >= COS_MAX_WALK_SLOPE) {
      this.setState('ground');
      return;
    }
    if (this.wantsToClimb()) {
      this.setState('climb');
      return;
    }
    const horizontalLength = Math.hypot(n.x, n.z) || 1;
    this.horizontal.x += (n.x / horizontalLength) * PLAYER_CONFIG.slideAccel * dt;
    this.horizontal.y += (n.z / horizontalLength) * PLAYER_CONFIG.slideAccel * dt;
    if (this.moveAmount > MOVE_EPSILON) {
      this.horizontal.addScaledVector(tmpWish, PLAYER_CONFIG.groundAccel * SLIDE_CONTROL * dt);
    }
    if (this.horizontal.length() > MAX_SLIDE_SPEED) this.horizontal.setLength(MAX_SLIDE_SPEED);
    this.moveHorizontal(dt);
    p.y = terrain.heightAt(p.x, p.z);
    this.velocity.y = 0;
    this.fallStartY = p.y;
  }

  private stepSwim(dt: number): void {
    const terrain = this.deps.terrain;
    const p = this.position;
    const target = WATER_LEVEL - PLAYER_CONFIG.swimFloatDepth;
    p.y = damp(p.y, target, SWIM_FLOAT_LAMBDA, dt);
    this.velocity.y = 0;

    const speed = this.stamina.canExert ? PLAYER_CONFIG.swimSpeed * this.moveAmount : 0;
    tmpHorizontal.copy(tmpWish).multiplyScalar(speed);
    moveTowards2(
      this.horizontal,
      tmpHorizontal,
      PLAYER_CONFIG.groundAccel * SWIM_ACCEL_FACTOR * dt,
    );
    this.moveHorizontal(dt);
    this.drain = STAMINA_CONFIG.swimDrain;

    const groundY = terrain.heightAt(p.x, p.z);
    if (groundY > WATER_LEVEL - PLAYER_CONFIG.swimDepth) {
      p.y = Math.max(p.y, groundY);
      this.setState('ground');
    }
    this.fallStartY = p.y;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Converts the move stick into a camera-relative unit direction (tmpWish) and amount. */
  private computeWish(): void {
    const move = this.deps.input.move;
    this.moveAmount = Math.min(1, move.length());
    const yaw = this.deps.getCameraYaw();
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // forward = (-sin, -cos), right = (cos, -sin) in (x, z)
    tmpWish.set(cos * move.x - sin * move.y, -sin * move.x - cos * move.y);
    if (tmpWish.lengthSq() > 0) tmpWish.normalize();
  }

  /** True if the stick pushes into the current (steep) surface and stamina allows climbing. */
  private wantsToClimb(): boolean {
    if (this.moveAmount < MOVE_EPSILON || !this.stamina.canExert) return false;
    const n = this.surfaceNormal;
    const horizontalLength = Math.hypot(n.x, n.z);
    if (horizontalLength === 0) return false;
    const dot = -(tmpWish.x * n.x + tmpWish.y * n.z) / horizontalLength;
    return dot > CLIMB_ENTER_DOT;
  }

  private jump(): void {
    this.velocity.y = JUMP_VELOCITY;
    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.fallStartY = this.position.y;
    this.deps.bus.emit('player:jumped', { position: payload(this.position) });
    this.setState('air');
  }

  private drown(): void {
    this.placeAt(this.lastSafe);
    this.stamina.refill();
    this.deps.bus.emit('player:respawned', { position: payload(this.position), reason: 'drowned' });
    this.applyDamage(PLAYER_CONFIG.drownDamage, 'drown');
  }

  /** Integrates horizontal velocity, resolves obstacle collisions and clamps to the world. */
  private moveHorizontal(dt: number): void {
    const p = this.position;
    p.x += this.horizontal.x * dt;
    p.z += this.horizontal.y * dt;
    this.deps.collision.resolve(p, PLAYER_CONFIG.radius);
    this.clampToWorld();
    this.velocity.x = this.horizontal.x;
    this.velocity.z = this.horizontal.y;
  }

  private clampToWorld(): void {
    const terrain = this.deps.terrain;
    this.position.x = terrain.clampToWorld(this.position.x, PLAYER_CONFIG.worldEdgeMargin);
    this.position.z = terrain.clampToWorld(this.position.z, PLAYER_CONFIG.worldEdgeMargin);
  }

  private updateSafeGround(dt: number, groundY: number): void {
    if (groundY < SAFE_GROUND_MIN_HEIGHT) return;
    this.safeTimer += dt;
    if (this.safeTimer >= PLAYER_CONFIG.safeGroundInterval) {
      this.safeTimer = 0;
      this.lastSafe.copy(this.position);
    }
  }

  private updateFacing(dt: number): void {
    if (this.combatFacingTarget) {
      this.facing = Math.atan2(
        this.combatFacingTarget.x - this.position.x,
        this.combatFacingTarget.z - this.position.z,
      );
      return;
    }
    if (this.state === 'climb') return;
    const speed = Math.hypot(this.horizontal.x, this.horizontal.y);
    if (speed < TURN_MIN_SPEED) return;
    const target = Math.atan2(this.horizontal.x, this.horizontal.y);
    this.facing = dampAngle(this.facing, target, PLAYER_CONFIG.turnLambda, dt);
  }

  private setState(next: MovementState): void {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    if (next === 'climb' || next === 'swim') this.horizontal.set(0, 0);
    this.deps.bus.emit('player:stateChanged', { from, to: next });
  }

  private syncStats(): void {
    const s = this.stats;
    s.stamina = this.stamina.value;
    s.maxStamina = this.stamina.max;
    s.staminaExhausted = this.stamina.isExhausted;
    s.hp = clamp(s.hp, 0, s.maxHp);
  }
}
