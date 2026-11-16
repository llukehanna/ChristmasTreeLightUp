import { CAREER_IMPORTED, CAREER_PAST, CAREER_REPLAY, type CareerResponse, type CareerRow, type UnrankedReason } from '../../src/api/types.js';
import { cachedTopAndTotal, cachedTotal } from '../lib/board-cache.js';
import { dayText } from '../lib/days.js';
import type { AppEnv } from '../lib/env.js';
import { json } from '../lib/http.js';
import { bestOf, rankOf } from '../lib/ranks.js';
import { requireUser } from '../lib/users.js';

interface CareerGame {
  id: string;
  finished_at: number;
  ms: number;
  turns: number | null;
  min_turns: number | null;
  source: 'play' | 'import';
  unranked_reason: UnrankedReason | null;
  daily_day: number | null;
  daily_past: number;
  has_log: number;
}

/** GET /api/me/career: every finished run of the account, oldest first, and the ranked best with its board place. */
export async function career(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const [best, all, { top, total }] = await Promise.all([
    bestOf(env.DB, user.id),
    env.DB.prepare(
      'SELECT id, finished_at, ms, turns, min_turns, source, unranked_reason, daily_day, daily_past, (log IS NOT NULL) AS has_log FROM games WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at',
    )
      .bind(user.id)
      .all<CareerGame>(),
    // The top BOARD_TOP and the total from the isolate's copy (BOARD_TTL_MS); your best and its rank are read live.
    user.name ? cachedTopAndTotal(env.DB) : cachedTotal(env.DB).then((n) => ({ top: [], total: n })),
  ]);
  const rank = best && user.name ? await rankOf(env.DB, best.ms, best.finished_at) : null;
  const runs = all.results.map(
    (g): CareerRow => [
      g.id,
      g.finished_at,
      g.ms,
      g.turns,
      g.min_turns,
      (g.source === 'import' ? CAREER_IMPORTED : 0) | (g.has_log === 1 ? CAREER_REPLAY : 0) | (g.daily_past === 1 ? CAREER_PAST : 0),
      g.unranked_reason,
      g.daily_day === null ? null : dayText(g.daily_day),
    ],
  );
  return json(
    { runs, best: best && { id: best.id, ms: best.ms, rank }, inTop: top.filter((r) => r.user_id === user.id).length, total } satisfies CareerResponse,
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
