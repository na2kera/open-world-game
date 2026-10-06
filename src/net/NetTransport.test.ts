import { describe, expect, it } from 'vitest';

import { LocalTransport, type PlayerSnapshot } from './NetTransport';

describe('LocalTransport', () => {
  it('echoes messages to subscribers and stops after unsubscribe', () => {
    const transport = new LocalTransport();
    const received: string[] = [];
    const unsubscribe = transport.onMessage((message) => {
      received.push(message.type);
    });
    const snapshot: PlayerSnapshot = {
      id: 'p1',
      x: 1,
      y: 2,
      z: 3,
      facing: 0,
      anim: 'idle',
      hp: 12,
      maxHp: 12,
    };
    transport.send({ type: 'player', payload: snapshot });
    unsubscribe();
    transport.send({ type: 'player', payload: snapshot });
    expect(received).toEqual(['player']);
  });
});
