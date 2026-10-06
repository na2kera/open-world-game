import { deserializeSaveData, isSaveData, serializeSaveData, type SaveData } from './SaveData';

export const SAVE_STORAGE_KEY = 'open-world-game:save:v1';

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveMigration = (value: unknown) => SaveData | null;

/** Versioned localStorage persistence with an explicit migration hook. */
export class SaveManager {
  constructor(
    private readonly storage: SaveStorage | null = getDefaultStorage(),
    private readonly migrate: SaveMigration = defaultMigration,
  ) {}

  save(data: SaveData): boolean {
    if (!this.storage || !isSaveData(data)) return false;
    try {
      this.storage.setItem(SAVE_STORAGE_KEY, serializeSaveData(data));
      return true;
    } catch {
      return false;
    }
  }

  load(): SaveData | null {
    if (!this.storage) return null;
    let serialized: string | null;
    try {
      serialized = this.storage.getItem(SAVE_STORAGE_KEY);
    } catch {
      return null;
    }
    if (serialized === null) return null;
    const current = deserializeSaveData(serialized);
    if (current) return current;
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      return null;
    }
    return this.migrate(parsed);
  }

  hasSave(): boolean {
    return this.load() !== null;
  }

  clear(): void {
    try {
      this.storage?.removeItem(SAVE_STORAGE_KEY);
    } catch {
      // Storage may be blocked by browser privacy settings; clearing is best-effort.
    }
  }
}

function defaultMigration(value: unknown): SaveData | null {
  return isSaveData(value) ? value : null;
}

function getDefaultStorage(): SaveStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
