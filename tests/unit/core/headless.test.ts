import { expect, it } from 'vitest';
import { ROTATE_MS, type Board, type BoardEvent } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { replay } from '../../../src/core/replay';
import { mulberry32 } from '../../../src/core/rng';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { solvingTaps } from './solver';

/** The headless board never lights the tree mid-play, so lighting events are the one thing that may differ. */
const settled = (events: BoardEvent[]): BoardEvent[] => events.filter((e) => e.type !== 'lightingChanged');

function pair(seed: number): { fast: Board; real: Board } {
  const fast = seededBoard(seed, GEN_VERSION, true);
  const real = seededBoard(seed, GEN_VERSION);
  if (!fast || !real) throw new Error('no board');
  return { fast, real };
}

/** Same call on both boards: same events (lighting aside), same tiles, same queues, same win. */
function step(fast: Board, real: Board, t: number, tile?: number): void {
  expect(settled(fast.tick(t))).toEqual(settled(real.tick(t)));
  if (tile !== undefined) expect(settled(fast.tap(tile, t))).toEqual(settled(real.tap(tile, t)));
  expect(fast.bits).toEqual(real.bits);
  expect(fast.won).toBe(real.won);
  expect([...fast.rotating]).toEqual([...real.rotating]);
}

it('a headless board turns, queues, drops taps and wins exactly like the real one', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed * 7);
    const { fast, real } = pair(seed);
    let t = 0;
    let tile = GRID.ids[0];
    for (let k = 0; k < 2000; k++) {
      t += Math.floor(rng() * 90);
      // Half the time hit the same tile again, so queues fill up and taps get dropped.
      if (rng() < 0.5) tile = GRID.ids[Math.floor(rng() * GRID.ids.length)];
      step(fast, real, t, tile);
    }
    while (fast.rotating.size || real.rotating.size) {
      t += ROTATE_MS;
      step(fast, real, t);
    }
    if (real.won) continue;
    for (const e of solvingTaps(real, t + 500, 50)) {
      if (typeof e.a !== 'number') continue;
      step(fast, real, e.t, e.a);
      t = e.t;
    }
    while (fast.rotating.size || real.rotating.size) {
      t += ROTATE_MS;
      step(fast, real, t);
    }
    expect(fast.won).toBe(true);
    expect(real.won).toBe(true);
  }
});

it('rapid taps on one tile fill the queue and drop the rest, the same on both boards', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { fast, real } = pair(seed);
    const tile = GRID.ids[seed];
    for (let k = 0; k < 8; k++) step(fast, real, 100 + k, tile); // 1 turning + 3 queued, then 4 dropped
    expect(fast.rotating.get(tile)?.queued).toBe(3);
    for (let t = 100; t <= 100 + 5 * ROTATE_MS; t += 20) step(fast, real, t);
    expect(fast.rotating.size).toBe(0);
  }
});

it('replaying a log on a headless board gives the same solve time as on the real board', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { fast, real } = pair(seed);
    const log = solvingTaps(real, 1000, 50);
    const a = replay(fast, log);
    const b = replay(real, log);
    expect(a, `seed ${seed}`).not.toBeNull();
    expect(a).toEqual(b);
  }
});

it('a headless board only lights the tree to check for the win', () => {
  const b = seededBoard(3, GEN_VERSION, true);
  if (!b) throw new Error('no board');
  b.tap(GRID.ids[10], 0);
  expect(b.lighting.count).toBe(0); // dark while anything turns
  expect(b.tick(0)).toEqual([]);
});
