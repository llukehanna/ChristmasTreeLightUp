import type { AccountStats } from '../api/types';
import { readJSON, writeJSON } from './storage';

export interface Stats {
  v: 1;
  solved: number;
  totalSeconds: number;
  bestSeconds: number | null;
  bestScore: number | null;
  streak: number;
  longestStreak: number;
  lastSolvedDay: string | null;
}

export const EMPTY_STATS: Stats = {
  v: 1, solved: 0, totalSeconds: 0, bestSeconds: null, bestScore: null, streak: 0, longestStreak: 0, lastSolvedDay: null,
};

const KEY = 'aglow.stats';

export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1));
}

export function recordWin(prev: Stats, seconds: number, score: number, today: string): { stats: Stats; newBest: boolean } {
  const newBest = prev.bestSeconds === null || seconds < prev.bestSeconds;
  const streak = prev.lastSolvedDay === today ? prev.streak : prev.lastSolvedDay === previousDay(today) ? prev.streak + 1 : 1;
  return {
    newBest,
    stats: {
      v: 1,
      solved: prev.solved + 1,
      totalSeconds: prev.totalSeconds + seconds,
      bestSeconds: newBest ? seconds : prev.bestSeconds,
      bestScore: prev.bestScore === null ? score : Math.max(prev.bestScore, score),
      streak,
      longestStreak: Math.max(prev.longestStreak, streak),
      lastSolvedDay: today,
    },
  };
}

export const averageSeconds = (s: Stats): number => (s.solved ? Math.round(s.totalSeconds / s.solved) : 0);

function isStats(v: unknown): v is Stats {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const isNonNegInt = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
  const isFiniteNonNeg = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && (x as number) >= 0;
  const isDateString = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  return (
    o.v === 1 &&
    isNonNegInt(o.solved) &&
    isFiniteNonNeg(o.totalSeconds) &&
    (o.bestSeconds === null || (isFiniteNonNeg(o.bestSeconds) && typeof o.bestSeconds === 'number')) &&
    (o.bestScore === null || (typeof o.bestScore === 'number' && Number.isFinite(o.bestScore))) &&
    isNonNegInt(o.streak) &&
    isNonNegInt(o.longestStreak) &&
    (o.streak as number) <= (o.longestStreak as number) &&
    (o.lastSolvedDay === null || isDateString(o.lastSolvedDay))
  );
}

const BASELINE_KEY = 'aglow.statsBaseline';
const BASELINE_MAX = 10;

/** What this device had recorded when it first showed a signed-in view for an account (spec 2026-10-08 §6.2). */
export interface Baseline {
  solved: number;
  totalSeconds: number;
  /** When it was captured: the oldest entry goes first past BASELINE_MAX. */
  at?: number;
}

type BaselineMap = Record<string, Baseline>;

const whole = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 0;
const isBaseline = (v: unknown): v is Baseline => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return whole(o.solved) && whole(o.totalSeconds) && (o.at === undefined || whole(o.at));
};
const isBaselineMap = (v: unknown): v is BaselineMap => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(isBaseline);

/**
 * This device's baseline for an account: its `{solved, totalSeconds}` at the first signed-in evaluation, kept in
 * localStorage as `{[userId]: {...}}` (at most BASELINE_MAX accounts). An existing entry is never overwritten, so
 * signing in as another account and back keeps the first one. null when storage can't be read or written.
 */
export function statsBaseline(userId: number, device: Stats, now = Date.now()): Baseline | null {
  try {
    const raw = localStorage.getItem(BASELINE_KEY); // not readJSON: a failed read must be seen too
    let kept: BaselineMap = {};
    try {
      const v: unknown = raw === null ? null : JSON.parse(raw);
      if (isBaselineMap(v)) kept = v; // anything else is corrupt: started over
    } catch {
      // corrupt: started over
    }
    const mine = kept[String(userId)];
    if (mine) return mine;
    const fresh: Baseline = { solved: device.solved, totalSeconds: device.totalSeconds, at: now };
    const entries = Object.entries({ ...kept, [String(userId)]: fresh });
    entries.sort((x, y) => (y[1].at ?? 0) - (x[1].at ?? 0)); // newest first
    localStorage.setItem(BASELINE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, BASELINE_MAX)))); // not writeJSON: a failed write must be seen
    return fresh;
  } catch {
    return null;
  }
}

/** The device's day streak as the player would call it: stored, but alive only if the last solved day is today or yesterday. */
export const aliveStreak = (s: Stats, today: string): number => (s.lastSolvedDay === today || s.lastSolvedDay === previousDay(today) ? s.streak : 0);

/**
 * The account's numbers as shown to the player (spec 2026-10-08 §6.2). A player with a history on this device from
 * before accounts would otherwise see it vanish on signing in, so their device's first signed-in totals are added:
 * Solved = account + baseline; Average over both; Day streak = the larger of the device's live streak and the
 * account's; Longest = the larger of the two longests. No baseline for an account that has imported (its history came
 * in as runs) or when storage fails: the account's own numbers. A few signed-out wins claimed at first sign-in are
 * counted in both, which is accepted.
 */
export function shownAccountStats(account: AccountStats, device: Stats, today: string): AccountStats {
  if (account.imported > 0) return account;
  const base = statsBaseline(account.userId, device);
  if (!base) return account;
  const solved = account.solved + base.solved;
  const totalMs = account.totalMs + base.totalSeconds * 1000;
  return {
    ...account,
    solved,
    totalMs,
    averageMs: solved ? Math.round(totalMs / solved) : null,
    streak: Math.max(aliveStreak(device, today), account.streak),
    longestStreak: Math.max(device.longestStreak, account.longestStreak),
  };
}

export const loadStats = (): Stats => readJSON(KEY, isStats) ?? { ...EMPTY_STATS };
export const saveStats = (s: Stats): void => writeJSON(KEY, s);
