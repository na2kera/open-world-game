import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../utils/random';
import { getEnemyDef, rollDrops } from './enemies';

describe('rollDrops', () => {
  it('is deterministic with a seeded RNG', () => {
    const def = getEnemyDef('bokoblin-blue');
    expect(def).toBeDefined();
    const a = rollDrops(def?.drops ?? [], mulberry32(1234));
    const b = rollDrops(def?.drops ?? [], mulberry32(1234));
    expect(a).toEqual(b);
  });

  it('honours guaranteed and impossible probabilities', () => {
    const drops = [
      { itemId: 'apple', chance: 1, min: 2, max: 2 },
      { itemId: 'herb', chance: 0, min: 1, max: 1 },
    ] as const;
    expect(rollDrops(drops, mulberry32(1))).toEqual([{ itemId: 'apple', count: 2 }]);
  });
});
