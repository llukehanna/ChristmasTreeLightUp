// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { landsOnDaily, markDailyStarted } from '../../../src/store/daily';

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
