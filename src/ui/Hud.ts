import './hud.css';

import type { WebGLRenderer } from 'three';

import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import { getItemDef } from '../data/items';
import { getButtonLabel, getSprintLabel } from '../input/buttonLabels';
import type { InputManager } from '../input/InputManager';
import type { ControllerKind } from '../input/types';
import type { Interactable } from '../items/Interactable';
import type { Inventory } from '../items/Inventory';
import type { PlayerController } from '../player/PlayerController';
import type { DayNightCycle } from '../world/DayNightCycle';
import type { TerrainChunkManager } from '../world/TerrainChunkManager';
import type { Terrain } from '../world/Terrain';
import { HeartsDisplay } from './HeartsDisplay';
import { createItemIcon } from './InventoryMenu';
import { Minimap, type MinimapMarker } from './Minimap';
import { StaminaWheel } from './StaminaWheel';

/** Dependencies of {@link Hud}. */
export interface HudDeps {
  container: HTMLElement;
  bus: EventBus<GameEvents>;
  player: PlayerController;
  input: InputManager;
  inventory: Inventory;
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
  private readonly interactionPrompt = document.createElement('div');
  private readonly toast = document.createElement('div');
  private readonly weapon = document.createElement('div');
  private readonly damageVignette = document.createElement('div');
  private readonly saveIcon = document.createElement('div');
  private readonly objective = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly boss = document.createElement('div');
  private readonly bossName = document.createElement('div');
  private readonly bossFill = document.createElement('span');
  private readonly online = document.createElement('div');
  private readonly unsubscribers: (() => void)[] = [];
  private readonly toastQueue: string[] = [];
  private interaction: Interactable | null = null;
  private combatActive = false;
  private toastTimer = 0;
  private bannerTimer = 0;
  private readonly bannerQueue: string[] = [];
  private damageTimer = 0;
  private saveTimer = 0;
  private shownWeapon = '';
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
    this.online.className = 'hud-clock hud-panel';
    this.online.hidden = true;
    corner.append(this.hints, this.minimap.element, this.clock, this.online);

    this.debugLine.className = 'hud-debug';
    this.debugLine.hidden = !deps.debug;

    this.interactionPrompt.className = 'hud-interaction hud-panel';
    this.interactionPrompt.hidden = true;
    this.toast.className = 'hud-toast';
    this.toast.hidden = true;
    this.weapon.className = 'hud-weapon hud-panel';
    this.damageVignette.className = 'hud-damage-vignette';
    this.saveIcon.className = 'hud-save-icon hud-panel';
    this.saveIcon.textContent = '◇ セーブ中';
    this.saveIcon.hidden = true;
    this.objective.className = 'hud-objective hud-panel';
    this.objective.hidden = true;
    this.banner.className = 'hud-banner';
    this.banner.hidden = true;
    this.boss.className = 'hud-boss';
    this.boss.hidden = true;
    this.bossName.className = 'hud-boss-name';
    const bossTrack = document.createElement('div');
    bossTrack.className = 'hud-boss-track';
    this.bossFill.className = 'hud-boss-fill';
    bossTrack.appendChild(this.bossFill);
    this.boss.append(this.bossName, bossTrack);

    this.root.append(
      this.hearts.element,
      this.stamina.element,
      this.objective,
      corner,
      this.debugLine,
      this.interactionPrompt,
      this.toast,
      this.weapon,
      this.damageVignette,
      this.saveIcon,
      this.banner,
      this.boss,
    );
    deps.container.appendChild(this.root);
    this.unsubscribers.push(
      deps.bus.on('item:acquired', ({ itemId, count }) => {
        const name = getItemDef(itemId)?.name ?? itemId;
        this.enqueueToast(`${name}${count > 1 ? ` ×${count}` : ''} を手に入れた！`);
      }),
      deps.bus.on('weapon:broken', ({ itemId }) => {
        const name = getItemDef(itemId)?.name ?? itemId;
        this.enqueueToast(`${name} が壊れた…`);
      }),
      deps.bus.on('player:damaged', () => {
        this.damageTimer = 0.28;
      }),
      deps.bus.on('save:started', () => {
        this.saveTimer = 1.2;
      }),
    );
  }

  frameUpdate(frameDt: number): void {
    const { player, input, dayNight, state } = this.deps;
    this.root.hidden = state.mode === 'title';
    const stats = player.stats;
    this.hearts.update(stats.hp, stats.maxHp);
    this.stamina.update(frameDt, stats.stamina, stats.maxStamina, stats.staminaExhausted);
    this.minimap.update(player.position.x, player.position.z, player.facing);

    const clock = `${dayNight.isNight ? '☾' : '☀'} ${dayNight.clockText}`;
    if (clock !== this.shownClock) {
      this.shownClock = clock;
      this.clock.textContent = clock;
    }

    const contextKey = `${input.activeKind}:${this.interaction?.promptLabel ?? ''}:${this.combatActive}`;
    if (contextKey !== `${this.shownKind}:${this.hints.dataset['context'] ?? ''}`) {
      this.renderHints(input.activeKind);
      this.hints.dataset['context'] = `${this.interaction?.promptLabel ?? ''}:${this.combatActive}`;
    }
    this.renderInteraction();
    this.renderWeapon();
    this.updateTransient(frameDt);

    if (this.deps.debug) this.updateDebug(frameDt);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.root.remove();
  }

  setInteractionPrompt(interactable: Interactable | null): void {
    this.interaction = interactable;
    this.shownKind = null;
  }

  setCombatActive(active: boolean): void {
    if (this.combatActive === active) return;
    this.combatActive = active;
    this.shownKind = null;
  }

  upsertMinimapMarker(marker: MinimapMarker): void {
    this.minimap.upsertMarker(marker);
  }

  removeMinimapMarker(id: string): void {
    this.minimap.removeMarker(id);
  }

  setObjective(text: string): void {
    this.objective.hidden = text.length === 0;
    this.objective.textContent = text;
  }

  showBanner(text: string): void {
    this.bannerQueue.push(text);
    if (this.banner.hidden) this.showNextBanner();
  }

  setBoss(name: string | null, hp: number, maxHp: number): void {
    this.boss.hidden = name === null;
    if (!name) return;
    this.bossName.textContent = name;
    const ratio = maxHp <= 0 ? 0 : Math.max(0, Math.min(1, hp / maxHp));
    this.bossFill.style.transform = `scaleX(${ratio})`;
  }

  setMapReveals(circles: readonly { x: number; z: number; radius: number }[]): void {
    this.minimap.setReveals(circles);
  }

  /** Shows how many people share the room. `null` hides the line for solo play. */
  setOnline(count: number | null): void {
    this.online.hidden = count === null;
    if (count !== null) this.online.textContent = `仲間 ${count}`;
  }

  enqueueToast(message: string): void {
    this.toastQueue.push(message);
    if (this.toast.hidden) this.showNextToast();
  }

  private renderHints(kind: ControllerKind): void {
    this.shownKind = kind;
    const items: [string, string][] = [
      [getButtonLabel('attack', kind), '攻撃'],
      [getButtonLabel('jump', kind), 'ジャンプ'],
      [getSprintLabel(kind), 'ダッシュ'],
      [getButtonLabel('inventory', kind), '所持品'],
    ];
    if (this.interaction) {
      items.unshift([getButtonLabel('interact', kind), this.interaction.promptLabel]);
    }
    if (this.combatActive) items.push([getButtonLabel('lockOn', kind), '注目']);
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

  private renderInteraction(): void {
    const interaction = this.interaction;
    this.interactionPrompt.hidden = interaction === null;
    if (!interaction) return;
    this.interactionPrompt.textContent = `${getButtonLabel('interact', this.deps.input.activeKind)} ${interaction.promptLabel}`;
  }

  private renderWeapon(): void {
    const entry = this.deps.inventory.equippedWeapon;
    const key = entry ? `${entry.itemId}:${entry.durability ?? ''}` : 'none';
    if (key === this.shownWeapon) return;
    this.shownWeapon = key;
    this.weapon.replaceChildren();
    if (!entry) {
      this.weapon.hidden = true;
      return;
    }
    const def = getItemDef(entry.itemId);
    this.weapon.hidden = false;
    const icon = createItemIcon(def);
    const text = document.createElement('span');
    text.textContent = `${def?.name ?? entry.itemId}${entry.durability === null ? '' : ` / 耐久 ${entry.durability}`}`;
    this.weapon.append(icon, text);
  }

  private updateTransient(frameDt: number): void {
    if (!this.toast.hidden) {
      this.toastTimer -= frameDt;
      if (this.toastTimer <= 0) {
        this.toast.hidden = true;
        this.showNextToast();
      }
    }
    this.damageTimer = Math.max(0, this.damageTimer - frameDt);
    this.damageVignette.classList.toggle('is-visible', this.damageTimer > 0);
    this.saveTimer = Math.max(0, this.saveTimer - frameDt);
    this.saveIcon.hidden = this.saveTimer <= 0;
    if (!this.banner.hidden) {
      this.bannerTimer -= frameDt;
      if (this.bannerTimer <= 0) {
        this.banner.hidden = true;
        this.showNextBanner();
      }
    }
  }

  private showNextBanner(): void {
    const message = this.bannerQueue.shift();
    if (!message) return;
    this.banner.textContent = message;
    this.bannerTimer = 2.4;
    this.banner.hidden = false;
  }

  private showNextToast(): void {
    const message = this.toastQueue.shift();
    if (!message) return;
    this.toast.textContent = message;
    this.toastTimer = 2.1;
    this.toast.hidden = false;
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
