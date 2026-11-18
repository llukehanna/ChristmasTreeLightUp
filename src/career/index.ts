/**
 * The career page (spec: Your career), loaded on first use like the replay (src/replay/index.ts): its code and styles
 * stay out of the entry chunk, and nothing here imports the app. The app opens it with openCareer and closes it with
 * page.close(); the page only asks (onClose) when the player presses ‹ Tree or Esc.
 */
import './career.css';
import type { CareerResponse } from '../api/types';
import { eyebrowText, renderBody, shell } from './page';

export interface CareerOptions {
  user: { name: string | null };
  /** api.career */
  load(): Promise<CareerResponse>;
  /** The page asked to close (‹ Tree, Esc). */
  onClose(): void;
  /** The Leaderboard switch. */
  onLeaderboard(): void;
  /** A row's Watch. */
  onWatch(id: string): void;
  now?: () => Date;
}

export interface CareerPage {
  readonly el: HTMLElement;
  close(): void;
}

const STOPS = 'button, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * LAB: the page is built once and kept between opens (and can be built ahead, while the leaderboard card is up), so a
 * swap only moves the frame: nothing is fetched or drawn at the click.
 */
interface Built {
  el: HTMLElement;
  title: HTMLElement;
  eyebrow: HTMLElement;
  body: HTMLElement;
  name: string | null;
  res: CareerResponse | null;
  /** The window size the charts were drawn for. */
  size: string;
  dispose: (() => void) | null;
}
let built: Built | null = null;
/** The open page's callbacks; null while it is closed. */
let cur: CareerOptions | null = null;
const sizeNow = (): string => `${innerWidth}x${innerHeight}`;

function build(user: { name: string | null }): Built {
  const { el, title, eyebrow, body } = shell(user);
  const b: Built = { el, title, eyebrow, body, name: user.name, res: null, size: '', dispose: null };
  el.querySelector('.back')!.addEventListener('click', () => cur?.onClose());
  el.querySelector('.lab-x')!.addEventListener('click', () => cur?.onClose());
  // In the growing look, Career narrows back into the leaderboard card before the sheet takes over.
  el.querySelector('[data-tab="board"]')!.addEventListener('click', () => {
    const o = cur;
    if (!o) return;
    if (document.body.dataset.look !== 'grow') return o.onLeaderboard();
    el.classList.add('shrink');
    el.classList.remove('settled');
    document.body.classList.add('lab-from-career');
    setTimeout(() => o.onLeaderboard(), 180);
    setTimeout(() => document.body.classList.remove('lab-from-career'), 700);
  });
  // Once the frame has widened, the body takes the page's real width (less any scrollbar).
  el.querySelector('.frame')!.addEventListener('animationend', (e) => {
    if (e.target !== e.currentTarget || el.classList.contains('settled')) return;
    el.classList.add('settled');
  });
  return b;
}

/** Draws `res` into the page; it must be in the document (the charts measure their width). */
function draw(b: Built, res: CareerResponse, now: Date): void {
  b.dispose?.();
  b.dispose = null;
  const { runs, dispose } = renderBody(b.body, res, now, (id) => cur?.onWatch(id));
  b.dispose = dispose;
  b.res = res;
  b.size = sizeNow();
  b.eyebrow.textContent = eyebrowText(b.name, runs[0]);
}

/** Builds and draws the page out of sight, ready for the next open. */
export function prewarmCareer(user: { name: string | null }, load: () => Promise<CareerResponse>): void {
  if (cur) return;
  load().then((res) => {
    if (cur) return;
    if (!built || built.name !== user.name) built = build(user);
    const b = built;
    if (b.res === res && b.size === sizeNow()) return;
    b.el.classList.add('prewarm', 'settled');
    document.body.append(b.el);
    try {
      draw(b, res, new Date());
    } catch {
      b.res = null;
    }
    b.el.remove();
    b.el.classList.remove('prewarm');
  }, () => {});
}

/** Opens the page over the stage, appended to the body, with the title focused. */
export function openCareer(opts: CareerOptions): CareerPage {
  if (!built || built.name !== opts.user.name) built = build(opts.user);
  const b = built;
  const { el, title, body } = b;
  cur = opts;
  let closed = false;
  let attempt = 0;

  function load(): void {
    const mine = ++attempt;
    // Drawn already: shown at once, and drawn again only if the data or the window changed.
    if (!b.res) body.innerHTML = '<div class="msg" role="status">Loading your career…</div>';
    let pending: Promise<CareerResponse>;
    try {
      pending = opts.load();
    } catch (e) {
      pending = Promise.reject(e);
    }
    const fail = (): void => {
      b.res = null;
      body.innerHTML = '<div class="msg" role="alert"><p>Couldn’t load your career.</p><button type="button" class="retry">Retry</button></div>';
      body.querySelector('.retry')!.addEventListener('click', load);
    };
    pending.then((res) => {
      if (closed || mine !== attempt) return;
      if (res === b.res && b.size === sizeNow()) return;
      try {
        draw(b, res, (opts.now ?? (() => new Date()))());
      } catch {
        // A response this page can't read is an error like a failed request: the same Retry.
        fail();
      }
    }, () => {
      if (closed || mine !== attempt) return;
      if (!b.res) fail();
    });
  }

  /** Escape asks to close; Tab stays inside; P never reaches the game's pause key. Capture phase, so nothing else sees them. */
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
    } else if (e.key === 'Tab') {
      const stops = [...el.querySelectorAll<HTMLElement>(STOPS)].filter((n) => !(n instanceof HTMLButtonElement && n.disabled) && n.getClientRects().length > 0);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const at = document.activeElement;
      // The title is out of the Tab order but holds focus on open: Tab from it goes to the first stop.
      if (!el.contains(at) || at === title || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      }
    } else if (e.key === 'p' || e.key === 'P') {
      e.stopPropagation();
    }
  }

  el.classList.remove('shrink', 'leaving', 'settled', 'from-sheet', 'prewarm');
  el.querySelectorAll('.lab-ghost').forEach((n) => n.remove());
  if (document.body.classList.contains('lab-from-sheet')) {
    el.classList.add('from-sheet');
    // The leaderboard card's content, where it was, fading out over Career (lab-look.ts copied it at the click).
    const w = window as unknown as { __labGhost?: { el: HTMLElement; top: number } };
    const g = w.__labGhost;
    w.__labGhost = undefined;
    if (g && document.body.dataset.look === 'grow' && innerWidth > 600) {
      el.querySelector('.frame')!.append(g.el);
      const list = g.el.querySelector('.acct-body');
      if (list) list.scrollTop = g.top;
      setTimeout(() => g.el.remove(), 200);
    }
  }
  const page = el.querySelector<HTMLElement>('.page');
  document.addEventListener('keydown', onKey, true);
  document.body.append(el);
  if (page) page.scrollTop = 0;
  title.focus({ preventScroll: true });
  load();

  return {
    el,
    close() {
      if (closed) return;
      closed = true;
      if (cur === opts) cur = null;
      document.removeEventListener('keydown', onKey, true);
      // The growing look fades out instead of vanishing (unless it already narrowed into the leaderboard). The page is
      // kept, drawn, for the next open.
      const lk = document.body.dataset.look;
      if (lk === 'grow' && !el.classList.contains('shrink')) {
        el.classList.add('leaving');
        setTimeout(() => {
          if (!cur) el.remove();
        }, 120);
      } else el.remove();
    },
  };
}
