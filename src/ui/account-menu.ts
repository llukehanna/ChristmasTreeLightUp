import type { SessionState } from '../api/session';
import { esc, formatMs, initial } from './format';
import { bow, I } from './icons';

/** The menu head's line under the name. */
export interface MenuSummary {
  rank: number | null;
  best: number | null;
}

export interface AccountMenuHooks {
  /** The menu is opening (the app closes its other dialogs; the summary loads). */
  open(): void;
  /** A [data-act] item was chosen; `chip` is where focus goes back to. */
  act(act: string, chip: HTMLElement): void;
  /** Signed out, the chip opens the sign-in card instead of the menu. */
  signIn(chip: HTMLElement): void;
  /** The chip changed width: the HUD refits. */
  fit(): void;
}

/** The HUD account chip beside the ··· button, and its menu (pick 1A). */
export class AccountMenu {
  readonly chip = document.createElement('button');
  private readonly drop = document.createElement('div');
  private user: SessionState = undefined;
  private summary: MenuSummary | null = null;

  constructor(private readonly hooks: AccountMenuHooks) {
    const chip = this.chip;
    chip.type = 'button';
    chip.className = 'pill acct-chip';
    chip.id = 'account-chip';
    chip.hidden = true; // until /api/me answers
    document.getElementById('menu-btn')?.before(chip);
    this.drop.className = 'acct-drop';
    this.drop.id = 'account-menu';
    this.drop.setAttribute('role', 'dialog');
    this.drop.setAttribute('aria-label', 'Account');
    this.drop.hidden = true;
    document.body.append(this.drop);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.user) this.hooks.signIn(chip);
      else if (this.drop.hidden) this.open();
      else this.close(true);
    });
    this.drop.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
      if (!t) return; // Radio admin and Privacy are links
      e.preventDefault();
      this.close(false);
      this.hooks.act(t.dataset.act ?? '', chip);
    });
    // An outside tap closes the menu; a tap on the stage only closes it (App.tap checks menuOpen), as with the settings menu.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target instanceof Node ? e.target : null;
      if (!this.drop.hidden && t && !this.drop.contains(t) && !chip.contains(t) && t !== document.getElementById('stage')) this.close(false);
    });
    addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || this.drop.hidden) return;
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      },
      true,
    );
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
    const chip = this.chip;
    chip.hidden = user === undefined;
    if (!user) {
      this.close(false);
      chip.classList.remove('me');
      chip.innerHTML = `${I.person}<span class="acct-chip-l">Sign in</span>`;
      chip.setAttribute('aria-label', 'Sign in');
      chip.removeAttribute('aria-haspopup');
      chip.removeAttribute('aria-expanded');
    } else {
      const shown = user.name ?? 'Account';
      const refocus = this.hasFocus;
      chip.classList.add('me');
      chip.innerHTML = `<span class="acct-av">${initial(shown)}</span><span class="acct-chip-l">${esc(shown)}</span>`;
      chip.setAttribute('aria-label', `Account: ${shown}`);
      chip.setAttribute('aria-haspopup', 'dialog');
      chip.setAttribute('aria-expanded', String(!this.drop.hidden));
      const sub = !summary ? '&nbsp;' : summary.best === null ? 'No ranked runs yet' : `${summary.rank === null ? '' : `#${summary.rank} all-time · `}best ${formatMs(summary.best)}`;
      this.drop.innerHTML = `<span class="acct-band" aria-hidden="true"></span>${bow('acct-dbow')}
        <div class="acct-drop-head"><span class="acct-av lg">${initial(shown)}</span><div><b>${esc(user.name ?? 'No name yet')}</b><small>${sub}</small></div></div>
        ${user.name === null ? `<button class="acct-item" type="button" data-act="name"><span class="acct-dot">${I.pen}</span><span>Pick a display name</span></button>` : ''}
        <button class="acct-item" type="button" data-act="board"><span class="acct-dot">${I.trophy}</span><span>Leaderboard</span>${summary?.rank ? `<span class="acct-r">#${summary.rank}</span>` : ''}</button>
        <button class="acct-item" type="button" data-act="games"><span class="acct-dot">${I.list}</span><span>Your games</span></button>
        ${user.isAdmin ? `<a class="acct-item" href="/admin"><span class="acct-dot">${I.radio}</span><span>Radio admin</span></a>` : ''}
        <div class="acct-drop-foot"><button type="button" data-act="signout">${I.out}Sign out</button><button type="button" class="danger" data-act="delete">Delete account</button><a href="/privacy">Privacy</a></div>`;
      if (refocus) this.drop.querySelector<HTMLElement>('.acct-item')?.focus({ preventScroll: true });
    }
    this.hooks.fit();
  }

  open(): void {
    this.hooks.open();
    this.drop.hidden = false;
    this.chip.setAttribute('aria-expanded', 'true');
    this.drop.querySelector<HTMLElement>('.acct-item')?.focus({ preventScroll: true });
  }

  close(focusChip: boolean): void {
    if (this.drop.hidden) return;
    const active = document.activeElement;
    this.drop.hidden = true;
    this.chip.setAttribute('aria-expanded', 'false');
    if (focusChip || this.drop.contains(active)) this.chip.focus({ preventScroll: true });
  }
}
