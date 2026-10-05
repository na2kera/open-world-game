import type { GameMode } from './GameState';

/** Plain 3D position payload (copied, safe to keep). */
export interface PositionPayload {
  x: number;
  y: number;
  z: number;
}

/** Every event the game emits, keyed by name. Extend this as new systems are added. */
export interface GameEvents {
  'state:changed': { from: GameMode; to: GameMode };
}
