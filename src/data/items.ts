export type ItemCategory = 'material' | 'food' | 'weapon' | 'key' | 'rune';

export type ItemIconShape = 'leaf' | 'mushroom' | 'fruit' | 'crystal' | 'horn' | 'sword' | 'gear';

interface ItemDefBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ItemCategory;
  readonly stackable: boolean;
  readonly maxStack: number;
  readonly icon: {
    readonly color: string;
    readonly shape: ItemIconShape;
  };
}

export interface MaterialItemDef extends ItemDefBase {
  readonly category: 'material';
}

export interface FoodItemDef extends ItemDefBase {
  readonly category: 'food';
  /** Health restored in quarter hearts. */
  readonly healQuarters: number;
}

export interface WeaponItemDef extends ItemDefBase {
  readonly category: 'weapon';
  readonly attack: number;
  readonly durability?: number;
}

export interface KeyItemDef extends ItemDefBase {
  readonly category: 'key' | 'rune';
}

export type ItemDef = MaterialItemDef | FoodItemDef | WeaponItemDef | KeyItemDef;

export const ITEM_DEFS = [
  {
    id: 'herb',
    name: '薬草',
    description: '草原に生える香りのよい薬草。料理や調合に使える。',
    category: 'material',
    stackable: true,
    maxStack: 99,
    icon: { color: '#79c85a', shape: 'leaf' },
  },
  {
    id: 'hylian-herb',
    name: 'ハイラル草',
    description: '生命力を秘めた野草。そのまま食べても体力が少し回復する。',
    category: 'food',
    stackable: true,
    maxStack: 99,
    healQuarters: 2,
    icon: { color: '#54b95b', shape: 'leaf' },
  },
  {
    id: 'mushroom',
    name: '森のキノコ',
    description: '木陰を好む肉厚のキノコ。',
    category: 'material',
    stackable: true,
    maxStack: 99,
    icon: { color: '#d35b54', shape: 'mushroom' },
  },
  {
    id: 'acorn',
    name: '木の実',
    description: '森で拾える小さな木の実。香ばしい風味がある。',
    category: 'material',
    stackable: true,
    maxStack: 99,
    icon: { color: '#9b6535', shape: 'fruit' },
  },
  {
    id: 'rock-salt',
    name: '岩塩',
    description: '山肌から採れる結晶。料理の味を引き立てる。',
    category: 'material',
    stackable: true,
    maxStack: 99,
    icon: { color: '#d8d4e5', shape: 'crystal' },
  },
  {
    id: 'bokoblin-horn',
    name: 'ボコブリンの角',
    description: '魔物から取れた硬い角。薬の材料になる。',
    category: 'material',
    stackable: true,
    maxStack: 99,
    icon: { color: '#e9d7a3', shape: 'horn' },
  },
  {
    id: 'apple',
    name: 'リンゴ',
    description: '甘くみずみずしい果実。体力を少し回復する。',
    category: 'food',
    stackable: true,
    maxStack: 99,
    healQuarters: 1,
    icon: { color: '#db3e36', shape: 'fruit' },
  },
  {
    id: 'baked-apple',
    name: '焼きリンゴ',
    description: '火で焼いて甘みが増したリンゴ。',
    category: 'food',
    stackable: true,
    maxStack: 99,
    healQuarters: 3,
    icon: { color: '#d97832', shape: 'fruit' },
  },
  {
    id: 'wooden-stick',
    name: '木の棒',
    description: '拾った枝をそのまま武器にしたもの。あまり丈夫ではない。',
    category: 'weapon',
    stackable: false,
    maxStack: 1,
    attack: 2,
    durability: 12,
    icon: { color: '#8b5a2f', shape: 'sword' },
  },
  {
    id: 'traveler-sword',
    name: '旅人の剣',
    description: '旅人が護身用に携える扱いやすい剣。',
    category: 'weapon',
    stackable: false,
    maxStack: 1,
    attack: 4,
    durability: 28,
    icon: { color: '#9aa8b8', shape: 'sword' },
  },
  {
    id: 'knight-sword',
    name: '騎士の剣',
    description: '王国の騎士が使った重厚な剣。',
    category: 'weapon',
    stackable: false,
    maxStack: 1,
    attack: 7,
    durability: 42,
    icon: { color: '#d9e2ec', shape: 'sword' },
  },
  {
    id: 'bokoblin-club',
    name: 'ボコブリンの棍棒',
    description: '太い枝を削って作られた魔物の武器。',
    category: 'weapon',
    stackable: false,
    maxStack: 1,
    attack: 3,
    durability: 18,
    icon: { color: '#6d4126', shape: 'sword' },
  },
  {
    id: 'ancient-gear',
    name: '古代の歯車',
    description: '失われた文明の機械部品。精巧で今も微かに光っている。',
    category: 'key',
    stackable: true,
    maxStack: 20,
    icon: { color: '#57d4d1', shape: 'gear' },
  },
] as const satisfies readonly ItemDef[];

export type ItemId = (typeof ITEM_DEFS)[number]['id'];

const ITEM_BY_ID = new Map<string, ItemDef>(ITEM_DEFS.map((item) => [item.id, item]));

export function getItemDef(itemId: string): ItemDef | undefined {
  return ITEM_BY_ID.get(itemId);
}

export function isItemId(value: string): value is ItemId {
  return ITEM_BY_ID.has(value);
}
