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
  const numOrNull = (x: unknown) => x === null || typeof x === 'number';
  return (
    o.v === 1 && typeof o.solved === 'number' && typeof o.totalSeconds === 'number' &&
    numOrNull(o.bestSeconds) && numOrNull(o.bestScore) && typeof o.streak === 'number' &&
    typeof o.longestStreak === 'number' && (o.lastSolvedDay === null || typeof o.lastSolvedDay === 'string')
  );
}

export const loadStats = (): Stats => readJSON(KEY, isStats) ?? { ...EMPTY_STATS };
export const saveStats = (s: Stats): void => writeJSON(KEY, s);
