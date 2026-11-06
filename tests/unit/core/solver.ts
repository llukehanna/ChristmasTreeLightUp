import type { Board } from '../../../src/core/board';
import { rotCW } from '../../../src/core/dirs';
import type { LogEntry } from '../../../src/core/log';

/** A scripted solver: taps that turn every tile of a settled board to its solution, in grid order, `gap` ms apart from `start`. */
export function solvingTaps(board: Board, start = 1000, gap = 50): LogEntry[] {
  if (board.rotating.size) throw new Error('solvingTaps needs a settled board');
  const out: LogEntry[] = [];
  let t = start;
  for (const i of board.grid.ids) {
    let b = board.bits[i];
    for (let k = 0; k < 4 && b !== board.solution[i]; k++) {
      out.push({ t, a: i });
      t += gap;
      b = rotCW(b);
    }
  }
  return out;
}

/**
 * `log` (taps only) with every tap of tile i replaced by three counter-clockwise taps of i (3 CCW = 1 CW): the three
 * `gap` ms apart, each group `spacing` ms after the last (long enough for a tile's whole queue to drain).
 */
export function asThreeCounterClockwise(log: readonly LogEntry[], start = 1000, gap = 50, spacing = 400): LogEntry[] {
  const out: LogEntry[] = [];
  let t = start;
  for (const { a } of log) {
    if (typeof a !== 'number' || a < 0) throw new Error('clockwise taps only');
    for (let k = 0; k < 3; k++) out.push({ t: t + k * gap, a: ~a });
    t += spacing;
  }
  return out;
}

/**
 * Like solvingTaps, but a tile that needs three clockwise turns gets one counter-clockwise turn (logged ~i) instead.
 * `tiles` picks which tiles to solve and in what order (every tile, in grid order, by default).
 */
export function shortestTaps(board: Board, start = 1000, gap = 50, tiles: readonly number[] = board.grid.ids): LogEntry[] {
  if (board.rotating.size) throw new Error('shortestTaps needs a settled board');
  const out: LogEntry[] = [];
  let t = start;
  for (const i of tiles) {
    let k = 0;
    for (let b = board.bits[i]; k < 4 && b !== board.solution[i]; k++) b = rotCW(b);
    const taps = k === 3 ? [~i] : Array.from({ length: k }, () => i);
    for (const a of taps) {
      out.push({ t, a });
      t += gap;
    }
  }
  return out;
}

/** `log` with a pause of `ms` just after entry k − 1: every entry from k on moves ms + 1 later. */
export function withPause(log: readonly LogEntry[], k: number, ms: number): LogEntry[] {
  const at = log[k - 1].t + 1;
  return [...log.slice(0, k), { t: at, a: 'p' }, { t: at + ms, a: 'r' }, ...log.slice(k).map((e) => ({ t: e.t + ms + 1, a: e.a }))];
}
