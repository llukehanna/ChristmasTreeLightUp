import { describe, expect, it, vi } from 'vitest';
import { REVEAL_MS } from '../../../src/core/clock';
import { CLOCK_TOLERANCE_MS, FAST_GAP_MS, judge, MAX_PAUSED_MS, MAX_PAUSES, MIN_RANKED_MS } from '../../../src/core/judge';
import { MAX_LOG_ENTRIES, parseLog, type LogEntry } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';
import { MAX_REPLAY_BFS, replay } from '../../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { solvingTaps, withPause } from './solver';

const SEED = 1;
const honest = (start = 1000, gap = 50, seed = SEED): LogEntry[] => {
  const b = seededBoard(seed, GEN_VERSION);
  if (!b) throw new Error('no board');
  return solvingTaps(b, start, gap);
};
const solvedAt = (log: LogEntry[], seed = SEED): number => {
  const b = seededBoard(seed, GEN_VERSION, true);
  const r = b && replay(b, log);
  if (!r) throw new Error('does not replay');
  return r.solvedAt;
};
/** Judged as if the server saw `extra` ms more than the log spans (an honest client: two network legs). */
const judged = (log: LogEntry[], extra = 300, seed = SEED) => judge({ seed, genVersion: GEN_VERSION, log, serverElapsedMs: solvedAt(log, seed) + extra });
/** The same taps, re-timed: gap(k) ms before tap k. */
const retimed = (log: LogEntry[], gap: (k: number) => number): LogEntry[] => {
  let t = log[0].t;
  return log.map((e, k) => {
    if (k > 0) t += gap(k);
    return { t, a: e.a };
  });
};
const pausedTimes = (n: number): LogEntry[] => {
  let log = honest();
  for (let k = 0; k < n; k++) log = withPause(log, 5 + 3 * k, 100);
  return log;
};

describe('judge', () => {
  it('ranks an honest run: ms is the span minus pauses minus the reveal', () => {
    expect(judged(honest())).toEqual({ ms: 7260 - REVEAL_MS, pausedMs: 0, pauses: 0, reason: null });
    const paused = withPause(honest(), 10, 5000);
    expect(judged(paused)).toEqual({ ms: solvedAt(paused) - 5000 - REVEAL_MS, pausedMs: 5000, pauses: 1, reason: null });
  });

  it('clock: the server saw more than 3 s that the log does not account for', () => {
    expect(judged(honest(), CLOCK_TOLERANCE_MS)?.reason).toBeNull();
    expect(judged(honest(), CLOCK_TOLERANCE_MS + 1)?.reason).toBe('clock');
  });

  it('refuses (null) a log that claims more than 3 s more than the server saw', () => {
    expect(judged(honest(), -CLOCK_TOLERANCE_MS)?.reason).toBeNull();
    expect(judged(honest(), -CLOCK_TOLERANCE_MS - 1)).toBeNull();
  });

  it('clock (kept, unranked) when the extra time the log claims fits inside its pauses: a wall clock that jumped during a reload', () => {
    const paused = withPause(honest(), 10, 5000);
    expect(judged(paused, -CLOCK_TOLERANCE_MS - 5000)).toMatchObject({ reason: 'clock', pausedMs: 5000 });
    expect(judged(paused, -CLOCK_TOLERANCE_MS - 5001)).toBeNull();
  });

  it('paused: more than 10 minutes of pauses, or more than 20 pauses', () => {
    expect(judged(withPause(honest(), 10, MAX_PAUSED_MS))?.reason).toBeNull();
    expect(judged(withPause(honest(), 10, MAX_PAUSED_MS + 1))?.reason).toBe('paused');
    expect(judged(pausedTimes(MAX_PAUSES))?.reason).toBeNull();
    expect(judged(pausedTimes(MAX_PAUSES + 1))?.reason).toBe('paused');
  });

  it('too_fast: under 5 s of ranked time', () => {
    // The quickest an honest client can go: first tap as the reveal ends (less the 50 ms of slack), 41 ms apart, on a tree with few turns to make.
    const start = REVEAL_MS - 50;
    let seed = 0;
    let quick: LogEntry[] = [];
    for (let s = 1; s <= 200 && !seed; s++) {
      const log = honest(start, 41, s);
      if ((judged(log, 300, s)?.ms ?? Infinity) < MIN_RANKED_MS) {
        seed = s;
        quick = log;
      }
    }
    expect(seed).toBeGreaterThan(0);
    expect(judged(quick, 300, seed)?.reason).toBe('too_fast');
  });

  it('too_fast: more than 10% of the gaps between taps under 40 ms', () => {
    const log = honest(); // 121 taps, 120 gaps
    expect(log).toHaveLength(121);
    expect(judged(retimed(log, (k) => (k <= 12 ? FAST_GAP_MS - 1 : 50)))?.reason).toBeNull(); // 12 of 120 is 10%
    expect(judged(retimed(log, (k) => (k <= 13 ? FAST_GAP_MS - 1 : 50)))?.reason).toBe('too_fast');
    expect(judged(retimed(log, () => 20).map((e) => ({ t: e.t + 10_000, a: e.a })))?.reason).toBe('too_fast');
  });

  it('gives one reason, in order: clock, then paused, then too_fast', () => {
    const pausedAndFast = withPause(honest(REVEAL_MS, 41), 10, MAX_PAUSED_MS + 1);
    expect(judged(pausedAndFast)?.reason).toBe('paused');
    expect(judged(pausedAndFast, CLOCK_TOLERANCE_MS + 1)?.reason).toBe('clock');
  });

  it('refuses a log that does not replay, another seed, or an unknown generator version', () => {
    expect(judge({ seed: SEED, genVersion: GEN_VERSION, log: honest().slice(0, -1), serverElapsedMs: 10_000 })).toBeNull();
    expect(judge({ seed: SEED + 1, genVersion: GEN_VERSION, log: honest(), serverElapsedMs: 7600 })).toBeNull();
    expect(judge({ seed: SEED, genVersion: 99, log: honest(), serverElapsedMs: 7600 })).toBeNull();
  });

  it('refuses a server time that is not a finite, non-negative number', () => {
    const log = honest();
    const at = solvedAt(log);
    for (const serverElapsedMs of [Number.NaN, Infinity, -Infinity, -1, -at]) {
      expect(judge({ seed: SEED, genVersion: GEN_VERSION, log, serverElapsedMs }), String(serverElapsedMs)).toBeNull();
    }
    expect(judge({ seed: SEED, genVersion: GEN_VERSION, log, serverElapsedMs: at + 300 })).not.toBeNull();
  });

  it('checks the log itself (defence in depth): out of order, off-tree, a double pause, too long', () => {
    const log = honest();
    const bad: LogEntry[][] = [
      [log[1], log[0], ...log.slice(2)], // time going backwards
      [{ t: log[0].t, a: 0 }, ...log.slice(1)], // the corner is not a tile
      [{ t: 900, a: 'p' }, { t: 901, a: 'p' }, ...log],
      Array.from({ length: MAX_LOG_ENTRIES + 1 }, () => ({ t: 1000, a: GRID.ids[0] })),
    ];
    for (const b of bad) expect(judge({ seed: SEED, genVersion: GEN_VERSION, log: b, serverElapsedMs: 10_000 })).toBeNull();
  });

  it('CPU guard: the longest legal log costs a bounded number of turn steps and lighting passes', () => {
    const seed = 77;
    const solve = honest(REVEAL_MS, 50, seed);
    // Whole turns of one tile (four taps, each 130 ms after the last: a hair over a 120 ms turn, so each starts a fresh one, change nothing), then the real solve: 5,000 entries at most.
    const tile = GRID.ids[5];
    const pad: LogEntry[] = [];
    for (let t = 1000; pad.length + solve.length + 4 <= MAX_LOG_ENTRIES; t += 130) pad.push({ t, a: tile });
    pad.length -= pad.length % 4;
    const offset = pad[pad.length - 1].t + 200;
    const log = [...pad, ...solve.map((e) => ({ t: e.t + offset, a: e.a }))];
    expect(log.length).toBeGreaterThan(MAX_LOG_ENTRIES - 8);
    expect(parseLog(log, GRID)).not.toBeNull();

    // Deterministic bounds: every accepted tap is one 90° step, so there are at most as many board ticks as taps,
    // and lighting passes are capped (an honest solve needs a handful).
    const board = seededBoard(seed, GEN_VERSION, true);
    if (!board) throw new Error('no board');
    const tick = vi.spyOn(board, 'tick');
    expect(replay(board, log)).not.toBeNull();
    expect(tick.mock.calls.length).toBeLessThanOrEqual(log.length);
    expect(board.bfsRuns).toBeLessThanOrEqual(MAX_REPLAY_BFS);

    // A loose sanity check on the clock too (about 1.5 ms on Luke's Mac; the Free plan allows 10 ms of CPU). The bound is
    // wide because the full suite runs ~70 files in parallel; the counts above are the real guard.
    const serverElapsedMs = solvedAt(log, seed) + 300;
    const times: number[] = [];
    for (let k = 0; k < 9; k++) {
      const s = performance.now();
      expect(judge({ seed, genVersion: GEN_VERSION, log, serverElapsedMs })?.reason).toBeNull();
      times.push(performance.now() - s);
    }
    times.sort((x, y) => x - y);
    expect(times[4]).toBeLessThan(100);
  });
});
