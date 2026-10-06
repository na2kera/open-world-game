export interface NpcDef {
  readonly id: string;
  readonly name: string;
  /** Offset from the village spawn, in world units. */
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly color: number;
  readonly scale: number;
  readonly hat: number;
}

export const NPC_DEFS: readonly NpcDef[] = [
  {
    id: 'iori',
    name: 'イオリ',
    offsetX: 0,
    offsetZ: 8,
    color: 0xc4553a,
    scale: 1.05,
    hat: 0xf2d276,
  },
  {
    id: 'mira',
    name: 'ミラ',
    offsetX: -9,
    offsetZ: 3,
    color: 0x3d8b6e,
    scale: 0.96,
    hat: 0xf4efe2,
  },
  {
    id: 'sora',
    name: 'ソラ',
    offsetX: 8,
    offsetZ: -2,
    color: 0x3a5f8a,
    scale: 1.02,
    hat: 0x6d5133,
  },
  {
    id: 'rin',
    name: 'リン',
    offsetX: -4,
    offsetZ: -9,
    color: 0xd37a3a,
    scale: 0.78,
    hat: 0xf0c341,
  },
];
