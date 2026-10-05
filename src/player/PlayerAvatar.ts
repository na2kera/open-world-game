import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';

import { PLAYER_CONFIG } from '../config';
import type { System } from '../core/System';
import { getItemDef } from '../data/items';
import { damp } from '../utils/math';
import type { PlayerController } from './PlayerController';

const COLORS = {
  tunic: 0x2f6fb5,
  skin: 0xf1c9a5,
  hair: 0xd9b25a,
  pants: 0xe0d6b8,
  boots: 0x5a3b22,
  belt: 0x4a2e1a,
} as const;

/** Body proportions (units). */
const BODY = {
  hipHeight: 0.9,
  torso: [0.46, 0.58, 0.28],
  head: 0.32,
  hairHeight: 0.12,
  arm: [0.12, 0.55, 0.12],
  shoulderX: 0.3,
  shoulderY: 0.54,
  leg: [0.16, 0.86, 0.18],
  hipX: 0.12,
  boot: [0.18, 0.18, 0.26],
  belt: [0.48, 0.07, 0.3],
} as const;

/** Animation tuning. */
const ANIM = {
  /** Gait phase radians per unit travelled. */
  strideRate: 2.1,
  legSwing: 1.08,
  armSwing: 0.75,
  bob: 0.06,
  /** Forward lean at full sprint (radians). */
  sprintLean: 0.22,
  /** Lean while walking, relative to the sprint lean. */
  walkLeanFactor: 0.4,
  poseLambda: 14,
  climbPhaseRate: 5,
  climbReach: -2.7,
  climbReachSwing: 0.45,
  climbKnee: -0.4,
  climbLegSwing: 0.3,
  /** Fraction of the slope tilt applied to the body while climbing. */
  climbTiltFactor: 0.8,
  /** Visual offset away from the wall while climbing. */
  climbWallOffset: 0.3,
  swimTilt: 1.25,
  swimIdleTiltFactor: 0.3,
  swimMoveThreshold: 0.1,
  swimStrokeRate: 4,
  swimIdleRate: 1.6,
  swimKick: 0.5,
  treadSwing: 0.4,
  treadArm: -0.6,
  /** Vertical speed above which the rising pose is used. */
  risingSpeed: 0.5,
} as const;

const JUMP_POSE: Partial<Pose> = {
  leftArmX: -1.25,
  rightArmX: -0.75,
  leftLegX: -0.6,
  rightLegX: 0.3,
};
const FALL_POSE: Partial<Pose> = {
  leftArmZ: 1.25,
  rightArmZ: 1.25,
  leftLegX: 0.25,
  rightLegX: -0.25,
};
const SLIDE_POSE: Partial<Pose> = {
  bodyPitch: -0.35,
  leftArmZ: 0.9,
  rightArmZ: 0.9,
  leftLegX: -0.5,
  rightLegX: -0.2,
};

/** Joint angles the avatar blends towards each frame. */
interface Pose {
  bodyPitch: number;
  hipOffset: number;
  leftArmX: number;
  rightArmX: number;
  leftArmZ: number;
  rightArmZ: number;
  leftLegX: number;
  rightLegX: number;
}

function createPose(): Pose {
  return {
    bodyPitch: 0,
    hipOffset: 0,
    leftArmX: 0,
    rightArmX: 0,
    leftArmZ: 0,
    rightArmZ: 0,
    leftLegX: 0,
    rightLegX: 0,
  };
}

const REST_POSE: Readonly<Pose> = createPose();

const tmpPosition = new Vector3();

/**
 * Procedural low-poly humanoid (box limbs, blue tunic) that mirrors a {@link PlayerController}:
 * interpolated transform, gait swing scaled by speed and poses for jump / fall / climb /
 * slide / swim.
 */
export class PlayerAvatar implements System {
  readonly root = new Group();
  private readonly tilt = new Group();
  private readonly hips = new Group();
  private readonly leftArm = new Group();
  private readonly rightArm = new Group();
  private readonly leftLeg = new Group();
  private readonly rightLeg = new Group();
  private readonly weaponAttach = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly pose = createPose();
  private readonly target = createPose();
  private phase = 0;
  private attackProgress = 0;
  private attackDirection: -1 | 0 | 1 = 1;
  private attackActive = false;
  private weaponMesh: Mesh | null = null;

  constructor(
    scene: Scene,
    private readonly player: PlayerController,
  ) {
    this.root.name = 'player';
    this.build();
    scene.add(this.root);
  }

  frameUpdate(frameDt: number, alpha: number): void {
    const player = this.player;
    player.getInterpolatedPosition(alpha, tmpPosition);
    if (player.state === 'climb') {
      const n = player.surfaceNormal;
      tmpPosition.x += n.x * ANIM.climbWallOffset;
      tmpPosition.z += n.z * ANIM.climbWallOffset;
    }
    this.root.position.copy(tmpPosition);
    this.root.rotation.y = player.getInterpolatedFacing(alpha);

    this.computeTargetPose(frameDt);
    const p = this.pose;
    const t = this.target;
    const k = ANIM.poseLambda;
    p.bodyPitch = damp(p.bodyPitch, t.bodyPitch, k, frameDt);
    p.hipOffset = damp(p.hipOffset, t.hipOffset, k, frameDt);
    p.leftArmX = damp(p.leftArmX, t.leftArmX, k, frameDt);
    p.rightArmX = damp(p.rightArmX, t.rightArmX, k, frameDt);
    p.leftArmZ = damp(p.leftArmZ, t.leftArmZ, k, frameDt);
    p.rightArmZ = damp(p.rightArmZ, t.rightArmZ, k, frameDt);
    p.leftLegX = damp(p.leftLegX, t.leftLegX, k, frameDt);
    p.rightLegX = damp(p.rightLegX, t.rightLegX, k, frameDt);

    this.tilt.rotation.x = p.bodyPitch;
    this.hips.position.y = BODY.hipHeight + p.hipOffset;
    this.leftArm.rotation.set(p.leftArmX, 0, p.leftArmZ);
    this.rightArm.rotation.set(p.rightArmX, 0, -p.rightArmZ);
    this.leftLeg.rotation.x = p.leftLegX;
    this.rightLeg.rotation.x = p.rightLegX;
  }

  setWeapon(itemId: string | null): void {
    if (this.weaponMesh) {
      this.weaponMesh.geometry.dispose();
      const material = this.weaponMesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
      this.weaponMesh.removeFromParent();
      this.weaponMesh = null;
    }
    if (!itemId || getItemDef(itemId)?.category !== 'weapon') return;
    const geometry = new BoxGeometry(0.07, 0.82, 0.08);
    const material = new MeshStandardMaterial({
      color: itemId === 'wooden-stick' || itemId === 'bokoblin-club' ? 0x7a4a28 : 0xb8c4ce,
      roughness: 0.4,
      metalness: itemId === 'wooden-stick' || itemId === 'bokoblin-club' ? 0 : 0.65,
    });
    this.weaponMesh = new Mesh(geometry, material);
    this.weaponMesh.position.y = -0.42;
    this.weaponMesh.castShadow = true;
    this.weaponAttach.add(this.weaponMesh);
  }

  setAttackPose(progress: number, direction: -1 | 0 | 1, active: boolean): void {
    this.attackProgress = Math.min(1, Math.max(0, progress));
    this.attackDirection = direction;
    this.attackActive = active;
  }

  dispose(): void {
    this.setWeapon(null);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }

  private computeTargetPose(dt: number): void {
    const player = this.player;
    const t = this.target;
    Object.assign(t, REST_POSE);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);

    switch (player.state) {
      case 'ground': {
        this.phase += speed * ANIM.strideRate * dt;
        const amount = Math.min(1, speed / PLAYER_CONFIG.sprintSpeed);
        const swing = Math.sin(this.phase);
        t.leftLegX = swing * ANIM.legSwing * amount;
        t.rightLegX = -swing * ANIM.legSwing * amount;
        t.leftArmX = -swing * ANIM.armSwing * amount;
        t.rightArmX = swing * ANIM.armSwing * amount;
        t.hipOffset = -Math.abs(Math.cos(this.phase)) * ANIM.bob * amount;
        t.bodyPitch = player.isSprinting
          ? ANIM.sprintLean
          : ANIM.sprintLean * amount * ANIM.walkLeanFactor;
        break;
      }
      case 'air':
        Object.assign(t, player.velocity.y > ANIM.risingSpeed ? JUMP_POSE : FALL_POSE);
        break;
      case 'climb': {
        const climbSpeed = player.velocity.length();
        this.phase += climbSpeed * ANIM.climbPhaseRate * dt;
        const swing = Math.sin(this.phase);
        t.leftArmX = ANIM.climbReach + swing * ANIM.climbReachSwing;
        t.rightArmX = ANIM.climbReach - swing * ANIM.climbReachSwing;
        t.leftLegX = ANIM.climbKnee - swing * ANIM.climbLegSwing;
        t.rightLegX = ANIM.climbKnee + swing * ANIM.climbLegSwing;
        t.bodyPitch = Math.asin(Math.min(1, player.surfaceNormal.y)) * ANIM.climbTiltFactor;
        break;
      }
      case 'slide':
        Object.assign(t, SLIDE_POSE);
        break;
      case 'swim': {
        const moving = player.moveAmount > ANIM.swimMoveThreshold;
        this.phase += (moving ? ANIM.swimStrokeRate : ANIM.swimIdleRate) * dt;
        t.bodyPitch = moving ? ANIM.swimTilt : ANIM.swimTilt * ANIM.swimIdleTiltFactor;
        // Arms rotate continuously; wrap the pose so damping does not unwind the circle.
        const stroke = (this.phase % (Math.PI * 2)) - Math.PI;
        const tread = Math.sin(this.phase) * ANIM.treadSwing;
        t.leftArmX = moving ? stroke : tread + ANIM.treadArm;
        t.rightArmX = moving ? -stroke : -tread + ANIM.treadArm;
        t.leftLegX = Math.sin(this.phase * 2) * ANIM.swimKick;
        t.rightLegX = -Math.sin(this.phase * 2) * ANIM.swimKick;
        break;
      }
    }
    if (this.attackActive) {
      const swing = Math.sin(this.attackProgress * Math.PI);
      t.bodyPitch = Math.max(t.bodyPitch, 0.12 * swing);
      t.rightArmX = -1.15 - swing * 1.15;
      t.rightArmZ = this.attackDirection * (1.15 - this.attackProgress * 2.3);
    }
  }

  private build(): void {
    const material = (color: number): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 });
      this.materials.push(m);
      return m;
    };
    const tunic = material(COLORS.tunic);
    const skin = material(COLORS.skin);
    const hair = material(COLORS.hair);
    const pants = material(COLORS.pants);
    const boots = material(COLORS.boots);
    const belt = material(COLORS.belt);

    const box = (
      size: readonly [number, number, number],
      mat: MeshStandardMaterial,
      parent: Group,
      x: number,
      y: number,
      z = 0,
    ): Mesh => {
      const geometry = new BoxGeometry(size[0], size[1], size[2]);
      this.geometries.push(geometry);
      const mesh = new Mesh(geometry, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    this.root.add(this.tilt);
    this.tilt.add(this.hips);
    this.hips.position.y = BODY.hipHeight;

    box(BODY.torso, tunic, this.hips, 0, BODY.torso[1] / 2);
    box(BODY.belt, belt, this.hips, 0, 0.04);
    const headY = BODY.torso[1] + BODY.head / 2 + 0.02;
    box([BODY.head, BODY.head, BODY.head], skin, this.hips, 0, headY);
    box(
      [BODY.head + 0.04, BODY.hairHeight, BODY.head + 0.04],
      hair,
      this.hips,
      0,
      headY + BODY.head / 2,
      -0.02,
    );

    for (const [arm, side] of [
      [this.leftArm, 1],
      [this.rightArm, -1],
    ] as const) {
      arm.position.set(BODY.shoulderX * side, BODY.shoulderY, 0);
      this.hips.add(arm);
      box(BODY.arm, tunic, arm, 0, -BODY.arm[1] / 2 + 0.04);
      box([BODY.arm[0], 0.12, BODY.arm[2]], skin, arm, 0, -BODY.arm[1] + 0.02);
    }
    this.weaponAttach.position.set(0, -BODY.arm[1], 0);
    this.weaponAttach.rotation.z = Math.PI;
    this.rightArm.add(this.weaponAttach);
    for (const [leg, side] of [
      [this.leftLeg, 1],
      [this.rightLeg, -1],
    ] as const) {
      leg.position.set(BODY.hipX * side, 0, 0);
      this.hips.add(leg);
      box(BODY.leg, pants, leg, 0, -BODY.leg[1] / 2);
      box(BODY.boot, boots, leg, 0, -BODY.leg[1] + BODY.boot[1] / 2 - 0.04, 0.03);
    }
  }
}
