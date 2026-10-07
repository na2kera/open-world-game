import { Color } from 'three';
import { describe, expect, it } from 'vitest';

import { drynessAt, terrainColorAt } from './terrainColors';

describe('terrainColorAt', () => {
  it('is deterministic for the same inputs', () => {
    const a = terrainColorAt(12.5, 0.83, 0.1, 431.2, -77.9, new Color());
    const b = terrainColorAt(12.5, 0.83, 0.1, 431.2, -77.9, new Color());
    expect(b.toArray()).toEqual(a.toArray());
  });

  it('exposes the sand blend as a dryness factor in [0, 1]', () => {
    expect(drynessAt(10, 0.5)).toBe(0);
    expect(drynessAt(10, -1)).toBe(1);
    expect(drynessAt(80, -1)).toBe(0);
    for (let moisture = -1; moisture <= 1; moisture += 0.05) {
      const dry = drynessAt(12, moisture);
      expect(dry).toBeGreaterThanOrEqual(0);
      expect(dry).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every channel within [0, 1.3] across heights, slopes and moisture', () => {
    const out = new Color();
    for (let height = -10; height <= 180; height += 5) {
      for (let normalY = 0.3; normalY <= 1.0001; normalY += 0.05) {
        for (let moisture = -1; moisture <= 1.0001; moisture += 0.1) {
          const x = height * 7.3 + moisture * 91;
          const z = normalY * 113 - height * 3.1;
          terrainColorAt(height, normalY, moisture, x, z, out);
          for (const channel of [out.r, out.g, out.b]) {
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(1.3);
          }
        }
      }
    }
  });
});
