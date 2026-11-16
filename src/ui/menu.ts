import type { Settings } from '../store/settings';
import { el } from './dom';

export interface MenuHandlers {
  onChange(s: Settings): void;
  /** "Decorate" was chosen: the menu has closed, and the drawer should open. */
  onDecorate(): void;
  onNewTree(): void;
  /** "Daily Tree" was chosen (and confirmed mid-run): start today's Daily Tree. */
  onDaily(): void;
  /** This device has already started today's Daily: its row says "Played" (asked each time the menu opens). */
  dailyPlayed?(): boolean;
  /** The tree in play is today's live Daily: its row just closes the menu (there is nothing to start over to). */
  playingDaily?(): boolean;
  /** True while a game is in progress (New tree and Daily Tree then need a second tap). */
  needsConfirm(): boolean;
  /** The menu is about to open (the app closes the radio panel). */
  onOpen?(): void;
  /** "Keyboard shortcuts" was chosen: the menu has closed, and the card should stay open. */
  onKeys?(): void;
  /** "Advent calendar" was chosen: the menu has closed, and the calendar should open (its doors confirm for themselves). */
  onAdvent?(): void;
  /** "Career" was chosen: the menu has closed; `from` (the menu button) is where focus goes back to. */
  onCareer?(from: HTMLElement): void;
  /** "Leaderboard" was chosen: the menu has closed; `from` (the menu button) is where focus goes back to. */
  onBoard?(from: HTMLElement): void;
}

/** How long the first New tree press (or N) stays armed for the confirming second one. The N toast lasts as long. */
export const NEW_TREE_CONFIRM_MS = 3000;

/** What a menu row starts: a new random tree, or the Daily Tree. */
export type TreeAction = 'new' | 'daily';

/** The words on a row (or an Advent door) armed for its confirming second press. */
export const CONFIRM_TEXT = 'Tap again to start over';

/**
 * The confirm that keeps a misclick from throwing away a run: while `needsConfirm()`, the first press of a key only arms
 * it for NEW_TREE_CONFIRM_MS ('armed'); a second press of the same key inside that window, or any press when nothing is
 * at stake, goes ahead ('go'). Each key arms for itself: a press of one never confirms another. The menu's rows and the
 * Advent calendar's doors share it.
 */
export class Confirm<K extends string | number = string> {
  private armed: { key: K; until: number } | null = null;

  constructor(private readonly needsConfirm: () => boolean) {}

  press(key: K): 'go' | 'armed' {
    const now = performance.now();
    if (!this.needsConfirm() || (this.armed?.key === key && now < this.armed.until)) {
      this.armed = null;
      return 'go';
    }
    this.armed = { key, until: now + NEW_TREE_CONFIRM_MS };
    return 'armed';
  }

  /** The key waiting for its second press, or null (none, or its window has passed). */
  get current(): K | null {
    return this.armed !== null && performance.now() < this.armed.until ? this.armed.key : null;
  }

  reset(): void {
    this.armed = null;
  }
}

export class Menu {
  private readonly root = el('menu');
  private readonly button = el('menu-btn');
  private readonly newTree = el('new-tree');
  private readonly daily = el('daily-row');
  private readonly dailyLabel = el('daily-label');
  private readonly dailyNote = el('daily-note');
  private played = false;
  private readonly volume = el<HTMLInputElement>('effects-volume');
  private readonly haptics = el<HTMLInputElement>('haptics');
  /** The row whose first press is waiting for its confirming second one. */
  private readonly confirm: Confirm<TreeAction>;

  constructor(private settings: Settings, private readonly h: MenuHandlers) {
    this.confirm = new Confirm(() => h.needsConfirm());
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.root.hidden) this.open();
      else this.close();
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!this.root.hidden && !this.root.contains(t) && !this.button.contains(t) && t !== el('stage')) this.close();
    });
    // The drawer takes the room the menu would sit in, so the menu closes first.
    el('decorate-btn').addEventListener('click', () => {
      this.close();
      this.h.onDecorate();
    });
    this.volume.addEventListener('input', () => this.update({ effectsVolume: Number(this.volume.value) }));
    this.haptics.addEventListener('change', () => this.update({ haptics: this.haptics.checked }));
    if (!('vibrate' in navigator)) el('haptics-row').hidden = true;
    this.newTree.addEventListener('click', () => this.requestNewTree());
    this.daily.addEventListener('click', () => this.request('daily'));
    // The calendar is a sheet over the game: the menu closes first.
    document.getElementById('advent-row')?.addEventListener('click', () => {
      this.close();
      this.h.onAdvent?.();
    });
    // Career is a page and the leaderboard a sheet over the game: the menu closes first.
    document.getElementById('career-row')?.addEventListener('click', () => {
      this.close();
      this.h.onCareer?.(this.button);
    });
    document.getElementById('board-row')?.addEventListener('click', () => {
      this.close();
      this.h.onBoard?.(this.button);
    });
    // The card docks where the menu opens, so the menu closes first, then the card is pinned open.
    document.getElementById('keys-row')?.addEventListener('click', () => {
      this.close();
      this.h.onKeys?.();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) {
        e.preventDefault();
        this.close();
      }
    });
    this.render();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens the menu with focus on `focus` (the account row, coming back from the account page), else its first control. */
  open(focus?: HTMLElement | null): void {
    this.h.onOpen?.();
    // Asked afresh at each open, so it is right after midnight.
    this.played = this.h.dailyPlayed?.() ?? false;
    this.render();
    this.root.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    // Focus the first control so keyboard users start inside the dialog.
    const first = focus && this.root.contains(focus) ? focus : this.root.querySelector<HTMLElement>('button, input');
    first?.focus({ preventScroll: true });
  }

  close(): void {
    const wasOpen = !this.root.hidden;
    const active = document.activeElement;
    this.root.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.confirm.reset();
    this.render();
    // Hand focus back to the button unless the user has moved it somewhere else on purpose.
    if (wasOpen && (!active || active === document.body || this.root.contains(active))) this.button.focus({ preventScroll: true });
  }

  /**
   * The unseen dot: something earned and not yet seen in the wardrobe. The app sets it only while no run is in progress
   * (src/app.ts showDot).
   */
  setDot(on: boolean): void {
    this.button.classList.toggle('has-new', on);
    el('decorate-btn').classList.toggle('has-new', on);
    this.button.setAttribute('aria-label', on ? 'Settings, new in Decorate' : 'Settings');
  }

  /** Keep the menu's copy of the settings in step when they change elsewhere (e.g. the radio's Effects slider). */
  sync(s: Settings): void {
    this.settings = s;
    this.render();
  }

  /** A new random tree, from the button or the N key: see request. */
  requestNewTree(): 'started' | 'armed' {
    return this.armOrStart('new');
  }

  /**
   * A new tree (New tree, N) or the Daily Tree (its row). While a run is in progress the first call only arms a 3 s
   * confirm ('armed'); a second call for the same row inside the window, or any call when nothing is at stake, starts
   * it ('started'). Each row arms for itself: a press of one never confirms the other. On today's live Daily the Daily
   * row only closes the menu ('closed').
   */
  request(action: TreeAction): 'started' | 'armed' | 'closed' {
    if (action === 'daily' && this.h.playingDaily?.()) {
      this.close();
      return 'closed';
    }
    return this.armOrStart(action);
  }

  private armOrStart(action: TreeAction): 'started' | 'armed' {
    if (this.confirm.press(action) === 'go') {
      this.close();
      if (action === 'daily') this.h.onDaily();
      else this.h.onNewTree();
      return 'started';
    }
    this.render();
    window.setTimeout(() => this.render(), NEW_TREE_CONFIRM_MS + 50);
    return 'armed';
  }

  private update(p: Partial<Settings>): void {
    this.settings = { ...this.settings, ...p };
    this.render();
    this.h.onChange(this.settings);
  }

  private render(): void {
    this.volume.value = String(this.settings.effectsVolume);
    this.haptics.checked = this.settings.haptics;
    const armed = this.confirm.current;
    this.newTree.textContent = armed === 'new' ? CONFIRM_TEXT : 'New tree';
    this.newTree.classList.toggle('armed', armed === 'new');
    this.dailyLabel.textContent = armed === 'daily' ? CONFIRM_TEXT : 'Daily Tree';
    this.daily.classList.toggle('armed', armed === 'daily');
    this.dailyNote.hidden = !this.played || armed === 'daily';
  }
}
