/**
 * The key card: a slim gift card docked to the right edge, so the tree in the middle stays in view and in play. Hold
 * Tab and it slides in; let go and it tucks away. Two other ways to find it, a quiet "Tab · keys" under the HUD pills
 * and a "Keyboard shortcuts" row in the settings menu, pin it open: a pinned card ignores the Tab keyup, and Escape,
 * Tab or its × close it. The host (App) decides when Tab is the game's to use; this class owns the card.
 */

const cap = (k: string, wide = false) => `<kbd class="kc-cap${wide ? ' wide' : ''}">${k}</kbd>`;

let uid = 0;
/** A cream mouse with one button in cranberry: the one to press. Gradient ids are unique per picture. */
function mouse(side: 'left' | 'right'): string {
  const id = `kc${++uid}`;
  return `<svg class="kc-mouse" viewBox="0 0 26 34" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="${id}-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#e3d6bc"/></linearGradient>
  <linearGradient id="${id}-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0404a"/><stop offset="1" stop-color="#8e1622"/></linearGradient></defs>
  <path d="M13 2C6.5 2 2.5 6.5 2.5 13v8c0 6.5 4.5 11 10.5 11s10.5-4.5 10.5-11v-8C23.5 6.5 19.5 2 13 2z" fill="url(#${id}-b)" stroke="#b9a07a" stroke-width="1"/>
  ${side === 'right' ? `<path d="M13.6 2.1c5.6.4 9.5 4.6 9.9 10.4H13.6z" fill="url(#${id}-r)"/>` : `<path d="M12.4 2.1C6.8 2.5 2.9 6.7 2.5 12.5h9.9z" fill="url(#${id}-r)"/>`}
  <path d="M13 2v10.5M2.6 12.5h20.8" stroke="#b9a07a" stroke-width=".9"/>
  <path d="M5 8c1-2.4 3-4 5.5-4.5" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".9"/></svg>`;
}

/** The gold bow of the settings sheet, with its own gradient ids. */
function bow(): string {
  const id = `kc${++uid}`;
  return `<svg class="kc-bow" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${id}-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe3a4"/><stop offset=".45" stop-color="#d9a74e"/><stop offset="1" stop-color="#8f5f1e"/></linearGradient>
    <linearGradient id="${id}-t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9c16c"/><stop offset="1" stop-color="#90601f"/></linearGradient>
    <radialGradient id="${id}-k" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fff2c8"/><stop offset=".5" stop-color="#e2b25a"/><stop offset="1" stop-color="#8a5a1c"/></radialGradient>
  </defs>
  <path d="M29 22l-10 16 6-2.2 3.4 3.6 3.2-16.4zM35 22l10 16-6-2.2-3.4 3.6-3.2-16.4z" fill="url(#${id}-t)"/>
  <path d="M32 20C22 4 5 3 7 15c1 8 14 9 25 5z" fill="url(#${id}-l)"/>
  <path d="M32 20C42 4 59 3 57 15c-1 8-14 9-25 5z" fill="url(#${id}-l)"/>
  <path d="M30 19C22 9 12 7 11 13c0 3 4 5 10 5M34 19C42 9 52 7 53 13c0 3-4 5-10 5" fill="none" stroke="rgba(90,52,10,.45)" stroke-width="1.2"/>
  <path d="M12 9.5c4-3 10-1 15 5M52 9.5c-4-3-10-1-15 5" fill="none" stroke="rgba(255,248,220,.7)" stroke-width=".9" stroke-linecap="round"/>
  <ellipse cx="32" cy="20" rx="5.2" ry="4.6" fill="url(#${id}-k)"/>
</svg>`;
}

/** The real bindings, in this order (the copy is fixed by the spec). */
const ROWS: { keys: () => string; label: string }[] = [
  { keys: () => mouse('left'), label: 'Turn a wire' },
  { keys: () => mouse('right'), label: 'Turn it back' },
  { keys: () => cap('N'), label: 'A new tree' },
  { keys: () => `${cap('Esc', true)}<i>or</i>${cap('P')}`, label: 'Pause' },
  { keys: () => cap('Tab', true), label: 'This card' },
];

/** The card's two widths (px), and how far it must stand clear of the tree to be shown at all. */
export const CARD_WIDE = 244;
export const CARD_SLIM = 200;
export const CARD_CLEAR = 12;
/** Its height (px), the same at both widths: the band of the screen it covers, centred. */
export const CARD_HEIGHT = 314;
/** Docked high, the card's top stands this far under the garland's lowest bulb. */
export const CARD_HIGH_GAP = 20;
/** The media query for a device with no hover and a coarse pointer: a touch tablet, which gets no card. */
export const TOUCH_ONLY_QUERY = '(hover: none) and (pointer: coarse)';
/** Below this window width there is no card at all. */
export const CARD_MIN_VIEWPORT = 900;

export type CardWidth = typeof CARD_WIDE | typeof CARD_SLIM | 0;

export type CardDock = 'centre' | 'high';
export interface CardFit {
  width: CardWidth;
  dock: CardDock;
}

/**
 * Which card fits, and where. `centreEdge` and `highEdge` are the tree's right edge (CSS px) over the card's own band
 * when it is vertically centred and when it is docked high, under the garland where the tree is narrow (Infinity: no
 * room for that dock). A card must stand CARD_CLEAR px right of the edge. Tried in order: centred wide, centred slim,
 * high wide, high slim; else width 0 (no card, no hint, and Tab keeps its usual job). Always 0 below 900 px, and on
 * a touch-only device (`touchOnly`: a tablet has no Tab key to hold or mouse to point with, however wide it is).
 */
export function cardFit(viewportW: number, centreEdge: number, highEdge: number, touchOnly = false): CardFit {
  if (viewportW >= CARD_MIN_VIEWPORT && !touchOnly) {
    for (const [dock, edge] of [['centre', centreEdge], ['high', highEdge]] as const)
      for (const w of [CARD_WIDE, CARD_SLIM] as const) if (viewportW - w - edge >= CARD_CLEAR) return { width: w, dock };
  }
  return { width: 0, dock: 'centre' };
}

export class KeyCard {
  private root: HTMLElement | null = null;
  private pinned = false;
  private width: CardWidth = 0;
  private dock: CardDock = 'centre';
  private highTop = 0;

  constructor(private readonly host: HTMLElement) {
    // Off until the app has measured the tree and said what fits.
    document.body.classList.add('keys-off');
    // A pinned card: Escape closes it, and never reaches the pause (the capture phase runs before the game's handler).
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.pinned) return;
        e.preventDefault();
        e.stopPropagation();
        this.close();
      },
      true,
    );
  }

  /** True while the card is showing, held or pinned. */
  get open(): boolean {
    return !!this.root?.classList.contains('show');
  }

  /** True once a width has been given: there is room for the card, and the hint and the settings row show. */
  get fitted(): boolean {
    return this.width !== 0;
  }

  /**
   * What fits beside the tree now (see cardFit): sets the card's width, or with 0 takes the card away: an open one
   * closes (pinned and keys-on cleared, so a later Escape is not swallowed) and the hint and settings row hide.
   */
  fit(width: CardWidth, dock: CardDock = 'centre', highTop = 0): void {
    this.width = width;
    this.dock = dock;
    this.highTop = highTop;
    document.body.classList.toggle('keys-off', width === 0);
    if (width === 0) this.close();
    this.style();
  }

  /** The width and dock on the element: slim or wide, centred or docked high with its top at `highTop` px. */
  private style(): void {
    const r = this.root;
    if (!r) return;
    r.classList.toggle('slim', this.width === CARD_SLIM);
    r.classList.toggle('high', this.dock === 'high');
    if (this.dock === 'high') r.style.setProperty('--kc-top', `${this.highTop}px`);
    else r.style.removeProperty('--kc-top');
  }

  /** True while it is pinned open (Tab keyup then leaves it alone). */
  get isPinned(): boolean {
    return this.pinned;
  }

  /** Slides in while Tab is held. */
  show(): void {
    this.reveal(this.pinned);
  }

  /** Tucks away on the Tab keyup: a pinned card stays. */
  hide(): void {
    if (this.pinned) return;
    this.close();
  }

  /** Stays open until Escape, Tab or × (the settings row and the hint). */
  pin(): void {
    this.reveal(true);
  }

  /** Closes it whatever opened it. */
  close(): void {
    this.pinned = false;
    this.root?.classList.remove('show', 'pinned');
    this.root?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('keys-on');
  }

  private reveal(pin: boolean): void {
    if (!this.fitted) return;
    const r = (this.root ??= this.build());
    this.pinned = pin;
    r.classList.toggle('pinned', pin);
    this.style();
    r.removeAttribute('aria-hidden');
    // Starts from its tucked-away spot even on first showing, so the slide plays.
    void r.offsetWidth;
    r.classList.add('show');
    document.body.classList.add('keys-on');
  }

  private build(): HTMLElement {
    const r = document.createElement('aside');
    r.className = 'key-card';
    r.setAttribute('aria-label', 'Keyboard shortcuts');
    r.setAttribute('aria-hidden', 'true');
    r.innerHTML = `<div class="kc-card">
      <i class="kc-ribbon"></i>${bow()}
      <button class="kc-x" type="button" aria-label="Close">×</button>
      <p class="kc-kicker">From the workshop</p>
      <h2>Little helpers</h2>
      <ul>${ROWS.map((row) => `<li><span class="kc-k">${row.keys()}</span><span class="kc-label">${row.label}</span></li>`).join('')}</ul>
      <p class="kc-secret"><kbd class="kc-cap sealed">?</kbd><span>Some trees keep secrets.</span></p>
    </div>`;
    r.querySelector('.kc-x')!.addEventListener('click', () => this.close());
    // The card's own taps never reach the game or the dialogs' click-outside.
    for (const t of ['pointerdown', 'pointerup', 'click'] as const) r.addEventListener(t, (e) => e.stopPropagation());
    this.host.append(r);
    return r;
  }
}
