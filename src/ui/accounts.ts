import { api, ApiError } from '../api/client';
import { cleanName, isReserved } from '../api/names';
import type { Session, SessionState } from '../api/session';
import type { AccountStats, BoardResponse, MyGamesResponse } from '../api/types';
import { canSaveName, deleteView, nameView, paintName, signInView, type NameState, type NameStatus, type SignInOptions } from './account-cards';
import { AccountMenu } from './account-menu';
import { listView, type ListTab, type Loadable } from './board-sheets';
import { Sheet } from './sheet';

export interface AccountsHooks {
  /** A sheet is about to cover the game: pause a game in progress. */
  pause(): void;
  /** The account menu is opening: close the settings menu and the radio panel. */
  closeOthers(): void;
  fitHud(): void;
  toast(text: string, ms?: number): void;
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
  private tab: ListTab = 'board';
  private board: Loadable<BoardResponse> = { status: 'loading' };
  private games: Loadable<MyGamesResponse> = { status: 'loading' };
  private stats: Loadable<AccountStats> = { status: 'loading' };
  /** Bumped by each stats load and each session change: only the newest answer is kept. */
  private statsSeq = 0;
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
        this.menu.close(false);
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
      act: (act, chip) => this.act(act, chip),
      signIn: (chip) => this.openSignIn({}, chip),
      fit: () => hooks.fitHud(),
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
    this.menu.close(false);
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

  openBoard(from?: HTMLElement | null): void {
    this.tab = 'board';
    this.sheet.open(this.listNow(), from);
    void this.loadBoard();
  }

  openGames(from?: HTMLElement | null): void {
    this.tab = 'games';
    this.sheet.open(this.listNow(), from);
    this.loadTab();
  }

  private listNow() {
    return listView(this.tab, this.board, this.games, this.session.current, Date.now(), this.stats);
  }

  /** Redraws the leaderboard or Your games when its data arrives, if that list is still on screen. */
  private refreshList(): void {
    const v = this.sheet.current;
    if (v && !v.card) this.sheet.update(this.listNow());
  }

  private async loadBoard(): Promise<void> {
    try {
      this.board = { status: 'ready', data: await api.board() };
    } catch {
      if (this.board.status !== 'ready') this.board = { status: 'error' };
    }
    this.refreshList();
  }

  private async loadGames(): Promise<void> {
    if (!this.session.current) return;
    try {
      this.games = { status: 'ready', data: await api.myGames() };
    } catch {
      if (this.games.status !== 'ready') this.games = { status: 'error' };
    }
    this.refreshList();
  }

  /** Your games' totals: the account's stats (spec 2026-10-08 §6.3). */
  private async loadStats(): Promise<void> {
    if (!this.session.current) return;
    const seq = ++this.statsSeq;
    try {
      const data = await api.myStats();
      if (seq !== this.statsSeq) return;
      this.stats = { status: 'ready', data };
    } catch {
      if (seq !== this.statsSeq) return;
      if (this.stats.status !== 'ready') this.stats = { status: 'error' };
    }
    this.refreshList();
  }

  /** The open tab's data: the board, or your games and their totals. */
  private loadTab(): void {
    if (this.tab === 'board') void this.loadBoard();
    else {
      void this.loadGames();
      void this.loadStats();
    }
  }

  /** The menu head: your rank and best, when the menu opens. */
  private async loadSummary(): Promise<void> {
    try {
      const g = await api.myGames();
      this.games = { status: 'ready', data: g };
      if (this.session.current) this.menu.render(this.session.current, { rank: g.best?.rank ?? null, best: g.best?.ms ?? null });
    } catch {
      // the menu works without it
    }
  }

  private onSession(user: SessionState): void {
    this.menu.render(user, null);
    this.games = { status: 'loading' };
    this.stats = { status: 'loading' };
    this.statsSeq++;
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
      case 'games':
        this.openGames(el);
        break;
      case 'tab-board':
      case 'tab-games':
        this.tab = act === 'tab-board' ? 'board' : 'games';
        this.sheet.update(this.listNow());
        this.sheet.body.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
        this.loadTab();
        break;
      case 'reload':
        this.loadTab();
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
