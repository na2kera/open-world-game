import type { StorySaveData } from '../save/SaveData';

export type ChapterId = 'wake' | 'towers' | 'boss' | 'report' | 'free';

const CHAPTERS: readonly ChapterId[] = ['wake', 'towers', 'boss', 'report', 'free'];

export function isChapterId(value: string): value is ChapterId {
  return (CHAPTERS as readonly string[]).includes(value);
}

/** Main-quest completions move the chapter forward. Side quests do not. */
export function storyAfterQuest(chapter: ChapterId, questId: string): ChapterId {
  if (questId === 'main-wake') return 'towers';
  if (questId === 'main-towers') return 'boss';
  if (questId === 'main-boss') return 'report';
  if (questId === 'main-report') return 'free';
  return chapter;
}

export interface StoryPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Pure story flags, awakened towers and the current chapter. */
export class StoryManager {
  chapter: ChapterId = 'wake';
  private readonly flags = new Set<string>();
  private readonly towerIds = new Set<string>();
  respawn: StoryPoint | null = null;

  reset(): void {
    this.chapter = 'wake';
    this.flags.clear();
    this.towerIds.clear();
    this.respawn = null;
  }

  setChapter(chapter: ChapterId): void {
    this.chapter = chapter;
  }

  setFlag(id: string): void {
    this.flags.add(id);
  }

  hasFlag(id: string): boolean {
    return this.flags.has(id);
  }

  get towers(): readonly string[] {
    return [...this.towerIds];
  }

  hasTower(id: string): boolean {
    return this.towerIds.has(id);
  }

  /** Returns true the first time a tower is awakened. */
  activateTower(id: string): boolean {
    if (this.towerIds.has(id)) return false;
    this.towerIds.add(id);
    return true;
  }

  setRespawn(point: StoryPoint): void {
    this.respawn = { x: point.x, y: point.y, z: point.z };
  }

  toJSON(): StorySaveData {
    const data: StorySaveData = {
      chapterId: this.chapter,
      flags: [...this.flags],
      towers: [...this.towerIds],
    };
    return this.respawn ? { ...data, respawn: this.respawn } : data;
  }

  restore(data: StorySaveData): void {
    this.reset();
    if (data.chapterId && isChapterId(data.chapterId)) this.chapter = data.chapterId;
    for (const flag of data.flags ?? []) this.flags.add(flag);
    for (const tower of data.towers ?? []) this.towerIds.add(tower);
    if (data.respawn) this.respawn = { ...data.respawn };
  }
}
