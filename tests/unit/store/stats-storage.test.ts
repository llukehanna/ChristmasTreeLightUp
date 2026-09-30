// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { EMPTY_STATS, loadStats, saveStats } from '../../../src/store/stats';

beforeEach(() => localStorage.clear());

it('rejects corrupt or invalid stats and returns defaults', () => {
  const corruptCases = [
    { totalSeconds: 1e999 },
    { totalSeconds: -5 },
    { bestSeconds: -1 },
    { bestSeconds: Infinity },
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
