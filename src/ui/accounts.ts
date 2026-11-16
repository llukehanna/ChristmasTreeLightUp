import { api, ApiError } from '../api/client';
import { cleanName, isReserved } from '../api/names';
import type { Session, SessionState } from '../api/session';
import type { BoardResponse, BoardWindow } from '../api/types';
import { canSaveName, deleteView, nameView, paintName, signInView, type NameState, type NameStatus, type SignInOptions } from './account-cards';
import { AccountMenu } from './account-menu';
import { isListView, listView, loadBoardWindow, saveBoardWindow, type Loadable } from './board-sheets';
import { localDay } from '../store/stats';
import { Sheet } from './sheet';

export interface AccountsHooks {
  /** A sheet is about to cover the game: pause a game in progress. */
  pause(): void;
  /** The account page is opening: close the settings menu and the radio panel. */
  closeOthers(): void;
  /** "‹ Menu" or Escape on the account page: open the settings menu again, focus on its account row. */
  backToMenu(): void;
  toast(text: string, ms?: number): void;
  /** A row's Watch button: play run `id` back on the stage (C4). */
  onWatch(id: string): void;
  /** The menu's Career and the leaderboard sheet's: the career page (the sign-in sheet for a guest). */
  openCareer(from?: HTMLElement | null): void;
}

/** Why a name isn't available, as the card shows it: anything unexpected from the server reads as taken. */
const checkReason = (reason: unknown): NameStatus => (reason === 'invalid' || reason === 'reserved' ? reason : 'taken');

/** The name card opens by itself once per browser session for an account without a name. */
const NAME_ASKED = 'aglow.nameAsked';
const CHECK_DELAY_MS = 400;

/** Everything account-shaped on the game page (spec §6): the chip and its menu, the sheets and the cards. */
export class Accounts {
  private readonly sheet: Sheet;
  private readonly menu: AccountMenu;
  /** The leaderboard's window (spec 2026-10-14 §4), as chosen last in this browser; each window keeps its own answer. */
  private chosen: BoardWindow = loadBoardWindow();
  /** The window on screen: the chosen one, or the board the results tag's rosette opened (All time, or the Daily). */
  private win: BoardWindow = this.chosen;
  private readonly boards: Record<BoardWindow, Loadable<BoardResponse>> = { daily: { status: 'loading' }, today: { status: 'loading' }, week: { status: 'loading' }, all: { status: 'loading' } };
  /** The local day the Daily's, Today's and This week's answers are for: on a new day they start again from loading. */
  private boardsDay = '';
  /** The day of the Daily board on screen: today's, or a Daily run's (the results tag's rosette). */
  private dailyDay = '';
  private name: NameState = { status: 'empty', value: '' };
  private nameTimer = 0;
  private nameSeq = 0;
  private deleting = false;

  constructor(
    private readonly session: Session,
    private readonly hooks: AccountsHooks,
  ) {
    this.sheet = new Sheet({
      onOpen: () => {
        this.menu.close();
        hooks.closeOthers();
        hooks.pause();
      },
      onAct: (act, el) => this.act(act, el),
    });
    this.menu = new AccountMenu({
      open: () => {
        hooks.closeOthers();
        void this.loadSummary();
      },
      act: (act, from) => this.act(act, from),
      signIn: (from) => this.openSignIn({}, from),
      back: () => hooks.backToMenu(),
    });
    session.subscribe((s) => this.onSession(s));
    this.noteFailedSignIn();
  }

  /** Keys belong to the sheet or the account menu while either has them. */
  get blocksKeys(): boolean {
    return this.sheet.isOpen || this.menu.hasFocus;
  }

  get menuOpen(): boolean {
    return this.menu.isOpen;
  }

  get sheetOpen(): boolean {
    return this.sheet.isOpen;
  }

  closeMenu(): void {
    this.menu.close();
  }

  /** The account row's line and Leaderboard's rank, read afresh when the settings menu opens (signed in only). */
  refreshSummary(): void {
    if (this.session.current) void this.loadSummary();
  }

  /** The account sheet itself, for another page in its glass (the Advent calendar, src/ui/advent.ts). */
  get host(): Sheet {
    return this.sheet;
  }

  openSignIn(o: SignInOptions = {}, from?: HTMLElement | null): void {
    this.sheet.open(signInView(o, o.pendingMs == null), from);
  }

  openName(from?: HTMLElement | null): void {
    clearTimeout(this.nameTimer);
    this.name = { status: 'empty', value: '' };
    this.sheet.open(nameView({ input: (v) => this.onNameInput(v), save: () => void this.saveName() }), from);
    paintName(this.sheet.body, this.name);
  }

  openDelete(from?: HTMLElement | null): void {
    const user = this.session.current;
    if (user) this.sheet.open(deleteView(user), from);
  }

  /**
   * The leaderboard on the window chosen last, or on `win` (the board of the results tag's rank) without changing that
   * choice; the Daily window shows `day`'s board (a Daily run's), today's by default.
   */
  openBoard(from?: HTMLElement | null, win: BoardWindow = this.chosen, day?: string): void {
    this.win = win;
    this.newBoardDay();
    this.showDaily(day ?? this.boardsDay);
    this.sheet.open(this.listNow(), from);
    void this.loadBoard();
  }

  /** Past midnight here, the Daily's, Today's and This week's answers are yesterday's: they go back to loading. */
  private newBoardDay(): void {
    const day = localDay(new Date());
    if (day === this.boardsDay) return;
    // Today's Daily board becomes the new day's; a run's day (the rosette's) stays until the board is opened again.
    if (this.dailyDay === this.boardsDay) this.dailyDay = day;
    this.boardsDay = day;
    this.boards.daily = { status: 'loading' };
    this.boards.today = { status: 'loading' };
    this.boards.week = { status: 'loading' };
  }

  /** The Daily window shows `day`'s board: another day's answer goes back to loading. */
  private showDaily(day: string): void {
    if (day === this.dailyDay) return;
    this.dailyDay = day;
    this.boards.daily = { status: 'loading' };
  }

  private listNow() {
    return listView(this.boards[this.win], this.session.current, Date.now(), this.win, this.dailyDay);
  }

  /** Redraws the leaderboard when its data arrives, if it is still on screen. */
  private refreshList(): void {
    const v = this.sheet.current;
    if (v && isListView(v)) this.sheet.update(this.listNow());
  }

  /**
   * The shown window's board, into that window's own slot: an answer arriving after a switch never shows in another,
   * and one for the Daily, Today or This week asked for before midnight here is dropped once the day has moved on.
   */
  private async loadBoard(): Promise<void> {
    const win = this.win;
    const day = this.boardsDay;
    const dailyDay = this.dailyDay;
    let next: Loadable<BoardResponse> | null;
    try {
      next = { status: 'ready', data: await (win === 'daily' ? api.board(win, undefined, dailyDay) : api.board(win)) };
    } catch {
      next = this.boards[win].status === 'ready' ? null : { status: 'error' };
    }
    if (win !== 'all' && day !== this.boardsDay) return;
    if (win === 'daily' && dailyDay !== this.dailyDay) return;
    if (next) this.boards[win] = next;
    this.refreshList();
  }

  /** The menu head: your rank and best (the cached career's ranked best and its place), when the menu opens. */
  private async loadSummary(): Promise<void> {
    try {
      const { best } = await api.cachedCareer();
      if (this.session.current) this.menu.render(this.session.current, { rank: best?.rank ?? null, best: best?.ms ?? null });
    } catch {
      // the menu works without it
    }
  }

  private onSession(user: SessionState): void {
    api.forgetCareer();
    this.menu.render(user, null);
    this.refreshList();
    if (user && user.name === null && !this.sheet.isOpen && this.firstNameAsk()) this.openName();
  }

  private firstNameAsk(): boolean {
    try {
      if (sessionStorage.getItem(NAME_ASKED)) return false;
      sessionStorage.setItem(NAME_ASKED, '1');
    } catch {
      // storage blocked: ask anyway
    }
    return true;
  }

  private onNameInput(value: string): void {
    clearTimeout(this.nameTimer);
    const seq = ++this.nameSeq;
    const name = cleanName(value);
    if (!value.trim()) this.paint({ status: 'empty', value });
    else if (!name) this.paint({ status: 'invalid', value });
    else if (isReserved(name)) this.paint({ status: 'reserved', value });
    else {
      this.paint({ status: 'checking', value });
      this.nameTimer = window.setTimeout(() => {
        api.checkName(name).then(
          (r) => seq === this.nameSeq && this.paint({ status: r.available === true ? 'available' : checkReason(r.reason), value }),
          () => seq === this.nameSeq && this.paint({ status: 'error', value }),
        );
      }, CHECK_DELAY_MS);
    }
  }

  private paint(s: NameState): void {
    this.name = s;
    paintName(this.sheet.body, s);
  }

  private async saveName(): Promise<void> {
    const s = this.name;
    const name = cleanName(s.value);
    if (!name || !canSaveName(s.status)) return;
    this.nameSeq++;
    this.paint({ status: 'saving', value: s.value });
    try {
      const { user } = await api.setName(name);
      this.sheet.close();
      this.session.set(user);
      this.hooks.toast(`Welcome, ${name}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'has_name') {
        this.sheet.close();
        void this.session.load();
        return;
      }
      // A name taken between the check and the save: say so, and keep the card open (spec §8).
      const known: NameStatus[] = ['taken', 'reserved', 'invalid'];
      const status = e instanceof ApiError && known.includes(e.code as NameStatus) ? (e.code as NameStatus) : 'failed';
      this.paint({ status, value: s.value });
    }
  }

  private async confirmDelete(): Promise<void> {
    const input = this.sheet.body.querySelector<HTMLInputElement>('#acct-confirm');
    const line = this.sheet.body.querySelector<HTMLElement>('.acct-check');
    if (!input || this.deleting) return;
    this.deleting = true;
    try {
      await api.deleteAccount(input.value.trim());
      this.sheet.close();
      this.session.set(null);
      this.hooks.toast('Account deleted');
    } catch (e) {
      if (line) line.textContent = e instanceof ApiError && e.code === 'confirm' ? "That doesn't match. Type it exactly as shown." : "Couldn't delete your account right now. Try again.";
    } finally {
      this.deleting = false;
    }
  }

  private async signOut(): Promise<void> {
    await this.session.signOut();
    this.hooks.toast('Signed out');
  }

  private act(act: string, el: HTMLElement): void {
    switch (act) {
      case 'board':
      case 'peek':
        this.openBoard(el);
        break;
      case 'career':
        this.hooks.openCareer(el);
        break;
      case 'win-daily':
      case 'win-today':
      case 'win-week':
      case 'win-all':
        this.win = this.chosen = act.slice('win-'.length) as BoardWindow;
        saveBoardWindow(this.win);
        this.newBoardDay();
        // The Daily button is today's Daily, whichever day's the rosette opened.
        if (this.win === 'daily') this.showDaily(this.boardsDay);
        this.sheet.update(this.listNow());
        this.sheet.body.querySelector<HTMLElement>('.acct-wins [aria-pressed="true"]')?.focus({ preventScroll: true });
        void this.loadBoard();
        break;
      case 'reload':
        void this.loadBoard();
        break;
      case 'signin':
        this.openSignIn({}, el);
        break;
      case 'name':
        this.openName(el);
        break;
      case 'save-name':
        void this.saveName();
        break;
      case 'signout':
        this.sheet.close();
        void this.signOut();
        break;
      case 'delete':
        this.openDelete(el);
        break;
      case 'confirm-delete':
        void this.confirmDelete();
        break;
      case 'cancel':
        this.sheet.close();
        break;
      case 'watch':
        if (el.dataset.id) this.hooks.onWatch(el.dataset.id);
        break;
    }
  }

  /** ?auth=failed (any sign-in callback failure): say so once, and drop it from the address. */
  private noteFailedSignIn(): void {
    if (new URLSearchParams(location.search).get('auth') !== 'failed') return;
    // Rebuilt by hand: URLSearchParams would turn a bare "?test" into "?test=".
    const rest = location.search
      .slice(1)
      .split('&')
      .filter((p) => p && p.split('=')[0] !== 'auth');
    history.replaceState(history.state, '', `${location.pathname}${rest.length ? `?${rest.join('&')}` : ''}${location.hash}`);
    this.hooks.toast("Sign-in didn't finish. Try again.", 3200);
  }
}
