import type { Board } from './board';
import { REVEAL_MS } from './clock';
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

/**
 * Most full lighting passes a headless board may run during a replay. Honest play only reaches "every link matched,
 * nothing turning" at (almost) the solve; a log that keeps restoring that state without solving (turns of cross or
 * straight tiles on a cycle) is a CPU attack, so it is unverified.
 */
export const MAX_REPLAY_BFS = 50;

/** Taps earlier than this are refused: an honest client can't tap before the reveal ends (less slack for rounding and jitter). */
const EARLIEST_TAP_MS = REVEAL_MS - 50;

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
 * Plays `log` on `board` (a fresh headless board from the game's seed; the log must have passed parseLog) the way the
 * browser does: before each entry, turns finish at their exact times; then the tap goes in. Null when the log is not an honest client's: a tap while
 * paused, before the reveal ended, after the solve, or one the board drops (a full turn queue), a tree that never gets
 * solved, or one that costs more than MAX_REPLAY_BFS lighting passes. Pause time counts only from the reveal on.
 */
export function replay(board: Board, log: readonly LogEntry[]): Replay | null {
  let solvedAt: number | null = null;
  let paused = false;
  const tapTimes: number[] = [];
  for (const { t, a } of log) {
    if (solvedAt === null) solvedAt = advance(board, t);
    if (board.headless && board.bfsRuns > MAX_REPLAY_BFS) return null;
    if (a === 'p' || a === 'r') {
      paused = a === 'p';
      continue;
    }
    if (paused || solvedAt !== null || t < EARLIEST_TAP_MS || board.tap(a, t).length === 0) return null;
    tapTimes.push(t);
  }
  solvedAt ??= advance(board, Number.MAX_SAFE_INTEGER);
  if (solvedAt === null || (board.headless && board.bfsRuns > MAX_REPLAY_BFS)) return null;
  let pausedMs = 0;
  let pauses = 0;
  let since: number | null = null;
  for (const { t, a } of log) {
    if (a === 'p' && t < solvedAt) {
      since = t;
      pauses++;
    } else if (a === 'r' && since !== null) {
      pausedMs += Math.max(0, Math.min(t, solvedAt) - Math.max(since, REVEAL_MS));
      since = null;
    }
  }
  if (since !== null) pausedMs += Math.max(0, solvedAt - Math.max(since, REVEAL_MS));
  return { solvedAt, pausedMs, pauses, tapTimes };
}
