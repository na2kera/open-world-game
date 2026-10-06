import type { ItemId } from './items';

export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly ingredients: readonly { readonly itemId: ItemId; readonly count: number }[];
  readonly result: ItemId;
  readonly count: number;
}

export const RECIPES: readonly Recipe[] = [
  {
    id: 'bake-apple',
    name: '焼きリンゴ',
    ingredients: [{ itemId: 'apple', count: 1 }],
    result: 'baked-apple',
    count: 1,
  },
  {
    id: 'toast-mushroom',
    name: '焼きキノコ',
    ingredients: [{ itemId: 'mushroom', count: 1 }],
    result: 'toasted-mushroom',
    count: 1,
  },
  {
    id: 'herb-soup',
    name: '薬草の煮込み',
    ingredients: [
      { itemId: 'herb', count: 1 },
      { itemId: 'mushroom', count: 1 },
    ],
    result: 'herb-soup',
    count: 1,
  },
];

/** Recipes whose ingredients are all in hand. */
export function availableRecipes(
  has: (itemId: string, count: number) => boolean,
): readonly Recipe[] {
  return RECIPES.filter((recipe) =>
    recipe.ingredients.every((ingredient) => has(ingredient.itemId, ingredient.count)),
  );
}
