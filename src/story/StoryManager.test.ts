import { describe, expect, it } from 'vitest';

import { StoryManager, storyAfterQuest } from './StoryManager';

describe('StoryManager', () => {
  it('advances chapters only for main quests', () => {
    expect(storyAfterQuest('wake', 'main-wake')).toBe('towers');
    expect(storyAfterQuest('towers', 'main-towers')).toBe('boss');
    expect(storyAfterQuest('boss', 'main-boss')).toBe('report');
    expect(storyAfterQuest('report', 'main-report')).toBe('free');
    expect(storyAfterQuest('towers', 'side-herbs')).toBe('towers');
  });

  it('round-trips towers, flags and respawn', () => {
    const story = new StoryManager();
    story.setChapter('towers');
    story.setFlag('met-elder');
    expect(story.activateTower('tower-0')).toBe(true);
    expect(story.activateTower('tower-0')).toBe(false);
    story.setRespawn({ x: 1, y: 2, z: 3 });
    const restored = new StoryManager();
    restored.restore(story.toJSON());
    expect(restored.chapter).toBe('towers');
    expect(restored.hasFlag('met-elder')).toBe(true);
    expect(restored.towers).toEqual(['tower-0']);
    expect(restored.respawn).toEqual({ x: 1, y: 2, z: 3 });
  });
});
