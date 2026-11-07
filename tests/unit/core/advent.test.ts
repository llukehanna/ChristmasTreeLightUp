import { expect, it } from 'vitest';
import { closesAt, doorDay, doorItem, doorState, seasonYear } from '../../../src/core/advent';
import { localDay } from '../../../src/store/stats';

const utc = (m: number, d: number, h = 0) => Date.UTC(2026, m - 1, d, h);
const local = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();

it('seasonYear: Nov and Dec are this year, Jan–Oct the year before', () => {
  expect([seasonYear('2026-11-06'), seasonYear('2026-12-24'), seasonYear('2027-03-01')]).toEqual([2026, 2026, 2026]);
  expect([seasonYear('2027-10-31'), seasonYear('2027-11-01')]).toEqual([2026, 2027]);
});

it('a door is its December day, and a day closes at UTC midnight two days on (the Worker\'s dailyClosesAt)', () => {
  expect([doorDay(6, '2026-12-09'), doorDay(24, '2027-02-01'), doorDay(1, '2027-11-30')]).toEqual(['2026-12-06', '2026-12-24', '2027-12-01']);
  expect(closesAt('2026-12-06')).toBe(utc(12, 8));
});

it('door 6 on Dec 6 is today; on Dec 7 it is waiting (opens Dec 8 local); from Dec 8 it is catch-up', () => {
  expect(doorState(6, '2026-12-06', local(12, 6), false)).toEqual({ state: 'today' });
  // Closed at Dec 8 00:00 UTC: the local date of that instant (Dec 8 in UTC and east of it, the evening of Dec 7 west).
  expect(doorState(6, '2026-12-07', utc(12, 8) - 1, false)).toEqual({ state: 'waiting', opensOn: localDay(new Date(utc(12, 8))) });
  expect(doorState(6, '2026-12-08', utc(12, 8), false)).toEqual({ state: 'catch-up' });
  expect(doorState(6, '2027-01-15', Date.UTC(2027, 0, 15), false)).toEqual({ state: 'catch-up' });
  // Every door is ahead in November, and the ones after today in December.
  expect(doorState(1, '2026-11-06', local(11, 6), false)).toEqual({ state: 'future' });
  expect(doorState(7, '2026-12-06', local(12, 6), false)).toEqual({ state: 'future' });
});

it('an opened door is open whatever the date', () => {
  for (const [today, now] of [['2026-11-06', local(11, 6)], ['2026-12-06', local(12, 6)], ['2026-12-07', utc(12, 8) - 1], ['2027-03-01', local(3, 1)]] as const) {
    expect(doorState(6, today, now, true)).toEqual({ state: 'open' });
  }
});

it('each door holds its catalogue item, door 6 the Gingerbread tag', () => {
  expect(doorItem(6)).toMatchObject({ id: 'tag:gingerbread', goal: 'door6' });
  expect(Array.from({ length: 24 }, (_, i) => doorItem(i + 1).goal)).toEqual(Array.from({ length: 24 }, (_, i) => `door${i + 1}`));
});
