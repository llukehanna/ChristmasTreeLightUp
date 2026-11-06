import { describe, expect, it } from 'vitest';
import { Board, computeLighting } from '../../../src/core/board';
import { REVEAL_MS } from '../../../src/core/clock';
import { D, degree, rotCCW, rotCW } from '../../../src/core/dirs';
import { FEAT, GRAND_TILES, STAR_TILE, minTurnsOf, runFacts } from '../../../src/core/facts';
import type { LogEntry } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';
import { seededBoard } from '../../../src/core/seeded';
import { shortestTaps, solvingTaps, withPause } from './solver';

/** An ordinary tree, whose root is already a cross, whose star needs no turn, and whose grid-order solve ends with a small branch lighting. */
const SEED = 1;
/** A tree whose root starts without a link to the source and needs two turns. */
const GRAND_SEED = 156;
/** A tree whose star tile needs three clockwise turns (one counter-clockwise). */
const STAR_SEED = 5;

const board = (seed: number): Board => {
  const b = seededBoard(seed, 1);
  if (!b) throw new Error('no board');
  return b;
};

/** Clockwise steps (0 to 3) that turn `bits` into `want`. */
const stepsTo = (bits: number, want: number): number => {
  let k = 0;
  for (let b = bits; b !== want && k < 4; k++) b = rotCW(b);
  return k;
};

const expectedFromBits = (b: Board): number => b.grid.ids.reduce((sum, i) => sum + Math.min(stepsTo(b.bits[i], b.solution[i]), 4 - stepsTo(b.bits[i], b.solution[i])), 0);

const shortestLog = (seed: number): LogEntry[] => shortestTaps(board(seed));

/** `log` then `more`, the second starting 600 ms after the first's last entry (every turn of the first has finished). */
const after = (log: readonly LogEntry[], more: (start: number) => LogEntry[]): LogEntry[] => [...log, ...more(log[log.length - 1].t + 600)];

/** Four turns of `tile` in a row, 50 ms apart: it ends where it began. */
const spin = (tile: number, start: number): LogEntry[] => [0, 1, 2, 3].map((k) => ({ t: start + 50 * k, a: tile }));

const tilesBut = (tile: number): number[] => GRID.ids.filter((i) => i !== tile);

/** Every tile solved the shortest way, `tile` held back until the others have all settled. */
const lastly = (b: Board, tile: number): LogEntry[] => after(shortestTaps(b, 1000, 50, tilesBut(tile)), (start) => shortestTaps(b, start, 50, [tile]));

/** Solution tiles from the root outward (a tile always comes after the one that powers it). */
const outward = (b: Board): number[] => computeLighting(GRID, b.solution).order;

describe('minTurnsOf', () => {
  it('costs one turn for a corner three steps short, one for a straight tile a step away, two for a T half way round and none for a cross', () => {
    const b = board(SEED);
    const bits = [...b.solution];
    const corner = GRID.ids.find((i) => degree(b.solution[i]) === 2 && rotCW(b.solution[i]) !== rotCCW(b.solution[i]));
    const straight = GRID.ids.find((i) => degree(b.solution[i]) === 2 && rotCW(b.solution[i]) === rotCCW(b.solution[i]));
    const tee = GRID.ids.find((i) => degree(b.solution[i]) === 3);
    const cross = GRID.ids.find((i) => degree(b.solution[i]) === 4);
    if (corner === undefined || straight === undefined || tee === undefined || cross === undefined) throw new Error('no such tile');
    bits[corner] = rotCW(b.solution[corner]); // three clockwise turns short of the solution: one counter-clockwise
    bits[straight] = rotCW(b.solution[straight]); // a straight tile has two orientations: one turn either way
    bits[tee] = rotCW(rotCW(b.solution[tee])); // half way round: two turns
    bits[cross] = b.solution[cross]; // a cross is always solved
    const scrambled = new Board(GRID, { solution: [...b.solution], bits, colors: [...b.colors] });
    expect(minTurnsOf(scrambled)).toBe(1 + 1 + 2);
  });

  it('is the fewest turns either way: a three-step tile costs one counter-clockwise turn', () => {
    for (const seed of [SEED, 2, 3, 156]) {
      const b = board(seed);
      expect(minTurnsOf(b), `seed ${seed}`).toBe(expectedFromBits(b));
      expect(GRID.ids.some((i) => stepsTo(b.bits[i], b.solution[i]) === 3), `seed ${seed}`).toBe(true);
    }
  });

  it('is nothing for a solved board', () => {
    const b = board(SEED);
    b.debugSolve();
    expect(minTurnsOf(b)).toBe(0);
  });
});

describe('runFacts: turns', () => {
  it('a solve by the shortest way has turns === minTurns, with counter-clockwise taps in the log', () => {
    const log = shortestLog(SEED);
    const f = runFacts(SEED, 1, log);
    expect(f).not.toBeNull();
    expect(f?.turns).toBe(f?.minTurns);
    expect(f?.minTurns).toBe(minTurnsOf(board(SEED)));
    expect(log.some((e) => typeof e.a === 'number' && e.a < 0)).toBe(true);
  });

  it('three clockwise turns instead of one counter-clockwise cost more than the minimum', () => {
    const b = board(SEED);
    const f = runFacts(SEED, 1, solvingTaps(b));
    expect(f?.turns).toBeGreaterThan(f?.minTurns ?? Infinity);
    expect(f?.minTurns).toBe(minTurnsOf(b));
  });

  it('turns count taps only, not pauses', () => {
    const log = shortestLog(SEED);
    const paused = withPause(withPause(log, 10, 5000), 30, 3000);
    expect(paused.filter((e) => e.a === 'p' || e.a === 'r')).toHaveLength(4);
    const f = runFacts(SEED, 1, paused);
    expect(f?.turns).toBe(log.length);
    expect(f).toEqual(runFacts(SEED, 1, log));
  });
});

describe('runFacts: steady hand', () => {
  it('is kept when every tap turns a tile that is not yet in its solved orientation', () => {
    expect((runFacts(SEED, 1, shortestLog(SEED))?.feats ?? 0) & FEAT.steady).toBe(FEAT.steady);
  });

  it('is lost by turning a tile already in its solved orientation', () => {
    const b = board(SEED);
    const solved = GRID.ids.find((i) => b.bits[i] === b.solution[i] && degree(b.solution[i]) < 4);
    if (solved === undefined) throw new Error('no solved tile');
    const wasted = after(spin(solved, 1000), (start) => shortestTaps(b, start)); // 4 turns of a solved tile
    const f = runFacts(SEED, 1, wasted);
    expect(f).not.toBeNull();
    expect((f?.feats ?? 0) & FEAT.steady).toBe(0);
    expect(f?.turns).toBe((f?.minTurns ?? 0) + 4);
  });

  it('counts the turns already queued toward a tile: turning back from a solved orientation still in flight is wasted', () => {
    // A tile one turn away: clockwise lands it on the solution, counter-clockwise leaves it again, clockwise lands it for good.
    const b = board(SEED);
    const one = GRID.ids.find((i) => stepsTo(b.bits[i], b.solution[i]) === 1);
    if (one === undefined) throw new Error('no tile one turn away');
    const log = after(shortestTaps(b, 1000, 50, tilesBut(one)), (start) => [one, ~one, one].map((a, k) => ({ t: start + 50 * k, a })));
    const f = runFacts(SEED, 1, log);
    expect(f).not.toBeNull();
    expect(f?.turns).toBe(expectedFromBits(b) - 1 + 3);
    expect((f?.feats ?? 0) & FEAT.steady).toBe(0);
  });
});

describe('runFacts: never dark', () => {
  it('is kept when no lit tile goes dark before the win', () => {
    // The root has no link to the source, so nothing is lit until the root's last turn: taps never darken a lit tile.
    const b = board(GRAND_SEED);
    expect(b.bits[GRID.root] & D).toBe(0);
    const f = runFacts(GRAND_SEED, 1, lastly(b, GRID.root));
    expect((f?.feats ?? 0) & FEAT.neverDark).toBe(FEAT.neverDark);
  });

  it('is lost when a lit tile goes dark', () => {
    // Solve the root (it lights), turn it away and back (it goes dark), then finish the rest.
    const b = board(GRAND_SEED);
    const log = after(after(shortestTaps(b, 1000, 50, [GRID.root]), (start) => spin(GRID.root, start)), (start) => shortestTaps(b, start, 50, tilesBut(GRID.root)));
    const f = runFacts(GRAND_SEED, 1, log);
    expect(f).not.toBeNull();
    expect((f?.feats ?? 0) & FEAT.neverDark).toBe(0);
  });
});

describe('runFacts: star last', () => {
  it('is set when the star tile is lit by the winning turn', () => {
    const b = board(STAR_SEED);
    expect(stepsTo(b.bits[STAR_TILE], b.solution[STAR_TILE])).toBeGreaterThan(0);
    const f = runFacts(STAR_SEED, 1, lastly(b, STAR_TILE));
    expect((f?.feats ?? 0) & FEAT.starLast).toBe(FEAT.starLast);
  });

  it('is not set when the star was lit earlier', () => {
    const f = runFacts(STAR_SEED, 1, shortestLog(STAR_SEED)); // row 0 comes first in grid order: the star lights long before the end
    expect(f).not.toBeNull();
    expect((f?.feats ?? 0) & FEAT.starLast).toBe(0);
  });

  it('is the row-0 tile above the source', () => {
    expect(STAR_TILE).toBe(GRID.sourceX);
    expect(GRID.cells[STAR_TILE]).toBe(true);
  });
});

describe('runFacts: grand switch-on', () => {
  it('is set when the winning turn lights 40 or more tiles', () => {
    const b = board(GRAND_SEED);
    expect(b.grid.ids.length).toBeGreaterThanOrEqual(GRAND_TILES);
    const f = runFacts(GRAND_SEED, 1, lastly(b, GRID.root)); // hold the root's turn to the end: the whole tree lights at once
    expect((f?.feats ?? 0) & FEAT.grand).toBe(FEAT.grand);
  });

  it('is not set when the tree lights bit by bit and the winning turn lights fewer than 40 tiles', () => {
    for (const seed of [GRAND_SEED, SEED]) {
      const f = runFacts(seed, 1, shortestLog(seed));
      expect(f, `seed ${seed}`).not.toBeNull();
      expect((f?.feats ?? 0) & FEAT.grand, `seed ${seed}`).toBe(0);
    }
  });

  it('counts tiles of any kind, not only bulbs: a tree with fewer than 40 bulb tiles still earns it', () => {
    const b = board(2); // 33 bulb tiles; the root needs one turn
    expect(GRID.ids.filter((i) => degree(b.solution[i]) === 1).length).toBeLessThan(GRAND_TILES);
    const f = runFacts(2, 1, lastly(b, GRID.root));
    expect(f).not.toBeNull();
    expect((f?.feats ?? 0) & FEAT.grand).toBe(FEAT.grand);
  });

  it('a root held to the end lights the star too, never darkens a lit tile and keeps a steady hand: all but the comeback', () => {
    const b = board(GRAND_SEED);
    const f = runFacts(GRAND_SEED, 1, lastly(b, GRID.root));
    expect(f?.feats).toBe(FEAT.grand | FEAT.starLast | FEAT.neverDark | FEAT.steady);
  });
});

describe('runFacts: comeback', () => {
  it('is set by passing 80% lit, falling under 30%, then winning', () => {
    const b = board(SEED);
    const head = outward(b).slice(0, 85); // 85 of 97 tiles, lit as they are solved
    const solved = after(shortestTaps(b, 1000, 50, head), (start) => spin(GRID.root, start)); // the root turned away: all dark
    const log = after(solved, (start) => shortestTaps(b, start, 50, GRID.ids.filter((i) => !head.includes(i))));
    const f = runFacts(SEED, 1, log);
    expect(f).not.toBeNull();
    expect((f?.feats ?? 0) & FEAT.comeback).toBe(FEAT.comeback);
  });

  it('is not set when the tree never passes 80% before the dip', () => {
    const b = board(SEED);
    const head = outward(b).slice(0, 50); // about half
    const solved = after(shortestTaps(b, 1000, 50, head), (start) => spin(GRID.root, start));
    const log = after(solved, (start) => shortestTaps(b, start, 50, GRID.ids.filter((i) => !head.includes(i))));
    const f = runFacts(SEED, 1, log);
    expect(f).not.toBeNull();
    expect((f?.feats ?? 0) & FEAT.comeback).toBe(0);
  });

  it('is not set when it never falls under 30%', () => {
    const b = board(SEED);
    const head = outward(b).slice(0, 85);
    const log = after(shortestTaps(b, 1000, 50, head), (start) => shortestTaps(b, start, 50, GRID.ids.filter((i) => !head.includes(i))));
    const f = runFacts(SEED, 1, log);
    expect(f).not.toBeNull();
    expect((f?.feats ?? 0) & FEAT.comeback).toBe(0);
  });
});

describe('runFacts: a log that does not replay to a win', () => {
  it('is null for a log that never wins', () => {
    expect(runFacts(SEED, 1, [])).toBeNull();
    expect(runFacts(SEED, 1, shortestLog(SEED).slice(0, -1))).toBeNull();
  });

  it('is null for a tap after the solve', () => {
    const log = shortestLog(SEED);
    expect(runFacts(SEED, 1, [...log, { t: log[log.length - 1].t + 2000, a: GRID.ids[0] }])).toBeNull();
  });

  it('is null for a tap inside a pause', () => {
    const log = shortestLog(SEED);
    const bad: LogEntry[] = [...log.slice(0, 5), { t: log[4].t + 1, a: 'p' }, log[5], { t: log[5].t + 10, a: 'r' }, ...log.slice(6).map((e) => ({ t: e.t + 10, a: e.a }))];
    expect(runFacts(SEED, 1, bad)).toBeNull();
  });

  it('is null for a tap before the reveal ends, and fine at the edge', () => {
    const b = board(SEED);
    expect(runFacts(SEED, 1, shortestTaps(b, REVEAL_MS - 50))).not.toBeNull();
    expect(runFacts(SEED, 1, shortestTaps(b, REVEAL_MS - 51))).toBeNull();
  });

  it('is null when a tap is dropped because the tile\'s turn queue was full', () => {
    const b = board(SEED);
    const tile = GRID.ids[3];
    const log = [...[0, 10, 20, 30, 40].map((t) => ({ t: 2000 + t, a: tile })), ...shortestTaps(b, 3000)];
    expect(runFacts(SEED, 1, log)).toBeNull();
  });

  it('is null for a generator version nobody knows', () => {
    expect(runFacts(SEED, 99, shortestLog(SEED))).toBeNull();
  });
});
