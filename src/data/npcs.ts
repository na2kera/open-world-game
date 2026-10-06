import type { HairStyle, PersonBuild } from '../entities/figure';

export interface NpcDef {
  readonly id: string;
  readonly name: string;
  /** Offset from the village spawn, in world units. */
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly color: number;
  readonly scale: number;
  readonly hat?: number | undefined;
  readonly hairStyle?: HairStyle;
  /** Hair colour. */
  readonly hair?: number;
  readonly build?: PersonBuild;
  /** Collar / hem / hat band colour. */
  readonly trim?: number;
  /** Upper-arm colour. */
  readonly sleeves?: number;
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
    hairStyle: 'short',
    hair: 0xb8b2a8,
    build: 'stout',
    trim: 0xe9c46a,
    sleeves: 0x9c3f2a,
  },
  {
    id: 'mira',
    name: 'ミラ',
    offsetX: -9,
    offsetZ: 3,
    color: 0x3d8b6e,
    scale: 0.96,
    hairStyle: 'long',
    hair: 0x3b2a20,
    build: 'slim',
    trim: 0xf1e3c2,
  },
  {
    id: 'sora',
    name: 'ソラ',
    offsetX: 8,
    offsetZ: -2,
    color: 0x3a5f8a,
    scale: 1.02,
    hat: 0x6d5133,
    hairStyle: 'ponytail',
    hair: 0x1c1a1f,
    build: 'average',
    trim: 0xc9b98f,
    sleeves: 0x2c4a6e,
  },
  {
    id: 'rin',
    name: 'リン',
    offsetX: -4,
    offsetZ: -9,
    color: 0xd37a3a,
    scale: 0.78,
    hairStyle: 'bob',
    hair: 0x7a4426,
    build: 'average',
    trim: 0xf6e7c8,
  },
];
