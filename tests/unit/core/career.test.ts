import { describe, expect, it } from 'vitest';
import { CAREER_DAILY_FIRST, CAREER_IMPORTED, CAREER_PAST, CAREER_REPLAY, type CareerRow } from '../../../src/api/types';
import { careerStats, parseCareer, rollingAverage, trimmedMean, trimOf, type CareerRun } from '../../../src/core/career';
import type { UnrankedReason } from '../../../src/core/judge';

/** Midday local time on a day offset from NOW's day, so every timezone agrees on the date. */
const NOW = new Date(2026, 10, 15, 12, 0, 0);
const at = (dayOffset: number, hour = 12) => new Date(2026, 10, 15 + dayOffset, hour, 0, 0).getTime();

let seq = 0;
const row = (
  s: number,
  o: { at?: number; turns?: number | null; min?: number | null; flags?: number; reason?: UnrankedReason | null } = {},
): CareerRow => [`r${seq++}`, o.at ?? at(-1), Math.round(s * 1000), o.turns ?? null, o.min ?? null, o.flags ?? 0, o.reason ?? null, null];
const runsOf = (...secs: number[]) => parseCareer(secs.map((s) => row(s)));

const walk = (v: unknown, path = ''): string[] => {
  if (typeof v === 'number') return Number.isFinite(v) ? [] : [path];
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => walk(x, `${path}.${k}`));
  return [];
};

describe('trimOf and trimmedMean', () => {
  it('drops the ceiling of 5%, at least one', () => {
    expect([5, 12, 50, 100].map(trimOf)).toEqual([1, 1, 3, 5]);
  });
  it('averages without the fastest and slowest', () => {
    expect(trimmedMean([1, 2, 3, 4, 100])).toBe(3);
    expect(trimmedMean([])).toBeNull();
    expect(trimmedMean([7])).toBe(7);
  });
});

describe('parseCareer', () => {
  it('clamps extra turns at zero and needs a positive minimum', () => {
    const [a, b, c, d] = parseCareer([row(40, { turns: 120, min: 84 }), row(40, { turns: 80, min: 84 }), row(40, { turns: 80, min: 0 }), row(40, { turns: 80, min: null })]);
    expect([a.extra, b.extra, c.extra, d.extra]).toEqual([36, 0, null, null]);
  });
  it('unpacks the flags and the counting reason', () => {
    const [r] = parseCareer([row(40, { flags: CAREER_IMPORTED | CAREER_REPLAY | CAREER_PAST })]);
    expect([r.imported, r.replay, r.past, r.dailyFirst, r.n]).toEqual([true, true, true, false, 1]);
    const [first] = parseCareer([row(40, { flags: CAREER_DAILY_FIRST, reason: 'daily' })]);
    expect([first.dailyFirst, first.past, first.imported]).toEqual([true, false, false]);
    const [fast, paused, clock] = parseCareer([row(3, { reason: 'too_fast' }), row(40, { reason: 'paused' }), row(40, { reason: 'clock' })]);
    expect([fast.counts, paused.counts, clock.counts]).toEqual([false, true, false]);
  });
});

describe('rollingAverage', () => {
  it('is null until n counted runs, then the trimmed mean of the window', () => {
    const runs = runsOf(10, 20, 30, 40, 100, 50);
    const avg = rollingAverage(runs, 5);
    expect(avg.slice(0, 4)).toEqual([null, null, null, null]);
    expect(avg[4]).toBe(trimmedMean([10000, 20000, 30000, 40000, 100000]));
    expect(avg[5]).toBe(trimmedMean([20000, 30000, 40000, 100000, 50000]));
  });
  it('skips an uncounted run and leaves its slot null', () => {
    const runs = parseCareer([row(10), row(20), row(2, { reason: 'too_fast' }), row(30), row(40), row(50)]);
    const avg = rollingAverage(runs, 5);
    expect(avg[2]).toBeNull();
    expect(avg[3]).toBeNull();
    expect(avg[5]).toBe(30000);
  });
  it('matches a plain sort-and-trim over a long career', () => {
    const secs = Array.from({ length: 300 }, (_, i) => 30 + ((i * 37) % 23) + (i % 7) / 10);
    const runs = runsOf(...secs);
    const avg = rollingAverage(runs, 50);
    for (const i of [49, 120, 299]) expect(avg[i]).toBeCloseTo(trimmedMean(runs.slice(i - 49, i + 1).map((r) => r.ms))!, 6);
  });
});

describe('careerStats', () => {
  it('ignores a too_fast run everywhere except solved', () => {
    const runs = parseCareer([row(40), row(3, { reason: 'too_fast' }), row(41), row(42), row(43), row(44)]);
    const s = careerStats(runs, NOW);
    expect(s.best!.ms).toBe(40000);
    expect(s.pbs.map((p) => p.run.ms)).toEqual([40000]);
    expect(s.firsts.map((f) => f.underS)).toEqual([60, 50, 45]);
    expect(s.current[5]!.ms).toBe(42000);
    expect(s.solved).toBe(6);
    expect(s.histogram.every((b) => b.fromS >= 40)).toBe(true);
  });

  it('lists the personal bests with their gains', () => {
    const s = careerStats(runsOf(50, 48, 49, 45), NOW);
    expect(s.pbs.map((p) => [p.run.ms, p.gain])).toEqual([[50000, null], [48000, 2000], [45000, 3000]]);
  });

  it('finds the first run under each threshold', () => {
    const s = careerStats(runsOf(61, 55, 44, 39), NOW);
    expect(s.firsts.map((f) => [f.underS, f.run.n])).toEqual([[60, 2], [50, 3], [45, 3], [40, 4]]);
  });

  it('counts days and streaks on the local clock', () => {
    const rows = [-3, -2, 0, 0].map((d) => row(40, { at: at(d) }));
    const s = careerStats(parseCareer(rows), NOW);
    expect([s.streak, s.longestStreak, s.daysPlayed]).toEqual([1, 2, 3]);
    const alive = careerStats(parseCareer([-3, -2, -1].map((d) => row(40, { at: at(d) }))), NOW);
    expect([alive.streak, alive.longestStreak]).toEqual([3, 3]);
    const dead = careerStats(parseCareer([-5, -4, -2].map((d) => row(40, { at: at(d) }))), NOW);
    expect([dead.streak, dead.longestStreak]).toEqual([0, 2]);
  });

  it('fits seconds against extra turns', () => {
    const rows = [0, 4, 8, 12, 20].map((e) => row(10 + 0.5 * e, { turns: 100 + e, min: 100 }));
    const f = careerStats(parseCareer(rows), NOW).fit!;
    expect(f.slope).toBeCloseTo(0.5, 9);
    expect(f.intercept).toBeCloseTo(10, 9);
    expect(f.recentExtra).toBeCloseTo(8.8, 9);
    expect(f.recentS).toBeCloseTo(14.4, 9);
    expect(careerStats(runsOf(40, 41), NOW).fit).toBeNull();
  });

  it('fits the line over every run with turns, and the marker over the last 100', () => {
    const rows = Array.from({ length: 150 }, (_, i) => {
      const e = i % 20;
      return row(10 + (i < 50 ? 1 : 0.5) * e, { turns: 100 + e, min: 100 });
    });
    const f = careerStats(parseCareer(rows), NOW).fit!;
    expect(f.slope).toBeGreaterThan(0.5);
    expect(f.slope).toBeLessThan(1);
    const last = rows.slice(-100).map((_, i) => (i + 50) % 20);
    expect(f.recentExtra).toBeCloseTo(last.reduce((a, b) => a + b, 0) / 100, 9);
    expect(f.recentS).toBeCloseTo(10 + 0.5 * f.recentExtra, 9);
  });

  it('keeps the last 100 runs with turns for the fit, and the fewest extra turns', () => {
    const rows = Array.from({ length: 110 }, (_, i) => row(30, { turns: 100 + (i % 10), min: 100 }));
    const s = careerStats(parseCareer(rows), NOW);
    expect(s.fewestExtra.map((r) => [r.extra, r.n])).toEqual([[0, 1], [0, 11], [0, 21], [0, 31], [0, 41], [0, 51]]);
    expect(s.extra!.last50).toBe(4.5);
  });

  it('bins counted runs under 100 s into 2 s bins', () => {
    const s = careerStats(runsOf(41.0, 41.9, 43.5, 120), NOW);
    expect(s.histogram).toEqual([{ fromS: 40, count: 2 }, { fromS: 42, count: 1 }]);
  });

  it('gives an hour an average only from 8 runs', () => {
    const seven = Array.from({ length: 7 }, (_, i) => row(30 + i, { at: at(-1, 9) }));
    const eight = Array.from({ length: 8 }, (_, i) => row(30 + i, { at: at(-1, 21) }));
    const s = careerStats(parseCareer([...seven, ...eight]), NOW);
    expect(s.byHour).toHaveLength(24);
    expect(s.byHour[9]).toBeNull();
    expect(s.byHour[21]).toBe(trimmedMean(eight.map((r) => r[2])));
  });

  it('reads the average of 12 as it stood a week ago', () => {
    const old = Array.from({ length: 12 }, (_, i) => row(50, { at: at(-10 + i * 0.01) }));
    const recent = Array.from({ length: 12 }, () => row(40, { at: at(-1) }));
    const s = careerStats(parseCareer([...old, ...recent]), NOW);
    expect(s.current[12]).toEqual({ ms: 40000, weekAgo: 50000 });
    expect(careerStats(parseCareer(recent), NOW).current[12]!.weekAgo).toBeNull();
  });

  it('is empty and finite with no runs, one run or no turns', () => {
    const empty = careerStats([], NOW);
    expect(empty.best).toBeNull();
    expect(empty.solved).toBe(0);
    expect(empty.fit).toBeNull();
    expect(empty.histogram).toEqual([]);
    expect([empty.mean, empty.median, empty.extra, empty.current[5], empty.bestAvg[5]]).toEqual([null, null, null, null, null]);
    expect([empty.streak, empty.longestStreak, empty.daysPlayed]).toEqual([0, 0, 0]);
    const one = careerStats(runsOf(40), NOW);
    expect(one.current[5]).toBeNull();
    expect(one.best!.ms).toBe(40000);
    for (const s of [empty, one, careerStats(runsOf(40, 41, 42, 43), NOW)]) expect(walk(s)).toEqual([]);
  });

  it('computes 10,000 runs sanely', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => row(25 + ((i * 7919) % 4000) / 100, { at: at(-300) + i * 60_000, turns: 90 + (i % 30), min: 84 }));
    const runs = parseCareer(rows);
    const t0 = performance.now();
    const s = careerStats(runs, NOW);
    const ms = performance.now() - t0;
    expect(s.solved).toBe(10_000);
    expect(walk(s)).toEqual([]);
    expect(runs.filter((r: CareerRun) => r.counts).every((r) => s.best!.ms <= r.ms)).toBe(true);
    if (process.env.PERF === '1') expect(ms).toBeLessThan(150);
  });
});
