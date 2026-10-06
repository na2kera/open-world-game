import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';

import { startMultiplayerServer } from '../../server/index';
import { parseServerMessage, type ServerMessage } from './protocol';

describe('multiplayer server', () => {
  it('locks the seed and relays presence, world events and leave', async () => {
    const server = await startMultiplayerServer(0);
    const first = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const second = new WebSocket(`ws://127.0.0.1:${server.port}`);
    try {
      await Promise.all([opened(first), opened(second)]);
      const firstWelcome = read(first);
      first.send(JSON.stringify({ type: 'join', room: 'wildlands', seed: 42, name: 'リン' }));
      const welcome = await firstWelcome;
      expect(welcome?.type).toBe('welcome');
      if (welcome?.type !== 'welcome') return;
      expect(welcome.seed).toBe(42);

      const secondWelcome = read(second);
      second.send(JSON.stringify({ type: 'join', room: 'wildlands', seed: 7, name: 'ソラ' }));
      const joined = await secondWelcome;
      expect(joined?.type).toBe('welcome');
      if (joined?.type !== 'welcome') return;
      expect(joined.seed).toBe(42);
      expect(joined.players.map((player) => player.name)).toEqual(['リン']);

      const seen = read(second);
      first.send(
        JSON.stringify({
          type: 'snapshot',
          player: {
            id: 'spoof',
            name: 'spoof',
            x: 3,
            y: 1,
            z: 4,
            facing: 0.2,
            anim: 'ground',
            hp: 12,
            maxHp: 12,
          },
        }),
      );
      const presence = await seen;
      expect(presence?.type).toBe('presence');
      if (presence?.type !== 'presence') return;
      expect(presence.player.id).toBe(welcome.id);
      expect(presence.player.name).toBe('リン');
      expect(presence.player.x).toBe(3);

      const world = read(second);
      first.send(JSON.stringify({ type: 'world', event: { kind: 'pickup', id: '1:2:item:0' } }));
      const shared = await world;
      expect(shared).toEqual({ type: 'world', event: { kind: 'pickup', id: '1:2:item:0' } });

      const left = read(second);
      first.close();
      const goodbye = await left;
      expect(goodbye).toEqual({ type: 'leave', id: welcome.id });
    } finally {
      first.close();
      second.close();
      await server.close();
    }
  });
});

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function read(socket: WebSocket): Promise<ServerMessage | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for a server message')),
      2000,
    );
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(parseServerMessage(data.toString()));
    });
  });
}
