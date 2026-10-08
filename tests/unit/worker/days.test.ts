import { describe, expect, it } from 'vitest';
import { dayNumber, dayText, isTzOffset, localDayOf, localMidnight, streaksOf } from '../../../worker/lib/days';

describe('days', () => {
  it('reads real YYYY-MM-DD dates only, and writes them back', () => {
    const n = dayNumber('2026-09-29');
    expect(n).toBe(Date.UTC(2026, 8, 29) / 86_400_000);
    expect(dayText(n as number)).toBe('2026-09-29');
    for (const bad of ['2026-02-30', '2026-13-01', '2026-9-29', '26-09-29', '0099-01-01', '', null, 20260929]) expect(dayNumber(bad)).toBeNull();
  });

  it('a local day follows the offset Date#getTimezoneOffset gives (UTC minus local)', () => {
    const at = Date.UTC(2026, 9, 8, 5, 30); // 05:30 UTC: 22:30 on Oct 7 in California (420), 15:30 on Oct 8 in Sydney (-600)
    expect(dayText(localDayOf(at, 420))).toBe('2026-10-07');
    expect(dayText(localDayOf(at, 0))).toBe('2026-10-08');
    expect(dayText(localDayOf(at, -600))).toBe('2026-10-08');
    const oct7 = dayNumber('2026-10-07') as number;
    expect(localMidnight(oct7, 420)).toBe(Date.UTC(2026, 9, 7, 7, 0));
    expect(localDayOf(localMidnight(oct7, 420), 420)).toBe(oct7);
    expect(localDayOf(localMidnight(oct7, 420) - 1, 420)).toBe(oct7 - 1);
  });

  it('offsets are whole minutes within 14 hours', () => {
    expect([0, 420, -840, 840].every((v) => isTzOffset(v))).toBe(true);
    expect([841, -841, 1.5, '420', null].some((v) => isTzOffset(v))).toBe(false);
  });

  it('streaks: the run ending today or yesterday (else 0), and the longest run', () => {
    const d = dayNumber('2026-10-08') as number;
    expect(streaksOf([], d)).toEqual({ streak: 0, longestStreak: 0 });
    expect(streaksOf([d - 6, d - 5, d - 4, d - 2, d - 1, d], d)).toEqual({ streak: 3, longestStreak: 3 });
    expect(streaksOf([d - 6, d - 5, d - 4, d - 3, d - 1], d)).toEqual({ streak: 1, longestStreak: 4 });
    expect(streaksOf([d - 3, d - 2], d)).toEqual({ streak: 0, longestStreak: 2 }); // last played two days ago: broken
    expect(streaksOf([d - 1], d)).toEqual({ streak: 1, longestStreak: 1 }); // yesterday still counts
  });
});
