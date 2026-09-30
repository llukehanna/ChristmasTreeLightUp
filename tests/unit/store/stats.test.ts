import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, averageSeconds, localDay, recordWin } from '../../../src/store/stats';

describe('recordWin', () => {
  it('records the first win as a new best with a 1-day streak', () => {
    const { stats, newBest } = recordWin(EMPTY_STATS, 84, 41600, '2026-12-01');
    expect(newBest).toBe(true);
    expect(stats).toMatchObject({ solved: 1, bestSeconds: 84, bestScore: 41600, streak: 1, longestStreak: 1, lastSolvedDay: '2026-12-01' });
  });
  it('keeps the streak on the same day, grows it on the next day, resets after a gap', () => {
    let s = recordWin(EMPTY_STATS, 90, 41000, '2026-12-01').stats;
    s = recordWin(s, 100, 40000, '2026-12-01').stats;
    expect(s.streak).toBe(1);
    s = recordWin(s, 80, 42000, '2026-12-02').stats;
    expect(s.streak).toBe(2);
    s = recordWin(s, 80, 42000, '2026-12-05').stats;
    expect(s.streak).toBe(1);
    expect(s.longestStreak).toBe(2);
  });
  it('only flags a new best when faster', () => {
    const s = recordWin(EMPTY_STATS, 60, 44000, '2026-12-01').stats;
    expect(recordWin(s, 61, 43900, '2026-12-01').newBest).toBe(false);
    expect(recordWin(s, 59, 44100, '2026-12-01').newBest).toBe(true);
  });
  it('crosses month boundaries for streaks', () => {
    const s = recordWin(EMPTY_STATS, 60, 44000, '2026-11-30').stats;
    expect(recordWin(s, 60, 44000, '2026-12-01').stats.streak).toBe(2);
  });
});

it('averages solve time and formats local days', () => {
  const s = recordWin(recordWin(EMPTY_STATS, 60, 0, '2026-12-01').stats, 90, 0, '2026-12-01').stats;
  expect(averageSeconds(s)).toBe(75);
  expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05');
});
