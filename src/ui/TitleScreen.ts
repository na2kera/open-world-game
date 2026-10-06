import './menu.css';

import { Vector3, type PerspectiveCamera } from 'three';

import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import { getButtonLabel } from '../input/buttonLabels';
import type { InputManager } from '../input/InputManager';
import type { SaveManager } from '../save/SaveManager';
import type { Vec3Like } from '../world/Terrain';
import { MenuNavigator, readMenuInput } from './MenuNavigator';

interface TitleAction {
  readonly label: string;
  readonly run: () => void;
}

const tmpLook = new Vector3();

/** Opening title menu over a slow orbit of the loaded procedural world. */
export class TitleScreen implements System {
  readonly element = document.createElement('div');
  private readonly menu = document.createElement('div');
  private readonly prompt = document.createElement('div');
  private readonly help = document.createElement('div');
  private readonly confirm = document.createElement('div');
  private readonly navigator = new MenuNavigator();
  private actions: readonly TitleAction[] = [];
  private readonly logoTitle: HTMLHeadingElement;
  private orbitTime = 0;
  private inHelp = false;
  private confirmingNewGame = false;
  private wasVisible = false;

  constructor(
    container: HTMLElement,
    private readonly state: GameState,
    private readonly input: InputManager,
    private readonly camera: PerspectiveCamera,
    private readonly centre: Readonly<Vec3Like>,
    private readonly saves: SaveManager,
    private readonly startNewGame: () => void,
    private readonly continueGame: () => void,
  ) {
    this.element.className = 'title-screen';
    const logo = document.createElement('div');
    logo.className = 'title-logo';
    const title = document.createElement('h1');
    title.textContent = 'Wildlands';
    this.logoTitle = title;
    const subtitle = document.createElement('p');
    subtitle.textContent = '― 広大な大地を、自由に。';
    logo.append(title, subtitle);
    this.menu.className = 'title-menu';
    this.prompt.className = 'title-input-prompt';
    this.prompt.textContent = 'コントローラーのボタンを押してください / キーボードでも操作できます';
    this.help.className = 'controls-help';
    this.help.hidden = true;
    this.confirm.className = 'menu-confirm';
    this.confirm.hidden = true;
    this.element.append(logo, this.menu, this.prompt, this.help, this.confirm);
    container.appendChild(this.element);
    this.rebuildActions();
  }

  frameUpdate(frameDt: number): void {
    const visible = this.state.mode === 'title';
    this.element.hidden = !visible;
    if (!visible) {
      this.wasVisible = false;
      return;
    }
    if (!this.wasVisible) {
      this.wasVisible = true;
      this.rebuildActions();
      this.refreshLogo();
      this.navigator.resetEdges();
    }
    this.orbitTime += frameDt;
    this.updateCamera();
    this.prompt.hidden = this.input.hasReceivedInput;

    const result = this.navigator.update(frameDt, readMenuInput(this.input.state));
    if (this.inHelp) {
      if (result.cancelled || result.confirmed) this.closeHelp();
      return;
    }
    if (this.confirmingNewGame) {
      if (result.cancelled) this.closeConfirm();
      if (result.confirmed) {
        this.saves.clear();
        this.closeConfirm();
        this.startNewGame();
      }
      return;
    }
    if (result.moved) this.renderSelection();
    if (result.confirmed) this.actions[this.navigator.index]?.run();
  }

  dispose(): void {
    this.element.remove();
  }

  private rebuildActions(): void {
    const actions: TitleAction[] = [
      {
        label: 'はじめから',
        run: () => {
          if (this.saves.hasSave()) this.openConfirm();
          else this.startNewGame();
        },
      },
    ];
    if (this.saves.hasSave()) {
      actions.push({ label: 'つづきから', run: this.continueGame });
    }
    actions.push({ label: '操作説明', run: () => this.openHelp() });
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

  private refreshLogo(): void {
    const flags = this.saves.load()?.story.flags;
    const cleared = flags?.includes('ending') ?? false;
    this.logoTitle.textContent = cleared ? 'Wildlands ★' : 'Wildlands';
  }

  private renderSelection(): void {
    this.menu.querySelectorAll('button').forEach((button, index) => {
      button.classList.toggle('is-selected', index === this.navigator.index);
    });
  }

  private updateCamera(): void {
    const radius = 44;
    const angle = this.orbitTime * 0.055;
    this.camera.position.set(
      this.centre.x + Math.cos(angle) * radius,
      this.centre.y + 18,
      this.centre.z + Math.sin(angle) * radius,
    );
    tmpLook.set(this.centre.x, this.centre.y + 4, this.centre.z);
    this.camera.lookAt(tmpLook);
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

  private openConfirm(): void {
    this.confirmingNewGame = true;
    this.menu.hidden = true;
    this.confirm.hidden = false;
    const kind = this.input.activeKind;
    this.confirm.textContent =
      `セーブデータを消して、はじめから遊びますか？ ` +
      `${getButtonLabel('menuConfirm', kind)} はい / ` +
      `${getButtonLabel('menuCancel', kind)} いいえ`;
    this.navigator.resetEdges();
  }

  private closeConfirm(): void {
    this.confirmingNewGame = false;
    this.menu.hidden = false;
    this.confirm.hidden = true;
    this.navigator.resetEdges();
    this.rebuildActions();
  }
}

export function controlsHelpMarkup(): string {
  return `
    <h2>操作説明</h2>
    <div class="controls-columns">
      <section><h3>Switch Pro</h3>
        <p>左スティック: 移動</p><p>右スティック: カメラ</p>
        <p>Y: 攻撃</p><p>X: ジャンプ</p><p>A: 調べる</p>
        <p>B: 回避 / 長押しでダッシュ</p><p>ZL: 注目</p>
        <p>−: 所持品</p><p>＋: ポーズ（手帳・マップ）</p>
      </section>
      <section><h3>キーボード / マウス</h3>
        <p>WASD: 移動</p><p>マウス: カメラ</p>
        <p>左クリック: 攻撃</p><p>Space: ジャンプ</p><p>E: 調べる</p>
        <p>Ctrl: 回避 / Shift: ダッシュ</p><p>右クリック: 注目</p>
        <p>Tab / I: 所持品</p><p>Esc: ポーズ（手帳・マップ）</p>
      </section>
    </div>
    <p class="menu-hints">A / Enter 決定 / B / Backspace 戻る</p>`;
}
