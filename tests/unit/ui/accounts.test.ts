// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Session } from '../../../src/api/session';
import type { AccountStats, MyGamesResponse } from '../../../src/api/types';

const calls = vi.hoisted(() => ({
  myStats: vi.fn<() => Promise<AccountStats>>(),
  myGames: vi.fn<() => Promise<MyGamesResponse>>(),
}));
vi.mock('../../../src/api/client', async (orig) => ({ ...(await orig<typeof import('../../../src/api/client')>()), api: { myStats: calls.myStats, myGames: calls.myGames } }));

import { Accounts } from '../../../src/ui/accounts';

const stats = (solved: number): AccountStats => ({ userId: 1, solved, totalMs: solved * 60_000, averageMs: 60_000, bestMs: 50_000, streak: 1, longestStreak: 1, lastSolvedDay: '2026-10-08', imported: 0 });
const games: MyGamesResponse = { best: null, inTop: 0, total: 0, games: [] };
const me = { name: 'Meridian', isAdmin: false, starHead: false };

/** A promise the test settles by hand, to put answers in any order. */
function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const totals = (): string[] => [...document.querySelectorAll('.acct-totals b')].map((n) => n.textContent ?? '');
const busy = (): boolean => document.querySelector('.acct-totals')?.getAttribute('aria-busy') === 'true';

let session: Session;
let accounts: Accounts;
beforeEach(() => {
  document.body.innerHTML = '<button id="menu-btn"></button>';
  calls.myStats.mockReset();
  calls.myGames.mockReset().mockResolvedValue(games);
  session = new Session();
  session.set(me);
  accounts = new Accounts(session, { pause: vi.fn(), closeOthers: vi.fn(), fitHud: vi.fn(), toast: vi.fn() });
});
afterEach(() => {
  document.body.innerHTML = '';
});

it("Your games' totals keep only the newest stats answer: an older one arriving late is dropped", async () => {
  const first = deferred<AccountStats>();
  const second = deferred<AccountStats>();
  calls.myStats.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  accounts.openGames(); // load 1
  accounts.openGames(); // a reload or tab switch: load 2
  expect(calls.myStats).toHaveBeenCalledTimes(2);
  second.resolve(stats(5));
  await tick();
  expect(totals()[0]).toBe('5');
  first.resolve(stats(2)); // slower, and older
  await tick();
  expect(totals()[0]).toBe('5');
});

it('an older failure cannot replace newer totals either', async () => {
  const first = deferred<AccountStats>();
  const second = deferred<AccountStats>();
  calls.myStats.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  accounts.openGames();
  accounts.openGames();
  second.resolve(stats(5));
  await tick();
  first.reject(new Error('offline'));
  await tick();
  expect(totals()[0]).toBe('5');
  expect(document.querySelector('.acct-totals-err')).toBeNull();
});

it("an answer in flight when the session changes is dropped, never shown as the next user's totals", async () => {
  const inFlight = deferred<AccountStats>();
  calls.myStats.mockReturnValueOnce(inFlight.promise);
  accounts.openGames();
  await tick();
  expect(busy()).toBe(true);
  session.set({ name: 'Comet', isAdmin: false, starHead: false }); // onSession resets the totals and bumps the guard
  inFlight.resolve(stats(99));
  await tick();
  // Your games is back to loading after the change (nothing refetches it), and the dropped answer is nowhere on screen.
  expect(document.querySelector('.acct-sheet')?.textContent).not.toContain('99');
  expect(totals()).toEqual([]);
  // The next open starts clean: dashes until its own answer arrives.
  const next = deferred<AccountStats>();
  calls.myStats.mockReturnValueOnce(next.promise);
  accounts.openGames();
  await tick();
  expect(totals()).toEqual(['–', '–', '–', '–']);
  expect(busy()).toBe(true);
  next.resolve(stats(3));
  await tick();
  expect(totals()[0]).toBe('3');
});
