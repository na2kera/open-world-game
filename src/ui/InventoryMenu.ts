import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import { getItemDef, type ItemCategory, type ItemDef } from '../data/items';
import { getButtonLabel } from '../input/buttonLabels';
import type { InputManager } from '../input/InputManager';
import type { Inventory, InventoryEntry } from '../items/Inventory';
import type { PlayerController } from '../player/PlayerController';
import { MenuNavigator, readMenuInput } from './MenuNavigator';

interface InventoryTab {
  readonly label: string;
  readonly categories: readonly ItemCategory[];
}

const TABS: readonly InventoryTab[] = [
  { label: '武器', categories: ['weapon'] },
  { label: '食べ物', categories: ['food'] },
  { label: '素材', categories: ['material'] },
  { label: '大事なもの', categories: ['key', 'rune'] },
];

const GRID_COLUMNS = 5;

/** Full-screen item grid controlled by D-pad/stick, A/B and L/R tabs. */
export class InventoryMenu implements System {
  readonly element = document.createElement('div');
  private readonly tabBar = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly detail = document.createElement('div');
  private readonly hints = document.createElement('div');
  private readonly navigator = new MenuNavigator();
  private readonly unsubscribers: (() => void)[] = [];
  private tabIndex = 0;
  private shownEntries: readonly InventoryEntry[] = [];
  private openValue = false;
  private inventoryHeld = false;
  private tabLeftHeld = false;
  private tabRightHeld = false;
  private dirty = true;

  constructor(
    container: HTMLElement,
    bus: EventBus<GameEvents>,
    private readonly state: GameState,
    private readonly input: InputManager,
    private readonly inventory: Inventory,
    private readonly player: PlayerController,
    private readonly onClosed: () => void,
  ) {
    this.element.className = 'game-menu inventory-menu';
    this.element.hidden = true;
    const title = document.createElement('h2');
    title.textContent = 'ポーチ';
    this.tabBar.className = 'menu-tabs';
    this.grid.className = 'inventory-grid';
    this.detail.className = 'inventory-detail';
    this.hints.className = 'menu-hints';
    const content = document.createElement('div');
    content.className = 'inventory-content';
    content.append(this.grid, this.detail);
    this.element.append(title, this.tabBar, content, this.hints);
    container.appendChild(this.element);
    this.buildTabs();
    this.unsubscribers.push(
      bus.on('inventory:changed', () => {
        this.dirty = true;
      }),
      bus.on('weapon:equipped', () => {
        this.dirty = true;
      }),
    );
  }

  frameUpdate(frameDt: number): void {
    const inventoryHeld = this.input.state.buttons.inventory.held;
    const inventoryPressed = inventoryHeld && !this.inventoryHeld;
    let openedThisFrame = false;
    if (this.state.mode === 'playing' && inventoryPressed && this.state.set('menu')) {
      this.open();
      openedThisFrame = true;
    }
    if (this.state.mode !== 'menu') {
      this.element.hidden = true;
      this.openValue = false;
      this.inventoryHeld = inventoryHeld;
      return;
    }
    if (!this.openValue) {
      this.element.hidden = true;
      this.inventoryHeld = inventoryHeld;
      return;
    }
    this.element.hidden = false;
    if (this.dirty) this.render();
    this.updateTabs();
    const result = this.navigator.update(frameDt, readMenuInput(this.input.state));
    if (result.moved) this.renderSelection();
    if (result.confirmed) this.activateSelected();
    if (result.cancelled || (inventoryPressed && !openedThisFrame)) this.close();
    this.renderHints();
    this.inventoryHeld = inventoryHeld;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.element.remove();
  }

  private open(): void {
    this.openValue = true;
    this.element.hidden = false;
    this.navigator.resetEdges();
    this.dirty = true;
  }

  private close(): void {
    if (!this.state.set('playing')) return;
    this.openValue = false;
    this.element.hidden = true;
    this.onClosed();
  }

  private updateTabs(): void {
    const left = this.input.state.buttons.menuTabLeft.held;
    const right = this.input.state.buttons.menuTabRight.held;
    let changed = false;
    if (left && !this.tabLeftHeld) {
      this.tabIndex = (this.tabIndex - 1 + TABS.length) % TABS.length;
      changed = true;
    }
    if (right && !this.tabRightHeld) {
      this.tabIndex = (this.tabIndex + 1) % TABS.length;
      changed = true;
    }
    this.tabLeftHeld = left;
    this.tabRightHeld = right;
    if (changed) {
      this.navigator.setIndex(0);
      this.dirty = true;
    }
  }

  private activateSelected(): void {
    const entry = this.shownEntries[this.navigator.index];
    if (!entry) return;
    const def = getItemDef(entry.itemId);
    if (!def) return;
    if (def.category === 'weapon') {
      this.inventory.equipWeapon(def.id);
    } else if (def.category === 'food' && this.player.heal(def.healQuarters) > 0) {
      this.inventory.consume(def.id);
    }
    this.dirty = true;
  }

  private render(): void {
    this.dirty = false;
    const tab = TABS[this.tabIndex];
    if (!tab) return;
    this.shownEntries = this.inventory.entries.filter((entry) => {
      const def = getItemDef(entry.itemId);
      return def ? tab.categories.includes(def.category) : false;
    });
    this.navigator.configure(this.shownEntries.length, GRID_COLUMNS);
    this.grid.replaceChildren(
      ...this.shownEntries.map((entry, index) => this.createSlot(entry, index)),
    );
    if (this.shownEntries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'inventory-empty';
      empty.textContent = 'まだ何も持っていない';
      this.grid.appendChild(empty);
    }
    this.tabBar.querySelectorAll('button').forEach((button, index) => {
      button.classList.toggle('is-active', index === this.tabIndex);
    });
    this.renderSelection();
  }

  private createSlot(entry: InventoryEntry, index: number): HTMLButtonElement {
    const def = getItemDef(entry.itemId);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-slot';
    button.dataset['index'] = String(index);
    const icon = createItemIcon(def);
    const name = document.createElement('span');
    name.className = 'inventory-slot-name';
    name.textContent = def?.name ?? entry.itemId;
    const count = document.createElement('span');
    count.className = 'inventory-slot-count';
    count.textContent =
      entry.count > 1 ? `×${entry.count}` : entry.durability === null ? '' : `${entry.durability}`;
    button.append(icon, name, count);
    button.addEventListener('click', () => {
      this.navigator.setIndex(index);
      this.renderSelection();
      this.activateSelected();
    });
    return button;
  }

  private renderSelection(): void {
    this.grid.querySelectorAll('.inventory-slot').forEach((slot, index) => {
      slot.classList.toggle('is-selected', index === this.navigator.index);
    });
    const entry = this.shownEntries[this.navigator.index];
    const def = entry ? getItemDef(entry.itemId) : undefined;
    this.detail.replaceChildren();
    if (!entry || !def) return;
    const name = document.createElement('h3');
    name.textContent = `${def.name}${this.inventory.equippedWeaponId === entry.itemId ? '　装備中' : ''}`;
    const description = document.createElement('p');
    description.textContent = def.description;
    const stats = document.createElement('p');
    stats.className = 'inventory-stats';
    stats.textContent = describeStats(def, entry);
    this.detail.append(name, description, stats);
  }

  private buildTabs(): void {
    this.tabBar.replaceChildren(
      ...TABS.map((tab, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tab.label;
        button.addEventListener('click', () => {
          this.tabIndex = index;
          this.navigator.setIndex(0);
          this.dirty = true;
        });
        return button;
      }),
    );
  }

  private renderHints(): void {
    const kind = this.input.activeKind;
    this.hints.textContent =
      `${getButtonLabel('menuTabLeft', kind)} / ${getButtonLabel('menuTabRight', kind)} タブ / ` +
      `${getButtonLabel('menuConfirm', kind)} 使う・装備 / ` +
      `${getButtonLabel('menuCancel', kind)} 戻る`;
  }
}

export function createItemIcon(def: ItemDef | undefined): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = `item-icon item-icon--${def?.icon.shape ?? 'crystal'}`;
  icon.style.setProperty('--item-color', def?.icon.color ?? '#fff');
  return icon;
}

function describeStats(def: ItemDef, entry: InventoryEntry): string {
  if (def.category === 'weapon') {
    const durability = entry.durability === null ? '∞' : String(entry.durability);
    return `攻撃力 ${def.attack} / 耐久 ${durability}`;
  }
  if (def.category === 'food') return `回復 ${def.healQuarters / 4} ハート`;
  return `所持数 ${entry.count}`;
}
