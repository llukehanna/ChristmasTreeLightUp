import { describe, expect, it } from 'vitest';
import type { BoardEvent } from '../../../src/core/board';
import { REVEAL_MS } from '../../../src/core/clock';
import { judge } from '../../../src/core/judge';
import type { LogEntry } from '../../../src/core/log';
import { Playback } from '../../../src/core/playback';
import { replay } from '../../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { asThreeCounterClockwise, shortestTaps, solvingTaps, withPause } from './solver';

const fresh = (seed: number, headless = false) => {
  const b = seededBoard(seed, GEN_VERSION, headless);
  if (!b) throw new Error('no board');
  return b;
};

/** The logs the round trip covers: shortest turns (counter-clockwise as ~i) and three-counter-clockwise, each with two pauses. */
const logs = (seed: number): Record<string, LogEntry[]> => {
  const shortest = shortestTaps(fresh(seed));
  const three = asThreeCounterClockwise(solvingTaps(fresh(seed)));
  return {
    shortest: withPause(withPause(shortest, 7, 4000), 30, 90_000),
    three: withPause(withPause(three, 5, 2500), 40, 61_000),
  };
};

/** Tiny deterministic dt source in [1, 50]. */
const dts = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return 1 + (s % 50);
  };
};

const settled = (b: { settledBits(): number[] }) => b.settledBits();

describe('Playback', () => {
  for (const speed of [1, 2] as const) {
    it(`plays a log to the judge's solve and to the same settled tree at ${speed}x`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        for (const [name, log] of Object.entries(logs(seed))) {
          const head = fresh(seed, true);
          const want = replay(head, log);
          expect(want, `${name} ${seed}`).not.toBeNull();
          const board = fresh(seed);
          const pb = new Playback(board, log);
          expect(pb.solvedAt).toBe(want?.solvedAt);
          const next = dts(seed * 7 + speed);
          let steps = 0;
          let last = 0;
          while (!pb.ended) {
            pb.step(next(), speed);
            expect(pb.cursor).toBeGreaterThanOrEqual(last);
            last = pb.cursor;
            expect(++steps).toBeLessThan(200_000);
          }
          expect(board.won, `${name} ${seed}`).toBe(true);
          expect(pb.cursor).toBe(want?.solvedAt);
          expect(settled(board)).toEqual(settled(head));
          expect(board.bits).toEqual(head.bits);
          expect(pb.step(10, speed)).toEqual([]);
        }
      }
    });
  }

  it("returns the board's events exactly as replay() would produce them, in order", () => {
    const log = logs(2).shortest;
    const head = fresh(2, true);
    const board = fresh(2);
    const pb = new Playback(board, log);
    const seen: string[] = [];
    while (!pb.ended) for (const e of pb.step(13, 1)) seen.push(e.type);
    // The same walk by hand, as replay() orders it: advanceTo(t), then tap, entry by entry.
    const ref = fresh(2);
    const want: string[] = [];
    let paused = false;
    for (const { t, a } of log) {
      const out: BoardEvent[] = [];
      if (!ref.won) ref.advanceTo(t, out);
      if (a === 'p' || a === 'r') paused = a === 'p';
      else if (!paused && !ref.won) out.push(...ref.tap(a >= 0 ? a : ~a, t, a >= 0 ? 1 : -1));
      for (const e of out) want.push(e.type);
    }
    const out: BoardEvent[] = [];
    ref.advanceTo(Number.MAX_SAFE_INTEGER, out);
    for (const e of out) want.push(e.type);
    expect(seen).toEqual(want);
    expect(replay(head, log)).not.toBeNull();
  });

  it('skips pauses: a five-minute pause costs no real time, and the clock never passes the verdict', () => {
    const log = withPause(shortestTaps(fresh(3)), 12, 300_000);
    const head = fresh(3, true);
    const want = replay(head, log);
    const verdict = judge({ seed: 3, genVersion: GEN_VERSION, log, serverElapsedMs: want?.solvedAt ?? 0 });
    expect(want && verdict).toBeTruthy();
    const pb = new Playback(fresh(3), log);
    let real = 0;
    let before = 0;
    while (!pb.ended) {
      before = real;
      real += 25;
      pb.step(25, 1);
      expect(pb.clockMs()).toBeLessThanOrEqual(verdict?.ms ?? 0);
    }
    expect(before).toBeLessThan((want?.solvedAt ?? 0) - 300_000);
  });

  it("reads the judge's ms on its clock at the solve", () => {
    for (const seed of [1, 2, 3]) {
      for (const [name, log] of Object.entries(logs(seed))) {
        const want = replay(fresh(seed, true), log);
        const verdict = judge({ seed, genVersion: GEN_VERSION, log, serverElapsedMs: (want?.solvedAt ?? 0) + 0 });
        const pb = new Playback(fresh(seed), log);
        while (!pb.ended) pb.step(30, 2);
        expect(Math.abs(pb.clockMs() - (verdict?.ms ?? NaN)), `${name} ${seed}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the clock at 0 through the reveal and counts a pause only from the reveal on', () => {
    const log = withPause(shortestTaps(fresh(1)), 3, 8000);
    const pb = new Playback(fresh(1), log);
    expect(pb.clockMs()).toBe(0);
    pb.step(REVEAL_MS / 2, 1);
    expect(pb.clockMs()).toBe(0);
    pb.step(REVEAL_MS / 2 + 100, 1);
    expect(pb.clockMs()).toBeCloseTo(100, 6);
  });

  it('plays a pause that is still open at the solve to the solve', () => {
    const base = shortestTaps(fresh(1));
    const solved = replay(fresh(1, true), base)?.solvedAt ?? 0;
    const lastTap = base[base.length - 1].t;
    const log: LogEntry[] = [...base, { t: lastTap + 1, a: 'p' }];
    const want = replay(fresh(1, true), log);
    expect(want?.solvedAt).toBe(solved);
    const pb = new Playback(fresh(1), log);
    let steps = 0;
    while (!pb.ended && steps++ < 10_000) pb.step(50, 1);
    expect(pb.ended).toBe(true);
    expect(pb.cursor).toBe(solved);
    expect(pb.clockMs()).toBe(want ? want.solvedAt - want.pausedMs - REVEAL_MS : -1);
  });

  it('has no solve for a log that does not solve, and ends after its last entry settles', () => {
    const log = shortestTaps(fresh(1)).slice(0, -1);
    const pb = new Playback(fresh(1), log);
    expect(pb.solvedAt).toBeNull();
    let steps = 0;
    while (!pb.ended && steps++ < 10_000) pb.step(50, 2);
    expect(pb.ended).toBe(true);
    expect(pb.step(50, 1)).toEqual([]);
  });
});
