import type { ImportResponse } from '../../../src/api/types.js';
import { resetBoardCache } from '../../lib/board-cache.js';
import type { AppEnv } from '../../lib/env.js';
import { fabricateHistory, importRunId, parseImportRequest } from '../../lib/history.js';
import { HttpError, json, readJson } from '../../lib/http.js';
import { requireAdmin } from '../../lib/users.js';

/**
 * Every run in one statement, from a JSON array of [id, finishedAt, ms] (D1: at most 100 bound parameters and 50
 * queries per request; a bound value may be 2 MB, and 2,000 runs are about 140 KB). OR IGNORE: a run already there
 * stays as it is.
 */
const INSERT = `INSERT OR IGNORE INTO games (id, user_id, claim_hash, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, unranked_reason, log, source)
SELECT json_extract(value, '$[0]'), ?1, NULL, 0, 0, json_extract(value, '$[1]') - json_extract(value, '$[2]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), 0, 0, 1, NULL, NULL, 'import'
FROM json_each(?2)`;

/**
 * POST /api/admin/import (spec 2026-10-08 §3.1): this device's pre-accounts stats become runs on the admin's own
 * account. The runs are a pure function of the request, and an importId whose first run exists adds nothing, so a
 * resend (or a resend with other numbers) can never double them.
 */
export async function POST(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireAdmin(req, env);
  const now = Date.now();
  const input = parseImportRequest(await readJson(req), now);
  if (typeof input === 'string') throw new HttpError(400, 'invalid', input);
  const history = fabricateHistory({ ...input, now });
  const done = await env.DB.prepare('SELECT 1 AS x FROM games WHERE id = ?').bind(importRunId(input.importId, 0)).first();
  let added = 0;
  if (!done) {
    const rows = JSON.stringify(history.runs.map((r) => [r.id, r.finishedAt, r.ms]));
    added = (await env.DB.prepare(INSERT).bind(user.id, rows).run()).meta.changes;
    resetBoardCache(); // the runs join the board (once the admin has a name) at once in this isolate
  }
  return json({ added, already: added === 0, streak: history.streak, longestStreak: history.longestStreak, clamped: history.clamped } satisfies ImportResponse);
}
