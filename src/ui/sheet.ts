import { bow, I } from './icons';

/**
 * A selector that finds `el` again after its container is re-rendered (its data-act, id or link target), or null.
 * Re-renders replace the markup, so keyboard focus is carried over by this key rather than by the element.
 */
export function focusKey(el: Element | null): string | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.dataset.act) return `[data-act="${CSS.escape(el.dataset.act)}"]`;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const href = el.getAttribute('href');
  return href ? `a[href="${CSS.escape(href)}"]` : null;
}

/** One view in the account sheet: a list (leaderboard, Your games) or a small card (sign-in, name, delete). */
export interface SheetView {
  /** The dialog's accessible name. */
  label: string;
  card: boolean;
  /** Fills the sheet. Called on open and on every update(); it may bind listeners to what it creates. */
  render(inner: HTMLElement): void;
  /** Selector of the element that takes focus on open (default: the dialog itself). */
  focus?: string;
}

export interface SheetHooks {
  /** The sheet is about to cover the game (it pauses a game in progress). */
  onOpen(): void;
  /** A [data-act] control inside the sheet was activated. */
  onAct(act: string, el: HTMLElement): void;
}

/**
 * The account sheet in the radio panel's dark glass (pick 2C): a popover under the HUD on desktop, a bottom sheet on
 * phones. Modal: a scrim covers the game, Tab stays inside, and Escape, the close button or a tap on the scrim closes it.
 */
export class Sheet {
  private readonly scrim = document.createElement('div');
  private readonly root = document.createElement('div');
  private readonly inner = document.createElement('div');
  private view: SheetView | null = null;
  private opener: HTMLElement | null = null;

  constructor(private readonly hooks: SheetHooks) {
    this.scrim.className = 'acct-scrim';
    this.scrim.hidden = true;
    this.root.className = 'acct-sheet';
    this.root.id = 'account-sheet';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.tabIndex = -1;
    this.root.hidden = true;
    this.root.innerHTML = `<div class="acct-grab" aria-hidden="true"></div>${bow('acct-sbow')}<button class="acct-x" type="button" data-act="close" aria-label="Close">${I.close}</button>`;
    this.inner.className = 'acct-inner';
    this.root.append(this.inner);
    document.body.append(this.scrim, this.root);
    this.scrim.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
      if (!t || !this.root.contains(t)) return; // links (Continue with Google, Privacy) navigate
      e.preventDefault();
      if (t.dataset.act === 'close') this.close();
      else this.hooks.onAct(t.dataset.act ?? '', t);
    });
    addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get current(): SheetView | null {
    return this.view;
  }

  /** The open view's content, for updates in place (the name card's check line). */
  get body(): HTMLElement {
    return this.inner;
  }

  open(view: SheetView, opener?: HTMLElement | null): void {
    if (!this.isOpen) {
      this.hooks.onOpen();
      this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    this.view = view;
    this.scrim.hidden = false;
    this.root.hidden = false;
    // The pause overlay's "Paused · Tap to resume" would show through the glass; the scrim owns taps meanwhile.
    document.body.classList.add('acct-sheet-open');
    this.refresh();
    const target = view.focus ? this.root.querySelector<HTMLElement>(view.focus) : null;
    (target ?? this.root).focus({ preventScroll: true });
  }

  /** Shows `view` in the open sheet (new data, another tab), keeping focus inside. */
  update(view: SheetView): void {
    if (!this.isOpen) return;
    this.view = view;
    this.refresh();
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.scrim.hidden = true;
    document.body.classList.remove('acct-sheet-open');
    this.view = null;
    const o = this.opener;
    this.opener = null;
    // Back to what opened it, unless that is out of reach under the pause overlay (the HUD is inert while paused).
    if (o && o.isConnected && !o.closest('[inert]') && o.getClientRects().length) o.focus({ preventScroll: true });
    else if (document.body.classList.contains('paused')) document.getElementById('pause')?.focus({ preventScroll: true });
  }

  private refresh(): void {
    const view = this.view;
    if (!view) return;
    const active = document.activeElement;
    const hadFocus = this.root.contains(active);
    const key = this.inner.contains(active) ? focusKey(active) : null;
    this.root.className = `acct-sheet ${view.card ? 'acct-card' : 'acct-list'}`;
    this.root.setAttribute('aria-label', view.label);
    view.render(this.inner);
    if (!hadFocus || this.root.contains(document.activeElement)) return;
    // New data (or another tab) re-rendered the sheet: focus goes back to the same control when it is still there.
    const again = key ? this.inner.querySelector<HTMLElement>(key) : null;
    (again ?? this.root).focus({ preventScroll: true });
  }

  /** Escape closes; Tab stays inside; P never reaches the game's pause key. Capture phase, so nothing else sees them. */
  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Tab') {
      const stops = [...this.root.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])')].filter(
        (n) => !(n instanceof HTMLButtonElement && n.disabled) && n.getClientRects().length > 0,
      );
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const at = document.activeElement;
      if (!this.root.contains(at) || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      }
    } else if (e.key === 'p' || e.key === 'P') {
      e.stopPropagation();
    }
  }
}
