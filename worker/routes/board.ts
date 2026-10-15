import type { BoardResponse, BoardRow } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { HttpError, json } from '../lib/http.js';
import { cachedTopAndTotal } from '../lib/board-cache.js';
import { DAY_MS, localMidnight, mondayOf, viewerDay } from '../lib/days.js';
import { bestOf, rankOf, rankRows } from '../lib/ranks.js';
import { currentUser } from '../lib/users.js';

/**
 * The window's start in epoch ms, 0 for all time (spec 2026-10-14 §1): the viewer's local midnight today, or on the
 * Monday that starts this week, from the same ?today=&tz= as /api/me/stats. No window is all time (older pages).
 */
function windowStart(q: URLSearchParams): number {
  const w = q.get('window') ?? 'all';
  if (w === 'all') return 0;
  if (w !== 'today' && w !== 'week') throw new HttpError(400, 'invalid', 'window must be today, week or all.');
  const { today, tz } = viewerDay(q);
  // Each window is a cache key (board-cache.ts): only a real viewer's calendar makes one. Every viewer's local date is
  // the server's UTC date or one either side, and every zone in use is a whole quarter hour from UTC.
  if (Math.abs(today - Math.floor(Date.now() / DAY_MS)) > 1 || tz % 15 !== 0)
    throw new HttpError(400, 'invalid', "today must be within a day of the server's and tz a whole quarter hour.");
  const since = localMidnight(w === 'today' ? today : mondayOf(today), tz);
  return since > 0 ? since : 0;
}

/**
 * GET /api/board?window=today|week|all&today=YYYY-MM-DD&tz=<minutes>: the top BOARD_TOP runs in the window, its total,
 * and your best in it. Varies with the cookie (your rows), so the cache is private and short; each window and day is
 * its own URL, so the browser never mixes them. The top BOARD_TOP and the total come from the isolate's copy of that
 * window (BOARD_TTL_MS); your pinned best is read live.
 */
export async function getBoard(req: Request, env: AppEnv): Promise<Response> {
  const since = windowStart(new URL(req.url).searchParams);
  const user = await currentUser(req, env);
  const { top, total } = await cachedTopAndTotal(env.DB, Date.now(), since);
  const ranks = rankRows(top);
  const rows: BoardRow[] = top.map((r, i) => ({ rank: ranks[i], name: r.name, ms: r.ms, finishedAt: r.finished_at, mine: user !== null && r.user_id === user.id }));
  let you: BoardRow | null = null;
  if (user?.name && !rows.some((r) => r.mine)) {
    const best = await bestOf(env.DB, user.id, since);
    if (best) you = { rank: await rankOf(env.DB, best.ms, best.finished_at, since), name: user.name, ms: best.ms, finishedAt: best.finished_at, mine: true };
  }
  return json({ rows, total, you } satisfies BoardResponse, { headers: { 'Cache-Control': 'private, max-age=15', Vary: 'Cookie' } });
}
