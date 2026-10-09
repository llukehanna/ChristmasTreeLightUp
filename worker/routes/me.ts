import type { AccountStats, MeResponse, MyGamesResponse, RecentGame, StarHeadResponse, UnrankedReason } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { HttpError, json, readJson } from '../lib/http.js';
import { cachedTopAndTotal, cachedTotal, resetBoardCache } from '../lib/board-cache.js';
import { dayNumber, dayText, isTzOffset, streaksOf } from '../lib/days.js';
import { BEST_SQL, bestOf, rankOf, type BestRun } from '../lib/ranks.js';
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

interface RecentRow {
  id: string;
  ms: number;
  finished_at: number;
  ranked: number;
  unranked_reason: UnrankedReason | null;
  source: string;
}

/** GET /api/me/games: your best and its rank, how many of the top BOARD_TOP are yours, and your last 30 games. */
export async function myGames(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const [best, recent, { top, total }] = await Promise.all([
    bestOf(env.DB, user.id),
    env.DB.prepare('SELECT id, ms, finished_at, ranked, unranked_reason, source FROM games WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 30')
      .bind(user.id)
      .all<RecentRow>(),
    // The top BOARD_TOP and the total from the isolate's copy (BOARD_TTL_MS); your best and its rank are read live.
    user.name ? cachedTopAndTotal(env.DB) : cachedTotal(env.DB).then((n) => ({ top: [], total: n })),
  ]);
  const rank = best && user.name ? await rankOf(env.DB, best.ms, best.finished_at) : null;
  const games: RecentGame[] = recent.results.map((g) => ({
    id: g.id,
    ms: g.ms,
    finishedAt: g.finished_at,
    ranked: g.ranked === 1,
    reason: g.unranked_reason,
    isBest: g.id === best?.id,
    imported: g.source === 'import',
  }));
  return json({
    best: best && { ms: best.ms, rank, finishedAt: best.finished_at },
    inTop: top.filter((r) => r.user_id === user.id).length,
    total,
    games,
  } satisfies MyGamesResponse);
}

const TZ = /^-?\d{1,3}$/;

/**
 * GET /api/me/stats?today=YYYY-MM-DD&tz=<minutes> (spec 2026-10-08 §3.2): the account's stats, the same on every
 * device. One batch of two statements: the totals folded into a GROUP BY local day (the days give the streaks), and
 * the best ranked run. Rows read are about two per finished game (the games_user index entry and the row).
 */
export async function myStats(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const q = new URL(req.url).searchParams;
  const today = dayNumber(q.get('today'));
  const tzText = q.get('tz') ?? '';
  const tz = TZ.test(tzText) ? Number(tzText) : Number.NaN;
  if (today === null || !isTzOffset(tz)) throw new HttpError(400, 'invalid', 'today must be YYYY-MM-DD and tz whole minutes from -840 to 840.');
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
