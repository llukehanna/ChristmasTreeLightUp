// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { AccountStats, BoardResponse, MyGamesResponse } from '../../../src/api/types';
import { listView } from '../../../src/ui/board-sheets';

const now = new Date(2026, 11, 3, 22, 0).getTime();
const day = new Date(2026, 11, 1, 20, 0).getTime();
const me = { name: 'Meridian', isAdmin: false };
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
  const nameless = render('board', { status: 'ready', data: board }, { status: 'loading' }, { name: null, isAdmin: false }, now);
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
      { id: 'a', ms: 94_200, finishedAt: now - 3_600_000, ranked: true, reason: null, isBest: false, imported: false },
      { id: 'b', ms: 125_100, finishedAt: day, ranked: false, reason: 'paused', isBest: false, imported: false },
      { id: 'c', ms: 81_000, finishedAt: day, ranked: true, reason: null, isBest: true, imported: false },
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

it('your games: the account totals, and imported runs say so', () => {
  const games: MyGamesResponse = {
    best: { ms: 81_000, rank: 12, finishedAt: day },
    inTop: 0,
    total: 340,
    games: [
      { id: 'a', ms: 94_200, finishedAt: day, ranked: true, reason: null, isBest: false, imported: true },
      { id: 'c', ms: 81_000, finishedAt: day, ranked: true, reason: null, isBest: true, imported: true },
    ],
  };
  const stats: AccountStats = { solved: 312, totalMs: 312 * 78_456, averageMs: 78_456, bestMs: 81_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-12-03', imported: 300 };
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
  const ready = totals({ status: 'ready', data: { solved: 1234, totalMs: 0, averageMs: null, bestMs: null, streak: 1000, longestStreak: 1000, lastSolvedDay: null, imported: 0 } });
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
