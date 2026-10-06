import { describe, expect, it } from 'vitest';

import { QUEST_DEFS } from '../data/quests';
import { QuestManager } from './QuestManager';

describe('QuestManager', () => {
  it('starts the wake quest, completes on talk, and offers side quests', () => {
    const quests = new QuestManager(QUEST_DEFS);
    expect(quests.status('side-herbs')).toBe('locked');
    expect(quests.start('main-wake', true)).toEqual([
      { type: 'started', questId: 'main-wake', remove: [] },
    ]);
    expect(quests.markerFor('iori')).toBeNull();
    const done = quests.complete('main-wake');
    expect(done[0]?.type).toBe('completed');
    expect(quests.status('side-herbs')).toBe('available');
    expect(quests.markerFor('mira')).toBe('!');
  });

  it('tracks tower objectives and waits for turn-in', () => {
    const quests = new QuestManager(QUEST_DEFS);
    quests.start('main-wake', true);
    quests.complete('main-wake');
    quests.start('main-towers', true);
    expect(quests.apply({ type: 'activateTower', towerId: 'tower-0' })[0]?.type).toBe('progress');
    quests.apply({ type: 'activateTower', towerId: 'tower-1' });
    const ready = quests.apply({ type: 'activateTower', towerId: 'tower-2' });
    expect(ready.some((change) => change.type === 'ready')).toBe(true);
    expect(quests.status('main-towers')).toBe('readyToTurnIn');
    expect(quests.markerFor('iori')).toBe('?');
    expect(quests.turnIn('main-towers')[0]?.type).toBe('completed');
  });

  it('ignores tower events before the tower quest starts and credits them once resent', () => {
    const quests = new QuestManager(QUEST_DEFS);
    quests.start('main-wake', true);
    expect(quests.apply({ type: 'activateTower', towerId: 'tower-0' })).toEqual([]);
    quests.complete('main-wake');
    quests.start('main-towers', true);
    expect(quests.journalLines()).toContain('  東の塔を起動する（0/1）');
    expect(quests.apply({ type: 'activateTower', towerId: 'tower-0' })).toEqual([
      { type: 'progress', questId: 'main-towers', remove: [] },
    ]);
    expect(quests.journalLines()).toContain('  東の塔を起動する（1/1）');
  });

  it('treats a repeated tower event as no change', () => {
    const quests = new QuestManager(QUEST_DEFS);
    quests.start('main-wake', true);
    quests.complete('main-wake');
    quests.start('main-towers', true);
    quests.apply({ type: 'activateTower', towerId: 'tower-1' });
    expect(quests.apply({ type: 'activateTower', towerId: 'tower-1' })).toEqual([]);
    expect(quests.journalLines()).toContain('  北の塔を起動する（1/1）');
    const saved = quests.toJSON().started?.find((entry) => entry.id === 'main-towers');
    expect(saved?.counts).toEqual([0, 1, 0]);
  });

  it('keeps guiding toward the main quest while side quests start and finish', () => {
    const quests = new QuestManager(QUEST_DEFS);
    quests.start('main-wake', true);
    quests.complete('main-wake');
    quests.start('main-towers', true);
    quests.start('side-shrine');
    expect(quests.trackedId).toBe('main-towers');
    expect(quests.objectiveLine()).toBe('三つの塔：東の塔を起動する');
    expect(quests.trackedLocationId()).toBe('tower-0');
    quests.apply({ type: 'reach', locationId: 'shrine' });
    expect(quests.status('side-shrine')).toBe('completed');
    expect(quests.trackedId).toBe('main-towers');
    for (const towerId of ['tower-0', 'tower-1', 'tower-2']) {
      quests.apply({ type: 'activateTower', towerId });
    }
    expect(quests.objectiveLine()).toBe('三つの塔：報告する');
    expect(quests.trackedLocationId()).toBe('npc:iori');
  });

  it('falls back to the latest unfinished side quest when no main quest is open', () => {
    const quests = new QuestManager(QUEST_DEFS);
    quests.start('main-wake', true);
    quests.complete('main-wake');
    quests.start('side-herbs');
    quests.start('side-apples');
    expect(quests.trackedId).toBe('side-apples');
    quests.apply({ type: 'collect', itemId: 'apple', owned: 3 });
    quests.turnIn('side-apples');
    expect(quests.trackedId).toBe('side-herbs');
    const restored = new QuestManager(QUEST_DEFS);
    restored.restore(quests.toJSON());
    expect(restored.trackedId).toBe('side-herbs');
  });

  it('consumes collected items on turn-in and round-trips through save data', () => {
    const quests = new QuestManager(QUEST_DEFS);
    quests.start('main-wake', true);
    quests.complete('main-wake');
    quests.start('side-herbs');
    expect(quests.apply({ type: 'collect', itemId: 'herb', owned: 4 })).toEqual([
      { type: 'progress', questId: 'side-herbs', remove: [] },
    ]);
    const ready = quests.apply({ type: 'collect', itemId: 'herb', owned: 5 });
    expect(ready[0]?.type).toBe('ready');
    const turnedIn = quests.turnIn('side-herbs');
    expect(turnedIn[0]?.remove).toEqual([{ itemId: 'herb', count: 5 }]);
    expect(turnedIn[0]?.reward?.maxStamina).toBe(20);

    const restored = new QuestManager(QUEST_DEFS);
    restored.restore(quests.toJSON());
    expect(restored.status('side-herbs')).toBe('completed');
    expect(restored.status('main-wake')).toBe('completed');
    expect(restored.trackedId).toBeNull();
  });
});
