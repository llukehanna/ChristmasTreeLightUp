import type { Db } from './db.js';
import { dailyTopAndTotal, dailyTotal } from './daily-board.js';
import { boardTotal, topAndTotal, type TopRow } from './ranks.js';

/**
 * How long one isolate trusts its copy of the board. The total is a count over every ranked run (about 2 rows read per
 * run on the board) and was read on every finish, claim, board and Your games request; D1 Free allows 5 million rows
 * read a day. Another isolate's finish shows here within this long; one in this isolate shows at once (boardGrew).
 */
export const BOARD_TTL_MS = 20_000;
/** Most windows one isolate keeps a copy of (spec 2026-10-14 §3): viewers' todays and weeks in a few zones, and all time. */
export const BOARD_CACHE_WINDOWS = 16;

interface Entry {
  top: { rows: TopRow[]; at: number } | null;
  total: { n: number; at: number } | null;
}

/** Each window's copy, keyed by its start (epoch ms; 0 is all time), oldest written first. */
const windows = new Map<number, Entry>();
/** Each Daily board's copy, keyed by its day number, oldest written first. */
const dailies = new Map<number, Entry>();

const fresh = (e: { at: number } | null, now: number): boolean => e !== null && now - e.at < BOARD_TTL_MS;

/** Stores a copy (a window's, or a Daily board's) as the newest in `map`, dropping the oldest past BOARD_CACHE_WINDOWS. */
function put(map: Map<number, Entry>, key: number, e: Entry): void {
  map.delete(key);
  map.set(key, e);
  while (map.size > BOARD_CACHE_WINDOWS) map.delete(map.keys().next().value as number);
}

/** Forget the cached boards, the Daily boards too (a name picked or an account deleted in this isolate; tests). */
export function resetBoardCache(): void {
  windows.clear();
  dailies.clear();
}

/**
 * Runs just joined the board in this isolate (a ranked finish, or a claim, by a named player), given by their
 * finished_at: every window's top BOARD_TOP are read again next time, and each cached total counts the ones in its
 * window now, so the finish's own "#r of total" includes its run. A claimed run keeps its older finish, so it may fall
 * before a window's start.
 */
export function boardGrew(finishedAt: readonly number[]): void {
  if (finishedAt.length === 0) return;
  for (const [since, e] of windows) {
    e.top = null;
    const added = finishedAt.filter((at) => at >= since).length;
    if (e.total && added) e.total = { n: e.total.n + added, at: e.total.at };
  }
}

/** The number of runs on the board (in the window from `since`; all time by default), at most BOARD_TTL_MS old. */
export async function cachedTotal(db: Db, now = Date.now(), since = 0): Promise<number> {
  const e = windows.get(since);
  if (e?.total && fresh(e.total, now)) return e.total.n;
  const n = await boardTotal(db, since);
  put(windows, since, { top: e?.top ?? null, total: { n, at: now } });
  return n;
}

/**
 * The top BOARD_TOP runs and the board total (one batch on a miss), in the window from `since` (all time by default),
 * at most BOARD_TTL_MS old. Per-player rows stay live.
 */
export async function cachedTopAndTotal(db: Db, now = Date.now(), since = 0): Promise<{ top: TopRow[]; total: number }> {
  const e = windows.get(since);
  if (e?.top && e.total && fresh(e.top, now) && fresh(e.total, now)) return { top: e.top.rows, total: e.total.n };
  const r = await topAndTotal(db, since);
  put(windows, since, { top: { rows: r.top, at: now }, total: { n: r.total, at: now } });
  return r;
}

/**
 * Runs may just have joined these days' Daily boards in this isolate (a finish or a claim by a named player): their
 * copies are dropped, so the next read (the finish's own "#r of total" first) counts them. Dropped rather than bumped:
 * a claimed run that started earlier can take the place of the account's own run, so a join isn't always one more.
 */
export function dailyGrew(days: readonly number[]): void {
  for (const day of days) dailies.delete(day);
}

/** The runs on day `day`'s Daily board, at most BOARD_TTL_MS old. */
export async function cachedDailyTotal(db: Db, day: number, now = Date.now()): Promise<number> {
  const e = dailies.get(day);
  if (e?.total && fresh(e.total, now)) return e.total.n;
  const n = await dailyTotal(db, day);
  put(dailies, day, { top: e?.top ?? null, total: { n, at: now } });
  return n;
}

/**
 * Day `day`'s Daily board: its top BOARD_TOP and its total (one batch on a miss), at most BOARD_TTL_MS old. Your own
 * run on it and its place stay live.
 */
export async function cachedDailyTopAndTotal(db: Db, day: number, now = Date.now()): Promise<{ top: TopRow[]; total: number }> {
  const e = dailies.get(day);
  if (e?.top && e.total && fresh(e.top, now) && fresh(e.total, now)) return { top: e.top.rows, total: e.total.n };
  const r = await dailyTopAndTotal(db, day);
  put(dailies, day, { top: { rows: r.top, at: now }, total: { n: r.total, at: now } });
  return r;
}
