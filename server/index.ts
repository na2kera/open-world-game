import { createServer, type Server } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import { parseClientMessage } from '../src/net/clientMessage';
import type { ServerMessage } from '../src/net/protocol';
import { RoomHub, normalizeRoom } from '../src/net/room';

const DEFAULT_PORT = 8787;
const STALE_MS = 4000;

interface ClientState {
  roomId: string;
  playerId: string;
}

export interface RunningServer {
  readonly port: number;
  close(): Promise<void>;
}

/** Starts the shared-world WebSocket server. Port 0 asks the OS for a free port. */
export function startMultiplayerServer(port = DEFAULT_PORT): Promise<RunningServer> {
  const hub = new RoomHub();
  const httpServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('wildlands multiplayer');
  });
  const sockets = new WebSocketServer({ server: httpServer });
  const clients = new Map<WebSocket, ClientState>();
  const lastSeen = new Map<WebSocket, number>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const socket of sockets.clients) {
      const seen = lastSeen.get(socket) ?? 0;
      if (now - seen > STALE_MS) socket.terminate();
    }
  }, 1000);
  sweep.unref();

  sockets.on('connection', (socket) => {
    lastSeen.set(socket, Date.now());
    socket.on('message', (data) => {
      lastSeen.set(socket, Date.now());
      const message = parseClientMessage(data.toString());
      if (!message) return;
      if (message.type === 'join') {
        const joined = hub.join({
          room: message.room,
          seed: message.seed,
          name: message.name,
        });
        if (!joined) {
          socket.close();
          return;
        }
        const roomId = normalizeRoom(message.room);
        clients.set(socket, { roomId, playerId: joined.id });
        send(socket, {
          type: 'welcome',
          id: joined.id,
          seed: joined.seed,
          players: joined.players,
          events: joined.events,
        });
        return;
      }
      const client = clients.get(socket);
      if (!client) return;
      if (message.type === 'snapshot') {
        const player = hub.snapshot(client.roomId, { ...message.player, id: client.playerId });
        if (!player) return;
        broadcast(sockets, clients, socket, client.roomId, { type: 'presence', player });
        return;
      }
      const event = hub.world(client.roomId, message.event);
      if (!event) return;
      broadcast(sockets, clients, socket, client.roomId, { type: 'world', event });
    });

    socket.on('close', () => {
      lastSeen.delete(socket);
      const client = clients.get(socket);
      clients.delete(socket);
      if (!client) return;
      if (!hub.leave(client.roomId, client.playerId)) return;
      broadcast(sockets, clients, socket, client.roomId, { type: 'leave', id: client.playerId });
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => {
      const address = httpServer.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: bound,
        close: () => {
          clearInterval(sweep);
          return closeServer(httpServer, sockets);
        },
      });
    });
  });
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(
  sockets: WebSocketServer,
  clients: Map<WebSocket, ClientState>,
  sender: WebSocket,
  roomId: string,
  message: ServerMessage,
): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets.clients) {
    const client = clients.get(socket);
    if (!client || client.roomId !== roomId || socket === sender) continue;
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

function closeServer(httpServer: Server, sockets: WebSocketServer): Promise<void> {
  for (const socket of sockets.clients) socket.close();
  return new Promise((resolve, reject) => {
    sockets.close();
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}

const directRun = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (directRun) {
  const port = Number.parseInt(process.env['PORT'] ?? '', 10);
  void startMultiplayerServer(Number.isInteger(port) ? port : DEFAULT_PORT).then((server) => {
    console.info(`multiplayer listening on ${server.port}`);
  });
}
