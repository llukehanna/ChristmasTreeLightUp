import { describe, expect, it, vi } from 'vitest';
import { REVEAL_MS } from '../../../src/core/clock';
import { CLOCK_TOLERANCE_MS, FAST_GAP_MS, judge, MAX_PAUSED_MS, MAX_PAUSES, MIN_RANKED_MS } from '../../../src/core/judge';
import { MAX_LOG_ENTRIES, parseLog, type LogEntry } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';
import { MAX_REPLAY_BFS, replay } from '../../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { asThreeCounterClockwise, shortestTaps, solvingTaps, withPause } from './solver';

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

/**
 * Frozen before counter-clockwise turns existed (seed 1: the scripted solver, 50 ms apart, with a 5 s pause while tile
 * 26 was turning; queued turns throughout), with the verdict the judge gave it then. It must never change.
 */
const OLD_LOG: LogEntry[] = (
  [
    [1000,9],[1050,9],[1100,9],[1150,23],[1200,23],[1250,23],[1300,25],[1350,25],[1400,26],[1450,26],[1451,'p'],[6451,'r'],[6501,26],[6551,27],[6601,27],[6651,42],[6701,44],[6751,44],[6801,55],[6851,56],[6901,57],[6951,57],[7001,57],[7051,59],[7101,60],[7151,61],[7201,61],[7251,61],[7301,62],[7351,62],[7401,62],[7451,63],[7501,63],[7551,63],[7601,71],[7651,71],[7701,72],[7751,73],[7801,74],[7851,75],[7901,75],[7951,75],[8001,76],[8051,77],[8101,79],[8151,79],[8201,79],[8251,80],[8301,80],[8351,81],[8401,81],[8451,89],[8501,89],[8551,90],[8601,91],[8651,91],[8701,93],[8751,94],[8801,95],[8851,96],[8901,97],[8951,97],[9001,97],[9051,98],[9101,99],[9151,99],[9201,103],[9251,105],[9301,105],[9351,105],[9401,106],[9451,107],[9501,107],[9551,108],[9601,108],[9651,108],[9701,109],[9751,109],[9801,110],[9851,110],[9901,110],[9951,112],[10001,112],[10051,113],[10101,115],[10151,117],[10201,117],[10251,120],[10301,121],[10351,121],[10401,124],[10451,124],[10501,125],[10551,125],[10601,125],[10651,126],[10701,126],[10751,128],[10801,128],[10851,128],[10901,132],[10951,132],[11001,132],[11051,134],[11101,136],[11151,138],[11201,138],[11251,138],[11301,142],[11351,143],[11401,146],[11451,146],[11501,147],[11551,147],[11601,147],[11651,148],[11701,148],[11751,148],[11801,150],[11851,150],[11901,152],[11951,152],[12001,152],
  ] as [number, number | 'p' | 'r'][]
).map(([t, a]) => ({ t, a }));

describe('counter-clockwise turns (a = ~tile)', () => {
  it('an old clockwise-only log still gives the identical verdict', () => {
    expect(parseLog(OLD_LOG, GRID)).toEqual(OLD_LOG);
    expect(solvedAt(OLD_LOG)).toBe(12261);
    expect(judge({ seed: SEED, genVersion: GEN_VERSION, log: OLD_LOG, serverElapsedMs: 12261 + 300 })).toEqual({ ms: 6361, pausedMs: 5000, pauses: 1, reason: null });
    expect(judge({ seed: SEED, genVersion: GEN_VERSION, log: OLD_LOG.slice(0, -1), serverElapsedMs: 12261 + 300 })).toBeNull();
  });

  it('every needed turn made as three counter-clockwise turns of the same tile ranks', () => {
    for (const seed of [1, 2, 3]) {
      const log = asThreeCounterClockwise(honest(1000, 50, seed));
      expect(log.every((e) => typeof e.a === 'number' && e.a < 0)).toBe(true);
      expect(parseLog(log, GRID)).toEqual(log);
      expect(judged(log, 300, seed)?.reason, `seed ${seed}`).toBeNull();
    }
  });

  it('one counter-clockwise turn in place of three clockwise ones solves with fewer taps', () => {
    for (const seed of [1, 2, 3]) {
      const b = seededBoard(seed, GEN_VERSION);
      if (!b) throw new Error('no board');
      const short = shortestTaps(b, 1000, 100);
      const long = honest(1000, 100, seed);
      expect(short.some((e) => typeof e.a === 'number' && e.a < 0)).toBe(true);
      expect(short.length).toBeLessThan(long.length);
      expect(long.length - short.length).toBe(2 * short.filter((e) => typeof e.a === 'number' && e.a < 0).length);
      expect(judged(short, 300, seed)?.reason, `seed ${seed}`).toBeNull();
    }
  });
});

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

    // The judge still ranks it. The counts above are the guard: wall-clock time depends on how busy the machine is.
    const serverElapsedMs = solvedAt(log, seed) + 300;
    expect(judge({ seed, genVersion: GEN_VERSION, log, serverElapsedMs })?.reason).toBeNull();
  });

  // About 1.5 ms on Luke's Mac; the Free plan allows 10 ms of CPU. Opt-in (PERF=1 npx vitest run tests/unit/core/judge.test.ts):
  // on a loaded machine it failed npm run deploy at 147 ms.
  it.runIf(process.env.PERF === '1')('the longest legal log judges in well under the Free plan CPU limit (PERF=1)', () => {
    const seed = 77;
    const solve = honest(REVEAL_MS, 50, seed);
    const tile = GRID.ids[5];
    const pad: LogEntry[] = [];
    for (let t = 1000; pad.length + solve.length + 4 <= MAX_LOG_ENTRIES; t += 130) pad.push({ t, a: tile });
    pad.length -= pad.length % 4;
    const offset = pad[pad.length - 1].t + 200;
    const log = [...pad, ...solve.map((e) => ({ t: e.t + offset, a: e.a }))];
    const serverElapsedMs = solvedAt(log, seed) + 300;
    const times: number[] = [];
    for (let k = 0; k < 9; k++) {
      const s = performance.now();
      expect(judge({ seed, genVersion: GEN_VERSION, log, serverElapsedMs })?.reason).toBeNull();
      times.push(performance.now() - s);
    }
    times.sort((x, y) => x - y);
    expect(times[4]).toBeLessThan(25); // generous: run it on a quiet machine
  });
});
