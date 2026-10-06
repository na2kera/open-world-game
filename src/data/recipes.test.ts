import { describe, expect, it } from 'vitest';

import { availableRecipes } from './recipes';

describe('availableRecipes', () => {
  it('offers only dishes the inventory can pay for', () => {
    const stock = new Map<string, number>([
      ['apple', 1],
      ['herb', 2],
    ]);
    const names = availableRecipes((itemId, count) => (stock.get(itemId) ?? 0) >= count).map(
      (recipe) => recipe.id,
    );
    expect(names).toEqual(['bake-apple']);
  });
});
