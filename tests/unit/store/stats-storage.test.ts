// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { AccountStats } from '../../../src/api/types';
import { EMPTY_STATS, aliveStreak, loadStats, saveStats, shownAccountStats, statsBaseline, type Stats } from '../../../src/store/stats';

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

const device: Stats = { v: 1, solved: 87, totalSeconds: 8700, bestSeconds: 40, bestScore: 40000, streak: 5, longestStreak: 9, lastSolvedDay: '2026-10-07' };
const account: AccountStats = { userId: 7, solved: 3, totalMs: 300_000, averageMs: 100_000, bestMs: 50_000, streak: 2, longestStreak: 2, lastSolvedDay: '2026-10-08', imported: 0 };
const stored = (): unknown => JSON.parse(localStorage.getItem('aglow.statsBaseline') as string);

it('statsBaseline: the device solved count and seconds at the first signed-in view, kept after that', () => {
  expect(statsBaseline(7, device)).toMatchObject({ solved: 87, totalSeconds: 8700 });
  expect(stored()).toMatchObject({ '7': { solved: 87, totalSeconds: 8700 } });
  // The device keeps recording; the baseline stays.
  expect(statsBaseline(7, { ...device, solved: 120, totalSeconds: 12000 })).toMatchObject({ solved: 87, totalSeconds: 8700 });
});

it('statsBaseline: another account gets its own entry and never overwrites the first (A, B, A)', () => {
  statsBaseline(7, device, 1);
  statsBaseline(9, { ...device, solved: 100, totalSeconds: 9000 }, 2);
  expect(statsBaseline(7, { ...device, solved: 150, totalSeconds: 15000 }, 3)).toMatchObject({ solved: 87 });
  expect(stored()).toMatchObject({ '7': { solved: 87 }, '9': { solved: 100 } });
});

it('statsBaseline: keeps at most 10 accounts, dropping the oldest', () => {
  for (let id = 1; id <= 11; id++) statsBaseline(id, { ...device, solved: id }, id);
  const kept = Object.keys(stored() as object).map(Number).sort((a, b) => a - b);
  expect(kept).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

it('statsBaseline: a corrupt or old-format value is started over', () => {
  localStorage.setItem('aglow.statsBaseline', '{"userId":7,"solved":8}');
  expect(statsBaseline(7, device)).toMatchObject({ solved: 87 });
  localStorage.setItem('aglow.statsBaseline', 'not json');
  expect(statsBaseline(8, device)).toMatchObject({ solved: 87 });
  expect(Object.keys(stored() as object)).toEqual(['8']);
});

it('statsBaseline: null when storage cannot be written or read, so the account shows alone', () => {
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  expect(statsBaseline(7, device)).toBeNull();
  expect(shownAccountStats(account, device, '2026-10-08')).toEqual(account);
  set.mockRestore();
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(statsBaseline(7, device)).toBeNull();
  expect(shownAccountStats(account, device, '2026-10-08')).toEqual(account);
  get.mockRestore();
});

it("shownAccountStats: the account's numbers plus the device's baseline, so nothing drops on signing in", () => {
  const shown = shownAccountStats(account, device, '2026-10-08');
  expect(shown.solved).toBe(90); // 3 + 87
  expect(shown.totalMs).toBe(300_000 + 8_700_000);
  expect(shown.averageMs).toBe(100_000); // (300 + 8700) s over 90 games
  expect(shown.streak).toBe(5); // the device's, alive (last solved yesterday)
  expect(shown.longestStreak).toBe(9);
  expect(shown).toMatchObject({ userId: 7, bestMs: 50_000, imported: 0 });
  // Later: the account grows, the baseline is fixed.
  const later = shownAccountStats({ ...account, solved: 13, totalMs: 1_300_000, streak: 12, longestStreak: 12 }, { ...device, solved: 97 }, '2026-10-20');
  expect(later.solved).toBe(100); // 13 + 87
  expect(later.streak).toBe(12);
  expect(later.longestStreak).toBe(12);
});

it("shownAccountStats: the device's streak counts only while alive (last solved today or yesterday)", () => {
  expect(shownAccountStats(account, { ...device, lastSolvedDay: '2026-10-08' }, '2026-10-08').streak).toBe(5);
  expect(shownAccountStats(account, { ...device, lastSolvedDay: '2026-10-07' }, '2026-10-08').streak).toBe(5);
  localStorage.clear();
  expect(shownAccountStats(account, { ...device, lastSolvedDay: '2026-10-05' }, '2026-10-08').streak).toBe(2); // the account's
  expect(aliveStreak({ ...device, lastSolvedDay: null }, '2026-10-08')).toBe(0);
});

it('shownAccountStats: no baseline for an account that has imported, and nothing stored', () => {
  const imported = { ...account, solved: 300, imported: 297 };
  expect(shownAccountStats(imported, device, '2026-10-08')).toEqual(imported);
  expect(localStorage.getItem('aglow.statsBaseline')).toBeNull();
});

it('shownAccountStats: a device with nothing recorded changes nothing; zero games gives no average', () => {
  expect(shownAccountStats(account, EMPTY_STATS, '2026-10-08')).toEqual(account);
  localStorage.clear();
  expect(shownAccountStats({ ...account, solved: 0, totalMs: 0, averageMs: null, streak: 0, longestStreak: 0 }, EMPTY_STATS, '2026-10-08').averageMs).toBeNull();
});
