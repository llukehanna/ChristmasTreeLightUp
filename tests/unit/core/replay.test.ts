import { describe, expect, it } from 'vitest';
import { ROTATE_MS } from '../../../src/core/board';
import type { LogEntry } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';
import { replay } from '../../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { solvingTaps, withPause } from './solver';

const honest = (seed: number, start = 1000, gap = 50): LogEntry[] => {
  const b = seededBoard(seed, GEN_VERSION);
  if (!b) throw new Error('no board');
  return solvingTaps(b, start, gap);
};
const run = (seed: number, log: LogEntry[]) => {
  const b = seededBoard(seed, GEN_VERSION, true);
  if (!b) throw new Error('no board');
  return replay(b, log);
};

describe('replay', () => {
  it('replays the scripted solver on 30 seeds: solved when the last turn settles', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const log = honest(seed);
      const r = run(seed, log);
      expect(r, `seed ${seed}`).not.toBeNull();
      const last = log[log.length - 1].t;
      expect(r?.solvedAt).toBeGreaterThan(last);
      expect(r?.solvedAt).toBeLessThanOrEqual(last + 4 * ROTATE_MS);
      expect(r?.tapTimes).toEqual(log.map((e) => e.t));
      expect(r?.pausedMs).toBe(0);
      expect(r?.pauses).toBe(0);
    }
  });

  it('seed 1: 121 taps 50 ms apart from t = 1000 settle at 7260', () => {
    expect(honest(1)).toHaveLength(121);
    expect(run(1, honest(1))?.solvedAt).toBe(7260);
  });

  it('refuses a log that never solves the tree', () => {
    expect(run(1, honest(1).slice(0, -1))).toBeNull();
    expect(run(1, [])).toBeNull();
  });

  it('refuses a tap after the solve', () => {
    const log = honest(1);
    expect(run(1, [...log, { t: log[log.length - 1].t + 2000, a: GRID.ids[0] }])).toBeNull();
  });

  it('refuses a tap inside a pause', () => {
    const log = honest(1);
    const bad: LogEntry[] = [...log.slice(0, 5), { t: log[4].t + 1, a: 'p' }, log[5], { t: log[5].t + 10, a: 'r' }, ...log.slice(6).map((e) => ({ t: e.t + 10, a: e.a }))];
    expect(run(1, bad)).toBeNull();
  });

  it('refuses a tap the board would have dropped (its turn queue was full)', () => {
    const tile = GRID.ids[3];
    expect(run(1, [0, 10, 20, 30, 40].map((t) => ({ t: 2000 + t, a: tile })))).toBeNull();
  });

  it('totals the pauses before the solve', () => {
    expect(run(1, withPause(honest(1), 10, 5000))).toMatchObject({ pausedMs: 5000, pauses: 1 });
  });

  it('counts a pause still open at the solve only up to the solve, and ignores pauses after it', () => {
    const log = honest(1);
    expect(run(1, [...log, { t: 7001, a: 'p' }])).toMatchObject({ solvedAt: 7260, pausedMs: 259, pauses: 1 });
    expect(run(1, [...log, { t: 9000, a: 'p' }, { t: 9500, a: 'r' }])).toMatchObject({ solvedAt: 7260, pausedMs: 0, pauses: 0 });
  });
});
