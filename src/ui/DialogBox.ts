import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import { DialogCursor, type DialogEffect, type DialogScript } from '../dialog/DialogRuntime';
import { getButtonLabel } from '../input/buttonLabels';
import type { InputManager } from '../input/InputManager';

const CHARACTERS_PER_SECOND = 42;

export type DialogListener = (effects: readonly DialogEffect[]) => void;

/** Bottom-of-screen conversation. A reveals the line, then advances. */
export class DialogBox implements System {
  readonly element = document.createElement('div');
  private readonly speaker = document.createElement('div');
  private readonly body = document.createElement('p');
  private readonly choices = document.createElement('div');
  private readonly hint = document.createElement('div');
  private cursor: DialogCursor | null = null;
  private onDone: DialogListener | null = null;
  private revealed = 0;
  private choiceIndex = 0;
  private confirmWasHeld = false;
  private upWasHeld = false;
  private downWasHeld = false;
  private readonly pendingEffects: DialogEffect[] = [];

  constructor(
    container: HTMLElement,
    private readonly state: GameState,
    private readonly input: InputManager,
  ) {
    this.element.className = 'dialog-box';
    this.element.hidden = true;
    this.speaker.className = 'dialog-speaker';
    this.body.className = 'dialog-body';
    this.choices.className = 'dialog-choices';
    this.hint.className = 'dialog-hint';
    this.element.append(this.speaker, this.body, this.choices, this.hint);
    container.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.cursor !== null;
  }

  play(script: DialogScript, onDone: DialogListener): void {
    if (this.cursor) return;
    this.state.set('dialog');
    this.cursor = new DialogCursor(script);
    this.onDone = onDone;
    this.revealed = 0;
    this.choiceIndex = 0;
    const buttons = this.input.state.buttons;
    this.confirmWasHeld = buttons.menuConfirm.held || buttons.interact.held;
    this.upWasHeld = buttons.menuUp.held;
    this.downWasHeld = buttons.menuDown.held;
    this.pendingEffects.length = 0;
    this.pendingEffects.push(...this.cursor.effects);
    this.element.hidden = false;
    this.render(false);
  }

  frameUpdate(frameDt: number): void {
    const cursor = this.cursor;
    if (!cursor) return;
    const text = cursor.node.text;
    const wasFull = this.revealed >= text.length;
    this.revealed += frameDt * CHARACTERS_PER_SECOND;
    const full = this.revealed >= text.length;
    if (full !== wasFull) this.render(full);
    const buttons = this.input.state.buttons;
    const confirmHeld = buttons.menuConfirm.held || buttons.interact.held;
    const confirm = confirmHeld && !this.confirmWasHeld;
    this.confirmWasHeld = confirmHeld;
    const choices = cursor.node.choices ?? [];
    if (!full) {
      if (confirm) {
        this.revealed = text.length;
        this.render(true);
      }
      return;
    }
    if (choices.length > 0) {
      if (buttons.menuUp.held && !this.upWasHeld) {
        this.choiceIndex = (this.choiceIndex - 1 + choices.length) % choices.length;
      }
      if (buttons.menuDown.held && !this.downWasHeld) {
        this.choiceIndex = (this.choiceIndex + 1) % choices.length;
      }
    }
    this.upWasHeld = buttons.menuUp.held;
    this.downWasHeld = buttons.menuDown.held;
    if (!confirm) return;
    const step = cursor.advance(this.choiceIndex);
    if (!step) {
      this.finish();
      return;
    }
    this.pendingEffects.push(...step.effects);
    this.revealed = 0;
    this.choiceIndex = 0;
    this.render(false);
  }

  dispose(): void {
    this.element.remove();
  }

  private finish(): void {
    const done = this.onDone;
    const effects = [...this.pendingEffects];
    this.cursor = null;
    this.onDone = null;
    this.element.hidden = true;
    this.state.set('playing');
    done?.(effects);
  }

  private render(full: boolean): void {
    const cursor = this.cursor;
    if (!cursor) return;
    const node = cursor.node;
    this.speaker.textContent = node.speaker;
    this.speaker.hidden = node.speaker.length === 0;
    const count = Math.max(0, Math.min(node.text.length, Math.floor(this.revealed)));
    this.body.textContent = node.text.slice(0, count);
    const options = full ? (node.choices ?? []) : [];
    this.choices.replaceChildren(
      ...options.map((choice, index) => {
        const row = document.createElement('div');
        row.className = 'dialog-choice';
        row.classList.toggle('is-selected', index === this.choiceIndex);
        row.textContent = choice.label;
        return row;
      }),
    );
    const kind = this.input.activeKind;
    this.hint.textContent = full
      ? `${getButtonLabel('menuConfirm', kind)} 次へ`
      : `${getButtonLabel('menuConfirm', kind)} 全文`;
  }
}
