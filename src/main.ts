import './style.css';

import { DEFAULT_SEED } from './config';
import { Game } from './core/Game';

/** Reads an explicit `?seed=` integer; omitted URLs may reuse the persisted world's seed. */
function readSeed(params: URLSearchParams): number | undefined {
  const raw = params.get('seed');
  if (raw === null) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app not found');
}

declare global {
  interface Window {
    /** Game instance, exposed only with `?debug` for console inspection. */
    __game?: Game;
  }
}

const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
const seed = readSeed(params);
const game = new Game(app, seed === undefined ? { debug } : { seed, debug }).start();
if (debug) window.__game = game;
