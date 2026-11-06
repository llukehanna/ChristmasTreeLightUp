// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dailyStart, landsOnDaily, markDailyStarted } from '../../../src/store/daily';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("lands on the Daily until this device starts today's", () => {
  expect(landsOnDaily('2026-11-06')).toBe(true);
  markDailyStarted('2026-11-06');
  expect(localStorage.getItem('aglow.daily')).toBe('"2026-11-06"');
  expect(landsOnDaily('2026-11-06')).toBe(false);
});

it('a new local day lands on it again', () => {
  markDailyStarted('2026-11-06');
  expect(landsOnDaily('2026-11-07')).toBe(true);
});

it('blocked storage lands on it', () => {
  markDailyStarted('2026-11-06');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(landsOnDaily('2026-11-06')).toBe(true);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => markDailyStarted('2026-11-07')).not.toThrow();
});

it('a corrupt value lands on it', () => {
  localStorage.setItem('aglow.daily', '{not json');
  expect(landsOnDaily('2026-11-06')).toBe(true);
  localStorage.setItem('aglow.daily', '7');
  expect(landsOnDaily('2026-11-06')).toBe(true);
});

it("a guest's start of the Daily is a repeat when this device had started that day's before; it marks the device", () => {
  const live = { day: '2026-11-06', past: false, repeat: false };
  // A first go: as the server said, and the device is marked from now.
  expect(dailyStart(live, false)).toEqual(live);
  expect(landsOnDaily('2026-11-06')).toBe(false);
  // The device was marked before this start (a guest's second go, which the server can't know): a repeat.
  expect(dailyStart(live, false)).toEqual({ ...live, repeat: true });
  // Marked for another day: not this day's repeat.
  markDailyStarted('2026-11-05');
  expect(dailyStart(live, false)).toEqual(live);
});

it("a signed-in player's repeat is the server's to decide: the device mark never makes one, though it is still written", () => {
  const live = { day: '2026-11-06', past: false, repeat: false };
  // Marked by a guest go this account never finished, or by another account on this device: still a first go.
  markDailyStarted('2026-11-06');
  expect(dailyStart(live, true)).toEqual(live);
  localStorage.clear();
  expect(dailyStart(live, true)).toEqual(live);
  expect(landsOnDaily('2026-11-06')).toBe(false);
  // The server knows the account's earlier go (on another device, say): a repeat.
  localStorage.clear();
  expect(dailyStart({ ...live, repeat: true }, true)).toEqual({ ...live, repeat: true });
  expect(landsOnDaily('2026-11-06')).toBe(false);
});

it("a past day's tree is never a repeat, and never marks the device", () => {
  const past = { day: '2026-11-03', past: true, repeat: false };
  markDailyStarted('2026-11-03');
  expect(dailyStart(past, false)).toEqual(past);
  localStorage.clear();
  expect(dailyStart(past, false)).toEqual(past);
  expect(localStorage.getItem('aglow.daily')).toBeNull();
});
