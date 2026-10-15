import { BOARD_TOP } from '../../src/api/types.js';
import type { Db } from './db.js';

/** Ranked runs by players who have a name: the only runs on the board (spec §2). */
const ON_BOARD = 'FROM games g JOIN users u ON u.id = g.user_id WHERE g.ranked = 1 AND u.name IS NOT NULL';

export const TOP = BOARD_TOP;

/**
 * A board window (spec 2026-10-14 §3): runs finished at or after `since` (epoch ms), bound as parameter `n`. A
 * `since` of 0 (or before) is all time: no bound at all, so the all-time statements are exactly as before.
 */
const inWindow = (since: number, n: number): string => (since > 0 ? ` AND g.finished_at >= ?${n}` : '');

const TOTAL_SQL = `SELECT count(*) AS n ${ON_BOARD}`;

function totalStatement(db: Db, since: number) {
  return since > 0 ? db.prepare(`${TOTAL_SQL}${inWindow(since, 1)}`).bind(since) : db.prepare(TOTAL_SQL);
}

/** The board runs in the window from `since` (all of them by default). */
export async function boardTotal(db: Db, since = 0): Promise<number> {
  return (await totalStatement(db, since).first<{ n: number }>())?.n ?? 0;
}

/** 1 + the board runs (in the window from `since`) that beat (ms, finishedAt): faster, or as fast and finished earlier. */
export async function rankOf(db: Db, ms: number, finishedAt: number, since = 0): Promise<number> {
  const sql = `SELECT count(*) AS n ${ON_BOARD} AND (g.ms < ?1 OR (g.ms = ?1 AND g.finished_at < ?2))${inWindow(since, 3)}`;
  const row = await (since > 0 ? db.prepare(sql).bind(ms, finishedAt, since) : db.prepare(sql).bind(ms, finishedAt)).first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

export interface BestRun {
  id: string;
  ms: number;
  finished_at: number;
}

/** The player's best ranked run: fastest, then earliest. Reads games_best in order (no sort). */
export const BEST_SQL = 'SELECT id, ms, finished_at FROM games WHERE user_id = ? AND ranked = 1 ORDER BY ms, finished_at LIMIT 1';
/** The same, among the runs finished at or after a window's start: games_best in order, skipping the older runs. */
const BEST_SINCE_SQL = 'SELECT id, ms, finished_at FROM games WHERE user_id = ?1 AND ranked = 1 AND finished_at >= ?2 ORDER BY ms, finished_at LIMIT 1';

/** The player's best ranked run, in the window from `since` (all time by default). */
export function bestOf(db: Db, userId: number, since = 0): Promise<BestRun | null> {
  return since > 0 ? db.prepare(BEST_SINCE_SQL).bind(userId, since).first<BestRun>() : db.prepare(BEST_SQL).bind(userId).first<BestRun>();
}

/** The top BOARD_TOP runs (in the window from `since`): fastest, then earliest. Reads games_board (a partial index on ranked runs) in order. */
export const topSql = (since = 0): string => `SELECT g.id, g.user_id, u.name, g.ms, g.finished_at ${ON_BOARD}${inWindow(since, 1)} ORDER BY g.ms, g.finished_at, g.id LIMIT ${TOP}`;
export const TOP_SQL = topSql();

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

/** The top BOARD_TOP and the board total (in the window from `since`) in one batch: one round trip, and both read the same snapshot. */
export async function topAndTotal(db: Db, since = 0): Promise<{ top: TopRow[]; total: number }> {
  const topStatement = since > 0 ? db.prepare(topSql(since)).bind(since) : db.prepare(TOP_SQL);
  const [top, total] = await db.batch([topStatement, totalStatement(db, since)]);
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
