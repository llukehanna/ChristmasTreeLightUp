import { expect, it } from 'vitest';
import { ROTATE_MS } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { solvingTaps } from './solver';

it('a headless board turns, queues, drops taps and wins exactly like the real one', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed * 7);
    const fast = seededBoard(seed, GEN_VERSION, true);
    const real = seededBoard(seed, GEN_VERSION);
    if (!fast || !real) throw new Error('no board');
    let t = 0;
    for (let k = 0; k < 2000; k++) {
      t += Math.floor(rng() * 90);
      fast.tick(t);
      real.tick(t);
      const i = GRID.ids[Math.floor(rng() * GRID.ids.length)];
      expect(fast.tap(i, t).length > 0).toBe(real.tap(i, t).length > 0);
      expect(fast.bits).toEqual(real.bits);
      expect(fast.won).toBe(real.won);
    }
    while (fast.rotating.size || real.rotating.size) {
      t += ROTATE_MS;
      fast.tick(t);
      real.tick(t);
      expect(fast.bits).toEqual(real.bits);
    }
    if (real.won) continue;
    for (const e of solvingTaps(real, t + 500, 50)) {
      if (typeof e.a !== 'number') continue;
      fast.tick(e.t);
      real.tick(e.t);
      fast.tap(e.a, e.t);
      real.tap(e.a, e.t);
      t = e.t;
    }
    while (fast.rotating.size || real.rotating.size) {
      t += ROTATE_MS;
      fast.tick(t);
      real.tick(t);
      expect(fast.won).toBe(real.won);
    }
    expect(fast.won).toBe(true);
    expect(real.won).toBe(true);
  }
});

it('a headless board only lights the tree to check for the win', () => {
  const b = seededBoard(3, GEN_VERSION, true);
  if (!b) throw new Error('no board');
  b.tap(GRID.ids[10], 0);
  expect(b.lighting.count).toBe(0); // dark while anything turns
  expect(b.tick(0)).toEqual([]);
});
