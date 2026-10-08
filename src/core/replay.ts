import type { Board } from './board';
import type { LogEntry } from './log';

export interface Replay {
  /** Log time of the solve: when the turn that lit the whole tree finished. */
  solvedAt: number;
  /** Paused time before the solve (a pause still open at the solve counts up to it). */
  pausedMs: number;
  /** Pauses begun before the solve. */
  pauses: number;
  /** Log times of the taps, in order. */
  tapTimes: number[];
}

/** Ticks `board` at each turn's exact finishing time up to `to`. Returns the time of the win if it happens on the way. */
function advance(board: Board, to: number): number | null {
  for (;;) {
    let next = Infinity;
    for (const r of board.rotating.values()) next = Math.min(next, r.t0 + board.rotateMs);
    if (next === Infinity || next > to) return null;
    if (board.tick(next).some((e) => e.type === 'won')) return next;
  }
}

/**
 * Plays `log` on `board` (a fresh board from the game's seed) the way the browser does: before each entry, turns
 * finish at their exact times; then the tap goes in. Null when the log is not an honest client's: a tap while
 * paused, after the solve, or one the board drops (a full turn queue), or a tree that never gets solved.
 */
export function replay(board: Board, log: readonly LogEntry[]): Replay | null {
  let solvedAt: number | null = null;
  let paused = false;
  const tapTimes: number[] = [];
  for (const { t, a } of log) {
    if (solvedAt === null) solvedAt = advance(board, t);
    if (a === 'p' || a === 'r') {
      paused = a === 'p';
      continue;
    }
    if (paused || solvedAt !== null || board.tap(a, t).length === 0) return null;
    tapTimes.push(t);
  }
  solvedAt ??= advance(board, Number.MAX_SAFE_INTEGER);
  if (solvedAt === null) return null;
  let pausedMs = 0;
  let pauses = 0;
  let since: number | null = null;
  for (const { t, a } of log) {
    if (a === 'p' && t < solvedAt) {
      since = t;
      pauses++;
    } else if (a === 'r' && since !== null) {
      pausedMs += Math.min(t, solvedAt) - since;
      since = null;
    }
  }
  if (since !== null) pausedMs += solvedAt - since;
  return { solvedAt, pausedMs, pauses, tapTimes };
}
