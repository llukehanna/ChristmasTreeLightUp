import { dailyClosesAt } from './daily.js';

/** What canWatch reads of a game: its owner, whether the owner has a name, how it ranked and whether a log was kept. */
export interface WatchRow {
  /** null for a guest's game. */
  user_id: number | null;
  /** 1 when the owner has a display name. */
  named: number;
  ranked: number;
  /** The Daily Tree's day number; null for a random game. */
  daily_day: number | null;
  /** 1 when a log was stored (an imported run has none). */
  has_log: number;
  /** null while the game is unfinished. */
  finished_at: number | null;
}

/**
 * Whether `viewerId` (null for a guest) may watch this game (C4 decision 1). The owner may watch any of their finished
 * runs that kept a log. Anyone may watch a logged run of a named player that is ranked (on a main board) or a Daily run
 * once its day has closed (dailyClosesAt), when the server stops taking a live attempt at it from anywhere. Everything
 * else is refused: unfinished, imported, a guest's, an unnamed player's, unranked random runs and still-open Dailies.
 */
export function canWatch(row: WatchRow, viewerId: number | null, nowMs: number): boolean {
  if (row.finished_at === null || row.has_log !== 1 || row.user_id === null) return false;
  if (viewerId === row.user_id) return true;
  if (row.named !== 1) return false;
  return row.ranked === 1 || (row.daily_day !== null && nowMs >= dailyClosesAt(row.daily_day));
}
