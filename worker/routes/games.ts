import { MAX_CLAIMS_PER_REQUEST, type ClaimResponse, type DailyInfo, type DailyResult, type FinishResult, type StartResponse } from '../../src/api/types.js';
import { MAX_FACTS_ENTRIES, runFacts, turnsOf } from '../../src/core/facts.js';
import { judge, type UnrankedReason } from '../../src/core/judge.js';
import { parseLog } from '../../src/core/log.js';
import { GRID } from '../../src/core/mask.js';
import { GEN_VERSION } from '../../src/core/seeded.js';
import { hmac, randomSeed, randomToken } from '../lib/crypto.js';
import type { AppEnv, Ctx } from '../lib/env.js';
import { clientIp, HttpError, json, rateKey, readJson } from '../lib/http.js';
import { boardGrew, cachedDailyTotal, cachedTotal, dailyGrew } from '../lib/board-cache.js';
import { dailyClosesAt, dailySeed, DAILY_FIRST_DAY, liveDay } from '../lib/daily.js';
import { dailyFirstId, dailyRankOf } from '../lib/daily-board.js';
import { DAY_MS, dayNumber, dayText } from '../lib/days.js';
import { runContextOf } from '../lib/progress.js';
import { bestOf, rankOf } from '../lib/ranks.js';
import { authSecret, currentUser, requireUser } from '../lib/users.js';

const HOUR_MS = 3_600_000;
export const STARTS_PER_HOUR = 200;
/** Finished games nobody has claimed are kept this long, so signing in later on the same browser still finds them. */
export const UNCLAIMED_KEEP_DAYS = 90;
/** Each start clears at most this many stale games of each kind: up to 50 in all (spec §2). */
const STALE_BATCH = 25;
/**
 * Abandoned games, bound (cutoff, limit): a guest's unfinished games (never claimable: a claim needs a finished run),
 * swept after a day on their partial index (migration 0008), its WHERE repeating the index's exactly, so the delete
 * never walks rows it won't delete. INDEXED BY: left alone, the planner seeks games_user (user_id, finished_at) on the
 * two IS NULLs instead, walking every guest's unfinished game, the day's live ones too. A signed-in player's unfinished
 * games are kept for good (plan C2+C3, decision 3): they break a run of trees, and a Daily one is a forfeited first
 * attempt.
 */
export const STALE_SQL = 'SELECT id FROM games INDEXED BY games_stale WHERE finished_at IS NULL AND user_id IS NULL AND started_at < ? LIMIT ?';
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
  /** The Daily Tree's day number; null for a random game. */
  daily_day: number | null;
  /** 1 when that day was already over for the player (a past day's tree). */
  daily_past: number;
  /** Taps made and the tree's fewest turns, for any judged run whose log was short enough; null before migration 0008. */
  turns: number | null;
  min_turns: number | null;
}
type FinishedGame = GameRow & { finished_at: number; ms: number };
const SELECT_GAME =
  'SELECT g.id, g.user_id, g.claim_hash, g.gen_version, g.seed, g.started_at, g.finished_at, g.ms, g.ranked, g.unranked_reason, (u.name IS NOT NULL) AS named, g.daily_day, g.daily_past, g.turns, g.min_turns FROM games g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?';
const finished = (g: GameRow): g is FinishedGame => g.finished_at !== null && g.ms !== null;
/** Ranked and owned by a named player: on the leaderboard. */
const onBoard = (g: GameRow): boolean => g.ranked === 1 && g.named === 1;
const notFound = () => new HttpError(404, 'not_found', "That game isn't on record.");
/**
 * A live day's game of a named player: as their first attempt it decides their place on the day's Daily board. A clean
 * finish ('daily') may join that board; a claim may join it, or (starting earlier) take the place of the account's own
 * run. Either way the isolate's copy of that day is dropped (dailyGrew). A repeat drops it too, needlessly but safely.
 */
const decidesDaily = <G extends GameRow>(g: G): g is G & { daily_day: number } => g.daily_day !== null && g.daily_past === 0 && g.named === 1;

const dayClosed = () => new HttpError(400, 'invalid', "That day's tree isn't open.");

/**
 * The day a start asks for, from `daily: { today, day? }`: `today` is the player's local date (within a day of ours),
 * `day` (default today) is the tree they want, from the first Daily Tree up to today; an earlier day only once it has
 * closed (dailyClosesAt). Null when there is no `daily`.
 */
function dailyAsked(daily: unknown, nowMs: number): { day: number; past: boolean } | null {
  if (daily === undefined || daily === null) return null;
  if (typeof daily !== 'object' || Array.isArray(daily)) throw dayClosed();
  const { today, day } = daily as Record<string, unknown>;
  const todayNo = liveDay(today, nowMs);
  if (todayNo === null) throw dayClosed();
  const wanted = day === undefined ? todayNo : dayNumber(day);
  const first = dayNumber(DAILY_FIRST_DAY);
  if (wanted === null || first === null || wanted < first || wanted > todayNo) throw dayClosed();
  // A past day's tree opens only once that day has closed for everyone, so nobody can practise a day still live
  // somewhere (their own, say) as a past run before their live attempt.
  const past = wanted < todayNo;
  if (past && nowMs < dailyClosesAt(wanted)) throw dayClosed();
  return { day: wanted, past };
}

/** POST /api/games { daily? } */
export async function startGame(req: Request, env: AppEnv): Promise<Response> {
  const secret = authSecret(env);
  const body = await readJson(req);
  const asked = dailyAsked(body.daily, Date.now());
  const ipHash = await hmac(secret, `ip:${rateKey(clientIp(req))}`);
  // Counted in their own table, so a start whose game a 422 deleted still counts.
  const recent = await env.DB.prepare('SELECT count(*) AS n FROM starts WHERE ip_hash = ? AND at > ?').bind(ipHash, Date.now() - HOUR_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= STARTS_PER_HOUR) throw new HttpError(429, 'rate_limited', 'Too many games from here. Try again in a bit.');

  const user = await currentUser(req, env);
  const id = randomToken(16);
  const seed = asked ? await dailySeed(secret, asked.day) : randomSeed();
  // Only a signed-in player has attempts to repeat; a past start never counts as the live one.
  const repeat =
    asked !== null &&
    user !== null &&
    (await env.DB.prepare('SELECT 1 AS one FROM games WHERE daily_day = ? AND user_id = ? AND daily_past = 0 LIMIT 1').bind(asked.day, user.id).first()) !== null;
  const daily: DailyInfo | null = asked && { day: dayText(asked.day), past: asked.past, repeat };
  const claim = user ? null : randomToken(24);
  const claimHash = claim && (await hmac(secret, `claim:${claim}`));
  // Stamped last, right before the insert, so nothing above counts against the player's clock.
  const now = Date.now();
  await env.DB.batch([
    // Lazy housekeeping (no cron): a guest's abandoned games after a day, unclaimed finished games after 90 days.
    env.DB.prepare(`DELETE FROM games WHERE id IN (${STALE_SQL})`).bind(now - DAY_MS, STALE_BATCH),
    env.DB.prepare('DELETE FROM games WHERE id IN (SELECT id FROM games WHERE user_id IS NULL AND finished_at < ? LIMIT ?)').bind(now - UNCLAIMED_KEEP_DAYS * DAY_MS, STALE_BATCH),
    env.DB.prepare('DELETE FROM starts WHERE rowid IN (SELECT rowid FROM starts WHERE at < ? LIMIT ?)').bind(now - HOUR_MS, STARTS_PRUNE),
    env.DB.prepare('INSERT INTO starts (ip_hash, at) VALUES (?, ?)').bind(ipHash, now),
    env.DB.prepare('INSERT INTO games (id, user_id, claim_hash, gen_version, seed, started_at, daily_day, daily_past) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      user?.id ?? null,
      claimHash,
      GEN_VERSION,
      seed,
      now,
      asked?.day ?? null,
      asked?.past ? 1 : 0,
    ),
  ]);
  return json({ id, seed, genVersion: GEN_VERSION, claim, daily } satisfies StartResponse);
}

/**
 * The Daily block for a finished Daily game owned by `userId` (null: a guest's), from its day's board (daily-board.ts).
 * `dayOf` gives the day's total (the isolate's copy, BOARD_TTL_MS, dropped by dailyGrew when this request's own run may
 * have joined) and the owner's first attempt (live), read once per day for a request. The place is live.
 */
async function dailyOf(
  env: AppEnv,
  userId: number | null,
  g: FinishedGame & { daily_day: number },
  dayOf: (day: number) => Promise<{ total: number; firstId: string | null }>,
): Promise<DailyResult> {
  const past = g.daily_past === 1;
  const { total, firstId } = await dayOf(g.daily_day);
  // A guest can't prove a first attempt beforehand (plan C1, decision 5): every live run of theirs is one until claimed.
  const first = !past && (userId === null || firstId === g.id);
  const rank = first && g.unranked_reason === 'daily' ? await dailyRankOf(env.DB, g.daily_day, g.ms, g.finished_at) : null;
  // A run with a place that isn't on the day's board yet (signed out, or no name) would join it: "#r of total + 1".
  const shown = rank !== null && !(userId !== null && g.named === 1) ? total + 1 : total;
  return { day: dayText(g.daily_day), past, first, rank, total: rank === null ? shown : Math.max(shown, rank) };
}

/**
 * What the browser shows for finished games, all owned by `userId` (or all signed out, null). The board total and the
 * owner's best are the same for every one, so they are read once: a full claim stays well inside D1's query budget.
 * The total is the isolate's copy (BOARD_TTL_MS): runs finished in other isolates within that window may be missing
 * from "#r of total", never this request's own (boardGrew counts them first). Ranks and the best are live. A Daily
 * game also gets its `daily` block (every other field stays the main board's); each day's total and first attempt
 * are read once, however many of the games are that day's.
 */
async function resultsOf(env: AppEnv, userId: number | null, games: readonly FinishedGame[]): Promise<FinishResult[]> {
  if (games.length === 0) return [];
  const placed = (g: FinishedGame) => g.ranked === 1 || g.unranked_reason === 'anonymous';
  const days = new Map<number, Promise<{ total: number; firstId: string | null }>>();
  const dayOf = (day: number) => {
    let p = days.get(day);
    if (!p) {
      p = Promise.all([cachedDailyTotal(env.DB, day), userId === null ? null : dailyFirstId(env.DB, userId, day)]).then(([total, firstId]) => ({ total, firstId }));
      days.set(day, p);
    }
    return p;
  };
  const [total, best, ranks, daily] = await Promise.all([
    cachedTotal(env.DB),
    userId === null ? Promise.resolve(null) : bestOf(env.DB, userId),
    Promise.all(games.map((g) => (placed(g) ? rankOf(env.DB, g.ms, g.finished_at) : Promise.resolve(null)))),
    Promise.all(games.map((g) => (g.daily_day === null ? Promise.resolve(null) : dailyOf(env, userId, { ...g, daily_day: g.daily_day }, dayOf)))),
  ]);
  return games.map((g, k) => {
    const rank = ranks[k];
    // A run with a place that isn't on the board yet (signed out, or no name) would join it: "#r of total + 1".
    // The rank is live and the total may be the isolate's older copy, so the total never reads below the rank.
    const shown = rank !== null && !onBoard(g) ? total + 1 : total;
    return {
      id: g.id,
      ranked: g.ranked === 1,
      reason: g.unranked_reason,
      ms: g.ms,
      rank,
      total: rank === null ? shown : Math.max(shown, rank),
      best: best?.ms ?? null,
      newBest: g.ranked === 1 && best?.id === g.id,
      daily: daily[k],
      turns: g.turns,
      minTurns: g.min_turns,
    };
  });
}

const resultOf = async (env: AppEnv, g: FinishedGame): Promise<FinishResult> => (await resultsOf(env, g.user_id, [g]))[0];

/** POST /api/games/:id/finish { log, ctx? }: a ctx that doesn't check out is dropped (runContextOf). */
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
    // Only a guest's random game goes at once. A signed-in player's row stays unfinished (plan C2+C3, decision 3), so
    // garbage can't erase a break in a run of trees or a Daily first attempt; a guest's Daily stays too (the day is
    // forfeited), until the sweep takes it after a day.
    await env.DB.prepare('DELETE FROM games WHERE id = ? AND finished_at IS NULL AND daily_day IS NULL AND user_id IS NULL').bind(id).run();
    throw new HttpError(422, 'unverified', "This run couldn't be verified.");
  }
  // The judge's reason first. A Daily run never ranks on the main board: a past day's is on no board, a live day's on
  // its own (daily-board.ts). Otherwise, everything checks out but nobody owns it yet: it ranks once claimed.
  const reason: UnrankedReason | null =
    verdict.reason ?? (game.daily_past === 1 ? 'past' : game.daily_day !== null ? 'daily' : game.user_id === null ? 'anonymous' : null);
  const ranked = reason === null ? 1 : 0;
  // The turns come only now the judge's capped replay has passed, and for every run it judged, whatever the verdict:
  // the career page counts a paused run, and turnsOf costs about one board generation. The feats are only for where a
  // goal can read them: runFacts lights the whole tree per turn, so a long log could cost more CPU than the free plan
  // allows and lose the run. A run the judge unranked (paused, too_fast, clock) is never a fresh one (isFresh,
  // goals.ts). Both are skipped past MAX_FACTS_ENTRIES: a run that long can't be clean or perfect. The judge's reason,
  // not the stored one: 'daily' and 'past' runs count.
  const short = log.length <= MAX_FACTS_ENTRIES;
  const facts = verdict.reason === null && short ? runFacts(game.seed, game.gen_version, log) : null;
  const counted = facts ?? (short ? turnsOf(game.seed, game.gen_version, log) : null);
  const ctx = runContextOf(body.ctx);
  const saved = await env.DB.prepare(
    'UPDATE games SET finished_at = ?, ms = ?, paused_ms = ?, pauses = ?, ranked = ?, unranked_reason = ?, log = ?, turns = ?, min_turns = ?, feats = ?, tz = ?, station = ?, world = ? WHERE id = ? AND finished_at IS NULL',
  )
    .bind(
      receivedAt,
      verdict.ms,
      verdict.pausedMs,
      verdict.pauses,
      ranked,
      reason,
      JSON.stringify(log),
      counted?.turns ?? null,
      counted?.minTurns ?? null,
      facts?.feats ?? null,
      ctx?.tz ?? null,
      ctx?.station ?? null,
      ctx?.world ?? null,
      id,
    )
    .run();
  if (saved.meta.changes === 0) {
    // Lost a race with another finish of the same game: answer what that one saved.
    const now = await env.DB.prepare(SELECT_GAME).bind(id).first<GameRow>();
    if (now && finished(now)) return json(await resultOf(env, now));
    throw notFound();
  }
  const done: FinishedGame = { ...game, finished_at: receivedAt, ms: verdict.ms, ranked, unranked_reason: reason, turns: counted?.turns ?? null, min_turns: counted?.minTurns ?? null };
  boardGrew(onBoard(done) ? [done.finished_at] : []);
  dailyGrew(decidesDaily(done) && reason === 'daily' ? [done.daily_day] : []);
  return json(await resultOf(env, done));
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
    // Only 'anonymous' clears: a Daily run keeps 'daily' or 'past', so it never joins the main board.
    const ranks = game.unranked_reason === 'anonymous';
    const owned: FinishedGame = {
      ...game,
      user_id: user.id,
      claim_hash: null,
      ranked: ranks ? 1 : game.ranked,
      unranked_reason: ranks ? null : game.unranked_reason,
      named: user.name === null ? 0 : 1,
    };
    // claimed_at: a Daily run claimed once its day has closed is the account's history, never its board (daily-board.ts).
    const res = await env.DB.prepare('UPDATE games SET user_id = ?, claim_hash = NULL, ranked = ?, unranked_reason = ?, claimed_at = ? WHERE id = ? AND user_id IS NULL')
      .bind(user.id, owned.ranked, owned.unranked_reason, Date.now(), id)
      .run();
    if (res.meta.changes > 0) claimed.push(owned);
  }
  boardGrew(claimed.filter(onBoard).map((g) => g.finished_at));
  dailyGrew(claimed.filter(decidesDaily).map((g) => g.daily_day));
  // Results after every claim, so best and newBest reflect the whole batch.
  const results = await resultsOf(env, user.id, claimed);
  return json({ results } satisfies ClaimResponse);
}
