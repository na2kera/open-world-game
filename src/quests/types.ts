export type QuestType = 'main' | 'side';

export type QuestStatus = 'locked' | 'available' | 'active' | 'readyToTurnIn' | 'completed';

export type QuestObjective =
  | {
      readonly kind: 'collect';
      readonly itemId: string;
      readonly count: number;
      readonly label: string;
    }
  | {
      readonly kind: 'kill';
      readonly enemyDefId: string;
      readonly count: number;
      readonly label: string;
    }
  | { readonly kind: 'clearCamps'; readonly count: number; readonly label: string }
  | { readonly kind: 'talk'; readonly npcId: string; readonly label: string }
  | { readonly kind: 'reach'; readonly locationId: string; readonly label: string }
  | { readonly kind: 'activateTower'; readonly towerId: string; readonly label: string }
  | { readonly kind: 'defeatBoss'; readonly bossId: string; readonly label: string };

export interface QuestReward {
  readonly items?: readonly { readonly itemId: string; readonly count: number }[];
  readonly maxHp?: number;
  readonly maxStamina?: number;
}

export interface QuestDef {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly type: QuestType;
  readonly giverNpcId: string;
  /** When true, only the first unfinished objective accepts progress. */
  readonly sequential: boolean;
  /** When true, finishing the objectives waits for the giver instead of completing. */
  readonly turnIn: boolean;
  readonly requiresCompleted?: readonly string[];
  readonly objectives: readonly QuestObjective[];
  readonly reward?: QuestReward;
}

export type QuestEvent =
  | { readonly type: 'collect'; readonly itemId: string; readonly owned: number }
  | { readonly type: 'kill'; readonly enemyDefId: string }
  | { readonly type: 'clearCamps' }
  | { readonly type: 'talk'; readonly npcId: string }
  | { readonly type: 'reach'; readonly locationId: string }
  | { readonly type: 'activateTower'; readonly towerId: string }
  | { readonly type: 'defeatBoss'; readonly bossId: string };

export interface QuestChange {
  readonly type: 'started' | 'progress' | 'ready' | 'completed';
  readonly questId: string;
  readonly reward?: QuestReward;
  readonly remove: readonly { readonly itemId: string; readonly count: number }[];
}
