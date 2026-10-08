import { HISTORY_FIRST_DAY, MAX_IMPORT_MS, MAX_IMPORT_RUNS, MAX_STREAK_DAYS, MIN_IMPORT_BEST_SECONDS } from '../../src/api/types.js';
import { mulberry32, type Rng } from '../../src/core/rng.js';
import { DAY_MS, dayNumber, isTzOffset, localDayOf, localMidnight } from './days.js';

/**
 * The history import's runs (spec 2026-10-08 §4): a device's totals turned into plausible games, deterministically.
 * Pure: the same input always gives the same runs, so a resent import inserts nothing new.
 */

/** The first game's expected excess over the best is 1 + TREND times the last game's: a gentle improvement. */
export const TREND = 0.6;
/** Spread of the log-normal factor on each game's time above the best (solve times skew right). */
export const SIGMA = 0.5;
/** The best run is among the last 40% of games. */
export const BEST_FROM = 0.6;

const FIRST_DAY = dayNumber(HISTORY_FIRST_DAY) as number;
const HOUR = 3_600_000;
const IMPORT_ID = /^[A-Za-z0-9_-]{16,32}$/;

export interface HistoryInput {
  importId: string;
  solved: number;
  bestMs: number;
  averageMs: number;
  streak: number;
  longestStreak: number;
  /** Day number (worker/lib/days.ts) of the last solved day, local to `tz`. */
  lastDay: number;
  /** Date#getTimezoneOffset() of the device: UTC minus local, in minutes. */
  tz: number;
  /** The server's clock: nothing is dated later than a second before it. */
  now: number;
}

export interface ImportedRun {
  id: string;
  finishedAt: number;
  ms: number;
}

export interface History {
  /** In chronological order. */
  runs: ImportedRun[];
  /** What the dates show: the request's streaks, or less when they didn't fit. */
  streak: number;
  longestStreak: number;
  clamped: boolean;
}

/** FNV-1a (32-bit) of the import id: the PRNG's seed. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * Whole, non-negative parts of `total` in proportion to positive `weights`, adding up to `total` exactly: each part is
 * the step between rounded running sums, and the last running sum is `total` itself.
 */
export function split(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  const out: number[] = [];
  let acc = 0;
  let prev = 0;
  weights.forEach((w, i) => {
    acc += w;
    const upto = i === weights.length - 1 ? total : Math.min(total, Math.floor((total * acc) / sum));
    out.push(upto - prev);
    prev = upto;
  });
  return out;
}

/** The import's i-th run: a stable id, inside the game id pattern ([A-Za-z0-9_-]{16,64}). */
export const importRunId = (importId: string, i: number): string => `imp_${importId}_${String(i).padStart(4, '0')}`;

interface DayPlan {
  /** Played days, ascending. */
  days: number[];
  /** Games on each played day (each at least 1). */
  counts: number[];
  streak: number;
  longestStreak: number;
}

/** Which days have games, and how many (spec §4.2). */
function planDays(n: number, streak: number, longest: number, first: number, last: number, rng: Rng): DayPlan {
  const span = last - first + 1;
  // The current streak shrinks first: to the window and to one game a day.
  const s = Math.min(streak, span, n);
  // Then a separate longest run, before a gap day, in what is left; dropped if it can't beat the streak.
  let l = longest > s ? Math.min(longest, span - s - 1, n - s) : 0;
  if (l <= s) l = 0;
  const top = l > 0 ? l : s;
  const blockStart = l > 0 ? last - s - l : last - s + 1;
  const reserved: number[] = [];
  for (let d = blockStart; d < blockStart + l; d++) reserved.push(d);
  for (let d = last - s + 1; d <= last; d++) reserved.push(d);
  // Earlier days, leaving the day before the block empty: each played at even odds, never in a run longer than `top`.
  const free: number[] = [];
  let run = 0;
  for (let d = first; d <= blockStart - 2; d++) {
    const pick = rng() < 0.5;
    if (pick && run < top) {
      free.push(d);
      run++;
    } else run = 0;
  }
  // As many as there are games left for, the latest first.
  const spare = n - reserved.length;
  const days = [...free.slice(Math.max(0, free.length - spare)), ...reserved];
  const extra = split(n - days.length, days.map(() => 0.5 + rng()));
  return { days, counts: extra.map((x) => x + 1), streak: s, longestStreak: top };
}

/** Each game's time in index (chronological) order (spec §4.3): exactly one at the best, adding up to `total`. */
function times(n: number, bestMs: number, total: number, rng: Rng): number[] {
  const lo = Math.floor(n * BEST_FROM);
  const bestAt = lo + Math.floor(rng() * (n - lo));
  const others = n - 1;
  const excess = total - n * bestMs;
  // With room, every other game is at least 1 ms slower, so the best is the only one that fast.
  const floor = excess >= others ? 1 : 0;
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === bestAt) continue;
    const pos = n > 1 ? i / (n - 1) : 0;
    const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    weights.push((1 + TREND * (1 - pos)) * Math.exp(SIGMA * z));
  }
  const shares = split(excess - floor * others, weights);
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) out.push(i === bestAt ? bestMs : bestMs + floor + shares[k++]);
  return out;
}

/** The runs for an import (spec §4). Throws RangeError for input the route never passes. */
export function fabricateHistory(input: HistoryInput): History {
  if (!(input.solved >= 1) || !(input.lastDay >= FIRST_DAY)) throw new RangeError('fabricateHistory: at least one game, on or after the first day');
  const rng = mulberry32(seedOf(input.importId));
  const n = input.solved;
  const plan = planDays(n, input.streak, input.longestStreak, FIRST_DAY, input.lastDay, rng);
  const ms = times(n, input.bestMs, n * input.averageMs, rng);
  const runs: ImportedRun[] = [];
  let i = 0;
  plan.days.forEach((day, k) => {
    const count = plan.counts[k];
    const midnight = localMidnight(day, input.tz);
    // The day's end, or (on today) a second ago.
    const limit = Math.min(DAY_MS - 1, input.now - 1000 - midnight);
    // A session: morning, lunch or (mostly) evening, games one after another.
    const r = rng();
    const [from, to] = r < 0.15 ? [7 * HOUR, 9.5 * HOUR] : r < 0.4 ? [12 * HOUR, 14 * HOUR] : [18.5 * HOUR, 23 * HOUR];
    let t = from + Math.floor(rng() * (to - from));
    const ends: number[] = [];
    for (let j = 0; j < count; j++) {
      if (j > 0) t += 4_000 + Math.floor(rng() * 41_000);
      t += ms[i + j];
      ends.push(t);
    }
    // Too late: the session moves earlier. Longer than the time there is: it bunches up from midnight, 1 ms apart.
    const shift = Math.max(0, ends[count - 1] - limit);
    ends.forEach((e, j) => runs.push({ id: importRunId(input.importId, i + j), finishedAt: midnight + Math.max(e - shift, j), ms: ms[i + j] }));
    i += count;
  });
  return {
    runs,
    streak: plan.streak,
    longestStreak: plan.longestStreak,
    clamped: plan.streak !== input.streak || plan.longestStreak !== input.longestStreak,
  };
}

const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** POST /api/admin/import's body, checked in the spec's order (§3.1): the fabricator's input, or the first problem. */
export function parseImportRequest(body: Record<string, unknown>, now: number): Omit<HistoryInput, 'now'> | string {
  const { importId, solved, bestSeconds, averageMs, streak, longestStreak, lastSolvedDay, tz } = body;
  if (typeof importId !== 'string' || !IMPORT_ID.test(importId)) return 'importId must be 16–32 letters, digits, - or _.';
  if (!int(solved, 1, MAX_IMPORT_RUNS)) return 'Games solved must be a whole number from 1 to 2,000.';
  if (!int(bestSeconds, MIN_IMPORT_BEST_SECONDS, MAX_IMPORT_MS / 1000)) return 'Best time must be from 0:05 to 60:00, in whole seconds.';
  const bestMs = bestSeconds * 1000;
  if (!int(averageMs, bestMs, MAX_IMPORT_MS)) return 'Average time must be at least the best time and at most 60:00.';
  if (solved === 1 && averageMs !== bestMs) return 'With one game, the average time is the best time.';
  if (!int(streak, 1, MAX_STREAK_DAYS) || !int(longestStreak, streak, MAX_STREAK_DAYS)) {
    return 'Streaks are whole days from 1 to 3,650, and the longest is at least the current one.';
  }
  if (!isTzOffset(tz)) return 'tz must be whole minutes from -840 to 840.';
  const lastDay = dayNumber(lastSolvedDay);
  if (lastDay === null || lastDay < FIRST_DAY || lastDay > localDayOf(now, tz)) return 'Last solved day must be a date from 2026-09-29 to today.';
  return { importId, solved, bestMs, averageMs, streak, longestStreak, lastDay, tz };
}
