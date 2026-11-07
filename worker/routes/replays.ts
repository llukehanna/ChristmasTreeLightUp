import type { ReplayResponse } from '../../src/api/types.js';
import { parseLog } from '../../src/core/log.js';
import { GRID } from '../../src/core/mask.js';
import type { AppEnv, Ctx } from '../lib/env.js';
import { HttpError, json } from '../lib/http.js';
import { dayText } from '../lib/days.js';
import { canWatch, type WatchRow } from '../lib/replays.js';
import { currentUser } from '../lib/users.js';

interface ReplayRow extends WatchRow {
  name: string | null;
  seed: number;
  gen_version: number;
  ms: number | null;
  log: string | null;
}

const SELECT_REPLAY =
  'SELECT g.user_id, (u.name IS NOT NULL) AS named, u.name, g.ranked, g.daily_day, g.seed, g.gen_version, g.ms, g.finished_at, g.log, (g.log IS NOT NULL) AS has_log FROM games g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?';

/** One answer for every refusal, so the route never confirms that a hidden run exists (C4 decision 1). */
const noReplay = () => new HttpError(404, 'not_found', 'That run has no replay.');

/**
 * GET /api/games/:id/replay: a finished run's tree and log, and who played it, when canWatch lets the viewer see it. It
 * only hands back what the finish stored (one row read); the browser plays the log. Varies with the cookie (`mine`, and
 * who may watch), and a finished run never changes, so the browser may keep it for an hour.
 */
export async function getReplay(req: Request, env: AppEnv, _ctx: Ctx, [id]: readonly string[]): Promise<Response> {
  const [user, game] = await Promise.all([currentUser(req, env), env.DB.prepare(SELECT_REPLAY).bind(id).first<ReplayRow>()]);
  if (!game || !canWatch(game, user?.id ?? null, Date.now())) throw noReplay();
  const log = parseLog(game.log === null ? null : safeJson(game.log), GRID);
  if (!log || game.finished_at === null || game.ms === null) throw noReplay();
  const body: ReplayResponse = {
    id,
    name: game.name,
    mine: user !== null && game.user_id === user.id,
    seed: game.seed,
    genVersion: game.gen_version,
    log,
    ms: game.ms,
    finishedAt: game.finished_at,
    daily: game.daily_day === null ? null : dayText(game.daily_day),
  };
  return json(body, { headers: { 'Cache-Control': 'private, max-age=3600', Vary: 'Cookie' } });
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
