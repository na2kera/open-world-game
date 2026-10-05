import './style.css';

import { DEFAULT_SEED } from './config';
import { Game } from './core/Game';

/** Reads `?seed=` (integer) from the URL, falling back to the default seed. */
function readSeed(params: URLSearchParams): number {
  const raw = params.get('seed');
  if (raw === null) return DEFAULT_SEED;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app not found');
}

const params = new URLSearchParams(window.location.search);
new Game(app, { seed: readSeed(params), debug: params.has('debug') }).start();
