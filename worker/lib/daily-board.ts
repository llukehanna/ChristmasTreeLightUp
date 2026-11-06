import { BOARD_TOP } from '../../src/api/types.js';
import type { Db } from './db.js';
import type { TopRow } from './ranks.js';

/**
 * A day's Daily board (plan C1, decision 1), bound as ?1 = the day number: for each named player, their earliest-started
 * live game for the day (daily_past = 0; a tie in started_at goes to the lower id), when it finished clean (reason
 * 'daily'). That first attempt counts finished or not, so one abandoned or judged unranked keeps the player off the
 * day's board: a later attempt never takes its place. Both lookups seek games_daily (daily_day, user_id, started_at).
 * The index bounds every read to the day's attempts, yet each still reads a few rows per attempt: the board's top and
 * total go through the isolate's copy of the day (board-cache.ts), as the main board's do; your own run and its place
 * are read live.
 */
const ON_DAILY =
  "FROM games g JOIN users u ON u.id = g.user_id WHERE g.daily_day = ?1 AND g.daily_past = 0 AND g.unranked_reason = 'daily' AND u.name IS NOT NULL" +
  ' AND NOT EXISTS (SELECT 1 FROM games e WHERE e.daily_day = ?1 AND e.user_id = g.user_id AND e.daily_past = 0 AND e.started_at <= g.started_at AND (e.started_at < g.started_at OR e.id < g.id))';

/** The day's top BOARD_TOP: fastest, then earliest finished, then id (the main board's order). */
export const DAILY_TOP_SQL = `SELECT g.id, g.user_id, u.name, g.ms, g.finished_at ${ON_DAILY} ORDER BY g.ms, g.finished_at, g.id LIMIT ${BOARD_TOP}`;
/** The runs on the day's board. */
export const DAILY_TOTAL_SQL = `SELECT count(*) AS n ${ON_DAILY}`;
/** The runs on the day's board that beat (?2 ms, ?3 finished_at): faster, or as fast and finished earlier. */
export const DAILY_RANK_SQL = `SELECT count(*) AS n ${ON_DAILY} AND (g.ms < ?2 OR (g.ms = ?2 AND g.finished_at < ?3))`;
/** Player ?2's run on the day's board, if they have one. */
export const DAILY_BEST_SQL = `SELECT g.id, g.user_id, u.name, g.ms, g.finished_at ${ON_DAILY} AND g.user_id = ?2`;
/** Player ?2's first attempt at day ?1, finished or not. */
export const DAILY_FIRST_SQL = 'SELECT id FROM games WHERE daily_day = ?1 AND user_id = ?2 AND daily_past = 0 ORDER BY started_at, id LIMIT 1';

/**
 * Player ?1's first attempt (finished or not) at each day in ?2, a JSON array of day numbers: one read for Your games,
 * by the same rule as DAILY_FIRST_SQL (earliest started_at, then the lower id). CROSS JOIN keeps the days outermost
 * (SQLite never reorders it), so each day seeks games_daily rather than the planner walking all the player's games.
 */
export const DAILY_FIRSTS_SQL =
  'SELECT g.id FROM json_each(?2) d CROSS JOIN games g WHERE g.daily_day = d.value AND g.user_id = ?1 AND g.daily_past = 0' +
  ' AND NOT EXISTS (SELECT 1 FROM games e WHERE e.daily_day = g.daily_day AND e.user_id = ?1 AND e.daily_past = 0 AND e.started_at <= g.started_at AND (e.started_at < g.started_at OR e.id < g.id))';

/** The runs on the day's board. */
export async function dailyTotal(db: Db, day: number): Promise<number> {
  return (await db.prepare(DAILY_TOTAL_SQL).bind(day).first<{ n: number }>())?.n ?? 0;
}

/** The day's top BOARD_TOP and its total in one batch: one round trip, and both read the same snapshot. */
export async function dailyTopAndTotal(db: Db, day: number): Promise<{ top: TopRow[]; total: number }> {
  const [top, total] = await db.batch([db.prepare(DAILY_TOP_SQL).bind(day), db.prepare(DAILY_TOTAL_SQL).bind(day)]);
  return { top: top.results as TopRow[], total: (total.results[0] as { n: number } | undefined)?.n ?? 0 };
}

/** 1 + the runs on the day's board that beat (ms, finishedAt). */
export async function dailyRankOf(db: Db, day: number, ms: number, finishedAt: number): Promise<number> {
  return ((await db.prepare(DAILY_RANK_SQL).bind(day, ms, finishedAt).first<{ n: number }>())?.n ?? 0) + 1;
}

/** The id of the player's first attempt at the day's tree (finished or not); null before they start it. */
export async function dailyFirstId(db: Db, userId: number, day: number): Promise<string | null> {
  return (await db.prepare(DAILY_FIRST_SQL).bind(day, userId).first<{ id: string }>())?.id ?? null;
}

/** The ids of the player's first attempts at `days` (one read; none when there are no days). */
export async function dailyFirstIds(db: Db, userId: number, days: readonly number[]): Promise<Set<string>> {
  if (days.length === 0) return new Set();
  const { results } = await db.prepare(DAILY_FIRSTS_SQL).bind(userId, JSON.stringify(days)).all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/** The player's own run on the day's board (the board's "you" pin); null when they have none there. */
export function dailyBestRow(db: Db, userId: number, day: number): Promise<TopRow | null> {
  return db.prepare(DAILY_BEST_SQL).bind(day, userId).first<TopRow>();
}
