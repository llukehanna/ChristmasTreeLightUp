import type { BoardResponse, BoardRow } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { json } from '../lib/http.js';
import { bestOf, boardTotal, rankOf, rankRows, topRuns } from '../lib/ranks.js';
import { currentUser } from '../lib/users.js';

/** GET /api/board: the all-time top 50 runs. Varies with the cookie (your rows), so the cache is private and short. */
export async function getBoard(req: Request, env: AppEnv): Promise<Response> {
  const user = await currentUser(req, env);
  const [top, total] = await Promise.all([topRuns(env.DB), boardTotal(env.DB)]);
  const ranks = rankRows(top);
  const rows: BoardRow[] = top.map((r, i) => ({ rank: ranks[i], name: r.name, ms: r.ms, finishedAt: r.finished_at, mine: user !== null && r.user_id === user.id }));
  let you: BoardRow | null = null;
  if (user?.name && !rows.some((r) => r.mine)) {
    const best = await bestOf(env.DB, user.id);
    if (best) you = { rank: await rankOf(env.DB, best.ms, best.finished_at), name: user.name, ms: best.ms, finishedAt: best.finished_at, mine: true };
  }
  return json({ rows, total, you } satisfies BoardResponse, { headers: { 'Cache-Control': 'private, max-age=15' } });
}
