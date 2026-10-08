import type { AccountStats, BoardResponse, BoardRow, MyGamesResponse, RecentGame, User } from '../api/types';
import { count, esc, formatDay, formatMs, formatWhen, plural, UNRANKED_TEXT } from './format';
import { G_LOGO, I } from './icons';
import type { SheetView } from './sheet';

export type ListTab = 'board' | 'games';
export type Loadable<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

function rowHtml(r: BoardRow, now: number): string {
  const rank = Number(r.rank);
  const top = rank <= 3 ? ` acct-top acct-top${rank}` : '';
  return `<li class="acct-row${top}${r.mine ? ' acct-me' : ''}"${r.mine ? ' aria-current="true"' : ''}>
    <span class="acct-rank">${rank}</span>
    <span class="acct-name"><span class="acct-nm">${esc(r.name)}</span>${r.mine ? '<span class="acct-you">You</span>' : ''}</span>
    <span class="acct-lead" aria-hidden="true"></span>
    <span class="acct-time">${formatMs(r.ms)}</span>
    <span class="acct-date">${formatDay(r.finishedAt, now)}</span></li>`;
}

function boardBody(b: Loadable<BoardResponse>, now: number): string {
  if (b.status === 'loading') return '<p class="acct-note">Loading…</p>';
  if (b.status === 'error') return `<p class="acct-note">Couldn't load the leaderboard.</p><button class="acct-text" type="button" data-act="reload">Try again</button>`;
  if (!b.data.rows.length) return '<p class="acct-note">No ranked runs yet. Light a tree and be the first.</p>';
  return `<ol class="acct-rows">${b.data.rows.map((r) => rowHtml(r, now)).join('')}</ol>`;
}

function boardPin(b: Loadable<BoardResponse>, user: User | null | undefined, now: number): string {
  if (!user)
    return `<div class="acct-pin-cta"><span>Sign in to see your name on the list</span><button class="acct-google sm" type="button" data-act="signin">${G_LOGO}<span>Sign in</span></button></div>`;
  if (user.name === null) return '<div class="acct-pin-cta"><span>Pick a display name to join the board</span><button class="acct-text" type="button" data-act="name">Pick a name</button></div>';
  if (b.status !== 'ready') return '';
  const { you, total, rows } = b.data;
  if (you) return `<ol class="acct-rows">${rowHtml(you, now)}</ol><p class="acct-pin-note">Your best · #${Number(you.rank)} of ${plural(total, 'run')}</p>`;
  // Your best is in the list above (rows are in rank order): say where, rather than repeating the header's total.
  const best = rows.find((r) => r.mine);
  return best ? `<p class="acct-pin-note">Your best · #${Number(best.rank)} of ${plural(total, 'run')}</p>` : `<p class="acct-pin-note">${plural(total, 'ranked run')}</p>`;
}

/** "Unranked · paused too long"; a reason this browser doesn't know yet reads just "Unranked". */
function unrankedLabel(reason: RecentGame['reason']): string {
  const why = Object.hasOwn(UNRANKED_TEXT, reason ?? 'anonymous') ? UNRANKED_TEXT[reason ?? 'anonymous'] : null;
  return why ? `Unranked · ${why}` : 'Unranked';
}

function gameHtml(g: RecentGame, now: number): string {
  const [cls, label] = g.isBest
    ? ['s-best', g.imported ? 'Personal best · Imported' : 'Personal best']
    : g.imported
      ? ['s-imported', 'Imported']
      : g.ranked
        ? ['s-counted', 'Ranked']
        : ['', unrankedLabel(g.reason)];
  return `<li class="acct-game${g.ranked ? '' : ' un'}">
    <span class="acct-gt">${formatMs(g.ms)}${g.isBest ? `<span class="acct-star">${I.star}</span>` : ''}</span>
    <span class="acct-when">${esc(formatWhen(g.finishedAt, now))}</span>
    <span class="acct-status ${cls}">${label}</span></li>`;
}

/** The account's totals (GET /api/me/stats), the same on every device; dashes until they arrive. */
function totalsHtml(s: Loadable<AccountStats>): string {
  const d = s.status === 'ready' ? s.data : null;
  // A dash alone is read as "en dash" or nothing: hide it and say so in words, hidden text after the label ("Solved: loading").
  const gap = s.status === 'loading' ? ': loading' : ': not available';
  const cell = (value: string | null, label: string): string =>
    `<div role="listitem">${value === null ? '<b aria-hidden="true">–</b>' : `<b>${value}</b>`}<span>${label}</span>${value === null ? `<i class="acct-vh">${gap}</i>` : ''}</div>`;
  const row = `<div class="acct-totals" role="list" aria-label="Account totals"${s.status === 'loading' ? ' aria-busy="true"' : ''}>${cell(d ? count(d.solved) : null, 'Solved')}${cell(
    d && d.averageMs !== null ? formatMs(Number(d.averageMs)) : null,
    'Average',
  )}${cell(d ? count(d.streak) : null, 'Day streak')}${cell(d ? count(d.longestStreak) : null, 'Longest')}</div>`;
  return s.status === 'error' ? `${row}<p class="acct-note acct-totals-err">Couldn't load your totals.</p>` : row;
}

function gamesBody(g: Loadable<MyGamesResponse>, user: User | null | undefined, now: number, s: Loadable<AccountStats>): string {
  if (!user)
    return `<div class="acct-empty"><div class="acct-emb">${I.list}</div><h3>Keep every tree</h3>
      <p class="acct-lede">Sign in to keep your games and put your best time on the leaderboard.</p>
      <button class="acct-google" type="button" data-act="signin">${G_LOGO}<span>Continue with Google</span></button>
      <p class="acct-fine">Wins on this device are added when you sign in.</p></div>`;
  if (g.status === 'loading') return '<p class="acct-note">Loading…</p>';
  if (g.status === 'error') return `<p class="acct-note">Couldn't load your games.</p><button class="acct-text" type="button" data-act="reload">Try again</button>`;
  const d = g.data;
  const stats = `<div class="acct-stats">
      <div><b>${d.best ? formatMs(d.best.ms) : '–'}</b><span>Your best</span></div>
      <div><b>${d.best?.rank ? `#${Number(d.best.rank)}` : '–'}</b><span>of ${plural(d.total, 'run')}</span></div>
      <div><b>${Number(d.inTop)}</b><span>In the top 50</span></div></div>`;
  const list = d.games.length ? `<ul class="acct-games">${d.games.map((x) => gameHtml(x, now)).join('')}</ul>` : '<p class="acct-note">No games yet. Light a tree to see it here.</p>';
  const links = `<div class="acct-links"><p>Signed in with Google${user.name ? ` as <b>${esc(user.name)}</b>` : ''}</p>
      <div><button type="button" data-act="signout">Sign out</button><button type="button" class="danger" data-act="delete">Delete account</button><a href="/privacy">Privacy</a></div></div>`;
  return `${stats}${totalsHtml(s)}<h3 class="acct-h3">Recent games</h3>${list}${links}`;
}

const tabAttrs = (id: ListTab, tab: ListTab): string =>
  `role="tab" id="acct-tab-${id}" aria-controls="acct-panel" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}"`;

/**
 * The tablist's keys (WAI-ARIA tabs, automatic activation): Left and Right move to the other tab, wrapping, and Home
 * and End to the first and last; the tab moved to is selected through its own click, as a pointer would.
 */
function bindTabKeys(list: HTMLElement): void {
  list.addEventListener('keydown', (e) => {
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = tabs.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    const keys: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 };
    if (!Object.hasOwn(keys, e.key)) return;
    e.preventDefault();
    const next = tabs[(keys[e.key] + tabs.length) % tabs.length];
    next.focus({ preventScroll: true });
    if (next.getAttribute('aria-selected') !== 'true') next.click();
  });
}

/** The leaderboard and Your games: one sheet, two tabs (spec §6, pick 2C). */
export function listView(
  tab: ListTab,
  board: Loadable<BoardResponse>,
  games: Loadable<MyGamesResponse>,
  user: User | null | undefined,
  now: number,
  stats: Loadable<AccountStats> = { status: 'loading' },
): SheetView {
  return {
    label: tab === 'board' ? 'Leaderboard' : 'Your games',
    card: false,
    render(inner) {
      const sub =
        tab === 'board' ? `All-time · ${board.status === 'ready' ? plural(board.data.total, 'ranked run') : 'fastest trees'}` : user?.name ? `${esc(user.name)} · your trees` : 'Not signed in';
      inner.innerHTML = `<header class="acct-head">
          <div class="acct-emb">${I.trophy}</div>
          <div class="acct-titles"><h2 class="acct-title">${tab === 'board' ? 'Leaderboard' : 'Your games'}</h2><p class="acct-sub">${sub}</p></div>
          <div class="acct-tabs" role="tablist" aria-label="Leaderboard views">
            <button ${tabAttrs('board', tab)} type="button" data-act="tab-board">Leaderboard</button>
            <button ${tabAttrs('games', tab)} type="button" data-act="tab-games">Your games</button>
          </div>
        </header>
        <div class="acct-body" id="acct-panel" role="tabpanel" aria-labelledby="acct-tab-${tab}">${tab === 'board' ? boardBody(board, now) : gamesBody(games, user, now, stats)}</div>
        ${tab === 'board' ? `<footer class="acct-pin">${boardPin(board, user, now)}</footer>` : ''}`;
      const list = inner.querySelector<HTMLElement>('[role="tablist"]');
      if (list) bindTabKeys(list);
    },
  };
}
