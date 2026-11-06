// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountStats, BoardResponse, BoardWindow, MyGamesResponse, RecentGame } from '../../../src/api/types';
import { listView, loadBoardWindow, saveBoardWindow, type Loadable } from '../../../src/ui/board-sheets';

const now = new Date(2026, 11, 3, 22, 0).getTime();
const day = new Date(2026, 11, 1, 20, 0).getTime();
const me = { name: 'Meridian', isAdmin: false, starHead: false };
const board: BoardResponse = {
  rows: [
    { rank: 1, name: 'Comet', ms: 48_200, finishedAt: day, mine: false },
    { rank: 2, name: 'Meridian', ms: 51_700, finishedAt: day, mine: true },
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
  const el = render('board', { status: 'ready', data: board }, { status: 'loading' }, me, now);
  expect(listView('board', { status: 'loading' }, { status: 'loading' }, me, now).label).toBe('Leaderboard');
  expect(texts(el, '.acct-row .acct-rank')).toEqual(['1', '2']);
  expect(texts(el, '.acct-row .acct-nm')).toEqual(['Comet', 'Meridian']);
  expect(texts(el, '.acct-row .acct-time')).toEqual(['0:48.2', '0:51.7']);
  expect(texts(el, '.acct-row .acct-date')).toEqual(['Dec 1', 'Dec 1']);
  expect(el.querySelectorAll('.acct-me')).toHaveLength(1);
  expect(el.querySelector('.acct-me .acct-you')?.textContent).toBe('You');
  expect(el.querySelector('.acct-sub')?.textContent).toBe('All-time · 340 ranked runs');
  // Your best is in the list: the footer says where, rather than repeating the header's total.
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('Your best · #2 of 340 runs');
  expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Leaderboard');
});

it('without a run of yours anywhere, the footer gives the total', () => {
  const rows = board.rows.map((r) => ({ ...r, mine: false }));
  const el = render('board', { status: 'ready', data: { ...board, rows } }, { status: 'loading' }, me, now);
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('340 ranked runs');
});

it('server numbers only ever paint as numbers', () => {
  const odd = { rows: [{ ...board.rows[0], rank: '1<b>' as unknown as number }], total: '340<i>' as unknown as number, you: null };
  const el = render('board', { status: 'ready', data: odd }, { status: 'loading' }, me, now);
  expect(el.innerHTML).not.toMatch(/<b>|<i>/);
  expect(el.querySelector('.acct-sub')?.textContent).toBe('All-time · NaN ranked runs');
});

it('pins your best below the list when it is outside the top 50', () => {
  const you = { rank: 87, name: 'Meridian', ms: 152_000, finishedAt: day, mine: true };
  const el = render('board', { status: 'ready', data: { ...board, rows: [board.rows[0]], you } }, { status: 'loading' }, me, now);
  expect(el.querySelector('.acct-pin .acct-me .acct-rank')?.textContent).toBe('87');
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('Your best · #87 of 340 runs');
});

it('signed out or without a name: a call to action instead of your row', () => {
  const out = render('board', { status: 'ready', data: board }, { status: 'loading' }, null, now);
  expect(out.querySelector('.acct-pin-cta')?.textContent).toContain('Sign in to see your name on the list');
  expect(out.querySelector('.acct-pin [data-act="signin"]')).not.toBeNull();
  const nameless = render('board', { status: 'ready', data: board }, { status: 'loading' }, { name: null, isAdmin: false, starHead: false }, now);
  expect(nameless.querySelector('.acct-pin [data-act="name"]')).not.toBeNull();
});

it('loading, empty and error states', () => {
  expect(render('board', { status: 'loading' }, { status: 'loading' }, me, now).querySelector('.acct-note')?.textContent).toBe('Loading…');
  expect(render('board', { status: 'ready', data: { rows: [], total: 0, you: null } }, { status: 'loading' }, me, now).querySelector('.acct-note')?.textContent).toBe(
    'No ranked runs yet. Light a tree and be the first.',
  );
  const failed = render('board', { status: 'error' }, { status: 'loading' }, me, now);
  expect(failed.querySelector('.acct-note')?.textContent).toBe("Couldn't load the leaderboard.");
  expect(failed.querySelector('[data-act="reload"]')).not.toBeNull();
});

it('your games: best, rank, top-50 count, then recent games with their status', () => {
  const games: MyGamesResponse = {
    best: { ms: 81_000, rank: 12, finishedAt: day },
    inTop: 2,
    total: 340,
    games: [
      { id: 'a', ms: 94_200, finishedAt: now - 3_600_000, ranked: true, reason: null, isBest: false, imported: false, daily: null, dailyFirst: false },
      { id: 'b', ms: 125_100, finishedAt: day, ranked: false, reason: 'paused', isBest: false, imported: false, daily: null, dailyFirst: false },
      { id: 'c', ms: 81_000, finishedAt: day, ranked: true, reason: null, isBest: true, imported: false, daily: null, dailyFirst: false },
    ],
  };
  const el = render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now);
  expect(listView('games', { status: 'loading' }, { status: 'ready', data: games }, me, now).label).toBe('Your games');
  expect(texts(el, '.acct-stats b')).toEqual(['1:21.0', '#12', '2']);
  expect(texts(el, '.acct-status')).toEqual(['Ranked', 'Unranked · paused too long', 'Personal best']);
  expect(el.querySelector('.acct-when')?.textContent).toBe('Today · 9:00 pm');
  expect(el.querySelector('[data-act="delete"]')).not.toBeNull();
  expect(el.querySelector('.acct-pin')).toBeNull();
  const unknown = { ...games, games: [{ ...games.games[1], reason: 'cosmic_rays' as unknown as 'paused' }] };
  expect(render('games', { status: 'loading' }, { status: 'ready', data: unknown }, me, now).querySelector('.acct-status')?.textContent).toBe('Unranked');
});

describe('your games: Daily Tree runs', () => {
  const g = (over: Partial<RecentGame>): RecentGame => ({ id: 'd', ms: 42_000, finishedAt: day, ranked: false, reason: 'daily', isBest: false, imported: false, daily: '2026-11-06', dailyFirst: true, ...over });
  const rows = (...games: RecentGame[]) => render('games', { status: 'loading' }, { status: 'ready', data: { best: null, inTop: 0, total: 0, games } }, me, now);
  const row = (game: RecentGame) => rows(game).querySelector('.acct-game');

  it('a first attempt shows only its Daily tag, on the second line beside the date: no Unranked', () => {
    const r = row(g({}));
    expect(r?.querySelector('.acct-gt .acct-daily')).toBeNull();
    expect(r?.querySelector('.acct-gt')?.textContent).toBe('0:42.0');
    const second = r?.querySelector('.acct-line2');
    expect([...(second?.children ?? [])].map((n) => n.className)).toEqual(['acct-when', 'acct-daily']);
    expect(second?.querySelector('.acct-when')?.textContent).toBe('Dec 1 · 8:00 pm');
    expect(second?.querySelector('.acct-daily')?.textContent).toBe('Daily Tree · Nov 6');
    expect(r?.querySelector('.acct-status')).toBeNull();
    expect(r?.textContent).not.toContain('Unranked');
    expect(r?.classList.contains('un')).toBe(false);
  });

  it('a repeat shows the tag and Unranked · not your first go at this Daily Tree', () => {
    const r = row(g({ dailyFirst: false }));
    expect(r?.querySelector('.acct-daily')?.textContent).toBe('Daily Tree · Nov 6');
    expect(r?.querySelector('.acct-status')?.textContent).toBe('Unranked · not your first go at this Daily Tree');
    expect(r?.classList.contains('un')).toBe(true);
  });

  it("a past day's tree shows the tag and Unranked · a past day's tree", () => {
    const r = row(g({ reason: 'past', dailyFirst: false, daily: '2026-11-03' }));
    expect(r?.querySelector('.acct-daily')?.textContent).toBe('Daily Tree · Nov 3');
    expect(r?.querySelector('.acct-status')?.textContent).toBe("Unranked · a past day's tree");
  });

  it("a first attempt the judge couldn't vouch for shows the tag and the judge's reason", () => {
    for (const [reason, why] of [
      ['clock', "couldn't verify the clock"],
      ['paused', 'paused too long'],
      ['too_fast', 'too fast'],
    ] as const) {
      const r = row(g({ reason }));
      expect(r?.querySelector('.acct-daily')?.textContent).toBe('Daily Tree · Nov 6');
      expect(r?.querySelector('.acct-status')?.textContent).toBe(`Unranked · ${why}`);
      expect(r?.classList.contains('un')).toBe(true);
    }
  });

  it('a random game has no Daily tag (its second line is the date alone); a day goes in as text', () => {
    const plain = row(g({ daily: null, dailyFirst: false, reason: 'paused' }));
    expect(plain?.querySelector('.acct-daily')).toBeNull();
    expect(plain?.querySelector('.acct-line2')?.textContent).toBe('Dec 1 · 8:00 pm');
    expect(row(g({ daily: '<b>x</b>' }))?.querySelector('.acct-daily b')).toBeNull();
  });
});

it('your games: the account totals, and imported runs say so', () => {
  const games: MyGamesResponse = {
    best: { ms: 81_000, rank: 12, finishedAt: day },
    inTop: 0,
    total: 340,
    games: [
      { id: 'a', ms: 94_200, finishedAt: day, ranked: true, reason: null, isBest: false, imported: true, daily: null, dailyFirst: false },
      { id: 'c', ms: 81_000, finishedAt: day, ranked: true, reason: null, isBest: true, imported: true, daily: null, dailyFirst: false },
    ],
  };
  const stats: AccountStats = { userId: 1, solved: 312, totalMs: 312 * 78_456, averageMs: 78_456, bestMs: 81_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-12-03', imported: 300 };
  const el = render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now, { status: 'ready', data: stats });
  expect(texts(el, '.acct-totals b')).toEqual(['312', '1:18.4', '4', '7']);
  expect(texts(el, '.acct-totals span')).toEqual(['Solved', 'Average', 'Day streak', 'Longest']);
  expect(texts(el, '.acct-status')).toEqual(['Imported', 'Personal best · Imported']);
  // The first row is unchanged.
  expect(texts(el, '.acct-stats b')).toEqual(['1:21.0', '#12', '0']);
  // Not loaded yet: dashes.
  expect(texts(render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now), '.acct-totals b')).toEqual(['–', '–', '–', '–']);
});

it('your games totals: a list with labels; loading, failed and empty read as words, not bare dashes', () => {
  const games: MyGamesResponse = { best: null, inTop: 0, total: 0, games: [] };
  const totals = (stats?: Parameters<typeof listView>[5]) => render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now, stats).querySelector('.acct-totals');
  const ready = totals({ status: 'ready', data: { userId: 1, solved: 1234, totalMs: 0, averageMs: null, bestMs: null, streak: 1000, longestStreak: 1000, lastSolvedDay: null, imported: 0 } });
  expect(ready?.getAttribute('role')).toBe('list');
  expect(ready?.getAttribute('aria-label')).toBe('Account totals');
  // Hidden words, not an aria-label on the listitem (several screen readers skip a label on that role).
  expect([...(ready?.querySelectorAll('[role="listitem"]') ?? [])].map((n) => n.querySelector('.acct-vh')?.textContent ?? null)).toEqual([null, ': not available', null, null]);
  expect(ready?.querySelector('[role="listitem"]:nth-child(2) b')?.getAttribute('aria-hidden')).toBe('true');
  expect(ready?.querySelector('[role="listitem"] b')?.hasAttribute('aria-hidden')).toBe(false);
  expect(ready?.querySelector('[aria-label]:not(.acct-totals)')).toBeNull();
  // One number format for 1,000 and up, as on the results tag.
  expect(texts(ready as HTMLElement, 'b')).toEqual(['1,234', '–', '1,000', '1,000']);
  // Loading: busy, and each dash says so.
  const loading = totals();
  expect(loading?.getAttribute('aria-busy')).toBe('true');
  expect(loading?.querySelector('[role="listitem"]')?.textContent).toBe('–Solved: loading');
  expect(loading?.querySelector('[role="listitem"] b')?.getAttribute('aria-hidden')).toBe('true');
  // Failed: dashes that say "not available", and a visible note.
  const failed = render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now, { status: 'error' });
  expect(failed.querySelector('.acct-totals')?.hasAttribute('aria-busy')).toBe(false);
  expect(failed.querySelector('.acct-totals [role="listitem"]')?.textContent).toBe('–Solved: not available');
  expect(failed.querySelector('.acct-totals-err')?.textContent).toBe("Couldn't load your totals.");
  expect(texts(failed, '.acct-totals b')).toEqual(['–', '–', '–', '–']);
  expect(totals({ status: 'loading' })?.nextElementSibling?.classList.contains('acct-totals-err')).toBe(false);
});

it('your games, signed out: an invitation to sign in', () => {
  const el = render('games', { status: 'loading' }, { status: 'loading' }, null, now);
  expect(el.querySelector('.acct-empty h3')?.textContent).toBe('Keep every tree');
  expect(el.querySelector('[data-act="signin"]')).not.toBeNull();
});

it('the two views are an ARIA tablist: tabs control one tabpanel, only the selected tab is in the Tab order', () => {
  for (const tab of ['board', 'games'] as const) {
    const el = render(tab, { status: 'ready', data: board }, { status: 'loading' }, me, now);
    const tabs = [...el.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];
    expect(tabs.map((t) => t.id)).toEqual(['acct-tab-board', 'acct-tab-games']);
    expect(tabs.map((t) => t.getAttribute('aria-controls'))).toEqual(['acct-panel', 'acct-panel']);
    const selected = tab === 'board' ? 0 : 1;
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(selected === 0 ? ['true', 'false'] : ['false', 'true']);
    expect(tabs.map((t) => t.tabIndex)).toEqual(selected === 0 ? [0, -1] : [-1, 0]);
    const panel = el.querySelector('#acct-panel');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs[selected].id);
  }
});

it('Left and Right arrows (and Home, End) move to the other tab and select it', () => {
  // The sheet as Accounts drives it: a tab's click re-renders with that tab, and focus goes to the selected tab.
  const host = document.createElement('div');
  document.body.append(host);
  let tab: 'board' | 'games' = 'board';
  const show = () => {
    listView(tab, { status: 'ready', data: board }, { status: 'loading' }, me, now).render(host);
    host.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  };
  const clicked: (string | undefined)[] = [];
  host.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    clicked.push(act);
    tab = act === 'tab-board' ? 'board' : 'games';
    show();
  });
  show();
  const press = (key: string) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const focused = () => document.activeElement?.id;
  expect(press('ArrowRight')).toBe(true);
  expect(focused()).toBe('acct-tab-games');
  expect(press('ArrowRight')).toBe(true); // wraps
  expect(focused()).toBe('acct-tab-board');
  press('ArrowLeft'); // wraps the other way
  expect(focused()).toBe('acct-tab-games');
  press('Home');
  expect(focused()).toBe('acct-tab-board');
  press('Home'); // already there: nothing to select
  press('End');
  expect(focused()).toBe('acct-tab-games');
  expect(clicked).toEqual(['tab-games', 'tab-board', 'tab-games', 'tab-board', 'tab-games']);
  expect(host.querySelector('#acct-panel')?.getAttribute('aria-labelledby')).toBe('acct-tab-games');
  expect(press('ArrowDown')).toBe(false);
  host.remove();
});

describe('board windows: Today, This week, All time (spec 2026-10-14 §4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  const pressed = (el: HTMLElement) => texts(el, '.acct-wins [aria-pressed="true"]');

  it('a segmented control under the title, on the leaderboard only, the shown window pressed', () => {
    const el = render('board', { status: 'ready', data: board }, { status: 'loading' }, me, now, undefined, 'week');
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
    // Not tabs: the tablist's arrow keys still move between Leaderboard and Your games only.
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(render('games', { status: 'loading' }, { status: 'loading' }, me, now, undefined, 'week').querySelector('.acct-wins')).toBeNull();
  });

  it('the subtitle follows the window', () => {
    const sub = (win: BoardWindow, b: Loadable<BoardResponse> = { status: 'ready', data: board }) =>
      render('board', b, { status: 'loading' }, me, now, undefined, win).querySelector('.acct-sub')?.textContent;
    expect(sub('today')).toBe('Today · 340 ranked runs');
    expect(sub('week')).toBe('This week · 340 ranked runs');
    expect(sub('all')).toBe('All-time · 340 ranked runs');
    expect(sub('today', { status: 'loading' })).toBe('Today · fastest trees');
    expect(pressed(render('board', { status: 'loading' }, { status: 'loading' }, me, now, undefined, 'today'))).toEqual(['Today']);
  });

  it('an empty window says so in its own words', () => {
    const empty = (win: BoardWindow) =>
      render('board', { status: 'ready', data: { rows: [], total: 0, you: null } }, { status: 'loading' }, me, now, undefined, win).querySelector('.acct-body .acct-note')?.textContent;
    expect(empty('today')).toBe('No runs yet today — be the first.');
    expect(empty('week')).toBe('No runs yet this week.');
    expect(empty('all')).toBe('No ranked runs yet. Light a tree and be the first.');
  });

  it('the Daily window comes first and has its own empty text', () => {
    const el = render('board', { status: 'ready', data: { rows: [], total: 0, you: null } }, { status: 'loading' }, me, now, undefined, 'daily');
    expect(texts(el, '.acct-wins button')[0]).toBe('Daily');
    expect(el.querySelector('.acct-wins button')?.getAttribute('data-act')).toBe('win-daily');
    expect(pressed(el)).toEqual(['Daily']);
    expect(el.querySelector('.acct-body .acct-note')?.textContent).toBe('No one has lit this Daily Tree yet.');
    // The sub names the day the board is for (this browser's today unless told), as the pill does: never "Today's".
    expect(el.querySelector('.acct-sub')?.textContent).toBe('Daily Tree · Dec 3 · 0 runs');
    expect(render('board', { status: 'loading' }, { status: 'loading' }, me, now, undefined, 'daily').querySelector('.acct-sub')?.textContent).toBe('Daily Tree · Dec 3 · fastest trees');
    // The rosette of a Daily begun before midnight opens that run's day.
    const yesterday = render('board', { status: 'ready', data: { rows: [], total: 0, you: null } }, { status: 'loading' }, me, now, undefined, 'daily', '2026-12-02');
    expect(yesterday.querySelector('.acct-sub')?.textContent).toBe('Daily Tree · Dec 2 · 0 runs');
    expect(yesterday.querySelector('.acct-body .acct-note')?.textContent).toBe('No one has lit this Daily Tree yet.');
    // The remembered window is still Today until one is chosen.
    expect(loadBoardWindow()).toBe('today');
    saveBoardWindow('daily');
    expect(loadBoardWindow()).toBe('daily');
  });

  it("the Daily window's words: runs, not ranked runs, and your run, not your best", () => {
    const daily = (data: BoardResponse) => render('board', { status: 'ready', data }, { status: 'loading' }, me, now, undefined, 'daily');
    const listed = daily({ ...board, total: 9 });
    expect(listed.querySelector('.acct-sub')?.textContent).toBe('Daily Tree · Dec 3 · 9 runs');
    expect(listed.querySelector('.acct-pin-note')?.textContent).toBe('Your run · #2 of 9');
    const you = { rank: 87, name: 'Meridian', ms: 152_000, finishedAt: day, mine: true };
    expect(daily({ rows: [board.rows[0]], total: 90, you }).querySelector('.acct-pin-note')?.textContent).toBe('Your run · #87 of 90');
    expect(daily({ rows: [{ ...board.rows[0] }], total: 1, you: null }).querySelector('.acct-pin-note')?.textContent).toBe('1 run');
    // The other windows keep their words.
    expect(render('board', { status: 'ready', data: board }, { status: 'loading' }, me, now, undefined, 'today').querySelector('.acct-pin-note')?.textContent).toBe('Your best · #2 of 340 runs');
  });

  it('no run of yours in the window: no pinned row; unnamed, the pick-a-name call to action as before', () => {
    const el = render('board', { status: 'ready', data: { rows: [{ ...board.rows[0] }], total: 1, you: null } }, { status: 'loading' }, me, now, undefined, 'today');
    expect(el.querySelector('.acct-pin .acct-me')).toBeNull();
    expect(el.querySelector('.acct-pin-note')?.textContent).toBe('1 ranked run');
    const nameless = render('board', { status: 'ready', data: board }, { status: 'loading' }, { name: null, isAdmin: false, starHead: false }, now, undefined, 'today');
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
