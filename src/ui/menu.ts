import type { Settings } from '../store/settings';
import { el } from './dom';

export interface MenuHandlers {
  onChange(s: Settings): void;
  /** "Decorate" was chosen: the menu has closed, and the drawer should open. */
  onDecorate(): void;
  onNewTree(): void;
  /** "Daily Tree" was chosen (and confirmed mid-run): start today's Daily Tree. */
  onDaily(): void;
  /** True while a game is in progress (New tree and Daily Tree then need a second tap). */
  needsConfirm(): boolean;
  /** The menu is about to open (the app closes the radio panel). */
  onOpen?(): void;
  /** "Keyboard shortcuts" was chosen: the menu has closed, and the card should stay open. */
  onKeys?(): void;
}

/** How long the first New tree press (or N) stays armed for the confirming second one. The N toast lasts as long. */
export const NEW_TREE_CONFIRM_MS = 3000;

/** What a menu row starts: a new random tree, or the Daily Tree. */
export type TreeAction = 'new' | 'daily';

export class Menu {
  private readonly root = el('menu');
  private readonly button = el('menu-btn');
  private readonly newTree = el('new-tree');
  private readonly daily = el('daily-row');
  private readonly volume = el<HTMLInputElement>('effects-volume');
  private readonly haptics = el<HTMLInputElement>('haptics');
  /** The row whose first press is waiting for its confirming second one, and until when. */
  private armed: { action: TreeAction; until: number } | null = null;

  constructor(private settings: Settings, private readonly h: MenuHandlers) {
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

  open(): void {
    this.h.onOpen?.();
    this.root.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    // Focus the first control so keyboard users start inside the dialog.
    const first = this.root.querySelector<HTMLElement>('button, input');
    first?.focus({ preventScroll: true });
  }

  close(): void {
    const wasOpen = !this.root.hidden;
    const active = document.activeElement;
    this.root.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.armed = null;
    this.render();
    // Hand focus back to the button unless the user has moved it somewhere else on purpose.
    if (wasOpen && (!active || active === document.body || this.root.contains(active))) this.button.focus({ preventScroll: true });
  }

  /** Keep the menu's copy of the settings in step when they change elsewhere (e.g. the radio's Effects slider). */
  sync(s: Settings): void {
    this.settings = s;
    this.render();
  }

  /** A new random tree, from the button or the N key: see request. */
  requestNewTree(): 'started' | 'armed' {
    return this.request('new');
  }

  /**
   * A new tree (New tree, N) or the Daily Tree (its row). While a run is in progress the first call only arms a 3 s
   * confirm ('armed'); a second call for the same row inside the window, or any call when nothing is at stake, starts
   * it ('started'). Each row arms for itself: a press of one never confirms the other.
   */
  request(action: TreeAction): 'started' | 'armed' {
    const now = performance.now();
    if (!this.h.needsConfirm() || (this.armed?.action === action && now < this.armed.until)) {
      this.close();
      if (action === 'daily') this.h.onDaily();
      else this.h.onNewTree();
      return 'started';
    }
    this.armed = { action, until: now + NEW_TREE_CONFIRM_MS };
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
    const armed = this.armed !== null && performance.now() < this.armed.until ? this.armed.action : null;
    this.newTree.textContent = armed === 'new' ? 'Tap again to start over' : 'New tree';
    this.newTree.classList.toggle('armed', armed === 'new');
    this.daily.textContent = armed === 'daily' ? 'Tap again to start over' : 'Daily Tree';
    this.daily.classList.toggle('armed', armed === 'daily');
  }
}
