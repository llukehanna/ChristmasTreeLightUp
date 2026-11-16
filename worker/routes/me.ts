import type { AccountStats, GhostResponse, HomeAloneResponse, MeResponse, ProgressResponse, StarHeadResponse } from '../../src/api/types.js';
import { evaluate } from '../../src/core/goals.js';
import { parseLog } from '../../src/core/log.js';
import { GRID } from '../../src/core/mask.js';
import type { AppEnv } from '../lib/env.js';
import { HttpError, json, readJson } from '../lib/http.js';
import { resetBoardCache } from '../lib/board-cache.js';
import { dayNumber, dayText, streaksOf, viewerDay } from '../lib/days.js';
import { historyOf } from '../lib/progress.js';
import { BEST_SQL, type BestRun } from '../lib/ranks.js';
import { clearSessionCookie, currentUser, publicUser, RENEW_UNDER_DAYS, requireUser, SESSION_DAYS, sessionCookie } from '../lib/users.js';

const DAY_MS = 86_400_000;

/** GET /api/me. Renews a session past its halfway point, so regular players stay signed in. */
export async function getMe(req: Request, env: AppEnv): Promise<Response> {
  const user = await currentUser(req, env);
  if (!user) return json({ user: null } satisfies MeResponse);
  const body: MeResponse = { user: publicUser(env, user) };
  if (user.expiresAt - Date.now() > RENEW_UNDER_DAYS * DAY_MS) return json(body);
  await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now() + SESSION_DAYS * DAY_MS, user.tokenHash).run();
  return json(body, { headers: { 'Set-Cookie': sessionCookie(user.token) } });
}

const norm = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '');

/** DELETE /api/me { confirm }: the display name, or the email before a name is picked. Games and sessions go too (cascade). */
export async function deleteMe(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  if (norm((await readJson(req)).confirm) !== norm(user.name ?? user.email)) throw new HttpError(400, 'confirm', 'Type it exactly as shown to confirm.');
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  resetBoardCache(); // the account's runs leave the board
  return json({}, { headers: { 'Set-Cookie': clearSessionCookie() } });
}

/**
 * PUT /api/me/star-head { on } (2026-10-08): the tree's topper preference, the account's copy. A users column, so
 * deleting the account takes it too. Nothing else on the server reads it.
 */
export async function setStarHead(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const on = (await readJson(req)).on;
  if (typeof on !== 'boolean') throw new HttpError(400, 'invalid', 'on must be true or false.');
  await env.DB.prepare('UPDATE users SET star_head = ? WHERE id = ?').bind(on ? 1 : 0, user.id).run();
  return json({ starHead: on } satisfies StarHeadResponse);
}

/**
 * PUT /api/me/home-alone { on } (2026-10-14): Home Alone mode, the account's copy. A users column like star_head, so
 * deleting the account takes it too. Nothing else on the server reads it; exclusivity with the head is the page's.
 */
export async function setHomeAlone(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const on = (await readJson(req)).on;
  if (typeof on !== 'boolean') throw new HttpError(400, 'invalid', 'on must be true or false.');
  await env.DB.prepare('UPDATE users SET home_alone = ? WHERE id = ?').bind(on ? 1 : 0, user.id).run();
  return json({ homeAlone: on } satisfies HomeAloneResponse);
}

/**
 * GET /api/me/stats?today=YYYY-MM-DD&tz=<minutes> (spec 2026-10-08 §3.2): the account's stats, the same on every
 * device. One batch of two statements: the totals folded into a GROUP BY local day (the days give the streaks), and
 * the best ranked run. Rows read are about two per finished game (the games_user index entry and the row).
 */
export async function myStats(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const { today, tz } = viewerDay(new URL(req.url).searchParams);
  const [daily, best] = await env.DB.batch([
    // A finish's local day, in days since 1970-01-01; the CAST keeps the division whole whatever type D1 binds the offset as.
    env.DB.prepare(
      "SELECT (finished_at - CAST(?2 AS INTEGER)) / 86400000 AS day, count(*) AS n, sum(ms) AS total, sum(source = 'import') AS imported FROM games WHERE user_id = ?1 AND finished_at IS NOT NULL GROUP BY day ORDER BY day",
    ).bind(user.id, tz * 60_000),
    env.DB.prepare(BEST_SQL).bind(user.id),
  ]);
  const rows = daily.results as { day: number; n: number; total: number; imported: number }[];
  const list = rows.map((r) => r.day);
  const { streak, longestStreak } = streaksOf(list, today);
  let solved = 0;
  let totalMs = 0;
  let imported = 0;
  for (const r of rows) {
    solved += r.n;
    totalMs += r.total;
    imported += r.imported;
  }
  const last = list.at(-1);
  return json({
    userId: user.id,
    solved,
    totalMs,
    averageMs: solved ? Math.round(totalMs / solved) : null,
    bestMs: (best.results[0] as BestRun | undefined)?.ms ?? null,
    streak,
    longestStreak,
    lastSolvedDay: last === undefined ? null : dayText(last),
    imported,
  } satisfies AccountStats);
}

/**
 * GET /api/me/progress (season two C2+C3): what the account has earned and how far along each goal is, from evaluate()
 * over all its rows (historyOf: one read of the rows and one of its top-10 Daily days). Nothing here is the browser's
 * word but a finish's reported context (zone, station, world).
 */
export async function myProgress(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const history = await historyOf(env.DB, user.id, Date.now());
  return json({ ...evaluate(history), treesLit: history.treesLit } satisfies ProgressResponse);
}

interface GhostRow {
  seed: number;
  gen_version: number;
  log: string;
  ms: number;
}

/**
 * GET /api/me/ghost?day=YYYY-MM-DD (C4 decision 6): your fastest run on that day's tree, to race. Any attempt, live or
 * past, so long as the judge didn't refuse it (paused, too_fast and clock never are a ghost). One indexed read
 * (games_daily). A stored log that doesn't parse is no ghost. The browser checks the seed and generator version.
 */
export async function myGhost(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const day = dayNumber(new URL(req.url).searchParams.get('day'));
  if (day === null) throw new HttpError(400, 'invalid', 'day must be YYYY-MM-DD.');
  const row = await env.DB.prepare(
    "SELECT seed, gen_version, log, ms FROM games WHERE user_id = ?1 AND daily_day = ?2 AND finished_at IS NOT NULL AND log IS NOT NULL AND (unranked_reason IS NULL OR unranked_reason IN ('daily', 'past', 'anonymous')) ORDER BY ms, finished_at LIMIT 1",
  )
    .bind(user.id, day)
    .first<GhostRow>();
  const log = row ? parseLog(safeJson(row.log), GRID) : null;
  const body: GhostResponse = { ghost: row && log ? { seed: row.seed, genVersion: row.gen_version, log, ms: row.ms } : null };
  return json(body);
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
