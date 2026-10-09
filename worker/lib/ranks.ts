import { BOARD_TOP } from '../../src/api/types.js';
import type { Db } from './db.js';

/** Ranked runs by players who have a name: the only runs on the board (spec §2). */
const ON_BOARD = 'FROM games g JOIN users u ON u.id = g.user_id WHERE g.ranked = 1 AND u.name IS NOT NULL';

export const TOP = BOARD_TOP;

const TOTAL_SQL = `SELECT count(*) AS n ${ON_BOARD}`;

export async function boardTotal(db: Db): Promise<number> {
  return (await db.prepare(TOTAL_SQL).first<{ n: number }>())?.n ?? 0;
}

/** 1 + the board runs that beat (ms, finishedAt): faster, or as fast and finished earlier. */
export async function rankOf(db: Db, ms: number, finishedAt: number): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS n ${ON_BOARD} AND (g.ms < ?1 OR (g.ms = ?1 AND g.finished_at < ?2))`)
    .bind(ms, finishedAt)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

export interface BestRun {
  id: string;
  ms: number;
  finished_at: number;
}

/** The player's best ranked run: fastest, then earliest. Reads games_best in order (no sort). */
export const BEST_SQL = 'SELECT id, ms, finished_at FROM games WHERE user_id = ? AND ranked = 1 ORDER BY ms, finished_at LIMIT 1';

export function bestOf(db: Db, userId: number): Promise<BestRun | null> {
  return db.prepare(BEST_SQL).bind(userId).first<BestRun>();
}

/** The top BOARD_TOP runs: fastest, then earliest. Reads games_board (a partial index on ranked runs) in order. */
export const TOP_SQL = `SELECT g.id, g.user_id, u.name, g.ms, g.finished_at ${ON_BOARD} ORDER BY g.ms, g.finished_at, g.id LIMIT ${TOP}`;

export interface TopRow {
  id: string;
  user_id: number;
  name: string;
  ms: number;
  finished_at: number;
}

export async function topRuns(db: Db): Promise<TopRow[]> {
  return (await db.prepare(TOP_SQL).all<TopRow>()).results;
}

/** The top BOARD_TOP and the board total in one batch: one round trip, and both read the same snapshot. */
export async function topAndTotal(db: Db): Promise<{ top: TopRow[]; total: number }> {
  const [top, total] = await db.batch([db.prepare(TOP_SQL), db.prepare(TOTAL_SQL)]);
  return { top: top.results as TopRow[], total: (total.results[0] as { n: number } | undefined)?.n ?? 0 };
}

/** Ranks for rows in board order: a run tied with the one above (same ms and finish) shares its rank (spec §2's formula). */
export function rankRows(rows: readonly { ms: number; finished_at: number }[]): number[] {
  const ranks: number[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    ranks.push(prev && prev.ms === r.ms && prev.finished_at === r.finished_at ? ranks[i - 1] : i + 1);
  });
  return ranks;
}
