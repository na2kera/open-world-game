import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import { availableRecipes, type Recipe } from '../data/recipes';
import { getButtonLabel } from '../input/buttonLabels';
import type { InputManager } from '../input/InputManager';
import type { Inventory } from '../items/Inventory';
import { MenuNavigator, readMenuInput } from './MenuNavigator';

/** Pot menu. Lists dishes the player can currently cook. */
export class CookingMenu implements System {
  readonly element = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly note = document.createElement('p');
  private readonly navigator = new MenuNavigator();
  private recipes: readonly Recipe[] = [];
  private openValue = false;

  constructor(
    container: HTMLElement,
    private readonly state: GameState,
    private readonly input: InputManager,
    private readonly inventory: Inventory,
    private readonly onClose: () => void,
  ) {
    this.element.className = 'game-menu';
    this.element.hidden = true;
    const title = document.createElement('h2');
    title.textContent = '料理';
    this.note.className = 'inventory-detail';
    this.list.className = 'title-menu';
    this.element.append(title, this.note, this.list);
    container.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  open(): void {
    if (this.openValue || this.state.mode !== 'playing' || !this.state.set('menu')) return;
    this.recipes = availableRecipes((itemId, count) => this.inventory.has(itemId, count));
    this.navigator.configure(Math.max(1, this.recipes.length));
    this.navigator.resetEdges();
    this.openValue = true;
    this.element.hidden = false;
    this.render();
  }

  frameUpdate(frameDt: number): void {
    if (!this.openValue) return;
    if (this.state.mode !== 'menu') {
      this.hide();
      return;
    }
    const result = this.navigator.update(frameDt, readMenuInput(this.input.state));
    if (result.cancelled) this.close();
    if (result.moved) this.render();
    if (result.confirmed) this.cookSelected();
  }

  dispose(): void {
    this.element.remove();
  }

  private cookSelected(): void {
    const recipe = this.recipes[this.navigator.index];
    if (!recipe) {
      this.close();
      return;
    }
    if (!recipe.ingredients.every((item) => this.inventory.has(item.itemId, item.count))) return;
    for (const item of recipe.ingredients) this.inventory.remove(item.itemId, item.count);
    this.inventory.add(recipe.result, recipe.count);
    this.close();
  }

  private close(): void {
    if (this.state.mode === 'menu') this.state.set('playing');
    this.hide();
  }

  private hide(): void {
    const wasOpen = this.openValue;
    this.openValue = false;
    this.element.hidden = true;
    if (wasOpen) this.onClose();
  }

  private render(): void {
    const kind = this.input.activeKind;
    if (this.recipes.length === 0) {
      this.note.textContent = `材料が足りない。 ${getButtonLabel('menuCancel', kind)} で閉じる`;
      this.list.replaceChildren();
      return;
    }
    this.note.textContent = `${getButtonLabel('menuConfirm', kind)} で作る / ${getButtonLabel('menuCancel', kind)} で閉じる`;
    this.list.replaceChildren(
      ...this.recipes.map((recipe, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = `${index === this.navigator.index ? '◆ ' : ''}${recipe.name}`;
        row.addEventListener('click', () => {
          this.navigator.setIndex(index);
          this.cookSelected();
        });
        return row;
      }),
    );
  }
}
