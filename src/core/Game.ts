import * as THREE from 'three';

import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  DEFAULT_SEED,
  FIXED_TIMESTEP,
  MAX_FRAME_DT,
  MAX_PIXEL_RATIO,
  PLAYER_CONFIG,
  STAMINA_CONFIG,
  START_TIME_OF_DAY,
} from '../config';
import { PlayerCombat } from '../combat/PlayerCombat';
import { EnemySpawner } from '../entities/EnemySpawner';
import { GamepadSource } from '../input/GamepadSource';
import { InputManager } from '../input/InputManager';
import { KeyboardMouseSource } from '../input/KeyboardMouseSource';
import { InteractionSystem } from '../items/InteractionSystem';
import { Inventory } from '../items/Inventory';
import { ItemSpawner } from '../items/ItemSpawner';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import type { SaveData } from '../save/SaveData';
import { SaveManager } from '../save/SaveManager';
import { SaveSystem } from '../save/SaveSystem';
import { GameplayFlow } from '../story/GameplayFlow';
import { CookingMenu } from '../ui/CookingMenu';
import { DialogBox } from '../ui/DialogBox';
import { GameOverScreen } from '../ui/GameOverScreen';
import { Hud } from '../ui/Hud';
import { InventoryMenu } from '../ui/InventoryMenu';
import { PauseMenu } from '../ui/PauseMenu';
import { TitleScreen } from '../ui/TitleScreen';
import { WorldLabelLayer } from '../ui/WorldLabelLayer';
import { MultiplayerSystem } from '../net/MultiplayerSystem';
import type { MultiplayerConnection } from '../net/session';
import { Landmarks } from '../world/SiteMeshes';
import { Platforms } from '../world/Platforms';
import { World } from '../world/World';
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
  /** Shared room. Omitted when the server is down or `?offline` is set. */
  multiplayer?: MultiplayerConnection;
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
  readonly input: InputManager;
  readonly gamepad: GamepadSource;
  readonly keyboardMouse: KeyboardMouseSource;
  readonly world: World;
  readonly player: PlayerController;
  readonly cameraRig: ThirdPersonCamera;
  readonly avatar: PlayerAvatar;
  readonly inventory: Inventory;
  readonly interactions: InteractionSystem;
  readonly itemSpawner: ItemSpawner;
  readonly enemies: EnemySpawner;
  readonly combat: PlayerCombat;
  readonly labels: WorldLabelLayer;
  readonly saveManager: SaveManager;
  readonly saves: SaveSystem;
  readonly hud: Hud;
  readonly platforms: Platforms;
  readonly landmarks: Landmarks;
  readonly dialog: DialogBox;
  readonly flow: GameplayFlow;
  /** Live position that world streaming and shadows follow (interpolated player position). */
  readonly focus = new THREE.Vector3();

  private readonly systems: System[] = [];
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;
  private readonly minimapMarkerIds = new Set<string>();

  constructor(
    private readonly container: HTMLElement,
    options: GameOptions = {},
  ) {
    this.saveManager = new SaveManager();
    const existingSave = this.saveManager.load();
    this.seed = options.seed ?? existingSave?.seed ?? DEFAULT_SEED;
    this.debug = options.debug ?? false;
    this.state = new GameState('title', (from, to) => this.bus.emit('state:changed', { from, to }));

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    // three r186 removed PCFSoftShadowMap; PCFShadowMap is its (soft-filtered) replacement.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
    this.scene.add(this.camera);

    this.gamepad = new GamepadSource({
      onConnected: (info) => this.bus.emit('input:gamepadConnected', info),
      onDisconnected: (info) => this.bus.emit('input:gamepadDisconnected', info),
    });
    this.keyboardMouse = new KeyboardMouseSource(this.renderer.domElement);
    this.input = new InputManager([this.keyboardMouse, this.gamepad], (kind) =>
      this.bus.emit('input:activeKindChanged', { kind }),
    );

    this.world = new World(this.scene, this.seed, this.focus, this.camera);
    this.focus.copy(this.world.spawnPoint);
    this.world.preload();

    this.player = new PlayerController({
      terrain: this.world.terrain,
      collision: this.world.collision,
      input: this.input.state,
      bus: this.bus,
      getCameraYaw: () => this.cameraRig.yaw,
      spawnPoint: this.world.spawnPoint,
      platforms: (this.platforms = new Platforms()),
    });
    this.cameraRig = new ThirdPersonCamera(
      this.camera,
      this.input.state,
      this.world.terrain,
      this.player,
    );
    this.avatar = new PlayerAvatar(this.scene, this.player);
    this.inventory = new Inventory(this.bus);
    this.labels = new WorldLabelLayer(container, this.camera);
    this.hud = new Hud({
      container,
      bus: this.bus,
      player: this.player,
      input: this.input,
      inventory: this.inventory,
      dayNight: this.world.dayNight,
      terrain: this.world.terrain,
      state: this.state,
      renderer: this.renderer,
      chunks: this.world.chunks,
      debug: this.debug,
    });
    this.interactions = new InteractionSystem(this.bus, this.player, (interactable) =>
      this.hud.setInteractionPrompt(interactable),
    );
    this.itemSpawner = new ItemSpawner(
      this.scene,
      this.world.terrain,
      this.seed,
      this.focus,
      this.inventory,
      this.interactions,
      this.bus,
    );
    this.enemies = new EnemySpawner(
      this.scene,
      this.world.terrain,
      this.seed,
      this.focus,
      this.player,
      this.world.dayNight,
      this.bus,
      this.labels,
      this.itemSpawner,
    );
    this.combat = new PlayerCombat({
      bus: this.bus,
      player: this.player,
      avatar: this.avatar,
      camera: this.cameraRig,
      input: this.input.state,
      inventory: this.inventory,
      getEnemies: () => [...this.enemies.targetableEnemies, ...this.flow.extraEnemies],
      labels: this.labels,
      terrain: this.world.terrain,
      collision: this.world.collision,
      parent: this.scene,
    });
    this.saves = new SaveSystem({
      bus: this.bus,
      manager: this.saveManager,
      createData: () => this.createSaveData(),
      applyData: (data) => this.applySaveData(data),
    });
    this.landmarks = new Landmarks(
      this.scene,
      this.world.terrain,
      this.platforms,
      this.world.collision,
    );
    this.dialog = new DialogBox(container, this.state, this.input);
    const cooking = new CookingMenu(container, this.state, this.input, this.inventory, () =>
      this.flow.releaseCookingPot(),
    );
    this.addSystem(cooking);
    this.flow = new GameplayFlow({
      bus: this.bus,
      state: this.state,
      player: this.player,
      inventory: this.inventory,
      terrain: this.world.terrain,
      enemyGroup: this.enemies.group,
      labels: this.labels,
      interactions: this.interactions,
      hud: this.hud,
      landmarks: this.landmarks,
      spawn: this.world.spawnPoint,
      dialog: this.dialog,
      cooking,
      save: () => this.saves.save('auto'),
      resetCamera: () => this.cameraRig.resetBehindPlayer(),
    });

    // Fixed simulation: player input first, then combat/enemies and finally time/autosave.
    this.addSystem(this.player);
    this.addSystem(this.combat);
    this.addSystem(this.enemies);
    this.addSystem(this.cameraRig);
    this.addSystem(this.saves);
    // Render-frame order: camera/focus, streaming, visuals, interaction projection and HUD.
    this.addSystem({
      frameUpdate: (_frameDt, alpha) => this.player.getInterpolatedPosition(alpha, this.focus),
    });
    this.addSystem(this.world);
    this.addSystem(this.avatar);
    this.addSystem(this.itemSpawner);
    this.addSystem(this.interactions);
    this.addSystem(this.dialog);
    this.addSystem(this.flow);
    if (options.multiplayer) {
      this.addSystem(
        new MultiplayerSystem({
          connection: options.multiplayer,
          bus: this.bus,
          player: this.player,
          parent: this.scene,
          labels: this.labels,
          items: this.itemSpawner,
          enemies: this.enemies,
          flow: this.flow,
          hud: this.hud,
        }),
      );
    }
    this.addSystem(this.labels);
    this.addSystem({
      frameUpdate: () => {
        this.hud.setCombatActive(this.combat.isInCombat);
        this.updateMinimapMarkers();
      },
    });
    this.addSystem(this.hud);
    this.addSystem(
      new InventoryMenu(
        container,
        this.bus,
        this.state,
        this.input,
        this.inventory,
        this.player,
        () => this.saves.save('auto'),
      ),
    );
    this.addSystem(
      new PauseMenu(
        container,
        this.state,
        this.input,
        this.saveManager,
        () => {
          this.saves.save('manual');
        },
        () => {
          this.saves.load();
        },
        () => this.returnToTitle(),
        {
          questLines: () => this.flow.journalLines(),
          travelPoints: () => this.flow.travelPoints(),
          travel: (id) => this.flow.travel(id),
        },
      ),
    );
    this.addSystem(
      new GameOverScreen(
        container,
        this.bus,
        this.state,
        this.player,
        this.world.spawnPoint,
        () => this.flow.story.respawn ?? this.saves.lastSavePoint,
      ),
    );
    this.addSystem(
      new TitleScreen(
        container,
        this.state,
        this.input,
        this.camera,
        this.world.spawnPoint,
        this.saveManager,
        () => this.startNewGame(),
        () => this.continueGame(),
      ),
    );

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
    this.landmarks.dispose();
    this.input.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const rawDt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    const frameDt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);

    this.input.poll(frameDt);
    this.accumulator += frameDt;
    while (this.accumulator >= FIXED_TIMESTEP) {
      this.fixedStep(FIXED_TIMESTEP);
      this.input.consumeEdges();
      this.accumulator -= FIXED_TIMESTEP;
    }

    const alpha = this.state.isSimulating ? this.accumulator / FIXED_TIMESTEP : 1;
    for (const system of this.systems) system.frameUpdate?.(frameDt, alpha);
    this.renderer.render(this.scene, this.camera);
  };

  private fixedStep(dt: number): void {
    if (this.input.state.buttons.pause.pressed) this.state.togglePause();
    if (!this.state.isSimulating) return;
    for (const system of this.systems) system.update?.(dt);
  }

  private createSaveData(): SaveData {
    const position = this.player.position;
    return {
      version: 1,
      seed: this.seed,
      player: {
        position: { x: position.x, y: position.y, z: position.z },
        hp: this.player.stats.hp,
        maxHp: this.player.stats.maxHp,
        maxStamina: this.player.stats.maxStamina,
      },
      inventory: this.inventory.toJSON(),
      equippedWeapon: this.inventory.equippedWeaponId,
      timeOfDay: this.world.dayNight.timeOfDay,
      day: this.world.dayNight.elapsedDays,
      collectedItemIds: [...this.itemSpawner.collectedItemIds],
      openedChestIds: [...this.itemSpawner.openedChestIds],
      clearedCamps: this.enemies.campProgress,
      quests: this.flow.quests.toJSON(),
      story: this.flow.story.toJSON(),
    };
  }

  private applySaveData(data: SaveData): void {
    this.inventory.restore(data.inventory);
    this.inventory.equipWeapon(data.equippedWeapon);
    this.world.dayNight.setTimeOfDay(data.timeOfDay, data.day);
    this.itemSpawner.reset();
    this.enemies.reset();
    this.itemSpawner.restoreProgress(data.collectedItemIds, data.openedChestIds);
    this.enemies.restoreProgress(data.clearedCamps);
    this.player.placeAt(data.player.position);
    this.player.restoreVitals(data.player.hp, data.player.maxHp, data.player.maxStamina);
    this.flow.story.restore(data.story);
    this.flow.quests.restore(data.quests);
    this.flow.onRestored();
    this.cameraRig.resetBehindPlayer();
  }

  private startNewGame(): void {
    this.saveManager.clear();
    this.saves.resetSavePoint();
    this.inventory.clear();
    this.inventory.add('wooden-stick');
    this.inventory.add('traveler-bow');
    this.inventory.add('arrow', 20);
    this.inventory.add('apple', 1);
    this.inventory.equipWeapon('wooden-stick');
    this.itemSpawner.reset();
    this.enemies.reset();
    this.world.dayNight.setTimeOfDay(START_TIME_OF_DAY, 0);
    this.player.restoreVitals(
      PLAYER_CONFIG.maxHpQuarters,
      PLAYER_CONFIG.maxHpQuarters,
      STAMINA_CONFIG.max,
    );
    this.player.reviveAt(this.world.spawnPoint);
    this.cameraRig.resetBehindPlayer();
    this.state.set('playing');
    this.flow.onNewGame();
  }

  private continueGame(): void {
    if (!this.saves.load()) return;
    this.state.set('playing');
  }

  private returnToTitle(): void {
    this.combat.reset();
    this.state.set('title');
    if (document.pointerLockElement) void document.exitPointerLock();
  }

  private updateMinimapMarkers(): void {
    const next = new Set<string>();
    for (const camp of this.enemies.campMarkers) {
      if (camp.cleared) continue;
      const id = `camp-marker:${camp.id}`;
      next.add(id);
      this.hud.upsertMinimapMarker({
        id,
        x: camp.x,
        z: camp.z,
        color: '#e84242',
        shape: 'dot',
      });
    }
    for (const chest of this.itemSpawner.activeChests) {
      if (chest.isOpened) continue;
      const id = `chest-marker:${chest.id}`;
      next.add(id);
      this.hud.upsertMinimapMarker({
        id,
        x: chest.position.x,
        z: chest.position.z,
        color: '#f1cc64',
        shape: 'chest',
      });
    }
    for (const marker of this.flow.markers()) {
      next.add(marker.id);
      this.hud.upsertMinimapMarker(marker);
    }
    for (const id of this.minimapMarkerIds) {
      if (!next.has(id)) this.hud.removeMinimapMarker(id);
    }
    this.minimapMarkerIds.clear();
    for (const id of next) this.minimapMarkerIds.add(id);
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
