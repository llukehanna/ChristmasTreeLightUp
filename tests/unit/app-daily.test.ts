// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { savesNow, startToast, welcomeBack } from '../../src/app';

const daily = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: { day: '2026-11-06', past: false, repeat: false } };

it('a Daily saves on every path (a pause, a hidden tab, a page hide) before its first move; a random tree waits for one', () => {
  expect(savesNow(false, daily)).toBe(true);
  expect(savesNow(false, { ...daily, daily: null })).toBe(false);
  expect(savesNow(false, null)).toBe(false);
  expect(savesNow(true, null)).toBe(true);
  expect(savesNow(true, { ...daily, daily: null })).toBe(true);
});

it('Welcome back shows the time played, but only for a tree with a tap in its log', () => {
  expect(welcomeBack({ elapsedMs: 81_400, log: [{ t: 10, a: 5 }] })).toBe('Welcome back · 1:21');
  expect(welcomeBack({ elapsedMs: 81_400, log: [{ t: 10, a: ~5 }, { t: 900, a: 'p' }] })).toBe('Welcome back · 1:21');
  expect(welcomeBack({ elapsedMs: 0, log: [] })).toBeNull();
  // Pauses alone (a Daily begun hidden, or paused before its first move, then reloaded): nothing was played.
  expect(welcomeBack({ elapsedMs: 0, log: [{ t: 2, a: 'p' }] })).toBeNull();
  expect(welcomeBack({ elapsedMs: 1200, log: [{ t: 1300, a: 'p' }, { t: 9000, a: 'r' }, { t: 9100, a: 'p' }] })).toBeNull();
});

it("a Daily asked for but not reached says so, and that the tree is a random one; a random tree, or a reached Daily, says nothing", () => {
  expect(startToast('daily', null)).toBe("Couldn't reach the Daily Tree · playing a random one");
  expect(startToast('daily', { ...daily, daily: null })).toBe("Couldn't reach the Daily Tree · playing a random one");
  expect(startToast('daily', daily)).toBeNull();
  expect(startToast('random', null)).toBeNull();
  expect(startToast('random', { ...daily, daily: null })).toBeNull();
});

it("a repeat says up front that it won't rank; a first go says nothing", () => {
  expect(startToast('daily', { ...daily, daily: { ...daily.daily, repeat: true } })).toBe("Not your first go today · this one won't rank");
  expect(startToast('daily', daily)).toBeNull();
});
