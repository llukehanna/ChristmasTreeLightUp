// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountStats } from '../../../src/api/types';
import { EMPTY_STATS, type Stats } from '../../../src/store/stats';
import { accountStatsView, deviceStatsView, Results, statsViewFor } from '../../../src/ui/results';

const device: Stats = { v: 1, solved: 8, totalSeconds: 800, bestSeconds: 60, bestScore: 44000, streak: 11, longestStreak: 11, lastSolvedDay: '2026-10-08' };
const account: AccountStats = { userId: 1, solved: 312, totalMs: 312 * 78_456, averageMs: 78_456, bestMs: 41_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-10-08', imported: 300 };
const text = (id: string): string | null | undefined => document.getElementById(id)?.textContent;
const noop = (): void => undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  document.body.innerHTML = `<section id="results" hidden><h2 id="r-time"></h2><div id="r-score"></div><div id="r-badge"></div>
    <b id="r-solved"></b><b id="r-avg"></b><b id="r-streak"></b><button id="r-new"></button><button id="r-share"></button><button id="r-keep"></button></section>`;
});
afterEach(() => vi.unstubAllGlobals());

it("the views: this device's numbers, or the account's", () => {
  expect(deviceStatsView(device)).toEqual({ solved: 8, averageSeconds: 100, streak: 11 });
  expect(deviceStatsView(EMPTY_STATS)).toEqual({ solved: 0, averageSeconds: 0, streak: 0 });
  expect(accountStatsView(account)).toEqual({ solved: 312, averageSeconds: 78, streak: 4 });
  expect(accountStatsView({ ...account, solved: 0, totalMs: 0, averageMs: null, streak: 0 })).toEqual({ solved: 0, averageSeconds: 0, streak: 0 });
});

it("statsViewFor: the device's numbers while the account has fewer games than the device's baseline; otherwise the account's", () => {
  // A pre-accounts player signs in: the device had 8 at first sign-in, the account 1. All three numbers come from the device.
  const young: AccountStats = { ...account, solved: 1, totalMs: 40_000, averageMs: 40_000, streak: 1 };
  expect(statsViewFor(device, young, 8)).toEqual({ solved: 8, averageSeconds: 100, streak: 11 });
  expect(statsViewFor(device, { ...young, solved: 7 }, 8)).toEqual({ solved: 8, averageSeconds: 100, streak: 11 });
  // The account reaches the baseline: the account's, for good (it only grows).
  expect(statsViewFor(device, { ...young, solved: 8 }, 8)).toEqual({ solved: 8, averageSeconds: 40, streak: 1 });
  expect(statsViewFor(device, account, 8)).toEqual({ solved: 312, averageSeconds: 78, streak: 4 });
  // The device's own growth does not matter: the baseline is fixed at first sign-in.
  expect(statsViewFor({ ...device, solved: 20 }, { ...young, solved: 8 }, 8)).toEqual({ solved: 8, averageSeconds: 40, streak: 1 });
  // No history to protect (baseline 0), or storage failed (null): the account's straight away.
  expect(statsViewFor(device, young, 0)).toEqual({ solved: 1, averageSeconds: 40, streak: 1 });
  expect(statsViewFor(device, young, null)).toEqual({ solved: 1, averageSeconds: 40, streak: 1 });
  // No account numbers (signed out, loading, offline): the device's, whatever the baseline.
  expect(statsViewFor(device, null, 8)).toEqual({ solved: 8, averageSeconds: 100, streak: 11 });
  expect(statsViewFor(device, null, null)).toEqual({ solved: 8, averageSeconds: 100, streak: 11 });
  expect(statsViewFor(EMPTY_STATS, null, null)).toEqual({ solved: 0, averageSeconds: 0, streak: 0 });
});

it('the tag paints the view it is given; setStats repaints the three numbers, shown or hidden; the badge stays the device’s', () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  r.setStats(accountStatsView(account)); // before the tag appears
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['312', '1:18', '4']);
  r.show({ seconds: 42, score: 45800, newBest: false, stats: device, view: deviceStatsView(device) });
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['8', '1:40', '11']);
  expect(text('r-badge')).toBe('Best 1:00');
  r.setStats(accountStatsView(account));
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['312', '1:18', '4']);
  expect(text('r-badge')).toBe('Best 1:00');
});

it('counts of 1,000 and up carry a comma, as in Your games; the device view is the fallback when the account view is dropped', () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  r.setStats(accountStatsView({ ...account, solved: 1234, streak: 1000 }));
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['1,234', '1:18', '1,000']);
  // Offline or signed out: the app repaints the device's numbers.
  r.setStats(deviceStatsView(device));
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['8', '1:40', '11']);
});
