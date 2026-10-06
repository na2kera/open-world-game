import { DurableObject } from 'cloudflare:workers';

import { parseClientMessage } from '../src/net/clientMessage';
import type { ServerMessage } from '../src/net/protocol';
import { RoomHub, normalizeRoom, type WorldEvent } from '../src/net/room';

const ROOM_KEY = 'local';

interface StoredWorld {
  seed: number;
  events: WorldEvent[];
}

interface Env {
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
}

/**
 * One object per room name. Seed and world events live in storage so the
 * room survives restarts. Connected players stay in memory for the session.
 */
export class RoomDurableObject extends DurableObject<Env> {
  private readonly hub = new RoomHub();
  private readonly sockets = new Map<WebSocket, string>();
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.restore();
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ready;
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('wildlands multiplayer', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (!client || !server) return new Response('upgrade failed', { status: 500 });
    server.accept();
    server.addEventListener('message', (event) => {
      void this.onMessage(server, event.data);
    });
    server.addEventListener('close', () => {
      void this.onClose(server);
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(socket: WebSocket, raw: unknown): Promise<void> {
    await this.ready;
    if (typeof raw !== 'string') return;
    const message = parseClientMessage(raw);
    if (!message) return;
    if (message.type === 'join') {
      const joined = this.hub.join({ room: ROOM_KEY, seed: message.seed, name: message.name });
      if (!joined) {
        socket.close();
        return;
      }
      this.sockets.set(socket, joined.id);
      this.send(socket, {
        type: 'welcome',
        id: joined.id,
        seed: joined.seed,
        players: joined.players,
        events: joined.events,
      });
      return;
    }
    const playerId = this.sockets.get(socket);
    if (!playerId) return;
    if (message.type === 'snapshot') {
      const player = this.hub.snapshot(ROOM_KEY, { ...message.player, id: playerId });
      if (!player) return;
      this.broadcast(socket, { type: 'presence', player });
      return;
    }
    const event = this.hub.world(ROOM_KEY, message.event);
    if (!event) return;
    await this.persist();
    this.broadcast(socket, { type: 'world', event });
  }

  private async onClose(socket: WebSocket): Promise<void> {
    await this.ready;
    const playerId = this.sockets.get(socket);
    this.sockets.delete(socket);
    if (!playerId) return;
    await this.persist();
    if (!this.hub.disconnect(ROOM_KEY, playerId)) return;
    this.broadcast(socket, { type: 'leave', id: playerId });
  }

  private async restore(): Promise<void> {
    const saved = await this.ctx.storage.get<StoredWorld>('world');
    if (!saved) return;
    this.hub.hydrate(ROOM_KEY, saved.seed, saved.events);
  }

  private async persist(): Promise<void> {
    const data = this.hub.exportState(ROOM_KEY);
    if (data) await this.ctx.storage.put('world', data);
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(sender: WebSocket, message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const [socket] of this.sockets) {
      if (socket === sender || socket.readyState !== WebSocket.OPEN) continue;
      socket.send(payload);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const room = normalizeRoom(new URL(request.url).searchParams.get('room') ?? 'wildlands');
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
  },
};
