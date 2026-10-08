import { describe, expect, it } from 'vitest';
import { Board, ROTATE_MS } from '../../../src/core/board';
import { REVEAL_MS } from '../../../src/core/clock';
import { DIRS, OPPOSITE, degree, rotCW } from '../../../src/core/dirs';
import type { LogEntry } from '../../../src/core/log';
import { GRID, neighbor } from '../../../src/core/mask';
import { MAX_REPLAY_BFS, replay } from '../../../src/core/replay';
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

describe('the reveal window', () => {
  it('refuses a tap earlier than the reveal (less 50 ms of slack), accepts one at the edge', () => {
    expect(run(1, honest(1, REVEAL_MS - 50))).not.toBeNull();
    expect(run(1, honest(1, REVEAL_MS - 51))).toBeNull();
    expect(run(1, honest(1, 0))).toBeNull();
  });

  it('counts a pause that starts right at the reveal in full', () => {
    const log = honest(1, REVEAL_MS + 100);
    const bad: LogEntry[] = [{ t: REVEAL_MS, a: 'p' }, { t: REVEAL_MS + 5000, a: 'r' }, ...log.map((e) => ({ t: e.t + 5000, a: e.a }))];
    expect(run(1, bad)).toMatchObject({ pausedMs: 5000, pauses: 1 });
  });

  it('counts pause time only from the reveal on', () => {
    const log = honest(1, 3000);
    const early: LogEntry[] = [{ t: 0, a: 'p' }, { t: 2000, a: 'r' }, ...log];
    expect(run(1, early)).toMatchObject({ pausedMs: 2000 - REVEAL_MS, pauses: 1 });
    const over: LogEntry[] = [{ t: 0, a: 'p' }, { t: 500, a: 'r' }, ...log];
    expect(run(1, over)).toMatchObject({ pausedMs: 0, pauses: 1 });
  });
});

/**
 * A board with every link matched (n − 1 of them) and nothing turning, yet not one tree: the solution with one extra
 * link closing a cycle and a leaf cut loose. Without a cap, every settled 180° turn of a straight tile would run a full
 * lighting pass.
 */
function allMatchedButBroken(): { board: Board; spinner: number } {
  const solved = seededBoard(1, GEN_VERSION);
  if (!solved) throw new Error('no board');
  const bits = [...solved.solution];
  const leaf = GRID.ids.find((i) => i !== GRID.root && degree(bits[i]) === 1);
  if (leaf === undefined) throw new Error('no leaf');
  let closed = false;
  for (const i of GRID.ids) {
    for (const d of DIRS) {
      const j = neighbor(GRID, i, d);
      if (closed || j < 0 || i === leaf || j === leaf || bits[i] & d || bits[j] & OPPOSITE[d]) continue;
      bits[i] |= d;
      bits[j] |= OPPOSITE[d];
      closed = true;
    }
  }
  const dl = DIRS.find((d) => bits[leaf] & d);
  if (!closed || dl === undefined) throw new Error('no cycle');
  bits[neighbor(GRID, leaf, dl)] &= ~OPPOSITE[dl];
  bits[leaf] = 0;
  const spinner = GRID.ids.find((i) => i !== leaf && degree(bits[i]) === 2 && rotCW(rotCW(bits[i])) === bits[i]);
  if (spinner === undefined) throw new Error('no straight tile');
  return { board: new Board(GRID, { solution: [...solved.solution], bits, colors: [...solved.colors] }, ROTATE_MS, true), spinner };
}

describe('the lighting-pass cap', () => {
  it('premise: on such a board every second tap of a straight tile runs a lighting pass', () => {
    const { board, spinner } = allMatchedButBroken();
    for (let k = 0; k < 8; k++) {
      board.tap(spinner, 1000 + 130 * k);
      board.tick(1000 + 130 * k + ROTATE_MS);
    }
    expect(board.bfsRuns).toBe(4);
    expect(board.won).toBe(false);
  });

  it('replay gives up (unverified) soon after MAX_REPLAY_BFS passes instead of running thousands', () => {
    const { board, spinner } = allMatchedButBroken();
    const log: LogEntry[] = Array.from({ length: 5000 }, (_, k) => ({ t: 1000 + 130 * k, a: spinner }));
    expect(replay(board, log)).toBeNull();
    expect(board.bfsRuns).toBeGreaterThan(MAX_REPLAY_BFS);
    expect(board.bfsRuns).toBeLessThanOrEqual(MAX_REPLAY_BFS + 2);
  });

  it('an honest solve stays far under the cap', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const b = seededBoard(seed, GEN_VERSION, true);
      if (!b) throw new Error('no board');
      expect(replay(b, honest(seed))).not.toBeNull();
      expect(b.bfsRuns, `seed ${seed}`).toBeLessThanOrEqual(5);
    }
  });
});
