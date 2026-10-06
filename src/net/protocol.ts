import { isWorldEvent, type NetPlayer, type WorldEvent } from './room';

export interface WelcomeMessage {
  readonly type: 'welcome';
  readonly id: string;
  readonly seed: number;
  readonly players: readonly NetPlayer[];
  readonly events: readonly WorldEvent[];
}

export interface PresenceMessage {
  readonly type: 'presence';
  readonly player: NetPlayer;
}

export interface LeaveMessage {
  readonly type: 'leave';
  readonly id: string;
}

export interface WorldMessage {
  readonly type: 'world';
  readonly event: WorldEvent;
}

export type ServerMessage = WelcomeMessage | PresenceMessage | LeaveMessage | WorldMessage;

export function parseServerMessage(raw: unknown): ServerMessage | null {
  const value = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!isRecord(value)) return null;
  if (value['type'] === 'welcome') {
    if (typeof value['id'] !== 'string' || !Number.isInteger(value['seed'])) return null;
    if (!Array.isArray(value['players']) || !Array.isArray(value['events'])) return null;
    const players = value['players'].filter(isNetPlayer);
    const events = value['events'].filter(isWorldEvent);
    return { type: 'welcome', id: value['id'], seed: value['seed'] as number, players, events };
  }
  if (value['type'] === 'presence') {
    return isNetPlayer(value['player']) ? { type: 'presence', player: value['player'] } : null;
  }
  if (value['type'] === 'leave') {
    return typeof value['id'] === 'string' ? { type: 'leave', id: value['id'] } : null;
  }
  if (value['type'] === 'world') {
    return isWorldEvent(value['event']) ? { type: 'world', event: value['event'] } : null;
  }
  return null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isNetPlayer(value: unknown): value is NetPlayer {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['anim'] === 'string' &&
    Number.isFinite(value['x']) &&
    Number.isFinite(value['y']) &&
    Number.isFinite(value['z']) &&
    Number.isFinite(value['facing']) &&
    Number.isFinite(value['hp']) &&
    Number.isFinite(value['maxHp'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
