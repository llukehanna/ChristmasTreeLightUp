import type { BoardResponse, BoardRow, MyGamesResponse, RecentGame, User } from '../api/types';
import { esc, formatDay, formatMs, formatWhen, plural, UNRANKED_TEXT } from './format';
import { G_LOGO, I } from './icons';
import type { SheetView } from './sheet';

export type ListTab = 'board' | 'games';
export type Loadable<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

function rowHtml(r: BoardRow, now: number): string {
  const top = r.rank <= 3 ? ` acct-top acct-top${r.rank}` : '';
  return `<li class="acct-row${top}${r.mine ? ' acct-me' : ''}"${r.mine ? ' aria-current="true"' : ''}>
    <span class="acct-rank">${r.rank}</span>
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
  const you = b.data.you;
  return you
    ? `<ol class="acct-rows">${rowHtml(you, now)}</ol><p class="acct-pin-note">Your best · #${you.rank} of ${plural(b.data.total, 'run')}</p>`
    : `<p class="acct-pin-note">${plural(b.data.total, 'ranked run')}</p>`;
}

function gameHtml(g: RecentGame, now: number): string {
  const [cls, label] = g.isBest ? ['s-best', 'Personal best'] : g.ranked ? ['s-counted', 'Ranked'] : ['', `Unranked · ${UNRANKED_TEXT[g.reason ?? 'anonymous']}`];
  return `<li class="acct-game${g.ranked ? '' : ' un'}">
    <span class="acct-gt">${formatMs(g.ms)}${g.isBest ? `<span class="acct-star">${I.star}</span>` : ''}</span>
    <span class="acct-when">${esc(formatWhen(g.finishedAt, now))}</span>
    <span class="acct-status ${cls}">${label}</span></li>`;
}

function gamesBody(g: Loadable<MyGamesResponse>, user: User | null | undefined, now: number): string {
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
      <div><b>${d.best?.rank ? `#${d.best.rank}` : '–'}</b><span>of ${plural(d.total, 'run')}</span></div>
      <div><b>${d.inTop}</b><span>In the top 50</span></div></div>`;
  const list = d.games.length ? `<ul class="acct-games">${d.games.map((x) => gameHtml(x, now)).join('')}</ul>` : '<p class="acct-note">No games yet. Light a tree to see it here.</p>';
  const links = `<div class="acct-links"><p>Signed in with Google${user.name ? ` as <b>${esc(user.name)}</b>` : ''}</p>
      <div><button type="button" data-act="signout">Sign out</button><button type="button" class="danger" data-act="delete">Delete account</button><a href="/privacy">Privacy</a></div></div>`;
  return `${stats}<h3 class="acct-h3">Recent games</h3>${list}${links}`;
}

/** The leaderboard and Your games: one sheet, two tabs (spec §6, pick 2C). */
export function listView(tab: ListTab, board: Loadable<BoardResponse>, games: Loadable<MyGamesResponse>, user: User | null | undefined, now: number): SheetView {
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
            <button role="tab" type="button" data-act="tab-board" aria-selected="${tab === 'board'}">Leaderboard</button>
            <button role="tab" type="button" data-act="tab-games" aria-selected="${tab === 'games'}">Your games</button>
          </div>
        </header>
        <div class="acct-body">${tab === 'board' ? boardBody(board, now) : gamesBody(games, user, now)}</div>
        ${tab === 'board' ? `<footer class="acct-pin">${boardPin(board, user, now)}</footer>` : ''}`;
    },
  };
}
