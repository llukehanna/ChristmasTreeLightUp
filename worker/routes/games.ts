import { MAX_CLAIMS_PER_REQUEST, type ClaimResponse, type FinishResult, type StartResponse } from '../../src/api/types.js';
import { judge, type UnrankedReason } from '../../src/core/judge.js';
import { parseLog } from '../../src/core/log.js';
import { GRID } from '../../src/core/mask.js';
import { GEN_VERSION } from '../../src/core/seeded.js';
import { hmac, randomSeed, randomToken } from '../lib/crypto.js';
import type { AppEnv, Ctx } from '../lib/env.js';
import { clientIp, HttpError, json, rateKey, readJson } from '../lib/http.js';
import { bestOf, boardTotal, rankOf } from '../lib/ranks.js';
import { authSecret, currentUser, requireUser } from '../lib/users.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const STARTS_PER_HOUR = 200;
/** Finished games nobody has claimed are kept this long, so signing in later on the same browser still finds them. */
export const UNCLAIMED_KEEP_DAYS = 90;
/** Each start clears at most this many stale games of each kind: up to 50 in all (spec §2). */
const STALE_BATCH = 25;
/** Each start prunes at most this many start records older than an hour. */
const STARTS_PRUNE = 50;
export const GAME_ID = /^[A-Za-z0-9_-]{16,64}$/;

interface GameRow {
  id: string;
  user_id: number | null;
  claim_hash: string | null;
  gen_version: number;
  seed: number;
  started_at: number;
  finished_at: number | null;
  ms: number | null;
  ranked: number;
  unranked_reason: UnrankedReason | null;
  /** 1 when the owner has a name, so a ranked run is on the board. */
  named: number;
}
type FinishedGame = GameRow & { finished_at: number; ms: number };
const SELECT_GAME =
  'SELECT g.id, g.user_id, g.claim_hash, g.gen_version, g.seed, g.started_at, g.finished_at, g.ms, g.ranked, g.unranked_reason, (u.name IS NOT NULL) AS named FROM games g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?';
const finished = (g: GameRow): g is FinishedGame => g.finished_at !== null && g.ms !== null;
const notFound = () => new HttpError(404, 'not_found', "That game isn't on record.");

/** POST /api/games {} */
export async function startGame(req: Request, env: AppEnv): Promise<Response> {
  const secret = authSecret(env);
  await readJson(req);
  const ipHash = await hmac(secret, `ip:${rateKey(clientIp(req))}`);
  // Counted in their own table, so a start whose game a 422 deleted still counts.
  const recent = await env.DB.prepare('SELECT count(*) AS n FROM starts WHERE ip_hash = ? AND at > ?').bind(ipHash, Date.now() - HOUR_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= STARTS_PER_HOUR) throw new HttpError(429, 'rate_limited', 'Too many games from here. Try again in a bit.');

  const user = await currentUser(req, env);
  const id = randomToken(16);
  const seed = randomSeed();
  const claim = user ? null : randomToken(24);
  const claimHash = claim && (await hmac(secret, `claim:${claim}`));
  // Stamped last, right before the insert, so nothing above counts against the player's clock.
  const now = Date.now();
  await env.DB.batch([
    // Lazy housekeeping (no cron): abandoned games after a day, unclaimed finished games after 90 days.
    env.DB.prepare('DELETE FROM games WHERE id IN (SELECT id FROM games WHERE finished_at IS NULL AND started_at < ? LIMIT ?)').bind(now - DAY_MS, STALE_BATCH),
    env.DB.prepare('DELETE FROM games WHERE id IN (SELECT id FROM games WHERE user_id IS NULL AND finished_at < ? LIMIT ?)').bind(now - UNCLAIMED_KEEP_DAYS * DAY_MS, STALE_BATCH),
    env.DB.prepare('DELETE FROM starts WHERE rowid IN (SELECT rowid FROM starts WHERE at < ? LIMIT ?)').bind(now - HOUR_MS, STARTS_PRUNE),
    env.DB.prepare('INSERT INTO starts (ip_hash, at) VALUES (?, ?)').bind(ipHash, now),
    env.DB.prepare('INSERT INTO games (id, user_id, claim_hash, gen_version, seed, started_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      id,
      user?.id ?? null,
      claimHash,
      GEN_VERSION,
      seed,
      now,
    ),
  ]);
  return json({ id, seed, genVersion: GEN_VERSION, claim } satisfies StartResponse);
}

/**
 * What the browser shows for finished games, all owned by `userId` (or all signed out, null). The board total and the
 * owner's best are the same for every one, so they are read once: a full claim stays well inside D1's query budget.
 */
async function resultsOf(env: AppEnv, userId: number | null, games: readonly FinishedGame[]): Promise<FinishResult[]> {
  if (games.length === 0) return [];
  const placed = (g: FinishedGame) => g.ranked === 1 || g.unranked_reason === 'anonymous';
  const [total, best, ranks] = await Promise.all([
    boardTotal(env.DB),
    userId === null ? Promise.resolve(null) : bestOf(env.DB, userId),
    Promise.all(games.map((g) => (placed(g) ? rankOf(env.DB, g.ms, g.finished_at) : Promise.resolve(null)))),
  ]);
  return games.map((g, k) => {
    const rank = ranks[k];
    // A run with a place that isn't on the board yet (signed out, or no name) would join it: "#r of total + 1".
    const onBoard = g.ranked === 1 && g.named === 1;
    return {
      id: g.id,
      ranked: g.ranked === 1,
      reason: g.unranked_reason,
      ms: g.ms,
      rank,
      total: rank !== null && !onBoard ? total + 1 : total,
      best: best?.ms ?? null,
      newBest: g.ranked === 1 && best?.id === g.id,
    };
  });
}

const resultOf = async (env: AppEnv, g: FinishedGame): Promise<FinishResult> => (await resultsOf(env, g.user_id, [g]))[0];

/** POST /api/games/:id/finish { log } */
export async function finishGame(req: Request, env: AppEnv, _ctx: Ctx, [id]: readonly string[]): Promise<Response> {
  const receivedAt = Date.now();
  const body = await readJson(req);
  const game = await env.DB.prepare(SELECT_GAME).bind(id).first<GameRow>();
  if (!game) throw notFound();
  // A retry after a lost response: answer what was saved (the id is a bearer secret).
  if (finished(game)) return json(await resultOf(env, game));

  const log = parseLog(body.log, GRID);
  const verdict = log && judge({ seed: game.seed, genVersion: game.gen_version, log, serverElapsedMs: receivedAt - game.started_at });
  if (!log || !verdict) {
    await env.DB.prepare('DELETE FROM games WHERE id = ? AND finished_at IS NULL').bind(id).run();
    throw new HttpError(422, 'unverified', "This run couldn't be verified.");
  }
  // Everything checks out but nobody owns it yet: it ranks once claimed.
  const reason: UnrankedReason | null = verdict.reason ?? (game.user_id === null ? 'anonymous' : null);
  const ranked = reason === null ? 1 : 0;
  const saved = await env.DB.prepare(
    'UPDATE games SET finished_at = ?, ms = ?, paused_ms = ?, pauses = ?, ranked = ?, unranked_reason = ?, log = ? WHERE id = ? AND finished_at IS NULL',
  )
    .bind(receivedAt, verdict.ms, verdict.pausedMs, verdict.pauses, ranked, reason, JSON.stringify(log), id)
    .run();
  if (saved.meta.changes === 0) {
    // Lost a race with another finish of the same game: answer what that one saved.
    const now = await env.DB.prepare(SELECT_GAME).bind(id).first<GameRow>();
    if (now && finished(now)) return json(await resultOf(env, now));
    throw notFound();
  }
  return json(await resultOf(env, { ...game, finished_at: receivedAt, ms: verdict.ms, ranked, unranked_reason: reason }));
}

/** POST /api/games/claim { claims: [{ id, claim }] }: finished signed-out games join the account, 8 at a time. */
export async function claimGames(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const secret = authSecret(env);
  const body = await readJson(req);
  const claims = Array.isArray(body.claims) ? (body.claims as unknown[]).slice(0, MAX_CLAIMS_PER_REQUEST) : [];
  const claimed: FinishedGame[] = [];
  for (const c of claims) {
    if (typeof c !== 'object' || c === null) continue;
    const { id, claim } = c as Record<string, unknown>;
    if (typeof id !== 'string' || typeof claim !== 'string' || !GAME_ID.test(id)) continue;
    const game = await env.DB.prepare(`${SELECT_GAME} AND g.user_id IS NULL`).bind(id).first<GameRow>();
    if (!game || !finished(game) || game.claim_hash === null || game.claim_hash !== (await hmac(secret, `claim:${claim}`))) continue;
    const ranks = game.unranked_reason === 'anonymous';
    const owned: FinishedGame = {
      ...game,
      user_id: user.id,
      claim_hash: null,
      ranked: ranks ? 1 : game.ranked,
      unranked_reason: ranks ? null : game.unranked_reason,
      named: user.name === null ? 0 : 1,
    };
    const res = await env.DB.prepare('UPDATE games SET user_id = ?, claim_hash = NULL, ranked = ?, unranked_reason = ? WHERE id = ? AND user_id IS NULL')
      .bind(user.id, owned.ranked, owned.unranked_reason, id)
      .run();
    if (res.meta.changes > 0) claimed.push(owned);
  }
  // Results after every claim, so best and newBest reflect the whole batch.
  const results = await resultsOf(env, user.id, claimed);
  return json({ results } satisfies ClaimResponse);
}
