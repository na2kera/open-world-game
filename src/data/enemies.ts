import type { ItemId } from './items';
import type { Rng } from '../utils/random';

export type EnemyState =
  'idle' | 'patrol' | 'chase' | 'windup' | 'attack' | 'recover' | 'hurt' | 'dead';

export interface EnemyDrop {
  readonly itemId: ItemId;
  readonly chance: number;
  readonly min: number;
  readonly max: number;
}

export interface EnemyDef {
  readonly id: string;
  readonly name: string;
  readonly hp: number;
  /** Damage in quarter hearts. */
  readonly attack: number;
  readonly speed: number;
  readonly aggroRadius: number;
  readonly attackRange: number;
  readonly attackCooldown: number;
  readonly drops: readonly EnemyDrop[];
  readonly appearance: {
    readonly color: number;
    readonly accent: number;
    readonly scale: number;
    readonly floating?: boolean;
  };
  readonly boss?: boolean;
}

export const ENEMY_DEFS = [
  {
    id: 'bokoblin-red',
    name: 'ボコブリン',
    hp: 6,
    attack: 2,
    speed: 3.4,
    aggroRadius: 14,
    attackRange: 1.65,
    attackCooldown: 1.1,
    drops: [
      { itemId: 'bokoblin-horn', chance: 0.8, min: 1, max: 1 },
      { itemId: 'apple', chance: 0.22, min: 1, max: 1 },
      { itemId: 'bokoblin-club', chance: 0.1, min: 1, max: 1 },
    ],
    appearance: { color: 0xa93f32, accent: 0xe4b07e, scale: 1 },
  },
  {
    id: 'bokoblin-blue',
    name: '青ボコブリン',
    hp: 13,
    attack: 4,
    speed: 3.8,
    aggroRadius: 18,
    attackRange: 1.8,
    attackCooldown: 0.9,
    drops: [
      { itemId: 'bokoblin-horn', chance: 1, min: 1, max: 2 },
      { itemId: 'rock-salt', chance: 0.3, min: 1, max: 2 },
      { itemId: 'traveler-sword', chance: 0.08, min: 1, max: 1 },
    ],
    appearance: { color: 0x3768a8, accent: 0xbad5e8, scale: 1.12 },
  },
  {
    id: 'night-wisp',
    name: '夜のキース',
    hp: 4,
    attack: 2,
    speed: 6.2,
    aggroRadius: 24,
    attackRange: 1.4,
    attackCooldown: 1.4,
    drops: [
      { itemId: 'bokoblin-horn', chance: 0.4, min: 1, max: 1 },
      { itemId: 'ancient-gear', chance: 0.05, min: 1, max: 1 },
    ],
    appearance: { color: 0x6b4aa5, accent: 0xcfb6ff, scale: 0.78, floating: true },
  },
] as const satisfies readonly EnemyDef[];

const ENEMY_BY_ID = new Map<string, EnemyDef>(ENEMY_DEFS.map((enemy) => [enemy.id, enemy]));

export interface RolledDrop {
  readonly itemId: ItemId;
  readonly count: number;
}

export function getEnemyDef(defId: string): EnemyDef | undefined {
  return ENEMY_BY_ID.get(defId);
}

/** Independently rolls each table row with the supplied deterministic RNG. */
export function rollDrops(drops: readonly EnemyDrop[], rng: Rng): RolledDrop[] {
  const result: RolledDrop[] = [];
  for (const drop of drops) {
    if (rng() >= drop.chance) continue;
    const count = drop.min + Math.floor(rng() * (drop.max - drop.min + 1));
    result.push({ itemId: drop.itemId, count });
  }
  return result;
}
