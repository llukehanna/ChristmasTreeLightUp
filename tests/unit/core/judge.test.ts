import { describe, expect, it } from 'vitest';
import { REVEAL_MS } from '../../../src/core/clock';
import { CLOCK_TOLERANCE_MS, FAST_GAP_MS, judge, MAX_PAUSED_MS, MAX_PAUSES, MIN_RANKED_MS } from '../../../src/core/judge';
import { MAX_LOG_ENTRIES, type LogEntry } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';
import { replay } from '../../../src/core/replay';
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
const judged = (log: LogEntry[], extra = 300) => judge({ seed: SEED, genVersion: GEN_VERSION, log, serverElapsedMs: solvedAt(log) + extra });
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

  it('paused: more than 10 minutes of pauses, or more than 20 pauses', () => {
    expect(judged(withPause(honest(), 10, MAX_PAUSED_MS))?.reason).toBeNull();
    expect(judged(withPause(honest(), 10, MAX_PAUSED_MS + 1))?.reason).toBe('paused');
    expect(judged(pausedTimes(MAX_PAUSES))?.reason).toBeNull();
    expect(judged(pausedTimes(MAX_PAUSES + 1))?.reason).toBe('paused');
  });

  it('too_fast: under 5 s of ranked time', () => {
    const quick = honest(0, 41); // 121 taps: about 4.3 s once the reveal is taken off
    expect(judged(quick)?.ms).toBeLessThan(MIN_RANKED_MS);
    expect(judged(quick)?.reason).toBe('too_fast');
  });

  it('too_fast: more than 10% of the gaps between taps under 40 ms', () => {
    const log = honest(); // 121 taps, 120 gaps
    expect(log).toHaveLength(121);
    expect(judged(retimed(log, (k) => (k <= 12 ? FAST_GAP_MS - 1 : 50)))?.reason).toBeNull(); // 12 of 120 is 10%
    expect(judged(retimed(log, (k) => (k <= 13 ? FAST_GAP_MS - 1 : 50)))?.reason).toBe('too_fast');
    expect(judged(retimed(log, () => 20).map((e) => ({ t: e.t + 10_000, a: e.a })))?.reason).toBe('too_fast');
  });

  it('gives one reason, in order: clock, then paused, then too_fast', () => {
    const pausedAndFast = withPause(honest(0, 41), 10, MAX_PAUSED_MS + 1);
    expect(judged(pausedAndFast)?.reason).toBe('paused');
    expect(judged(pausedAndFast, CLOCK_TOLERANCE_MS + 1)?.reason).toBe('clock');
  });

  it('refuses a log that does not replay, another seed, or an unknown generator version', () => {
    expect(judge({ seed: SEED, genVersion: GEN_VERSION, log: honest().slice(0, -1), serverElapsedMs: 10_000 })).toBeNull();
    expect(judge({ seed: SEED + 1, genVersion: GEN_VERSION, log: honest(), serverElapsedMs: 7600 })).toBeNull();
    expect(judge({ seed: SEED, genVersion: 99, log: honest(), serverElapsedMs: 7600 })).toBeNull();
  });

  it('CPU guard: the longest legal log replays well inside the Workers Free 10 ms budget', () => {
    const seed = 77;
    const solve = honest(0, 50, seed);
    // Whole turns of one tile (four taps 130 ms apart change nothing), then the real solve: 5,000 entries at most.
    const tile = GRID.ids[5];
    const pad: LogEntry[] = [];
    for (let t = 1000; pad.length + solve.length + 4 <= MAX_LOG_ENTRIES; t += 130) pad.push({ t, a: tile });
    pad.length -= pad.length % 4;
    const offset = pad[pad.length - 1].t + 200;
    const log = [...pad, ...solve.map((e) => ({ t: e.t + offset, a: e.a }))];
    expect(log.length).toBeGreaterThan(MAX_LOG_ENTRIES - 8);
    const serverElapsedMs = solvedAt(log, seed) + 300;
    const times: number[] = [];
    for (let k = 0; k < 9; k++) {
      const s = performance.now();
      expect(judge({ seed, genVersion: GEN_VERSION, log, serverElapsedMs })?.reason).toBeNull();
      times.push(performance.now() - s);
    }
    times.sort((x, y) => x - y);
    expect(times[4]).toBeLessThan(5); // the median; about 1.5 ms on Luke's Mac
  });
});
