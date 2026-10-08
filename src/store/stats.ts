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

/** What this device had solved when it first showed a signed-in results tag for `userId` (spec 2026-10-08 §6.2). */
interface Baseline {
  userId: number;
  solved: number;
}

const isBaseline = (v: unknown): v is Baseline => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const whole = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
  return whole(o.userId) && whole(o.solved);
};

/**
 * The device's solved count at its first signed-in evaluation for this account, kept in localStorage as
 * `{userId, solved}`. A different account signing in replaces it. null when storage can't be read or written: the
 * caller then shows the account's numbers.
 */
export function statsBaseline(userId: number, deviceSolved: number): number | null {
  try {
    const raw = localStorage.getItem(BASELINE_KEY); // not readJSON: a failed read must be seen too
    let kept: unknown = null;
    try {
      kept = raw === null ? null : JSON.parse(raw);
    } catch {
      // corrupt: replaced below
    }
    if (isBaseline(kept) && kept.userId === userId) return kept.solved;
    const fresh: Baseline = { userId, solved: deviceSolved };
    localStorage.setItem(BASELINE_KEY, JSON.stringify(fresh)); // not writeJSON: a failed write must be seen
    return deviceSolved;
  } catch {
    return null;
  }
}

export const loadStats = (): Stats => readJSON(KEY, isStats) ?? { ...EMPTY_STATS };
export const saveStats = (s: Stats): void => writeJSON(KEY, s);
