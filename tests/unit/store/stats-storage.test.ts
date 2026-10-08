// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { EMPTY_STATS, loadStats, saveStats, statsBaseline } from '../../../src/store/stats';

beforeEach(() => localStorage.clear());

it('rejects corrupt or invalid stats and returns defaults', () => {
  // Sanity check: JSON.stringify converts Infinity to null, but JSON.parse('1e999') gives Infinity
  expect(JSON.parse('{"x":1e999}').x).toBe(Infinity);

  const corruptCases = [
    { totalSeconds: -5 },
    { bestSeconds: -1 },
    { solved: 1.5 },
    { streak: -1 },
    { longestStreak: -1 },
    { streak: 5, longestStreak: 3 },
    { lastSolvedDay: '2026-1-1' },
    { lastSolvedDay: 'invalid' },
    { v: 2 },
  ];
  for (const corrupt of corruptCases) {
    localStorage.clear();
    const invalid = { ...EMPTY_STATS, ...corrupt };
    localStorage.setItem('aglow.stats', JSON.stringify(invalid));
    expect(loadStats()).toEqual(EMPTY_STATS);
  }

  // Test Infinity values via raw JSON (JSON.stringify converts Infinity to null)
  const base = '"v":1,"solved":1,"bestScore":44000,"streak":1,"longestStreak":1,"lastSolvedDay":"2026-12-01"';
  localStorage.setItem('aglow.stats', `{${base},"totalSeconds":1e999,"bestSeconds":60}`);
  expect(loadStats()).toEqual(EMPTY_STATS);
  localStorage.setItem('aglow.stats', `{${base},"totalSeconds":60,"bestSeconds":-1e999}`);
  expect(loadStats()).toEqual(EMPTY_STATS);
});

it('round-trips valid stats through localStorage', () => {
  const valid = {
    v: 1 as const,
    solved: 5,
    totalSeconds: 450,
    bestSeconds: 85,
    bestScore: 42500,
    streak: 2,
    longestStreak: 3,
    lastSolvedDay: '2026-12-15',
  };
  saveStats(valid);
  expect(loadStats()).toEqual(valid);
});

it('statsBaseline: the device solved count at the first signed-in view for an account, kept after that', () => {
  expect(statsBaseline(7, 8)).toBe(8);
  expect(JSON.parse(localStorage.getItem('aglow.statsBaseline') as string)).toEqual({ userId: 7, solved: 8 });
  // The device keeps recording; the baseline stays.
  expect(statsBaseline(7, 20)).toBe(8);
});

it('statsBaseline: a different account signing in replaces it', () => {
  expect(statsBaseline(7, 8)).toBe(8);
  expect(statsBaseline(9, 12)).toBe(12);
  expect(JSON.parse(localStorage.getItem('aglow.statsBaseline') as string)).toEqual({ userId: 9, solved: 12 });
  expect(statsBaseline(7, 15)).toBe(15); // back to the first one: it is a new first view
});

it('statsBaseline: a corrupt value is replaced', () => {
  localStorage.setItem('aglow.statsBaseline', '{"userId":"x","solved":-1}');
  expect(statsBaseline(7, 5)).toBe(5);
  localStorage.setItem('aglow.statsBaseline', 'not json');
  expect(statsBaseline(7, 6)).toBe(6);
});

it('statsBaseline: null when storage cannot be written or read, so the caller shows the account', () => {
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  expect(statsBaseline(7, 8)).toBeNull();
  set.mockRestore();
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(statsBaseline(7, 8)).toBeNull();
  get.mockRestore();
});
