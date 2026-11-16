import type { CareerResponse } from './api/types';
import type { CareerPage } from './career';

type Kit = typeof import('./career');

export interface CareerOpenerHooks {
  /** The signed-in player; null (or undefined, before /api/me answers) for a guest. */
  user(): { name: string | null } | null | undefined;
  /** api.career */
  load(): Promise<CareerResponse>;
  /** A guest asked for Career: the sign-in sheet, focus going back to `from`. */
  signIn(from: HTMLElement | null): void;
  /**
   * The page is coming up over the stage: pause a run in progress (as a sheet does) and close the sheets and menus.
   * Called on the ask and again as the page lands, for anything opened or resumed while its chunk loaded.
   */
  cover(): void;
  /** The page has gone (or never came): the stage is the player's again; focus goes back to `from` if it can. */
  uncover(from: HTMLElement | null): void;
  /** The page's Leaderboard switch, once the page has closed. */
  leaderboard(): void;
  /** A row's Watch, once the page has closed. */
  watch(id: string): void;
  /** The page's chunk couldn't be loaded. */
  failed(): void;
}

/** Our history entry: Back closes the page instead of leaving the site. */
const isOurs = (state: unknown): boolean => typeof state === 'object' && state !== null && (state as { career?: unknown }).career === true;

/**
 * Opens and closes the career page (src/career, its own chunk) over the game: one page at a time, a history entry while
 * it is up, and a guest sent to sign in instead. This file is in the entry chunk; the page's code is only ever a dynamic
 * import away (tests/unit/build/chunks.test.ts).
 */
export class CareerOpener {
  private phase: 'idle' | 'loading' | 'open' = 'idle';
  private page: CareerPage | null = null;
  /** Bumped by each open and each close: a chunk that lands for an older one opens nothing. */
  private seq = 0;
  /** Our history entry is the current one. */
  private pushed = false;
  /** Where focus goes back to on close. */
  private from: HTMLElement | null = null;
  private chunk: Promise<Kit> | null = null;
  private readonly onPop = (): void => {
    // Back from our entry (the state is the one before it): close, and don't go back again.
    if (this.pushed) {
      this.pushed = false;
      this.shut('gone');
    }
  };

  constructor(
    private readonly hooks: CareerOpenerHooks,
    private readonly loadChunk: () => Promise<Kit> = () => import('./career'),
  ) {
    addEventListener('popstate', this.onPop);
  }

  /** The page is up or on its way: keys and taps are its, not the game's. */
  get isOpen(): boolean {
    return this.phase !== 'idle';
  }

  /** The page covers the stage: the stage draws nothing. */
  get covering(): boolean {
    return this.phase === 'open';
  }

  /** For the test probe. */
  get state(): { open: boolean; loading: boolean } {
    return { open: this.phase === 'open', loading: this.phase === 'loading' };
  }

  /** The account menu's Career, or the leaderboard sheet's: the page for a player, the sign-in sheet for a guest. */
  open(from: HTMLElement | null = null): void {
    const user = this.hooks.user();
    if (!user) {
      this.hooks.signIn(from);
      return;
    }
    if (this.phase !== 'idle') return;
    this.phase = 'loading';
    this.from = from;
    const seq = ++this.seq;
    this.hooks.cover();
    history.pushState({ career: true }, '');
    this.pushed = true;
    this.kit().then(
      (kit) => {
        if (seq !== this.seq) return;
        this.hooks.cover();
        this.phase = 'open';
        this.page = kit.openCareer({
          user: { name: user.name },
          load: () => this.hooks.load(),
          onClose: () => this.close(),
          onLeaderboard: () => {
            this.close();
            this.hooks.leaderboard();
          },
          onWatch: (id) => {
            // Not Back: its popstate would land after the replay has started. The entry stays, as the page it was.
            this.shut('replace');
            this.hooks.watch(id);
          },
        });
      },
      () => {
        if (seq !== this.seq) return;
        this.close();
        this.hooks.failed();
      },
    );
  }

  /** Closes the page (or the open still loading), and takes its history entry back off. */
  close(): void {
    this.shut('back');
  }

  /** Closes the open still waiting for its chunk (Escape: no page is up to take it); false when there is none. */
  closeIfLoading(): boolean {
    if (this.phase !== 'loading') return false;
    this.close();
    return true;
  }

  /** Stops listening for Back (tests). */
  dispose(): void {
    removeEventListener('popstate', this.onPop);
  }

  /**
   * The page goes. Our history entry: `back` goes back over it, `replace` makes it a plain entry, `gone` (Back already
   * took it) leaves history alone.
   */
  private shut(how: 'back' | 'replace' | 'gone'): void {
    if (this.phase === 'idle') return;
    this.seq++;
    this.phase = 'idle';
    this.page?.close();
    this.page = null;
    if (this.pushed && isOurs(history.state)) {
      if (how === 'back') history.back();
      else if (how === 'replace') history.replaceState(null, '');
    }
    this.pushed = false;
    const from = this.from;
    this.from = null;
    this.hooks.uncover(from);
  }

  /** The page's chunk, loaded once; a failed load is forgotten, so the next open asks again (as the replay's does). */
  private kit(): Promise<Kit> {
    if (this.chunk) return this.chunk;
    const p = this.loadChunk();
    this.chunk = p;
    p.catch(() => {
      if (this.chunk === p) this.chunk = null;
    });
    return p;
  }
}
