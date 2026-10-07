import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Points,
  PointsMaterial,
  Vector3,
  type Color,
  type MeshStandardMaterial,
} from 'three';

import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { EnemyDef, EnemyState } from '../data/enemies';
import type { PlayerController } from '../player/PlayerController';
import type { Terrain } from '../world/Terrain';
import type { WorldLabelHandle, WorldLabelLayer } from '../ui/WorldLabelLayer';
import { damp } from '../utils/math';
import { buildEnemyRig, GOBLIN, type EnemyRig } from './enemyMesh';

export interface EnemyOptions {
  readonly id: string;
  readonly def: EnemyDef;
  readonly x: number;
  readonly z: number;
  readonly terrain: Terrain;
  readonly player: PlayerController;
  readonly bus: EventBus<GameEvents>;
  readonly labels: WorldLabelLayer;
  readonly onFinishedDeath: (enemy: Enemy) => void;
}

const tmpLabel = new Vector3();
const WINDUP_SECONDS = 0.5;
const ATTACK_SECONDS = 0.12;
const HURT_SECONDS = 0.22;
const DEATH_SECONDS = 0.85;
const PATROL_RADIUS = 6;
const ALERT_SECONDS = 0.9;
const HURT_FLASH_INTENSITY = 2.5;

/** Animation tuning (radians / seconds / units at scale 1). */
const ANIM = {
  /** Gait phase radians per unit travelled. */
  strideRate: 2.6,
  /** Horizontal speed below which the enemy counts as standing. */
  minSpeed: 0.05,
  legSwing: 0.6,
  armSwing: 0.35,
  bob: 0.05,
  breathRate: 2.2,
  breath: 0.015,
  /** Club arm raised overhead over the windup. */
  windupArm: -2.2,
  windupOffArm: -0.3,
  /** Club arm at the end of the strike: forward and down, toward the target. */
  strikeArm: -0.5,
  strikeLambda: 40,
  hurtHeadPitch: -0.45,
  lambda: 12,
  wingRate: 9,
  wingRest: 0.15,
  wingFlap: 0.55,
  wispSwayRate: 1.7,
  wispSway: 0.08,
} as const;

interface EnemyPose {
  leftLeg: number;
  rightLeg: number;
  leftArm: number;
  rightArm: number;
  bob: number;
  headPitch: number;
  headLift: number;
}

function createPose(): EnemyPose {
  return { leftLeg: 0, rightLeg: 0, leftArm: 0, rightArm: 0, bob: 0, headPitch: 0, headLift: 0 };
}

const REST_POSE: Readonly<EnemyPose> = createPose();

/** Procedural enemy with a compact fixed-step state machine. */
export class Enemy {
  readonly id: string;
  readonly def: EnemyDef;
  readonly root = new Group();
  readonly position = this.root.position;
  state: EnemyState = 'idle';
  hp: number;
  active = false;
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly hpFill = document.createElement('span');
  private readonly hpLabel: WorldLabelHandle;
  private readonly alertLabel: WorldLabelHandle;
  private readonly origin = new Vector3();
  private stateTimer = 0;
  private patrolAngle = 0;
  private alertTimer = 0;
  private smoke: Points<BufferGeometry, PointsMaterial> | null = null;
  private hurtFlash = 0;
  private readonly geometries: BufferGeometry[] = [];
  private readonly emissiveBase: {
    readonly material: MeshStandardMaterial;
    readonly color: Color;
    readonly intensity: number;
  }[] = [];
  private readonly rig: EnemyRig;
  private readonly pose = createPose();
  private readonly poseTarget = createPose();
  private phase = 0;
  private animTime = 0;

  constructor(private readonly options: EnemyOptions) {
    this.id = options.id;
    this.def = options.def;
    this.hp = options.def.hp;
    const y = this.groundHeight(options.x, options.z);
    this.root.position.set(options.x, y, options.z);
    this.origin.copy(this.root.position);
    this.root.name = `enemy:${this.id}`;
    this.rig = this.buildMesh();

    this.hpLabel = options.labels.add({
      className: 'enemy-hp',
      getPosition: (out) => this.labelPosition(out, 2.3 * this.def.appearance.scale),
      isVisible: () =>
        this.active &&
        this.state !== 'dead' &&
        (this.hp < this.def.hp || this.state === 'chase' || this.state === 'hurt'),
    });
    this.hpLabel.element.appendChild(this.hpFill);
    this.alertLabel = options.labels.add({
      className: 'enemy-alert',
      getPosition: (out) => this.labelPosition(out, 2.85 * this.def.appearance.scale),
      isVisible: () => this.active && this.alertTimer > 0 && this.state !== 'dead',
    });
    this.alertLabel.element.textContent = '!';
    this.updateHpLabel();
  }

  get isAlive(): boolean {
    return this.state !== 'dead';
  }

  setActive(active: boolean, parent: Group): void {
    if (active === this.active) return;
    this.active = active;
    if (active) parent.add(this.root);
    else this.root.removeFromParent();
  }

  update(dt: number): void {
    if (!this.active) return;
    this.stateTimer += dt;
    this.alertTimer = Math.max(0, this.alertTimer - dt);
    this.updateFlash(dt);
    if (this.state === 'dead') {
      this.updateDeath(dt);
      return;
    }

    const startX = this.position.x;
    const startZ = this.position.z;
    const player = this.options.player.position;
    const dx = player.x - this.position.x;
    const dz = player.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    if ((this.state === 'idle' || this.state === 'patrol') && distance <= this.def.aggroRadius) {
      this.alertTimer = ALERT_SECONDS;
      this.options.bus.emit('enemy:spotted', { enemyId: this.id, defId: this.def.id });
      this.setState('chase');
    }

    switch (this.state) {
      case 'idle':
        if (this.stateTimer >= 1.2) this.setState('patrol');
        break;
      case 'patrol':
        this.stepPatrol(dt);
        break;
      case 'chase':
        if (distance > this.def.aggroRadius * 1.7) {
          this.setState('patrol');
        } else if (distance <= this.def.attackRange) {
          this.face(dx, dz);
          this.setState('windup');
        } else {
          this.move(dx, dz, this.def.speed, dt);
        }
        break;
      case 'windup':
        this.face(dx, dz);
        this.root.scale.y = 0.88 + Math.min(1, this.stateTimer / WINDUP_SECONDS) * 0.12;
        if (this.stateTimer >= WINDUP_SECONDS) this.setState('attack');
        break;
      case 'attack':
        if (this.stateTimer === dt && distance <= this.def.attackRange + 0.35) {
          this.options.player.applyDamage(this.def.attack, 'enemy');
        }
        if (this.stateTimer >= ATTACK_SECONDS) this.setState('recover');
        break;
      case 'recover':
        if (this.stateTimer >= this.def.attackCooldown) this.setState('chase');
        break;
      case 'hurt':
        if (this.stateTimer >= HURT_SECONDS) this.setState('chase');
        break;
    }
    this.followTerrain(dt);
    const travelled = Math.hypot(this.position.x - startX, this.position.z - startZ);
    this.animate(dt, dt > 0 ? travelled / dt : 0);
  }

  damage(amount: number, source: Readonly<Vector3>): boolean {
    if (amount <= 0 || !this.isAlive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.options.bus.emit('enemy:damaged', {
      enemyId: this.id,
      defId: this.def.id,
      amount,
      hp: this.hp,
    });
    this.updateHpLabel();
    const dx = this.position.x - source.x;
    const dz = this.position.z - source.z;
    const distance = Math.hypot(dx, dz) || 1;
    this.position.x += (dx / distance) * 0.45;
    this.position.z += (dz / distance) * 0.45;
    this.hurtFlash = HURT_SECONDS;
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    this.setState('hurt');
    return false;
  }

  dispose(): void {
    this.hpLabel.remove();
    this.alertLabel.remove();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.smoke?.geometry.dispose();
    this.smoke?.material.dispose();
    this.root.removeFromParent();
  }

  private stepPatrol(dt: number): void {
    this.patrolAngle += dt * 0.45;
    const targetX = this.origin.x + Math.cos(this.patrolAngle) * PATROL_RADIUS;
    const targetZ = this.origin.z + Math.sin(this.patrolAngle) * PATROL_RADIUS;
    this.move(targetX - this.position.x, targetZ - this.position.z, this.def.speed * 0.35, dt);
  }

  private move(dx: number, dz: number, speed: number, dt: number): void {
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001) return;
    const nx = dx / distance;
    const nz = dz / distance;
    this.position.x += nx * speed * dt;
    this.position.z += nz * speed * dt;
    this.face(dx, dz);
  }

  private face(dx: number, dz: number): void {
    this.root.rotation.y = Math.atan2(dx, dz);
  }

  private followTerrain(dt: number): void {
    const target = this.groundHeight(this.position.x, this.position.z);
    if (this.def.appearance.floating) {
      this.position.y = target + Math.sin(this.stateTimer * 4 + this.patrolAngle) * 0.22;
    } else {
      this.position.y += (target - this.position.y) * Math.min(1, dt * 12);
    }
  }

  private groundHeight(x: number, z: number): number {
    const ground = this.options.terrain.heightAt(x, z);
    return ground + (this.def.appearance.floating ? 2.25 : 0);
  }

  private setState(next: EnemyState): void {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.stateTimer = 0;
    this.root.scale.y = 1;
    this.options.bus.emit('enemy:stateChanged', { enemyId: this.id, from, to: next });
  }

  private die(): void {
    this.setState('dead');
    this.createSmoke();
    this.options.bus.emit('enemy:killed', {
      enemyId: this.id,
      defId: this.def.id,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
    });
    for (const material of this.materials) material.transparent = true;
  }

  private updateDeath(dt: number): void {
    const progress = Math.min(1, this.stateTimer / DEATH_SECONDS);
    this.root.scale.setScalar(Math.max(0.01, 1 - progress));
    for (const material of this.materials) material.opacity = 1 - progress;
    if (this.smoke) {
      this.smoke.scale.setScalar(1 + progress * 2.4);
      this.smoke.material.opacity = 1 - progress;
      this.smoke.rotation.y += dt;
    }
    if (progress >= 1) this.options.onFinishedDeath(this);
  }

  private updateFlash(dt: number): void {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    const flashing = this.hurtFlash > 0;
    // Flash white, otherwise restore each material's own glow (wisp core / eyes).
    for (const base of this.emissiveBase) {
      if (flashing) {
        base.material.emissive.setHex(0xffffff);
        base.material.emissiveIntensity = HURT_FLASH_INTENSITY;
      } else {
        base.material.emissive.copy(base.color);
        base.material.emissiveIntensity = base.intensity;
      }
    }
  }

  private updateHpLabel(): void {
    this.hpFill.style.width = `${Math.max(0, (this.hp / this.def.hp) * 100)}%`;
  }

  private labelPosition(out: Vector3, height: number): Vector3 {
    return out.copy(this.position).add(tmpLabel.set(0, height, 0));
  }

  private buildMesh(): EnemyRig {
    const rig = buildEnemyRig(this.def, this.materials, this.geometries);
    this.root.add(rig.container);
    for (const material of this.materials) {
      this.emissiveBase.push({
        material,
        color: material.emissive.clone(),
        intensity: material.emissiveIntensity,
      });
    }
    return rig;
  }

  /** Procedural gait / attack posing. Runs after movement each tick. */
  private animate(dt: number, horizontalSpeed: number): void {
    const rig = this.rig;
    const pose = this.pose;
    this.animTime += dt;
    if (rig.leftWing && rig.rightWing) {
      const flap = ANIM.wingRest + Math.sin(this.animTime * ANIM.wingRate) * ANIM.wingFlap;
      rig.leftWing.rotation.z = flap;
      rig.rightWing.rotation.z = -flap;
      rig.body.rotation.z = Math.sin(this.animTime * ANIM.wispSwayRate) * ANIM.wispSway;
      return;
    }

    const target = this.poseTarget;
    Object.assign(target, REST_POSE);
    const walking =
      (this.state === 'patrol' || this.state === 'chase') && horizontalSpeed > ANIM.minSpeed;
    if (walking) {
      this.phase += (horizontalSpeed * ANIM.strideRate * dt) / this.def.appearance.scale;
      const amount = Math.min(1, horizontalSpeed / this.def.speed);
      const swing = Math.sin(this.phase);
      target.leftLeg = swing * ANIM.legSwing * amount;
      target.rightLeg = -swing * ANIM.legSwing * amount;
      target.leftArm = -swing * ANIM.armSwing * amount;
      target.rightArm = swing * ANIM.armSwing * amount;
      target.bob = -Math.abs(Math.cos(this.phase)) * ANIM.bob * amount;
    } else {
      target.headLift = Math.sin(this.animTime * ANIM.breathRate) * ANIM.breath;
    }
    let armLambda: number = ANIM.lambda;
    if (this.state === 'windup') {
      target.rightArm = ANIM.windupArm * Math.min(1, this.stateTimer / WINDUP_SECONDS);
      target.leftArm = ANIM.windupOffArm;
    } else if (this.state === 'attack') {
      target.rightArm = ANIM.strikeArm;
      armLambda = ANIM.strikeLambda;
    } else if (this.state === 'hurt') {
      target.headPitch = ANIM.hurtHeadPitch;
    }

    pose.leftLeg = damp(pose.leftLeg, target.leftLeg, ANIM.lambda, dt);
    pose.rightLeg = damp(pose.rightLeg, target.rightLeg, ANIM.lambda, dt);
    pose.leftArm = damp(pose.leftArm, target.leftArm, ANIM.lambda, dt);
    pose.rightArm = damp(pose.rightArm, target.rightArm, armLambda, dt);
    pose.bob = damp(pose.bob, target.bob, ANIM.lambda, dt);
    pose.headPitch = damp(pose.headPitch, target.headPitch, ANIM.lambda, dt);
    pose.headLift = damp(pose.headLift, target.headLift, ANIM.lambda, dt);

    if (rig.leftLeg) rig.leftLeg.rotation.x = pose.leftLeg;
    if (rig.rightLeg) rig.rightLeg.rotation.x = pose.rightLeg;
    if (rig.leftArm) rig.leftArm.rotation.x = pose.leftArm;
    if (rig.rightArm) rig.rightArm.rotation.x = pose.rightArm;
    rig.body.position.y = GOBLIN.hipHeight + pose.bob;
    if (rig.head) {
      rig.head.rotation.x = pose.headPitch;
      rig.head.position.y = GOBLIN.neckY + pose.headLift;
    }
  }

  private createSmoke(): void {
    const count = 22;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2;
      const radius = 0.25 + (index % 4) * 0.08;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = (index % 7) * 0.11 + 0.3;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.smoke = new Points(
      geometry,
      new PointsMaterial({
        color: 0xa55be8,
        size: 0.22,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.root.add(this.smoke);
  }
}
