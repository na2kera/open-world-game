import { parseServerMessage, type ServerMessage } from './protocol';
import type { NetPlayer, WorldEvent } from './room';

const JOIN_TIMEOUT_MS = 1200;

export interface MultiplayerConnection {
  readonly selfId: string;
  readonly room: string;
  readonly seed: number;
  readonly players: readonly NetPlayer[];
  readonly events: readonly WorldEvent[];
  send(message: object): void;
  subscribe(handler: (message: ServerMessage) => void): () => void;
  close(): void;
}

/**
 * Joins the local multiplayer server. Resolves null when it is not running,
 * so a single player can still start the game.
 */
export function joinMultiplayer(options: {
  url: string;
  room: string;
  seed: number;
  name: string;
}): Promise<MultiplayerConnection | null> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(options.url);
    } catch {
      resolve(null);
      return;
    }
    const pending: ServerMessage[] = [];
    const handlers = new Set<(message: ServerMessage) => void>();
    const finish = (connection: MultiplayerConnection | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(connection);
    };
    const timer = window.setTimeout(() => {
      socket.close();
      finish(null);
    }, JOIN_TIMEOUT_MS);

    socket.addEventListener('error', () => finish(null));
    socket.addEventListener('close', () => {
      if (!settled) finish(null);
    });
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'join',
          room: options.room,
          seed: options.seed,
          name: options.name,
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      const message = parseServerMessage(typeof event.data === 'string' ? event.data : '');
      if (!message) return;
      if (!settled) {
        if (message.type !== 'welcome') return;
        finish({
          selfId: message.id,
          room: options.room,
          seed: message.seed,
          players: message.players,
          events: message.events,
          send(payload: object): void {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
          },
          subscribe(handler): () => void {
            handlers.add(handler);
            for (const queued of pending) handler(queued);
            pending.length = 0;
            return () => handlers.delete(handler);
          },
          close(): void {
            socket.close();
          },
        });
        for (const queued of pending) {
          for (const handler of handlers) handler(queued);
        }
        pending.length = 0;
        return;
      }
      if (handlers.size === 0) pending.push(message);
      else for (const handler of handlers) handler(message);
    });
  });
}
