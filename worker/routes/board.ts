import { BOARD_WINDOWS, type BoardResponse, type BoardRow, type BoardWindow } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { HttpError, json } from '../lib/http.js';
import { cachedDailyTopAndTotal, cachedTopAndTotal } from '../lib/board-cache.js';
import { dailyClosesAt } from '../lib/daily.js';
import { DAY_MS, localMidnight, mondayOf, viewerDay } from '../lib/days.js';
import { dailyBestRow, dailyRankOf } from '../lib/daily-board.js';
import { bestOf, rankOf, rankRows, type TopRow } from '../lib/ranks.js';
import { currentUser, type SessionUser } from '../lib/users.js';

/**
 * The viewer's local date from ?today=&tz= (as /api/me/stats reads them), clamped to the server's UTC date ±1. Each
 * window is a cache key (board-cache.ts): only a real viewer's calendar makes one. Every zone in use is a whole quarter
 * hour from UTC, and every viewer's local date is the server's UTC date or one either side, so a day further off (a
 * device with a wrong clock) is clamped to the nearest of those: it still sees a board, and makes no new key.
 */
function viewerToday(q: URLSearchParams): { today: number; tz: number } {
  const { today: asked, tz } = viewerDay(q);
  if (tz % 15 !== 0) throw new HttpError(400, 'invalid', 'tz must be a whole quarter hour.');
  const server = Math.floor(Date.now() / DAY_MS);
  return { today: Math.min(server + 1, Math.max(server - 1, asked)), tz };
}

/**
 * The window's start in epoch ms, 0 for all time (spec 2026-10-14 §1): the viewer's local midnight today, or on the
 * Monday that starts this week. No window is all time (older pages).
 */
function windowStart(w: Exclude<BoardWindow, 'daily'>, q: URLSearchParams): number {
  if (w === 'all') return 0;
  const { today, tz } = viewerToday(q);
  const since = localMidnight(w === 'today' ? today : mondayOf(today), tz);
  return since > 0 ? since : 0;
}

const isWindow = (w: string): w is BoardWindow => (BOARD_WINDOWS as readonly string[]).includes(w);

/** The board's rows from its top BOARD_TOP, and your row pinned below them when none of those is yours. */
async function boardOf(
  top: readonly TopRow[],
  total: number,
  user: SessionUser | null,
  watchable: (r: TopRow) => boolean,
  yours: (u: SessionUser & { name: string }) => Promise<BoardRow | null>,
): Promise<BoardResponse> {
  const ranks = rankRows(top);
  const rows: BoardRow[] = top.map((r, i) => ({ id: r.id, rank: ranks[i], name: r.name, ms: r.ms, finishedAt: r.finished_at, mine: user !== null && r.user_id === user.id, replay: watchable(r) }));
  const you = user?.name && !rows.some((r) => r.mine) ? await yours({ ...user, name: user.name }) : null;
  return { rows, total, you };
}

/**
 * GET /api/board?window=daily|today|week|all&today=YYYY-MM-DD&tz=<minutes>: the top BOARD_TOP runs in the window, its
 * total, and your best in it. Varies with the cookie (your rows), so the cache is private and short; each window and
 * day is its own URL, so the browser never mixes them. The main windows' top BOARD_TOP and total come from the
 * isolate's copy of that window (BOARD_TTL_MS); your pinned best is read live. The Daily window is the viewer's day's
 * Daily board (daily-board.ts): its first attempts only, its top and total from the isolate's copy of that day, and your
 * own first attempt pinned, read live.
 */
export async function getBoard(req: Request, env: AppEnv): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const w = q.get('window') ?? 'all';
  if (!isWindow(w)) throw new HttpError(400, 'invalid', 'window must be daily, today, week or all.');
  let body: BoardResponse;
  if (w === 'daily') {
    const { today: day } = viewerToday(q);
    const user = await currentUser(req, env);
    const { top, total } = await cachedDailyTopAndTotal(env.DB, day);
    // Another player's first attempt stays closed until the day does (canWatch); yours is always open.
    const closed = Date.now() < dailyClosesAt(day);
    body = await boardOf(top, total, user, (r) => !closed || r.user_id === user?.id, async (u) => {
      const mine = await dailyBestRow(env.DB, u.id, day);
      return mine && { id: mine.id, rank: await dailyRankOf(env.DB, day, mine.ms, mine.finished_at), name: u.name, ms: mine.ms, finishedAt: mine.finished_at, mine: true, replay: true };
    });
  } else {
    const since = windowStart(w, q);
    const user = await currentUser(req, env);
    const { top, total } = await cachedTopAndTotal(env.DB, Date.now(), since);
    // Every main-board run is ranked and named, so any of them can be watched.
    body = await boardOf(top, total, user, () => true, async (u) => {
      const best = await bestOf(env.DB, u.id, since);
      return best && { id: best.id, rank: await rankOf(env.DB, best.ms, best.finished_at, since), name: u.name, ms: best.ms, finishedAt: best.finished_at, mine: true, replay: true };
    });
  }
  return json(body satisfies BoardResponse, { headers: { 'Cache-Control': 'private, max-age=15', Vary: 'Cookie' } });
}
