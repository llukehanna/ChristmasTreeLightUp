import { BOARD_WINDOWS, type BoardResponse, type BoardRow, type BoardWindow, type User } from '../api/types';
import { count, dailyLabel, esc, formatDay, formatMs, plural } from './format';
import { localDay } from '../store/stats';
import { G_LOGO, I } from './icons';
import type { SheetView } from './sheet';

export type Loadable<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/** A run's Watch button (C4 decision 9), for a row the viewer may watch. */
const watchHtml = (id: string): string =>
  `<button class="acct-watch" type="button" data-act="watch" data-id="${esc(id)}" aria-label="Watch replay" title="Watch replay">${I.play}</button>`;

function rowHtml(r: BoardRow, now: number): string {
  const rank = Number(r.rank);
  const top = rank <= 3 ? ` acct-top acct-top${rank}` : '';
  return `<li class="acct-row${top}${r.mine ? ' acct-me' : ''}"${r.mine ? ' aria-current="true"' : ''}>
    <span class="acct-rank">${rank}</span>
    <span class="acct-name"><span class="acct-nm">${esc(r.name)}</span>${r.mine ? '<span class="acct-you">You</span>' : ''}</span>
    <span class="acct-lead" aria-hidden="true"></span>
    <span class="acct-time">${formatMs(r.ms)}</span>
    <span class="acct-date">${formatDay(r.finishedAt, now)}</span>${r.replay ? watchHtml(r.id) : ''}</li>`;
}

/**
 * The windows as the control and the subtitle name them, and what an empty one says (spec 2026-10-14 §4). The Daily's
 * subtitle is the day it shows (listView), as the pill names it: never "Today's", as the results tag's rosette opens
 * the run's day, which can be yesterday by the time it is solved.
 */
const WINDOWS: Record<BoardWindow, { button: string; sub: string; empty: string }> = {
  daily: { button: 'Daily', sub: 'Daily Tree', empty: 'No one has lit this Daily Tree yet.' },
  today: { button: 'Today', sub: 'Today', empty: 'No runs yet today — be the first.' },
  week: { button: 'This week', sub: 'This week', empty: 'No runs yet this week.' },
  all: { button: 'All time', sub: 'All-time', empty: 'No ranked runs yet. Light a tree and be the first.' },
};

/** What a window counts: ranked runs, or on the Daily board (never ranked on the main one) just runs. */
const runWord = (win: BoardWindow): string => (win === 'daily' ? 'run' : 'ranked run');

/** The window chosen last in this browser; Today until one is chosen (or when storage is blocked), though Daily is the first button. */
const WINDOW_KEY = 'aglow.boardWindow';
export function loadBoardWindow(): BoardWindow {
  try {
    const w = localStorage.getItem(WINDOW_KEY);
    return BOARD_WINDOWS.find((x) => x === w) ?? 'today';
  } catch {
    return 'today';
  }
}
export function saveBoardWindow(w: BoardWindow): void {
  try {
    localStorage.setItem(WINDOW_KEY, w);
  } catch {
    // storage blocked: the choice lasts this page only
  }
}

/** Daily · Today · This week · All time: toggle buttons (aria-pressed), one pressed. */
const windowsHtml = (win: BoardWindow): string =>
  `<div class="acct-wins" role="group" aria-label="Time window">${BOARD_WINDOWS.map(
    (w) => `<button type="button" data-act="win-${w}" aria-pressed="${w === win}">${WINDOWS[w].button}</button>`,
  ).join('')}</div>`;

function boardBody(b: Loadable<BoardResponse>, now: number, win: BoardWindow): string {
  if (b.status === 'loading') return '<p class="acct-note">Loading…</p>';
  if (b.status === 'error') return `<p class="acct-note">Couldn't load the leaderboard.</p><button class="acct-text" type="button" data-act="reload">Try again</button>`;
  if (!b.data.rows.length) return `<p class="acct-note">${WINDOWS[win].empty}</p>`;
  return `<ol class="acct-rows">${b.data.rows.map((r) => rowHtml(r, now)).join('')}</ol>`;
}

function boardPin(b: Loadable<BoardResponse>, user: User | null | undefined, now: number, win: BoardWindow): string {
  if (!user)
    return `<div class="acct-pin-cta"><span>Sign in to see your name on the list</span><button class="acct-google sm" type="button" data-act="signin">${G_LOGO}<span>Sign in</span></button></div>`;
  if (user.name === null) return '<div class="acct-pin-cta"><span>Pick a display name to join the board</span><button class="acct-text" type="button" data-act="name">Pick a name</button></div>';
  if (b.status !== 'ready') return '';
  const { you, total, rows } = b.data;
  // The Daily board holds one run each, never ranked on the main board: "Your run · #r of N", not "Your best".
  const note = (rank: number): string =>
    win === 'daily' ? `Your run · #${Number(rank)} of ${count(total)}` : `Your best · #${Number(rank)} of ${plural(total, 'run')}`;
  if (you) return `<ol class="acct-rows">${rowHtml(you, now)}</ol><p class="acct-pin-note">${note(you.rank)}</p>`;
  // Your run is in the list above (rows are in rank order): say where, rather than repeating the header's total.
  const mine = rows.find((r) => r.mine);
  return `<p class="acct-pin-note">${mine ? note(mine.rank) : plural(total, runWord(win))}</p>`;
}

/** The views listView made: the account sheet redraws only these when their data arrives (it may show another page). */
const LISTS = new WeakSet<SheetView>();
export const isListView = (v: SheetView): boolean => LISTS.has(v);

/**
 * The leaderboard (spec §6), one window at a time (spec 2026-10-14), `board` being that window's answer. Its head has the
 * career page's Leaderboard | Career switch (spec 2026-11-15): Leaderboard is the view on screen, Career opens the page.
 */
export function listView(
  board: Loadable<BoardResponse>,
  user: User | null | undefined,
  now: number,
  win: BoardWindow = 'all',
  /** The day (YYYY-MM-DD) of the Daily board shown: this browser's today unless the rosette opened a run's. */
  dailyDay: string = localDay(new Date(now)),
): SheetView {
  const view: SheetView = {
    label: 'Leaderboard',
    card: false,
    render(inner) {
      const name = win === 'daily' ? dailyLabel(dailyDay) : WINDOWS[win].sub;
      const sub = `${name} · ${board.status === 'ready' ? plural(board.data.total, runWord(win)) : 'fastest trees'}`;
      inner.innerHTML = `<header class="acct-head">
          <div class="acct-emb">${I.trophy}</div>
          <div class="acct-titles"><h2 class="acct-title">Leaderboard</h2><p class="acct-sub">${sub}</p></div>
          <div class="acct-tabs"><button type="button" aria-current="page">Leaderboard</button><button type="button" data-act="career">Career</button></div>
          ${windowsHtml(win)}
        </header>
        <div class="acct-body">${boardBody(board, now, win)}</div>
        <footer class="acct-pin">${boardPin(board, user, now, win)}</footer>`;
    },
  };
  LISTS.add(view);
  return view;
}
