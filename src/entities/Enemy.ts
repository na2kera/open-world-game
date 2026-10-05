import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { EnemyDef, EnemyState } from '../data/enemies';
import type { PlayerController } from '../player/PlayerController';
import type { Terrain } from '../world/Terrain';
import type { WorldLabelHandle, WorldLabelLayer } from '../ui/WorldLabelLayer';

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

  constructor(private readonly options: EnemyOptions) {
    this.id = options.id;
    this.def = options.def;
    this.hp = options.def.hp;
    const y = this.groundHeight(options.x, options.z);
    this.root.position.set(options.x, y, options.z);
    this.origin.copy(this.root.position);
    this.root.name = `enemy:${this.id}`;
    this.buildMesh();

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
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
    });
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
    const intensity = this.hurtFlash > 0 ? 2.5 : 0;
    for (const material of this.materials) {
      material.emissive.setHex(0xffffff);
      material.emissiveIntensity = intensity;
    }
  }

  private updateHpLabel(): void {
    this.hpFill.style.width = `${Math.max(0, (this.hp / this.def.hp) * 100)}%`;
  }

  private labelPosition(out: Vector3, height: number): Vector3 {
    return out.copy(this.position).add(tmpLabel.set(0, height, 0));
  }

  private buildMesh(): void {
    const scale = this.def.appearance.scale;
    const bodyMaterial = this.material(this.def.appearance.color);
    const accentMaterial = this.material(this.def.appearance.accent);
    if (this.def.appearance.floating) {
      const body = new Mesh(new IcosahedronGeometry(0.72 * scale, 1), bodyMaterial);
      const leftWing = new Mesh(new ConeGeometry(0.45 * scale, 0.9 * scale, 3), accentMaterial);
      const rightWing = leftWing.clone();
      leftWing.position.x = 0.7 * scale;
      rightWing.position.x = -0.7 * scale;
      leftWing.rotation.z = -Math.PI / 2;
      rightWing.rotation.z = Math.PI / 2;
      this.root.add(body, leftWing, rightWing);
    } else {
      const body = new Mesh(new SphereGeometry(0.55 * scale, 8, 6), bodyMaterial);
      body.position.y = 0.72 * scale;
      body.scale.y = 1.25;
      const head = new Mesh(new SphereGeometry(0.48 * scale, 8, 6), bodyMaterial);
      head.position.y = 1.55 * scale;
      const leftEar = new Mesh(new ConeGeometry(0.18 * scale, 0.65 * scale, 4), accentMaterial);
      const rightEar = leftEar.clone();
      leftEar.position.set(0.47 * scale, 1.63 * scale, 0);
      rightEar.position.set(-0.47 * scale, 1.63 * scale, 0);
      leftEar.rotation.z = -Math.PI / 2;
      rightEar.rotation.z = Math.PI / 2;
      this.root.add(body, head, leftEar, rightEar);
    }
    this.root.traverse((object) => {
      if (object instanceof Mesh) object.castShadow = true;
    });
  }

  private material(color: number): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color, roughness: 0.78 });
    this.materials.push(material);
    return material;
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
