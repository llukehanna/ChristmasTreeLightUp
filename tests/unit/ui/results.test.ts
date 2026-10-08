// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountStats } from '../../../src/api/types';
import { EMPTY_STATS, type Stats } from '../../../src/store/stats';
import { accountStatsView, deviceStatsView, Results } from '../../../src/ui/results';

const device: Stats = { v: 1, solved: 8, totalSeconds: 800, bestSeconds: 60, bestScore: 44000, streak: 11, longestStreak: 11, lastSolvedDay: '2026-10-08' };
const account: AccountStats = { solved: 312, totalMs: 312 * 78_456, averageMs: 78_456, bestMs: 41_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-10-08', imported: 300 };
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
