import * as THREE from 'three';

import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  DEFAULT_SEED,
  FIXED_TIMESTEP,
  MAX_FRAME_DT,
  MAX_PIXEL_RATIO,
} from '../config';
import { EventBus } from './EventBus';
import type { GameEvents } from './events';
import { GameState } from './GameState';
import type { System } from './System';

/** Options for {@link Game}. */
export interface GameOptions {
  /** World seed. */
  seed?: number;
  /** Show debug HUD (coordinates, FPS). */
  debug?: boolean;
}

/**
 * Composition root and main loop.
 *
 * Owns the renderer, scene and camera, runs registered {@link System}s with a fixed simulation
 * step (frame delta capped at {@link MAX_FRAME_DT}) and renders once per animation frame.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly bus = new EventBus<GameEvents>();
  readonly state: GameState;
  readonly seed: number;
  readonly debug: boolean;

  private readonly systems: System[] = [];
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;

  constructor(
    private readonly container: HTMLElement,
    options: GameOptions = {},
  ) {
    this.seed = options.seed ?? DEFAULT_SEED;
    this.debug = options.debug ?? false;
    this.state = new GameState('playing', (from, to) =>
      this.bus.emit('state:changed', { from, to }),
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
    this.scene.add(this.camera);

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  /** Registers a system; systems run in registration order. */
  addSystem<T extends System>(system: T): T {
    this.systems.push(system);
    return system;
  }

  /** Starts the animation loop. */
  start(): this {
    if (this.rafId === null) {
      this.lastTime = null;
      this.rafId = requestAnimationFrame(this.tick);
    }
    return this;
  }

  /** Stops the loop. */
  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** Stops the loop and releases GPU / DOM resources. */
  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    for (const system of this.systems) system.dispose?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const rawDt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    const frameDt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);

    this.accumulator += frameDt;
    while (this.accumulator >= FIXED_TIMESTEP) {
      this.fixedStep(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
    }

    const alpha = this.accumulator / FIXED_TIMESTEP;
    for (const system of this.systems) system.frameUpdate?.(frameDt, alpha);
    this.renderer.render(this.scene, this.camera);
  };

  private fixedStep(dt: number): void {
    if (!this.state.isSimulating) return;
    for (const system of this.systems) system.update?.(dt);
  }

  private readonly handleResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  /** Resets timing when the tab becomes visible again so dt does not jump. */
  private readonly handleVisibility = (): void => {
    this.lastTime = null;
    this.accumulator = 0;
  };
}
