import { CAREER_IMPORTED, CAREER_PAST, CAREER_REPLAY, type CareerRow } from '../api/types';
import type { UnrankedReason } from './judge';
import { localDay } from '../store/stats';

/** One finished run of the account, with the flags and the extra turns unpacked. */
export interface CareerRun {
  /** 1-based run number, oldest first. */
  n: number;
  id: string;
  /** Finish time, epoch ms. */
  at: number;
  ms: number;
  turns: number | null;
  minTurns: number | null;
  /** max(0, turns − minTurns); null without both, or without a positive minimum. */
  extra: number | null;
  imported: boolean;
  replay: boolean;
  past: boolean;
  reason: UnrankedReason | null;
  daily: string | null;
  /** false for 'too_fast' and 'clock': in the log and the solved count, never a best or part of an average. */
  counts: boolean;
}

type Size = 5 | 12 | 50 | 100;
const SIZES: readonly Size[] = [5, 12, 50, 100];
const FIRSTS = [60, 50, 45, 40, 35, 30];
const DAY_MS = 86_400_000;

export function parseCareer(rows: readonly CareerRow[]): CareerRun[] {
  return rows.map(([id, at, ms, turns, minTurns, flags, reason, daily], i) => ({
    n: i + 1,
    id,
    at,
    ms,
    turns,
    minTurns,
    extra: turns !== null && minTurns !== null && minTurns > 0 ? Math.max(0, turns - minTurns) : null,
    imported: (flags & CAREER_IMPORTED) !== 0,
    replay: (flags & CAREER_REPLAY) !== 0,
    past: (flags & CAREER_PAST) !== 0,
    reason,
    daily,
    counts: reason !== 'too_fast' && reason !== 'clock',
  }));
}

/** How many of each end an average of n drops: 5% of n, rounded up, at least 1. */
export const trimOf = (n: number): number => Math.max(1, Math.ceil(n * 0.05));

const sum = (xs: readonly number[], from = 0, to = xs.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += xs[i];
  return s;
};

/** The mean without the fastest and slowest ⌈5%⌉; a list too short to trim is averaged whole. Null when empty. */
export function trimmedMean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return trimmedMeanOfSorted(sorted);
}

function trimmedMeanOfSorted(sorted: readonly number[]): number {
  const t = trimOf(sorted.length);
  if (sorted.length - 2 * t <= 0) return sum(sorted) / sorted.length;
  return sum(sorted, t, sorted.length - t) / (sorted.length - 2 * t);
}

/** Where x goes in an ascending list (the first index holding a value ≥ x). */
function lowerBound(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The average of n at every counted run (null until n counted runs), indexed like `runs`. A run whose value is null
 * is skipped, as an uncounted run is. The window stays sorted by insert and remove, so a long career costs little.
 */
export function rollingAverage(
  runs: readonly CareerRun[],
  n: number,
  value: (r: CareerRun) => number | null = (r) => r.ms,
): (number | null)[] {
  const out: (number | null)[] = new Array(runs.length).fill(null);
  const window: number[] = [];
  const order: number[] = [];
  const t = trimOf(n);
  for (let i = 0; i < runs.length; i++) {
    const v = runs[i].counts ? value(runs[i]) : null;
    if (v === null) continue;
    window.splice(lowerBound(window, v), 0, v);
    order.push(v);
    if (order.length > n) window.splice(lowerBound(window, order.shift()!), 1);
    if (order.length === n) out[i] = n - 2 * t > 0 ? sum(window, t, n - t) / (n - 2 * t) : sum(window) / n;
  }
  return out;
}

export interface CareerStats {
  /** The fastest counted run. */
  best: CareerRun | null;
  bestAvg: Record<Size, { ms: number; at: CareerRun } | null>;
  current: Record<Size, { ms: number; weekAgo: number | null } | null>;
  /** Mean extra turns of the last 50 counted runs that have turns, and the same a week ago. */
  extra: { last50: number; weekAgo: number | null } | null;
  /** ms, counted runs. */
  mean: number | null;
  median: number | null;
  /** Every finished run, counted or not. */
  solved: number;
  daysPlayed: number;
  /** Days in a row ending today or yesterday; 0 once a whole day has been missed. */
  streak: number;
  longestStreak: number;
  /** Each counted run that beat every counted run before it, oldest first; gain is how much faster, in ms. */
  pbs: { run: CareerRun; gain: number | null }[];
  /** The first counted run under each of 60, 50, 45, 40, 35 and 30 s that has been reached. */
  firsts: { underS: number; run: CareerRun }[];
  /** Up to 6 counted runs, fewest extra turns first, ties oldest first. */
  fewestExtra: CareerRun[];
  /** Seconds against extra turns over the last 100 counted runs with turns: slope in s per extra turn. */
  fit: { slope: number; intercept: number; recentExtra: number; recentS: number } | null;
  /** Counted runs under 100 s in 2 s bins, from the fastest bin to the slowest, empty bins between included. */
  histogram: { fromS: number; count: number }[];
  /** Per local hour of the day: the trimmed mean (ms) of the last 600 counted runs, null under 8 runs in that hour. */
  byHour: (number | null)[];
}

const mean = (xs: readonly number[]): number => sum(xs) / xs.length;

function median(sorted: readonly number[]): number {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** Ordinary least squares of y on x; null with fewer than 2 points or no spread in x. */
function leastSquares(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number } | null {
  if (xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function careerStats(runs: readonly CareerRun[], now: Date): CareerStats {
  const counted = runs.filter((r) => r.counts);
  const weekAgoAt = now.getTime() - 7 * DAY_MS;
  // The last index whose run finished before a week ago (counted or not: the rolling arrays skip uncounted slots).
  let weekIdx = -1;
  for (let i = 0; i < runs.length && runs[i].at < weekAgoAt; i++) weekIdx = i;

  let best: CareerRun | null = null;
  const pbs: CareerStats['pbs'] = [];
  const firsts: CareerStats['firsts'] = [];
  const reached = new Set<number>();
  for (const r of counted) {
    if (best === null || r.ms < best.ms) {
      pbs.push({ run: r, gain: best === null ? null : best.ms - r.ms });
      best = r;
    }
    for (const s of FIRSTS) {
      if (!reached.has(s) && r.ms < s * 1000) {
        reached.add(s);
        firsts.push({ underS: s, run: r });
      }
    }
  }

  const bestAvg = {} as CareerStats['bestAvg'];
  const current = {} as CareerStats['current'];
  for (const n of SIZES) {
    const avg = rollingAverage(runs, n);
    let top: { ms: number; at: CareerRun } | null = null;
    let last: number | null = null;
    let lastWeek: number | null = null;
    for (let i = 0; i < runs.length; i++) {
      const v = avg[i];
      if (v === null) continue;
      if (top === null || v < top.ms) top = { ms: v, at: runs[i] };
      last = v;
      if (i <= weekIdx) lastWeek = v;
    }
    bestAvg[n] = top;
    current[n] = last === null ? null : { ms: last, weekAgo: lastWeek };
  }

  const withExtra = counted.filter((r) => r.extra !== null);
  const lastExtra = (rs: readonly CareerRun[]) => mean(rs.slice(-50).map((r) => r.extra!));
  const beforeWeek = withExtra.filter((r) => r.at < weekAgoAt);
  const extra = withExtra.length === 0 ? null : { last50: lastExtra(withExtra), weekAgo: beforeWeek.length === 0 ? null : lastExtra(beforeWeek) };

  const sortedMs = counted.map((r) => r.ms).sort((a, b) => a - b);

  const recent = withExtra.slice(-100);
  const line = leastSquares(
    recent.map((r) => r.extra!),
    recent.map((r) => r.ms / 1000),
  );
  const fit = line === null ? null : { ...line, recentExtra: mean(recent.map((r) => r.extra!)), recentS: mean(recent.map((r) => r.ms / 1000)) };

  const bins = new Map<number, number>();
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of counted) {
    if (r.ms >= 100_000) continue;
    const from = Math.floor(r.ms / 2000) * 2;
    bins.set(from, (bins.get(from) ?? 0) + 1);
    lo = Math.min(lo, from);
    hi = Math.max(hi, from);
  }
  const histogram: CareerStats['histogram'] = [];
  for (let from = lo; from <= hi; from += 2) histogram.push({ fromS: from, count: bins.get(from) ?? 0 });

  const hours: number[][] = Array.from({ length: 24 }, () => []);
  for (const r of counted.slice(-600)) hours[new Date(r.at).getHours()].push(r.ms);
  const byHour = hours.map((h) => (h.length >= 8 ? trimmedMean(h) : null));

  const days = [...new Set(runs.map((r) => localDay(new Date(r.at))))].map(dayNumber).sort((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }
  const today = dayNumber(localDay(now));
  const lastDay = days.length ? days[days.length - 1] : null;
  const streak = lastDay !== null && lastDay >= today - 1 ? run : 0;

  return {
    best,
    bestAvg,
    current,
    extra,
    mean: counted.length ? mean(sortedMs) : null,
    median: counted.length ? median(sortedMs) : null,
    solved: runs.length,
    daysPlayed: days.length,
    streak,
    longestStreak,
    pbs,
    firsts,
    fewestExtra: [...withExtra].sort((a, b) => a.extra! - b.extra! || a.n - b.n).slice(0, 6),
    fit,
    histogram,
    byHour,
  };
}
