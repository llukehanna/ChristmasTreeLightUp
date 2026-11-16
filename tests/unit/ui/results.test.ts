// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountStats } from '../../../src/api/types';
import { EMPTY_STATS, type Stats } from '../../../src/store/stats';
import { accountStatsView, deviceStatsView, ghostLine, HOME_ALONE_LINE, Results } from '../../../src/ui/results';

const device: Stats = { v: 1, solved: 8, totalSeconds: 800, bestSeconds: 60, bestScore: 44000, streak: 11, longestStreak: 11, lastSolvedDay: '2026-10-08' };
const account: AccountStats = { userId: 1, solved: 312, totalMs: 312 * 78_456, averageMs: 78_456, bestMs: 41_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-10-08', imported: 300 };
const text = (id: string): string | null | undefined => document.getElementById(id)?.textContent;
const noop = (): void => undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  document.body.innerHTML = `<section id="results" hidden><h2 id="r-time"></h2><div id="r-turns" hidden></div><div id="r-merry">Merry &amp; bright</div><div id="r-badge"></div>
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
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device) });
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['8', '1:40', '11']);
  expect(text('r-badge')).toBe('Best 1:00');
  expect(document.getElementById('r-score')).toBeNull();
  expect(document.getElementById('results')?.textContent).not.toMatch(/Score/);
  r.setStats(accountStatsView(account));
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['312', '1:18', '4']);
  expect(text('r-badge')).toBe('Best 1:00');
});

it('counts of 1,000 and up carry a comma; the device view is the fallback when the account view is dropped', () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  r.setStats(accountStatsView({ ...account, solved: 1234, streak: 1000 }));
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['1,234', '1:18', '1,000']);
  // Offline or signed out: the app repaints the device's numbers.
  r.setStats(deviceStatsView(device));
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['8', '1:40', '11']);
});

it("Home Alone: the line takes Merry & bright's place under the time, and gives it back", () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device), line: HOME_ALONE_LINE });
  expect(text('r-merry')).toBe('Keep the change, ya filthy animal.');
  r.setLine(null);
  expect(text('r-merry')).toBe('Merry & bright');
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device) });
  expect(text('r-merry')).toBe('Merry & bright');
});

it("a Daily Tree: its label is a small line above the time; a random tree's tag has none", () => {
  document.getElementById('r-time')?.insertAdjacentHTML('beforebegin', '<div id="r-daily" hidden></div>');
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device), daily: '2026-11-06' });
  const line = document.getElementById('r-daily');
  expect(line?.textContent).toBe('Daily Tree · Nov 6');
  expect(line?.hidden).toBe(false);
  expect(line?.nextElementSibling?.id).toBe('r-time');
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device), daily: null });
  expect(line?.hidden).toBe(true);
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device) });
  expect(line?.hidden).toBe(true);
  // An empty day is no day.
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device), daily: '' });
  expect(line?.hidden).toBe(true);
});

it("the ghost's line: how far ahead or behind your clock at the win was, to a tenth; level within 50 ms", () => {
  expect(ghostLine(-2049)).toBe('2.0 s faster than your ghost');
  expect(ghostLine(1260)).toBe('1.3 s behind your ghost');
  expect(ghostLine(30)).toBe('Level with your ghost');
  expect(ghostLine(-49)).toBe('Level with your ghost');
  expect(ghostLine(0)).toBe('Level with your ghost');
  expect(ghostLine(50)).toBe('0.1 s behind your ghost');
});

it("setGhost puts the ghost's line under the time, and null takes it away", () => {
  document.getElementById('r-time')?.insertAdjacentHTML('afterend', '<div id="r-ghost" hidden></div>');
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  const line = document.getElementById('r-ghost');
  r.setGhost('2.0 s faster than your ghost');
  expect(line?.textContent).toBe('2.0 s faster than your ghost');
  expect(line?.hidden).toBe(false);
  r.setGhost(null);
  expect(line?.hidden).toBe(true);
  expect(line?.textContent).toBe('');
  // Older fixtures have no #r-ghost.
  line?.remove();
  expect(() => r.setGhost('Level with your ghost')).not.toThrow();
});

it('the tag wears its style as data-tag; the plain tag too', () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  const root = document.getElementById('results')!;
  r.setTag('velvet');
  expect(root.dataset.tag).toBe('velvet');
  r.setTag('plain');
  expect(root.dataset.tag).toBe('plain');
});

const turnsLine = (): HTMLElement => document.getElementById('r-turns') as HTMLElement;

it('shows turns and extra turns under the time', () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device), turns: { turns: 123, extra: 40 } });
  expect(turnsLine().hidden).toBe(false);
  expect(turnsLine().textContent).toBe('123 turns \u00b7 40 extra');
  r.setTurns({ turns: 1, extra: 0 }); // a tag already up takes the answer when it lands
  expect(turnsLine().textContent).toBe('1 turns \u00b7 0 extra');
});

it('hides the turns line without turns', () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device), turns: { turns: 5, extra: 1 } });
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device), turns: null });
  expect(turnsLine().hidden).toBe(true);
  r.setTurns({ turns: 5, extra: 1 });
  r.show({ seconds: 42, newBest: false, stats: device, view: deviceStatsView(device) });
  expect(turnsLine().hidden).toBe(true);
  expect(turnsLine().textContent).toBe('');
});

it('the share image never carries turns', () => {
  const share = readFileSync('src/ui/share.ts', 'utf8');
  expect(share).not.toMatch(/turns/i);
  expect(readFileSync('src/app.ts', 'utf8')).toMatch(/makeShareImage\(this\.renderer\.canvas, this\.renderer\.treeRect\(\), this\.lastSeconds, shareInk\(this\.renderer\.scene\), line\)/);
});
