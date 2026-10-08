import type { Db } from './db.js';
import { boardTotal, topAndTotal, type TopRow } from './ranks.js';

/**
 * How long one isolate trusts its copy of the board. The total is a count over every ranked run (about 2 rows read per
 * run on the board) and was read on every finish, claim, board and Your games request; D1 Free allows 5 million rows
 * read a day. Another isolate's finish shows here within this long; one in this isolate shows at once (boardGrew).
 */
export const BOARD_TTL_MS = 20_000;

let top: { rows: TopRow[]; at: number } | null = null;
let total: { n: number; at: number } | null = null;

const fresh = (e: { at: number } | null, now: number): boolean => e !== null && now - e.at < BOARD_TTL_MS;

/** Forget the cached board (a name picked or an account deleted in this isolate; tests). */
export function resetBoardCache(): void {
  top = null;
  total = null;
}

/**
 * Runs just joined the board in this isolate (a ranked finish or claim by a named player): the top 50 are read again
 * next time, and a cached total counts them now, so the finish's own "#r of total" includes its run.
 */
export function boardGrew(added: number): void {
  if (added <= 0) return;
  top = null;
  if (total) total = { n: total.n + added, at: total.at };
}

/** The number of runs on the board, at most BOARD_TTL_MS old. */
export async function cachedTotal(db: Db, now = Date.now()): Promise<number> {
  if (total && fresh(total, now)) return total.n;
  const n = await boardTotal(db);
  total = { n, at: now };
  return n;
}

/** The top 50 runs and the board total (one batch on a miss), at most BOARD_TTL_MS old. Per-player rows stay live. */
export async function cachedTopAndTotal(db: Db, now = Date.now()): Promise<{ top: TopRow[]; total: number }> {
  if (top && total && fresh(top, now) && fresh(total, now)) return { top: top.rows, total: total.n };
  const r = await topAndTotal(db);
  top = { rows: r.top, at: now };
  total = { n: r.total, at: now };
  return r;
}
