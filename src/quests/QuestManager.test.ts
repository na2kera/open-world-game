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
    expect(restored.trackedId).toBe('side-herbs');
  });
});
