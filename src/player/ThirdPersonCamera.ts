import { Vector3, type PerspectiveCamera } from 'three';

import { CAMERA_CONFIG, PLAYER_CONFIG, WATER_LEVEL } from '../config';
import type { System } from '../core/System';
import type { InputState } from '../input/types';
import { clamp, damp, dampAngle, wrapAngle } from '../utils/math';
import type { Terrain } from '../world/Terrain';
import type { PlayerController } from './PlayerController';

/** Yaw difference (radians) at which a camera reset counts as finished. */
const RESET_DONE_EPSILON = 0.01;

const tmpTarget = new Vector3();
const tmpOffset = new Vector3();
const tmpSample = new Vector3();

/**
 * Orbit camera behind the player.
 *
 * - Right stick / mouse rotate yaw and pitch; `cameraReset` (L) swings behind the player.
 * - The boom shortens when terrain occludes it and the camera never dips into the ground.
 * - {@link setLookTarget} keeps a world point framed (for lock-on in later phases).
 *
 * Yaw convention: the camera sits at `target + (sin yaw, ·, cos yaw)`, so camera-forward on the
 * ground plane is `(-sin yaw, -cos yaw)`.
 */
export class ThirdPersonCamera implements System {
  yaw: number;
  pitch: number = CAMERA_CONFIG.defaultPitch;
  private distance: number = CAMERA_CONFIG.distance;
  private readonly focus = new Vector3();
  private resetting = false;
  private lookTarget: Vector3 | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly input: InputState,
    private readonly terrain: Terrain,
    private readonly player: PlayerController,
  ) {
    this.yaw = wrapAngle(player.facing + Math.PI);
    player.getInterpolatedPosition(1, this.focus);
    this.focus.y += PLAYER_CONFIG.chestHeight;
  }

  /** Keeps `target` framed (camera swings to look from the player towards it); null releases. */
  setLookTarget(target: Vector3 | null): void {
    this.lookTarget = target;
  }

  /** Starts swinging the camera behind the player. */
  resetBehindPlayer(): void {
    this.resetting = true;
  }

  update(): void {
    if (this.input.buttons.cameraReset.pressed) this.resetBehindPlayer();
  }

  frameUpdate(frameDt: number, alpha: number): void {
    const c = CAMERA_CONFIG;
    const { look, lookDelta } = this.input;

    const hasLookInput = look.lengthSq() > 0 || lookDelta.lengthSq() > 0;
    if (hasLookInput) this.resetting = false;
    this.yaw -= look.x * c.stickYawSpeed * frameDt + lookDelta.x * c.mouseSensitivity;
    this.pitch += look.y * c.stickPitchSpeed * frameDt + lookDelta.y * c.mouseSensitivity;

    this.player.getInterpolatedPosition(alpha, tmpTarget);
    if (this.lookTarget) {
      const dx = this.lookTarget.x - tmpTarget.x;
      const dz = this.lookTarget.z - tmpTarget.z;
      if (dx * dx + dz * dz > 0) {
        this.yaw = dampAngle(this.yaw, Math.atan2(-dx, -dz), c.lookTargetLambda, frameDt);
      }
    } else if (this.resetting) {
      const behind = this.player.getInterpolatedFacing(alpha) + Math.PI;
      this.yaw = dampAngle(this.yaw, behind, c.resetLambda, frameDt);
      this.pitch = damp(this.pitch, c.defaultPitch, c.resetLambda, frameDt);
      if (Math.abs(wrapAngle(behind - this.yaw)) < RESET_DONE_EPSILON) this.resetting = false;
    }
    this.yaw = wrapAngle(this.yaw);
    this.pitch = clamp(this.pitch, c.minPitch, c.maxPitch);

    tmpTarget.y += PLAYER_CONFIG.chestHeight;
    const followT = 1 - Math.exp(-c.followLambda * frameDt);
    this.focus.lerp(tmpTarget, followT);

    const cosPitch = Math.cos(this.pitch);
    tmpOffset.set(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    );

    const allowed = this.unoccludedDistance(tmpOffset);
    this.distance =
      allowed < this.distance
        ? allowed
        : damp(this.distance, allowed, c.distanceGrowLambda, frameDt);

    const pos = this.camera.position;
    pos.copy(this.focus).addScaledVector(tmpOffset, this.distance);
    const minY = this.terrain.heightAt(pos.x, pos.z) + c.terrainClearance;
    if (pos.y < minY) pos.y = minY;
    if (this.focus.y > WATER_LEVEL && pos.y < WATER_LEVEL + c.waterClearance) {
      pos.y = WATER_LEVEL + c.waterClearance;
    }
    this.camera.lookAt(this.focus);
  }

  /** Longest boom length (≤ configured distance) whose samples stay above the terrain. */
  private unoccludedDistance(direction: Vector3): number {
    const c = CAMERA_CONFIG;
    for (let i = 1; i <= c.occlusionSamples; i++) {
      const t = i / c.occlusionSamples;
      tmpSample.copy(this.focus).addScaledVector(direction, c.distance * t);
      if (tmpSample.y < this.terrain.heightAt(tmpSample.x, tmpSample.z) + c.terrainClearance) {
        return Math.max(c.minDistance, c.distance * ((i - 1) / c.occlusionSamples));
      }
    }
    return c.distance;
  }
}
