import { REVEAL_MS } from './clock';
import { parseLog, type LogEntry } from './log';
import { GRID } from './mask';
import { replay } from './replay';
import { seededBoard } from './seeded';

export const CLOCK_TOLERANCE_MS = 3000;
export const MAX_PAUSED_MS = 10 * 60_000;
export const MAX_PAUSES = 20;
export const MIN_RANKED_MS = 5000;
export const FAST_GAP_MS = 40;
export const MAX_FAST_GAP_SHARE = 0.1;

/** Why a verified run doesn't rank. 'anonymous' (played signed out) clears when the run is claimed. */
export type UnrankedReason = 'anonymous' | 'paused' | 'too_fast' | 'clock';

export interface Verdict {
  /** Ranked time: the span from the local start to the solve, minus pauses, minus the reveal. */
  ms: number;
  pausedMs: number;
  pauses: number;
  /** null: the run ranks (once it has an owner). */
  reason: Exclude<UnrankedReason, 'anonymous'> | null;
}

export interface JudgeInput {
  seed: number;
  genVersion: number;
  log: readonly LogEntry[];
  /** The server's clock: receipt of the finish minus the stamped start. */
  serverElapsedMs: number;
}

/** The server's verdict on a finished run (spec §5.3), or null when the log is unverifiable (422, and the game is deleted). */
export function judge({ seed, genVersion, log, serverElapsedMs }: JudgeInput): Verdict | null {
  if (!Number.isFinite(serverElapsedMs) || serverElapsedMs < 0) return null;
  const parsed = parseLog(log, GRID); // callers parse already; replay relies on it, so check again
  const board = parsed && seededBoard(seed, genVersion, true);
  const run = board && replay(board, parsed);
  if (!run) return null;
  const span = run.solvedAt;
  // More time in the log than passed on the server is impossible for an honest client, unless the extra time is
  // inside its pauses: a wall clock that jumped while the page was reloading. That run is kept, unranked ('clock').
  const claimed = span - serverElapsedMs - CLOCK_TOLERANCE_MS;
  if (claimed > run.pausedMs) return null;
  const ms = Math.max(0, span - run.pausedMs - REVEAL_MS);
  const gaps = run.tapTimes.slice(1).map((t, k) => t - run.tapTimes[k]);
  const fast = gaps.filter((g) => g < FAST_GAP_MS).length;
  const reason =
    claimed > 0 || serverElapsedMs - span > CLOCK_TOLERANCE_MS
      ? 'clock'
      : run.pausedMs > MAX_PAUSED_MS || run.pauses > MAX_PAUSES
        ? 'paused'
        : ms < MIN_RANKED_MS || fast > gaps.length * MAX_FAST_GAP_SHARE
          ? 'too_fast'
          : null;
  return { ms, pausedMs: run.pausedMs, pauses: run.pauses, reason };
}
