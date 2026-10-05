import { MENU_CONFIG } from '../config';
import type { InputState } from '../input/types';

export interface MenuNavigationInput {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly confirm: boolean;
  readonly cancel: boolean;
}

export interface MenuNavigationResult {
  readonly moved: boolean;
  readonly confirmed: boolean;
  readonly cancelled: boolean;
}

type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

/**
 * Shared list/grid navigation with held-input repeat. It consumes booleans rather than DOM or
 * Three objects so title, pause and inventory screens can share it and node tests can cover it.
 */
export class MenuNavigator {
  index = 0;
  private itemCount = 0;
  private columns = 1;
  private readonly wasHeld: Record<Direction, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false,
  };
  private readonly heldTime: Record<Direction, number> = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
  };
  private readonly lastRepeat: Record<Direction, number> = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
  };
  private confirmHeld = false;
  private cancelHeld = false;

  constructor(itemCount = 0, columns = 1) {
    this.configure(itemCount, columns);
  }

  configure(itemCount: number, columns = 1): void {
    this.itemCount = Math.max(0, Math.floor(itemCount));
    this.columns = Math.max(1, Math.floor(columns));
    this.index = Math.min(this.index, Math.max(0, this.itemCount - 1));
  }

  setIndex(index: number): void {
    this.index = Math.min(Math.max(0, Math.floor(index)), Math.max(0, this.itemCount - 1));
  }

  resetEdges(): void {
    for (const direction of DIRECTIONS) {
      this.wasHeld[direction] = false;
      this.heldTime[direction] = 0;
      this.lastRepeat[direction] = 0;
    }
    this.confirmHeld = false;
    this.cancelHeld = false;
  }

  update(dt: number, input: MenuNavigationInput): MenuNavigationResult {
    let moved = false;
    for (const direction of DIRECTIONS) {
      if (this.shouldMove(direction, input[direction], dt)) {
        moved = this.move(direction) || moved;
      }
    }
    const confirmed = input.confirm && !this.confirmHeld;
    const cancelled = input.cancel && !this.cancelHeld;
    this.confirmHeld = input.confirm;
    this.cancelHeld = input.cancel;
    return { moved, confirmed, cancelled };
  }

  private shouldMove(direction: Direction, held: boolean, dt: number): boolean {
    const wasHeld = this.wasHeld[direction];
    this.wasHeld[direction] = held;
    if (!held) {
      this.heldTime[direction] = 0;
      this.lastRepeat[direction] = 0;
      return false;
    }
    if (!wasHeld) return true;
    this.heldTime[direction] += dt;
    if (this.heldTime[direction] < MENU_CONFIG.repeatDelay) return false;
    if (this.heldTime[direction] - this.lastRepeat[direction] < MENU_CONFIG.repeatInterval) {
      return false;
    }
    this.lastRepeat[direction] = this.heldTime[direction];
    return true;
  }

  private move(direction: Direction): boolean {
    if (this.itemCount <= 1) return false;
    const before = this.index;
    if (this.columns === 1) {
      if (direction === 'up') this.index = (this.index - 1 + this.itemCount) % this.itemCount;
      if (direction === 'down') this.index = (this.index + 1) % this.itemCount;
      return before !== this.index;
    }

    const row = Math.floor(this.index / this.columns);
    const column = this.index % this.columns;
    const rows = Math.ceil(this.itemCount / this.columns);
    if (direction === 'left') {
      this.index = Math.max(row * this.columns, this.index - 1);
    } else if (direction === 'right') {
      this.index = Math.min(
        this.itemCount - 1,
        Math.min((row + 1) * this.columns - 1, this.index + 1),
      );
    } else {
      const targetRow = direction === 'up' ? (row - 1 + rows) % rows : (row + 1) % rows;
      this.index = Math.min(targetRow * this.columns + column, this.itemCount - 1);
    }
    return before !== this.index;
  }
}

/** Converts D-pad/buttons plus the left stick into repeat-friendly digital menu input. */
export function readMenuInput(input: InputState): MenuNavigationInput {
  const buttons = input.buttons;
  return {
    up: buttons.menuUp.held || input.move.y >= MENU_CONFIG.stickThreshold,
    down: buttons.menuDown.held || input.move.y <= -MENU_CONFIG.stickThreshold,
    left: buttons.menuLeft.held || input.move.x <= -MENU_CONFIG.stickThreshold,
    right: buttons.menuRight.held || input.move.x >= MENU_CONFIG.stickThreshold,
    confirm: buttons.menuConfirm.held,
    cancel: buttons.menuCancel.held,
  };
}
