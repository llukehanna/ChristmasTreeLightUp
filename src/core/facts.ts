import type { Board, BoardEvent } from './board';
import { rotBy } from './dirs';
import { GRID } from './mask';
import { tapOf, type LogEntry } from './log';
import { EARLIEST_TAP_MS } from './replay';
import { orientationsOf } from './scramble';
import { seededBoard } from './seeded';

/** The bits of `RunFacts.feats`, one per feat. */
export const FEAT = { grand: 1, starLast: 2, neverDark: 4, steady: 8, comeback: 16 } as const;

/**
 * Tiles the winning turn must newly light for the grand switch-on. Tiles of any kind count: a tree has only about 33
 * bulb tiles (one link in the solution), so asking for 40 bulbs would be near-impossible, while 40 of its 97 tiles
 * is a real switch-on.
 */
export const GRAND_TILES = 40;

/** The star: the tile in row 0 above the source's column. */
export const STAR_TILE = GRID.sourceX;

/** Lit share of the tree a comeback must first pass, then fall under. */
const COMEBACK_HIGH = 0.8;
const COMEBACK_LOW = 0.3;

/**
 * The longest log whose facts are worth computing. runFacts lights the whole tree on every turn, so a log near the
 * 5,000-entry cap costs 5–15 times the judge's replay (past the Workers free plan's 10 ms of CPU). A run this long can't
 * be clean or perfect (a tree needs about 80 turns at least), so only a possible Comeback is given up.
 */
export const MAX_FACTS_ENTRIES = 1500;

export interface RunFacts {
  /** Taps made (a pause is not a turn). */
  turns: number;
  /** The tree's fewest turns from the start (see minTurnsOf). */
  minTurns: number;
  /** FEAT bits earned. */
  feats: number;
}

/**
 * The fewest quarter turns that take every tile from its current orientation to the generated solution's, each tile
 * going whichever way round is shorter: min(k, 4 − k) for k clockwise steps. A tile with fewer orientations costs less
 * (a straight tile is at most one turn away, a cross none). Another solution may be cheaper, so this is an upper bound
 * on the true minimum, which is how a run's `turns` is judged against it.
 */
export function minTurnsOf(board: Board): number {
  let total = 0;
  for (const i of board.grid.ids) {
    const classes = orientationsOf(board.solution[i]);
    let b = board.bits[i];
    let k = 0;
    while (b !== board.solution[i] && k < classes.length) {
      b = rotBy(b, 1);
      k++;
    }
    total += Math.min(k, 4 - k);
  }
  return total;
}

/** Where tile `i` will rest once every turn already begun or queued on it is done. */
function restingBits(board: Board, i: number): number {
  const r = board.rotating.get(i);
  if (!r) return board.bits[i];
  let b = r.to;
  for (const dir of r.queue) b = rotBy(b, dir);
  return b;
}

/**
 * A solved run's turns and the tree's minimum, counted from the log without lighting the tree: about the cost of one
 * board generation, so it is worth storing for every judged run, whatever its verdict. Counts the taps in the log as
 * runFacts does (a pause is not a turn) and agrees with it on every log that replays; it doesn't replay the log itself,
 * so the log must have passed the judge. Null for a seed or generator version with no tree.
 */
export function turnsOf(seed: number, genVersion: number, log: readonly LogEntry[]): { turns: number; minTurns: number } | null {
  const board = seededBoard(seed, genVersion, true);
  if (!board) return null;
  let turns = 0;
  for (const { a } of log) if (a !== 'p' && a !== 'r') turns++;
  return { turns, minTurns: minTurnsOf(board) };
}

/**
 * What a finished run did, from replaying its tap log on a full (non-headless) board: turns, the tree's minimum, and
 * the feats earned (see FEAT). Plays the log exactly as replay() does, so it is null in the same cases: a tap while
 * paused, before the reveal ended, after the solve, one the board drops, or a tree that never gets solved. The log must
 * have passed parseLog, and should already have passed replay(): this lights the whole tree on every turn, which only
 * a log worth that much work should cost.
 */
export function runFacts(seed: number, genVersion: number, log: readonly LogEntry[]): RunFacts | null {
  const board = seededBoard(seed, genVersion, false);
  if (!board) return null;
  const tiles = board.grid.ids.length;
  const minTurns = minTurnsOf(board);
  let lit = board.lighting.count;
  let turns = 0;
  let steady = true;
  let neverDark = true;
  let high = false;
  let low = false;
  let grand = false;
  let starLast = false;

  const note = (events: readonly BoardEvent[]): void => {
    events.forEach((e, k) => {
      if (e.type === 'lightingChanged') {
        lit += e.newlyLit.length - e.lost.length;
        if (e.lost.length > 0) neverDark = false;
        const share = lit / tiles;
        if (share > COMEBACK_HIGH) high = true;
        else if (high && share < COMEBACK_LOW) low = true;
      } else if (e.type === 'won') {
        const last = events[k - 1]; // the winning turn's own lighting event comes just before the win
        if (last?.type !== 'lightingChanged') return;
        grand = last.newlyLit.length >= GRAND_TILES;
        starLast = last.newlyLit.includes(STAR_TILE);
      }
    });
  };

  let solvedAt: number | null = null;
  let paused = false;
  for (const { t, a } of log) {
    if (solvedAt === null) {
      const events: BoardEvent[] = [];
      solvedAt = board.advanceTo(t, events);
      note(events);
    }
    if (a === 'p' || a === 'r') {
      paused = a === 'p';
      continue;
    }
    if (paused || solvedAt !== null || t < EARLIEST_TAP_MS) return null;
    const { tile, dir } = tapOf(a);
    const resting = restingBits(board, tile);
    const events = board.tap(tile, t, dir);
    if (events.length === 0) return null;
    turns++;
    if (resting === board.solution[tile]) steady = false;
    note(events);
  }
  if (solvedAt === null) {
    const events: BoardEvent[] = [];
    solvedAt = board.advanceTo(Number.MAX_SAFE_INTEGER, events);
    note(events);
  }
  if (solvedAt === null) return null;
  const feats =
    (grand ? FEAT.grand : 0) | (starLast ? FEAT.starLast : 0) | (neverDark ? FEAT.neverDark : 0) | (steady ? FEAT.steady : 0) | (high && low ? FEAT.comeback : 0);
  return { turns, minTurns, feats };
}
