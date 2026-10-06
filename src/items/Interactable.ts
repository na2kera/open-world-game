import type { Vec3Like } from '../world/Terrain';

/** Generic world interaction contract shared by pickups, chests and future NPCs. */
export interface Interactable {
  readonly position: Readonly<Vec3Like>;
  readonly radius: number;
  readonly promptLabel: string;
  isAvailable(): boolean;
  interact(): void;
}
