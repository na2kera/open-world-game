import './style.css';

import { DEFAULT_SEED } from './config';
import { Game } from './core/Game';
import { joinMultiplayer } from './net/session';

const SAVE_KEY = 'open-world-game:save:v1';

declare global {
  interface Window {
    /** Game instance, exposed only with `?debug` for console inspection. */
    __game?: Game;
  }
}

/** Reads an explicit `?seed=` integer; omitted URLs may reuse the persisted world's seed. */
function readSeed(params: URLSearchParams): number | undefined {
  const raw = params.get('seed');
  if (raw === null) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
}

function multiplayerUrl(room: string): string {
  const override = params.get('mp');
  if (override) return withRoom(override, room);
  const configured = import.meta.env.VITE_MULTIPLAYER_URL;
  if (typeof configured === 'string' && configured.length > 0) return withRoom(configured, room);
  return `ws://${window.location.hostname || 'localhost'}:8787`;
}

function withRoom(base: string, room: string): string {
  const url = new URL(base, window.location.href);
  url.searchParams.set('room', room);
  return url.toString();
}

function readSavedSeed(): number | undefined {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return undefined;
    const data = JSON.parse(raw) as { seed?: unknown };
    return typeof data.seed === 'number' && Number.isInteger(data.seed) ? data.seed : undefined;
  } catch {
    return undefined;
  }
}

const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
const requestedSeed = readSeed(params);

void boot();

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) throw new Error('#app not found');
  const offline = params.has('offline');
  const room = params.get('room') ?? 'wildlands';
  const connection = offline
    ? null
    : await joinMultiplayer({
        url: multiplayerUrl(room),
        room,
        seed: requestedSeed ?? readSavedSeed() ?? DEFAULT_SEED,
        name: params.get('name') ?? '旅人',
      });
  const seed = connection?.seed ?? requestedSeed;
  const game = new Game(root, {
    debug,
    ...(seed === undefined ? {} : { seed }),
    ...(connection ? { multiplayer: connection } : {}),
  }).start();
  if (debug) window.__game = game;
}
