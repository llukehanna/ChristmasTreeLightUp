import { expect, it } from 'vitest';
import { esc, formatDay, formatMs, formatWhen, initial, plural, UNRANKED_TEXT } from '../../../src/ui/format';

it('formats ranked times as m:ss.t, never rounding a time up', () => {
  expect(formatMs(81_049)).toBe('1:21.0');
  expect(formatMs(81_099)).toBe('1:21.0');
  expect(formatMs(59_999)).toBe('0:59.9');
  expect(formatMs(600_000)).toBe('10:00.0');
  expect(formatMs(-5)).toBe('0:00.0');
});

it('dates: today and yesterday by name, else month and day (with the year when it differs)', () => {
  const now = new Date(2026, 11, 3, 22, 0).getTime();
  expect(formatWhen(new Date(2026, 11, 3, 21, 41).getTime(), now)).toBe('Today · 9:41 pm');
  expect(formatWhen(new Date(2026, 11, 2, 0, 5).getTime(), now)).toBe('Yesterday · 12:05 am');
  expect(formatWhen(new Date(2026, 10, 30, 12, 0).getTime(), now)).toBe('Nov 30 · 12:00 pm');
  expect(formatDay(new Date(2025, 11, 24).getTime(), now)).toBe('Dec 24, 2025');
  expect(formatDay(new Date(2026, 0, 2).getTime(), now)).toBe('Jan 2');
});

it('escapes, initials, plurals and the unranked reasons', () => {
  expect(esc(`<b a="1">'&`)).toBe('&#60;b a=&#34;1&#34;&#62;&#39;&#38;');
  expect(initial(' comet')).toBe('C');
  expect(plural(1, 'run')).toBe('1 run');
  expect(plural(1340, 'run')).toBe('1,340 runs');
  expect(UNRANKED_TEXT).toEqual({
    anonymous: 'not signed in',
    paused: 'paused too long',
    too_fast: 'too fast',
    clock: "couldn't verify the clock",
    offline: 'offline',
    unverified: "couldn't verify this run",
  });
});
