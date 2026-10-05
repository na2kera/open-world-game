/** High level mode of the game. Only `playing` runs the simulation. */
export type GameMode = 'title' | 'playing' | 'paused' | 'menu' | 'dialog';

/** Allowed transitions; anything not listed is rejected. */
const TRANSITIONS: Readonly<Record<GameMode, readonly GameMode[]>> = {
  title: ['playing'],
  playing: ['paused', 'menu', 'dialog', 'title'],
  paused: ['playing', 'title'],
  menu: ['playing', 'title'],
  dialog: ['playing', 'title'],
};

/** Callback invoked after a successful mode change. */
export type ModeChangeListener = (from: GameMode, to: GameMode) => void;

/** Minimal state machine over {@link GameMode}. */
export class GameState {
  private current: GameMode;

  constructor(
    initial: GameMode = 'playing',
    private readonly onChange?: ModeChangeListener,
  ) {
    this.current = initial;
  }

  get mode(): GameMode {
    return this.current;
  }

  /** True while gameplay simulation should advance. */
  get isSimulating(): boolean {
    return this.current === 'playing';
  }

  canTransition(to: GameMode): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  /** Switches to `to` if the transition is allowed. Returns whether the mode changed. */
  set(to: GameMode): boolean {
    if (to === this.current || !this.canTransition(to)) return false;
    const from = this.current;
    this.current = to;
    this.onChange?.(from, to);
    return true;
  }

  /** Toggles between `playing` and `paused`. */
  togglePause(): boolean {
    if (this.current === 'playing') return this.set('paused');
    if (this.current === 'paused') return this.set('playing');
    return false;
  }
}
