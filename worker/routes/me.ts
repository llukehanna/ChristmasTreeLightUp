import type { MeResponse, MyGamesResponse, RecentGame, UnrankedReason } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { HttpError, json, readJson } from '../lib/http.js';
import { cachedTopAndTotal, cachedTotal, resetBoardCache } from '../lib/board-cache.js';
import { bestOf, rankOf } from '../lib/ranks.js';
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

interface RecentRow {
  id: string;
  ms: number;
  finished_at: number;
  ranked: number;
  unranked_reason: UnrankedReason | null;
}

/** GET /api/me/games: your best and its rank, how many of the top 50 are yours, and your last 30 games. */
export async function myGames(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const [best, recent, { top, total }] = await Promise.all([
    bestOf(env.DB, user.id),
    env.DB.prepare('SELECT id, ms, finished_at, ranked, unranked_reason FROM games WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 30')
      .bind(user.id)
      .all<RecentRow>(),
    // The top 50 and the total from the isolate's copy (BOARD_TTL_MS); your best and its rank are read live.
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
  }));
  return json({
    best: best && { ms: best.ms, rank, finishedAt: best.finished_at },
    inTop: top.filter((r) => r.user_id === user.id).length,
    total,
    games,
  } satisfies MyGamesResponse);
}
