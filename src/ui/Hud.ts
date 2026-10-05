import './hud.css';

import type { WebGLRenderer } from 'three';

import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import { getButtonLabel, getSprintLabel } from '../input/buttonLabels';
import type { GamepadSource } from '../input/GamepadSource';
import type { InputManager } from '../input/InputManager';
import type { ControllerKind } from '../input/types';
import type { PlayerController } from '../player/PlayerController';
import type { DayNightCycle } from '../world/DayNightCycle';
import type { TerrainChunkManager } from '../world/TerrainChunkManager';
import type { Terrain } from '../world/Terrain';
import { HeartsDisplay } from './HeartsDisplay';
import { Minimap } from './Minimap';
import { StaminaWheel } from './StaminaWheel';

/** Dependencies of {@link Hud}. */
export interface HudDeps {
  container: HTMLElement;
  player: PlayerController;
  input: InputManager;
  gamepad: GamepadSource;
  dayNight: DayNightCycle;
  terrain: Terrain;
  state: GameState;
  renderer: WebGLRenderer;
  chunks: TerrainChunkManager;
  /** Show coordinates / FPS (`?debug`). */
  debug: boolean;
}

/** Seconds between FPS / debug text refreshes. */
const DEBUG_INTERVAL = 0.5;
const COORD_DECIMALS = 1;

/**
 * DOM overlay (`#hud`): hearts, stamina wheel, minimap with clock, button hints, start / pause
 * overlays and an optional debug line.
 */
export class Hud implements System {
  readonly root = document.createElement('div');
  private readonly hearts = new HeartsDisplay();
  private readonly stamina = new StaminaWheel();
  private readonly minimap: Minimap;
  private readonly clock = document.createElement('div');
  private readonly hints = document.createElement('div');
  private readonly debugLine = document.createElement('div');
  private readonly startOverlay = document.createElement('div');
  private readonly pauseOverlay = document.createElement('div');
  private shownKind: ControllerKind | null = null;
  private shownClock = '';
  private frames = 0;
  private debugTimer = 0;

  constructor(private readonly deps: HudDeps) {
    this.root.id = 'hud';
    this.minimap = new Minimap(deps.terrain);

    const corner = document.createElement('div');
    corner.className = 'hud-corner';
    this.hints.className = 'hud-hints hud-panel';
    this.clock.className = 'hud-clock hud-panel';
    corner.append(this.hints, this.minimap.element, this.clock);

    this.debugLine.className = 'hud-debug';
    this.debugLine.hidden = !deps.debug;

    this.startOverlay.className = 'hud-overlay hud-start';
    this.startOverlay.textContent = 'コントローラーのボタンを押すか、画面をクリックして開始';
    this.pauseOverlay.className = 'hud-overlay hud-pause';
    this.pauseOverlay.textContent = '一時停止中';

    this.root.append(
      this.hearts.element,
      this.stamina.element,
      corner,
      this.debugLine,
      this.startOverlay,
      this.pauseOverlay,
    );
    deps.container.appendChild(this.root);
  }

  frameUpdate(frameDt: number): void {
    const { player, input, gamepad, dayNight, state } = this.deps;
    const stats = player.stats;
    this.hearts.update(stats.hp, stats.maxHp);
    this.stamina.update(frameDt, stats.stamina, stats.maxStamina, stats.staminaExhausted);
    this.minimap.update(player.position.x, player.position.z, player.facing);

    const clock = `${dayNight.isNight ? '☾' : '☀'} ${dayNight.clockText}`;
    if (clock !== this.shownClock) {
      this.shownClock = clock;
      this.clock.textContent = clock;
    }

    if (input.activeKind !== this.shownKind) this.renderHints(input.activeKind);

    this.startOverlay.hidden = input.hasReceivedInput || gamepad.isConnected;
    this.pauseOverlay.hidden = state.mode !== 'paused';

    if (this.deps.debug) this.updateDebug(frameDt);
  }

  dispose(): void {
    this.root.remove();
  }

  private renderHints(kind: ControllerKind): void {
    this.shownKind = kind;
    const items: [string, string][] = [
      [getButtonLabel('jump', kind), 'ジャンプ'],
      [getSprintLabel(kind), 'ダッシュ'],
      [getButtonLabel('cameraReset', kind), 'カメラリセット'],
    ];
    this.hints.replaceChildren(
      ...items.map(([label, text]) => {
        const item = document.createElement('span');
        item.className = 'hud-hint';
        const key = document.createElement('span');
        key.className = 'hud-key';
        key.textContent = label;
        item.append(key, document.createTextNode(text));
        return item;
      }),
    );
  }

  private updateDebug(frameDt: number): void {
    this.frames++;
    this.debugTimer += frameDt;
    if (this.debugTimer < DEBUG_INTERVAL) return;
    const fps = this.frames / this.debugTimer;
    this.frames = 0;
    this.debugTimer = 0;
    const { player, renderer, chunks } = this.deps;
    const p = player.position;
    const info = renderer.info.render;
    this.debugLine.textContent =
      `XYZ ${p.x.toFixed(COORD_DECIMALS)} / ${p.y.toFixed(COORD_DECIMALS)} / ` +
      `${p.z.toFixed(COORD_DECIMALS)} | ${fps.toFixed(0)} FPS | ${player.state} | ` +
      `chunks ${chunks.loadedCount} (+${chunks.pendingCount}) | draws ${info.calls} | ` +
      `tris ${(info.triangles / 1000).toFixed(0)}k`;
  }
}
