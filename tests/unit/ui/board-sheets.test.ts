// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { BoardResponse, MyGamesResponse } from '../../../src/api/types';
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
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('340 ranked runs');
  expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Leaderboard');
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
      { id: 'a', ms: 94_200, finishedAt: now - 3_600_000, ranked: true, reason: null, isBest: false },
      { id: 'b', ms: 125_100, finishedAt: day, ranked: false, reason: 'paused', isBest: false },
      { id: 'c', ms: 81_000, finishedAt: day, ranked: true, reason: null, isBest: true },
    ],
  };
  const el = render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now);
  expect(listView('games', { status: 'loading' }, { status: 'ready', data: games }, me, now).label).toBe('Your games');
  expect(texts(el, '.acct-stats b')).toEqual(['1:21.0', '#12', '2']);
  expect(texts(el, '.acct-status')).toEqual(['Ranked', 'Unranked · paused too long', 'Personal best']);
  expect(el.querySelector('.acct-when')?.textContent).toBe('Today · 9:00 pm');
  expect(el.querySelector('[data-act="delete"]')).not.toBeNull();
  expect(el.querySelector('.acct-pin')).toBeNull();
});

it('your games, signed out: an invitation to sign in', () => {
  const el = render('games', { status: 'loading' }, { status: 'loading' }, null, now);
  expect(el.querySelector('.acct-empty h3')?.textContent).toBe('Keep every tree');
  expect(el.querySelector('[data-act="signin"]')).not.toBeNull();
});
