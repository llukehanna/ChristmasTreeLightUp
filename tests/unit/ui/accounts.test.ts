// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Session } from '../../../src/api/session';
import type { AccountStats, BoardResponse, BoardWindow, MyGamesResponse } from '../../../src/api/types';

const calls = vi.hoisted(() => ({
  myStats: vi.fn<() => Promise<AccountStats>>(),
  myGames: vi.fn<() => Promise<MyGamesResponse>>(),
  board: vi.fn<(w: BoardWindow) => Promise<BoardResponse>>(),
}));
vi.mock('../../../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../../../src/api/client')>()),
  api: { myStats: calls.myStats, myGames: calls.myGames, board: calls.board },
}));

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
  calls.board.mockReset().mockResolvedValue({ rows: [], total: 0, you: null });
  localStorage.clear();
  session = new Session();
  session.set(me);
  accounts = new Accounts(session, { pause: vi.fn(), closeOthers: vi.fn(), fitHud: vi.fn(), toast: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
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

const row = (name: string, ms: number) => ({ rank: 1, name, ms, finishedAt: 1, mine: false });
const pressedWindow = (): string | null | undefined => document.querySelector('.acct-wins [aria-pressed="true"]')?.textContent;
const names = (): string[] => [...document.querySelectorAll('.acct-body .acct-nm')].map((n) => n.textContent ?? '');
const clickAct = (act: string): void => document.querySelector<HTMLElement>(`[data-act="${act}"]`)?.click();

it('the leaderboard opens on Today; a window button fetches that window, shows its own answer and is remembered', async () => {
  const today = deferred<BoardResponse>();
  const week = deferred<BoardResponse>();
  calls.board.mockReturnValueOnce(today.promise).mockReturnValueOnce(week.promise);
  accounts.openBoard();
  expect(calls.board).toHaveBeenLastCalledWith('today');
  expect(pressedWindow()).toBe('Today');
  clickAct('win-week');
  expect(calls.board).toHaveBeenLastCalledWith('week');
  expect(pressedWindow()).toBe('This week');
  expect(localStorage.getItem('aglow.boardWindow')).toBe('week');
  // The focus stays on the button just pressed across the re-render.
  expect((document.activeElement as HTMLElement | null)?.dataset.act).toBe('win-week');
  week.resolve({ rows: [row('Comet', 9_000)], total: 1, you: null });
  await tick();
  expect(names()).toEqual(['Comet']);
  // Today's answer, late: kept for Today, never painted over this week.
  today.resolve({ rows: [row('Nova', 8_000)], total: 1, you: null });
  await tick();
  expect(names()).toEqual(['Comet']);
  calls.board.mockResolvedValueOnce({ rows: [row('Nova', 8_000)], total: 1, you: null });
  clickAct('win-today');
  expect(names()).toEqual(['Nova']); // its own copy at once, while it is fetched again
  // Another page load opens on the window chosen last.
  clickAct('win-all');
  await tick();
  const again = new Accounts(session, { pause: vi.fn(), closeOthers: vi.fn(), fitHud: vi.fn(), toast: vi.fn() });
  again.openBoard();
  expect(calls.board).toHaveBeenLastCalledWith('all');
});

it("the results tag's rank opens All time (its numbers are all-time ones) without changing the remembered window", () => {
  localStorage.setItem('aglow.boardWindow', 'week');
  const fresh = new Accounts(session, { pause: vi.fn(), closeOthers: vi.fn(), fitHud: vi.fn(), toast: vi.fn() });
  fresh.openBoard(null, 'all');
  expect(calls.board).toHaveBeenLastCalledWith('all');
  expect(pressedWindow()).toBe('All time');
  expect(localStorage.getItem('aglow.boardWindow')).toBe('week');
  // The account menu's Leaderboard still opens on the window chosen last.
  fresh.openBoard();
  expect(calls.board).toHaveBeenLastCalledWith('week');
});

it("a new local day: Today and This week start again from Loading, never yesterday's runs; All time keeps its copy", async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 14, 23, 50));
  const note = (): string | null | undefined => document.querySelector('.acct-body .acct-note')?.textContent;
  calls.board.mockResolvedValueOnce({ rows: [row('Comet', 9_000)], total: 1, you: null }).mockResolvedValueOnce({ rows: [row('Nova', 8_000)], total: 1, you: null });
  accounts.openBoard();
  await tick();
  clickAct('win-all');
  await tick();
  expect(names()).toEqual(['Nova']);
  // The same day: Today's copy shows at once while it is fetched again (an answer that comes back after midnight).
  const late = deferred<BoardResponse>();
  calls.board.mockReturnValueOnce(late.promise);
  clickAct('win-today');
  expect(names()).toEqual(['Comet']);
  vi.setSystemTime(new Date(2026, 9, 15, 0, 5));
  const fresh = deferred<BoardResponse>();
  calls.board.mockReturnValueOnce(fresh.promise);
  accounts.openBoard();
  expect(note()).toBe('Loading…');
  late.resolve({ rows: [row('Comet', 9_000)], total: 1, you: null }); // asked for yesterday: dropped
  await tick();
  expect(note()).toBe('Loading…');
  fresh.resolve({ rows: [], total: 0, you: null });
  await tick();
  expect(note()).toBe('No runs yet today — be the first.');
  calls.board.mockReturnValueOnce(new Promise(() => undefined));
  clickAct('win-all');
  expect(names()).toEqual(['Nova']);
});

it('the Daily window fetches the day\'s Daily board, comes first, and is remembered', async () => {
  calls.board.mockResolvedValue({ rows: [row('Comet', 9_000)], total: 1, you: null });
  accounts.openBoard();
  expect(document.querySelector('.acct-wins button')?.textContent).toBe('Daily');
  clickAct('win-daily');
  expect(calls.board).toHaveBeenLastCalledWith('daily');
  expect(pressedWindow()).toBe('Daily');
  expect(localStorage.getItem('aglow.boardWindow')).toBe('daily');
  expect((document.activeElement as HTMLElement | null)?.dataset.act).toBe('win-daily');
  await tick();
  expect(names()).toEqual(['Comet']);
  expect(document.querySelector('.acct-sub')?.textContent).toBe("Today's Daily Tree · 1 ranked run");
  // The results tag's Daily rosette opens the Daily window, without changing the remembered one.
  localStorage.setItem('aglow.boardWindow', 'week');
  const fresh = new Accounts(session, { pause: vi.fn(), closeOthers: vi.fn(), fitHud: vi.fn(), toast: vi.fn() });
  fresh.openBoard(null, 'daily');
  expect(calls.board).toHaveBeenLastCalledWith('daily');
  expect(localStorage.getItem('aglow.boardWindow')).toBe('week');
});

it("a new local day: the Daily window starts again from Loading, never yesterday's Daily", async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 6, 23, 50));
  const note = (): string | null | undefined => document.querySelector('.acct-body .acct-note')?.textContent;
  localStorage.setItem('aglow.boardWindow', 'daily');
  const daily = new Accounts(session, { pause: vi.fn(), closeOthers: vi.fn(), fitHud: vi.fn(), toast: vi.fn() });
  calls.board.mockResolvedValueOnce({ rows: [row('Comet', 9_000)], total: 1, you: null });
  daily.openBoard();
  expect(calls.board).toHaveBeenLastCalledWith('daily');
  await tick();
  expect(names()).toEqual(['Comet']);
  // An answer asked for before midnight that comes back after it is dropped.
  const late = deferred<BoardResponse>();
  calls.board.mockReturnValueOnce(late.promise);
  clickAct('win-daily');
  expect(names()).toEqual(['Comet']);
  vi.setSystemTime(new Date(2026, 10, 7, 0, 5));
  const fresh = deferred<BoardResponse>();
  calls.board.mockReturnValueOnce(fresh.promise);
  daily.openBoard();
  expect(note()).toBe('Loading…');
  late.resolve({ rows: [row('Comet', 9_000)], total: 1, you: null });
  await tick();
  expect(note()).toBe('Loading…');
  fresh.resolve({ rows: [], total: 0, you: null });
  await tick();
  expect(note()).toBe("No one has lit today's Daily Tree yet.");
});
