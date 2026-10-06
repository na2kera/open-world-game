export const WORLD_EVENT_KINDS = ['pickup', 'chest', 'enemy', 'tower'] as const;

export type WorldEventKind = (typeof WORLD_EVENT_KINDS)[number];

export interface WorldEvent {
  readonly kind: WorldEventKind;
  readonly id: string;
}

/** One person in a shared room, safe to send over the wire. */
export interface NetPlayer {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
  readonly anim: string;
  readonly hp: number;
  readonly maxHp: number;
}

export interface JoinRequest {
  readonly room: string;
  readonly seed: number;
  readonly name: string;
}

export interface JoinResult {
  readonly id: string;
  readonly seed: number;
  readonly players: readonly NetPlayer[];
  readonly events: readonly WorldEvent[];
}

interface RoomState {
  seed: number;
  readonly players: Map<string, NetPlayer>;
  readonly events: WorldEvent[];
  readonly eventKeys: Set<string>;
}

const ROOM_PATTERN = /^[a-z0-9-]{1,24}$/;
const MAX_PLAYERS = 8;
const MAX_EVENTS = 4000;

/** In-memory rooms. The WebSocket server is a thin shell around this. */
export class RoomHub {
  private readonly rooms = new Map<string, RoomState>();
  private nextId = 1;

  join(request: JoinRequest): JoinResult | null {
    const roomId = normalizeRoom(request.room);
    const name = normalizeName(request.name);
    if (!Number.isInteger(request.seed)) return null;
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { seed: request.seed, players: new Map(), events: [], eventKeys: new Set() };
      this.rooms.set(roomId, room);
    }
    if (room.players.size >= MAX_PLAYERS) return null;
    const id = `p${this.nextId}`;
    this.nextId += 1;
    const player: NetPlayer = {
      id,
      name,
      x: 0,
      y: 0,
      z: 0,
      facing: 0,
      anim: 'ground',
      hp: 12,
      maxHp: 12,
    };
    room.players.set(id, player);
    return {
      id,
      seed: room.seed,
      players: [...room.players.values()].filter((entry) => entry.id !== id),
      events: [...room.events],
    };
  }

  snapshot(roomId: string, player: NetPlayer): NetPlayer | null {
    const room = this.rooms.get(normalizeRoom(roomId));
    const current = room?.players.get(player.id);
    if (!room || !current) return null;
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(player.z)) {
      return null;
    }
    const next: NetPlayer = {
      id: current.id,
      name: current.name,
      x: player.x,
      y: player.y,
      z: player.z,
      facing: Number.isFinite(player.facing) ? player.facing : current.facing,
      anim: player.anim.slice(0, 16) || current.anim,
      hp: clampVital(player.hp, current.hp),
      maxHp: clampVital(player.maxHp, current.maxHp),
    };
    room.players.set(current.id, next);
    return next;
  }

  /** Records a world change once. Duplicates return null so clients are not spammed. */
  world(roomId: string, event: WorldEvent): WorldEvent | null {
    const room = this.rooms.get(normalizeRoom(roomId));
    if (!room || !isWorldEvent(event)) return null;
    const key = `${event.kind}:${event.id}`;
    if (room.eventKeys.has(key) || room.events.length >= MAX_EVENTS) return null;
    room.eventKeys.add(key);
    room.events.push(event);
    return event;
  }

  leave(roomId: string, playerId: string): boolean {
    const id = normalizeRoom(roomId);
    const room = this.rooms.get(id);
    if (!room?.players.delete(playerId)) return false;
    if (room.players.size === 0) this.rooms.delete(id);
    return true;
  }
}

export function normalizeRoom(room: string): string {
  const normalized = room.trim().toLowerCase();
  return ROOM_PATTERN.test(normalized) ? normalized : 'wildlands';
}

export function normalizeName(name: string): string {
  const trimmed = name.trim().slice(0, 12);
  return trimmed.length > 0 ? trimmed : '旅人';
}

export function isWorldEvent(value: unknown): value is WorldEvent {
  if (!isRecord(value) || typeof value['id'] !== 'string' || value['id'].length > 80) return false;
  return (WORLD_EVENT_KINDS as readonly string[]).includes(String(value['kind']));
}

function clampVital(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(999, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
