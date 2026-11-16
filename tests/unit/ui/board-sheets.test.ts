// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardResponse, BoardWindow } from '../../../src/api/types';
import { listView, loadBoardWindow, saveBoardWindow, type Loadable } from '../../../src/ui/board-sheets';

const now = new Date(2026, 11, 3, 22, 0).getTime();
const day = new Date(2026, 11, 1, 20, 0).getTime();
const me = { name: 'Meridian', isAdmin: false, starHead: false };
const board: BoardResponse = {
  rows: [
    { id: 'run-comet', rank: 1, name: 'Comet', ms: 48_200, finishedAt: day, mine: false, replay: true },
    { id: 'run-meridian', rank: 2, name: 'Meridian', ms: 51_700, finishedAt: day, mine: true, replay: true },
  ],
  total: 340,
  you: null,
};
function render(...args: Parameters<typeof listView>): HTMLElement {
  const inner = document.createElement('div');
  listView(...args).render(inner);
  return inner;
}
const texts = (el: HTMLElement, sel: string) => [...el.querySelectorAll(sel)].map((n) => n.textContent);

it('the leaderboard: rank, name, time and date; your rows marked; the total', () => {
  const el = render({ status: 'ready', data: board }, me, now);
  expect(listView({ status: 'loading' }, me, now).label).toBe('Leaderboard');
  expect(texts(el, '.acct-row .acct-rank')).toEqual(['1', '2']);
  expect(texts(el, '.acct-row .acct-nm')).toEqual(['Comet', 'Meridian']);
  expect(texts(el, '.acct-row .acct-time')).toEqual(['0:48.2', '0:51.7']);
  expect(texts(el, '.acct-row .acct-date')).toEqual(['Dec 1', 'Dec 1']);
  expect(el.querySelectorAll('.acct-me')).toHaveLength(1);
  expect(el.querySelector('.acct-me .acct-you')?.textContent).toBe('You');
  expect(el.querySelector('.acct-sub')?.textContent).toBe('All-time · 340 ranked runs');
  // Your best is in the list: the footer says where, rather than repeating the header's total.
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('Your best · #2 of 340 runs');
  // The career page's switch: Leaderboard is this view; Career opens the page.
  expect([...el.querySelectorAll('.acct-tabs button')].map((b) => [b.textContent, b.getAttribute('aria-current'), b.getAttribute('data-act')])).toEqual([
    ['Leaderboard', 'page', null],
    ['Career', null, 'career'],
  ]);
  expect(el.querySelector('[role="tab"], [role="tablist"], [role="tabpanel"]')).toBeNull();
});

it('without a run of yours anywhere, the footer gives the total', () => {
  const rows = board.rows.map((r) => ({ ...r, mine: false }));
  const el = render({ status: 'ready', data: { ...board, rows } }, me, now);
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('340 ranked runs');
});

it('server numbers only ever paint as numbers', () => {
  const odd = { rows: [{ ...board.rows[0], rank: '1<b>' as unknown as number }], total: '340<i>' as unknown as number, you: null };
  const el = render({ status: 'ready', data: odd }, me, now);
  expect(el.innerHTML).not.toMatch(/<b>|<i>/);
  expect(el.querySelector('.acct-sub')?.textContent).toBe('All-time · NaN ranked runs');
});

it('pins your best below the list when it is outside the top 50', () => {
  const you = { id: 'run-you', rank: 87, name: 'Meridian', ms: 152_000, finishedAt: day, mine: true, replay: true };
  const el = render({ status: 'ready', data: { ...board, rows: [board.rows[0]], you } }, me, now);
  expect(el.querySelector('.acct-pin .acct-me .acct-rank')?.textContent).toBe('87');
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('Your best · #87 of 340 runs');
});

it('signed out or without a name: a call to action instead of your row', () => {
  const out = render({ status: 'ready', data: board }, null, now);
  expect(out.querySelector('.acct-pin-cta')?.textContent).toContain('Sign in to see your name on the list');
  expect(out.querySelector('.acct-pin [data-act="signin"]')).not.toBeNull();
  const nameless = render({ status: 'ready', data: board }, { name: null, isAdmin: false, starHead: false }, now);
  expect(nameless.querySelector('.acct-pin [data-act="name"]')).not.toBeNull();
});

it('loading, empty and error states', () => {
  expect(render({ status: 'loading' }, me, now).querySelector('.acct-note')?.textContent).toBe('Loading…');
  expect(render({ status: 'ready', data: { rows: [], total: 0, you: null } }, me, now).querySelector('.acct-note')?.textContent).toBe(
    'No ranked runs yet. Light a tree and be the first.',
  );
  const failed = render({ status: 'error' }, me, now);
  expect(failed.querySelector('.acct-note')?.textContent).toBe("Couldn't load the leaderboard.");
  expect(failed.querySelector('[data-act="reload"]')).not.toBeNull();
});

describe('board windows: Today, This week, All time (spec 2026-10-14 §4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  const pressed = (el: HTMLElement) => texts(el, '.acct-wins [aria-pressed="true"]');

  it('a segmented control under the title, the shown window pressed', () => {
    const el = render({ status: 'ready', data: board }, me, now, 'week');
    const group = el.querySelector('.acct-head .acct-wins');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe('Time window');
    expect(texts(el, '.acct-wins button')).toEqual(['Daily', 'Today', 'This week', 'All time']);
    expect([...el.querySelectorAll('.acct-wins button')].map((b) => [b.getAttribute('type'), b.getAttribute('data-act'), b.getAttribute('aria-pressed')])).toEqual([
      ['button', 'win-daily', 'false'],
      ['button', 'win-today', 'false'],
      ['button', 'win-week', 'true'],
      ['button', 'win-all', 'false'],
    ]);
  });

  it('the subtitle follows the window', () => {
    const sub = (win: BoardWindow, b: Loadable<BoardResponse> = { status: 'ready', data: board }) =>
      render(b, me, now, win).querySelector('.acct-sub')?.textContent;
    expect(sub('today')).toBe('Today · 340 ranked runs');
    expect(sub('week')).toBe('This week · 340 ranked runs');
    expect(sub('all')).toBe('All-time · 340 ranked runs');
    expect(sub('today', { status: 'loading' })).toBe('Today · fastest trees');
    expect(pressed(render({ status: 'loading' }, me, now, 'today'))).toEqual(['Today']);
  });

  it('an empty window says so in its own words', () => {
    const empty = (win: BoardWindow) =>
      render({ status: 'ready', data: { rows: [], total: 0, you: null } }, me, now, win).querySelector('.acct-body .acct-note')?.textContent;
    expect(empty('today')).toBe('No runs yet today — be the first.');
    expect(empty('week')).toBe('No runs yet this week.');
    expect(empty('all')).toBe('No ranked runs yet. Light a tree and be the first.');
  });

  it('the Daily window comes first and has its own empty text', () => {
    const el = render({ status: 'ready', data: { rows: [], total: 0, you: null } }, me, now, 'daily');
    expect(texts(el, '.acct-wins button')[0]).toBe('Daily');
    expect(el.querySelector('.acct-wins button')?.getAttribute('data-act')).toBe('win-daily');
    expect(pressed(el)).toEqual(['Daily']);
    expect(el.querySelector('.acct-body .acct-note')?.textContent).toBe('No one has lit this Daily Tree yet.');
    // The sub names the day the board is for (this browser's today unless told), as the pill does: never "Today's".
    expect(el.querySelector('.acct-sub')?.textContent).toBe('Daily Tree · Dec 3 · 0 runs');
    expect(render({ status: 'loading' }, me, now, 'daily').querySelector('.acct-sub')?.textContent).toBe('Daily Tree · Dec 3 · fastest trees');
    // The rosette of a Daily begun before midnight opens that run's day.
    const yesterday = render({ status: 'ready', data: { rows: [], total: 0, you: null } }, me, now, 'daily', '2026-12-02');
    expect(yesterday.querySelector('.acct-sub')?.textContent).toBe('Daily Tree · Dec 2 · 0 runs');
    expect(yesterday.querySelector('.acct-body .acct-note')?.textContent).toBe('No one has lit this Daily Tree yet.');
    // The remembered window is still Today until one is chosen.
    expect(loadBoardWindow()).toBe('today');
    saveBoardWindow('daily');
    expect(loadBoardWindow()).toBe('daily');
  });

  it("the Daily window's words: runs, not ranked runs, and your run, not your best", () => {
    const daily = (data: BoardResponse) => render({ status: 'ready', data }, me, now, 'daily');
    const listed = daily({ ...board, total: 9 });
    expect(listed.querySelector('.acct-sub')?.textContent).toBe('Daily Tree · Dec 3 · 9 runs');
    expect(listed.querySelector('.acct-pin-note')?.textContent).toBe('Your run · #2 of 9');
    const you = { id: 'run-you', rank: 87, name: 'Meridian', ms: 152_000, finishedAt: day, mine: true, replay: true };
    expect(daily({ rows: [board.rows[0]], total: 90, you }).querySelector('.acct-pin-note')?.textContent).toBe('Your run · #87 of 90');
    expect(daily({ rows: [{ ...board.rows[0] }], total: 1, you: null }).querySelector('.acct-pin-note')?.textContent).toBe('1 run');
    // The other windows keep their words.
    expect(render({ status: 'ready', data: board }, me, now, 'today').querySelector('.acct-pin-note')?.textContent).toBe('Your best · #2 of 340 runs');
  });

  it('no run of yours in the window: no pinned row; unnamed, the pick-a-name call to action as before', () => {
    const el = render({ status: 'ready', data: { rows: [{ ...board.rows[0] }], total: 1, you: null } }, me, now, 'today');
    expect(el.querySelector('.acct-pin .acct-me')).toBeNull();
    expect(el.querySelector('.acct-pin-note')?.textContent).toBe('1 ranked run');
    const nameless = render({ status: 'ready', data: board }, { name: null, isAdmin: false, starHead: false }, now, 'today');
    expect(nameless.querySelector('.acct-pin [data-act="name"]')).not.toBeNull();
  });

  it('the chosen window is remembered in this browser; Today until one is chosen, or when storage fails', () => {
    expect(loadBoardWindow()).toBe('today');
    saveBoardWindow('week');
    expect(localStorage.getItem('aglow.boardWindow')).toBe('week');
    expect(loadBoardWindow()).toBe('week');
    saveBoardWindow('all');
    expect(loadBoardWindow()).toBe('all');
    localStorage.setItem('aglow.boardWindow', 'month');
    expect(loadBoardWindow()).toBe('today');
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    expect(loadBoardWindow()).toBe('today');
    expect(() => saveBoardWindow('week')).not.toThrow();
  });
});

describe('Watch replay buttons (C4 decision 9)', () => {

  it('a board row with replay: true has the Watch button with its id; one with replay: false has none', () => {
    const rows = [board.rows[0], { ...board.rows[1], replay: false }];
    const el = render({ status: 'ready', data: { ...board, rows } }, me, now);
    const [first, second] = [...el.querySelectorAll('.acct-row')];
    const b = first.querySelector<HTMLButtonElement>('button.acct-watch');
    expect(b?.dataset.act).toBe('watch');
    expect(b?.dataset.id).toBe('run-comet');
    expect(b?.getAttribute('aria-label')).toBe('Watch replay');
    expect(b?.getAttribute('title')).toBe('Watch replay');
    expect(b?.getAttribute('type')).toBe('button');
    expect(b?.querySelector('svg')).not.toBeNull();
    expect(second.querySelector('.acct-watch')).toBeNull();
  });

  it('the pinned row of yours outside the top has one too', () => {
    const you = { id: 'run-you', rank: 87, name: 'Meridian', ms: 152_000, finishedAt: day, mine: true, replay: true };
    const el = render({ status: 'ready', data: { ...board, rows: [], you } }, me, now);
    expect(el.querySelector<HTMLElement>('.acct-pin .acct-watch')?.dataset.id).toBe('run-you');
  });


});
