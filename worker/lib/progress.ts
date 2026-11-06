/**
 * Season two's goals on the server (Parts C2+C3): the context a finish reports, and a player's history as evaluate()
 * reads it. The facts (turns, the minimum, the feats) come from the replay at the finish (games.ts), never the browser.
 */
import type { RunContext, UnrankedReason } from '../../src/api/types.js';
import type { History, RunRecord } from '../../src/core/goals.js';
import { dailyTopTenDays } from './daily-board.js';
import { isTzOffset } from './days.js';
import type { Db } from './db.js';

const STATION = /^[a-z0-9-]{1,64}$/;

/** The finish body's `ctx`, or null when it is missing or anything in it doesn't check out (it is then dropped whole). */
export function runContextOf(value: unknown): RunContext | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { tz, station, world } = value as Record<string, unknown>;
  if (!isTzOffset(tz)) return null;
  if (station !== null && !(typeof station === 'string' && STATION.test(station))) return null;
  if (world !== null && world !== 'secret' && world !== 'home-alone') return null;
  return { tz, station, world };
}

interface RunRow {
  started_at: number;
  finished_at: number | null;
  ms: number | null;
  unranked_reason: UnrankedReason | null;
  source: string;
  daily_day: number | null;
  daily_past: number;
  turns: number | null;
  min_turns: number | null;
  feats: number | null;
  pauses: number | null;
  tz: number | null;
  station: string | null;
  world: 'secret' | 'home-alone' | null;
}

/** Every one of the player's games, finished or not, of any source (it seeks games_user). */
const RUNS_SQL =
  'SELECT started_at, finished_at, ms, unranked_reason, source, daily_day, daily_past, turns, min_turns, feats, pauses, tz, station, world FROM games WHERE user_id = ?';

/** The player's history for evaluate(): all their rows, the finished ones as trees lit, and their top-10 days by `nowMs`. */
export async function historyOf(db: Db, userId: number, nowMs: number): Promise<History> {
  const [{ results }, topTenDays] = await Promise.all([db.prepare(RUNS_SQL).bind(userId).all<RunRow>(), dailyTopTenDays(db, userId, nowMs)]);
  const runs = results.map(
    (r): RunRecord => ({
      started: r.started_at,
      finished: r.finished_at,
      ms: r.ms,
      reason: r.unranked_reason,
      imported: r.source === 'import',
      daily: r.daily_day,
      past: r.daily_past === 1,
      turns: r.turns,
      minTurns: r.min_turns,
      feats: r.feats,
      pauses: r.pauses,
      tz: r.tz,
      station: r.station,
      world: r.world,
    }),
  );
  return { treesLit: runs.filter((r) => r.finished !== null).length, runs, topTenDays };
}
