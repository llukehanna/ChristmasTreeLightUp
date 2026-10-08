import { describe, expect, it } from 'vitest';
import { HISTORY_FIRST_DAY, MAX_IMPORT_MS, MAX_STREAK_DAYS } from '../../../src/api/types';
import { mulberry32 } from '../../../src/core/rng';
import { dayNumber, dayText, localDayOf, localMidnight, streaksOf } from '../../../worker/lib/days';
import { BEST_FROM, fabricateHistory, importRunId, parseImportRequest, split, type History, type HistoryInput } from '../../../worker/lib/history';
import { GAME_ID } from '../../../worker/routes/games';

const FIRST = dayNumber(HISTORY_FIRST_DAY) as number;
/** 13:00 on 2026-10-08 in California (PDT, offset 420). */
const NOW = Date.UTC(2026, 9, 8, 20, 0);
const base: HistoryInput = {
  importId: 'AbCdEfGhIjKlMnOpQrStUv',
  solved: 40,
  bestMs: 41_000,
  averageMs: 78_500,
  streak: 3,
  longestStreak: 5,
  lastDay: dayNumber('2026-10-07') as number,
  tz: 420,
  now: NOW,
};

/** The distinct local days of a history's finishes, ascending. */
const daysOf = (h: History, tz: number): number[] => [...new Set(h.runs.map((r) => localDayOf(r.finishedAt, tz)))].sort((a, b) => a - b);
const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * 600 valid inputs from a fixed seed: sizes up to 2,000, offsets from -840 to 840, streaks that fit and that don't, and
 * the edges: an average equal to (or 1 ms over) the best, bests and averages up to an hour, streaks up to ten years, and
 * a clock just after local midnight (the earliest the last day can be today) with the last day today.
 */
function sweep(): HistoryInput[] {
  const r = mulberry32(2026);
  const out: HistoryInput[] = [];
  for (let c = 0; c < 600; c++) {
    const tz = [420, 0, -330, 480, -600, 840, -840][c % 7];
    const solved = c % 50 === 0 ? 2000 : 1 + Math.floor(r() * 60);
    // Every 3rd case the clock is just after local midnight (every 6th, at the very first moment a last day of today is valid).
    const now = c % 3 === 0 ? localMidnight(localDayOf(NOW, tz), tz) + 1000 + (solved - 1) + (c % 6 === 0 ? 0 : Math.floor(r() * 4000)) : NOW;
    const today = localDayOf(now - 1000 - (solved - 1), tz);
    const bestMs = (5 + Math.floor(r() * (c % 11 === 0 ? 3596 : 200))) * 1000;
    let averageMs = bestMs + Math.floor(r() * 100_000);
    if (c % 10 === 1) averageMs = bestMs;
    else if (c % 10 === 2) averageMs = bestMs + 1;
    else if (c % 13 === 0) averageMs = bestMs + Math.floor(r() * (MAX_IMPORT_MS - bestMs));
    if (solved === 1) averageMs = bestMs;
    const streak = 1 + Math.floor(r() * (c % 9 === 0 ? MAX_STREAK_DAYS : 12));
    out.push({
      importId: `case${String(c).padStart(4, '0')}_xxxxxxxxxxxx`,
      solved,
      bestMs,
      averageMs: Math.min(averageMs, MAX_IMPORT_MS),
      streak,
      longestStreak: Math.min(MAX_STREAK_DAYS, streak + Math.floor(r() * 6)),
      lastDay: c % 6 === 0 ? today : FIRST + Math.floor(r() * (today - FIRST + 1)),
      tz,
      now,
    });
  }
  return out;
}

describe('split', () => {
  it('whole, non-negative parts in proportion that add up exactly', () => {
    expect(split(10, [1, 1, 1])).toEqual([3, 3, 4]);
    expect(split(0, [1, 2])).toEqual([0, 0]);
    expect(split(7, [0.2, 5, 1])).toEqual([0, 5, 2]);
    const parts = split(7_200_000_000, Array.from({ length: 1999 }, (_, i) => 1 + (i % 7)));
    expect(parts.reduce((s, p) => s + p, 0)).toBe(7_200_000_000);
    expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
  });
});

describe('fabricateHistory', () => {
  const all = sweep();
  const made = all.map((c) => fabricateHistory(c));

  it('one run is exactly the best, and none is faster', () => {
    all.forEach((c, k) => expect(Math.min(...made[k].runs.map((x) => x.ms))).toBe(c.bestMs));
  });

  it('the runs add up to exactly solved × average', () => {
    all.forEach((c, k) => {
      expect(made[k].runs).toHaveLength(c.solved);
      expect(made[k].runs.reduce((s, x) => s + x.ms, 0)).toBe(c.solved * c.averageMs);
    });
  });

  it('the best comes in the last 40%, and is the only run that fast whenever the average leaves room', () => {
    all.forEach((c, k) => {
      const ms = made[k].runs.map((x) => x.ms);
      if (c.solved * (c.averageMs - c.bestMs) >= c.solved - 1) {
        expect(ms.filter((m) => m === c.bestMs)).toHaveLength(1);
        expect(ms.indexOf(c.bestMs)).toBeGreaterThanOrEqual(Math.floor(c.solved * BEST_FROM));
      }
    });
  });

  it('an average equal to the best means every game is the best', () => {
    const h = fabricateHistory({ ...base, bestMs: 41_000, averageMs: 41_000 });
    expect(h.runs.map((x) => x.ms)).toEqual(Array(40).fill(41_000));
  });

  it('no date before 2026-09-29 or after lastSolvedDay (local); the last day is played; nothing later than a second ago', () => {
    all.forEach((c, k) => {
      const days = daysOf(made[k], c.tz);
      expect(days[0]).toBeGreaterThanOrEqual(FIRST);
      expect(days.at(-1)).toBe(c.lastDay);
      for (const x of made[k].runs) expect(x.finishedAt).toBeLessThanOrEqual(c.now - 1000);
    });
  });

  it('finishes come one after another, in index order', () => {
    for (const h of made) for (let i = 1; i < h.runs.length; i++) expect(h.runs[i].finishedAt).toBeGreaterThan(h.runs[i - 1].finishedAt);
  });

  it('streaks computed from the dates are the ones asked for when they fit, else the clamped ones it reports', () => {
    let fit = 0;
    all.forEach((c, k) => {
      const h = made[k];
      expect(streaksOf(daysOf(h, c.tz), c.lastDay)).toEqual({ streak: h.streak, longestStreak: h.longestStreak });
      if (!h.clamped) {
        fit++;
        expect([h.streak, h.longestStreak]).toEqual([c.streak, c.longestStreak]);
      }
    });
    expect(fit).toBeGreaterThan(50); // the sweep exercises both
  });

  it('clamps what does not fit: the streak first, then the longest run, keeping a gap day between them', () => {
    const oct2 = dayNumber('2026-10-02') as number;
    // Sep 29 – Oct 2 is 4 days: after a 3-day streak and its gap day there is no room for a longer run.
    expect(fabricateHistory({ ...base, lastDay: oct2 })).toMatchObject({ streak: 3, longestStreak: 3, clamped: true });
    // A streak longer than the window takes the whole window.
    expect(fabricateHistory({ ...base, lastDay: oct2, streak: 9, longestStreak: 9 })).toMatchObject({ streak: 4, longestStreak: 4, clamped: true });
    // Fewer games than streak days: one game a day, as far as they go.
    expect(fabricateHistory({ ...base, solved: 2, averageMs: 50_000, streak: 5, longestStreak: 5 })).toMatchObject({ streak: 2, longestStreak: 2, clamped: true });
    // Fits: Oct 5–7, a gap on Oct 4, then Sep 29 – Oct 3.
    const fit = fabricateHistory(base);
    expect(fit).toMatchObject({ streak: 3, longestStreak: 5, clamped: false });
    expect(daysOf(fit, 420).map(dayText)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('is the same every time for the same importId, and different for another', () => {
    expect(fabricateHistory(base)).toEqual(fabricateHistory(base));
    const other = fabricateHistory({ ...base, importId: 'ZyXwVuTsRqPoNmLkJiHgFe' });
    expect(other.runs.map((x) => x.ms)).not.toEqual(fabricateHistory(base).runs.map((x) => x.ms));
  });

  it('ids are stable per importId and index, and fit the game id pattern', () => {
    const h = fabricateHistory(base);
    expect(h.runs.map((x) => x.id)).toEqual(h.runs.map((_, i) => importRunId(base.importId, i)));
    expect(importRunId(base.importId, 7)).toBe('imp_AbCdEfGhIjKlMnOpQrStUv_0007');
    for (const x of h.runs) expect(x.id).toMatch(GAME_ID);
  });

  it('earlier games are slower on average (the improvement trend), and times skew right', () => {
    for (const importId of ['aaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbb', 'Zz09_-Zz09_-Zz09_-Zz09']) {
      const ms = fabricateHistory({ ...base, importId, solved: 300, bestMs: 40_000, averageMs: 75_000 }).runs.map((x) => x.ms);
      expect(mean(ms.slice(0, 100))).toBeGreaterThan(mean(ms.slice(200)));
      expect(mean(ms)).toBeGreaterThan([...ms].sort((a, b) => a - b)[150]); // mean above the median
    }
  });

  it('games are played at plausible hours: none before 7 am in a typical import', () => {
    for (const x of fabricateHistory({ ...base, solved: 300, averageMs: 75_000 }).runs) {
      expect(new Date(x.finishedAt - 420 * 60_000).getUTCHours()).toBeGreaterThanOrEqual(7);
    }
  });

  it('the earliest the last day can be today is when all its finishes fit before a second ago', () => {
    const today = dayNumber('2026-10-08') as number;
    const midnight = localMidnight(today, 420);
    for (const solved of [1, 40, 2000]) {
      const now = midnight + 1000 + (solved - 1);
      const h = fabricateHistory({ ...base, solved, averageMs: solved === 1 ? base.bestMs : 78_500, lastDay: today, now });
      expect(h.runs.at(-1)?.finishedAt).toBeLessThanOrEqual(now - 1000);
      expect(daysOf(h, 420).at(-1)).toBe(today);
    }
  });

  it('refuses inputs the route never passes', () => {
    const today = dayNumber('2026-10-08') as number;
    const midnight = localMidnight(today, 420);
    expect(() => fabricateHistory({ ...base, lastDay: FIRST - 1 })).toThrow(RangeError);
    expect(() => fabricateHistory({ ...base, solved: 0 })).toThrow(RangeError);
    expect(() => fabricateHistory({ ...base, lastDay: today + 1 })).toThrow(RangeError); // after today
    expect(() => fabricateHistory({ ...base, lastDay: today, now: midnight + 1000 + 38 })).toThrow(RangeError); // 40 games don't fit before a second ago
    expect(() => fabricateHistory({ ...base, averageMs: 40_999 })).toThrow(RangeError); // faster on average than the best
    expect(() => fabricateHistory({ ...base, solved: 1, averageMs: 42_000 })).toThrow(RangeError); // one game: average = best
  });
});

describe('parseImportRequest', () => {
  const ok = { importId: 'AbCdEfGhIjKlMnOpQrStUv', solved: 40, bestSeconds: 41, averageMs: 78_500, streak: 3, longestStreak: 5, lastSolvedDay: '2026-10-07', tz: 420 };

  it('accepts a valid body', () => {
    expect(parseImportRequest(ok, NOW)).toEqual({ importId: ok.importId, solved: 40, bestMs: 41_000, averageMs: 78_500, streak: 3, longestStreak: 5, lastDay: dayNumber('2026-10-07'), tz: 420 });
    expect(typeof parseImportRequest({ ...ok, solved: 1, averageMs: 41_000 }, NOW)).toBe('object'); // one game: average = best
    expect(typeof parseImportRequest({ ...ok, lastSolvedDay: '2026-10-08' }, NOW)).toBe('object'); // today, in California
  });

  it('accepts today from the first moment all its finishes fit before a second ago, and not before', () => {
    const midnight = localMidnight(dayNumber('2026-10-08') as number, 420);
    expect(typeof parseImportRequest({ ...ok, lastSolvedDay: '2026-10-08' }, midnight + 1000 + 39)).toBe('object');
    expect(parseImportRequest({ ...ok, lastSolvedDay: '2026-10-08' }, midnight + 500)).toBe(LAST_DAY);
    expect(parseImportRequest({ ...ok, lastSolvedDay: '2026-10-08' }, midnight + 1000 + 38)).toBe(LAST_DAY);
    expect(typeof parseImportRequest({ ...ok, lastSolvedDay: '2026-10-07' }, midnight + 500)).toBe('object'); // yesterday is always fine
  });

  const ID = 'importId must be 16–32 letters, digits, - or _.';
  const SOLVED = 'Games solved must be a whole number from 1 to 2,000.';
  const BEST = 'Best time must be from 0:05 to 60:00, in whole seconds.';
  const AVERAGE = 'Average time must be at least the best time and at most 60:00.';
  const ONE = 'With one game, the average time is the best time.';
  const STREAKS = 'Streaks are whole days from 1 to 3,650, and the longest is at least the current one.';
  const TZ = 'tz must be whole minutes from -840 to 840.';
  const LAST_DAY = 'Last solved day must be a date from 2026-09-29 to today.';

  it.each([
    [{ importId: 'short' }, ID],
    [{ importId: 'has spaces in it here!!' }, ID],
    [{ importId: 'AbCdEfGhIjKlMnOpQrStUv\n' }, ID],
    [{ importId: 42 }, ID],
    [{ solved: 0 }, SOLVED],
    [{ solved: 2001 }, SOLVED],
    [{ solved: 2.5 }, SOLVED],
    [{ solved: null }, SOLVED],
    [{ solved: '40' }, SOLVED],
    [{ bestSeconds: 4 }, BEST],
    [{ bestSeconds: 3601 }, BEST],
    [{ bestSeconds: '41' }, BEST],
    [{ averageMs: 40_999 }, AVERAGE],
    [{ averageMs: 3_600_001 }, AVERAGE],
    [{ averageMs: 78_500.5 }, AVERAGE],
    [{ solved: 1, averageMs: 42_000 }, ONE],
    [{ streak: 0 }, STREAKS],
    [{ streak: '3' }, STREAKS],
    [{ streak: 6, longestStreak: 5 }, STREAKS],
    [{ longestStreak: 3651 }, STREAKS],
    [{ longestStreak: undefined }, STREAKS], // missing
    [{ tz: 841 }, TZ],
    [{ tz: '420' }, TZ],
    [{ tz: 420.5 }, TZ],
    [{ lastSolvedDay: '2026-09-28' }, LAST_DAY],
    [{ lastSolvedDay: '2026-10-09' }, LAST_DAY], // tomorrow in California
    [{ lastSolvedDay: '2026-02-30' }, LAST_DAY],
    [{ lastSolvedDay: '2026-10-07T00:00' }, LAST_DAY],
    [{ solved: 0, tz: 9999 }, SOLVED], // several faults: the first in the spec's order
    [{ bestSeconds: 4, streak: 0, lastSolvedDay: 'x' }, BEST],
  ])('refuses %o with exactly its message', (over, message) => {
    expect(parseImportRequest({ ...ok, ...over }, NOW)).toBe(message);
  });
});
