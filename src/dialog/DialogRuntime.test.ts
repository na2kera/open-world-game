import { describe, expect, it } from 'vitest';

import { DIALOG_SCRIPTS } from '../data/dialogs';
import { DialogCursor, selectScript, type DialogContext } from './DialogRuntime';

function context(
  partial: Partial<DialogContext> & Pick<DialogContext, 'questStatus'>,
): DialogContext {
  return {
    storyChapter: 'wake',
    hasFlag: () => false,
    ...partial,
  };
}

describe('dialog runtime', () => {
  it('picks the highest-priority matching script', () => {
    const intro = selectScript(
      DIALOG_SCRIPTS,
      'iori',
      context({ questStatus: (id) => (id === 'main-wake' ? 'active' : 'locked') }),
    );
    expect(intro?.id).toBe('iori-intro');
    const ready = selectScript(
      DIALOG_SCRIPTS,
      'iori',
      context({
        questStatus: (id) => (id === 'main-towers' ? 'readyToTurnIn' : 'locked'),
        storyChapter: 'towers',
      }),
    );
    expect(ready?.id).toBe('iori-towers-ready');
  });

  it('follows a choice and reports effects on the destination node', () => {
    const script = selectScript(
      DIALOG_SCRIPTS,
      'mira',
      context({ questStatus: (id) => (id === 'side-herbs' ? 'available' : 'locked') }),
    );
    expect(script).not.toBeNull();
    if (!script) return;
    const cursor = new DialogCursor(script);
    expect(cursor.node.choices?.map((choice) => choice.label)).toEqual([
      '引き受ける',
      'いまはいい',
    ]);
    const step = cursor.advance(0);
    expect(step?.node.id).toBe('yes');
    expect(step?.effects).toEqual([{ type: 'startQuest', id: 'side-herbs' }]);
    expect(cursor.advance()).toBeNull();
  });
});
