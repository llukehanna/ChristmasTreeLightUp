import { describe, expect, it } from 'vitest';
import { HISTORY_FIRST_DAY } from '../../../src/api/types';
import { mulberry32 } from '../../../src/core/rng';
import { dayNumber, dayText, localDayOf, streaksOf } from '../../../worker/lib/days';
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

/** 600 valid inputs from a fixed seed: sizes up to 2,000, offsets from -840 to 840, streaks that fit and that don't. */
function sweep(): HistoryInput[] {
  const r = mulberry32(2026);
  const out: HistoryInput[] = [];
  for (let c = 0; c < 600; c++) {
    const tz = [420, 0, -330, 480, -600, 840, -840][c % 7];
    const today = localDayOf(NOW, tz);
    const solved = c % 50 === 0 ? 2000 : 1 + Math.floor(r() * 60);
    const bestMs = (5 + Math.floor(r() * 200)) * 1000;
    const streak = 1 + Math.floor(r() * 12);
    out.push({
      importId: `case${String(c).padStart(4, '0')}_xxxxxxxxxxxx`,
      solved,
      bestMs,
      averageMs: solved === 1 ? bestMs : bestMs + Math.floor(r() * 100_000),
      streak,
      longestStreak: streak + Math.floor(r() * 6),
      lastDay: FIRST + Math.floor(r() * (today - FIRST + 1)),
      tz,
      now: NOW,
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
      expect(ms.indexOf(c.bestMs)).toBeGreaterThanOrEqual(Math.floor(c.solved * BEST_FROM));
      if (c.solved * (c.averageMs - c.bestMs) >= c.solved - 1) expect(ms.filter((m) => m === c.bestMs)).toHaveLength(1);
    });
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

  it('refuses inputs the route never passes', () => {
    expect(() => fabricateHistory({ ...base, lastDay: FIRST - 1 })).toThrow(RangeError);
    expect(() => fabricateHistory({ ...base, solved: 0 })).toThrow(RangeError);
  });
});

describe('parseImportRequest', () => {
  const ok = { importId: 'AbCdEfGhIjKlMnOpQrStUv', solved: 40, bestSeconds: 41, averageMs: 78_500, streak: 3, longestStreak: 5, lastSolvedDay: '2026-10-07', tz: 420 };

  it('accepts a valid body', () => {
    expect(parseImportRequest(ok, NOW)).toEqual({ importId: ok.importId, solved: 40, bestMs: 41_000, averageMs: 78_500, streak: 3, longestStreak: 5, lastDay: dayNumber('2026-10-07'), tz: 420 });
    expect(typeof parseImportRequest({ ...ok, solved: 1, averageMs: 41_000 }, NOW)).toBe('object'); // one game: average = best
    expect(typeof parseImportRequest({ ...ok, lastSolvedDay: '2026-10-08' }, NOW)).toBe('object'); // today, in California
  });

  it.each([
    [{ importId: 'short' }, 'importId'],
    [{ importId: 'has spaces in it here!!' }, 'importId'],
    [{ solved: 0 }, 'Games solved'],
    [{ solved: 2001 }, 'Games solved'],
    [{ solved: 2.5 }, 'Games solved'],
    [{ bestSeconds: 4 }, 'Best time'],
    [{ bestSeconds: 3601 }, 'Best time'],
    [{ bestSeconds: '41' }, 'Best time'],
    [{ averageMs: 40_999 }, 'Average time'],
    [{ averageMs: 3_600_001 }, 'Average time'],
    [{ solved: 1, averageMs: 42_000 }, 'one game'],
    [{ streak: 0 }, 'Streaks'],
    [{ streak: 6, longestStreak: 5 }, 'Streaks'],
    [{ longestStreak: 3651 }, 'Streaks'],
    [{ tz: 841 }, 'tz'],
    [{ tz: '420' }, 'tz'],
    [{ lastSolvedDay: '2026-09-28' }, 'Last solved day'],
    [{ lastSolvedDay: '2026-10-09' }, 'Last solved day'], // tomorrow in California
    [{ lastSolvedDay: '2026-02-30' }, 'Last solved day'],
  ])('refuses %o', (over, field) => {
    const r = parseImportRequest({ ...ok, ...over }, NOW);
    expect(typeof r).toBe('string');
    expect(r).toContain(field);
  });
});
