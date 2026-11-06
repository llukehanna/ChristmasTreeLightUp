// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { savesNow, welcomeBack } from '../../src/app';

const daily = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: { day: '2026-11-06', past: false, repeat: false } };

it('a Daily saves on every path (a pause, a hidden tab, a page hide) before its first move; a random tree waits for one', () => {
  expect(savesNow(false, daily)).toBe(true);
  expect(savesNow(false, { ...daily, daily: null })).toBe(false);
  expect(savesNow(false, null)).toBe(false);
  expect(savesNow(true, null)).toBe(true);
  expect(savesNow(true, { ...daily, daily: null })).toBe(true);
});

it('Welcome back shows the time played, but not for a tree reloaded before anything was logged', () => {
  expect(welcomeBack({ elapsedMs: 81_400, log: [{ t: 10, a: 5 }] })).toBe('Welcome back · 1:21');
  expect(welcomeBack({ elapsedMs: 0, log: [] })).toBeNull();
  // A pause before the first move is in the log: the tree was played (paused), so it is welcomed back.
  expect(welcomeBack({ elapsedMs: 1200, log: [{ t: 1300, a: 'p' }] })).toBe('Welcome back · 0:01');
});
