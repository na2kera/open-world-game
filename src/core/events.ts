import type { ControllerKind } from '../input/types';
import type { DamageCause, MovementState } from '../player/types';
import type { EnemyState } from '../data/enemies';
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
  'input:gamepadConnected': { index: number; id: string; kind: ControllerKind };
  'input:gamepadDisconnected': { index: number; id: string; kind: ControllerKind };
  'input:activeKindChanged': { kind: ControllerKind };
  'player:stateChanged': { from: MovementState; to: MovementState };
  'player:jumped': { position: PositionPayload };
  'player:landed': { position: PositionPayload; fallHeight: number };
  /** Attack button pressed (combat logic is added in a later phase). */
  'player:attack': { position: PositionPayload; facing: number };
  /** Dodge button pressed (combat logic is added in a later phase). */
  'player:dodge': { position: PositionPayload; facing: number };
  'player:interact': { position: PositionPayload; facing: number };
  'player:damaged': { amount: number; hp: number; cause: DamageCause };
  'player:died': { position: PositionPayload };
  'player:respawned': { position: PositionPayload; reason: 'drowned' | 'died' };
  'inventory:changed': { itemId: string; count: number; total: number };
  'item:acquired': { itemId: string; count: number };
  'item:consumed': { itemId: string };
  'weapon:equipped': { itemId: string | null };
  'weapon:broken': { itemId: string };
  'chest:opened': { chestId: string; itemId: string };
  'enemy:spotted': { enemyId: string; defId: string };
  'enemy:stateChanged': { enemyId: string; from: EnemyState; to: EnemyState };
  'enemy:damaged': { enemyId: string; defId: string; amount: number; hp: number };
  'enemy:killed': { enemyId: string; defId: string; position: PositionPayload };
  'camp:cleared': { campId: string };
  'save:started': undefined;
  'save:completed': { reason: 'auto' | 'manual' };
  'save:loaded': undefined;
  'quest:started': { questId: string };
  'quest:progress': { questId: string };
  'quest:readyToTurnIn': { questId: string };
  'quest:completed': { questId: string };
  'tower:activated': { towerId: string };
  'boss:defeated': { bossId: string };
  'story:chapter': { chapterId: string };
}
