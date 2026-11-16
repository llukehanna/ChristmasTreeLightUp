import type { SessionState } from '../api/session';
import { esc, formatMs, initial } from './format';
import { I } from './icons';
import { focusKey } from './sheet';

/** The account's line under the name: your rank and best. */
export interface MenuSummary {
  rank: number | null;
  best: number | null;
}

export interface AccountMenuHooks {
  /** The account page is opening (the app closes the menu and its other dialogs; the summary loads). */
  open(): void;
  /** A [data-act] item was chosen; `from` (the menu button) is where focus goes back to. */
  act(act: string, from: HTMLElement): void;
  /** Signed out, the row opens the sign-in card instead of the page; `from` is the menu button. */
  signIn(from: HTMLElement): void;
  /** "‹ Menu" or Escape: the page has closed, and the menu should come back with focus on the account row. */
  back(): void;
}

/**
 * The account at the foot of the settings menu (#account-row, spec 2026-11-16 §3), and its page (§4): opened from the
 * row, it takes the menu's place, with a way back to it.
 */
export class AccountMenu {
  readonly row: HTMLButtonElement;
  private readonly drop = document.createElement('div');
  private user: SessionState = undefined;
  private summary: MenuSummary | null = null;

  constructor(private readonly hooks: AccountMenuHooks) {
    const row = document.getElementById('account-row') as HTMLButtonElement;
    this.row = row;
    row.hidden = true; // until /api/me answers
    this.drop.className = 'acct-drop';
    this.drop.id = 'account-menu';
    this.drop.setAttribute('role', 'dialog');
    this.drop.setAttribute('aria-label', 'Account');
    this.drop.hidden = true;
    document.body.append(this.drop);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.user) this.hooks.signIn(this.menuBtn);
      else if (this.drop.hidden) this.open();
    });
    this.drop.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
      if (!t) return; // Radio admin and Privacy are links
      e.preventDefault();
      const act = t.dataset.act ?? '';
      this.close();
      if (act === 'back') this.hooks.back();
      else this.hooks.act(act, this.menuBtn);
    });
    // An outside tap closes the page; a tap on the stage only closes it (App.tap checks menuOpen), as with the settings menu.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target instanceof Node ? e.target : null;
      if (!this.drop.hidden && t && !this.drop.contains(t) && !row.contains(t) && t !== document.getElementById('stage')) this.close();
    });
    // Escape steps back to the menu, and no further: captured, so the menu's and the game's own Escape never see it.
    addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || this.drop.hidden) return;
        e.preventDefault();
        e.stopPropagation();
        this.close();
        this.hooks.back();
      },
      true,
    );
  }

  private get menuBtn(): HTMLElement {
    return document.getElementById('menu-btn') as HTMLElement;
  }

  get isOpen(): boolean {
    return !this.drop.hidden;
  }

  get hasFocus(): boolean {
    return this.drop.contains(document.activeElement);
  }

  render(user: SessionState, summary: MenuSummary | null = this.summary): void {
    this.user = user;
    this.summary = summary;
    const row = this.row;
    row.hidden = user === undefined;
    const rank = summary?.rank == null ? null : Number(summary.rank);
    const best = summary?.best == null ? null : Number(summary.best);
    const boardRank = document.getElementById('board-rank');
    if (boardRank) boardRank.textContent = user && rank ? `#${rank}` : '';
    if (!user) {
      this.close();
      row.innerHTML = `<span class="acct-av anon">${I.person}</span><span class="menu-acct-t"><span>Sign in</span><small>Save your times and rank</small></span><span class="menu-chev" aria-hidden="true">›</span>`;
      row.setAttribute('aria-label', 'Sign in');
      row.removeAttribute('aria-haspopup');
      row.removeAttribute('aria-expanded');
      return;
    }
    const name = user.name;
    const sub = !summary ? 'Account and sign out' : best === null ? 'No ranked runs yet' : `${rank === null ? '' : `#${rank} all-time · `}best ${formatMs(best)}`;
    // Before a name is picked: the person icon and "Account", never an "A" avatar.
    row.innerHTML = `<span class="acct-av${name === null ? ' anon' : ''}">${name !== null ? initial(name) : I.person}</span><span class="menu-acct-t"><span>${esc(name ?? 'Account')}</span><small>${sub}</small></span><span class="menu-chev" aria-hidden="true">›</span>`;
    row.setAttribute('aria-label', name !== null ? `Account: ${name}` : 'Account');
    row.setAttribute('aria-haspopup', 'dialog');
    row.setAttribute('aria-expanded', String(!this.drop.hidden));
    // The summary can arrive after the page opened: keyboard focus stays on the same item across the re-render.
    const hadFocus = this.hasFocus;
    const key = hadFocus ? focusKey(document.activeElement) : null;
    this.drop.innerHTML = `<button class="acct-item acct-back" type="button" data-act="back"><span aria-hidden="true">‹</span> Menu</button>
        <div class="acct-drop-head"><span class="acct-av lg${name === null ? ' anon' : ''}">${name !== null ? initial(name) : I.person}</span><div><b>${esc(name ?? 'No name yet')}</b><small>${summary ? sub : '&nbsp;'}</small></div></div>
        ${name === null ? `<button class="acct-item" type="button" data-act="name"><span class="acct-dot">${I.pen}</span><span>Pick a display name</span></button>` : ''}
        ${user.isAdmin ? `<a class="acct-item" href="/admin"><span class="acct-dot">${I.radio}</span><span>Radio admin</span></a>` : ''}
        <div class="acct-drop-foot"><button type="button" data-act="signout">${I.out}Sign out</button><button type="button" class="danger" data-act="delete">Delete account</button><a href="/privacy">Privacy</a></div>`;
    if (hadFocus) (this.drop.querySelector<HTMLElement>(key ?? '.acct-item') ?? this.drop.querySelector<HTMLElement>('.acct-item'))?.focus({ preventScroll: true });
  }

  open(): void {
    this.hooks.open();
    this.drop.hidden = false;
    this.row.setAttribute('aria-expanded', 'true');
    this.drop.querySelector<HTMLElement>('.acct-item')?.focus({ preventScroll: true });
  }

  /** Closes the page; focus that was inside it goes to the menu button (back() then moves it on to the account row). */
  close(): void {
    if (this.drop.hidden) return;
    const active = document.activeElement;
    this.drop.hidden = true;
    this.row.setAttribute('aria-expanded', 'false');
    if (this.drop.contains(active)) this.menuBtn.focus({ preventScroll: true });
  }
}
