import { isInventoryData, type InventoryData } from '../items/Inventory';

export const SAVE_VERSION = 1;

export interface SavedPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlayerSaveData {
  readonly position: SavedPosition;
  readonly hp: number;
  readonly maxHp: number;
  readonly maxStamina: number;
}

export interface ClearedCampSaveData {
  readonly campId: string;
  readonly clearedAtDay: number;
}

export interface QuestProgressSave {
  readonly id: string;
  readonly counts: readonly number[];
}

/** Quest section. Older saves may only contain the reserved id lists. */
export interface QuestSaveData {
  readonly active?: readonly string[];
  readonly completed?: readonly string[];
  readonly started?: readonly QuestProgressSave[];
  readonly trackedId?: string;
}

/** Story section. Added fields stay optional so existing saves still load. */
export interface StorySaveData {
  readonly chapterId?: string;
  readonly flags?: readonly string[];
  readonly towers?: readonly string[];
  readonly respawn?: SavedPosition;
}

export interface SaveData {
  readonly version: typeof SAVE_VERSION;
  readonly seed: number;
  readonly player: PlayerSaveData;
  readonly inventory: InventoryData;
  readonly equippedWeapon: string | null;
  readonly timeOfDay: number;
  readonly day: number;
  readonly collectedItemIds: readonly string[];
  readonly openedChestIds: readonly string[];
  readonly clearedCamps: readonly ClearedCampSaveData[];
  readonly quests: QuestSaveData;
  readonly story: StorySaveData;
}

export function serializeSaveData(data: SaveData): string {
  return JSON.stringify(data);
}

export function deserializeSaveData(serialized: string): SaveData | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
  return isSaveData(value) ? value : null;
}

export function isSaveData(value: unknown): value is SaveData {
  if (!isRecord(value) || value['version'] !== SAVE_VERSION) return false;
  const player = value['player'];
  if (!isRecord(player) || !isPosition(player['position'])) return false;
  if (
    !isPositiveFinite(player['maxHp']) ||
    !isPositiveFinite(player['maxStamina']) ||
    !isNonNegativeFinite(player['hp']) ||
    (player['hp'] as number) > (player['maxHp'] as number)
  ) {
    return false;
  }
  if (!Number.isInteger(value['seed'])) return false;
  if (!isInventoryData(value['inventory'])) return false;
  const equipped = value['equippedWeapon'];
  if (equipped !== null && typeof equipped !== 'string') return false;
  if (equipped !== value['inventory'].equippedWeapon) return false;
  if (
    !isNonNegativeFinite(value['timeOfDay']) ||
    (value['timeOfDay'] as number) >= 1 ||
    !isNonNegativeFinite(value['day'])
  ) {
    return false;
  }
  if (!isStringArray(value['collectedItemIds']) || !isStringArray(value['openedChestIds'])) {
    return false;
  }
  const camps = value['clearedCamps'];
  if (
    !Array.isArray(camps) ||
    camps.some(
      (camp) =>
        !isRecord(camp) ||
        typeof camp['campId'] !== 'string' ||
        !isNonNegativeFinite(camp['clearedAtDay']),
    )
  ) {
    return false;
  }
  return isQuestData(value['quests']) && isStoryData(value['story']);
}

function isQuestData(value: unknown): value is QuestSaveData {
  if (!isRecord(value)) return false;
  if (!optionalStringArray(value['active']) || !optionalStringArray(value['completed'])) {
    return false;
  }
  if (value['trackedId'] !== undefined && typeof value['trackedId'] !== 'string') return false;
  const started = value['started'];
  if (started === undefined) return true;
  return (
    Array.isArray(started) &&
    started.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry['id'] === 'string' &&
        Array.isArray(entry['counts']) &&
        entry['counts'].every((count) => typeof count === 'number' && count >= 0),
    )
  );
}

function isStoryData(value: unknown): value is StorySaveData {
  if (!isRecord(value)) return false;
  return (
    (value['chapterId'] === undefined || typeof value['chapterId'] === 'string') &&
    optionalStringArray(value['flags']) &&
    optionalStringArray(value['towers']) &&
    (value['respawn'] === undefined || isPosition(value['respawn']))
  );
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPosition(value: unknown): value is SavedPosition {
  return (
    isRecord(value) &&
    Number.isFinite(value['x']) &&
    Number.isFinite(value['y']) &&
    Number.isFinite(value['z'])
  );
}

function isPositiveFinite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
