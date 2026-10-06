import { parseServerMessage } from './protocol';
import { isWorldEvent, normalizeName, type NetPlayer, type WorldEvent } from './room';

export type ClientMessage =
  | { type: 'join'; room: string; seed: number; name: string }
  | { type: 'snapshot'; player: NetPlayer }
  | { type: 'world'; event: WorldEvent };

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record['type'] === 'join') {
    if (!Number.isInteger(record['seed'])) return null;
    return {
      type: 'join',
      room: typeof record['room'] === 'string' ? record['room'] : 'wildlands',
      seed: record['seed'] as number,
      name: normalizeName(typeof record['name'] === 'string' ? record['name'] : ''),
    };
  }
  if (record['type'] === 'snapshot') {
    const parsed = parseServerMessage(
      JSON.stringify({ type: 'presence', player: record['player'] }),
    );
    return parsed?.type === 'presence' ? { type: 'snapshot', player: parsed.player } : null;
  }
  if (record['type'] === 'world' && isWorldEvent(record['event'])) {
    return { type: 'world', event: record['event'] };
  }
  return null;
}
