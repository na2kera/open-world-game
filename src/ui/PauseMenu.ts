import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import { getButtonLabel } from '../input/buttonLabels';
import type { InputManager } from '../input/InputManager';
import type { SaveManager } from '../save/SaveManager';
import { MenuNavigator, readMenuInput } from './MenuNavigator';
import { controlsHelpMarkup } from './TitleScreen';

interface PauseAction {
  readonly label: string;
  readonly run: () => void;
}

/** Pause options with manual save/load and confirmation subviews. */
export class PauseMenu implements System {
  readonly element = document.createElement('div');
  private readonly menu = document.createElement('div');
  private readonly help = document.createElement('div');
  private readonly confirm = document.createElement('div');
  private readonly hints = document.createElement('div');
  private readonly navigator = new MenuNavigator();
  private actions: readonly PauseAction[] = [];
  private shown = false;
  private inHelp = false;
  private pendingConfirm: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    private readonly state: GameState,
    private readonly input: InputManager,
    private readonly saves: SaveManager,
    private readonly saveGame: () => void,
    private readonly loadGame: () => void,
    private readonly returnToTitle: () => void,
  ) {
    this.element.className = 'game-menu pause-menu';
    this.element.hidden = true;
    const title = document.createElement('h2');
    title.textContent = 'ポーズ';
    this.menu.className = 'pause-options';
    this.help.className = 'controls-help';
    this.help.hidden = true;
    this.confirm.className = 'menu-confirm';
    this.confirm.hidden = true;
    this.hints.className = 'menu-hints';
    this.element.append(title, this.menu, this.help, this.confirm, this.hints);
    container.appendChild(this.element);
  }

  frameUpdate(frameDt: number): void {
    const visible = this.state.mode === 'paused';
    this.element.hidden = !visible;
    if (!visible) {
      this.shown = false;
      return;
    }
    if (!this.shown) {
      this.shown = true;
      this.rebuildActions();
      this.navigator.resetEdges();
    }
    const result = this.navigator.update(frameDt, readMenuInput(this.input.state));
    if (this.inHelp) {
      if (result.cancelled || result.confirmed) this.closeHelp();
      return;
    }
    if (this.pendingConfirm) {
      if (result.cancelled) this.closeConfirm();
      if (result.confirmed) {
        const action = this.pendingConfirm;
        this.closeConfirm();
        action();
      }
      return;
    }
    if (result.moved) this.renderSelection();
    if (result.confirmed) this.actions[this.navigator.index]?.run();
    if (result.cancelled) this.state.set('playing');
    this.renderHints();
  }

  dispose(): void {
    this.element.remove();
  }

  private rebuildActions(): void {
    const actions: PauseAction[] = [
      { label: 'つづける', run: () => this.state.set('playing') },
      {
        label: 'セーブ',
        run: () => {
          this.saveGame();
          this.rebuildActions();
        },
      },
    ];
    if (this.saves.hasSave()) {
      actions.push({
        label: 'ロード',
        run: () => this.openConfirm('最後にセーブした状態をロードしますか？', this.loadGame),
      });
    }
    actions.push(
      { label: '操作説明', run: () => this.openHelp() },
      {
        label: 'タイトルへ',
        run: () =>
          this.openConfirm(
            'セーブしていない進行は失われます。タイトルへ戻りますか？',
            this.returnToTitle,
          ),
      },
    );
    this.actions = actions;
    this.navigator.configure(actions.length);
    this.menu.replaceChildren(
      ...actions.map((action, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.addEventListener('click', action.run);
        button.addEventListener('pointerenter', () => {
          this.navigator.setIndex(index);
          this.renderSelection();
        });
        return button;
      }),
    );
    this.renderSelection();
  }

  private renderSelection(): void {
    this.menu.querySelectorAll('button').forEach((button, index) => {
      button.classList.toggle('is-selected', index === this.navigator.index);
    });
  }

  private openHelp(): void {
    this.inHelp = true;
    this.menu.hidden = true;
    this.help.hidden = false;
    this.help.innerHTML = controlsHelpMarkup();
    this.navigator.resetEdges();
  }

  private closeHelp(): void {
    this.inHelp = false;
    this.menu.hidden = false;
    this.help.hidden = true;
    this.navigator.resetEdges();
  }

  private openConfirm(message: string, action: () => void): void {
    this.pendingConfirm = action;
    this.menu.hidden = true;
    this.confirm.hidden = false;
    const kind = this.input.activeKind;
    this.confirm.textContent =
      `${message} ${getButtonLabel('menuConfirm', kind)} はい / ` +
      `${getButtonLabel('menuCancel', kind)} いいえ`;
    this.navigator.resetEdges();
  }

  private closeConfirm(): void {
    this.pendingConfirm = null;
    this.menu.hidden = false;
    this.confirm.hidden = true;
    this.navigator.resetEdges();
    this.rebuildActions();
  }

  private renderHints(): void {
    const kind = this.input.activeKind;
    this.hints.textContent =
      `${getButtonLabel('menuConfirm', kind)} 決定 / ` +
      `${getButtonLabel('menuCancel', kind)} 戻る`;
  }
}
