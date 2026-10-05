/**
 * Something the {@link Game} loop drives every tick.
 *
 * - `update` runs at the fixed simulation rate and only while the game is simulating.
 * - `frameUpdate` runs once per rendered frame (also while paused) and is meant for visuals:
 *   interpolation, camera, streaming, HUD. `alpha` is the fixed-step interpolation factor (0..1).
 */
export interface System {
  update?(dt: number): void;
  frameUpdate?(frameDt: number, alpha: number): void;
  dispose?(): void;
}
