// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { EMPTY_STATS, loadStats, saveStats } from '../../../src/store/stats';

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
