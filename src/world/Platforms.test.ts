import { describe, expect, it } from 'vitest';

import { Platforms } from './Platforms';

describe('Platforms', () => {
  it('returns the highest step the feet can reach and ignores landings overhead', () => {
    const platforms = new Platforms();
    platforms.add({ x: 0, z: 0, topY: 1, halfX: 1, halfZ: 1, yaw: 0 });
    platforms.add({ x: 0, z: 0, topY: 4, halfX: 1, halfZ: 1, yaw: 0 });
    expect(platforms.heightAt(0, 1.2, 0)).toBe(1);
    expect(platforms.heightAt(0, 4.1, 0)).toBe(4);
    expect(platforms.heightAt(3, 4, 0)).toBeUndefined();
  });
});
